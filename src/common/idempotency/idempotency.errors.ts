import { DomainError } from '../errors/domain.error';

export class MissingIdempotencyKeyError extends DomainError {
  readonly code = 'missing_idempotency_key';
  readonly status = 400;

  constructor() {
    super('The Idempotency-Key header is required for this operation.');
  }
}

export class IdempotencyPayloadMismatchError extends DomainError {
  readonly code = 'idempotency_payload_mismatch';
  readonly status = 409;

  constructor(idempotencyKey: string) {
    super(`Idempotency key ${idempotencyKey} was already used with a different payload.`, {
      idempotencyKey,
    });
  }
}

export class IdempotencyRequestInProgressError extends DomainError {
  readonly code = 'idempotency_request_in_progress';
  readonly status = 409;

  constructor(idempotencyKey: string) {
    super(`A request with idempotency key ${idempotencyKey} is still in progress.`, {
      idempotencyKey,
    });
  }
}