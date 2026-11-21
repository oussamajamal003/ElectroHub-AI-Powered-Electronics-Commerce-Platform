'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dir = __dirname;
const read = (name) => fs.readFileSync(path.join(dir, name), 'utf8');

test('TLS lifecycle source is allow-listed while private certificate formats stay ignored', () => {
  const ignore = fs.readFileSync(path.resolve(dir, '../../../.gitignore'), 'utf8');
  assert.match(ignore, /!infrastructure\/production\/tls\//);
  assert.match(ignore, /!infrastructure\/production\/tls\/\*\.sh/);
  assert.match(ignore, /!infrastructure\/production\/tls\/\*\.service/);
  assert.match(ignore, /!infrastructure\/production\/tls\/\*\.timer/);
  assert.match(ignore, /\*\.pem/);
  assert.match(ignore, /\*\.key/);
});

test('first certificate request is explicitly staging-only and DNS-hostname scoped', () => {
  const script = read('bootstrap-staging.sh');
  assert.match(script, /ELECTROHUB_TLS_ENV_FILE/);
  assert.match(script, /\. "\$tls_env"/);
  assert.match(script, /ACME_STAGING_ONLY:-false/);
  assert.match(script, /--staging/);
  assert.match(script, /--webroot/);
  assert.match(script, /cert-name.*-d/);
  assert.ok(script.includes('/var/lib/electrohub/acme'));
  assert.match(script, /exit 77/);
  assert.match(script, /TLS_INSTALLER:-\$script_dir\/install-certificate\.sh/);
  assert.match(script, /\/bin\/bash "\$installer"/);
});

test('ACME-only edge bootstrap requires opt-in and is stopped after staging attempt', () => {
  const script = read('bootstrap-staging-certificate.sh');
  assert.match(script, /ACME_STAGING_ONLY:-false/);
  assert.match(script, /exit 77/);
  assert.match(script, /trap cleanup EXIT/);
  assert.match(script, /edge-acme-bootstrap/);
  assert.match(script, /TLS_INSTALLER:-\$script_dir\/install-certificate\.sh/);
  assert.match(script, /\/bin\/bash "\$installer"/);
});

test('certificate installer validates host, expiry and key match before atomic switch and guarded reload', () => {
  const script = read('install-certificate.sh');
  assert.match(script, /-checkhost/);
  assert.match(script, /-checkend 86400/);
  assert.match(script, /cert_key_hash.*private_key_hash/s);
  assert.match(script, /install -o root -g "\$GROUP_ID" -m 0640/);
  assert.match(script, /mv -Tf -- "\$next" "\$current"/);
  assert.match(script, /nginx -t -c \/tmp\/electrohub-nginx\.conf/);
  assert.match(script, /nginx -s reload/);
  assert.match(script, /current-rollback/);
});

test('renewal and expiry units remain disabled by default and report failures locally', () => {
  assert.match(read('renew.sh'), /TLS_RENEWAL_ENABLED:-false/);
  assert.match(read('renew.sh'), /certbot renew --quiet/);
  assert.match(read('renew.sh'), /certbot-deploy-hook\.sh/);
  assert.match(read('electrohub-certbot-renew.service'), /\/bin\/bash \/var\/lib\/electrohub\/current\/source\/infrastructure\/production\/tls\/renew\.sh/);
  assert.match(read('electrohub-tls-expiry-check.service'), /check-expiry\.sh/);
  assert.match(read('electrohub-cert-expiry-check.service'), /check-certificate-expiry\.sh/);
  assert.doesNotMatch(read('electrohub-certbot-renew.service'), /\/usr\/local\/sbin\/electrohub-certbot-renew/);
  assert.doesNotMatch(read('renew.sh'), /--deploy-hook.*\$RENEWED_LINEAGE/);
  assert.match(read('certbot-deploy-hook.sh'), /"\$lineage" "\$host"/);
  assert.match(read('check-expiry.sh'), /TLS_EXPIRY_WARNING_SECONDS:-259200/);
  assert.match(read('electrohub-certbot-renew.timer'), /OnCalendar=\*-\*-\* 00,06,12,18:00:00/);
  assert.match(read('electrohub-tls-expiry-check.timer'), /OnCalendar=\*-\*-\* 00,06,12,18:00:00/);
  assert.match(read('electrohub-tls-alert@.service'), /logger -p daemon.err/);
});
