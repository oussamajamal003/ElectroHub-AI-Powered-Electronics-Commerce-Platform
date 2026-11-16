import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { gunzipSync } from 'node:zlib';
import { spawn } from 'node:child_process';
import { createApplicationLogger, sanitize, logContext } from '../src/utils/logger.js';
import { DurableLogTransport, LOG_POLICIES } from '../src/utils/logTransport.js';

const directories: string[] = [];
const runtimes: ReturnType<typeof createApplicationLogger>[] = [];
async function directory() { const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'electrohub-logging-')); directories.push(dir); return dir; }
function runtime(dir: string, maxBytes = 2000, now?: () => Date) {
  const result = createApplicationLogger(dir, { app: { ...LOG_POLICIES.app, maxBytes }, error: { ...LOG_POLICIES.error, maxBytes } }, now);
  runtimes.push(result); return result;
}
async function records(dir: string, name: string) {
  const result: Record<string, unknown>[] = [];
  for (const filename of await fs.readdir(dir)) {
    if (filename === `${name}.log` || filename.startsWith(`${name}-`) && filename.endsWith('.gz')) {
      const bytes = await fs.readFile(path.join(dir, filename));
      const content = filename.endsWith('.gz') ? gunzipSync(bytes).toString() : bytes.toString();
      result.push(...content.trim().split('\n').filter(Boolean).map(line => JSON.parse(line)));
    }
  }
  return result;
}
afterEach(async () => {
  for (const item of runtimes.splice(0)) { await item.flush(); item.logger.close(); }
  vi.restoreAllMocks();
  vi.useRealTimers();
  for (const dir of directories.splice(0)) await fs.rm(dir, { recursive: true, force: true });
});
describe('durable logging policy', () => {
  it('uses exact production limits', () => {
    expect(LOG_POLICIES.app).toEqual({ maxBytes: 20 * 1024 ** 2, days: 14, archiveBytes: 500 * 1024 ** 2 });
    expect(LOG_POLICIES.error).toEqual({ maxBytes: 20 * 1024 ** 2, days: 30, archiveBytes: 1024 ** 3 });
  });
  it('rotates an actual 20 MiB active file at startup', async () => {
    const dir = await directory();
    const prefix = '{"payload":"'; const suffix = '"}\n';
    await fs.writeFile(path.join(dir, 'app.log'), prefix + 'x'.repeat(LOG_POLICIES.app.maxBytes - prefix.length - suffix.length) + suffix);
    const item = createApplicationLogger(dir); runtimes.push(item); await item.flush();
    expect((await fs.stat(path.join(dir, 'app.log'))).size).toBe(0);
    const archive = (await fs.readdir(dir)).find(name => name.startsWith('app-') && name.endsWith('.gz'))!;
    expect(JSON.parse(gunzipSync(await fs.readFile(path.join(dir, archive))).toString()).payload).toBe('[REDACTED]');
  });
  it('preserves all records through rotation, gzip and restart', async () => {
    const dir = await directory(); const first = runtime(dir);
    for (let index = 0; index < 40; index++) first.logger.error('Test event', { operation: 'test.event', index });
    await first.flush(); first.logger.close();
    const second = runtime(dir); second.logger.info('Restarted', { operation: 'test.restart' }); await second.flush();
    const app = await records(dir, 'app'); const errors = await records(dir, 'error');
    expect(app).toHaveLength(41); expect(errors).toHaveLength(40);
    expect(new Set(errors.map(item => item.index)).size).toBe(40);
    const archives = (await fs.readdir(dir)).filter(name => name.endsWith('.gz'));
    expect(archives.length).toBeGreaterThan(2);
    expect(archives.every(name => /^(app|error)-\d{4}-\d{2}-\d{2}\.\d+\.log\.gz$/.test(name))).toBe(true);
  });
  it('rotates at UTC midnight, even without new traffic', async () => {
    const dir = await directory(); await fs.writeFile(path.join(dir, 'app.log'), 'old\n');
    await fs.utimes(path.join(dir, 'app.log'), new Date('2026-10-12T23:59:59Z'), new Date('2026-10-12T23:59:59Z'));
    const item = runtime(dir, 2000, () => new Date('2026-10-13T00:00:00Z')); await item.flush();
    expect(await fs.readFile(path.join(dir, 'app.log'), 'utf8')).toBe('');
    expect(JSON.parse(gunzipSync(await fs.readFile(path.join(dir, 'app-2026-10-13.1.log.gz'))).toString()).message).toBe('old');
  });
  it('runs the midnight timer during runtime', async () => {
    const dir = await directory();
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-13T23:59:59Z'));
    const item = runtime(dir, 2000, () => new Date()); await item.flush();
    item.logger.info('Before midnight'); await item.flush();
    await fs.utimes(path.join(dir, 'app.log'), new Date(), new Date());
    await vi.advanceTimersByTimeAsync(1000); await item.flush();
    expect(await fs.readdir(dir)).toContain('app-2026-10-14.1.log.gz');
  });
  it('keeps sequences increasing when storage cleanup removes earlier archives', async () => {
    const dir = await directory();
    const policies = { app: { ...LOG_POLICIES.app, maxBytes: 500, archiveBytes: 0 }, error: LOG_POLICIES.error };
    const first = createApplicationLogger(dir, policies); runtimes.push(first);
    for (let i = 0; i < 5; i++) first.logger.info('Rotate fixture', { index: i });
    await first.flush(); first.logger.close();
    const marker = (await fs.readdir(dir)).find(name => name.startsWith('.app-'))!;
    const sequence = Number(await fs.readFile(path.join(dir, marker), 'utf8'));
    const second = createApplicationLogger(dir, policies); runtimes.push(second);
    second.logger.info('After restart'); await second.flush();
    expect(Number(await fs.readFile(path.join(dir, marker), 'utf8'))).toBeGreaterThan(sequence);
    expect((await fs.readdir(dir)).filter(name => name.endsWith('.gz'))).toHaveLength(0);
  });
  it('preserves a closed archive during compression failure and recovers on restart', async () => {
    const dir = await directory(); const date = new Date().toISOString().slice(0, 10);
    const archive = `app-${date}.1.log`;
    await fs.writeFile(path.join(dir, archive), '{"operation":"before.failure"}\n');
    await fs.mkdir(path.join(dir, `${archive}.gz.tmp`));
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const first = runtime(dir); first.logger.info('Still writable'); await first.flush();
    expect(first.health().status).toBe('warning'); expect(await fs.readFile(path.join(dir, archive), 'utf8')).toContain('before.failure');
    first.logger.close(); await fs.rmdir(path.join(dir, `${archive}.gz.tmp`));
    const second = runtime(dir); await second.flush();
    expect(await records(dir, 'app')).toHaveLength(2); expect(stderr).toHaveBeenCalled();
  });
  it('counts recoverable uncompressed archives toward retention storage', async () => {
    const dir = await directory();
    const archive = 'app-2026-10-12.1.log';
    await fs.writeFile(path.join(dir, archive), '12345');
    const transport = new DurableLogTransport(dir, { app: { ...LOG_POLICIES.app, archiveBytes: 4 }, error: LOG_POLICIES.error }, () => new Date('2026-10-13T00:00:00Z'));
    await transport.flush(); transport.close();
    expect((await fs.readdir(dir)).some(name => name.startsWith('app-2026-10-12.1.log'))).toBe(false);
    expect(await fs.readFile(path.join(dir, 'app.log'))).toBeDefined();
  });
  it('reclaims a crashed writer without losing existing records', async () => {
    const dir = await directory(); await fs.mkdir(path.join(dir, '.logging.lock'));
    await fs.utimes(path.join(dir, '.logging.lock'), new Date(0), new Date(0));
    const item = runtime(dir); item.logger.error('After crashed writer'); await item.flush();
    expect(await records(dir, 'error')).toHaveLength(1);
  });
  it('continues automatically after a real lock holder is killed', async () => {
    const dir = await directory();
    const child = spawn(process.execPath, ['--import', 'tsx', path.resolve('tests/fixtures/log-writer.ts'), 'hold', dir], {
      env: { ...process.env, ELECTROHUB_LOG_DIR: dir }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    await new Promise<void>((resolve, reject) => {
      child.on('error', reject); child.stdout.on('data', chunk => { if (String(chunk).includes('READY')) resolve(); });
    });
    const stopped = new Promise<void>(resolve => child.on('exit', () => resolve()));
    child.kill('SIGKILL'); await stopped;
    const item = runtime(dir); item.logger.error('After abrupt termination'); await item.flush();
    expect(await records(dir, 'error')).toHaveLength(1); expect(item.health().status).toBe('healthy');
  }, 15000);
  it('cleans expired archives first and then the oldest by storage, preserving active files', async () => {
    const dir = await directory();
    for (const name of ['app-2026-09-01.1.log.gz', 'app-2026-10-11.1.log.gz', 'app-2026-10-12.1.log.gz', 'error-2026-09-20.1.log.gz']) await fs.writeFile(path.join(dir, name), '12345');
    const transport = new DurableLogTransport(dir, { app: { ...LOG_POLICIES.app, archiveBytes: 5 }, error: LOG_POLICIES.error }, () => new Date('2026-10-13T00:00:00Z'));
    await transport.flush(); transport.close();
    const names = await fs.readdir(dir);
    expect(names).toContain('app.log'); expect(names).toContain('error.log');
    expect(names).not.toContain('app-2026-09-01.1.log.gz'); expect(names).not.toContain('app-2026-10-11.1.log.gz');
    expect(names).toContain('app-2026-10-12.1.log.gz'); expect(names).toContain('error-2026-09-20.1.log.gz');
  });
  it('sanitizes nested arrays, errors, messages and correlation context', async () => {
    const dir = await directory(); const item = runtime(dir);
    logContext.run({ requestId: 'safe-id' }, () => item.logger.error('token=hidden contact a@example.com', { operation: 'test.redact', nested: [{ password: 'hidden', card: 'hidden', email: 'hidden', name: 'hidden' }], error: new Error('postgresql://user:pass@host/db sk_test_hidden') }));
    await item.flush(); const text = JSON.stringify(await records(dir, 'error'));
    expect(text).not.toContain('hidden'); expect(text).not.toContain('user:pass'); expect(text).not.toContain('a@example.com');
    expect(text).toContain('safe-id'); expect(text).toContain('stack');
    const cycle: Record<string, unknown> = {}; cycle.self = cycle; expect(() => sanitize(cycle)).not.toThrow();
  });
  it('keeps causal error classification but discards raw exception messages and parameters', () => {
    const database = Object.assign(new Error('SELECT private_email FROM customers WHERE token=secret-value'), { code: 'P2024' });
    const wrapped = Object.assign(new Error('provider wrapper contained pi_test_secret_value'), { errorCode: 'P2028', cause: database });
    const output = JSON.stringify(sanitize(wrapped));
    expect(output).toContain('P2028'); expect(output).toContain('P2024');
    expect(output).not.toMatch(/private_email|customers|secret-value|pi_test_secret_value|token=secret/);
    expect(JSON.stringify(sanitize({ error: { message: 'SELECT sensitive_data FROM private_table', code: 'P2028' }, request: { authorization: 'Bearer secret' } })))
      .not.toMatch(/sensitive_data|private_table|Bearer secret|P2028/);
  });
  it.each(['app', 'error'])('keeps the other file writable when %s fails and surfaces health warning', async broken => {
    const dir = await directory(); await fs.mkdir(path.join(dir, `${broken}.log`));
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const item = runtime(dir); item.logger.error('Disk failure fixture', { password: 'must-never-leak' }); await item.flush();
    expect(await records(dir, broken === 'app' ? 'error' : 'app')).toHaveLength(1);
    expect(item.health().status).toBe('warning'); expect(stderr).toHaveBeenCalled();
    expect(JSON.stringify(stderr.mock.calls)).not.toContain('must-never-leak');
  });
  it('keeps the durable queue writable when both a log file and stderr fallback fail', async () => {
    const dir = await directory(); await fs.mkdir(path.join(dir, 'error.log'));
    const transport = new DurableLogTransport(dir);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => { throw new Error('fallback sink unavailable'); });
    const callback = vi.fn();
    try {
      transport.log({ level: 'error', [Symbol.for('message')]: JSON.stringify({ operation: 'first.error' }) }, callback);
      await expect(transport.flush()).resolves.toBeUndefined();
      transport.log({ level: 'info', [Symbol.for('message')]: JSON.stringify({ operation: 'second.info' }) }, callback);
      await expect(transport.flush()).resolves.toBeUndefined();
      expect(callback).toHaveBeenCalledTimes(2);
      expect(transport.getHealth().status).toBe('warning');
      expect((await records(dir, 'app')).map(record => record.operation)).toEqual(['first.error', 'second.info']);
    } finally { transport.close(); stderr.mockRestore(); }
  });
  it.each(['ENOSPC', 'EACCES'])('reports sanitized %s diagnostics and continues the independent file', async code => {
    const dir = await directory();
    const transport = new DurableLogTransport(dir); await transport.flush();
    const target = transport as unknown as { append: (name: string, line: string, durable: boolean) => Promise<void> };
    const original = target.append.bind(transport);
    vi.spyOn(target, 'append').mockImplementation(async (name, line, durable) => {
      if (name === 'app') throw Object.assign(new Error('private filesystem credentials'), { code });
      await original(name, line, durable);
    });
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    transport.log({ level: 'error', [Symbol.for('message')]: '{"operation":"fixture.failure"}' }, () => {});
    await transport.flush(); transport.close();
    expect(transport.getHealth()).toMatchObject({ status: 'warning', lastCode: code });
    expect(await records(dir, 'error')).toHaveLength(1);
    expect(JSON.stringify(stderr.mock.calls)).not.toContain('private filesystem credentials');
  });
  it('serializes real child processes during concurrent rotation', async () => {
    const dir = await directory();
    const run = (worker: string) => new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, ['--import', 'tsx', path.resolve('tests/fixtures/log-writer.ts'), dir, worker], { env: { ...process.env, ELECTROHUB_LOG_DIR: dir }, stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk; });
      child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(`child exit ${code}: ${stderr}`)));
    });
    await Promise.all([run('one'), run('two'), run('three')]);
    const app = await records(dir, 'app'); const errors = await records(dir, 'error');
    expect(app).toHaveLength(90); expect(errors).toHaveLength(90);
    expect(new Set(app.map(item => `${item.worker}:${item.index}`)).size).toBe(90);
  }, 20000);
  it.each(['fatal', 'rejection'])('flushes %s evidence before exiting a child process', async mode => {
    const dir = await directory();
    const code = await new Promise<number | null>((resolve, reject) => {
      const child = spawn(process.execPath, ['--import', 'tsx', path.resolve('tests/fixtures/log-writer.ts'), mode], { env: { ...process.env, ELECTROHUB_LOG_DIR: dir }, stdio: 'ignore' });
      child.on('error', reject); child.on('exit', resolve);
    });
    expect(code).toBe(1); const errors = await records(dir, 'error');
    expect(errors).toHaveLength(1); expect(JSON.stringify(errors)).not.toContain('=private');
  });
  it('captures invalid configuration before server imports can start traffic', async () => {
    const dir = await directory();
    const code = await new Promise<number | null>((resolve, reject) => {
      const child = spawn(process.execPath, ['--import', 'tsx', path.resolve('tests/fixtures/log-writer.ts'), 'startup'], {
        env: { ...process.env, PORT: 'invalid-port', ELECTROHUB_LOG_DIR: dir }, stdio: 'ignore',
      });
      child.on('error', reject); child.on('exit', resolve);
    });
    expect(code).toBe(1);
    expect((await records(dir, 'error')).some(record => record.operation === 'runtime.startup_failed')).toBe(true);
  });
  it('emits production JSON to stdout and stderr for centralized collectors', async () => {
    const dir = await directory();
    const output = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(process.execPath, ['--import', 'tsx', path.resolve('tests/fixtures/log-writer.ts'), 'streams', dir], {
        env: { ...process.env, NODE_ENV: 'production', ELECTROHUB_LOG_DIR: dir }, stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = ''; let stderr = '';
      child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
      child.on('error', reject); child.on('exit', code => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`child exit ${code}`)));
    });
    expect(JSON.parse(output.stdout.trim())).toMatchObject({ operation: 'deployment.info', severity: 'info' });
    expect(JSON.parse(output.stderr.trim())).toMatchObject({ operation: 'deployment.error', severity: 'error' });
    expect(await records(dir, 'app')).toHaveLength(2); expect(await records(dir, 'error')).toHaveLength(1);
  });
});
