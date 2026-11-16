'use strict';
// Read-only provider preflight. Secrets are kept in the ignored server-only directory, never stdout.
const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const backend = path.resolve(__dirname, '..');
const refs = { DEV: 'pzxekjybdiulzmssalfo', PROD: 'yepfgjehdstlxbpespun' };
const target = process.argv[2];
if (!refs[target]) throw new Error('Usage: product-media-hosted.cjs DEV|PROD');
const ref = refs[target];
const values = ['.env', '.env.local'].reduce((all, name) => {
  const file = path.join(backend, name);
  return fs.existsSync(file) ? { ...all, ...dotenv.parse(fs.readFileSync(file)) } : all;
}, {});
async function management(suffix) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${ref}${suffix}`, {
    headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN || values.SUPABASE_ACCESS_TOKEN}` }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`PROVIDER_PREFLIGHT_HTTP_${response.status}`);
  return response.json();
}
async function main() {
  const project = await management('');
  if (project.id !== ref || project.status !== 'ACTIVE_HEALTHY') throw new Error('PROVIDER_IDENTITY_REFUSED');
  const keys = await management('/api-keys?reveal=true');
  const privileged = keys.find(key => key.type === 'secret' && key.api_key) || keys.find(key => key.name === 'service_role' && key.api_key);
  const publicKey = keys.find(key => key.type === 'publishable' && key.api_key) || keys.find(key => key.name === 'anon' && key.api_key);
  if (!privileged || !publicKey) throw new Error('PROVIDER_KEYS_UNAVAILABLE');
  const config = { SUPABASE_URL: `https://${ref}.supabase.co`, SUPABASE_PROJECT_REF: ref,
    [privileged.type === 'secret' ? 'SUPABASE_SECRET_KEY' : 'SUPABASE_SERVICE_ROLE_KEY']: privileged.api_key,
    publicKey: publicKey.api_key, PRODUCT_MEDIA_BUCKET: 'product-media' };
  const dir = path.join(backend, '.product-media'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${target.toLowerCase()}.json`), JSON.stringify(config), { mode: 0o600 });
  const response = await fetch(`${config.SUPABASE_URL}/storage/v1/bucket`, {
    headers: { apikey: privileged.api_key, ...(privileged.type === 'secret' ? {} : { Authorization: `Bearer ${privileged.api_key}` }) }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`STORAGE_PREFLIGHT_HTTP_${response.status}`);
  const buckets = await response.json();
  console.log(JSON.stringify({ target, projectRef: ref, projectStatus: project.status, region: project.region,
    credentialStored: true, productMediaBucket: buckets.filter(bucket => bucket.id === 'product-media').map(bucket => ({
      id: bucket.id, public: bucket.public, fileSizeLimit: bucket.file_size_limit, allowedMimeTypes: bucket.allowed_mime_types })) }));
  try {
    const backup = await management('/database/backups');
    console.log(JSON.stringify({ target, backupAvailable: Array.isArray(backup.backups) && backup.backups.length > 0,
      pitrEnabled: backup.pitr_enabled === true }));
  } catch { console.log(JSON.stringify({ target, backupAvailability: 'NOT_VERIFIED' })); }
}
main().catch(error => { console.error(error instanceof Error && /^[A-Z_]+(?:_\d+)?$/.test(error.message) ? error.message : 'PROVIDER_PREFLIGHT_FAILED'); process.exitCode = 1; });
