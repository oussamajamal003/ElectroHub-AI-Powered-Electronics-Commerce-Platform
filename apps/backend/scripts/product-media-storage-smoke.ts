import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import path from 'node:path';
import sharp from 'sharp';
import { ProductMediaStorage, resolveProductMediaStorageConfig } from '../src/integrations/storage/product-media.storage.js';
import { normalizeProductMedia } from '../src/validators/product-media.validator.js';

// Explicit DEV-only real-provider smoke. No catalog references or historical media are modified.
async function main() {
  const raw = JSON.parse(readFileSync(path.resolve(__dirname, '../.product-media/dev.json'), 'utf8'));
  assert.equal(raw.SUPABASE_PROJECT_REF, 'pzxekjybdiulzmssalfo');
  const config = resolveProductMediaStorageConfig({ ...raw, NODE_ENV: 'development' }, 30_000);
  assert.ok(config);
  const headers = { apikey: config.secretKey ?? config.serviceRoleKey,
    ...(!config.secretKey ? { authorization: `Bearer ${config.serviceRoleKey}` } : {}), 'content-type': 'application/json' };
  const base = config.supabaseUrl.origin;
  const request = (suffix: string, init: RequestInit = {}) => fetch(`${base}/storage/v1${suffix}`,
    { ...init, headers: init.headers ?? headers, signal: AbortSignal.timeout(15000) });
  let response = await request('/bucket'); assert.ok(response.ok, `Bucket preflight HTTP ${response.status}`);
  const buckets: { id: string; public: boolean; file_size_limit: number; allowed_mime_types: string[] }[] = await response.json();
  let bucket = buckets.find(item => item.id === 'product-media');
  if (!bucket) {
    response = await request('/bucket', { method: 'POST', body: JSON.stringify({ id: 'product-media', name: 'product-media',
      public: true, file_size_limit: 12 * 1024 * 1024, allowed_mime_types: ['image/webp'] }) });
    assert.ok(response.ok, `Bucket creation HTTP ${response.status}`);
    response = await request('/bucket/product-media'); assert.ok(response.ok);
    bucket = await response.json();
  }
  assert.ok(bucket?.public); assert.equal(Number(bucket.file_size_limit), 12 * 1024 * 1024);
  assert.deepEqual(bucket.allowed_mime_types, ['image/webp']);
  const source = await sharp({ create: { width: 256, height: 256, channels: 3, background: '#2563eb' } }).png().toBuffer();
  const canonical = await normalizeProductMedia(source, 'image/png');
  const adapter = new ProductMediaStorage(config);
  const stored = await adapter.uploadImmutable({ productId: randomUUID(), imageId: randomUUID(), revision: randomUUID(),
    bytes: canonical.bytes, sha256: canonical.sha256 });
  try {
    response = await fetch(stored.url, { signal: AbortSignal.timeout(15000) });
    assert.ok(response.ok); assert.match(response.headers.get('content-type') ?? '', /^image\/webp/);
    assert.equal(createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex'), canonical.sha256);
    const unauthorized = await request(`/object/product-media/${stored.path.replace('original.webp', 'denied.webp')}`, {
      method: 'POST', headers: { apikey: raw.publicKey,
        ...(!String(raw.publicKey).startsWith('sb_publishable_') ? { authorization: `Bearer ${raw.publicKey}` } : {}),
        'content-type': 'image/webp' }, body: canonical.bytes });
    const denial: unknown = await unauthorized.json();
    const denialCode = denial && typeof denial === 'object' && 'statusCode' in denial ? String(denial.statusCode) : null;
    assert.ok([401, 403].includes(unauthorized.status) || (unauthorized.status === 400 && denialCode === '403'),
      `Expected authorization denial, received HTTP ${unauthorized.status} / code ${denialCode}`);
    console.log(JSON.stringify({ projectRef: raw.SUPABASE_PROJECT_REF, bucket: 'product-media', publicDelivery: 'VERIFIED',
      digest: canonical.sha256, contentType: 'image/webp', anonymousWrite: 'DENIED', anonymousWriteHttpStatus: unauthorized.status,
      anonymousWriteProviderCode: denialCode, objectPath: stored.path }));
  } finally { await adapter.remove(stored.path); }
  const removed = await request(`/object/product-media/${stored.path}`);
  assert.equal(removed.ok, false);
  console.log('PASS actual DEV Storage upload, digest read-back, public delivery, denied anonymous mutation and explicit disposable-object removal');
}
main().catch(error => { console.error(error instanceof Error ? error.message.replace(/(?:eyJ|sb_secret_)[^\s]+/g, '[REDACTED]') : 'STORAGE_SMOKE_FAILED'); process.exitCode = 1; });
