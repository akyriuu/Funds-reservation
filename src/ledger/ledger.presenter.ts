import { LedgerEntry } from '../generated/prisma/client';

export const toEntryResponse = (entry: LedgerEntry) => ({
    id: entry.id,
    accountId: entry.accountId,
    holdId: entry.holdId,
    type: entry.type,
    amountCents: Number(entry.amountCents),
    balanceAfter: Number(entry.balanceAfter),
    reservedAfter: Number(entry.reservedAfter),
    availableAfter: Number(entry.availableAfter),
    createdAt: entry.createdAt.toISOString(),
})