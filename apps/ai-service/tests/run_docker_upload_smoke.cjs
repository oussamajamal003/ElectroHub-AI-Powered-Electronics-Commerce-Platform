#!/usr/bin/env node
/** Disposable QA only. Mounts the real model, tests and CA read-only; never prints credential-bearing arguments. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

function main() {
const service = path.resolve(__dirname, '..');
const qa = path.resolve(service, '../backend/.isolated-docker');
const configuration = JSON.parse(fs.readFileSync(path.join(qa, 'env.json'), 'utf8'));
const roles = JSON.parse(fs.readFileSync(path.join(qa, 'ai-vector-roles.json'), 'utf8'));
const reader = new URL(roles.dsn.AI_VECTOR_DATABASE_URL);
if (reader.hostname !== 'localhost' || reader.port !== '55434' || reader.pathname !== '/electrohub_disposable' ||
    reader.username !== 'ai_vector_reader') throw new Error('Refusing: expected the dedicated disposable QA reader.');
reader.search = '?sslmode=verify-full&sslrootcert=/run/qa-ca.crt&hostaddr=127.0.0.1';
const wsl = (...args) => execFileSync('wsl', ['-d', 'Ubuntu', '-u', 'root', '--', ...args], {
  encoding: 'utf8', maxBuffer: 2 * 1024 * 1024,
});
const linuxPath = value => wsl('wslpath', '-a', value.replace(/\\/g, '/')).trim();
const envFile = path.join(qa, `docker-upload-${crypto.randomUUID()}.env`);
fs.writeFileSync(envFile, [
  'AI_ENVIRONMENT=qa',
  'AI_BIND_HOST=127.0.0.1',
  'AI_PORT=18200',
  'TMPDIR=/dev/shm',
  'AI_ENV_FILE=/run/no-runtime-env',
  'AI_MODEL_ARTIFACT_DIR=/srv/ai-models',
  `AI_SERVICE_API_KEY=${crypto.randomBytes(32).toString('hex')}`,
  `AI_VECTOR_DATABASE_URL=${reader.toString()}`,
  'PYTHONPATH=/qa',
  '',
].join('\n'), { mode: 0o600, flag: 'wx' });
try {
  const output = wsl('docker', 'run', '--rm', '--pull=never', '--network=host', '--read-only',
    '--cap-drop=ALL', '--security-opt=no-new-privileges',
    '--env-file', linuxPath(envFile),
    '-v', `${linuxPath(path.join(service, 'models/effb0-commons-v2'))}:/srv/ai-models:ro`,
    '-v', `${linuxPath(path.join(service, 'tests'))}:/qa/tests:ro`,
    '-v', `${linuxPath(configuration.DB_SSL_CA_CERT_PATH)}:/run/qa-ca.crt:ro`,
    '--entrypoint', 'python', process.argv[2] || 'electrohub-ai:task-04.2-closure', '/qa/tests/docker_upload_smoke.py');
  process.stdout.write(output);
} catch (error) {
  // Docker diagnostics can contain env-file contents or connection strings. Never echo generic error/stderr objects.
  console.error('Docker upload smoke failed; inspect sanitized check output and the local runtime prerequisites.');
  if (error.stdout) process.stdout.write(error.stdout);
  process.exitCode = 1;
} finally {
  fs.unlinkSync(envFile);
}
}

try { main(); } catch {
  console.error('Refusing Docker smoke: missing or invalid local QA prerequisites. No credential values are displayed.');
  process.exitCode = 1;
}
