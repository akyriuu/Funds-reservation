import { Prisma } from '../../generated/prisma/client';

const hasCode = (error: unknown, code: string): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;

export const isUniqueViolation = (error: unknown): boolean => hasCode(error, 'P2002');

export const isForeignKeyViolation = (error: unknown): boolean => hasCode(error, 'P2003');

export const isRecordNotFound = (error: unknown): boolean => hasCode(error, 'P2025');