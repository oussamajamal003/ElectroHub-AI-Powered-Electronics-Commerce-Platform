'use strict';

const { spawnSync } = require('node:child_process');
const { existsSync, readFileSync, statSync } = require('node:fs');
const path = require('node:path');

const backendRoot = path.resolve(__dirname, '..');
const schemaPath = path.join(backendRoot, 'prisma', 'schema.prisma');
const generatedClientPath = path.join(backendRoot, 'node_modules', '.prisma', 'client', 'index.js');
const clientPackage = require(require.resolve('@prisma/client/package.json', { paths: [backendRoot] }));
const prismaPackagePath = require.resolve('prisma/package.json', { paths: [backendRoot] });
const prismaPackage = require(prismaPackagePath);

if (prismaPackage.version !== clientPackage.version) {
  console.error(`Prisma CLI (${prismaPackage.version}) and Client (${clientPackage.version}) versions must match.`);
  process.exit(1);
}

let clientIsCurrent = false;

if (existsSync(generatedClientPath) && existsSync(schemaPath)) {
  const generatedSource = readFileSync(generatedClientPath, 'utf8');
  const generatedVersion = generatedSource.match(/"clientVersion"\s*:\s*"([^"]+)"/)?.[1];
  const hasSchemaHash = /"inlineSchemaHash"\s*:\s*"[a-f0-9]+"/.test(generatedSource);
  const clientModifiedAt = statSync(generatedClientPath).mtimeMs;
  const schemaModifiedAt = statSync(schemaPath).mtimeMs;

  clientIsCurrent =
    generatedVersion === clientPackage.version &&
    hasSchemaHash &&
    clientModifiedAt >= schemaModifiedAt;
}

if (clientIsCurrent) {
  console.log(`Prisma Client ${clientPackage.version} is current; skipping generation.`);
  process.exit(0);
}

const prismaCliPath = path.join(path.dirname(prismaPackagePath), 'build', 'index.js');
const generation = spawnSync(
  process.execPath,
  [prismaCliPath, 'generate', '--schema', schemaPath],
  { cwd: backendRoot, stdio: 'inherit' },
);

if (generation.error) {
  console.error(`Prisma Client generation failed: ${generation.error.message}`);
  process.exit(1);
}

process.exit(generation.status ?? 1);
