import { Prisma, ProductStatus } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { SearchService } from './search.service.js';

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
export const productSummarySelect = {
  ...baseSelect, description: true,
  images: {
    take: 2,
    orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }, { id: 'asc' }],
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
export interface ReviewAggregate { reviewCount: number; averageRating: string | null }
export async function loadReviewAggregates(client: Prisma.TransactionClient, productIds: string[]) {
  const aggregates = productIds.length ? await client.review.groupBy({
    by: ['productId'], where: { productId: { in: productIds } },
    _count: { _all: true }, _avg: { rating: true },
  }) : [];
  return new Map<string, ReviewAggregate>(aggregates.map(value => [value.productId, {
    reviewCount: value._count._all,
    averageRating: value._avg.rating === null ? null : value._avg.rating.toFixed(1),
  }]));
}
export const emptyReviewAggregate: ReviewAggregate = { reviewCount: 0, averageRating: null };
const mapBase = (product: BaseProduct) => ({
  id: product.id, name: product.name, slug: product.slug,
  price: product.price.toFixed(2), compareAtPrice: product.compareAtPrice?.toFixed(2) ?? null,
  currency: 'USD' as const, category: product.category, brand: product.brand,
  availability: projectAvailability(product.status, product.inventory?.quantity),
  discountPercent: product.compareAtPrice?.gt(product.price)
    ? product.compareAtPrice.minus(product.price).div(product.compareAtPrice).mul(100)
      .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).toNumber() : null,
});
const publicWhere = { status: ProductStatus.ACTIVE, category: { isActive: true } };
export const publicProductWhere = publicWhere;
export function mapProductSummary(product: Prisma.ProductGetPayload<{ select: typeof productSummarySelect }>, aggregate: ReviewAggregate = emptyReviewAggregate) {
  return { ...mapBase(product), ...aggregate, description: product.description?.slice(0, 160) ?? null,
    primaryImage: product.images[0] ?? null, secondaryImage: product.images[1] ?? null };
}

export class ProductService {
  async list({ page, pageSize }: Pagination) {
    const result = await new SearchService().products({ q: '', page, pageSize });
    return { data: result.data, meta: { page, pageSize, total: result.meta.total } };
  }

  async deals({ page, pageSize }: Pagination) {
    const result = await new SearchService().products({ q: '', page, pageSize }, undefined, true);
    return { data: result.data, meta: { page, pageSize, total: result.meta.total } };
  }

  async detail(slug: string) {
    const product = await prisma.product.findFirst({
      where: { ...publicWhere, slug }, select: detailSelect,
    });
    if (!product) throw new AppError('Product not found.', 404, 'PRODUCT_NOT_FOUND');
    const aggregates = await prisma.review.aggregate({ where: { productId: product.id },
      _count: { _all: true }, _avg: { rating: true } });
    const specifications = new Map<string, typeof product.specifications>();
    for (const specification of product.specifications) {
      const items = specifications.get(specification.group) ?? [];
      items.push(specification);
      specifications.set(specification.group, items);
    }
    return {
      ...mapBase(product), reviewCount: aggregates._count._all,
      availableQuantity: Math.max(0, product.inventory?.quantity ?? 0),
      averageRating: aggregates._avg.rating?.toFixed(1) ?? null,
      description: product.description, sku: product.sku,
      modelNumber: product.modelNumber, images: product.images,
      specifications: Array.from(specifications, ([group, items]) => ({ group, items })),
    };
  }
}
