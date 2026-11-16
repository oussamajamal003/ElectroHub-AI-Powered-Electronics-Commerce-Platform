import rawData from './data/products.json';

type CuratedProduct = (typeof rawData.products)[number];
type VariantDefinition = {
  baseSlug: string;
  colors: string[];
  storage?: string[];
  memory?: string[];
};

const variants: VariantDefinition[] = [
  { baseSlug: 'apple-iphone-15-128gb', colors: ['Black', 'Blue', 'Green', 'Yellow', 'Pink'], storage: ['128GB', '256GB', '512GB'] },
  { baseSlug: 'apple-iphone-16-128gb', colors: ['Black', 'White', 'Pink', 'Teal', 'Ultramarine'], storage: ['128GB', '256GB', '512GB'] },
  { baseSlug: 'apple-macbook-air-13-m3', colors: ['Silver', 'Starlight', 'Space Gray', 'Midnight'], memory: ['8GB', '16GB'], storage: ['256GB', '512GB', '1TB'] },
  { baseSlug: 'apple-macbook-air-15-m3', colors: ['Silver', 'Starlight', 'Space Gray', 'Midnight'], memory: ['8GB', '16GB'], storage: ['256GB', '512GB', '1TB'] },
  { baseSlug: 'apple-ipad-air-11-m2-128gb', colors: ['Blue', 'Purple', 'Starlight', 'Space Gray'], storage: ['128GB', '256GB', '512GB', '1TB'] },
  { baseSlug: 'apple-ipad-10-64gb', colors: ['Silver', 'Blue', 'Pink', 'Yellow'], storage: ['64GB', '256GB'] },
  { baseSlug: 'samsung-galaxy-tab-s9-128gb', colors: ['Graphite', 'Beige'], storage: ['128GB', '256GB'] },
  { baseSlug: 'apple-watch-se-2-40mm-gps', colors: ['Midnight', 'Starlight', 'Silver'] },
  { baseSlug: 'apple-watch-series-9-41mm-gps', colors: ['Pink', 'Midnight', 'Starlight', 'Silver'] },
];

function slugPart(value: string) { return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }

export function buildCatalogVariants(products: CuratedProduct[]): CuratedProduct[] {
  const output: CuratedProduct[] = [];
  for (const definition of variants) {
    const base = products.find(product => product.slug === definition.baseSlug);
    if (!base) throw new Error('Curated variant base product is missing.');
    const storageOptions = definition.storage ?? [''];
    const memoryOptions = definition.memory ?? [''];
    let variantIndex = 0;
    for (const color of definition.colors) for (const memory of memoryOptions) for (const storage of storageOptions) {
      if (variantIndex++ === 0) continue;
      const identity = [color, memory, storage].filter(Boolean).map(slugPart).join('-');
      const originalName = base.name.replace(/\s(?:8GB|128GB|64GB|256GB)(?=\s|$)/g, '');
      const name = `${originalName}${memory ? ` ${memory}` : ''}${storage ? ` ${storage}` : ''} — ${color}`;
      const storageIndex = Math.max(0, storageOptions.indexOf(storage));
      const memoryIndex = Math.max(0, memoryOptions.indexOf(memory));
      const demoPrice = (Number(base.price) + storageIndex * 120 + memoryIndex * 180).toFixed(2);
      const specifications = base.specifications.map(specification => {
        if (specification.group === 'Storage' && specification.name === 'Capacity' && storage) {
          return { ...specification, value: `${storage}${base.categorySlug === 'laptops' ? ' SSD' : ''}` };
        }
        if (specification.group === 'Performance' && specification.name === 'Memory') {
          if (memory) return { ...specification, value: `${memory} unified` };
          if (definition.baseSlug === 'samsung-galaxy-tab-s9-128gb') return { ...specification, value: storage === '256GB' ? '12GB' : '8GB' };
        }
        return specification;
      });
      specifications.push({ group: 'Design', name: 'Finish', value: color, sortOrder: 0 });
      output.push({ ...base, name, slug: `${base.slug}-${identity}`, sku: `${base.sku}-${identity.toUpperCase()}`,
        description: `${base.description} Finish: ${color}.${storage ? ` Storage: ${storage}.` : ''}${memory ? ` Memory: ${memory}.` : ''}`,
        price: demoPrice, compareAtPrice: variantIndex % 4 === 0 ? (Number(demoPrice) + 100).toFixed(2) : null,
        quantity: variantIndex % 11 === 0 ? 0 : variantIndex % 5 === 0 ? 3 : 10 + variantIndex,
        specifications });
    }
  }
  return output;
}
