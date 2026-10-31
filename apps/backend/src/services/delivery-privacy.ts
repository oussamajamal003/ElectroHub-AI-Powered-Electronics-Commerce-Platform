import type { Prisma } from '@prisma/client';

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
  await tx.order.updateMany({ where: { id: orderId, NOT: { shippingLine1: 'Redacted' } }, data: { shippingRecipient: 'Deleted customer', shippingLine1: 'Redacted',
    shippingLine2: null, shippingCity: 'Redacted', shippingState: null, shippingPostalCode: null, shippingCountry: 'Redacted', shippingLatitude: null, shippingLongitude: null } });
  if (!order.delivery) return;
  const deliveryId = order.delivery.id;
  await tx.delivery.updateMany({ where: { id: deliveryId, OR: [{ latitude: { not: null } }, { longitude: { not: null } }, { locationLabel: { not: null } }, { locationSource: { not: null } }] },
    data: { latitude: null, longitude: null, locationLabel: null, locationSource: null } });
  await tx.deliveryEvent.updateMany({ where: { deliveryId, OR: [{ latitude: { not: null } }, { longitude: { not: null } }, { note: { not: null } }] },
    data: { latitude: null, longitude: null, note: null } });
}
