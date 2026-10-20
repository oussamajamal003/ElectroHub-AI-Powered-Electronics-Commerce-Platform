import { open, readFile, rename, rm, mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const setupDirectory = path.dirname(fileURLToPath(import.meta.url));
const backendDirectory = path.resolve(setupDirectory, '../../../backend');
const acceptanceDirectory = path.join(backendDirectory, '.cache/task04-acceptance');
const fixtureFile = path.join(acceptanceDirectory, 'fixture.json');
const stateFile = path.join(acceptanceDirectory, 'fixture.state.json');
const tokenFile = path.join(backendDirectory, '.cache/dev-runtime-token.txt');
const lockFile = path.join(acceptanceDirectory, 'real-dev-playwright.lock');
const diagnosticPath = '/api/internal/development-runtime';
const apiOrigin = 'http://127.0.0.1:5000';
const frontendOrigin = 'http://127.0.0.1:3000';

type RuntimeDiagnostic = {
  data?: {
    mode?: unknown;
    instanceId?: unknown;
    databaseReady?: unknown;
    tlsVerified?: unknown;
  };
};

type Fixture = { runId: string; email: string; password: string; userId: string; productId: string; productSlug: string };
type ResumeAuthorization = { id?: unknown; runId?: unknown; attemptId?: unknown; expiresAt?: unknown; consumedAt?: unknown };
export type ProgressState = { stage?: unknown; runId?: unknown; resumeAuthorization?: ResumeAuthorization };

/**
 * `prepared` starts the one purchase. `journeyStarted` (interrupted before Place Order) continues only with a fresh, unconsumed,
 * fixture-bound authorization written by `task04-dev-acceptance.cjs --reconcile-resume` after read-only DB/provider reconciliation.
 * Any later stage, or anything unexpected, refuses: a possibly submitted payment is never repeated.
 */
export function resumeDecision(state: ProgressState, runId: string, now = Date.now()): 'fresh' | 'resume' {
  if (state.stage === 'prepared' && !state.resumeAuthorization) return 'fresh';
  const authorization = state.resumeAuthorization;
  if (state.stage === 'journeyStarted' && state.runId === runId && authorization && authorization.consumedAt === undefined &&
      authorization.runId === runId && typeof authorization.id === 'string' && typeof authorization.expiresAt === 'string' &&
      (authorization.attemptId === null || typeof authorization.attemptId === 'string') && Date.parse(authorization.expiresAt) > now) return 'resume';
  throw new Error('Task04 preflight refused: this fixture already has a purchase attempt without a valid pre-submit resume authorization; do not repeat Place Order.');
}

async function readDiagnostic(url: string, token: string): Promise<RuntimeDiagnostic> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    throw new Error('Task04 preflight refused: MAIN_DEV diagnostic is unreachable.');
  }
  if (!response.ok || !response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    throw new Error('Task04 preflight refused: MAIN_DEV diagnostic was denied.');
  }
  try {
    return await response.json() as RuntimeDiagnostic;
  } catch {
    throw new Error('Task04 preflight refused: MAIN_DEV diagnostic was malformed.');
  }
}

function mainReady(value: RuntimeDiagnostic): value is RuntimeDiagnostic & { data: NonNullable<RuntimeDiagnostic['data']> } {
  const data = value?.data;
  return data?.mode === 'MAIN_DEV' && typeof data.instanceId === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(data.instanceId) &&
    data.databaseReady === true && data.tlsVerified === true;
}

function validFixture(value: unknown): value is Fixture {
  if (!value || typeof value !== 'object') return false;
  const fixture = value as Partial<Fixture>;
  return typeof fixture.runId === 'string' && typeof fixture.email === 'string' && fixture.email.length > 0 &&
    typeof fixture.password === 'string' && fixture.password.length > 0 &&
    typeof fixture.userId === 'string' && /^[0-9a-f-]{36}$/i.test(fixture.userId) &&
    typeof fixture.productId === 'string' && /^[0-9a-f-]{36}$/i.test(fixture.productId) &&
    typeof fixture.productSlug === 'string' && /^[a-z0-9-]+$/.test(fixture.productSlug);
}

export async function verifyMainDevRuntime(): Promise<void> {
  let token: string;
  try { token = (await readFile(tokenFile, 'utf8')).trim(); }
  catch { throw new Error('Task04 preflight refused: private runtime token is missing or unreadable.'); }
  if (!/^[0-9a-f]{64}$/i.test(token)) throw new Error('Task04 preflight refused: private runtime token is invalid.');
  const [direct, proxied] = await Promise.all([
    readDiagnostic(`${apiOrigin}${diagnosticPath}`, token),
    readDiagnostic(`${frontendOrigin}${diagnosticPath}`, token),
  ]);
  if (!mainReady(direct) || !mainReady(proxied) || direct.data.instanceId !== proxied.data.instanceId) {
    throw new Error('Task04 preflight refused: direct API and frontend proxy do not attest the same ready MAIN_DEV runtime.');
  }
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  if (process.env.TASK04_DEV_PURCHASE_APPROVED !== '1' && process.env.TASK04_VERIFY_ONLY !== '1') {
    throw new Error('Task04 DEV purchase is gated. Set TASK04_DEV_PURCHASE_APPROVED=1 only for the approved synthetic fixture run.');
  }

  await mkdir(acceptanceDirectory, { recursive: true, mode: 0o700 });
  let lock: Awaited<ReturnType<typeof open>> | undefined;
  try {
    lock = await open(lockFile, 'wx', 0o600);
  } catch {
    throw new Error('Task04 preflight refused: another run or an unreconciled prior run holds the acceptance lock.');
  }

  try {
    let fixture: unknown;
    let state: ProgressState;
    try {
      const [fixtureText, stateText] = await Promise.all([
        readFile(fixtureFile, 'utf8'), readFile(stateFile, 'utf8'),
      ]);
      fixture = JSON.parse(fixtureText);
      state = JSON.parse(stateText);
    } catch {
      throw new Error('Task04 preflight refused: private fixture or progress marker is missing or malformed.');
    }
    if (!validFixture(fixture)) throw new Error('Task04 preflight refused: private synthetic fixture is malformed.');
    // Verification-only runs read an already purchased fixture; the purchase test is skipped and Place Order is unreachable.
    const verifyOnly = process.env.TASK04_VERIFY_ONLY === '1';
    if (verifyOnly && state.stage !== 'purchased') throw new Error('Task04 preflight refused: verification-only mode requires a purchased fixture.');
    const decision = verifyOnly ? 'fresh' : resumeDecision(state, (fixture as Fixture).runId);
    await verifyMainDevRuntime();
    if (decision === 'resume') {
      // Consumed under the exclusive lock before the browser starts, so one authorization permits at most one run.
      const consumed = { ...state, resumeAuthorization: { ...state.resumeAuthorization, consumedAt: new Date().toISOString() } };
      const temporary = path.join(acceptanceDirectory, `.fixture.state.${randomUUID()}.tmp`);
      await writeFile(temporary, `${JSON.stringify(consumed, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      await rename(temporary, stateFile);
      process.env.TASK04_RESUME_AUTHORIZATION = String(state.resumeAuthorization!.id);
    }
  } catch (error) {
    await lock.close();
    lock = undefined;
    await rm(lockFile, { force: true });
    throw error;
  }

  // A crashed run leaves the lock and the one-way fixture progress marker as fail-closed evidence.
  return async () => {
    await lock?.close();
    await rm(lockFile, { force: true });
  };
}
