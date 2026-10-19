'use strict';
/*
 * Task 03.8 physical schema contract for 20261018000000_commerce_email_outbox, shared by scripts/commerce-email-migration.cjs
 * (verify and deploy postflight). Pure except readPhysical(), which only runs SELECTs through the caller's query function.
 *
 * It checks named objects and the essential content of their definitions (not just object counts), so a replaced, weakened or
 * missing constraint, index, trigger, trigger function, enum, RLS flag or role privilege fails with a safe, specific code.
 * Failure codes contain object names only: never credentials, row data, recipients or SQL text.
 */
const OUTBOX = 'commerce_email_outbox';
const ATTEMPTS = 'commerce_email_attempts';
const TABLES = [ATTEMPTS, OUTBOX];

const ENUMS = {
  CommerceEmailType: 'ORDER_CONFIRMED,PAYMENT_CONFIRMED,ORDER_PREPARING,ORDER_OUT_FOR_DELIVERY,ORDER_DELIVERED,ORDER_CANCELLED,PAYMENT_REFUNDED',
  CommerceEmailDispatchState: 'READY,LEASED,RETRY_WAIT,ACCEPTED,UNCERTAIN,FAILED,SUPPRESSED',
  CommerceEmailDeliveryState: 'UNKNOWN,DELIVERED,BOUNCED,BLOCKED',
  CommerceEmailAttemptOutcome: 'STARTED,ACCEPTED,REJECTED,UNCERTAIN',
};

/** name -> { type: pg_constraint.contype, table, tokens: substrings required in pg_get_constraintdef, table/delete for foreign keys } */
const CONSTRAINTS = {
  commerce_email_outbox_pkey: { type: 'p', table: OUTBOX, tokens: ['PRIMARY KEY (id)'] },
  commerce_email_attempts_pkey: { type: 'p', table: ATTEMPTS, tokens: ['PRIMARY KEY (id)'] },
  commerce_email_outbox_orderId_fkey: { type: 'f', table: OUTBOX, references: 'orders', onDelete: 'r', tokens: ['"orderId"'] },
  commerce_email_outbox_paymentId_fkey: { type: 'f', table: OUTBOX, references: 'payments', onDelete: 'r', tokens: ['"paymentId"'] },
  commerce_email_outbox_userId_fkey: { type: 'f', table: OUTBOX, references: 'users', onDelete: 'n', tokens: ['"userId"'] },
  commerce_email_attempts_outboxId_fkey: { type: 'f', table: ATTEMPTS, references: OUTBOX, onDelete: 'r', tokens: ['"outboxId"'] },
  commerce_email_outbox_counters_check: { type: 'c', table: OUTBOX, tokens: ['attemptCount', 'snapshotVersion', 'eventKey', "'CAPTURE'", "'BREVO'"] },
  commerce_email_outbox_lease_check: { type: 'c', table: OUTBOX, tokens: ['LEASED', 'leaseToken', 'leaseUntil'] },
  commerce_email_outbox_outcome_check: { type: 'c', table: OUTBOX, tokens: ['ACCEPTED', 'providerMessageId', 'acceptedAt', 'failedAt', 'uncertainAt'] },
  commerce_email_outbox_delivery_check: { type: 'c', table: OUTBOX, tokens: ['deliveryState', 'deliveredAt', 'UNCERTAIN'] },
  commerce_email_outbox_payment_check: { type: 'c', table: OUTBOX, tokens: ['PAYMENT_CONFIRMED', 'PAYMENT_REFUNDED', 'paymentId'] },
  commerce_email_outbox_transition_check: { type: 'c', table: OUTBOX, tokens: ['transitionId', 'ORDER_PREPARING', 'OUT_FOR_DELIVERY', 'ORDER_CANCELLED'] },
  commerce_email_outbox_payload_check: { type: 'c', table: OUTBOX, tokens: ['SUPPRESSED', 'suppressionReason', 'payloadPurgedAt', 'recipient', 'snapshot', '262144'] },
  commerce_email_attempts_state_check: { type: 'c', table: ATTEMPTS, tokens: ['attemptNumber', 'httpStatus', 'STARTED', 'finishedAt', 'providerMessageId'] },
};

/** name -> substring that pg_get_indexdef must contain (uniqueness is asserted separately). */
const INDEXES = {
  commerce_email_outbox_pkey: { unique: true, contains: '(id)' },
  commerce_email_attempts_pkey: { unique: true, contains: '(id)' },
  commerce_email_outbox_eventKey_key: { unique: true, contains: '("eventKey")' },
  commerce_email_outbox_providerMessageId_key: { unique: true, contains: '("providerMessageId")' },
  commerce_email_outbox_dispatchState_nextAttemptAt_createdAt_idx: { unique: false, contains: '("dispatchState", "nextAttemptAt", "createdAt")' },
  commerce_email_outbox_dispatchState_leaseUntil_idx: { unique: false, contains: '("dispatchState", "leaseUntil")' },
  commerce_email_outbox_orderId_createdAt_idx: { unique: false, contains: '("orderId", "createdAt")' },
  commerce_email_outbox_paymentId_idx: { unique: false, contains: '("paymentId")' },
  commerce_email_outbox_userId_idx: { unique: false, contains: '("userId")' },
  commerce_email_attempts_outboxId_startedAt_idx: { unique: false, contains: '("outboxId", "startedAt")' },
  commerce_email_attempts_outboxId_attemptNumber_key: { unique: true, contains: '("outboxId", "attemptNumber")' },
};

/** BEFORE UPDATE FOR EACH ROW (tgtype 19), enabled, calling the named function whose body must still contain every marker. */
const TRIGGERS = {
  commerce_email_outbox_guard: { table: OUTBOX, fn: 'commerce_email_outbox_guard',
    markers: ['event identity is immutable', 'payload cannot be restored', 'recipient and snapshot are immutable',
      'terminal commerce email dispatch state cannot change', 'provider evidence cannot be rewritten'] },
  commerce_email_attempts_guard: { table: ATTEMPTS, fn: 'commerce_email_attempts_guard', markers: ['append-only once finished'] },
};

/** Reads the physical state through `query(sql, params) => Promise<row[]>` (SELECTs only). Returns null when neither table exists. */
async function readPhysical(query) {
  const tables = await query(`SELECT c.relname AS name, c.relrowsecurity AS rls FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname = ANY($1) ORDER BY 1`, [TABLES]);
  if (!tables.length) return null;
  const constraints = await query(`SELECT con.conname AS name, con.contype::text AS type, rel.relname AS "table", ref.relname AS references,
      con.confdeltype::text AS "onDelete", pg_get_constraintdef(con.oid) AS definition, con.convalidated AS validated
    FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid LEFT JOIN pg_class ref ON ref.oid = con.confrelid
    WHERE con.conrelid = ANY (ARRAY['commerce_email_outbox'::regclass, 'commerce_email_attempts'::regclass]) ORDER BY 1`);
  const indexes = await query(`SELECT i.indexname AS name, i.indexdef AS definition, ix.indisunique AS unique, ix.indisvalid AS valid
    FROM pg_indexes i JOIN pg_class c ON c.relname = i.indexname JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = i.schemaname
    JOIN pg_index ix ON ix.indexrelid = c.oid WHERE i.schemaname = 'public' AND i.tablename = ANY($1) ORDER BY 1`, [TABLES]);
  const triggers = await query(`SELECT t.tgname AS name, rel.relname AS "table", t.tgtype::int AS type, t.tgenabled::text AS enabled,
      p.proname AS fn, p.prosrc AS body
    FROM pg_trigger t JOIN pg_class rel ON rel.oid = t.tgrelid JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE NOT t.tgisinternal AND rel.relname = ANY($1) ORDER BY 1`, [TABLES]);
  const enums = await query(`SELECT t.typname AS name, string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) AS labels
    FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid WHERE t.typname LIKE 'CommerceEmail%' GROUP BY 1 ORDER BY 1`);
  const roles = (await query(`SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated')`)).map(row => row.rolname);
  const exposure = [];
  for (const role of roles) for (const table of TABLES) {
    const [{ any }] = await query(`SELECT has_table_privilege($1, $2, 'SELECT') OR has_table_privilege($1, $2, 'INSERT') OR
      has_table_privilege($1, $2, 'UPDATE') OR has_table_privilege($1, $2, 'DELETE') OR has_table_privilege($1, $2, 'TRUNCATE') OR
      has_table_privilege($1, $2, 'REFERENCES') OR has_table_privilege($1, $2, 'TRIGGER') AS any`, [role, table]);
    exposure.push({ role, table, privileges: any });
  }
  const [rows] = await query(`SELECT count(*)::int AS outbox, (SELECT count(*)::int FROM commerce_email_attempts) AS attempts FROM commerce_email_outbox`);
  return { tables, constraints, indexes, triggers, enums, exposure, rows };
}

/** Safe failure codes for a physical readback (null means "tables absent"). Empty array means every required object is present and correct. */
function physicalFailures(physical) {
  if (!physical) return ['schema:commerce-tables-missing'];
  const failures = [];
  for (const table of TABLES) {
    const found = physical.tables.find(row => row.name === table);
    if (!found) failures.push(`schema:table-missing:${table}`);
    else if (found.rls !== true) failures.push(`schema:rls-disabled:${table}`);
  }
  for (const [name, expectedLabels] of Object.entries(ENUMS)) {
    const found = physical.enums.find(row => row.name === name);
    if (!found) failures.push(`schema:enum-missing:${name}`);
    else if (found.labels !== expectedLabels) failures.push(`schema:enum-members-differ:${name}`);
  }
  for (const [name, spec] of Object.entries(CONSTRAINTS)) {
    const found = physical.constraints.find(row => row.name === name);
    if (!found) { failures.push(`schema:constraint-missing:${name}`); continue; }
    if (found.type !== spec.type || found.table !== spec.table) failures.push(`schema:constraint-wrong-kind:${name}`);
    else if (spec.tokens.some(token => !found.definition.includes(token))) failures.push(`schema:constraint-definition-differs:${name}`);
    else if (found.validated !== true) failures.push(`schema:constraint-not-validated:${name}`);
    if (spec.type === 'f' && (found.references !== spec.references || found.onDelete !== spec.onDelete)) failures.push(`schema:foreign-key-differs:${name}`);
  }
  for (const [name, spec] of Object.entries(INDEXES)) {
    const found = physical.indexes.find(row => row.name === name);
    if (!found) { failures.push(`schema:index-missing:${name}`); continue; }
    if (found.unique !== spec.unique || !found.definition.includes(spec.contains)) failures.push(`schema:index-differs:${name}`);
    else if (found.valid !== true) failures.push(`schema:index-invalid:${name}`);
  }
  for (const [name, spec] of Object.entries(TRIGGERS)) {
    const found = physical.triggers.find(row => row.name === name);
    if (!found) { failures.push(`schema:trigger-missing:${name}`); continue; }
    if (found.table !== spec.table || found.fn !== spec.fn || found.type !== 19) failures.push(`schema:trigger-differs:${name}`);
    else if (found.enabled !== 'O') failures.push(`schema:trigger-disabled:${name}`);
    else if (spec.markers.some(marker => !found.body.includes(marker))) failures.push(`schema:trigger-function-differs:${name}`);
  }
  for (const entry of physical.exposure) if (entry.privileges) failures.push(`schema:browser-role-privilege:${entry.role}:${entry.table}`);
  return failures;
}

/**
 * Rules `verify` adds on top of the shared ledger/pending/checksum gate: the new migration MUST be applied and finished with the
 * exact checksum, nothing may be pending, and the physical schema and Prisma diff must be correct. `preflight` does not call this.
 */
function verifyFailures(state, migration, newChecksum) {
  const failures = [];
  const ours = state.ours ?? [];
  if (ours.length === 0) failures.push('ledger:new-migration-not-applied');
  else if (ours.length > 1) failures.push('ledger:duplicate-new-migration-rows');
  else {
    const row = ours[0];
    if (!row.finished_at || row.rolled_back_at) failures.push('ledger:new-migration-unfinished-or-rolled-back');
    if (row.checksum !== newChecksum) failures.push('ledger:new-migration-checksum-mismatch');
  }
  if (state.pending.length) failures.push(`ledger:pending-migrations:${state.pending.join(',')}`);
  failures.push(...physicalFailures(state.physical));
  if (state.nonCommerceDrift.error) failures.push('drift:diff-unavailable');
  else if (state.nonCommerceDrift.commerceStatements) failures.push(`drift:commerce-schema-differs:${state.nonCommerceDrift.commerceStatements}`);
  return failures;
}

module.exports = { TABLES, ENUMS, CONSTRAINTS, INDEXES, TRIGGERS, readPhysical, physicalFailures, verifyFailures };
