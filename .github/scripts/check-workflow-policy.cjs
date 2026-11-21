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
const PRODUCTION_RELEASE_WORKFLOW = 'deploy-production.yml';
const PRIVILEGED_PRODUCTION_WORKFLOWS = new Set(['deploy-production.yml', 'prod-migration.yml']);
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

function checkPinnedActions(name, rawText, fail) {
  if (!PRIVILEGED_PRODUCTION_WORKFLOWS.has(name)) return;
  for (const line of rawText.split(/\r?\n/)) {
    const match = /^\s*(?:-\s*)?uses:\s*([^\s#]+)(?:\s+#\s*(.*))?$/.exec(line);
    if (!match) continue;
    const reference = match[1].replace(/^['"]|['"]$/g, '');
    if (reference.startsWith('./') || reference.startsWith('docker://')) continue;
    const at = reference.lastIndexOf('@');
    const action = at > 0 ? reference.slice(0, at) : reference;
    const ref = at > 0 ? reference.slice(at + 1) : '';
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(action) || !/^[a-f0-9]{40}$/.test(ref)) {
      fail(`privileged production workflow action must use a full reviewed 40-character commit SHA: ${reference}`);
      continue;
    }
    if (!/^v\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(match[2] || '')) {
      fail(`privileged production workflow action must include a human-readable version comment: ${reference}`);
    }
  }
}

function checkWorkflow(name, rawText) {
  const text = stripComments(rawText);
  const problems = [];
  const fail = (message) => problems.push(`${name}: ${message}`);
  const on = triggers(text);
  const isMigrationWorkflow = MIGRATION_WORKFLOWS.has(name);
  const isProductionReleaseWorkflow = name === PRODUCTION_RELEASE_WORKFLOW;

  checkPinnedActions(name, rawText, fail);

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
      if (on.length !== 1 || on[0] !== 'workflow_dispatch') fail('PROD workflow must be triggered by workflow_dispatch only');
      for (const input of ['approved_commit', 'authorization_reference']) {
        if (!new RegExp(`^ {6}${input}:\\s*$`, 'm').test(text)) fail(`PROD workflow must require the ${input} dispatch input`);
      }
      if (!/if:\s*github\.ref == 'refs\/heads\/develop'/.test(text)) fail('PROD workflow must be restricted to develop');
      if (!/\[\s*"?\$APPROVED_COMMIT"?\s*!=\s*"?\$GITHUB_SHA"?\s*\]/.test(text)) fail('PROD workflow must require the approved SHA to exactly match the workflow SHA');
      if (!/\[ -z "\$\{AUTHORIZATION_REFERENCE/.test(text)) fail('PROD workflow must require a non-empty authorization reference');
      if (/workflow_run|^\s{2}(?:push|pull_request|schedule):/m.test(text)) fail('PROD workflow must not have an automatic mutation trigger');
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
      if (name === 'prod-migration.yml' && !/permissions:\s*\r?\n\s+contents:\s*read\s*\r?\n\s+checks:\s*read/.test(text)) fail('PROD workflow must use checks: read to verify exact-SHA CI results');

    if (name === 'dev-migration.yml') {
      if (!text.includes('EXPECTED_PROJECT_REF: pzxekjybdiulzmssalfo')) fail('DEV workflow must pin the DEV project ref');
      if (!text.includes('MIGRATION_TARGET: DEV')) fail('DEV workflow must explicitly select DEV in the migration guard');
      if (/ELECTROHUB_PROD_(?:DATABASE|DIRECT)_URL/.test(text)) fail('DEV workflow must not expose PROD database secrets');
    }
    if (name === 'prod-migration.yml') {
      if (!text.includes('EXPECTED_PROJECT_REF: yepfgjehdstlxbpespun')) fail('PROD workflow must pin the PROD project ref');
      if (!text.includes('MIGRATION_TARGET: PROD')) fail('PROD workflow must explicitly select PROD in the migration guard');
      if (!text.includes('electrohub-prod-database')) fail('PROD workflow must use the protected PROD environment');
      if (/APPROVED_MIGRATIONS|approved_migrations/.test(text)) fail('PROD workflow must discover pending migrations from the checked-in Prisma history and PROD ledger');
      if (/ELECTROHUB_DEV_(?:DATABASE|DIRECT)_URL/.test(text)) fail('PROD workflow must not expose DEV database secrets');
      if (!/prisma\s+migrate\s+status/.test(text)) fail('PROD workflow must run prisma migrate status after deploy');
      if (!/ref:\s*\$\{\{ inputs\.approved_commit \}\}/.test(text)) fail('PROD workflow must check out the exact approved commit');
      for (const requiredCheck of ['Required / Quality Gate', 'Security / NPM Audit']) {
        if (!text.includes(requiredCheck)) fail(`PROD workflow must require the exact-SHA ${requiredCheck} check`);
      }
      if (!/github\.rest\.checks\.listForRef/.test(text)) fail('PROD workflow must verify check results for the approved SHA');
    }
  } else if (isProductionReleaseWorkflow) {
    if (on.length !== 1 || on[0] !== 'workflow_dispatch') fail('production release/deploy workflow must be triggered by workflow_dispatch only');
    for (const input of ['approved_commit', 'authorization_reference', 'backup_evidence_reference']) {
      if (!new RegExp(`^ {6}${input}:\\s*$`, 'm').test(text)) fail(`production release/deploy workflow must require the ${input} dispatch input`);
    }
    if (!/if:\s*github\.ref == 'refs\/heads\/develop'/.test(text)) fail('production release/deploy workflow must be restricted to develop');
    if (!/\$APPROVED_COMMIT"\s*==\s*"\$GITHUB_SHA/.test(text)) fail('production release/deploy workflow must require the exact run SHA');
    if (!/electrohub-production-deploy/.test(text)) fail('production deploy job must use the protected production environment');
    if (!/cancel-in-progress:\s*false/.test(text) || !/group:\s*electrohub-production-release-deploy/.test(text)) fail('production deploy workflow must serialize releases without cancelling in-flight work');
    if (!/checks\.listForRef/.test(text) || !text.includes('Required / Quality Gate') || !text.includes('Security / NPM Audit')) fail('production release must require quality and security checks for the exact SHA');
    if (!/create-release-manifest\.cjs/.test(text) || !/verify-release-manifest\.cjs/.test(text)) fail('production release must create and verify its exact-SHA image manifest');
    if (!text.includes('AI_PRODUCTION_RELEASE.json') || !text.includes('AI_MODEL_ARTIFACT_PRODUCTION.json')) fail('production release must require separate approved AI release and artifact manifests');
    if (text.includes('AI_MODEL_ARTIFACT_CANDIDATE.json')) fail('production release must not package the local-only AI artifact candidate');
    if (text.indexOf('Require a distinct approved AI production release before building images') === -1 ||
      text.indexOf('Require a distinct approved AI production release before building images') > text.indexOf('docker build')) {
      fail('production AI release gate must run before building application images');
    }
    if (/docker\s+push|\bdocker\/login|ghcr\.io|dockerhub/i.test(text)) fail('production release must not publish to an unapproved registry');
    if (/workflow_run|^\s{2}(?:push|pull_request|schedule):/m.test(text)) fail('production release/deploy must not have an automatic deployment trigger');
    if (/prisma\s+migrate\s+deploy/.test(text)) fail('application deployment workflow must keep database migration separate');
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

module.exports = { checkWorkflow, checkWorkflows, loadWorkflows, triggers, getPushBranches, MIGRATION_WORKFLOWS, PRODUCTION_RELEASE_WORKFLOW, PRIVILEGED_PRODUCTION_WORKFLOWS, SHARED_DB_SECRET };

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
