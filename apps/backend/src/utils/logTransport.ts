import Transport from 'winston-transport';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { lock } from 'proper-lockfile';
import { Transform } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';

const MiB = 1024 * 1024;
function writeStderrBestEffort(line: string): void {
  try { process.stderr.write(line); } catch { /* The diagnostics fallback must not reject a request or poison the queue. */ }
}
export interface LogPolicy { maxBytes: number; days: number; archiveBytes: number }
export const LOG_POLICIES: Record<string, LogPolicy> = {
  app: { maxBytes: 20 * MiB, days: 14, archiveBytes: 500 * MiB },
  error: { maxBytes: 20 * MiB, days: 30, archiveBytes: 1024 * MiB },
};
export interface LoggingHealth { status: 'healthy' | 'warning'; failures: number; lastCode?: string }

/** All append, compression, recovery and cleanup operations share a directory lock. */
export class DurableLogTransport extends Transport {
  private pending: Promise<void> = Promise.resolve();
  private queued = 0;
  private queuedBytes = 0;
  private health: LoggingHealth = { status: 'healthy', failures: 0 };
  private timer: NodeJS.Timeout;
  private assertLease: () => void = () => {};
  constructor(private directory: string, private policies = LOG_POLICIES, private now = () => new Date(), private sanitizeArchive = (line: string) => line) {
    super();
    this.pending = this.maintain().catch(error => this.report('logging.startup_failed', error));
    this.timer = this.scheduleMidnight();
  }
  private scheduleMidnight(): NodeJS.Timeout {
    const current = this.now();
    const next = Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate() + 1);
    const timer = setTimeout(() => {
      this.pending = this.pending.then(() => this.maintain()).catch(error => this.report('logging.maintenance_failed', error));
      this.timer = this.scheduleMidnight();
    }, Math.max(1, next - current.getTime()));
    timer.unref(); return timer;
  }
  getHealth(): LoggingHealth { return { ...this.health }; }
  private report(operation: string, error: unknown): void {
    let rawCode: unknown;
    try { rawCode = error && typeof error === 'object' ? (error as NodeJS.ErrnoException).code : undefined; } catch { /* Treat hostile error accessors as generic logging failures. */ }
    const code = typeof rawCode === 'string' && /^[A-Z0-9_]+$/.test(rawCode) ? rawCode : 'LOGGING_FAILURE';
    this.health = { status: 'warning', failures: this.health.failures + 1, lastCode: code };
    writeStderrBestEffort(JSON.stringify({ timestamp: this.now().toISOString(), severity: 'error', operation, code, pid: process.pid }) + '\n');
  }
  log(info: Record<string | symbol, unknown>, callback: () => void): void {
    const line = String(info[Symbol.for('message')]) + '\n';
    const bytes = Buffer.byteLength(line);
    if (this.queued >= 10000 || this.queuedBytes + bytes > 16 * MiB) {
      this.report('logging.queue_full', { code: 'QUEUE_FULL' });
      writeStderrBestEffort(line); callback(); return;
    }
    this.queued++;
    this.queuedBytes += bytes;
    this.pending = this.pending.then(async () => {
      try {
        await this.withLock(async () => {
          // Failure in one file must never prevent delivery to the other.
          for (const name of info.level === 'error' ? ['error', 'app'] : ['app']) {
            try { await this.append(name, line, info.level === 'error'); }
            catch (error) { this.report(`logging.${name}.write_failed`, error); writeStderrBestEffort(line); }
          }
        });
      } catch (error) { this.report('logging.lock_failed', error); writeStderrBestEffort(line); }
      finally { this.queued--; this.queuedBytes -= bytes; }
    }).catch(error => { this.report('logging.queue_failed', error); });
    callback();
  }
  async flush(): Promise<void> { await this.pending; }
  close(): void { clearTimeout(this.timer); }
  async maintain(): Promise<void> {
    await this.withLock(async () => {
      for (const name of ['app', 'error']) {
        try {
          await this.recover(name);
          await this.rotateIfNeeded(name, 0);
          await this.cleanup(name);
        } catch (error) { this.report(`logging.${name}.maintenance_failed`, error); }
      }
    });
  }
  private async withLock(action: () => Promise<void>): Promise<void> {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    let compromised = false;
    const release = await lock(this.directory, {
      lockfilePath: path.join(this.directory, '.logging.lock'),
      stale: 5000, update: 1000,
      retries: { retries: 80, factor: 1, minTimeout: 100, maxTimeout: 100 },
      onCompromised: error => { compromised = true; this.report('logging.lock_compromised', error); },
    });
    this.assertLease = () => {
      if (compromised) throw Object.assign(new Error('Logging lease lost'), { code: 'ECOMPROMISED' });
    };
    try { await action(); }
    finally { this.assertLease = () => {}; await release(); }
  }
  private async rotateIfNeeded(name: string, incoming: number): Promise<void> {
    this.assertLease();
    const filename = path.join(this.directory, `${name}.log`);
    const file = await fs.open(filename, 'a', 0o600);
    await file.close();
    const stat = await fs.stat(filename);
    const activeDate = stat.mtime.toISOString().slice(0, 10);
    const rotationDate = this.now().toISOString().slice(0, 10);
    if (stat.size && (stat.size + incoming >= this.policies[name].maxBytes || activeDate < rotationDate)) {
      const names = await fs.readdir(this.directory);
      const matcher = new RegExp(`^${name}-${rotationDate}\\.(\\d+)\\.log(?:\\.gz)?$`);
      const numbers = names.map(entry => matcher.exec(entry)).filter(match => match !== null).map(match => Number(match[1]));
      // Persistent sequence survives cleanup and restart.
      const sequencePath = path.join(this.directory, `.${name}-${rotationDate}.sequence`);
      let previous = 0;
      try { previous = Number(await fs.readFile(sequencePath, 'utf8')) || 0; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      const sequence = Math.max(previous, 0, ...numbers) + 1;
      const sequenceTemporary = `${sequencePath}.tmp`;
      await fs.writeFile(sequenceTemporary, String(sequence), { mode: 0o600 });
      const sequenceFile = await fs.open(sequenceTemporary, 'r+');
      try { await sequenceFile.sync(); } finally { await sequenceFile.close(); }
      await fs.rename(sequenceTemporary, sequencePath);
      const archive = path.join(this.directory, `${name}-${rotationDate}.${sequence}.log`);
      this.assertLease(); await fs.rename(filename, archive);
      // Active filename is immediately restored; archive compression never holds it open.
      const active = await fs.open(filename, 'a', 0o600); await active.close();
      try { await this.compress(archive); }
      catch (error) { this.report(`logging.${name}.compression_failed`, error); }
      try { await this.cleanup(name); }
      catch (error) { this.report(`logging.${name}.cleanup_failed`, error); }
    }
  }
  private async compress(archive: string): Promise<void> {
    const target = `${archive}.gz`;
    const temporary = `${target}.tmp`;
    let fragments: string[] = [];
    const decoder = new StringDecoder('utf8');
    const sanitizeLine = this.sanitizeArchive;
    const redactor = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        const parts = decoder.write(chunk).split('\n');
        for (let index = 0; index < parts.length - 1; index++) {
          fragments.push(parts[index]);
          this.push(sanitizeLine(fragments.join('')) + '\n');
          fragments = [];
        }
        if (parts[parts.length - 1]) fragments.push(parts[parts.length - 1]);
        callback();
      },
      flush(callback) { fragments.push(decoder.end()); const line = fragments.join(''); if (line) this.push(sanitizeLine(line) + '\n'); callback(); },
    });
    await pipeline(createReadStream(archive), redactor, createGzip(), createWriteStream(temporary, { mode: 0o600 }));
    const file = await fs.open(temporary, 'r+'); try { await file.sync(); } finally { await file.close(); }
    this.assertLease(); await fs.rename(temporary, target);
    await fs.unlink(archive);
  }
  private async recover(name: string): Promise<void> {
    const matcher = new RegExp(`^${name}-\\d{4}-\\d{2}-\\d{2}\\.\\d+\\.log$`);
    const entries = await fs.readdir(this.directory);
    for (const entry of entries) {
      if (entry.startsWith(`${name}-`) && entry.endsWith('.log.gz.tmp')) {
        this.assertLease();
        await fs.unlink(path.join(this.directory, entry)).catch(error => {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        });
      }
    }
    for (const entry of entries) {
      if (matcher.test(entry)) await this.compress(path.join(this.directory, entry));
    }
  }
  private async cleanup(name: string): Promise<void> {
    const matcher = new RegExp(`^${name}-(\\d{4}-\\d{2}-\\d{2})\\.(\\d+)\\.log(?:\\.gz)?$`);
    const archives = [];
    for (const entry of await fs.readdir(this.directory)) {
      const match = matcher.exec(entry);
      if (match) archives.push({ entry, date: match[1], sequence: Number(match[2]), size: (await fs.stat(path.join(this.directory, entry))).size });
    }
    archives.sort((a, b) => a.date.localeCompare(b.date) || a.sequence - b.sequence);
    const cutoff = this.now().getTime() - this.policies[name].days * 86400000;
    let total = archives.reduce((sum, item) => sum + item.size, 0);
    for (const archive of archives) {
      if (Date.parse(`${archive.date}T00:00:00Z`) <= cutoff || total > this.policies[name].archiveBytes) {
        this.assertLease(); await fs.unlink(path.join(this.directory, archive.entry)); total -= archive.size;
      }
    }
  }
  private async append(name: string, line: string, durable: boolean): Promise<void> {
    try { await this.rotateIfNeeded(name, Buffer.byteLength(line)); }
    catch (error) { this.report(`logging.${name}.rotation_failed`, error); }
    this.assertLease();
    const file = await fs.open(path.join(this.directory, `${name}.log`), 'a', 0o600);
    try { await file.writeFile(line); if (durable) await file.sync(); }
    finally { await file.close(); }
  }
}
