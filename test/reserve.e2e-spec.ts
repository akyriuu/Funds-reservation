import { InsufficientFundsError } from '../src/holds/holds.errors';
import { createContext, fundedAccount, reset, TestContext } from './setup/context';
import { expectInvariants } from './setup/invariants';

describe('reserve under concurrency', () => {
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

  it('approves exactly one of two competing reservations', async () => {
    const accountId = await fundedAccount(ctx, 100_000);

    const results = await Promise.allSettled([
      ctx.holds.reserve({ accountId, amountCents: 80_000, idempotencyKey: 'req-a' }),
      ctx.holds.reserve({ accountId, amountCents: 80_000, idempotencyKey: 'req-b' }),
    ]);

    const approved = results.filter((result) => result.status === 'fulfilled');
    const denied = results.filter((result) => result.status === 'rejected');

    expect(approved).toHaveLength(1);
    expect(denied).toHaveLength(1);
    expect((denied[0] as PromiseRejectedResult).reason).toBeInstanceOf(InsufficientFundsError);

    const account = await ctx.prisma.account.findUniqueOrThrow({ where: { id: accountId } });

    expect(account.balanceCents).toBe(100_000n);
    expect(account.reservedCents).toBe(80_000n);
    expect(account.availableCents).toBe(20_000n);

    await expectInvariants(ctx.prisma, accountId);
  });

  it('approves exactly ten of fifty competing reservations', async () => {
    const accountId = await fundedAccount(ctx, 10_000);

    const results = await Promise.allSettled(
      Array.from({ length: 50 }, (_, index) =>
        ctx.holds.reserve({
          accountId,
          amountCents: 1_000,
          idempotencyKey: `bulk-${index}`,
        }),
      ),
    );

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(10);

    const account = await ctx.prisma.account.findUniqueOrThrow({ where: { id: accountId } });

    expect(account.availableCents).toBe(0n);
    expect(account.reservedCents).toBe(10_000n);

    await expectInvariants(ctx.prisma, accountId);
  });

  it('replays an identical request without moving funds twice', async () => {
    const accountId = await fundedAccount(ctx, 100_000);
    const command = { accountId, amountCents: 30_000, idempotencyKey: 'replay-me' };

    const [first, second] = await Promise.all([
      ctx.holds.reserve(command),
      ctx.holds.reserve(command),
    ]);

    expect(second.id).toBe(first.id);
    expect(await ctx.prisma.hold.count({ where: { accountId } })).toBe(1);

    const account = await ctx.prisma.account.findUniqueOrThrow({ where: { id: accountId } });

    expect(account.reservedCents).toBe(30_000n);
    expect(account.availableCents).toBe(70_000n);
  });
});