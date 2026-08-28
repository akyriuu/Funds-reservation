import { Hold } from '../generated/prisma/client';

export const toHoldResponse = (hold: Hold) => ({
  id: hold.id,
  accountId: hold.accountId,
  status: hold.status,
  amountCents: Number(hold.amountCents),
  capturedCents: Number(hold.capturedCents),
  idempotencyKey: hold.idempotencyKey,
  expiresAt: hold.expiresAt.toISOString(),
  createdAt: hold.createdAt.toISOString(),
  settledAt: hold.settledAt?.toISOString() ?? null,
});