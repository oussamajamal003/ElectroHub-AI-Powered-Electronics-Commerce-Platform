/**
 * Task 03.8 migration verifier rules (pure; no database). The physical expectations live in scripts/lib/commerce-email-schema.cjs;
 * a real-PostgreSQL run of the same rules is in commerce-email-migration-verify.postgres.integration.test.ts.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

interface Physical { tables: { name: string; rls: boolean }[]; constraints: Record<string, unknown>[]; indexes: Record<string, unknown>[];
  triggers: Record<string, unknown>[]; enums: { name: string; labels: string }[]; exposure: { role: string; table: string; privileges: boolean }[] }
const schema = createRequire(path.join(process.cwd(), 'package.json'))('./scripts/lib/commerce-email-schema.cjs') as {
  CONSTRAINTS: Record<string, { type: string; table: string; tokens: string[]; references?: string; onDelete?: string }>;
  INDEXES: Record<string, { unique: boolean; contains: string }>;
  TRIGGERS: Record<string, { table: string; fn: string; markers: string[] }>;
  ENUMS: Record<string, string>;
  physicalFailures(physical: Physical | null): string[];
  verifyFailures(state: unknown, migration: string, checksum: string): string[];
};

/** A physical readback that satisfies every expectation, built from the contract itself. */
function good(): Physical {
  return {
    tables: [{ name: 'commerce_email_attempts', rls: true }, { name: 'commerce_email_outbox', rls: true }],
    constraints: Object.entries(schema.CONSTRAINTS).map(([name, spec]) => ({ name, type: spec.type, table: spec.table, references: spec.references ?? null,
      onDelete: spec.onDelete ?? 'a', definition: spec.tokens.join(' '), validated: true })),
    indexes: Object.entries(schema.INDEXES).map(([name, spec]) => ({ name, definition: spec.contains, unique: spec.unique, valid: true })),
    triggers: Object.entries(schema.TRIGGERS).map(([name, spec]) => ({ name, table: spec.table, fn: spec.fn, type: 19, enabled: 'O', body: spec.markers.join(' ') })),
    enums: Object.entries(schema.ENUMS).map(([name, labels]) => ({ name, labels })),
    exposure: ['anon', 'authenticated'].flatMap(role => ['commerce_email_outbox', 'commerce_email_attempts'].map(table => ({ role, table, privileges: false }))),
  };
}
const without = <T extends { name: string }>(rows: T[], name: string) => rows.filter(row => row.name !== name);

describe('Task 03.8 migration verifier rules', () => {
  it('accepts the complete expected physical schema', () => {
    expect(schema.physicalFailures(good())).toEqual([]);
  });
  it('fails when the schema is absent', () => {
    expect(schema.physicalFailures(null)).toEqual(['schema:commerce-tables-missing']);
  });
  it('fails for a missing table, disabled RLS, or a changed enum', () => {
    const noTable = good(); noTable.tables = without(noTable.tables, 'commerce_email_outbox');
    expect(schema.physicalFailures(noTable)).toContain('schema:table-missing:commerce_email_outbox');
    const noRls = good(); noRls.tables[0]!.rls = false;
    expect(schema.physicalFailures(noRls)).toContain('schema:rls-disabled:commerce_email_attempts');
    const enumDrift = good(); enumDrift.enums[0] = { name: enumDrift.enums[0]!.name, labels: 'READY' };
    expect(schema.physicalFailures(enumDrift).some(code => code.startsWith('schema:enum-members-differ:'))).toBe(true);
    const noEnum = good(); noEnum.enums = [];
    expect(schema.physicalFailures(noEnum).filter(code => code.startsWith('schema:enum-missing:'))).toHaveLength(4);
  });
  it('fails per missing, replaced or weakened constraint, index and trigger (a matching count cannot hide it)', () => {
    const constraint = good(); constraint.constraints = without(constraint.constraints as { name: string }[], 'commerce_email_outbox_lease_check');
    constraint.constraints.push({ name: 'unrelated_extra_check', type: 'c', table: 'commerce_email_outbox', definition: 'true', validated: true });
    expect(schema.physicalFailures(constraint)).toContain('schema:constraint-missing:commerce_email_outbox_lease_check');
    const weak = good(); (weak.constraints.find(row => row.name === 'commerce_email_outbox_payload_check') as { definition: string }).definition = 'CHECK (true)';
    expect(schema.physicalFailures(weak)).toContain('schema:constraint-definition-differs:commerce_email_outbox_payload_check');
    const fk = good(); (fk.constraints.find(row => row.name === 'commerce_email_outbox_orderId_fkey') as { onDelete: string }).onDelete = 'c';
    expect(schema.physicalFailures(fk)).toContain('schema:foreign-key-differs:commerce_email_outbox_orderId_fkey');
    const unvalidated = good(); (unvalidated.constraints[0] as { validated: boolean }).validated = false;
    expect(schema.physicalFailures(unvalidated).some(code => code.startsWith('schema:constraint-not-validated:'))).toBe(true);
    const index = good(); index.indexes = without(index.indexes as { name: string }[], 'commerce_email_outbox_dispatchState_leaseUntil_idx');
    expect(schema.physicalFailures(index)).toContain('schema:index-missing:commerce_email_outbox_dispatchState_leaseUntil_idx');
    const notUnique = good(); (notUnique.indexes.find(row => row.name === 'commerce_email_outbox_eventKey_key') as { unique: boolean }).unique = false;
    expect(schema.physicalFailures(notUnique)).toContain('schema:index-differs:commerce_email_outbox_eventKey_key');
    const trigger = good(); trigger.triggers = without(trigger.triggers as { name: string }[], 'commerce_email_attempts_guard');
    expect(schema.physicalFailures(trigger)).toContain('schema:trigger-missing:commerce_email_attempts_guard');
    const noop = good(); (noop.triggers[0] as { body: string }).body = 'BEGIN RETURN NEW; END';
    expect(schema.physicalFailures(noop).some(code => code.startsWith('schema:trigger-function-differs:'))).toBe(true);
    const disabled = good(); (disabled.triggers[0] as { enabled: string }).enabled = 'D';
    expect(schema.physicalFailures(disabled).some(code => code.startsWith('schema:trigger-disabled:'))).toBe(true);
  });
  it('fails when a browser role has any privilege on a commerce table', () => {
    const exposed = good(); exposed.exposure[1]!.privileges = true;
    expect(schema.physicalFailures(exposed)).toEqual([`schema:browser-role-privilege:${exposed.exposure[1]!.role}:${exposed.exposure[1]!.table}`]);
  });

  describe('verify requires the migration to be applied (preflight does not use these rules)', () => {
    const checksum = 'a'.repeat(64);
    const applied = { checksum, finished_at: new Date(), rolled_back_at: null };
    const state = (overrides: Record<string, unknown> = {}) => ({ ours: [applied], pending: [], physical: good(), nonCommerceDrift: { statementCount: 5, commerceStatements: 0 }, ...overrides });
    it('accepts an applied, finished, exact-checksum migration with a correct schema', () => {
      expect(schema.verifyFailures(state(), 'm', checksum)).toEqual([]);
    });
    it('fails when the migration is not applied, duplicated, unfinished, rolled back, mismatched, or still pending', () => {
      expect(schema.verifyFailures(state({ ours: [], pending: ['m'], physical: null }), 'm', checksum))
        .toEqual(expect.arrayContaining(['ledger:new-migration-not-applied', 'ledger:pending-migrations:m', 'schema:commerce-tables-missing']));
      expect(schema.verifyFailures(state({ ours: [applied, applied] }), 'm', checksum)).toContain('ledger:duplicate-new-migration-rows');
      expect(schema.verifyFailures(state({ ours: [{ ...applied, finished_at: null }] }), 'm', checksum)).toContain('ledger:new-migration-unfinished-or-rolled-back');
      expect(schema.verifyFailures(state({ ours: [{ ...applied, rolled_back_at: new Date() }] }), 'm', checksum)).toContain('ledger:new-migration-unfinished-or-rolled-back');
      expect(schema.verifyFailures(state({ ours: [{ ...applied, checksum: 'b'.repeat(64) }] }), 'm', checksum)).toContain('ledger:new-migration-checksum-mismatch');
    });
    it('fails on commerce Prisma drift or an unavailable diff, and ignores non-commerce documented drift', () => {
      expect(schema.verifyFailures(state({ nonCommerceDrift: { statementCount: 6, commerceStatements: 1 } }), 'm', checksum)).toContain('drift:commerce-schema-differs:1');
      expect(schema.verifyFailures(state({ nonCommerceDrift: { error: 'x' } }), 'm', checksum)).toContain('drift:diff-unavailable');
    });
  });
});
