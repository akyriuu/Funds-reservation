import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '../generated/prisma/client';
import { HoldStatus, LedgerEntryType } from '../generated/prisma/enums';
import { LedgerService } from '../ledger/ledger.service';
import { PrismaService } from '../prisma/prisma.service';

const BATCH_TRANSACTION_TIMEOUT_MS = 30_000;

@Injectable()
export class HoldsExpiration { 
    private readonly logger = new Logger(HoldsExpiration.name)
    private readonly batchSize: number;
    private readonly enabled: boolean;

    constructor(
        private readonly prisma: PrismaService,
        private readonly ledger: LedgerService,
        config: ConfigService,
    ) { 
        this.batchSize = Number(config.get<string>('HOLD_EXPIRATION_BATCH_SIZE') ?? 100);
        this.enabled = config.get<string>('HOLD_EXPIRATION_ENABLED') !== 'false';
    }

    @Cron(CronExpression.EVERY_10_SECONDS)
    async handleSchedule(): Promise<void> { 
        if(!this.enabled) {
            return;
        }

        const expired = await this.expireDue();

        if (expired > 0) { 
            this.logger.log(`Released ${expired} expired holds.`);
        }
    }

    async expireDue(): Promise<number> { 
        let total = 0;
        let claimed = 0;


        do { 
            claimed = await this.expireBatch();
            total += claimed;
        } while (claimed === this.batchSize);

        return total;
    }

    private expireBatch(): Promise<number> {
        return this.prisma.$transaction(
            async (tx) => { 
                const due = await tx.$queryRaw<{ id: string }[]>`
                SELECT "id"
                FROM "Hold"
                WHERE "status" = 'PENDING'
                AND "expiresAt" < now()
                ORDER BY "expiresAt"
                LIMIT ${this.batchSize}
                FOR UPDATE SKIP LOCKED;
                `;

                for (const { id } of due) { 
                    await this.settle(tx, id);
                }

                return due.length;
            },
            { timeout: BATCH_TRANSACTION_TIMEOUT_MS },
        )
    }

    private async settle(tx: Prisma.TransactionClient, id: string): Promise<void> { 
        const hold = await tx.hold.update({
            where: { id, status: HoldStatus.PENDING },
            data: { status: HoldStatus.EXPIRED, settledAt: new Date() },
        });


        const account = await tx.account.update({
            where: { id: hold.accountId },
            data: { 
                reservedCents: { decrement: hold.amountCents },
                availableCents: { increment: hold.amountCents },
            },
        });

        await this.ledger.record(tx, { 
            accountId: account.id,
            holdId: hold.id,
            type: LedgerEntryType.HOLD_EXPIRED,
            amountCents: hold.amountCents,
            balanceAfter: account.balanceCents,
            reservedAfter: account.reservedCents,
            availableAfter: account.availableCents,
        })
    }
}