import { readdirSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assets = path.join(root, 'apps/frontend/dist/assets');
const files = readdirSync(assets).filter(name => name.endsWith('.js')).map(name => {
  const bytes = readFileSync(path.join(assets, name));
  return { name, bytes: bytes.length, gzipBytes: gzipSync(bytes).length };
});
// Baseline guardrails for this existing application, not claims about end-user network timing.
const budgets = { largestChunkGzipBytes: 300_000, totalJavaScriptGzipBytes: 600_000 };
const largest = Math.max(...files.map(file => file.gzipBytes));
const total = files.reduce((sum, file) => sum + file.gzipBytes, 0);
console.log(JSON.stringify({ budgets, largest, total, files }, null, 2));
if (!files.length || largest > budgets.largestChunkGzipBytes || total > budgets.totalJavaScriptGzipBytes) process.exitCode = 1;
