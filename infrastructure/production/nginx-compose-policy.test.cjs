'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const nginx = fs.readFileSync(path.join(__dirname, 'nginx.conf.template'), 'utf8');
const compose = fs.readFileSync(path.join(__dirname, 'compose.yaml'), 'utf8');

function service(name) {
  const match = new RegExp(`^  ${name}:\\r?\\n([\\s\\S]*?)(?=^  [A-Za-z0-9_-]+:|^networks:)`, 'm').exec(compose);
  assert.ok(match, `compose service is missing: ${name}`);
  return match[1];
}

test('production edge rejects untrusted hosts and never constructs a redirect from Host input', () => {
  assert.match(nginx, /listen 8080 default_server;[\s\S]*?return 444;/);
  assert.match(nginx, /listen 8443 ssl default_server;[\s\S]*?ssl_reject_handshake on;[\s\S]*?location \/ \{ return 444; \}/);
  assert.match(nginx, /return 308 https:\/\/\$\{CANONICAL_HOST\}\$request_uri;/);
  assert.doesNotMatch(nginx, /return\s+30[1278]\s+https:\/\/\$host/);
  assert.match(nginx, /server_name \$\{CANONICAL_HOST\};/);
});

test('production routes keep SPA, API, Socket.IO and health handling distinct', () => {
  assert.match(nginx, /location \^~ \/api\/ \{[\s\S]*?proxy_pass http:\/\/electrohub_backend;/);
  assert.match(nginx, /location \^~ \/socket\.io\/ \{[\s\S]*?proxy_set_header Upgrade \$http_upgrade;[\s\S]*?proxy_set_header Connection \$connection_upgrade;[\s\S]*?proxy_buffering off;/);
  assert.match(nginx, /location \^~ \/api\/health \{\s+return 404;/);
  assert.match(nginx, /location \/assets\/ \{\s+try_files \$uri =404;/);
  assert.match(nginx, /location = \/index\.html \{\s+add_header Cache-Control "no-store, no-cache, must-revalidate" always;/);
  assert.match(nginx, /immutable/);
  assert.match(nginx, /location ~\* \\.map\$ \{\s+return 404;/);
  assert.match(nginx, /try_files \$uri \$uri\/ \/index\.html;/);
  assert.doesNotMatch(nginx, /proxy_pass[^;]*delivery/);
  assert.match(nginx, /proxy_set_header X-Forwarded-For \$remote_addr;/);
  assert.match(nginx, /proxy_set_header X-Forwarded-Proto https;/);
  assert.match(nginx, /worker_processes 1;/);
});

test('production Compose publishes only the edge and keeps API/AI without host ports', () => {
  assert.match(service('edge'), /ports:[\s\S]*?:80:8080[\s\S]*?:443:8443/);
  assert.doesNotMatch(service('api'), /^\s+ports:/m);
  assert.doesNotMatch(service('ai-service'), /^\s+ports:/m);
  assert.match(service('api'), /context: \.\.\/\.\./);
  assert.match(service('edge'), /context: \.\.\/\.\./);
  assert.match(service('edge'), /dockerfile: infrastructure\/production\/Dockerfile\.edge/);
  assert.match(service('ai-service'), /context: \.\.\/\.\.\/apps\/ai-service/);
  assert.match(compose, /backend:\s*\n\s+name: electrohub-production-backend\s*\n\s+internal: true/);
  assert.match(compose, /profiles: \[payment-worker\]/);
  assert.match(compose, /profiles: \[commerce-email-worker\]/);
  assert.match(compose, /profiles: \[media-worker\]/);
  assert.doesNotMatch(compose, /docker\.sock|privileged:\s*true/);
});
