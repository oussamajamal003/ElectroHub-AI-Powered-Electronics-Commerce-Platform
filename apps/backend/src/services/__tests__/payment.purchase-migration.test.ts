import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
const sql = readFileSync(resolve('prisma/migrations/20261012120000_payment_purchase_ownership/migration.sql'), 'utf8');
const schema = readFileSync(resolve('prisma/schema.prisma'), 'utf8');
it('prepares additive nullable ownership columns without rewriting historical attempts or selecting work', () => {
  expect(sql).not.toMatch(/\b(DROP|DELETE|TRUNCATE|UPDATE|INSERT)\b/i);
  expect(sql).not.toMatch(/SELECT.*payment_work/is);
  for (const name of ['submittedAt', 'restoredAt', 'notificationReadState', 'sourceCartItemId', 'snapshotCartItemId']) {
    expect(sql).toContain(`ADD COLUMN "${name}"`);
    expect(schema).toContain(name);
  }
  expect(sql).not.toMatch(/ADD COLUMN[^;]*NOT NULL/is);
});
it('enforces one submitted owner per cart-line generation and releases the cart-wide claim', () => {
  expect(sql).toContain('CREATE UNIQUE INDEX "payment_attempt_items_sourceCartItemId_key"');
  expect(schema).toMatch(/sourceCartItemId String\? @unique @db.Uuid/);
  expect(sql).toContain('CHECK ("submittedAt" IS NULL OR "activeCartId" IS NULL)');
});
