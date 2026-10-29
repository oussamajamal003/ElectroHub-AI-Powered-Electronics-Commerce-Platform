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
const MIGRATION_WORKFLOWS = new Set(['dev-migration.yml', 'prod-migration.yml']);
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

function getPushBranches(text) {
  const lines = text.split(/\r?\n/);
  const pushIdx = lines.findIndex((l) => /^ {2}push:/.test(l));
  if (pushIdx === -1) return null;
  const branches = [];
  let inBranches = false;
  for (let i = pushIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^ {2}[A-Za-z_]+:/.test(line) || /^\S/.test(line)) break;
    const inlineMatch = /^ {4}branches:\s*\[([^\]]+)\]/.exec(line);
    if (inlineMatch) {
      return inlineMatch[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
    }
    if (/^ {4}branches:/.test(line)) {
      inBranches = true;
      continue;
    }
    if (inBranches) {
      const itemMatch = /^ {6}-\s*(\S+)/.exec(line);
      if (itemMatch) {
        branches.push(itemMatch[1].replace(/^['"]|['"]$/g, ''));
      } else if (!/^\s*$/.test(line)) {
        break;
      }
    }
  }
  return branches;
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
    if (name === 'dev-migration.yml') {
      if (on.length !== 1 || on[0] !== 'workflow_dispatch') {
        fail(`DEV workflow must be triggered by workflow_dispatch only (found: ${on.join(', ') || 'none'})`);
      }
    } else if (name === 'prod-migration.yml') {
      const allowedTriggers = new Set(['push', 'workflow_dispatch']);
      const hasDisallowed = on.some((t) => !allowedTriggers.has(t));
      if (hasDisallowed || !on.includes('workflow_dispatch')) {
        fail(`PROD workflow trigger must be push and/or workflow_dispatch (found: ${on.join(', ') || 'none'})`);
      }
      if (on.includes('push')) {
        const branches = getPushBranches(text);
        if (!branches || branches.length !== 1 || branches[0] !== 'develop') {
          fail(`PROD workflow push trigger must strictly target the develop branch only (found: ${branches ? branches.join(', ') : 'none'})`);
        }
      }
    }

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
    if (!/permissions:\s*\r?\n\s+contents:\s*read/.test(text)) fail('must enforce least-privilege permissions (contents: read)');

    if (name === 'dev-migration.yml') {
      if (!text.includes('EXPECTED_PROJECT_REF: pzxekjybdiulzmssalfo')) fail('DEV workflow must pin the DEV project ref');
      if (!text.includes('MIGRATION_TARGET: DEV')) fail('DEV workflow must explicitly select DEV in the migration guard');
      if (/ELECTROHUB_PROD_(?:DATABASE|DIRECT)_URL/.test(text)) fail('DEV workflow must not expose PROD database secrets');
    }
    if (name === 'prod-migration.yml') {
      if (!text.includes('EXPECTED_PROJECT_REF: yepfgjehdstlxbpespun')) fail('PROD workflow must pin the PROD project ref');
      if (!text.includes('MIGRATION_TARGET: PROD')) fail('PROD workflow must explicitly select PROD in the migration guard');
      if (!text.includes('electrohub-prod-database')) fail('PROD workflow must use the protected PROD environment');
      if (!text.includes('20261024000000_ai_vector_search,20261025000000_ai_vector_staging_guard,20261028000000_product_media,20261028010000_catalog_media_overlay,20261028020000_product_media_worker_health,20261029000000_recommendations')) {
        fail('PROD workflow must pin the reviewed ordered migration allowlist (Task 04.2 AI, Task 04.3 media, then Task 04.4 recommendations migrations)');
      }
      if (/ELECTROHUB_DEV_(?:DATABASE|DIRECT)_URL/.test(text)) fail('PROD workflow must not expose DEV database secrets');
      if (!/prisma\s+migrate\s+status/.test(text)) fail('PROD workflow must run prisma migrate status after deploy');
    }
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

module.exports = { checkWorkflow, checkWorkflows, loadWorkflows, triggers, getPushBranches, MIGRATION_WORKFLOWS };

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
