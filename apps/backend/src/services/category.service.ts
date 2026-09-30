import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import type { Pagination } from './product.service.js';

const select = { id: true, name: true, slug: true, description: true, imageUrl: true } as const;

export class CategoryService {
  async list({ page, pageSize }: Pagination) {
    const rows = await prisma.$queryRaw<Array<{ total: bigint; id: string | null; name: string | null;
      slug: string | null; description: string | null; imageUrl: string | null; productCount: bigint | null }>>(Prisma.sql`
      WITH total AS (SELECT COUNT(*) AS total FROM "categories" WHERE "isActive" = true),
      page AS (SELECT "id", "name", "slug", "description", "imageUrl" FROM "categories"
        WHERE "isActive" = true ORDER BY "name" ASC, "id" ASC
        LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}),
      counts AS (SELECT p."categoryId", COUNT(*) AS "productCount" FROM "products" p
        JOIN page ON page."id" = p."categoryId" WHERE p."status" = 'ACTIVE' GROUP BY p."categoryId")
      SELECT total.total, page.*, counts."productCount" FROM total LEFT JOIN page ON true
      LEFT JOIN counts ON counts."categoryId" = page."id" ORDER BY page."name" ASC, page."id" ASC`);
    const data = rows.filter((row): row is typeof row & { id: string; name: string; slug: string } =>
      row.id !== null && row.name !== null && row.slug !== null).map(row => ({
      id: row.id, name: row.name, slug: row.slug, description: row.description,
      imageUrl: row.imageUrl, productCount: Number(row.productCount ?? 0),
    }));
    return { data, meta: { page, pageSize, total: Number(rows[0]?.total ?? 0) } };
  }

  async detail(slug: string) {
    const category = await prisma.category.findFirst({ where: { slug, isActive: true }, select });
    if (!category) throw new AppError('Category not found.', 404, 'CATEGORY_NOT_FOUND');
    const productCount = await prisma.product.count({ where: { categoryId: category.id, status: 'ACTIVE' } });
    return { ...category, productCount };
  }
}
