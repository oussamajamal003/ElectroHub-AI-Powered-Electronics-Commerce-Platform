/** Dedicated catalog launcher. Never invokes the general seed or starts application workers. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import dotenv from 'dotenv';
import { z } from 'zod';
import { assertExpansionTarget, expansionDigest, expansionOwnedId, seedCatalogExpansion, validateExpansionDataset,
  validateExpansionMedia } from '../prisma/catalog-expansion.js';
import { captureCatalogExpansionSnapshot, assertCatalogExpansionPreserved,
  assertCatalogExpansionUnchanged } from '../prisma/catalog-expansion-evidence.js';
import { resolveDatabaseTargets } from '../src/lib/database-target.js';

const root = path.resolve(__dirname, '..');
const json = async (file: string): Promise<unknown> => JSON.parse(await readFile(file, 'utf8'));
const documentSchema = z.object({ dataset: z.unknown() }).passthrough();
const qaEvidenceSchema = z.object({
  datasetSha256: z.string(), manifestSha256: z.string(), targetIdentity: z.string(),
  repeatVerified: z.literal(true), unrelatedPreserved: z.literal(true),
}).passthrough();

async function main() {
  const args = process.argv.slice(2);
  const allowed = new Set(['--validate-data', '--validate-media', '--target=qa', '--target=dev', '--apply', '--verify-repeat']);
  if (!args.length || args.some(arg => !allowed.has(arg)) || new Set(args).size !== args.length) {
    throw new Error('Usage: catalog:expansion -- --validate-data | --validate-media | --target=qa|dev [--apply] [--verify-repeat]');
  }
  const data = validateExpansionDataset(documentSchema.parse(await json(path.join(root, 'prisma/data/catalog-expansion.json'))).dataset);
  if (args.length === 1 && args[0] === '--validate-data') {
    console.log(JSON.stringify({ mode: 'data-only', categories: data.categories.length, products: data.products.length,
      imagesPlanned: data.products.flatMap(row => row.images).length, datasetSha256: expansionDigest(data), databaseConnected: false }));
    return;
  }
  const manifest = await json(path.join(root, 'prisma/data/catalog-expansion-media.json'));
  const mediaReview = await json(path.join(root, 'prisma/data/catalog-expansion-media-review.json'));
  const publicRoot = path.resolve(root, '../frontend/public');
  // Every file, checksum and approval is checked BEFORE creating a database connection.
  const approvedManifest = await validateExpansionMedia(data, manifest, publicRoot, mediaReview);
  if (args.length === 1 && args[0] === '--validate-media') {
    console.log(JSON.stringify({ mode: 'media-only', assets: approvedManifest.assets.length, databaseConnected: false }));
    return;
  }
  const target: 'qa' | 'dev' | undefined = args.includes('--target=qa') ? 'qa' : args.includes('--target=dev') ? 'dev' : undefined;
  if (!target || args.filter(arg => arg.startsWith('--target=')).length !== 1 || args.some(arg => arg.startsWith('--validate-'))) {
    throw new Error('Select exactly one target, or use a standalone offline validation command.');
  }
  const apply = args.includes('--apply');
  const repeat = args.includes('--verify-repeat');
  if (repeat && (!apply || target !== 'qa')) throw new Error('Repeat verification requires --target=qa --apply.');
  const fileEnvironment: NodeJS.ProcessEnv = {};
  if (target === 'qa') {
    // Same state folder as scripts/dev-isolated.cjs: the pgvector Docker cluster (Task 04.2) keeps its own.
    const isolatedHome = process.env.ISOLATED_PG_DOCKER === '1' ? '.isolated-docker' : '.isolated';
    Object.assign(fileEnvironment, await json(path.join(root, isolatedHome, 'env.json')));
  } else {
    for (const file of ['.env', '.env.local']) {
      try { Object.assign(fileEnvironment, dotenv.parse(await readFile(path.join(root, file)))); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
  }
  // QA always takes its pinned URL/CA from the existing isolated launcher, never ambient DEV.
  const configuration: NodeJS.ProcessEnv = target === 'qa'
    ? { ...process.env, ...fileEnvironment, NODE_ENV: 'development' }
    : { ...fileEnvironment, ...process.env, NODE_ENV: 'development' };
  const identity = assertExpansionTarget(configuration, target);
  const evidenceFile = path.join(root, '.cache/catalog-expansion-qa.json');
  const qaEvidence = apply && target === 'dev' ? qaEvidenceSchema.parse(await json(evidenceFile)) : undefined;
  // A dry-run must be reviewed separately before this launcher can apply to shared DEV.
  const planFile = path.join(root, '.cache/catalog-expansion-dev-plan.json');
  if (apply && target === 'dev') {
    const plan = z.object({ datasetSha256: z.string(), manifestSha256: z.string(), identity: z.string(), recordedAt: z.number() })
      .parse(await json(planFile));
    if (plan.datasetSha256 !== expansionDigest(data) || plan.manifestSha256 !== expansionDigest(approvedManifest) ||
        plan.identity !== identity || Date.now() - plan.recordedAt > 3_600_000 || plan.recordedAt > Date.now()) {
      throw new Error('DEV apply requires a matching dry-run recorded within the last hour.');
    }
  }
  const targets = resolveDatabaseTargets(configuration);
  const connection = new URL(targets.runtimeUrl);
  for (const key of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'pgbouncer']) connection.searchParams.delete(key);
  const ca = configuration.DB_SSL_CA_CERT_PATH ? await readFile(configuration.DB_SSL_CA_CERT_PATH, 'utf8') : undefined;
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: connection.toString(), max: 2,
    connectionTimeoutMillis: 15_000, ssl: { ca, rejectUnauthorized: true } }) });
  try {
    const [proof] = await client.$queryRaw<Array<{ database: string }>>`
      SELECT current_database()::text AS database
    `;
    if (proof?.database !== decodeURIComponent(new URL(targets.runtimeUrl).pathname.slice(1))) {
      throw new Error('Authenticated database identity preflight failed.');
    }
    const options = { dataset: data, manifest: approvedManifest, mediaReview, publicRoot, configuration, target, qaEvidence };
    const before = await captureCatalogExpansionSnapshot(client);
    const dryRun = await seedCatalogExpansion(client, options);
    assertCatalogExpansionUnchanged(before, await captureCatalogExpansionSnapshot(client));
    console.log(JSON.stringify(dryRun));
    await mkdir(path.join(root, '.cache'), { recursive: true });
    if (!apply && target === 'dev') {
      await writeFile(planFile, JSON.stringify({ datasetSha256: expansionDigest(data), manifestSha256: expansionDigest(approvedManifest),
        identity, recordedAt: Date.now(), dryRun }, null, 2));
    }
    if (!apply) return;
    const first = await seedCatalogExpansion(client, { ...options, apply: true });
    const after = await captureCatalogExpansionSnapshot(client);
    assertCatalogExpansionPreserved(before, after, {
      products: data.products.map(product => expansionOwnedId(`product/${product.sku}`)),
      product_images: data.products.flatMap(product => product.images.map(image =>
        expansionOwnedId(`image/${product.sku}/${image.sortOrder}`))),
      product_specifications: data.products.flatMap(product => product.specifications.map(spec =>
        expansionOwnedId(`spec/${product.sku}/${spec.group}/${spec.name}`))),
    });
    console.log(JSON.stringify(first));
    if (repeat) {
      const second = await seedCatalogExpansion(client, { ...options, apply: true });
      assertCatalogExpansionUnchanged(after, await captureCatalogExpansionSnapshot(client));
      if (second.products.created || second.products.updated || second.products.skipped !== 79 || second.images.created ||
          second.images.updated || second.specifications.created || second.specifications.updated || second.inventories.created) {
        throw new Error('QA repeat was not a no-op.');
      }
      await writeFile(evidenceFile, JSON.stringify({ datasetSha256: expansionDigest(data), manifestSha256: expansionDigest(approvedManifest),
        targetIdentity: identity, repeatVerified: true, unrelatedPreserved: true, recordedAt: new Date().toISOString(), first, second }, null, 2));
      console.log(JSON.stringify({ qaEvidence: evidenceFile, repeatVerified: true, unrelatedPreserved: true }));
    }
  } finally { await client.$disconnect(); }
}

main().catch(error => {
  // Database/provider errors can contain SQL or credentials. Emit fixed failure type only.
  console.error(JSON.stringify({ status: 'REFUSED_OR_FAILED', type: error instanceof z.ZodError ? 'INVALID_DATA_OR_PENDING_MEDIA' :
    error instanceof Error && /^(Usage:|Select exactly|Repeat verification|DEV apply|QA repeat|Authenticated)/.test(error.message)
      ? error.message : 'CATALOG_PREFLIGHT_OR_EXECUTION_FAILED',
    fields: error instanceof z.ZodError ? [...new Set(error.issues.map(issue => issue.path.join('.')))].slice(0, 12) : undefined }));
  process.exitCode = 1;
});
