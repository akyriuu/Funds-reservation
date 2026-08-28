import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AccountsService } from '../../src/accounts/accounts.service';
import { AppModule } from '../../src/app.module';
import { HoldsExpiration } from '../../src/holds/holds-expiration.service';
import { HoldsService } from '../../src/holds/holds.service';
import { PrismaService } from '../../src/prisma/prisma.service';

export interface TestContext {
  app: INestApplication;
  prisma: PrismaService;
  accounts: AccountsService;
  holds: HoldsService;
  expiration: HoldsExpiration;
}

export async function createContext(): Promise<TestContext> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

  const app = moduleRef.createNestApplication();
  await app.init();

  return {
    app,
    prisma: app.get(PrismaService),
    accounts: app.get(AccountsService),
    holds: app.get(HoldsService),
    expiration: app.get(HoldsExpiration),
  };
}

export async function reset(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "LedgerEntry", "Hold", "IdempotencyRecord", "Account" RESTART IDENTITY CASCADE',
  );
}

export async function fundedAccount(ctx: TestContext, amountCents: number): Promise<string> {
  const account = await ctx.accounts.create({ currency: 'BRL' });
  await ctx.accounts.credit(account.id, { amountCents });

  return account.id;
}