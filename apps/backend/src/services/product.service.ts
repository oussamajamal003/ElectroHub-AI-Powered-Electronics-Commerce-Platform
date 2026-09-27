import { Prisma, ProductStatus } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';

export interface Pagination { page: number; pageSize: number }
export type Availability = 'AVAILABLE' | 'UNAVAILABLE';

export function projectAvailability(status: ProductStatus, quantity?: number | null): Availability {
  return status === ProductStatus.ACTIVE && (quantity ?? 0) > 0 ? 'AVAILABLE' : 'UNAVAILABLE';
}

const categorySelect = { id: true, name: true, slug: true } as const;
const brandSelect = { id: true, name: true, slug: true } as const;
const imageSelect = { id: true, url: true, altText: true, sortOrder: true, isPrimary: true } as const;
const baseSelect = {
  id: true, name: true, slug: true, price: true, compareAtPrice: true, status: true,
  category: { select: categorySelect }, brand: { select: brandSelect },
  inventory: { select: { quantity: true } },
} satisfies Prisma.ProductSelect;
const listSelect = {
  ...baseSelect,
  images: {
    where: { isPrimary: true }, take: 1,
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    select: imageSelect,
  },
} satisfies Prisma.ProductSelect;
const detailSelect = {
  ...baseSelect, description: true, sku: true, modelNumber: true,
  images: {
    orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }, { id: 'asc' }],
    select: imageSelect,
  },
  specifications: {
    orderBy: [{ group: 'asc' }, { sortOrder: 'asc' }, { id: 'asc' }],
    select: { id: true, group: true, name: true, value: true, sortOrder: true },
  },
} satisfies Prisma.ProductSelect;

type BaseProduct = Prisma.ProductGetPayload<{ select: typeof baseSelect }>;
const mapBase = (product: BaseProduct) => ({
  id: product.id, name: product.name, slug: product.slug,
  price: product.price.toFixed(2), compareAtPrice: product.compareAtPrice?.toFixed(2) ?? null,
  currency: 'USD' as const, category: product.category, brand: product.brand,
  availability: projectAvailability(product.status, product.inventory?.quantity),
});
const publicWhere = { status: ProductStatus.ACTIVE, category: { isActive: true } };

export class ProductService {
  async list({ page, pageSize }: Pagination) {
    const [products, total] = await prisma.$transaction([
      prisma.product.findMany({
        where: publicWhere, select: listSelect,
        skip: (page - 1) * pageSize, take: pageSize,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      }),
      prisma.product.count({ where: publicWhere }),
    ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    return {
      data: products.map(product => ({ ...mapBase(product), primaryImage: product.images[0] ?? null })),
      meta: { page, pageSize, total },
    };
  }

  async detail(slug: string) {
    const product = await prisma.product.findFirst({
      where: { ...publicWhere, slug }, select: detailSelect,
    });
    if (!product) throw new AppError('Product not found.', 404, 'PRODUCT_NOT_FOUND');
    const specifications = new Map<string, typeof product.specifications>();
    for (const specification of product.specifications) {
      const items = specifications.get(specification.group) ?? [];
      items.push(specification);
      specifications.set(specification.group, items);
    }
    return {
      ...mapBase(product), description: product.description, sku: product.sku,
      modelNumber: product.modelNumber, images: product.images,
      specifications: Array.from(specifications, ([group, items]) => ({ group, items })),
    };
  }
}
