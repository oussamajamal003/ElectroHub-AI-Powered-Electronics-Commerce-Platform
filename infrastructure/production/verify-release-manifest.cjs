'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { IMAGE_NAMES, AI_PRODUCTION_RELEASE_MANIFEST, AI_MODEL_MANIFEST } = require('./create-release-manifest.cjs');

function validateManifest(manifest, expectedSha) {
  if (!manifest || manifest.schemaVersion !== 1 || manifest.releaseSha !== expectedSha || !/^[a-f0-9]{40}$/.test(expectedSha)) {
    throw new Error('Release manifest SHA does not match the approved full Git SHA');
  }
  if (!Array.isArray(manifest.images) || manifest.images.length !== IMAGE_NAMES.length) throw new Error('Release image list is incomplete');
  const names = manifest.images.map((image) => image.name).sort();
  if (new Set(names).size !== names.length || names.join(',') !== [...IMAGE_NAMES].sort().join(',')) throw new Error('Release image names are invalid');
  for (const image of manifest.images) {
    if (image.reference !== `electrohub/${image.name}:${expectedSha}` || !/^sha256:[a-f0-9]{64}$/.test(image.configDigest)) {
      throw new Error(`Release image reference or content digest is invalid: ${image.name}`);
    }
  }
  for (const field of ['sourceArchive', 'imageArchive', 'aiProductionRelease', 'aiModelManifest']) {
    const value = manifest[field];
    if (!value || !/^[a-f0-9]{64}$/.test(value.sha256) || path.basename(value.file) !== value.file) {
      throw new Error(`Release archive metadata is invalid: ${field}`);
    }
  }
  if (manifest.aiProductionRelease.file !== AI_PRODUCTION_RELEASE_MANIFEST) throw new Error('AI production release file reference is invalid');
  if (manifest.aiModelManifest.file !== AI_MODEL_MANIFEST) throw new Error('AI model manifest file reference is invalid');
  return true;
}

function verifyBundleFiles(manifest, bundleDirectory) {
  validateManifest(manifest, manifest.releaseSha);
  const expectedFiles = [manifest.sourceArchive, manifest.imageArchive, manifest.aiProductionRelease, manifest.aiModelManifest];
  for (const item of expectedFiles) {
    const file = path.resolve(bundleDirectory, item.file);
    if (path.dirname(file) !== path.resolve(bundleDirectory)) throw new Error(`Release bundle file is missing or unsafe: ${item.file}`);
    let descriptor;
    try {
      const pathMetadata = fs.lstatSync(file);
      if (!pathMetadata.isFile() || pathMetadata.isSymbolicLink()) throw new Error('unsafe path type');
      const noFollow = fs.constants.O_NOFOLLOW || 0;
      descriptor = fs.openSync(file, fs.constants.O_RDONLY | noFollow);
      if (!fs.fstatSync(descriptor).isFile()) throw new Error('unsafe opened file type');
    } catch (error) {
      if (descriptor !== undefined) fs.closeSync(descriptor);
      throw new Error(`Release bundle file is missing or unsafe: ${item.file}`);
    }
    let actual;
    try {
      const hash = require('node:crypto').createHash('sha256');
      const buffer = Buffer.alloc(1024 * 1024);
      while (true) {
        const count = fs.readSync(descriptor, buffer, 0, buffer.length, null);
        if (count === 0) break;
        hash.update(buffer.subarray(0, count));
      }
      actual = hash.digest('hex');
    } finally {
      fs.closeSync(descriptor);
    }
    if (actual !== item.sha256) throw new Error(`Release bundle checksum mismatch: ${item.file}`);
  }
  return true;
}

function verifyLoadedImages(manifest) {
  validateManifest(manifest, manifest.releaseSha);
  for (const image of manifest.images) {
    const loadedId = execFileSync('docker', ['image', 'inspect', '--format', '{{.Id}}', image.reference], { encoding: 'utf8' }).trim();
    if (loadedId !== image.configDigest) throw new Error(`Loaded image content does not match the release manifest: ${image.name}`);
  }
}

if (require.main === module) {
  const arguments_ = process.argv.slice(2);
  const filesOnly = arguments_[0] === '--files-only';
  const [manifestFile, expectedSha, bundleDirectory] = filesOnly ? arguments_.slice(1) : arguments_;
  if (!manifestFile || !expectedSha || !bundleDirectory) throw new Error('Usage: verify-release-manifest.cjs [--files-only] <manifest-file> <expected-full-sha> <bundle-directory>');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  validateManifest(manifest, expectedSha);
  verifyBundleFiles(manifest, bundleDirectory);
  if (filesOnly) {
    console.log(`Release bundle files verified before image load for ${expectedSha}`);
  } else {
    verifyLoadedImages(manifest);
    console.log(`Release images verified for ${expectedSha}`);
  }
}

module.exports = { validateManifest, verifyBundleFiles, verifyLoadedImages };
