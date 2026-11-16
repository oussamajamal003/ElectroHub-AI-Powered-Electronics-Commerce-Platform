import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import type { Pagination } from './product.service.js';

const select = { id: true, name: true, slug: true, description: true, logoUrl: true } as const;

export class BrandService {
  async list({ page, pageSize }: Pagination) {
    const [data, total] = await prisma.$transaction([
      prisma.brand.findMany({
        select, skip: (page - 1) * pageSize, take: pageSize,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      }),
      prisma.brand.count(),
    ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    return { data, meta: { page, pageSize, total } };
  }

  async detail(slug: string) {
    const brand = await prisma.brand.findUnique({ where: { slug }, select });
    if (!brand) throw new AppError('Brand not found.', 404, 'BRAND_NOT_FOUND');
    return brand;
  }
}
