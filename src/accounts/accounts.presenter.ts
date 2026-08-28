import { Account } from '../generated/prisma/client';

export const toAccountResponse = (account: Account) => ({
    id: account.id,
    currency: account.currency,
    balanceCents: Number(account.balanceCents),
    availableCents: Number(account.availableCents),
    reservedCents: Number(account.reservedCents),
    createdAt: account.createdAt.toISOString(),
    updatedAt: account.updatedAt.toISOString(),
});