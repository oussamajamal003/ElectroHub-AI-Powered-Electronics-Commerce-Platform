/**
 * Versioned, pure renderers for the seven commerce emails. Each renderer maps one typed snapshot to subject, preheader,
 * HTML and plain text. Every dynamic value is escaped for HTML; the plain-text part keeps the same facts unescaped.
 */
import {
  TEMPLATE_VERSION,
  type CommerceEmailSnapshot,
  type CommerceEmailType,
  type RenderContext,
  type RenderedCommerceEmail,
  type SnapshotOf,
} from '../../services/commerce-email.domain.js';
import { escapeHtml, headerSafe, orderUrl } from './escape.js';
import { formatCardBrand, formatEstimate, formatInstant, formatMoney } from './format.js';
import { FONT_STACK, MONO_STACK, renderLayout, type StatusTone } from './layout.js';

const CTA_LABEL = 'View Order Details';
const FOOTER_TEXT = 'You received this email because you placed an order with ElectroHub. '
  + 'You can find the latest information in Order Details.';
const P_STYLE = `margin:0 0 16px 0;font-family:${FONT_STACK};font-size:16px;line-height:24px;color:#0F172A;`;
const LABEL_STYLE = `margin:0 0 8px 0;font-family:${FONT_STACK};font-size:14px;line-height:20px;font-weight:600;color:#0F172A;`;

/** One logical section: HTML fragment plus the matching plain-text lines. */
interface Block { html: string; text: string[] }

interface EmailParts {
  subject: string;
  preheader: string;
  heading: string;
  statusLabel: string;
  statusTone: StatusTone;
  eventDateLabel: string;
  blocks: Block[];
}

interface KeyValue { label: string; value: string; strong?: boolean }

type OrderConfirmed = SnapshotOf<'ORDER_CONFIRMED'>;
type ItemSnapshot = OrderConfirmed['items'][number];
type DeliverySnapshot = OrderConfirmed['delivery'];
type AddressSnapshot = OrderConfirmed['shippingAddress'];

function paragraphBlock(text: string): Block {
  return { html: `<p style="${P_STYLE}">${escapeHtml(text)}</p>`, text: [text] };
}

function greetingBlock(recipientName: string | null): Block {
  return paragraphBlock(recipientName === null ? 'Hello,' : `Hi ${recipientName},`);
}

function sectionLabel(label: string): string {
  return `<p style="${LABEL_STYLE}">${escapeHtml(label)}</p>`;
}

function keyValueBlock(rows: readonly KeyValue[]): Block {
  const body = rows.map(row => {
    const border = 'padding:8px 0;border-top:1px solid #E2E8F0;';
    const labelStyle = `${border}font-family:${FONT_STACK};font-size:14px;line-height:20px;color:#475569;`;
    const valueStyle = `${border}font-family:${FONT_STACK};font-size:${row.strong ? '18px' : '16px'};line-height:24px;`
      + 'font-weight:600;color:#0F172A;text-align:right;white-space:nowrap;';
    return `<tr><td style="${labelStyle}">${escapeHtml(row.label)}</td>`
      + `<td align="right" style="${valueStyle}">${escapeHtml(row.value)}</td></tr>`;
  }).join('');
  return {
    html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px 0;">${body}</table>`,
    text: rows.map(row => `${row.label}: ${row.value}`),
  };
}

/** One row of the shared items table. The thumbnail cell is always present so columns align; it stays empty without an image. */
/** Items table sets font and colour once; cells inherit them, which keeps the 100-item worst case under the size budget. */
// Fixed layout with a reserved amount column: unbreakable names/SKUs wrap inside their cell instead of widening the email.
const ITEMS_TABLE_STYLE = `margin:0 0 16px 0;table-layout:fixed;overflow-wrap:anywhere;word-break:break-word;font-family:${FONT_STACK};font-size:16px;line-height:24px;color:#0F172A;`;

function itemRow(item: ItemSnapshot, currency: string): string {
  const border = 'border-bottom:1px solid #E2E8F0;';
  const image = item.imageUrl === null ? ''
    : `<img src="${escapeHtml(item.imageUrl)}" width="56" height="56" alt="" border="0" style="display:block;">`;
  const unitPrice = formatMoney(item.unitPrice, currency);
  const lineTotal = formatMoney(item.lineTotal, currency);
  return `<tr><td class="eh-thumb" width="68" valign="top" style="width:68px;padding:0 12px 16px 0;${border}">${image}</td>`
    + `<td valign="top" style="padding:0 12px 16px 0;${border}">`
    + `<p style="margin:0;font-weight:600;">${escapeHtml(item.name)}</p>`
    + `<p style="margin:2px 0 0 0;font-size:14px;line-height:20px;color:#475569;">`
    + `SKU <span style="font-family:${MONO_STACK};">${escapeHtml(item.sku)}</span> · `
    + `Qty ${item.quantity} × ${escapeHtml(unitPrice)}</p></td>`
    + `<td align="right" valign="top" width="116" style="width:116px;padding:0 0 16px 0;${border}font-weight:600;white-space:nowrap;">`
    + `${escapeHtml(lineTotal)}</td></tr>`;
}

function itemText(item: ItemSnapshot, currency: string): string[] {
  return [
    `- ${item.name} (SKU ${item.sku})`,
    `  Qty ${item.quantity} × ${formatMoney(item.unitPrice, currency)} = ${formatMoney(item.lineTotal, currency)}`,
  ];
}

function addressBlock(address: AddressSnapshot): Block {
  const cityLine = [address.city + (address.state ? `, ${address.state}` : ''), address.postalCode ?? ''].filter(Boolean).join(' ');
  const lines = [address.recipient, address.line1, address.line2 ?? '', cityLine, address.country].filter(line => line.length > 0);
  return {
    html: sectionLabel('Shipping address') + `<p style="${P_STYLE}">${lines.map(escapeHtml).join('<br>')}</p>`,
    text: ['SHIPPING ADDRESS', ...lines],
  };
}

function deliveryBlock(delivery: DeliverySnapshot, suffix: string, includeMethod: boolean): Block {
  const estimateLine = `Estimated delivery: ${formatEstimate(delivery.estimatedStart, delivery.estimatedEnd)} (${suffix})`;
  const lines = includeMethod ? [`Delivery method: ${delivery.label}`, estimateLine] : [estimateLine];
  return { html: lines.map(line => paragraphBlock(line).html).join(''), text: lines };
}

function composeEmail(parts: EmailParts, orderReference: string, ctx: RenderContext): RenderedCommerceEmail {
  const url = orderUrl(ctx.origin, orderReference);
  const html = renderLayout({
    preheader: parts.preheader,
    statusLabel: parts.statusLabel,
    statusTone: parts.statusTone,
    heading: parts.heading,
    reference: orderReference,
    eventDateLabel: parts.eventDateLabel,
    bodyHtml: parts.blocks.map(block => block.html).join(''),
    cta: { label: CTA_LABEL, url },
  });
  const text = [
    'ElectroHub',
    '',
    parts.heading,
    `${parts.statusLabel} · ${parts.eventDateLabel}`,
    `Order reference: ${orderReference}`,
    '',
    parts.blocks.map(block => block.text.join('\n')).join('\n\n'),
    '',
    CTA_LABEL,
    url,
    '',
    FOOTER_TEXT,
  ].join('\n');
  return { subject: headerSafe(parts.subject), preheader: parts.preheader, html, text };
}

export function renderOrderConfirmed(snapshot: OrderConfirmed, ctx: RenderContext): RenderedCommerceEmail {
  const { currency } = snapshot;
  const itemsBlock: Block = {
    html: sectionLabel('Items')
      + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="${ITEMS_TABLE_STYLE}">`
      + snapshot.items.map(item => itemRow(item, currency)).join('')
      + '</table>',
    text: ['ITEMS', ...snapshot.items.flatMap(item => itemText(item, currency))],
  };
  return composeEmail({
    subject: `Order confirmed — ${snapshot.orderReference}`,
    preheader: 'Your order is confirmed. Your order details are inside.',
    heading: 'Your order is confirmed',
    statusLabel: 'Order confirmed',
    statusTone: 'success',
    eventDateLabel: formatInstant(snapshot.occurredAt),
    blocks: [
      greetingBlock(snapshot.recipientName),
      paragraphBlock('Your purchase is confirmed. Here are your order details.'),
      itemsBlock,
      keyValueBlock([
        { label: 'Subtotal', value: formatMoney(snapshot.subtotal, currency) },
        { label: 'Shipping', value: snapshot.shipping === '0.00' ? 'Free' : formatMoney(snapshot.shipping, currency) },
        { label: 'Total', value: formatMoney(snapshot.total, currency), strong: true },
      ]),
      deliveryBlock(snapshot.delivery, 'business days; estimate only', true),
      addressBlock(snapshot.shippingAddress),
    ],
  }, snapshot.orderReference, ctx);
}

export function renderPaymentConfirmed(snapshot: SnapshotOf<'PAYMENT_CONFIRMED'>, ctx: RenderContext): RenderedCommerceEmail {
  const rows: KeyValue[] = [
    { label: 'Amount paid', value: formatMoney(snapshot.amount, snapshot.currency), strong: true },
    { label: 'Paid on', value: formatInstant(snapshot.paidAt) },
  ];
  if (snapshot.card) {
    rows.push({ label: 'Payment method', value: `${formatCardBrand(snapshot.card.brand)} ending in ${snapshot.card.last4}` });
  }
  return composeEmail({
    subject: `Payment confirmed — ${snapshot.orderReference}`,
    preheader: 'Your payment for this order is confirmed.',
    heading: 'Your payment is confirmed',
    statusLabel: 'Payment confirmed',
    statusTone: 'success',
    eventDateLabel: formatInstant(snapshot.paidAt),
    blocks: [
      greetingBlock(snapshot.recipientName),
      paragraphBlock('We’ve confirmed your payment for this order.'),
      keyValueBlock(rows),
    ],
  }, snapshot.orderReference, ctx);
}

export function renderOrderPreparing(snapshot: SnapshotOf<'ORDER_PREPARING'>, ctx: RenderContext): RenderedCommerceEmail {
  const date = formatInstant(snapshot.occurredAt);
  return composeEmail({
    subject: `We’re preparing your order — ${snapshot.orderReference}`,
    preheader: 'Your order has moved to Preparing.',
    heading: 'Your order is being prepared',
    statusLabel: 'Preparing',
    statusTone: 'progress',
    eventDateLabel: date,
    blocks: [
      greetingBlock(snapshot.recipientName),
      paragraphBlock(`Your order moved to Preparing on ${date}.`),
      deliveryBlock(snapshot.delivery, 'estimate only', false),
    ],
  }, snapshot.orderReference, ctx);
}

export function renderOrderOutForDelivery(snapshot: SnapshotOf<'ORDER_OUT_FOR_DELIVERY'>, ctx: RenderContext): RenderedCommerceEmail {
  const date = formatInstant(snapshot.occurredAt);
  return composeEmail({
    subject: `Your order is out for delivery — ${snapshot.orderReference}`,
    preheader: 'Your order is out for delivery.',
    heading: 'Your order is out for delivery',
    statusLabel: 'Out for delivery',
    statusTone: 'progress',
    eventDateLabel: date,
    blocks: [
      greetingBlock(snapshot.recipientName),
      paragraphBlock(`Your order moved to Out for Delivery on ${date}.`),
      deliveryBlock(snapshot.delivery, 'estimate only', false),
    ],
  }, snapshot.orderReference, ctx);
}

export function renderOrderDelivered(snapshot: SnapshotOf<'ORDER_DELIVERED'>, ctx: RenderContext): RenderedCommerceEmail {
  const date = formatInstant(snapshot.occurredAt);
  return composeEmail({
    subject: `Order delivered — ${snapshot.orderReference}`,
    preheader: 'Your order is marked delivered.',
    heading: 'Your order is marked delivered',
    statusLabel: 'Delivered',
    statusTone: 'success',
    eventDateLabel: date,
    blocks: [
      greetingBlock(snapshot.recipientName),
      paragraphBlock(`Your order was marked delivered on ${date}.`),
    ],
  }, snapshot.orderReference, ctx);
}

/** Refund wording is produced only from a persisted refund; the paymentConfirmed flag alone never claims one. */
function cancellationPaymentText(snapshot: SnapshotOf<'ORDER_CANCELLED'>): string {
  if (snapshot.refund) {
    return `A refund of ${formatMoney(snapshot.refund.amount, snapshot.refund.currency)} has been recorded for this order. `
      + 'Your bank’s processing time may vary.';
  }
  if (!snapshot.paymentConfirmed) {
    return 'No payment was taken for this order. If your bank shows a temporary authorization hold, it is released by your bank.';
  }
  return 'We’ll update your order details if a refund is recorded.';
}

export function renderOrderCancelled(snapshot: SnapshotOf<'ORDER_CANCELLED'>, ctx: RenderContext): RenderedCommerceEmail {
  const date = formatInstant(snapshot.occurredAt);
  return composeEmail({
    subject: `Order cancelled — ${snapshot.orderReference}`,
    preheader: 'Your order was cancelled.',
    heading: 'Your order was cancelled',
    statusLabel: 'Cancelled',
    statusTone: 'neutral',
    eventDateLabel: date,
    blocks: [
      greetingBlock(snapshot.recipientName),
      paragraphBlock(`Your order was cancelled on ${date}.`),
      paragraphBlock(cancellationPaymentText(snapshot)),
    ],
  }, snapshot.orderReference, ctx);
}

export function renderPaymentRefunded(snapshot: SnapshotOf<'PAYMENT_REFUNDED'>, ctx: RenderContext): RenderedCommerceEmail {
  const date = formatInstant(snapshot.refundedAt);
  return composeEmail({
    subject: `Refund confirmed — ${snapshot.orderReference}`,
    preheader: 'A refund has been recorded for your order.',
    heading: 'Your refund is confirmed',
    statusLabel: 'Refund recorded',
    statusTone: 'neutral',
    eventDateLabel: date,
    blocks: [
      greetingBlock(snapshot.recipientName),
      paragraphBlock('The refund has been recorded. Your bank’s processing time may vary.'),
      keyValueBlock([
        { label: 'Refund amount', value: formatMoney(snapshot.amount, snapshot.currency), strong: true },
        { label: 'Recorded on', value: date },
      ]),
    ],
  }, snapshot.orderReference, ctx);
}

type RendererMap = { [K in CommerceEmailType]: (snapshot: SnapshotOf<K>, ctx: RenderContext) => RenderedCommerceEmail };

/** Renderer registry per template version. Future versions are added as new keys so old outbox rows still render. */
const rendererRegistry: Readonly<Record<string, RendererMap>> = {
  v1: {
    ORDER_CONFIRMED: renderOrderConfirmed,
    PAYMENT_CONFIRMED: renderPaymentConfirmed,
    ORDER_PREPARING: renderOrderPreparing,
    ORDER_OUT_FOR_DELIVERY: renderOrderOutForDelivery,
    ORDER_DELIVERED: renderOrderDelivered,
    ORDER_CANCELLED: renderOrderCancelled,
    PAYMENT_REFUNDED: renderPaymentRefunded,
  },
};

export function renderCommerceEmail(snapshot: CommerceEmailSnapshot, ctx: RenderContext, templateVersion: string): RenderedCommerceEmail {
  const renderers = Object.hasOwn(rendererRegistry, templateVersion) ? rendererRegistry[templateVersion] : undefined;
  if (templateVersion !== TEMPLATE_VERSION || !renderers) throw new Error('UNSUPPORTED_TEMPLATE_VERSION');
  switch (snapshot.type) {
    case 'ORDER_CONFIRMED': return renderers.ORDER_CONFIRMED(snapshot, ctx);
    case 'PAYMENT_CONFIRMED': return renderers.PAYMENT_CONFIRMED(snapshot, ctx);
    case 'ORDER_PREPARING': return renderers.ORDER_PREPARING(snapshot, ctx);
    case 'ORDER_OUT_FOR_DELIVERY': return renderers.ORDER_OUT_FOR_DELIVERY(snapshot, ctx);
    case 'ORDER_DELIVERED': return renderers.ORDER_DELIVERED(snapshot, ctx);
    case 'ORDER_CANCELLED': return renderers.ORDER_CANCELLED(snapshot, ctx);
    case 'PAYMENT_REFUNDED': return renderers.PAYMENT_REFUNDED(snapshot, ctx);
  }
}
