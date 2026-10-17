import { z } from 'zod';

const pageNumber = (fallback: number, maximum: number) => z.string().regex(/^[1-9]\d*$/)
  .transform(Number).pipe(z.number().int().safe().max(maximum)).optional().default(String(fallback));

export const orderPaginationSchema = z.object({
  page: pageNumber(1, 1000), pageSize: pageNumber(10, 50),
}).strict();
