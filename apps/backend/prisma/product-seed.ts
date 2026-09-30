import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import rawData from './data/products.json';
import { buildCatalogVariants } from './product-variants.js';
import { moneySchema, pricingSchema, slugSchema, specificationSchema, mediaPathSchema } from '../src/validators/product.validator.js';

const categorySchema = z.object({
  name: z.string().min(1).max(100), slug: slugSchema.max(120),
  description: z.string().max(5000), imageUrl: mediaPathSchema,
}).strict();
const brandSchema = z.object({
  name: z.string().min(1).max(100), slug: slugSchema.max(120),
  description: z.string().max(5000).nullable(), logoUrl: mediaPathSchema.nullable(),
}).strict();
const productSchema = z.object({
  name: z.string().min(1).max(255), slug: slugSchema,
  sku: z.string().min(1).max(100), brandSlug: slugSchema.max(120), categorySlug: slugSchema.max(120),
  description: z.string().min(1).max(5000), modelNumber: z.string().max(100).nullable(),
  price: moneySchema, compareAtPrice: moneySchema.nullable(),
  status: z.enum(['ACTIVE', 'INACTIVE']), quantity: z.number().int().nonnegative(),
  sourceUrl: z.string().url().max(2048),
  images: z.array(z.object({
    url: mediaPathSchema, altText: z.string().min(1).max(255),
    sortOrder: z.number().int().nonnegative(), isPrimary: z.boolean(),
  }).strict()).min(2),
  specifications: z.array(specificationSchema).min(6).max(15),
}).strict().refine(value => pricingSchema.safeParse({
  price: value.price, compareAtPrice: value.compareAtPrice,
}).success, 'Invalid reference price');

const datasetSchema = z.object({
  categories: z.array(categorySchema), brands: z.array(brandSchema), products: z.array(productSchema),
}).strict();

export function validateProductDataset(input: unknown) {
  const data = datasetSchema.parse(input);
  const ensureUnique = (values: string[], label: string) => {
    if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label} in curated product dataset.`);
  };
  ensureUnique(data.categories.map(value => value.slug), 'category slugs');
  ensureUnique(data.categories.map(value => value.name), 'category names');
  ensureUnique(data.brands.map(value => value.slug), 'brand slugs');
  ensureUnique(data.brands.map(value => value.name), 'brand names');
  ensureUnique(data.products.map(value => value.slug), 'product slugs');
  ensureUnique(data.products.map(value => value.sku), 'product SKUs');
  for (const product of data.products) {
    if (!data.brands.some(brand => brand.slug === product.brandSlug) ||
        !data.categories.some(category => category.slug === product.categorySlug)) {
      throw new Error('Every curated product must reference a factual brand and category.');
    }
    if (product.images.filter(image => image.isPrimary).length !== 1 ||
        !product.images.some(image => image.isPrimary && image.sortOrder === 0)) {
      throw new Error('Every curated product must have exactly one primary image at order zero.');
    }
    ensureUnique(product.images.map(image => image.url), 'product image URLs');
    ensureUnique(product.images.map(image => String(image.sortOrder)), 'image positions');
    ensureUnique(product.specifications.map(spec => `${spec.group}/${spec.name}`), 'specifications');
  }
  if (data.brands.some(brand => !data.products.some(product => product.brandSlug === brand.slug))) {
    throw new Error('Seed brands must be represented by curated products.');
  }
  return data;
}

const catalogMedia: Record<string, string> = {
  smartphones: '/images/catalog/smartphones.jpg',
  laptops: '/images/catalog/laptops.jpg',
  tablets: '/images/catalog/tablets.jpg',
  headphones: '/images/catalog/headphones.jpg',
  monitors: '/images/catalog/monitors.jpg',
  smartwatches: '/images/catalog/smartwatches.jpg',
  gaming: '/images/catalog/gaming.jpg',
  accessories: '/images/catalog/accessories.jpg',
};
const catalogDetailMedia: Record<string, string> = Object.fromEntries(Object.entries(catalogMedia)
  .map(([category, image]) => [category, image.replace(/\.jpg$/, '-detail.jpg')]));

const catalogMediaPools: Record<string, string[]> = Object.fromEntries(Object.keys(catalogMedia).map(category => [category, [
  `/images/catalog/variety/${category}-01.jpg`,
  `/images/catalog/variety/${category}-02.jpg`,
  `/images/catalog/variety/${category}-03.jpg`,
  catalogMedia[category]!,
  catalogDetailMedia[category]!,
]]));
const smartphoneBrandMedia: Record<string, string[]> = {
  samsung: [
    '/images/catalog/variety/smartphones-samsung-01.jpg',
    '/images/catalog/variety/smartphones-samsung-02.jpg',
    '/images/catalog/variety/smartphones-samsung-03.jpg',
    catalogMedia.smartphones!,
  ],
};
const deviceMedia: Record<string, string[]> = {
  'lenovo-thinkpad-x1-carbon-gen-12': ['thinkpad-01', 'thinkpad-02'],
  'sony-wh-1000xm5': ['sonyheadphones-01', 'sonyheadphones-02'],
  'jbl-tune-770nc': ['jblheadphones-01', 'jblheadphones-02'],
  'samsung-galaxy-buds2-pro': ['galaxybuds-01', 'galaxybuds-02'],
  'samsung-galaxy-watch6-40mm': ['galaxywatch-01', 'galaxywatch-02'],
  'sony-playstation-5-launch-disc': ['playstation5-01', 'playstation5-02'],
  'asus-rog-ally-z1-extreme': ['rogally-01', 'rogally-02'],
  'acer-predator-cestus-330': ['acermouse-01', 'acermouse-02'],
  'lg-27ul500-w': ['monitor-lg-01', 'monitor-lg-02'],
  'dell-p2422h': ['monitor-dell-01', 'monitor-dell-02'],
  'asus-tuf-gaming-vg249q1a': ['monitor-asus-01', 'monitor-asus-02'],
  'hp-975-dual-mode-wireless-keyboard': ['accessory-hp-keyboard-01', 'accessory-hp-keyboard-02'],
  'lenovo-go-usb-c-wireless-mouse': ['accessory-lenovo-mouse-01', 'accessory-lenovo-mouse-02'],
  'sony-dualsense-wireless-controller': ['accessory-sony-controller-01', 'accessory-sony-controller-02'],
};
const variantMediaFamilies = [
  { slug: 'apple-iphone-15-128gb', name: 'iphone15', defaultFinish: 'black', views: 3 },
  { slug: 'apple-iphone-16-128gb', name: 'iphone16', defaultFinish: 'black', views: 3 },
  { slug: 'apple-macbook-air-13-m3', name: 'macbook13', defaultFinish: 'silver', views: 6 },
  { slug: 'apple-macbook-air-15-m3', name: 'macbook15', defaultFinish: 'silver', views: 6 },
  { slug: 'apple-ipad-air-11-m2-128gb', name: 'ipadair', defaultFinish: 'blue', views: 4 },
  { slug: 'apple-ipad-10-64gb', name: 'ipad10', defaultFinish: 'silver', views: 2 },
  { slug: 'samsung-galaxy-tab-s9-128gb', name: 'galaxytab', defaultFinish: 'graphite', views: 2 },
  { slug: 'apple-watch-se-2-40mm-gps', name: 'watchse', defaultFinish: 'midnight', views: 2 },
  { slug: 'apple-watch-series-9-41mm-gps', name: 'watchseries9', defaultFinish: 'pink', views: 2 },
];
const productMediaOffsets: Record<string, number> = {};

const curatedProducts = [...rawData.products, ...buildCatalogVariants(rawData.products)].map(product => {
  const family = variantMediaFamilies.find(candidate => product.slug.startsWith(candidate.slug));
  const finish = family ? (product.name.split(' — ')[1] ?? family.defaultFinish).toLowerCase().replace(/\s+/g, '') : null;
  const variantMedia = family && finish
    ? Array.from({ length: family.views }, (_, index) => `/images/catalog/variety/${family.name}-${finish}-${index + 1}.jpg`)
    : null;
  const key = variantMedia ? `${family!.name}/${finish}` : product.slug;
  const pool = variantMedia ?? deviceMedia[product.slug]?.map(name => `/images/catalog/variety/${name}.jpg`)
    ?? (product.categorySlug === 'smartphones' && smartphoneBrandMedia[product.brandSlug]
      ? smartphoneBrandMedia[product.brandSlug]!
      : catalogMediaPools[product.categorySlug]!);
  const offset = productMediaOffsets[key] ?? 0;
  productMediaOffsets[key] = offset + 1;
  const primaryUrl = pool[offset % pool.length]!;
  const alternateStep = 1 + Math.floor(offset / pool.length) % (pool.length - 1);
  const alternateUrl = pool[(offset + alternateStep) % pool.length]!;
  return {
    ...product,
    images: product.images.map((image, index) => index === 0
      ? { ...image, url: primaryUrl, altText: `Illustrative ${product.brandSlug} ${product.categorySlug} product image; not an exact model photo` }
      : { ...image, url: alternateUrl, altText: `Alternate illustrative ${product.categorySlug} product view` }),
  };
});

export const productDataset = validateProductDataset({
  ...rawData,
  categories: rawData.categories.map(category => ({ ...category, imageUrl: catalogMedia[category.slug]! })),
  products: curatedProducts,
});

export function assertDevSeedTarget(configuration: NodeJS.ProcessEnv) {
  if (!['development', 'test'].includes(configuration.NODE_ENV ?? '')) {
    throw new Error('Product seed requires an explicit development or test environment.');
  }
  const devProject = 'pzxekjybdiulzmssalfo';
  for (const key of ['DATABASE_URL', 'DIRECT_URL']) {
    const value = configuration[key];
    if (!value) throw new Error('Seed database target is not configured.');
    let target: URL;
    try { target = new URL(value); } catch { throw new Error('Seed database target is invalid.'); }
    const isDirect = target.hostname === `db.${devProject}.supabase.co`;
    const isPooler = target.hostname.endsWith('.pooler.supabase.com') &&
      decodeURIComponent(target.username) === `postgres.${devProject}`;
    if (!['postgres:', 'postgresql:'].includes(target.protocol) || !(isDirect || isPooler)) {
      throw new Error('Product seed is restricted to the approved ElectroHub DEV database.');
    }
  }
}

export async function seedProductDataset(client: PrismaClient, configuration = process.env) {
  assertDevSeedTarget(configuration);
  const data = validateProductDataset(productDataset);
  return client.$transaction(async transaction => {
    const categoryIds = new Map<string, string>();
    const brandIds = new Map<string, string>();
    for (const category of data.categories) {
      const saved = await transaction.category.upsert({
        where: { slug: category.slug },
        update: { ...category, isActive: true }, create: { ...category, isActive: true },
      });
      categoryIds.set(category.slug, saved.id);
    }
    for (const brand of data.brands) {
      const saved = await transaction.brand.upsert({
        where: { slug: brand.slug }, update: brand, create: brand,
      });
      brandIds.set(brand.slug, saved.id);
    }
    for (const product of data.products) {
      const existing = await transaction.product.findFirst({
        where: { OR: [{ sku: product.sku }, { slug: product.slug }] },
        select: { sku: true, slug: true },
      });
      if (existing && (existing.sku !== product.sku || existing.slug !== product.slug)) {
        throw new Error('Curated product identity conflicts with an existing product.');
      }
      const fields = {
        name: product.name, slug: product.slug, description: product.description,
        modelNumber: product.modelNumber, sku: product.sku,
        categoryId: categoryIds.get(product.categorySlug)!,
        brandId: brandIds.get(product.brandSlug)!,
        price: new Prisma.Decimal(product.price),
        compareAtPrice: product.compareAtPrice == null ? null : new Prisma.Decimal(product.compareAtPrice),
        status: product.status,
      };
      const saved = await transaction.product.upsert({
        where: { sku: product.sku }, create: fields, update: fields,
      });
      await transaction.productImage.deleteMany({ where: { productId: saved.id } });
      await transaction.productImage.createMany({
        data: product.images.map(image => ({ ...image, productId: saved.id })),
      });
      await transaction.productSpecification.deleteMany({ where: { productId: saved.id } });
      await transaction.productSpecification.createMany({
        data: product.specifications.map(spec => ({ ...spec, productId: saved.id })),
      });
      const inventory = {
        quantity: product.quantity, lowStockAt: 5,
        status: product.quantity === 0 ? 'OUT_OF_STOCK' as const :
          product.quantity <= 5 ? 'LOW_STOCK' as const : 'IN_STOCK' as const,
      };
      await transaction.inventory.upsert({
        where: { productId: saved.id },
        create: { ...inventory, productId: saved.id }, update: inventory,
      });
    }
    return {
      categories: data.categories.length, brands: data.brands.length, products: data.products.length,
      images: data.products.reduce((count, product) => count + product.images.length, 0),
      specifications: data.products.reduce((count, product) => count + product.specifications.length, 0),
    };
  }, { maxWait: 30000, timeout: 900000 });
}
