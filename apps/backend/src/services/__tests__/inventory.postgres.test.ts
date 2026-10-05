import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { InventoryService } from '../inventory.service.js';

const database = vi.hoisted(() => ({ $transaction: vi.fn() }));
vi.mock('../../lib/prisma.js', () => ({ prisma: database }));
const connectionString = process.env.INVENTORY_TEST_DATABASE_URL;
if (connectionString && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(connectionString).hostname)) throw new Error('Inventory concurrency tests require an explicitly configured local database.');
const schema = `inventory_test_${randomUUID().replaceAll('-', '')}`;
const productId = randomUUID();
const pool = connectionString ? new Pool({ connectionString, max: 4 }) : null;

describe.skipIf(!pool)('Inventory core on isolated local PostgreSQL', () => {
  beforeAll(async () => {
    if (!pool) return;
    await pool.query(`CREATE SCHEMA "${schema}"`);
    await pool.query(`CREATE TABLE "${schema}".inventory ("productId" uuid PRIMARY KEY, quantity integer NOT NULL, "lowStockAt" integer NOT NULL DEFAULT 5, status text NOT NULL)`);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL search_path TO "${schema}"`);
      await client.query(readFileSync('prisma/migrations/20261005000000_inventory_nonnegative/migration.sql', 'utf8'));
      await client.query('COMMIT');
    } finally { client.release(); }
    database.$transaction.mockImplementation(async operation => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SET LOCAL search_path TO "${schema}"`);
        const adapter = {
          $queryRaw: async (sql: { text: string; values: unknown[] }) => (await client.query(sql.text, sql.values)).rows,
          inventory: { update: async ({ where, data }: { where: { productId: string; quantity: number; lowStockAt: number }; data: { quantity: number; status: string } }) =>
            (await client.query('UPDATE inventory SET quantity=$1, status=$2 WHERE "productId"=$3 AND quantity=$4 AND "lowStockAt"=$5 RETURNING quantity,status', [data.quantity, data.status, where.productId, where.quantity, where.lowStockAt])).rows[0] },
        };
        const result = await operation(adapter);
        await client.query('COMMIT');
        return result;
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    });
  });
  afterAll(async () => {
    if (pool) { await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await pool.end(); }
  });
  it('runs the migration constraints against real PostgreSQL', async () => {
    await expect(pool!.query(`INSERT INTO "${schema}".inventory VALUES ($1,-1,5,'OUT_OF_STOCK')`, [productId])).rejects.toMatchObject({ code: '23514' });
    await expect(pool!.query(`INSERT INTO "${schema}".inventory VALUES ($1,1,-1,'IN_STOCK')`, [productId])).rejects.toMatchObject({ code: '23514' });
  });
  it('serializes concurrent decrements of the last unit with no underflow', async () => {
    await pool!.query(`INSERT INTO "${schema}".inventory VALUES ($1,1,5,'LOW_STOCK')`, [productId]);
    const service = new InventoryService();
    const results = await Promise.allSettled([service.decreaseStock(productId, 1), service.decreaseStock(productId, 1)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect((await pool!.query(`SELECT quantity,status FROM "${schema}".inventory WHERE "productId"=$1`, [productId])).rows[0]).toEqual({ quantity: 0, status: 'OUT_OF_STOCK' });
  });
});
