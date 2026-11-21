'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { validateManifest, verifyBundleFiles } = require('./verify-release-manifest.cjs');

const sha = '0123456789abcdef0123456789abcdef01234567';
const digest = `sha256:${'a'.repeat(64)}`;
const manifest = () => ({
  schemaVersion: 1,
  releaseSha: sha,
  sourceArchive: { file: 'source.tar.gz', sha256: 'b'.repeat(64) },
  imageArchive: { file: 'images.tar', sha256: 'c'.repeat(64) },
  aiProductionRelease: { file: 'AI_PRODUCTION_RELEASE.json', sha256: 'e'.repeat(64) },
  aiModelManifest: { file: 'AI_MODEL_ARTIFACT_PRODUCTION.json', sha256: 'd'.repeat(64) },
  images: ['backend', 'ai-service', 'edge'].map((name) => ({ name, reference: `electrohub/${name}:${sha}`, configDigest: digest })),
});

test('exact-SHA release manifest validates all image refs and content digests', () => {
  assert.equal(validateManifest(manifest(), sha), true);
});

test('release manifest rejects a mismatched SHA, mutable/unexpected reference, digest or archive path', () => {
  assert.throws(() => validateManifest(manifest(), 'f'.repeat(40)), /SHA/);
  const badImage = manifest();
  badImage.images[0].reference = 'electrohub/backend:latest';
  assert.throws(() => validateManifest(badImage, sha), /reference/);
  const badDigest = manifest();
  badDigest.images[0].configDigest = 'sha256:short';
  assert.throws(() => validateManifest(badDigest, sha), /digest/);
  const badArchive = manifest();
  badArchive.sourceArchive.file = '../source.tar.gz';
  assert.throws(() => validateManifest(badArchive, sha), /archive/);
});

test('release bundle file checksums are verified before images can be used', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'electrohub-release-'));
  try {
    const files = { 'source.tar.gz': 'source', 'images.tar': 'image-bytes', 'AI_PRODUCTION_RELEASE.json': '{"release":true}', 'AI_MODEL_ARTIFACT_PRODUCTION.json': '{"approved":true}' };
    for (const [name, contents] of Object.entries(files)) fs.writeFileSync(path.join(directory, name), contents);
    const value = manifest();
    for (const field of ['sourceArchive', 'imageArchive', 'aiProductionRelease', 'aiModelManifest']) {
      value[field].sha256 = createHash('sha256').update(files[value[field].file]).digest('hex');
    }
    assert.equal(verifyBundleFiles(value, directory), true);
    fs.writeFileSync(path.join(directory, 'images.tar'), 'changed');
    assert.throws(() => verifyBundleFiles(value, directory), /checksum mismatch/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('files-only verification validates a bundle without invoking Docker', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'electrohub-release-files-only-'));
  const emptyPath = fs.mkdtempSync(path.join(os.tmpdir(), 'electrohub-empty-path-'));
  try {
    const files = {
      'source.tar.gz': 'source bytes',
      'images.tar': 'image archive bytes',
      'AI_PRODUCTION_RELEASE.json': '{"release":"fixture"}',
      'AI_MODEL_ARTIFACT_PRODUCTION.json': '{"model":"fixture"}',
    };
    for (const [name, contents] of Object.entries(files)) fs.writeFileSync(path.join(directory, name), contents);
    const value = manifest();
    for (const field of ['sourceArchive', 'imageArchive', 'aiProductionRelease', 'aiModelManifest']) {
      const name = value[field].file;
      value[field].sha256 = createHash('sha256').update(files[name]).digest('hex');
    }
    const manifestPath = path.join(directory, 'release-manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(value));
    const childEnv = {
      SystemRoot: process.env.SystemRoot,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      PATH: emptyPath,
      PATHEXT: process.env.PATHEXT,
    };
    const output = execFileSync(process.execPath, [
      path.join(__dirname, 'verify-release-manifest.cjs'),
      '--files-only', manifestPath, sha, directory,
    ], { encoding: 'utf8', env: childEnv });
    assert.match(output, /verified before image load/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
    fs.rmSync(emptyPath, { recursive: true, force: true });
  }
});
