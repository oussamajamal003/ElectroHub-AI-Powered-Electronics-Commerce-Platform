import { z } from 'zod';

/**
 * Task 04.5 admin delivery bodies. `.strict()` rejects authority fields a client might try to smuggle in (userId, paymentStatus,
 * actorUserId, isSimulated, source, revisionOverride…): identity comes from the verified token, the source is always ADMIN.
 */
const ETA_PAST_TOLERANCE_MS = 5 * 60_000;
const ETA_FUTURE_LIMIT_MS = 30 * 24 * 60 * 60_000;

const location = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  label: z.string().trim().max(80).transform(value => value || null).nullable().optional(),
}).strict();

export const deliveryUpdateSchema = (now: () => Date = () => new Date()) => z.object({
  expectedRevision: z.number().int().min(1).max(2_147_483_647),
  status: z.enum(['PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED']).optional(),
  location: location.nullable().optional(),
  estimatedAt: z.iso.datetime({ offset: true }).nullable().optional().refine(value => {
    if (value === undefined || value === null) return true;
    const time = new Date(value).getTime(), current = now().getTime();
    return time >= current - ETA_PAST_TOLERANCE_MS && time <= current + ETA_FUTURE_LIMIT_MS;
  }, 'The estimated arrival must be between now and 30 days from now.'),
  note: z.string().trim().max(280).transform(value => value || undefined).optional(),
}).strict().refine(value => value.status !== undefined || value.location !== undefined || value.estimatedAt !== undefined,
  'Change the status, location or estimated arrival.');

export type DeliveryUpdateInput = z.infer<ReturnType<typeof deliveryUpdateSchema>>;

export const deliveryStartSchema = z.object({}).strict();

const pageNumber = (fallback: number, maximum: number) => z.string().regex(/^[1-9]\d*$/)
  .transform(Number).pipe(z.number().int().safe().max(maximum)).prefault(String(fallback));

export const adminDeliveryListSchema = z.object({
  status: z.enum(['CONFIRMED', 'PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED']).optional(),
  page: pageNumber(1, 1000), pageSize: pageNumber(20, 50),
}).strict();
