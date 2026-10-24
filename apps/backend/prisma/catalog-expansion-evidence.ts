import type { PrismaClient } from '@prisma/client';

/** Evidence contains opaque identifiers and server-side row digests, never row contents. */
export type ExpansionDatabaseSnapshot = Record<string, Array<{ id: string | null; digest: string }>>;
export type ExpansionManagedRows = Partial<Record<'products' | 'product_images' | 'product_specifications', readonly string[]>>;
const additiveTables = new Set(['categories', 'brands', 'products', 'product_images', 'product_specifications', 'inventory']);

export async function captureCatalogExpansionSnapshot(client: PrismaClient): Promise<ExpansionDatabaseSnapshot> {
  // One repeatable-read, read-only snapshot avoids an internally inconsistent multi-table witness.
  return client.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const tables = await tx.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename::text AS tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public' ORDER BY tablename
    `;
    const result: ExpansionDatabaseSnapshot = {};
    for (const { tablename } of tables) {
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tablename)) throw new Error('Unexpected public table identifier.');
      result[tablename] = await tx.$queryRawUnsafe<Array<{ id: string | null; digest: string }>>(
        `SELECT to_jsonb(t)->>'id' AS id, md5(to_jsonb(t)::text) AS digest FROM public."${tablename}" t ORDER BY id NULLS FIRST, digest`,
      );
    }
    return result;
  }, { isolationLevel: 'RepeatableRead', maxWait: 5000, timeout: 120000 });
}

export function assertCatalogExpansionUnchanged(before: ExpansionDatabaseSnapshot, after: ExpansionDatabaseSnapshot): void {
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    throw new Error('Catalog expansion witness found database changes during a read-only or repeat operation.');
  }
}

export function assertCatalogExpansionPreserved(before: ExpansionDatabaseSnapshot, after: ExpansionDatabaseSnapshot,
  managedRows: ExpansionManagedRows = {}): void {
  if (JSON.stringify(Object.keys(before)) !== JSON.stringify(Object.keys(after))) {
    throw new Error('Catalog expansion changed the public table inventory.');
  }
  for (const [table, previousRows] of Object.entries(before)) {
    const nextRows = after[table];
    if (!additiveTables.has(table)) {
      if (JSON.stringify(previousRows) !== JSON.stringify(nextRows)) {
        throw new Error(`Catalog expansion changed unrelated table: ${table}.`);
      }
      continue;
    }
    // Catalog tables all have UUID primary keys. Refuse ambiguous evidence instead of assuming it.
    if (previousRows.some(row => !row.id) || nextRows.some(row => !row.id) ||
        new Set(nextRows.map(row => row.id)).size !== nextRows.length) {
      throw new Error(`Catalog expansion cannot establish row identity: ${table}.`);
    }
    const nextById = new Map(nextRows.map(row => [row.id, row.digest]));
    const mutableIds = new Set(Object.entries(managedRows).find(([name]) => name === table)?.[1] ?? []);
    if (previousRows.some(row => !nextById.has(row.id) ||
        (!(row.id !== null && mutableIds.has(row.id)) && nextById.get(row.id) !== row.digest))) {
      throw new Error(`Catalog expansion changed or removed a preexisting row: ${table}.`);
    }
  }
}
