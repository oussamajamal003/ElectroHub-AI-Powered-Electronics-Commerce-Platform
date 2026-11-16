import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';

const cleanDisplayText = (value: string) => value.normalize('NFC')
  // eslint-disable-next-line no-control-regex
  .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
  .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069\u061C]/g, '')
  .replace(/\s+/g, ' ').trim();
const displayText = (max: number) => z.string().max(max).transform(cleanDisplayText).pipe(z.string().max(max));
const optionalDisplayText = (max: number) => displayText(max).nullable();

/** Identity printed on customer commerce documents, captured on the Order rather than read back from mutable settings. */
export const storeIdentitySchema = z.object({
  storeName: z.string().max(120).transform(cleanDisplayText).pipe(z.string().min(2).max(120)),
  supportEmail: z.string().email().max(255).nullable(),
  supportPhone: optionalDisplayText(32),
  addressLine1: optionalDisplayText(255), addressLine2: optionalDisplayText(255),
  city: optionalDisplayText(100), region: optionalDisplayText(100), postalCode: optionalDisplayText(20),
  country: optionalDisplayText(100),
}).strict();
export type StoreIdentitySnapshot = z.infer<typeof storeIdentitySchema>;

/** Historical profile used for pre-snapshot orders and old email outbox rows. */
export const LEGACY_STORE_IDENTITY: StoreIdentitySnapshot = {
  storeName: 'ElectroHub', supportEmail: null, supportPhone: null, addressLine1: null, addressLine2: null,
  city: null, region: null, postalCode: null, country: null,
};

export function parseStoreIdentitySnapshot(value: unknown): StoreIdentitySnapshot {
  const parsed = storeIdentitySchema.safeParse(value);
  return parsed.success ? parsed.data : LEGACY_STORE_IDENTITY;
}

/** Reads the singleton inside the caller's checkout transaction and returns an allowlisted immutable identity value. */
export async function readStoreIdentitySnapshot(database: Pick<PrismaClient, 'storeSettings'>): Promise<StoreIdentitySnapshot> {
  const row = await database.storeSettings.findUnique({ where: { id: 'default' }, select: {
    storeName: true, supportEmail: true, supportPhone: true, addressLine1: true, addressLine2: true,
    city: true, region: true, postalCode: true, country: true,
  } });
  return row ? storeIdentitySchema.parse(row) : LEGACY_STORE_IDENTITY;
}
