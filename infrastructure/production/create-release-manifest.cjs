'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');

const IMAGE_NAMES = ['backend', 'ai-service', 'edge'];
const AI_PRODUCTION_RELEASE_MANIFEST = 'AI_PRODUCTION_RELEASE.json';
const AI_MODEL_MANIFEST = 'AI_MODEL_ARTIFACT_PRODUCTION.json';
const BASE_IMAGES = {
  backend: ['node:22.19.0-alpine'],
  'ai-service': ['python:3.11.13-slim'],
  edge: ['node:22.19.0-alpine', 'nginx:1.30.6-alpine3.24'],
};

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function imageId(reference) {
  const id = execFileSync('docker', ['image', 'inspect', '--format', '{{.Id}}', reference], { encoding: 'utf8' }).trim();
  if (!/^sha256:[a-f0-9]{64}$/.test(id)) throw new Error(`Image ID was not a SHA-256 content ID: ${reference}`);
  return id;
}

function createManifest({ releaseSha, bundleDirectory, build = {} }) {
  if (!/^[a-f0-9]{40}$/.test(releaseSha)) throw new Error('releaseSha must be a full lowercase Git SHA');
  const sourceArchive = path.join(bundleDirectory, 'source.tar.gz');
  const imageArchive = path.join(bundleDirectory, 'images.tar');
  const aiProductionRelease = path.join(bundleDirectory, AI_PRODUCTION_RELEASE_MANIFEST);
  const aiModelManifest = path.join(bundleDirectory, AI_MODEL_MANIFEST);
  for (const file of [sourceArchive, imageArchive, aiProductionRelease, aiModelManifest]) if (!fs.statSync(file).isFile()) throw new Error(`Release input is missing: ${path.basename(file)}`);
  return {
    schemaVersion: 1,
    releaseSha,
    createdAt: new Date().toISOString(),
    repository: build.GITHUB_REPOSITORY || build.repository || 'oussamajamal003/ElectroHub-AI-Powered-Electronics-Commerce-Platform',
    workflow: build.GITHUB_WORKFLOW || build.workflow || 'Single-origin production release and deploy',
    workflowRunId: build.GITHUB_RUN_ID || build.runId || null,
    workflowRunAttempt: build.GITHUB_RUN_ATTEMPT || build.runAttempt || null,
    runnerArchitecture: build.RUNNER_ARCH || build.runnerArchitecture || null,
    sourceArchive: { file: 'source.tar.gz', sha256: sha256(sourceArchive) },
    imageArchive: { file: 'images.tar', sha256: sha256(imageArchive) },
    aiProductionRelease: { file: AI_PRODUCTION_RELEASE_MANIFEST, sha256: sha256(aiProductionRelease) },
    aiModelManifest: { file: AI_MODEL_MANIFEST, sha256: sha256(aiModelManifest) },
    images: IMAGE_NAMES.map((name) => {
      const reference = `electrohub/${name}:${releaseSha}`;
      return { name, reference, configDigest: imageId(reference), declaredBaseImageTags: BASE_IMAGES[name] };
    }),
  };
}

if (require.main === module) {
  const [releaseSha, bundleDirectory, outputFile] = process.argv.slice(2);
  if (!releaseSha || !bundleDirectory || !outputFile) throw new Error('Usage: create-release-manifest.cjs <full-sha> <bundle-dir> <output-file>');
  fs.writeFileSync(outputFile, `${JSON.stringify(createManifest({ releaseSha, bundleDirectory, build: process.env }), null, 2)}\n`, { mode: 0o600 });
}

module.exports = { IMAGE_NAMES, BASE_IMAGES, AI_PRODUCTION_RELEASE_MANIFEST, AI_MODEL_MANIFEST, createManifest };
