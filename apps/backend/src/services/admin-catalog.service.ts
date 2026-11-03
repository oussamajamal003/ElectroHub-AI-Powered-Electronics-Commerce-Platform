import { Prisma, PrismaClient, type ProductStatus } from '@prisma/client';
import type { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { normalizeSlug } from '../validators/product.validator.js';
import { deriveStockStatus } from './inventory.service.js';
import { logSafely } from '../utils/logger.js';
import type { categoryCreateSchema, categoryListSchema, categoryUpdateSchema, productCreateSchema, productListSchema,
  productUpdateSchema } from '../validators/admin.validator.js';

/**
 * Task 05.1 admin catalog (products + categories). Writes are transactional and optimistic: a stale `expectedUpdatedAt` is a 409,
 * never a silent overwrite. Products are archived (status INACTIVE), never hard-deleted: OrderItem/PaymentAttemptItem reference them
 * with onDelete Restrict and keep their own purchase-time snapshots. QA fixtures (isTestFixture) stay out of admin lists and are read-only.
 */
type Db = PrismaClient | Prisma.TransactionClient;
type ProductList = z.infer<typeof productListSchema>;
type ProductCreate = z.infer<typeof productCreateSchema>;
type ProductUpdate = z.infer<typeof productUpdateSchema>;
type CategoryList = z.infer<typeof categoryListSchema>;
type CategoryCreate = z.infer<typeof categoryCreateSchema>;
type CategoryUpdate = z.infer<typeof categoryUpdateSchema>;
const TX = { maxWait: 10_000, timeout: 20_000 };
const pages = (page: number, pageSize: number, total: number) => ({ page, pageSize, total, totalPages: Math.ceil(total / pageSize) });

const listSelect = {
  id: true, name: true, sku: true, slug: true, price: true, compareAtPrice: true, status: true, updatedAt: true, createdAt: true,
  category: { select: { id: true, name: true, isActive: true } },
  brand: { select: { id: true, name: true } },
  inventory: { select: { quantity: true, lowStockAt: true, status: true, updatedAt: true } },
  images: { where: { mediaState: 'PUBLISHED' }, orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }, { id: 'asc' }], take: 1,
    select: { url: true, altText: true } },
  _count: { select: { images: { where: { mediaState: 'PUBLISHED' } } } },
} satisfies Prisma.ProductSelect;
type ListRow = Prisma.ProductGetPayload<{ select: typeof listSelect }>;

function inventoryProjection(inventory: ListRow['inventory']) {
  if (!inventory) return null;
  return { quantity: inventory.quantity, lowStockAt: inventory.lowStockAt, status: deriveStockStatus(inventory.quantity, inventory.lowStockAt),
    updatedAt: inventory.updatedAt.toISOString() };
}

export function projectAdminProduct(row: ListRow) {
  return {
    id: row.id, name: row.name, sku: row.sku, slug: row.slug, price: row.price.toFixed(2), compareAtPrice: row.compareAtPrice?.toFixed(2) ?? null,
    currency: 'USD' as const, status: row.status, category: row.category, brand: row.brand,
    image: row.images[0] ? { url: row.images[0].url, altText: row.images[0].altText } : null, imageCount: row._count.images,
    inventory: inventoryProjection(row.inventory),
    // Storefront visibility is derived exactly like publicProductWhere (minus fixture/visibility flags, which admin lists exclude).
    storefrontVisible: row.status === 'ACTIVE' && row.category.isActive,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  };
}

function mapUniqueViolation(error: unknown, entity: 'PRODUCT' | 'CATEGORY'): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    const target = String((error.meta?.target as string[] | string | undefined) ?? '');
    const field = target.includes('sku') ? 'SKU' : target.includes('slug') ? 'SLUG' : 'NAME';
    throw new AppError(`This ${field === 'SKU' ? 'SKU' : field.toLowerCase()} is already used by another ${entity.toLowerCase()}.`, 409, `${entity}_${field}_TAKEN`);
  }
  throw error;
}

export class AdminCatalogService {
  constructor(private readonly db: PrismaClient = prisma) {}

  // ─── Products ─────────────────────────────────────────
  async listProducts(query: ProductList) {
    const where: Prisma.ProductWhereInput = { isTestFixture: false };
    if (query.q) where.OR = [{ name: { contains: query.q, mode: 'insensitive' } }, { sku: { contains: query.q, mode: 'insensitive' } }];
    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.status) where.status = query.status;
    if (query.stock === 'OUT_OF_STOCK') where.AND = [{ OR: [{ inventory: { is: null } }, { inventory: { is: { quantity: 0 } } }] }];
    else if (query.stock) where.inventory = { is: { status: query.stock } };
    const orderBy: Prisma.ProductOrderByWithRelationInput[] = [{ [query.sort]: query.order }, { id: 'asc' }];
    const [rows, total] = await Promise.all([
      this.db.product.findMany({ where, orderBy, skip: (query.page - 1) * query.pageSize, take: query.pageSize, select: listSelect }),
      this.db.product.count({ where }),
    ]);
    return { data: rows.map(projectAdminProduct), meta: pages(query.page, query.pageSize, total) };
  }

  async getProduct(productId: string) {
    const row = await this.db.product.findUnique({ where: { id: productId }, select: {
      ...listSelect, description: true, modelNumber: true, isTestFixture: true,
      specifications: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], select: { id: true, group: true, name: true, value: true } },
      _count: { select: { images: { where: { mediaState: 'PUBLISHED' } }, orderItems: true } },
    } });
    if (!row || row.isTestFixture) throw new AppError('Product not found.', 404, 'PRODUCT_NOT_FOUND');
    return { ...projectAdminProduct(row), description: row.description, modelNumber: row.modelNumber, specifications: row.specifications,
      orderLineCount: row._count.orderItems };
  }

  async options() {
    const [categories, brands] = await Promise.all([
      this.db.category.findMany({ orderBy: [{ name: 'asc' }, { id: 'asc' }], select: { id: true, name: true, isActive: true }, take: 500 }),
      this.db.brand.findMany({ orderBy: [{ name: 'asc' }, { id: 'asc' }], select: { id: true, name: true }, take: 500 }),
    ]);
    return { categories, brands };
  }

  private async assertCategory(tx: Db, categoryId: string, current?: string) {
    const category = await tx.category.findUnique({ where: { id: categoryId }, select: { isActive: true } });
    if (!category) throw new AppError('Choose an existing category.', 400, 'CATEGORY_NOT_FOUND');
    // Keeping a product in a category that was later deactivated is allowed; moving or creating into one is not.
    if (!category.isActive && categoryId !== current) throw new AppError('This category is inactive. Reactivate it or choose another.', 409, 'CATEGORY_INACTIVE');
  }

  private async assertBrand(tx: Db, brandId: string | null) {
    if (brandId && !await tx.brand.findUnique({ where: { id: brandId }, select: { id: true } })) {
      throw new AppError('Choose an existing brand.', 400, 'BRAND_NOT_FOUND');
    }
  }

  private async assertSkuFree(tx: Db, sku: string, exceptId?: string) {
    const clash = await tx.product.findFirst({ where: { sku: { equals: sku, mode: 'insensitive' }, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { id: true } });
    if (clash) throw new AppError('This SKU is already used by another product.', 409, 'PRODUCT_SKU_TAKEN');
  }

  async createProduct(actorId: string, input: ProductCreate) {
    const id = await this.db.$transaction(async tx => {
      await this.assertCategory(tx, input.categoryId);
      await this.assertBrand(tx, input.brandId);
      await this.assertSkuFree(tx, input.sku);
      let slug = input.slug ?? normalizeSlug(input.name);
      if (await tx.product.findUnique({ where: { slug }, select: { id: true } })) {
        if (input.slug) throw new AppError('This slug is already used by another product.', 409, 'PRODUCT_SLUG_TAKEN');
        slug = normalizeSlug(`${slug}-${input.sku}`).slice(0, 280);
      }
      const product = await tx.product.create({ data: {
        name: input.name, sku: input.sku, slug, description: input.description, modelNumber: input.modelNumber,
        categoryId: input.categoryId, brandId: input.brandId, price: input.price, compareAtPrice: input.compareAtPrice, status: input.status,
        specifications: { create: input.specifications.map((spec, sortOrder) => ({ ...spec, sortOrder })) },
        inventory: { create: { quantity: input.inventory.quantity, lowStockAt: input.inventory.lowStockAt,
          status: deriveStockStatus(input.inventory.quantity, input.inventory.lowStockAt) } },
      }, select: { id: true } });
      return product.id;
    }, TX).catch(error => mapUniqueViolation(error, 'PRODUCT'));
    logSafely('info', 'Admin catalog change', { event: 'admin.product.created', actorId, productId: id, status: input.status });
    return this.getProduct(id);
  }

  async updateProduct(actorId: string, productId: string, input: ProductUpdate) {
    await this.db.$transaction(async tx => {
      const current = await tx.product.findUnique({ where: { id: productId }, select: { categoryId: true, isTestFixture: true } });
      if (!current || current.isTestFixture) throw new AppError('Product not found.', 404, 'PRODUCT_NOT_FOUND');
      await this.assertCategory(tx, input.categoryId, current.categoryId);
      await this.assertBrand(tx, input.brandId);
      await this.assertSkuFree(tx, input.sku, productId);
      const updated = await tx.product.updateMany({ where: { id: productId, updatedAt: new Date(input.expectedUpdatedAt) }, data: {
        name: input.name, sku: input.sku, description: input.description, modelNumber: input.modelNumber, categoryId: input.categoryId,
        brandId: input.brandId, price: input.price, compareAtPrice: input.compareAtPrice } });
      if (updated.count !== 1) throw new AppError('This product changed since you opened it. Reload it and review your edits.', 409, 'PRODUCT_CONFLICT');
      // Specifications are owned by the product and referenced nowhere else: replace them as one ordered set.
      await tx.productSpecification.deleteMany({ where: { productId } });
      if (input.specifications.length) {
        await tx.productSpecification.createMany({ data: input.specifications.map((spec, sortOrder) => ({ ...spec, productId, sortOrder })) });
      }
    }, TX).catch(error => mapUniqueViolation(error, 'PRODUCT'));
    logSafely('info', 'Admin catalog change', { event: 'admin.product.updated', actorId, productId });
    return this.getProduct(productId);
  }

  async setProductStatus(actorId: string, productId: string, status: ProductStatus, expected: string) {
    await this.db.$transaction(async tx => {
      const current = await tx.product.findUnique({ where: { id: productId }, select: { isTestFixture: true, status: true,
        category: { select: { isActive: true } } } });
      if (!current || current.isTestFixture) throw new AppError('Product not found.', 404, 'PRODUCT_NOT_FOUND');
      if (status === 'ACTIVE' && !current.category.isActive) {
        throw new AppError('Reactivate this product’s category first, or move the product to an active category.', 409, 'CATEGORY_INACTIVE');
      }
      const updated = await tx.product.updateMany({ where: { id: productId, updatedAt: new Date(expected) }, data: { status } });
      if (updated.count !== 1) throw new AppError('This product changed since you opened it. Reload and try again.', 409, 'PRODUCT_CONFLICT');
    }, TX);
    logSafely('info', 'Admin catalog change', { event: status === 'ACTIVE' ? 'admin.product.reactivated' : 'admin.product.archived', actorId, productId });
    return this.getProduct(productId);
  }

  // ─── Categories ───────────────────────────────────────
  async listCategories(query: CategoryList) {
    const where: Prisma.CategoryWhereInput = {};
    if (query.q) where.OR = [{ name: { contains: query.q, mode: 'insensitive' } }, { slug: { contains: query.q, mode: 'insensitive' } }];
    if (query.status) where.isActive = query.status === 'ACTIVE';
    const orderBy: Prisma.CategoryOrderByWithRelationInput[] = query.sort === 'products'
      ? [{ products: { _count: query.order } }, { name: 'asc' }] : [{ [query.sort]: query.order }, { id: 'asc' }];
    const [rows, total, active, inactive] = await Promise.all([
      this.db.category.findMany({ where, orderBy, skip: (query.page - 1) * query.pageSize, take: query.pageSize,
        select: { id: true, name: true, slug: true, description: true, isActive: true, createdAt: true, updatedAt: true,
          _count: { select: { products: { where: { isTestFixture: false } } } } } }),
      this.db.category.count({ where }),
      this.db.category.count({ where: { isActive: true } }),
      this.db.category.count({ where: { isActive: false } }),
    ]);
    return { data: rows.map(row => this.projectCategory(row)), meta: { ...pages(query.page, query.pageSize, total), summary: { active, inactive } } };
  }

  private projectCategory(row: { id: string; name: string; slug: string; description: string | null; isActive: boolean; createdAt: Date;
    updatedAt: Date; _count: { products: number } }) {
    return { id: row.id, name: row.name, slug: row.slug, description: row.description, isActive: row.isActive, productCount: row._count.products,
      createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
  }

  private async getCategory(categoryId: string, db: Db = this.db) {
    const row = await db.category.findUnique({ where: { id: categoryId }, select: { id: true, name: true, slug: true, description: true,
      isActive: true, createdAt: true, updatedAt: true, _count: { select: { products: { where: { isTestFixture: false } } } } } });
    if (!row) throw new AppError('Category not found.', 404, 'CATEGORY_NOT_FOUND');
    return this.projectCategory(row);
  }

  private async assertCategoryNameFree(tx: Db, name: string, exceptId?: string) {
    const clash = await tx.category.findFirst({ where: { name: { equals: name, mode: 'insensitive' }, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { id: true } });
    if (clash) throw new AppError('A category with this name already exists.', 409, 'CATEGORY_NAME_TAKEN');
  }

  async createCategory(actorId: string, input: CategoryCreate) {
    const id = await this.db.$transaction(async tx => {
      await this.assertCategoryNameFree(tx, input.name);
      const slug = input.slug ?? normalizeSlug(input.name).slice(0, 120);
      if (await tx.category.findUnique({ where: { slug }, select: { id: true } })) {
        throw new AppError('A category with this slug already exists.', 409, 'CATEGORY_SLUG_TAKEN');
      }
      // New categories start hidden (the schema default is visible) so products can be added before customers see them.
      return (await tx.category.create({ data: { name: input.name, slug, description: input.description, isActive: false }, select: { id: true } })).id;
    }, TX).catch(error => mapUniqueViolation(error, 'CATEGORY'));
    logSafely('info', 'Admin catalog change', { event: 'admin.category.created', actorId, categoryId: id });
    return this.getCategory(id);
  }

  /** The slug is the storefront URL: it is fixed at creation so existing links never break. */
  async updateCategory(actorId: string, categoryId: string, input: CategoryUpdate) {
    await this.db.$transaction(async tx => {
      if (!await tx.category.findUnique({ where: { id: categoryId }, select: { id: true } })) throw new AppError('Category not found.', 404, 'CATEGORY_NOT_FOUND');
      await this.assertCategoryNameFree(tx, input.name, categoryId);
      const updated = await tx.category.updateMany({ where: { id: categoryId, updatedAt: new Date(input.expectedUpdatedAt) },
        data: { name: input.name, description: input.description } });
      if (updated.count !== 1) throw new AppError('This category changed since you opened it. Reload and try again.', 409, 'CATEGORY_CONFLICT');
    }, TX).catch(error => mapUniqueViolation(error, 'CATEGORY'));
    logSafely('info', 'Admin catalog change', { event: 'admin.category.updated', actorId, categoryId });
    return this.getCategory(categoryId);
  }

  async setCategoryStatus(actorId: string, categoryId: string, isActive: boolean, expected: string) {
    const updated = await this.db.category.updateMany({ where: { id: categoryId, updatedAt: new Date(expected) }, data: { isActive } });
    if (updated.count !== 1) {
      await this.getCategory(categoryId);
      throw new AppError('This category changed since you opened it. Reload and try again.', 409, 'CATEGORY_CONFLICT');
    }
    logSafely('info', 'Admin catalog change', { event: isActive ? 'admin.category.reactivated' : 'admin.category.deactivated', actorId, categoryId });
    return this.getCategory(categoryId);
  }

  /** Permanent deletion only for a category no product (fixtures included) has ever referenced; otherwise deactivate. */
  async deleteCategory(actorId: string, categoryId: string) {
    await this.db.$transaction(async tx => {
      const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM categories WHERE id = ${categoryId}::uuid FOR UPDATE`;
      if (!rows.length) throw new AppError('Category not found.', 404, 'CATEGORY_NOT_FOUND');
      if (await tx.product.count({ where: { categoryId } })) {
        throw new AppError('Products still use this category. Deactivate it instead, or move its products first.', 409, 'CATEGORY_IN_USE');
      }
      await tx.category.delete({ where: { id: categoryId } });
    }, TX).catch(error => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        throw new AppError('Products still use this category. Deactivate it instead.', 409, 'CATEGORY_IN_USE');
      }
      throw error;
    });
    logSafely('info', 'Admin catalog change', { event: 'admin.category.deleted', actorId, categoryId });
  }
}
