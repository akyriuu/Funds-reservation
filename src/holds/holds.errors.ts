import { DomainError } from '../common/errors/domain.error';
import { HoldStatus } from '../generated/prisma/enums';

export class HoldNotFoundError extends DomainError {
  readonly code = 'hold_not_found';
  readonly status = 404;

  constructor(holdId: string) {
    super(`Hold ${holdId} was not found.`, { holdId });
  }
}

export class InsufficientFundsError extends DomainError {
  readonly code = 'insufficient_funds';
  readonly status = 422;

  constructor(accountId: string, requestedCents: bigint, availableCents: bigint) {
    super(
      `Account ${accountId} has ${availableCents} available, but ${requestedCents} was requested.`,
      {
        accountId,
        requestedCents: Number(requestedCents),
        availableCents: Number(availableCents),
      },
    );
  }
}

export class HoldNotPendingError extends DomainError {
  readonly code = 'hold_not_pending';
  readonly status = 409;

  constructor(holdId: string, status: HoldStatus) {
    super(`Hold ${holdId} is ${status} and can no longer be settled.`, {
      holdId,
      status,
    });
  }
}

export class HoldExpiredError extends DomainError {
  readonly code = 'hold_expired';
  readonly status = 409;

  constructor(holdId: string, expiresAt: Date) {
    super(`Hold ${holdId} expired at ${expiresAt.toISOString()}.`, {
      holdId,
      expiresAt: expiresAt.toISOString(),
    });
  }
}

export class CaptureAmountExceedsHoldError extends DomainError {
  readonly code = 'capture_amount_exceeds_hold';
  readonly status = 422;

  constructor(holdId: string, requestedCents: bigint, authorizedCents: bigint) {
    super(
      `Hold ${holdId} authorized ${authorizedCents}, but ${requestedCents} was requested.`,
      {
        holdId,
        requestedCents: Number(requestedCents),
        authorizedCents: Number(authorizedCents),
      },
    );
  }
}

export class IdempotencyKeyReusedError extends DomainError {
  readonly code = 'idempotency_key_reused';
  readonly status = 409;

  constructor(idempotencyKey: string) {
    super(`Idempotency key ${idempotencyKey} was already used with a different payload.`, {
      idempotencyKey,
    });
  }
}

export class MissingIdempotencyKeyError extends DomainError {
  readonly code = 'missing_idempotency_key';
  readonly status = 400;

  constructor() {
    super('The Idempotency-Key header is required to reserve funds.');
  }
}