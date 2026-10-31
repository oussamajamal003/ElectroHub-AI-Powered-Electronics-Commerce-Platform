import type { Prisma } from '@prisma/client';

/** shippingPhone is non-nullable, so it takes the same placeholder as the other required address fields. */
export const REDACTED_SHIPPING = { shippingRecipient: 'Deleted customer', shippingLine1: 'Redacted', shippingLine2: null, shippingCity: 'Redacted', shippingState: null,
  shippingPostalCode: null, shippingCountry: 'Redacted', shippingPhone: 'Redacted', shippingLatitude: null, shippingLongitude: null } as const;

/**
 * Account deletion keeps an ACTIVE order's shipping snapshot and current location so it can still be fulfilled. Both terminal outcomes
 * (DELIVERED, CANCELLED) end that need, so each calls this inside its own transaction. It redacts only when the owner is an anonymized
 * account and never touches payment, revision, status or event identities. Each write matches only rows that still hold data, so a repeat
 * writes nothing.
 */
export async function redactDeliveryForDeletedOwner(tx: Prisma.TransactionClient, orderId: string) {
  const order = await tx.order.findUnique({ where: { id: orderId }, select: { user: { select: { isActive: true, email: true } },
    delivery: { select: { id: true } } } });
  if (!order || order.user.isActive || !order.user.email.endsWith('@deleted.invalid')) return;
  // Match any personal shipping field not yet redacted, so a partial prior redaction is completed and a full one is left untouched.
  await tx.order.updateMany({ where: { id: orderId, OR: [{ shippingRecipient: { not: 'Deleted customer' } }, { shippingLine1: { not: 'Redacted' } }, { shippingLine2: { not: null } },
    { shippingCity: { not: 'Redacted' } }, { shippingState: { not: null } }, { shippingPostalCode: { not: null } }, { shippingCountry: { not: 'Redacted' } },
    { shippingPhone: { not: 'Redacted' } }, { shippingLatitude: { not: null } }, { shippingLongitude: { not: null } }] },
  data: { ...REDACTED_SHIPPING } });
  if (!order.delivery) return;
  const deliveryId = order.delivery.id;
  await tx.delivery.updateMany({ where: { id: deliveryId, OR: [{ latitude: { not: null } }, { longitude: { not: null } }, { locationLabel: { not: null } }, { locationSource: { not: null } }] },
    data: { latitude: null, longitude: null, locationLabel: null, locationSource: null } });
  await tx.deliveryEvent.updateMany({ where: { deliveryId, OR: [{ latitude: { not: null } }, { longitude: { not: null } }, { note: { not: null } }] },
    data: { latitude: null, longitude: null, note: null } });
}
