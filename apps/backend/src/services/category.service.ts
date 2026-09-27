import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import type { Pagination } from './product.service.js';

const select = { id: true, name: true, slug: true, description: true, imageUrl: true } as const;

export class CategoryService {
  async list({ page, pageSize }: Pagination) {
    const [data, total] = await prisma.$transaction([
      prisma.category.findMany({
        where: { isActive: true }, select, skip: (page - 1) * pageSize, take: pageSize,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      }),
      prisma.category.count({ where: { isActive: true } }),
    ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    return { data, meta: { page, pageSize, total } };
  }

  async detail(slug: string) {
    const category = await prisma.category.findFirst({ where: { slug, isActive: true }, select });
    if (!category) throw new AppError('Category not found.', 404, 'CATEGORY_NOT_FOUND');
    return category;
  }
}
