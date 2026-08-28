import { Injectable } from '@nestjs/common';
import { Account, Prisma } from '../generated/prisma/client';
import { LedgerEntryType } from '../generated/prisma/enums';
import { LedgerService } from '../ledger/ledger.service';
import { PrismaService } from '../prisma/prisma.service';
import { AccountNotFoundError } from './accounts.errors';
import { CreateAccountDto } from './dto/create-account.dto';
import { CreditAmountDto } from './dto/credit-amount.dto';

@Injectable()
export class AccountsService { 
    constructor(
        private readonly prisma: PrismaService,
        private readonly ledger: LedgerService,
    ) {}

    create(dto: CreateAccountDto): Promise<Account> { 
        return this.prisma.account.create({ data: { currency: dto.currency} });
    }

    async get(id: string): Promise<Account> { 
        const account = await this.prisma.account.findUnique({ where: { id } });

        if (!account) { 
            throw new AccountNotFoundError(id);
        }

        return account;
    }

    async credit(id: string, dto: CreditAmountDto): Promise<Account> {
        const amountCents = BigInt(dto.amountCents);
        return this.prisma.$transaction(async (tx) => {
          const account = await this.increment(tx, id, amountCents);
          await this.ledger.record(tx, {
            accountId: account.id,
            type: LedgerEntryType.DEPOSIT,
            amountCents,
            balanceAfter: account.balanceCents,
            reservedAfter: account.reservedCents,
            availableAfter: account.availableCents,
          });
          return account;
        })
    }

    private async increment(
        tx: Prisma.TransactionClient,
        id: string,
        amountCents: bigint,
    ): Promise<Account> { 
        try { 
            return await tx.account.update({
                where: { id },
                data: { 
                    balanceCents: { increment: amountCents },
                    availableCents: { increment: amountCents },
                },
            });
        } catch (error) { 
            if ( 
                error instanceof Prisma.PrismaClientKnownRequestError &&
                error.code === 'P2025'
            ) { 
                throw new AccountNotFoundError(id);
            }
            throw error;
        }
    }
}