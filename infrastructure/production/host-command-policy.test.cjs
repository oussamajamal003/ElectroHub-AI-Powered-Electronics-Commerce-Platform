'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('host deploy command has a root-only, no-overwrite installer for the workflow target', () => {
  const installer = read('install-deploy-command.sh');
  const workflow = fs.readFileSync(path.resolve(root, '../../.github/workflows/deploy-production.yml'), 'utf8');
  assert.match(installer, /TARGET=\/usr\/local\/sbin\/electrohub-deploy-release/);
  assert.match(installer, /HELPER_TARGET=\/usr\/local\/libexec\/electrohub-prepare-release-bundle\.py/);
  assert.match(installer, /HELPER_SOURCE=\"\$SCRIPT_DIR\/prepare-release-bundle\.py\"/);
  assert.match(installer, /EUID -ne 0/);
  assert.match(installer, /cmp -s "\$source" "\$target"/);
  assert.match(installer, /refusing to replace it automatically/);
  assert.match(installer, /install -o root -g root -m "\$mode"/);
  assert.match(workflow, /sudo \/usr\/local\/sbin\/electrohub-deploy-release/);
  const deploy = read('deploy-release.sh');
  assert.match(deploy, /stat -c '%u' "\$COMPOSE_BASE_ENV_FILE"/);
  assert.match(deploy, /readonly COMPOSE_BASE_ENV_FILE=\/etc\/electrohub\/compose\.env/);
  assert.doesNotMatch(deploy, /ELECTROHUB_COMPOSE_BASE_ENV_FILE/);
  assert.match(deploy, /compose_env_permissions & 0022/);
});

test('production workflow and host fail closed until whole-release provenance is approved', () => {
  const deploy = read('deploy-release.sh');
  const workflow = fs.readFileSync(path.resolve(root, '../../.github/workflows/deploy-production.yml'), 'utf8');
  const buildJobGate = workflow.indexOf('Fail closed pending approved whole-release provenance policy');
  const deployJobGate = workflow.indexOf('Fail closed pending approved whole-release provenance policy', buildJobGate + 1);
  const dockerBuild = workflow.indexOf('docker build');
  const bundleUpload = workflow.indexOf('actions/upload-artifact');
  const runnerDockerLoad = workflow.indexOf('docker load --input "$bundle/images.tar"');
  const sshInvocation = workflow.indexOf('sudo /usr/local/sbin/electrohub-deploy-release');
  const hostIntake = deploy.indexOf('"$HOST_HELPER" prepare');
  const dockerLoad = deploy.indexOf('docker load --input');
  const pointerSwitch = deploy.indexOf('mv -Tf -- "$next_link" "$current"');
  assert.ok(buildJobGate >= 0 && buildJobGate < dockerBuild && buildJobGate < bundleUpload,
    'build job must stop before creating or uploading a release bundle');
  assert.ok(deployJobGate > buildJobGate && deployJobGate < runnerDockerLoad && deployJobGate < sshInvocation,
    'deploy job must stop before runner image loading or host invocation');
  assert.ok(hostIntake >= 0 && hostIntake < dockerLoad && hostIntake < pointerSwitch,
    'host provenance gate must precede image loading and pointer mutation');
  assert.match(deploy, /python3 "\$HOST_HELPER" prepare/);
  assert.match(read('prepare-release-bundle.py'), /_require_approved_release_provenance\(\)/);
  assert.doesNotMatch(deploy, /staging\/source\/.*\.py/,
    'privileged host deployment must not execute bundle-provided Python code');
  assert.match(workflow, /Production release is disabled until the whole-release provenance trust owner and host verification policy are approved and implemented/);
  assert.doesNotMatch(workflow, /AI_MODEL_ARTIFACT_CANDIDATE\.json/);
});

test('AI production approval remains an explicit workflow requirement', () => {
  const workflow = fs.readFileSync(path.resolve(root, '../../.github/workflows/deploy-production.yml'), 'utf8');
  assert.match(workflow, /Require a distinct approved AI production release before building images/);
  assert.match(workflow, /AI_PRODUCTION_RELEASE\.json/);
  assert.match(workflow, /AI_MODEL_ARTIFACT_PRODUCTION\.json/);
  assert.doesNotMatch(workflow, /AI_MODEL_ARTIFACT_CANDIDATE\.json/);
});

test('privileged intake guard and all release verification precede host activation side effects', () => {
  const deploy = read('deploy-release.sh');
  const guard = read('prepare-release-bundle.py');
  const intake = deploy.indexOf('"$HOST_HELPER" prepare');
  const bundlePreflight = deploy.indexOf('"$HOST_HELPER" verify-files');
  const dockerLoad = deploy.indexOf('docker load --input');
  const loadedImageGate = deploy.indexOf('"$HOST_HELPER" verify-loaded');
  const pointerSwitch = deploy.indexOf('mv -Tf -- "$next_link" "$current"');
  const composeStart = deploy.indexOf('up -d --no-build --pull never --wait --wait-timeout 300 api ai-service edge');
  assert.ok(intake >= 0 && intake < bundlePreflight && bundlePreflight < dockerLoad,
    'root-controlled intake and fixed-host bundle integrity must precede Docker image load');
  assert.ok(dockerLoad < loadedImageGate && loadedImageGate < pointerSwitch && pointerSwitch < composeStart, 'loaded image verification, pointer replacement and startup must retain their reviewed order');
  const copyAndVerify = guard.indexOf('verify_release_bundle_files(releases_root / staging_name, sha)');
  const sourceExtraction = guard.indexOf('extract_validated_source(source_archive, source_fd, entries, limits)');
  assert.ok(copyAndVerify >= 0 && copyAndVerify < sourceExtraction, 'fixed host code must validate copied bundle metadata before source code is extracted');
  assert.match(guard, /_require_approved_release_provenance\(\)/);
  assert.doesNotMatch(deploy, /staging\/source\/infrastructure\/production\/verify-release-bundle\.py/, 'deployment must not execute the bundle-provided release verifier as root');
  assert.doesNotMatch(guard, /extractall\s*\(/, 'untrusted archives must not use extractall');
  assert.match(guard, /O_NOFOLLOW/);
  assert.match(guard, /O_EXCL/);
  assert.match(guard, /PROD_RELEASE_MAX_SOURCE_ARCHIVE_BYTES/);
  assert.match(guard, /PROD_RELEASE_MAX_IMAGE_ARCHIVE_BYTES/);
  assert.match(guard, /PROD_RELEASE_MAX_SOURCE_MEMBERS/);
  assert.match(guard, /PROD_RELEASE_MAX_SOURCE_FILE_BYTES/);
  assert.match(guard, /PROD_RELEASE_MAX_SOURCE_EXPANDED_BYTES/);
});

test('downloaded workflow bundle is checksum-verified before runner-side Docker load', () => {
  const workflow = fs.readFileSync(path.resolve(root, '../../.github/workflows/deploy-production.yml'), 'utf8');
  const filePreflight = workflow.indexOf('verify-release-manifest.cjs --files-only');
  const imageLoad = workflow.indexOf('docker load --input "$bundle/images.tar"', filePreflight);
  const loadedImageCheck = workflow.indexOf('verify-release-manifest.cjs \\\n', imageLoad);
  assert.ok(filePreflight >= 0 && imageLoad > filePreflight, 'downloaded bundle checksums must pass before runner Docker load');
  assert.ok(loadedImageCheck > imageLoad, 'loaded Docker image identities must be checked after load');
});

test('rollback restoration is verified before recovery Compose uses the explicit previous release', () => {
  const deploy = read('deploy-release.sh');
  const guard = read('prepare-release-bundle.py');
  const rollbackSection = deploy.slice(deploy.indexOf('rollback() {'), deploy.indexOf('trap rollback ERR'));
  assert.match(rollbackSection, /trap - ERR/);
  assert.match(rollbackSection, /HOST_HELPER" rollback/);
  assert.match(rollbackSection, /--previous "\$previous"/);
  assert.match(rollbackSection, /failed_status/);
  assert.match(rollbackSection, /exit "\$failed_status"/);
  assert.doesNotMatch(rollbackSection, /docker compose.*\$current/);
  assert.match(guard, /Restored current pointer does not resolve to the explicit previous release/);
  assert.match(guard, /compose_env = verified_previous \/ "production\.compose\.env"/);
  assert.match(guard, /compose_file = verified_previous \/ "source\/infrastructure\/production\/compose\.yaml"/);
  assert.match(guard, /no rollback Compose command was run/);
});

test('fixed host-owned environment and AI approval checks precede Compose validation and Docker load', () => {
  const deploy = read('deploy-release.sh');
  const installer = read('install-deploy-command.sh');
  const provenanceGate = deploy.indexOf('"$HOST_HELPER" prepare');
  const envCheck = deploy.indexOf('python3 "$HOST_ENV_HELPER"');
  const aiCheck = deploy.indexOf('python3 "$HOST_AI_HELPER" --production');
  const composeValidation = deploy.indexOf('"${compose[@]}" config --quiet');
  const imageLoad = deploy.indexOf('docker load --input');
  assert.ok(provenanceGate >= 0 && envCheck > provenanceGate && aiCheck > envCheck,
    'fixed production checks must run after prepared release intake and before activation');
  assert.ok(composeValidation > aiCheck && imageLoad > composeValidation,
    'environment and AI release checks must precede Compose validation and image load');
  assert.match(deploy, /readonly HOST_ENV_HELPER=\/usr\/local\/libexec\/electrohub-verify-production-env\.py/);
  assert.match(deploy, /readonly HOST_AI_HELPER=\/usr\/local\/libexec\/electrohub-verify-model-artifact\.py/);
  assert.match(installer, /ENV_HELPER_TARGET=\/usr\/local\/libexec\/electrohub-verify-production-env\.py/);
  assert.match(installer, /ENV_HELPER_SOURCE="\$SCRIPT_DIR\/verify-production-env\.py"/);
  assert.match(installer, /AI_HELPER_TARGET=\/usr\/local\/libexec\/electrohub-verify-model-artifact\.py/);
  assert.match(installer, /AI_HELPER_SOURCE="\$SCRIPT_DIR\/\.\.\/\.\.\/apps\/ai-service\/verify-model-artifact\.py"/);
  assert.match(deploy, /PROD_AI_RELEASE_MANIFEST_SHA256/);
  assert.match(deploy, /PROD_AI_MODEL_ARTIFACT_DIRECTORY/);
  assert.match(deploy, /PROD_AI_RELEVANCE_ARTIFACT_DIRECTORY/);
  assert.match(deploy, /fixed_helper_owner/);
  assert.match(deploy, /fixed_helper_permissions & 0022/);
  assert.match(read('prepare-release-bundle.py'), /_require_approved_release_provenance/);
  assert.match(read('prepare-release-bundle.py'), /Production release intake is disabled/);
});

