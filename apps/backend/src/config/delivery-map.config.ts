import { z } from 'zod';

/**
 * Task 04.6 dispatch hub (architecture §7.2): one origin for every order, from DELIVERY_ORIGIN_LAT/LNG/LABEL. All three unset means no
 * hub is configured and the map projection is omitted (the customer page keeps its text summary). A partial or out-of-range value is a
 * configuration error, so server bootstrap calls this once and refuses to start. Error messages name the variables, never the values.
 */
export type DeliveryOrigin = { latitude: number; longitude: number; label: string };

const schema = z.object({
  DELIVERY_ORIGIN_LAT: z.coerce.number().finite().min(-90).max(90),
  DELIVERY_ORIGIN_LNG: z.coerce.number().finite().min(-180).max(180),
  DELIVERY_ORIGIN_LABEL: z.string().trim().min(1).max(80),
});

export function parseDeliveryOrigin(source: NodeJS.ProcessEnv): DeliveryOrigin | null {
  const raw = { DELIVERY_ORIGIN_LAT: source.DELIVERY_ORIGIN_LAT?.trim() || undefined, DELIVERY_ORIGIN_LNG: source.DELIVERY_ORIGIN_LNG?.trim() || undefined,
    DELIVERY_ORIGIN_LABEL: source.DELIVERY_ORIGIN_LABEL?.trim() || undefined };
  if (Object.values(raw).every(value => value === undefined)) return null;
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new Error(`Invalid delivery origin configuration (${Object.keys(parsed.error.flatten().fieldErrors).join(', ')})`);
  return { latitude: parsed.data.DELIVERY_ORIGIN_LAT, longitude: parsed.data.DELIVERY_ORIGIN_LNG, label: parsed.data.DELIVERY_ORIGIN_LABEL };
}

let cached: { value: DeliveryOrigin | null } | undefined;
export function deliveryOrigin(): DeliveryOrigin | null {
  cached ??= { value: parseDeliveryOrigin(process.env) };
  return cached.value;
}
