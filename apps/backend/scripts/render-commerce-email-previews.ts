/**
 * Renders every commerce email fixture to `<outDir>/<fixtureName>.html` and `<fixtureName>.txt`.
 * Usage: npx tsx scripts/render-commerce-email-previews.ts <outDir>
 * Pure rendering only: no network, database or environment loading.
 */
import { statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TEMPLATE_VERSION } from '../src/services/commerce-email.domain.js';
import { commerceEmailFixtures, type CommerceEmailFixtureName } from '../src/emails/commerce/fixtures.js';
import { renderCommerceEmail } from '../src/emails/commerce/templates.js';

const PREVIEW_ORIGIN = 'http://localhost:5173';

function main(): void {
  const outArg = process.argv[2];
  if (!outArg) {
    console.error('Usage: npx tsx scripts/render-commerce-email-previews.ts <outDir>');
    process.exit(1);
  }
  const outDir = resolve(outArg);
  let isDirectory = false;
  try {
    isDirectory = statSync(outDir).isDirectory();
  } catch {
    isDirectory = false;
  }
  if (!isDirectory) {
    console.error(`Output directory does not exist: ${outDir}`);
    process.exit(1);
  }

  const names = Object.keys(commerceEmailFixtures) as CommerceEmailFixtureName[];
  for (const name of names) {
    const email = renderCommerceEmail(commerceEmailFixtures[name], { origin: PREVIEW_ORIGIN }, TEMPLATE_VERSION);
    writeFileSync(resolve(outDir, `${name}.html`), email.html, 'utf8');
    writeFileSync(resolve(outDir, `${name}.txt`), email.text, 'utf8');
    console.log(`${name}: subject="${email.subject}"`);
  }
  console.log(`Rendered ${names.length} fixtures to ${outDir}`);
}

main();
