import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { isSerializationConflict } from '../transaction-conflict.js';
const known = (code: string, meta?: Record<string, unknown>) => new Prisma.PrismaClientKnownRequestError('Sanitized test error', { code, meta, clientVersion: '6.12.0' });
describe('bounded transaction retry classification', () => {
  it.each([known('P2034'), known('P2010', { code: '40001' }), known('P2010', { code: '40P01' }), known('P2010', { code: 'N/A', message: 'Transaction write conflict' })])('recognizes only supported serialization/deadlock forms', error => {
    expect(isSerializationConflict(error)).toBe(true);
  });
  it.each([known('P2010', { code: '23514', message: 'constraint violated' }), known('P2010', { message: 'network timeout' }), known('P2002'), new Error('Transaction write conflict'), null])('does not retry arbitrary failures', error => {
    expect(isSerializationConflict(error)).toBe(false);
  });
});
