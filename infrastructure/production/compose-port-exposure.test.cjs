'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  validateComposePortExposure,
} = require('../../scripts/validate-compose-port-exposure.cjs');

function composeWith(api = {}, ai = {}) {
  return {
    services: {
      api,
      'ai-service': ai,
    },
  };
}

test('normal API configuration without published ports passes', () => {
  assert.doesNotThrow(() => validateComposePortExposure(composeWith({ expose: ['5000'], networks: ['backend'] })));
});

test('normal AI configuration without published ports passes', () => {
  assert.doesNotThrow(() => validateComposePortExposure(composeWith({}, { expose: ['8000'], networks: ['ai'] })));
});

test('synthetic API published port is rejected', () => {
  assert.throws(
    () => validateComposePortExposure(composeWith({ ports: [{ target: 5000, published: '5000', protocol: 'tcp' }] }, {})),
    /Service api publishes host ports/,
  );
});

test('synthetic AI published port is rejected', () => {
  assert.throws(
    () => validateComposePortExposure(composeWith({}, { ports: [{ target: 8000, published: '8000', protocol: 'tcp' }] })),
    /Service ai-service publishes host ports/,
  );
});

test('missing API service is rejected', () => {
  assert.throws(
    () => validateComposePortExposure({ services: { 'ai-service': {} } }),
    /missing required service: api/,
  );
});

test('missing AI service is rejected', () => {
  assert.throws(
    () => validateComposePortExposure({ services: { api: {} } }),
    /missing required service: ai-service/,
  );
});

test('internal service networking and expose settings are not host exposure', () => {
  assert.doesNotThrow(() => validateComposePortExposure(composeWith(
    { expose: ['5000'], networks: { backend: {}, ai: {} } },
    { expose: ['8000'], networks: { ai: {} } },
  )));
});

test('absent ports property passes', () => {
  assert.doesNotThrow(() => validateComposePortExposure(composeWith({ expose: ['5000'] }, { expose: ['8000'] })));
});

test('empty ports arrays pass', () => {
  assert.doesNotThrow(() => validateComposePortExposure(composeWith({ ports: [] }, { ports: [] })));
});

test('null ports property is rejected', () => {
  assert.throws(
    () => validateComposePortExposure(composeWith({ ports: null }, {})),
    /Rendered Compose service api has invalid ports data/,
  );
});

test('object ports property is rejected', () => {
  assert.throws(
    () => validateComposePortExposure(composeWith({ ports: {} }, {})),
    /Rendered Compose service api has invalid ports data/,
  );
});

test('string ports property is rejected', () => {
  assert.throws(
    () => validateComposePortExposure(composeWith({}, { ports: '5000' })),
    /Rendered Compose service ai-service has invalid ports data/,
  );
});

test('CI uses rendered Compose JSON and reusable port-exposure validation', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '..', '..', '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.match(workflow, /config --format json > "\$RUNNER_TEMP\/compose-default\.json"/);
  assert.match(workflow, /scripts\/validate-compose-port-exposure\.cjs "\$RUNNER_TEMP\/compose-default\.json"/);
  assert.doesNotMatch(workflow, /\/\^  ports:\/m\.test/);
});
