import { Prisma } from '@prisma/client';

// adapter-pg maps SQLSTATE 40001 to TransactionWriteConflict. For raw SQL,
// Prisma 6 surfaces it as P2010 rather than the model-query P2034 code.
export function isSerializationConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  return error.code === 'P2034' || error.code === 'P2010' &&
    (error.meta?.code === '40001' || error.meta?.code === '40P01' || error.meta?.message === 'Transaction write conflict');
}
