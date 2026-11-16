/**
 * Optional application pool ceiling for the Prisma pg adapter. Unset keeps the existing defaults.
 * Invalid values fail closed (throw) rather than silently falling back to a larger pool.
 */
export const DB_POOL_MAX_LIMIT = 10;

export function resolveDbPoolMax(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  const text = raw.trim();
  const value = /^\d+$/.test(text) ? Number(text) : Number.NaN;
  if (!Number.isInteger(value) || value < 1 || value > DB_POOL_MAX_LIMIT) {
    throw new Error(`DB_POOL_MAX must be an integer from 1 to ${DB_POOL_MAX_LIMIT}`);
  }
  return value;
}
