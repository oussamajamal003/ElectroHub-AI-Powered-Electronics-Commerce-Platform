'use strict';
/**
 * Static policy for .github/workflows: ordinary push / pull-request automation must never be able to apply
 * migrations to, or use credentials for, a shared database.
 *
 *   node .github/scripts/check-workflow-policy.cjs        # exits 1 and lists violations
 *
 * Text-based on purpose (no YAML dependency, no secrets, safe to run on every PR).
 */
const fs = require('node:fs');
const path = require('node:path');

/** The only workflows allowed to deploy migrations or read shared-database secrets. */
const MIGRATION_WORKFLOWS = new Set(['dev-migration.yml']);
const DISPOSABLE_ACTION = './.github/actions/disposable-postgres';
const MUTATING_PRISMA = /\bprisma\s+(migrate\s+(deploy|resolve|reset|dev)|db\s+(push|execute))\b/;
const SUPABASE_MUTATING = /\bsupabase\s+(db\s+(push|reset)|migration\s+up|link)\b/;
const SHARED_DB_SECRET = /secrets\.ELECTROHUB_[A-Z_]*(DATABASE|DIRECT|DB|PROD|DEV)[A-Z_]*/;

function stripComments(text) {
  return text.split(/\r?\n/).filter((line) => !/^\s*#/.test(line)).join('\n');
}

/** Top-level trigger names from the `on:` key (block, list or scalar form). */
function triggers(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => /^on:/.test(line) || /^"on":/.test(line));
  if (start === -1) return [];
  const inline = lines[start].replace(/^"?on"?:/, '').trim();
  if (inline) return inline.replace(/[[\]{}]/g, '').split(',').map((name) => name.trim().split(':')[0]).filter(Boolean);
  const names = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    const match = /^ {2}([A-Za-z_]+):/.exec(line) || /^ {2}- *([A-Za-z_]+)/.exec(line);
    if (match) names.push(match[1]);
  }
  return names;
}

function checkWorkflow(name, rawText) {
  const text = stripComments(rawText);
  const problems = [];
  const fail = (message) => problems.push(`${name}: ${message}`);
  const on = triggers(text);
  const isMigrationWorkflow = MIGRATION_WORKFLOWS.has(name);

  if (on.includes('pull_request_target')) fail('uses pull_request_target (runs untrusted code with secrets)');
  if (SUPABASE_MUTATING.test(text) && !isMigrationWorkflow) fail('runs a mutating Supabase CLI command outside the migration workflow');
  if (SHARED_DB_SECRET.test(text) && !isMigrationWorkflow) fail('references a shared-database secret outside the migration workflow');

  if (MUTATING_PRISMA.test(text) && !isMigrationWorkflow) {
    const onlyDeploy = !/\bprisma\s+(migrate\s+(resolve|reset|dev)|db\s+(push|execute))\b/.test(text);
    if (!(onlyDeploy && text.includes(DISPOSABLE_ACTION) && !/secrets\./.test(text.replace(/secrets\.GITHUB_TOKEN/g, '')))) {
      fail('runs a mutating Prisma command; only the disposable-database `migrate deploy` is allowed outside the migration workflow');
    }
    if (text.includes(DISPOSABLE_ACTION)) {
      const useAt = text.indexOf(DISPOSABLE_ACTION);
      const firstPrisma = text.search(MUTATING_PRISMA);
      if (firstPrisma !== -1 && firstPrisma < useAt) fail('runs Prisma before the disposable database is started');
    }
  }

  if (isMigrationWorkflow) {
    if (on.length !== 1 || on[0] !== 'workflow_dispatch') fail(`must be triggered by workflow_dispatch only (found: ${on.join(', ') || 'none'})`);
    if (!/^\s+environment:\s*\S+/m.test(text)) fail('deployment job must declare a protected GitHub Environment');
    if (!/^concurrency:/m.test(text) && !/^\s+concurrency:/m.test(text)) fail('must declare a concurrency group');
    if (!/cancel-in-progress:\s*false/.test(text)) fail('concurrency must not cancel an in-progress migration');
    const pre = text.indexOf('migration-plan.cjs pre');
    const deploy = text.search(/\bprisma\s+migrate\s+deploy\b/);
    if (pre === -1) fail('must run the migration-plan pre-check');
    if (deploy === -1) fail('contains no migrate deploy step');
    if (pre !== -1 && deploy !== -1 && pre > deploy) fail('the pre-check must run before migrate deploy');
    if (!text.includes('migration-plan.cjs post')) fail('must run the migration-plan post-check');
    if (/\bprisma\s+migrate\s+(resolve|reset|dev)\b|\bprisma\s+db\s+(push|execute)\b/.test(text)) fail('must not run resolve, reset, dev or db push');
  } else if (on.some((trigger) => ['push', 'pull_request', 'schedule', 'workflow_run'].includes(trigger)) && /ELECTROHUB_[A-Z]*_(DATABASE|DIRECT)_URL/.test(text)) {
    fail('a push/PR/scheduled workflow references a shared database URL');
  }
  return problems;
}

function checkWorkflows(files) {
  return files.flatMap((file) => checkWorkflow(file.name, file.text));
}

function loadWorkflows(dir) {
  return fs.readdirSync(dir)
    .filter((name) => /\.ya?ml$/.test(name))
    .sort()
    .map((name) => ({ name, text: fs.readFileSync(path.join(dir, name), 'utf8') }));
}

module.exports = { checkWorkflow, checkWorkflows, loadWorkflows, triggers, MIGRATION_WORKFLOWS };

if (require.main === module) {
  const dir = path.resolve(__dirname, '../workflows');
  const problems = checkWorkflows(loadWorkflows(dir));
  if (problems.length) {
    for (const problem of problems) console.error(`POLICY VIOLATION: ${problem}`);
    process.exitCode = 1;
  } else {
    console.log('Workflow migration-safety policy: OK');
  }
}
