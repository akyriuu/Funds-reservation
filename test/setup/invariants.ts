import { HoldStatus } from '../../src/generated/prisma/enums';
import { PrismaService } from '../../src/prisma/prisma.service';

export async function expectInvariants(
  prisma: PrismaService,
  accountId: string,
): Promise<void> {
  const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });

  expect(account.balanceCents).toBe(account.availableCents + account.reservedCents);
  expect(account.availableCents >= 0n).toBe(true);
  expect(account.reservedCents >= 0n).toBe(true);

  const pending = await prisma.hold.aggregate({
    where: { accountId, status: HoldStatus.PENDING },
    _sum: { amountCents: true },
  });

  expect(account.reservedCents).toBe(pending._sum.amountCents ?? 0n);
}