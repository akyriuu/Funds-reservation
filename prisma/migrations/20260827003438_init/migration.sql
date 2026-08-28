-- CreateEnum
CREATE TYPE "HoldStatus" AS ENUM ('PENDING', 'CAPTURED', 'RELEASED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('DEPOSIT', 'HOLD_RESERVED', 'HOLD_CAPTURED', 'HOLD_RELEASED', 'HOLD_EXPIRED');

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "balanceCents" BIGINT NOT NULL DEFAULT 0,
    "reservedCents" BIGINT NOT NULL DEFAULT 0,
    "availableCents" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Hold" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "amountCents" BIGINT NOT NULL,
    "capturedCents" BIGINT NOT NULL DEFAULT 0,
    "status" "HoldStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "Hold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "holdId" TEXT,
    "type" "LedgerEntryType" NOT NULL,
    "amountCents" BIGINT NOT NULL,
    "balanceAfter" BIGINT NOT NULL,
    "reservedAfter" BIGINT NOT NULL,
    "availableAfter" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "responseStatus" INTEGER NOT NULL,
    "responseBody" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Account_currency_idx" ON "Account"("currency");

-- CreateIndex
CREATE UNIQUE INDEX "Hold_idempotencyKey_key" ON "Hold"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Hold_accountId_status_idx" ON "Hold"("accountId", "status");

-- CreateIndex
CREATE INDEX "Hold_status_expiresAt_idx" ON "Hold"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "LedgerEntry_accountId_createdAt_idx" ON "LedgerEntry"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "LedgerEntry_holdId_idx" ON "LedgerEntry"("holdId");

-- CreateIndex
CREATE INDEX "IdempotencyRecord_createdAt_idx" ON "IdempotencyRecord"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyRecord_key_endpoint_key" ON "IdempotencyRecord"("key", "endpoint");

-- AddForeignKey
ALTER TABLE "Hold" ADD CONSTRAINT "Hold_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_holdId_fkey" FOREIGN KEY ("holdId") REFERENCES "Hold"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Invariantes de saldo: última linha de defesa no banco.
ALTER TABLE "Account"
  ADD CONSTRAINT "account_available_non_negative" CHECK ("availableCents" >= 0),
  ADD CONSTRAINT "account_reserved_non_negative"  CHECK ("reservedCents"  >= 0),
  ADD CONSTRAINT "account_balance_non_negative"   CHECK ("balanceCents"   >= 0),
  ADD CONSTRAINT "account_balance_consistent"
    CHECK ("balanceCents" = "availableCents" + "reservedCents");

-- Invariantes do hold.
ALTER TABLE "Hold"
  ADD CONSTRAINT "hold_amount_positive"      CHECK ("amountCents" > 0),
  ADD CONSTRAINT "hold_captured_in_range"    CHECK ("capturedCents" >= 0 AND "capturedCents" <= "amountCents"),
  ADD CONSTRAINT "hold_captured_only_when_settled"
    CHECK (("status" = 'CAPTURED') OR ("capturedCents" = 0));

-- Varredura do expirador: índice parcial só sobre holds vivos.
CREATE INDEX "hold_pending_expires_at_idx"
  ON "Hold" ("expiresAt")
  WHERE "status" = 'PENDING';