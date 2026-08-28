import { createContext, fundedAccount, reset, TestContext } from './setup/context';
import { expectInvariants } from './setup/invariants';

describe('settlement under concurrency', () => {
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

  it('captures at most once under ten concurrent attempts', async () => {
    const accountId = await fundedAccount(ctx, 100_000);
    const hold = await ctx.holds.reserve({
      accountId,
      amountCents: 40_000,
      idempotencyKey: 'capture-race',
    });

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => ctx.holds.capture(hold.id)),
    );

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);

    const account = await ctx.prisma.account.findUniqueOrThrow({ where: { id: accountId } });

    expect(account.balanceCents).toBe(60_000n);
    expect(account.reservedCents).toBe(0n);
    expect(account.availableCents).toBe(60_000n);

    await expectInvariants(ctx.prisma, accountId);
  });

  it('lets exactly one of capture and release win', async () => {
    const accountId = await fundedAccount(ctx, 100_000);
    const hold = await ctx.holds.reserve({
      accountId,
      amountCents: 40_000,
      idempotencyKey: 'settle-race',
    });

    const results = await Promise.allSettled([
      ctx.holds.capture(hold.id),
      ctx.holds.release(hold.id),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);

    const settled = await ctx.prisma.hold.findUniqueOrThrow({ where: { id: hold.id } });

    expect(settled.status).not.toBe('PENDING');
    await expectInvariants(ctx.prisma, accountId);
  });

  it('returns the remainder on partial capture', async () => {
    const accountId = await fundedAccount(ctx, 100_000);
    const hold = await ctx.holds.reserve({
      accountId,
      amountCents: 40_000,
      idempotencyKey: 'partial',
    });

    await ctx.holds.capture(hold.id, 25_000);

    const account = await ctx.prisma.account.findUniqueOrThrow({ where: { id: accountId } });

    expect(account.balanceCents).toBe(75_000n);
    expect(account.reservedCents).toBe(0n);
    expect(account.availableCents).toBe(75_000n);

    await expectInvariants(ctx.prisma, accountId);
  });
});