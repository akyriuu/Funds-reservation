import { HoldStatus, LedgerEntryType } from '../src/generated/prisma/enums';
import { HoldExpiredError } from '../src/holds/holds.errors';
import { createContext, fundedAccount, reset, TestContext } from './setup/context';
import { expectInvariants } from './setup/invariants';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('expiration', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createContext();
  });

  afterAll(async () => {
    await ctx?.app.close();
  });

  beforeEach(async () => {
    await reset(ctx.prisma);
  });

  it('rejects capture of a due hold before the worker sweeps', async () => {
    const accountId = await fundedAccount(ctx, 100_000);
    const hold = await ctx.holds.reserve({
      accountId,
      amountCents: 30_000,
      expiresInSeconds: 1,
      idempotencyKey: 'logical-expiry',
    });

    await wait(1_500);

    await expect(ctx.holds.capture(hold.id)).rejects.toBeInstanceOf(HoldExpiredError);

    const untouched = await ctx.prisma.hold.findUniqueOrThrow({ where: { id: hold.id } });

    expect(untouched.status).toBe(HoldStatus.PENDING);

    const account = await ctx.prisma.account.findUniqueOrThrow({ where: { id: accountId } });

    expect(account.reservedCents).toBe(30_000n);
  });

  it('releases reserved funds when the worker sweeps', async () => {
    const accountId = await fundedAccount(ctx, 100_000);
    await ctx.holds.reserve({
      accountId,
      amountCents: 30_000,
      expiresInSeconds: 1,
      idempotencyKey: 'sweep',
    });

    await wait(1_500);

    expect(await ctx.expiration.expireDue()).toBe(1);

    const account = await ctx.prisma.account.findUniqueOrThrow({ where: { id: accountId } });

    expect(account.availableCents).toBe(100_000n);
    expect(account.reservedCents).toBe(0n);

    await expectInvariants(ctx.prisma, accountId);
  });

  it('expires each hold once across concurrent sweeps', async () => {
    const accountId = await fundedAccount(ctx, 100_000);

    for (let index = 0; index < 5; index += 1) {
      await ctx.holds.reserve({
        accountId,
        amountCents: 10_000,
        expiresInSeconds: 1,
        idempotencyKey: `sweep-${index}`,
      });
    }

    await wait(1_500);

    const sweeps = await Promise.all([
      ctx.expiration.expireDue(),
      ctx.expiration.expireDue(),
      ctx.expiration.expireDue(),
    ]);

    expect(sweeps.reduce((total, count) => total + count, 0)).toBe(5);

    const entries = await ctx.prisma.ledgerEntry.count({
      where: { accountId, type: LedgerEntryType.HOLD_EXPIRED },
    });

    expect(entries).toBe(5);

    const account = await ctx.prisma.account.findUniqueOrThrow({ where: { id: accountId } });

    expect(account.availableCents).toBe(100_000n);
    await expectInvariants(ctx.prisma, accountId);
  });
});