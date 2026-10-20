import { resolveDatabaseTargets } from './database-target.js';

type Role = 'api' | 'worker';
const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Shared DEV workers are intentionally limited to the reviewed attempt and the Task04 fixture attempt. */
export function validateSupervisorAttemptIds(value: unknown): readonly string[] | null {
  if (!Array.isArray(value) || value.length !== 2 || value.some(id => typeof id !== 'string' || !CANONICAL_UUID.test(id)) ||
    new Set(value).size !== value.length) return null;
  return Object.freeze([...value]);
}

/** A missing or invalid IPC scope must never turn into an unscoped recovery loop. */
export function requireSupervisedPaymentAttemptIds(value: unknown): string[] {
  const validated = validateSupervisorAttemptIds(value);
  if (!validated) throw new Error('DEV_SUPERVISOR_ATTEMPT_SCOPE_REQUIRED');
  const scope = [...validated];
  Object.freeze(scope);
  return scope;
}

/** Per-child IPC authority. No environment flag or approval string can activate it. */
export class DevSupervisorAuthority {
  private nonce: string | null = null;
  private active = false;
  private revoked = false;
  private scope: readonly string[] | null = null;
  constructor(private readonly identity: string, private readonly parentPid: number, private readonly role: Role = 'api') {}

  receive(message: unknown): 'prepared' | 'activated' | 'revoked' | 'scope-rejected' | null {
    if (!message || typeof message !== 'object' || this.revoked) return null;
    const value = message as Record<string, unknown>;
    if (value.type === 'payment-supervisor.prepare' && !this.nonce && value.identity === this.identity &&
      value.parentPid === this.parentPid && typeof value.nonce === 'string' && /^[a-f0-9]{64}$/.test(value.nonce)) {
      if (this.role === 'worker') {
        this.scope = validateSupervisorAttemptIds(value.attemptIds);
        if (!this.scope) return 'scope-rejected';
      } else if (Object.prototype.hasOwnProperty.call(value, 'attemptIds')) return 'scope-rejected';
      this.nonce = value.nonce;
      return 'prepared';
    }
    if (!this.nonce || value.nonce !== this.nonce) return null;
    if (value.type === 'payment-supervisor.activate') { this.active = true; return 'activated'; }
    if (value.type === 'payment-supervisor.revoke') { this.revoke(); return 'revoked'; }
    return null;
  }
  revoke(): void { this.revoked = true; this.active = false; }
  allows(identity: string, connected: boolean): boolean {
    return connected && !this.revoked && this.identity === identity && Boolean(this.nonce) && this.active;
  }
  attemptIds(identity: string, connected: boolean): readonly string[] | null {
    return this.role === 'worker' && this.scope && this.allows(identity, connected) ? this.scope : null;
  }
}

let authority: DevSupervisorAuthority | null = null;
export function devSupervisorAllowed(identity: string): boolean {
  return authority?.allows(identity, process.connected === true) ?? false;
}
export function devSupervisorAttemptIds(identity: string): readonly string[] | null {
  return authority?.attemptIds(identity, process.connected === true) ?? null;
}

/** Called by bootstrap before importing API/worker modules. A regular shell/watch process has no trusted IPC channel. */
export async function initializeDevSupervisor(environment: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (environment.PAYMENT_DEV_SUPERVISED !== '1') return;
  if (environment.NODE_ENV !== 'development' || !process.send || !process.connected ||
    !/^(?:sk|rk)_test_[A-Za-z0-9]+$/.test(environment.STRIPE_SECRET_KEY ?? '') || !environment.STRIPE_WEBHOOK_SECRET) {
    throw new Error('DEV_SUPERVISOR_CHANNEL_REQUIRED');
  }
  const { runtime } = resolveDatabaseTargets(environment);
  if (runtime.category !== 'dev') throw new Error('DEV_SUPERVISOR_TARGET_REQUIRED');
  const role: Role = process.argv.includes('--payment-worker') ? 'worker' : 'api';
  const state = new DevSupervisorAuthority(runtime.identity, process.ppid, role);
  authority = state;
  let activationResolve: () => void = () => {};
  let activationReject: (error: Error) => void = () => {};
  const activation = new Promise<void>((resolve, reject) => { activationResolve = resolve; activationReject = reject; });
  // API bootstrap does not await activation; still handle channel failure without an unhandled rejection.
  void activation.catch(() => {});
  let launchNonce = '';
  await new Promise<void>((resolve, reject) => {
    let prepared = false;
    const timeout = setTimeout(() => { state.revoke(); reject(new Error('DEV_SUPERVISOR_HANDSHAKE_TIMEOUT')); }, 5000);
    const onMessage = (message: unknown) => {
      const result = state.receive(message);
      if (result === 'prepared') {
        prepared = true;
        clearTimeout(timeout);
        const value = message as { nonce: string };
        launchNonce = value.nonce;
        process.send?.({ event: 'payment.supervisor.prepared', role, nonce: value.nonce }, error => {
          if (error) { state.revoke(); reject(new Error('DEV_SUPERVISOR_CHANNEL_FAILED')); } else resolve();
        });
      } else if (result === 'scope-rejected') {
        clearTimeout(timeout);
        state.revoke();
        const value = message as { nonce?: unknown };
        process.send?.({ event: 'payment.supervisor.degraded', role, nonce: value.nonce }, () => {});
        reject(new Error('DEV_SUPERVISOR_ATTEMPT_SCOPE_REQUIRED'));
      } else if (result === 'activated') {
        activationResolve();
        const value = message as { nonce: string };
        process.send?.({ event: 'payment.supervisor.activated', role, nonce: value.nonce }, error => { if (error) state.revoke(); });
      }
    };
    process.on('message', onMessage);
    process.once('disconnect', () => {
      state.revoke();
      activationReject(new Error('DEV_SUPERVISOR_DISCONNECTED'));
      clearTimeout(timeout);
      if (!prepared) reject(new Error('DEV_SUPERVISOR_DISCONNECTED'));
      // Use the API/runner's existing graceful shutdown and lease handling.
      process.emit('SIGTERM', 'SIGTERM');
    });
    process.send?.({ event: 'payment.supervisor.awaiting', role }, error => {
      if (error) { state.revoke(); clearTimeout(timeout); reject(new Error('DEV_SUPERVISOR_CHANNEL_FAILED')); }
    });
  });
  // Winston development output is file-only. Forward only fixed lifecycle signals over the private IPC channel.
  const { logger } = await import('../utils/logger.js');
  logger.on('data', (info: { event?: string }) => {
    const event = info.event === 'server.ready' ? 'payment.supervisor.api-ready'
      : info.event === 'payment.runner.ready' ? 'payment.supervisor.runner-ready'
      : ['server.degraded', 'payment.recovery.batch_failed'].includes(info.event ?? '') ? 'payment.supervisor.degraded' : null;
    if (!event) return;
    if (event === 'payment.supervisor.degraded') state.revoke();
    try { process.send?.({ event, role, nonce: launchNonce }, error => { if (error) state.revoke(); }); }
    catch { state.revoke(); }
  });
  if (role === 'worker') {
    const { prisma } = await import('./prisma.js');
    let timer: NodeJS.Timeout | undefined;
    try {
      await prisma.$queryRaw`SELECT 1`;
      process.send?.({ event: 'payment.supervisor.worker-ready', role, nonce: launchNonce }, error => {
        if (error) activationReject(new Error('DEV_SUPERVISOR_CHANNEL_FAILED'));
      });
      await Promise.race([activation, new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('DEV_SUPERVISOR_ACTIVATION_TIMEOUT')), 30000);
      })]);
    } catch (error) { state.revoke(); await prisma.$disconnect(); throw error; }
    finally { if (timer) clearTimeout(timer); }
  }
}
