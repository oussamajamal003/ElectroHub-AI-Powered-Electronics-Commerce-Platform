/** Counts planned assets once, including PNG intermediates without double-counting WebP copies. */
const fs = require('node:fs');
const path = require('node:path');

const backendRoot = path.resolve(__dirname, '..');
const publicRoot = path.resolve(backendRoot, '../frontend/public');
const { dataset } = JSON.parse(fs.readFileSync(path.join(backendRoot, 'prisma/data/catalog-expansion.json'), 'utf8'));
const rows = dataset.categories.map(category => ({ category: category.slug, url: category.imageUrl }))
  .concat(dataset.products.flatMap(product => product.images.map(image => ({ category: product.categorySlug, url: image.url }))));
const totals = { planned: rows.length, generated: 0, finalWebp: 0, categories: {} };
const present = filename => {
  try { const file = fs.statSync(filename); return file.isFile() && file.size >= 1000; }
  catch { return false; }
};
for (const row of rows) {
  const filename = path.join(publicRoot, row.url);
  const final = present(filename);
  const generated = final || present(filename.replace(/\.webp$/, '.png'));
  const category = totals.categories[row.category] ??= { planned: 0, generated: 0, finalWebp: 0 };
  category.planned++;
  if (generated) { totals.generated++; category.generated++; }
  if (final) { totals.finalWebp++; category.finalWebp++; }
}
console.log(JSON.stringify(totals, null, 2));
