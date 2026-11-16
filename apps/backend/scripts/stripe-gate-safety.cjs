const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { createHash } = require('node:crypto');
const dotenv = require('dotenv');

const DEV_PROJECT = 'pzxekjybdiulzmssalfo';
const DEV_STRIPE_ACCOUNT = 'acct_1UEZW5KiVgdl63pN';
const EXIT_CODES = Object.freeze({ READY_TO_RUN: 0, BLOCKED_BY_ENVIRONMENT: 2, FAILED_PRECONDITION: 3, FAILED_ACCEPTANCE: 1, NOT_VERIFIED: 2 });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const scenarios = ['success', 'capture-recovery', 'decline', 'decline-retry', 'sca', 'sca-cancel', 'sca-fail', 'sca-refresh'];

function sanitize(value) {
  return String(value).replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/gi, '[DATABASE URL REDACTED]')
    .replace(/(?:sk|pk|rk)_(?:test|live)_[A-Za-z0-9]+|whsec_[A-Za-z0-9]+|pi_[A-Za-z0-9]+_secret_[A-Za-z0-9]+/g, '[REDACTED]')
    .replace(/Bearer\s+[^\s"']+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/gi, '[REDACTED]')
    .replace(/("?(?:password|accessToken|refreshToken|clientSecret)"?\s*[:=]\s*)"?[^\s",}]+"?/gi, '$1[REDACTED]');
}

function parseArguments(argv) {
  const options = { mode: 'dry-run', scenario: 'capture-recovery', buyNow: false, slow: false, backendPort: 5136, frontendPort: 3136, manifestPath: null };
  const seen = new Set();
  let scenarioSelected = false;
  for (const argument of argv) {
    const [name, ...parts] = argument.split('=');
    const value = parts.join('=');
    if (seen.has(name)) throw new Error('Duplicate gate argument.');
    seen.add(name);
    if (['--dry-run', '--preflight', '--execute'].includes(name)) {
      if (value || [...seen].filter(item => ['--dry-run', '--preflight', '--execute'].includes(item)).length > 1) throw new Error('Select exactly one execution mode.');
      options.mode = name === '--execute' ? 'execute' : 'dry-run';
    } else if (scenarios.includes(name.slice(2)) && name.startsWith('--')) {
      if (scenarioSelected || value) throw new Error('Select exactly one financial scenario.');
      options.scenario = name.slice(2);
      scenarioSelected = true;
    } else if (['--buy-now', '--slow', '--help'].includes(name) && !value) {
      options[name === '--buy-now' ? 'buyNow' : name.slice(2)] = true;
    } else if (name === '--fixture-manifest' && value) {
      options.manifestPath = path.resolve(value);
    } else if (['--backend-port', '--frontend-port'].includes(name) && /^\d+$/.test(value)) {
      const port = Number(value);
      if (port < 1024 || port > 65535) throw new Error('Gate ports must be between 1024 and 65535.');
      options[name === '--backend-port' ? 'backendPort' : 'frontendPort'] = port;
    } else throw new Error('Unknown or invalid gate argument.');
  }
  if (options.backendPort === options.frontendPort) throw new Error('Backend and frontend ports must differ.');
  return options;
}

function loadTestEnvironment(backendDir, inherited = process.env, read = file => fs.existsSync(file) ? dotenv.parse(fs.readFileSync(file, 'utf8')) : {}) {
  if (inherited.NODE_ENV === 'production') throw new Error('Production execution is forbidden.');
  const values = { ...read(path.join(backendDir, '.env')), ...inherited, ...read(path.join(backendDir, '.env.test.local')), NODE_ENV: 'test' };
  for (const name of ['PORT', 'FRONTEND_URL', 'STRIPE_WEBHOOK_SECRET']) if (inherited[name]) values[name] = inherited[name];
  return values;
}

function describeDatabase(value) {
  try {
    const url = new URL(value);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.pathname !== '/postgres') return { dev: false, kind: 'INVALID' };
    const direct = url.hostname === `db.${DEV_PROJECT}.supabase.co`;
    const pooler = /^aws-\d+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(url.hostname) && decodeURIComponent(url.username) === `postgres.${DEV_PROJECT}`;
    const port = Number(url.port || 5432);
    return { dev: (direct || pooler) && [5432, 6543].includes(port), kind: direct ? 'DIRECT' : pooler ? port === 5432 ? 'SESSION_POOLER' : 'TRANSACTION_POOLER' : 'UNAPPROVED', port };
  } catch { return { dev: false, kind: 'INVALID' }; }
}

function sourceFingerprint(backendDir) {
  const repository = path.resolve(backendDir, '../..');
  const files = [];
  const roots = ['apps/backend/src', 'apps/backend/scripts', 'apps/backend/prisma/schema.prisma', 'apps/frontend/src/features/checkout', 'package-lock.json'];
  if (fs.existsSync(path.join(backendDir, 'dist'))) roots.push('apps/backend/dist');
  for (const root of roots) {
    const visit = relative => {
      const absolute = path.join(repository, relative);
      if (fs.statSync(absolute).isDirectory()) for (const child of fs.readdirSync(absolute)) visit(`${relative}/${child}`);
      else files.push(relative);
    };
    visit(root);
  }
  const records = files.sort().map(file => `${file}\t${createHash('sha256').update(fs.readFileSync(path.join(repository, file))).digest('hex')}`);
  return createHash('sha256').update(records.join('\n')).digest('hex');
}

function assertSyntheticDevEnvironment(values) {
  if (values.NODE_ENV !== 'test' || values.NODE_TLS_REJECT_UNAUTHORIZED === '0' ||
    !['DATABASE_URL', 'DIRECT_URL'].every(name => describeDatabase(values[name]).dev)) {
    throw new Error('Synthetic purchase tests require exact DEV endpoints, test runtime and verified TLS.');
  }
}

function assertCanonicalStripeAccount(account) {
  if (account !== DEV_STRIPE_ACCOUNT) throw new Error('Stripe account does not match canonical ElectroHub DEV.');
}

function syntheticCleanupAllowed(setupCompleted, testStates) {
  return setupCompleted === true && Array.isArray(testStates) && testStates.length > 0 &&
    testStates.every(state => state === 'pass');
}

function validateManifest(manifest, fingerprint) {
  const keys = ['runId', 'projectRef', 'isolatedDev', 'productIds', 'sourceFingerprint', 'approvedRunner', 'postgresReliabilityVerified', 'connectionBudgetVerified'];
  if (!manifest || Object.keys(manifest).some(key => !keys.includes(key)) || !uuid.test(manifest.runId) || manifest.projectRef !== DEV_PROJECT || manifest.isolatedDev !== true ||
    !Array.isArray(manifest.productIds) || manifest.productIds.length !== 2 || manifest.productIds.some(id => !uuid.test(id)) ||
    new Set(manifest.productIds).size !== 2 || !/^[a-f0-9]{64}$/.test(manifest.sourceFingerprint) || manifest.sourceFingerprint !== fingerprint ||
    typeof manifest.approvedRunner !== 'string' || !/^[A-Za-z0-9_.:-]{1,100}$/.test(manifest.approvedRunner) ||
    manifest.postgresReliabilityVerified !== true || manifest.connectionBudgetVerified !== true) {
    throw new Error('Approved isolated DEV fixture/readiness manifest is missing, invalid, or stale.');
  }
  return { ...manifest, label: `stripe-acceptance-${manifest.runId}` };
}

function preflight({ options, values, backendDir, fingerprint, exists = fs.existsSync, readJson = file => JSON.parse(fs.readFileSync(file, 'utf8')) }) {
  const failures = [];
  const blocked = [];
  const urls = Object.fromEntries(['DATABASE_URL', 'DIRECT_URL'].map(name => [name, describeDatabase(values[name])]));
  for (const name of ['DATABASE_URL', 'DIRECT_URL']) {
    if (!values[name]) blocked.push(`${name} is unavailable.`);
    else if (!urls[name].dev) failures.push(`${name} is not the exact approved DEV project.`);
  }
  if (values.NODE_ENV === 'production' || values.NODE_TLS_REJECT_UNAUTHORIZED === '0') failures.push('Production execution or disabled TLS is forbidden.');
  if (!values.STRIPE_SECRET_KEY) blocked.push('Stripe Test Mode credentials are unavailable.');
  else if (!/^(sk|rk)_test_[A-Za-z0-9]+$/.test(values.STRIPE_SECRET_KEY)) failures.push('Only Stripe Test Mode credentials are accepted.');
  if (values.STRIPE_GATE_REUSE_WEBHOOK_LISTENER === 'true') failures.push('Listener reuse cannot prove the active signing-secret binding.');
  if (!values.DB_SSL_CA_CERT_PATH || !exists(path.resolve(backendDir, values.DB_SSL_CA_CERT_PATH))) blocked.push('Verified database CA file is unavailable.');
  for (const file of ['dist/app.js', 'dist/payment-runner.js', 'dist/services/payment.service.js']) if (!exists(path.join(backendDir, file))) blocked.push(`Required built runtime ${file} is unavailable.`);
  let manifest = null;
  if (!options.manifestPath) blocked.push('Approved isolated DEV fixture/readiness manifest is required.');
  else {
    try { manifest = validateManifest(readJson(options.manifestPath), fingerprint); }
    catch { failures.push('Approved isolated DEV fixture/readiness manifest is invalid or stale.'); }
  }
  if (manifest && (values.STRIPE_GATE_RUN_AUTHORIZED !== manifest.runId || values.STRIPE_GATE_APPROVED_RUNNER !== manifest.approvedRunner)) blocked.push('Explicit run authorization and approved runner identity are required.');
  const status = failures.length ? 'FAILED_PRECONDITION' : blocked.length ? 'BLOCKED_BY_ENVIRONMENT' : 'READY_TO_RUN';
  return { status, exitCode: EXIT_CODES[status], financialAcceptance: 'NOT_VERIFIED', failures, blocked, urls, manifest,
    sourceFingerprint: fingerprint, scope: options.buyNow ? 'BUY_NOW' : 'CART_CHECKOUT', scenario: options.scenario };
}

function assertFixtureProducts(products, manifest) {
  if (products.length !== 2) throw new Error('Owned acceptance Products are unavailable.');
  for (const [index, id] of manifest.productIds.entries()) {
    const product = products.find(item => item.id === id);
    if (!product || product.sku !== `${manifest.label}-${index}` || product.category?.name !== manifest.label ||
      product.isTestFixture !== false || product.storefrontVisible !== false || product.status !== 'ACTIVE' || !product.category?.isActive ||
      product.price.toFixed(2) !== (index === 0 ? '1.00' : '0.50') || product.inventory?.quantity !== 10) {
      throw new Error('Fixture ownership, customer visibility, price, or initial Inventory did not match approval.');
    }
  }
}

async function assertPortAvailable(port, createServer = () => net.createServer()) {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', () => reject(new Error(`Port ${port} is unavailable; no existing process was replaced.`)));
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
}

class OwnedProcesses {
  constructor() { this.children = new Set(); }
  track(child) {
    if (!child || !Number.isInteger(child.pid) || child.pid < 1) throw new Error('Spawned process identity is unavailable.');
    this.children.add(child);
    child.once('exit', () => this.children.delete(child));
    return child;
  }
  stop(child) {
    if (!this.children.has(child)) return false;
    if (child.exitCode !== null || child.killed) return false;
    return child.kill();
  }
  stopAll() { for (const child of this.children) this.stop(child); }
}

function cleanupEligibility({ manifest, user, attempts, orders, payments, providerIntents }) {
  if (!uuid.test(user?.id) || user.email !== `${manifest.label}@example.invalid`) throw new Error('Fixture customer ownership could not be verified.');
  if (orders.length || payments.length || attempts.some(attempt => attempt.userId !== user.id || attempt.orderId || attempt.state !== 'CANCELED' ||
    attempt.work && attempt.work.state !== 'DONE')) return { allowed: false, reason: 'Financial state must be preserved for reconciliation and review.' };
  for (const attempt of attempts) {
    const intent = providerIntents.find(item => item.id === attempt.providerIntentId);
    if (attempt.providerIntentId && (!intent || intent.livemode || intent.attemptId !== attempt.id || intent.account !== attempt.stripeAccountId ||
      intent.amount !== attempt.amountCents || intent.currency !== attempt.currency?.toLowerCase() || intent.captureMethod !== 'manual' || intent.received !== 0 || intent.capturable !== 0 ||
      intent.status !== 'canceled')) return { allowed: false, reason: 'Provider outcome is uncertain; cleanup is blocked.' };
  }
  return { allowed: true, reason: 'Owned non-purchase fixtures have verified terminal outcomes.' };
}

function installSanitizedOutput(stream) {
  const original = stream.write;
  let pending = '';
  stream.write = function(chunk, encoding, callback) {
    pending += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
    const newline = pending.lastIndexOf('\n');
    if (newline >= 0) {
      original.call(stream, sanitize(pending.slice(0, newline + 1)));
      pending = pending.slice(newline + 1);
    }
    if (pending.length > 65536) pending = '[OVERSIZED OUTPUT REDACTED]';
    const done = typeof encoding === 'function' ? encoding : callback;
    if (done) done();
    return true;
  };
  return () => { if (pending) original.call(stream, sanitize(pending)); stream.write = original; };
}

module.exports = { DEV_PROJECT, DEV_STRIPE_ACCOUNT, EXIT_CODES, sanitize, parseArguments, loadTestEnvironment, describeDatabase, sourceFingerprint, assertSyntheticDevEnvironment, assertCanonicalStripeAccount, syntheticCleanupAllowed,
  validateManifest, preflight, assertFixtureProducts, assertPortAvailable, OwnedProcesses, cleanupEligibility, installSanitizedOutput };
