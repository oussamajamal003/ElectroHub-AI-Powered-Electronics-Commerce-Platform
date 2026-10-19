/**
 * Task 03.8 development runtime (scripts/lib/commerce-email-dev.cjs, shared by `payment:dev` and `dev:isolated`) and the in-process
 * startup diagnostic. No database, no network, no real child process.
 */
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { describeCommerceEmailRuntime } from '../commerce-email.runtime.js';

interface Runtime { producerEnabled: boolean; dispatchEnabled: boolean; sendMode: string; allowlistSize: number; workerWillRun: boolean; warnings: string[] }
const dev = createRequire(path.join(process.cwd(), 'package.json'))('./scripts/lib/commerce-email-dev.cjs') as {
  describeEmailRuntime(env: Record<string, string | undefined>): Runtime;
  startEmailWorker(options: Record<string, unknown>): { started: boolean; reason?: string; runtime: Runtime; stop(): Promise<void> };
  EXIT_CONFIG_REFUSED: number;
};

const allowlisted = { COMMERCE_EMAIL_ENQUEUE_ENABLED: 'true', COMMERCE_EMAIL_DISPATCH_ENABLED: 'true', COMMERCE_EMAIL_SEND_MODE: 'allowlist',
  COMMERCE_EMAIL_ALLOWED_RECIPIENTS: 'one@customers.example.test, two@customers.example.test', FRONTEND_URL: 'http://localhost:3000', BREVO_API_KEY: 'x' };

describe('describeEmailRuntime (dev supervisors) and describeCommerceEmailRuntime (processes) agree and warn actionably', () => {
  it('fully configured allowlist DEV: producer, dispatch and a worker, no warnings', () => {
    const report = dev.describeEmailRuntime(allowlisted);
    expect(report).toMatchObject({ producerEnabled: true, dispatchEnabled: true, sendMode: 'allowlist', allowlistSize: 2, workerWillRun: true, warnings: [] });
    expect(describeCommerceEmailRuntime({ ...allowlisted, NODE_ENV: 'development' } as NodeJS.ProcessEnv)).toMatchObject({
      producerEnabled: true, dispatchEnabled: true, sendMode: 'allowlist', allowlistSize: 2, originConfigured: true, configValid: true, warnings: [] });
  });
  it('defaults are off and say so, so a disabled producer is never mistaken for working email', () => {
    expect(dev.describeEmailRuntime({})).toMatchObject({ workerWillRun: false, warnings: [expect.stringContaining('OFF')] });
    expect(describeCommerceEmailRuntime({ NODE_ENV: 'development' } as NodeJS.ProcessEnv).warnings[0]).toMatch(/^COMMERCE_EMAILS_OFF/);
  });
  it('flags every inconsistent combination', () => {
    expect(dev.describeEmailRuntime({ ...allowlisted, COMMERCE_EMAIL_DISPATCH_ENABLED: 'false' }).warnings.join(' ')).toMatch(/nothing will send/);
    expect(describeCommerceEmailRuntime({ ...allowlisted, COMMERCE_EMAIL_DISPATCH_ENABLED: 'false' } as NodeJS.ProcessEnv).warnings[0]).toMatch(/^EVENTS_QUEUE_BUT_NOTHING_SENDS/);
    expect(dev.describeEmailRuntime({ ...allowlisted, COMMERCE_EMAIL_ENQUEUE_ENABLED: 'false' }).warnings.join(' ')).toMatch(/no email events/);
    expect(describeCommerceEmailRuntime({ ...allowlisted, COMMERCE_EMAIL_ENQUEUE_ENABLED: 'false' } as NodeJS.ProcessEnv).warnings[0]).toMatch(/^WORKER_BUT_NO_EVENTS/);
    const emptyList = { ...allowlisted, COMMERCE_EMAIL_ALLOWED_RECIPIENTS: '' };
    expect(dev.describeEmailRuntime(emptyList)).toMatchObject({ workerWillRun: false });
    expect(describeCommerceEmailRuntime(emptyList as NodeJS.ProcessEnv).warnings.join(' ')).toMatch(/ALLOWLIST_EMPTY/);
    expect(dev.describeEmailRuntime({ ...allowlisted, BREVO_API_KEY: '' }).warnings.join(' ')).toMatch(/BREVO_API_KEY/);
    expect(describeCommerceEmailRuntime({ ...allowlisted, COMMERCE_EMAIL_ALLOWED_RECIPIENTS: 'not-an-email' } as NodeJS.ProcessEnv))
      .toMatchObject({ configValid: false, warnings: [expect.stringContaining('COMMERCE_EMAIL_CONFIG_INVALID')] });
  });
  it('an unknown send mode never counts as sending', () => {
    expect(dev.describeEmailRuntime({ ...allowlisted, COMMERCE_EMAIL_SEND_MODE: 'everyone' })).toMatchObject({ sendMode: 'disabled', workerWillRun: false });
  });
});

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & { stdout: PassThrough; stderr: PassThrough; kill: ReturnType<typeof vi.fn> };
  child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = vi.fn(() => true);
  return child;
}
function harness(extra: Record<string, unknown> = {}) {
  const backend = fs.mkdtempSync(path.join(os.tmpdir(), 'email-dev-'));
  const children: ReturnType<typeof fakeChild>[] = []; const lines: string[] = [];
  const spawn = vi.fn(() => { const child = fakeChild(); children.push(child); return child; });
  const options = { backend, entry: { command: 'node', args: ['runner.js'] }, env: allowlisted, log: (line: string) => lines.push(line), spawn,
    backoffMs: [1], maxRestarts: 3, windowMs: 60_000, ...extra };
  return { backend, children, lines, spawn, options };
}
const settle = () => new Promise(resolve => setTimeout(resolve, 25));

describe('startEmailWorker: supervised, bounded, never a second copy', () => {
  const started: { stop(): Promise<void> }[] = [];
  afterEach(async () => { for (const worker of started.splice(0)) await worker.stop(); });

  it('does not start (and spawns nothing) when email is not configured to send', () => {
    const { options, spawn } = harness({ env: {} });
    const worker = dev.startEmailWorker(options);
    expect(worker).toMatchObject({ started: false, reason: 'not-configured' });
    expect(spawn).not.toHaveBeenCalled();
  });

  it('starts one worker with the given environment and shows only safe, readable events', () => {
    const { options, spawn, children, lines } = harness();
    const worker = dev.startEmailWorker(options); started.push(worker);
    expect(worker.started).toBe(true);
    expect(spawn).toHaveBeenCalledTimes(1);
    children[0]!.stdout.write(`${JSON.stringify({ event: 'email_worker_ready', sendMode: 'allowlist', recipient: 'leak@customers.example.test' })}\n`);
    children[0]!.stdout.write(`${JSON.stringify({ event: 'something_else', secret: 'x' })}\nnot json\n`);
    return settle().then(() => {
      expect(lines).toEqual(['[email-worker] email_worker_ready sendMode=allowlist']);
      expect(lines.join(' ')).not.toMatch(/leak@|secret/);
    });
  });

  it('refuses a second supervised worker while another live supervisor owns the lock, and replaces a stale lock', () => {
    const first = harness();
    fs.mkdirSync(path.join(first.backend, '.cache'), { recursive: true });
    const lock = path.join(first.backend, '.cache/commerce-email-worker.lock');
    fs.writeFileSync(lock, JSON.stringify({ supervisorPid: process.ppid }));
    const refused = dev.startEmailWorker(first.options);
    expect(refused.started).toBe(false);
    expect(refused.reason).toContain('already-running');
    expect(first.spawn).not.toHaveBeenCalled();
    fs.writeFileSync(lock, JSON.stringify({ supervisorPid: 2147483646 }));
    const replaced = dev.startEmailWorker(first.options); started.push(replaced);
    expect(replaced.started).toBe(true);
  });

  it('restarts after a crash (bounded) but never after a configuration refusal (exit 78)', async () => {
    const crash = harness();
    const worker = dev.startEmailWorker(crash.options); started.push(worker);
    crash.children[0]!.emit('exit', 1);
    await settle();
    expect(crash.spawn).toHaveBeenCalledTimes(2);
    expect(crash.lines.some(line => line.includes('restarting'))).toBe(true);
    await worker.stop();

    const refused = harness();
    const second = dev.startEmailWorker(refused.options); started.push(second);
    refused.children[0]!.emit('exit', dev.EXIT_CONFIG_REFUSED);
    await settle();
    expect(refused.spawn).toHaveBeenCalledTimes(1);
    expect(refused.lines.join(' ')).toMatch(/STOPPED: configuration or schema refused/);
  });

  it('gives up after the restart budget and says purchases still succeed', async () => {
    const { options, spawn, children, lines } = harness({ maxRestarts: 2 });
    const worker = dev.startEmailWorker(options); started.push(worker);
    for (let index = 0; index < 4; index++) { children[children.length - 1]!.emit('exit', 1); await settle(); }
    expect(spawn).toHaveBeenCalledTimes(3); // initial + 2 restarts
    expect(lines.join(' ')).toMatch(/GAVE UP after 2 restarts/);
    expect(lines.join(' ')).toMatch(/Purchases still succeed/);
  });

  it('stop() kills the child and prevents any restart', async () => {
    const { options, spawn, children } = harness();
    const worker = dev.startEmailWorker(options);
    await worker.stop();
    expect(children[0]!.kill).toHaveBeenCalled();
    children[0]!.emit('exit', 1);
    await settle();
    expect(spawn).toHaveBeenCalledTimes(1);
  });
});
