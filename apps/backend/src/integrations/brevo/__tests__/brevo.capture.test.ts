import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrevoProvider, emailCaptureDirectory } from '../brevo.provider.js';

/**
 * Task 05.2 local email capture. A disposable development stack (loopback database) captures admin activation / recovery mail for
 * synthetic .invalid recipients and never reaches the real provider; shared DEV (remote database) and production never capture.
 */
const mutableEnv = vi.hoisted(() => ({ NODE_ENV: 'development', DATABASE_URL: 'postgresql://postgres@127.0.0.1:5432/db', E2E_OTP_OUTBOX_DIR: '' as string | undefined,
  BREVO_API_KEY: 'should-never-be-used', BREVO_SENDER_EMAIL: 'no-reply@example.com', BREVO_SENDER_NAME: 'ElectroHub' }));
vi.mock('../../../config/env.js', async importOriginal => ({ ...await importOriginal<typeof import('../../../config/env.js')>(), env: mutableEnv }));


describe('local email capture', () => {
  let outbox: string;
  const send = vi.fn();
  const provider = () => new BrevoProvider({ sendSmtpEmail: send } as never, { email: 'no-reply@example.com', name: 'ElectroHub' });
  const mail = (to: string) => provider().sendTransactionalEmail({ to, subject: 'Activate your ElectroHub administrator account', htmlContent: '<p>x</p>',
    textContent: 'Activate: http://localhost:3000/admin/activate#token=abc' });

  beforeEach(() => {
    outbox = mkdtempSync(path.join(tmpdir(), 'eh-outbox-'));
    Object.assign(mutableEnv, { NODE_ENV: 'development', DATABASE_URL: 'postgresql://postgres@127.0.0.1:5432/db', E2E_OTP_OUTBOX_DIR: outbox });
    send.mockReset().mockResolvedValue({ messageId: 'real-provider-id' });
  });
  afterEach(() => rmSync(outbox, { recursive: true, force: true }));

  it('a loopback development stack captures .invalid mail locally and never calls the provider', async () => {
    expect(emailCaptureDirectory()).toBe(outbox);
    const result = await mail('legacy-linked@qa.invalid');
    expect(result.success).toBe(true);
    expect(send).not.toHaveBeenCalled();
    const files = readdirSync(outbox);
    expect(files).toHaveLength(1);
    const record = JSON.parse(readFileSync(path.join(outbox, files[0]!), 'utf8'));
    expect(record).toMatchObject({ to: 'legacy-linked@qa.invalid', subject: 'Activate your ElectroHub administrator account' });
    expect(record.textContent).toContain('/admin/activate#token=');
    expect(record.sentAt).toEqual(expect.any(String));
  });

  it('a capture stack refuses any real recipient instead of sending it', async () => {
    const result = await mail('someone@electrohub.com');
    expect(result.success).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(readdirSync(outbox)).toHaveLength(0);
  });

  it('a remote (shared DEV) database or production never captures: mail goes to the real provider path', async () => {
    mutableEnv.DATABASE_URL = 'postgresql://postgres.abcdefghijklmnopqrst:x@aws-0-eu.pooler.supabase.com:6543/postgres';
    expect(emailCaptureDirectory()).toBeNull();
    await mail('legacy-linked@qa.invalid');
    expect(send).toHaveBeenCalledTimes(1);
    expect(readdirSync(outbox)).toHaveLength(0);
    mutableEnv.DATABASE_URL = 'postgresql://postgres@127.0.0.1:5432/db';
    mutableEnv.NODE_ENV = 'production';
    expect(emailCaptureDirectory()).toBeNull();
  });

  it('without an outbox folder nothing is captured', () => {
    mutableEnv.E2E_OTP_OUTBOX_DIR = undefined;
    expect(emailCaptureDirectory()).toBeNull();
  });
});
