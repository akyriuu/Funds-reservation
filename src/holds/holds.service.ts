import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DomainError } from '../common/errors/domain.error';
import {
  isForeignKeyViolation,
  isRecordNotFound,
  isUniqueViolation,
} from '../common/prisma/prisma-errors';
import { AccountNotFoundError } from '../accounts/accounts.errors';
import { Account, Hold, Prisma } from '../generated/prisma/client';
import { HoldStatus, LedgerEntryType } from '../generated/prisma/enums';
import { LedgerService } from '../ledger/ledger.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  CaptureAmountExceedsHoldError,
  HoldExpiredError,
  HoldNotFoundError,
  HoldNotPendingError,
  IdempotencyKeyReusedError,
  InsufficientFundsError,
} from './holds.errors';

export interface ReserveHoldCommand {
  accountId: string;
  amountCents: number;
  expiresInSeconds?: number;
  idempotencyKey: string;
}

@Injectable()
export class HoldsService {
  private readonly defaultTtlSeconds: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    config: ConfigService,
  ) {
    this.defaultTtlSeconds = Number(
      config.get<string>('HOLD_DEFAULT_TTL_SECONDS') ?? 900,
    );
  }

  async get(id: string): Promise<Hold> {
    const hold = await this.prisma.hold.findUnique({ where: { id } });

    if (!hold) {
      throw new HoldNotFoundError(id);
    }

    return hold;
  }

  async reserve(command: ReserveHoldCommand): Promise<Hold> {
    const amountCents = BigInt(command.amountCents);
    const ttlSeconds = command.expiresInSeconds ?? this.defaultTtlSeconds;
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const hold = await tx.hold.create({
          data: {
            accountId: command.accountId,
            amountCents,
            expiresAt,
            idempotencyKey: command.idempotencyKey,
          },
        });

        const account = await tx.account.update({
          where: {
            id: command.accountId,
            availableCents: { gte: amountCents },
          },
          data: {
            availableCents: { decrement: amountCents },
            reservedCents: { increment: amountCents },
          },
        });

        await this.recordEntry(tx, account, hold, LedgerEntryType.HOLD_RESERVED, amountCents);

        return hold;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        return this.replay(command);
      }
      if (isForeignKeyViolation(error)) {
        throw new AccountNotFoundError(command.accountId);
      }
      if (isRecordNotFound(error)) {
        throw await this.explainReserveFailure(command.accountId, amountCents);
      }
      throw error;
    }
  }

  async capture(id: string, requestedCents?: number): Promise<Hold> {
    const settledAt = new Date();

    try {
      return await this.prisma.$transaction(async (tx) => {
        const authorized = await tx.hold.findUnique({ where: { id } });

        if (!authorized) {
          throw new HoldNotFoundError(id);
        }

        const capturedCents =
          requestedCents === undefined ? authorized.amountCents : BigInt(requestedCents);

        if (capturedCents > authorized.amountCents) {
          throw new CaptureAmountExceedsHoldError(id, capturedCents, authorized.amountCents);
        }

        const hold = await tx.hold.update({
          where: {
            id,
            status: HoldStatus.PENDING,
            expiresAt: { gt: settledAt },
          },
          data: {
            status: HoldStatus.CAPTURED,
            capturedCents,
            settledAt,
          },
        });

        const account = await tx.account.update({
          where: { id: hold.accountId },
          data: {
            balanceCents: { decrement: capturedCents },
            reservedCents: { decrement: hold.amountCents },
            availableCents: { increment: hold.amountCents - capturedCents },
          },
        });

        await this.recordEntry(tx, account, hold, LedgerEntryType.HOLD_CAPTURED, capturedCents);

        return hold;
      });
    } catch (error) {
      if (isRecordNotFound(error)) {
        throw await this.explainSettleFailure(id, { checkExpiry: true });
      }
      throw error;
    }
  }

  async release(id: string): Promise<Hold> {
    const settledAt = new Date();

    try {
      return await this.prisma.$transaction(async (tx) => {
        const hold = await tx.hold.update({
          where: { id, status: HoldStatus.PENDING },
          data: { status: HoldStatus.RELEASED, settledAt },
        });

        const account = await this.restore(tx, hold);

        await this.recordEntry(
          tx,
          account,
          hold,
          LedgerEntryType.HOLD_RELEASED,
          hold.amountCents,
        );

        return hold;
      });
    } catch (error) {
      if (isRecordNotFound(error)) {
        throw await this.explainSettleFailure(id, { checkExpiry: false });
      }
      throw error;
    }
  }

  private restore(tx: Prisma.TransactionClient, hold: Hold): Promise<Account> {
    return tx.account.update({
      where: { id: hold.accountId },
      data: {
        reservedCents: { decrement: hold.amountCents },
        availableCents: { increment: hold.amountCents },
      },
    });
  }

  private recordEntry(
    tx: Prisma.TransactionClient,
    account: Account,
    hold: Hold,
    type: LedgerEntryType,
    amountCents: bigint,
  ) {
    return this.ledger.record(tx, {
      accountId: account.id,
      holdId: hold.id,
      type,
      amountCents,
      balanceAfter: account.balanceCents,
      reservedAfter: account.reservedCents,
      availableAfter: account.availableCents,
    });
  }

  private async replay(command: ReserveHoldCommand): Promise<Hold> {
    const hold = await this.prisma.hold.findUniqueOrThrow({
      where: { idempotencyKey: command.idempotencyKey },
    });

    const matchesOriginal =
      hold.accountId === command.accountId &&
      hold.amountCents === BigInt(command.amountCents);

    if (!matchesOriginal) {
      throw new IdempotencyKeyReusedError(command.idempotencyKey);
    }

    return hold;
  }

  private async explainReserveFailure(
    accountId: string,
    requestedCents: bigint,
  ): Promise<DomainError> {
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: { availableCents: true },
    });

    if (!account) {
      return new AccountNotFoundError(accountId);
    }

    return new InsufficientFundsError(accountId, requestedCents, account.availableCents);
  }

  private async explainSettleFailure(
    id: string,
    options: { checkExpiry: boolean },
  ): Promise<DomainError> {
    const hold = await this.prisma.hold.findUnique({ where: { id } });

    if (!hold) {
      return new HoldNotFoundError(id);
    }

    if (hold.status !== HoldStatus.PENDING) {
      return new HoldNotPendingError(id, hold.status);
    }

    if (options.checkExpiry && hold.expiresAt <= new Date()) {
      return new HoldExpiredError(id, hold.expiresAt);
    }

    return new HoldNotPendingError(id, hold.status);
  }
}