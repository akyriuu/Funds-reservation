import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { LedgerEntryType } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { ListEntriesDto } from './dto/list-entries.dto';

export interface RecordEntryParams { 
    accountId: string;
    holdId?: string;
    type: LedgerEntryType;
    amountCents: bigint;
    balanceAfter: bigint;
    reservedAfter: bigint;
    availableAfter: bigint;
}

@Injectable()
    export class LedgerService { 
        constructor(private readonly prisma: PrismaService) {}

        record(tx: Prisma.TransactionClient, params: RecordEntryParams) {
            return tx.ledgerEntry.create({ data: params })
         }

         list(accountId: string, query: ListEntriesDto) { 
            return this.prisma.ledgerEntry.findMany({
                where: { accountId },
                orderBy: { createdAt: 'desc' },
                take: query.limit,
                ...(query.cursor && { skip: 1, cursor: { id: query.cursor } })
            })
         }
    }