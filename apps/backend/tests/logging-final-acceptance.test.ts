import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { gunzipSync } from 'node:zlib';
import { createApplicationLogger, logContext, flushLogs, flushLogsWithDeadline, loggingHealth } from '../src/utils/logger.js';
import { DurableLogTransport, LOG_POLICIES } from '../src/utils/logTransport.js';

const runtimes: ReturnType<typeof createApplicationLogger>[] = [];
const directories: string[] = [];
async function runtime(rotate = false) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'electrohub-final-logging-'));
  directories.push(directory);
  const policies = rotate ? { app: { ...LOG_POLICIES.app, maxBytes: 1 }, error: { ...LOG_POLICIES.error, maxBytes: 1 } } : LOG_POLICIES;
  const result = createApplicationLogger(directory, policies); runtimes.push(result);
  return { ...result, directory };
}
afterEach(async () => {
  vi.restoreAllMocks(); vi.useRealTimers();
  for (const item of runtimes.splice(0)) { await item.flush(); item.logger.close(); }
  for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true });
});

describe('final acceptance output boundaries', () => {
  it('cannot preserve unsanitized metadata beyond the sanitizer field limit', async () => {
    const item = await runtime();
    const metadata = Object.fromEntries(Array.from({ length: 110 }, (_, index) => [`field${index}`, index]));
    item.logger.error('Overflow metadata fixture', { ...metadata, password: 'overflow-private-credential' });
    await item.flush();
    for (const file of ['app.log', 'error.log']) expect(await fs.readFile(path.join(item.directory, file), 'utf8')).not.toContain('overflow-private-credential');
  });
  it('sanitizes correlation values added from asynchronous context', async () => {
    const item = await runtime();
    const token = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJwcml2YXRlIn0.privateSignature';
    logContext.run({ requestId: token }, () => item.logger.info('Correlation fixture'));
    await item.flush();
    const record = JSON.parse(await fs.readFile(path.join(item.directory, 'app.log'), 'utf8'));
    expect(record.requestId).not.toBe(token); expect(record.correlationId).not.toBe(token);
    expect(record.requestId).toBe('[REDACTED_TOKEN]');
  });
  it('preserves sanitized error classification and stack after gzip rotation', async () => {
    const item = await runtime(true);
    const error = Object.assign(new Error('password=archive-private'), { name: 'PrismaClientKnownRequestError', code: 'P2028' });
    item.logger.error('Archived error fixture', { error }); await item.flush();
    item.logger.error('Next error fixture', { error: new Error('Next error') }); await item.flush();
    const archive = (await fs.readdir(item.directory)).find(file => /^error-.*\.log\.gz$/.test(file));
    expect(archive).toBeDefined();
    const record = JSON.parse(gunzipSync(await fs.readFile(path.join(item.directory, archive!))).toString());
    expect(record.error).toMatchObject({ errorType: 'PrismaClientKnownRequestError', code: 'P2028' });
    expect(record.error.stack).toContain('at '); expect(JSON.stringify(record)).not.toContain('archive-private');
  });
  it('bounds a stalled lifecycle flush and surfaces a sanitized health warning', async () => {
    await flushLogs(); vi.useFakeTimers();
    vi.spyOn(DurableLogTransport.prototype, 'flush').mockImplementation(() => new Promise(() => {}));
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const pending = flushLogsWithDeadline();
    await vi.advanceTimersByTimeAsync(2000);
    expect(await pending).toBe(false);
    expect(loggingHealth()).toMatchObject({ status: 'warning', lastCode: 'LOG_FLUSH_TIMEOUT' });
    expect(stderr.mock.calls.map(([line]) => String(line)).join('')).toContain('LOG_FLUSH_TIMEOUT');
  });
  it('does not let a rejected flush replace a lifecycle failure or expose its raw error', async () => {
    await flushLogs();
    vi.spyOn(DurableLogTransport.prototype, 'flush').mockRejectedValue(new Error('password=private-flush-details'));
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    expect(await flushLogsWithDeadline()).toBe(false);
    expect(loggingHealth()).toMatchObject({ status: 'warning', lastCode: 'LOG_FLUSH_FAILED' });
    expect(stderr.mock.calls.map(([line]) => String(line)).join('')).not.toContain('private-flush-details');
  });
});
