import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { createHash } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { isUniqueViolation } from '../prisma/prisma-errors';
import {
  IdempotencyPayloadMismatchError,
  IdempotencyRequestInProgressError,
} from './idempotency.errors';

const PENDING_STATUS = 0;
const ABANDONED_CLAIM_MS = 60_000;
const RETENTION_MS = 24 * 60 * 60 * 1000;

export interface IdempotentRequest {
  key: string;
  endpoint: string;
  body: unknown;
}

export interface StoredResponse {
  status: number;
  body: unknown;
}

@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  async claim(request: IdempotentRequest): Promise<StoredResponse | null> {
    const requestHash = this.hash(request.body);

    try {
      await this.prisma.idempotencyRecord.create({
        data: {
          key: request.key,
          endpoint: request.endpoint,
          requestHash,
          responseStatus: PENDING_STATUS,
          responseBody: {},
        },
      });

      return null;
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
    }

    return this.resolve(request, requestHash);
  }

  async complete(request: IdempotentRequest, response: StoredResponse): Promise<void> {
    await this.prisma.idempotencyRecord.update({
      where: { key_endpoint: { key: request.key, endpoint: request.endpoint } },
      data: {
        responseStatus: response.status,
        responseBody: response.body as Prisma.InputJsonValue,
      },
    });
  }

  async discard(request: IdempotentRequest): Promise<void> {
    await this.prisma.idempotencyRecord.deleteMany({
      where: {
        key: request.key,
        endpoint: request.endpoint,
        responseStatus: PENDING_STATUS,
      },
    });
  }

  @Cron(CronExpression.EVERY_HOUR)
  async purge(): Promise<void> {
    await this.prisma.idempotencyRecord.deleteMany({
      where: { createdAt: { lt: new Date(Date.now() - RETENTION_MS) } },
    });
  }

  private hash(body: unknown): string {
    return createHash('sha256').update(JSON.stringify(body ?? {})).digest('hex');
  }

  private async resolve(
    request: IdempotentRequest,
    requestHash: string,
  ): Promise<StoredResponse | null> {
    const record = await this.prisma.idempotencyRecord.findUniqueOrThrow({
      where: { key_endpoint: { key: request.key, endpoint: request.endpoint } },
    });

    if (record.requestHash !== requestHash) {
      throw new IdempotencyPayloadMismatchError(request.key);
    }

    if (record.responseStatus !== PENDING_STATUS) {
      return { status: record.responseStatus, body: record.responseBody };
    }

    return this.takeOver(record.id, request.key);
  }

  private async takeOver(id: string, key: string): Promise<null> {
    const abandonedBefore = new Date(Date.now() - ABANDONED_CLAIM_MS);

    const takenOver = await this.prisma.idempotencyRecord.updateMany({
      where: {
        id,
        responseStatus: PENDING_STATUS,
        createdAt: { lt: abandonedBefore },
      },
      data: { createdAt: new Date() },
    });

    if (takenOver.count === 0) {
      throw new IdempotencyRequestInProgressError(key);
    }

    return null;
  }
}