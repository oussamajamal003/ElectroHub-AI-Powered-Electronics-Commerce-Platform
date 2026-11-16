/** Combine already visually approved batches, independently decode bytes, and bind their review. */
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { expansionDigest, expansionManifestSchema, validateExpansionDataset, validateExpansionMedia } from '../prisma/catalog-expansion.js';

async function main() {
  const backend = path.resolve(__dirname, '..');
  const dataRoot = path.join(backend, 'prisma/data');
  const publicRoot = path.resolve(backend, '../frontend/public');
  const batchNames = ['camera-audio', 'storage-components-networking', 'home-controls', 'printing'];
  const batchSchema = z.object({ assets: z.array(z.unknown()) }).passthrough();
  const batches = await Promise.all(batchNames.map(async name =>
    batchSchema.parse(JSON.parse(await readFile(path.join(dataRoot, `catalog-expansion-media-${name}.json`), 'utf8')))));
  // The schema rejects pending reviews. This command never promotes an unreviewed batch.
  const manifest = expansionManifestSchema.parse({ version: 1, assets: batches.flatMap(batch => batch.assets),
    generationMethod: 'Codex built-in imagegen with ChatGPT Plus authentication',
    usagePolicy: 'AI-generated illustrative storefront assets; not authenticated model photographs; no ML/Kaggle authorization',
    sourceBatches: batchNames.map(name => `catalog-expansion-media-${name}.json`) });
  const document = z.object({ dataset: z.unknown() }).passthrough()
    .parse(JSON.parse(await readFile(path.join(dataRoot, 'catalog-expansion.json'), 'utf8')));
  const dataset = validateExpansionDataset(document.dataset);
  const cache = path.join(backend, '.cache/catalog-expansion');
  await mkdir(cache, { recursive: true });
  const draft = path.join(cache, 'final-manifest-draft.json');
  await writeFile(draft, JSON.stringify(manifest, null, 2) + '\n');
  const decoded = z.array(z.object({ path: z.string(), sha256: z.string(), width: z.number(), height: z.number(), decoded: z.literal(true) }).strict())
    .parse(JSON.parse(execFileSync('python', [path.join(backend, 'scripts/catalog-expansion-decode.py'), draft, publicRoot],
      { encoding: 'utf8', maxBuffer: 1_000_000 })));
  const review = { manifestSha256: expansionDigest(manifest), assets: decoded.map(asset => ({ ...asset, visuallyApproved: true as const })) };
  await validateExpansionMedia(dataset, manifest, publicRoot, review);
  const reviewDraft = path.join(cache, 'final-review-draft.json');
  await writeFile(reviewDraft, JSON.stringify(review, null, 2) + '\n');
  await rename(draft, path.join(dataRoot, 'catalog-expansion-media.json'));
  await rename(reviewDraft, path.join(dataRoot, 'catalog-expansion-media-review.json'));
  console.log(JSON.stringify({ approvedAssets: manifest.assets.length, independentlyDecoded: decoded.length,
    manifestSha256: expansionDigest(manifest), databaseConnected: false }));
}

main().catch(error => {
  console.error(error instanceof z.ZodError ? 'Final media refused: invalid or unapproved batch.' :
    error instanceof Error ? error.message : 'Final media validation failed.');
  process.exitCode = 1;
});
