/**
 * Task 03.9 synthetic PDF samples for physical inspection (no database, no network, no customer data).
 *   npx tsx scripts/generate-document-samples.ts <output-directory>
 * Renders through the production domain + renderer and prints SHA-256 / bytes / pages for the evidence record.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ASSET_VERSION, loadFontAssets } from '../src/documents/assets.js';
import { renderDocument } from '../src/documents/pdf-renderer.js';
import { evaluateDocuments, type DocumentSourceOrder } from '../src/services/order-document.domain.js';
import { line, paidOrder, withPayment } from '../src/services/__tests__/order-document.fixtures.js';
import type { DocumentKind } from '../src/documents/document.types.js';

const output = path.resolve(process.argv[2] ?? 'document-samples');
mkdirSync(output, { recursive: true });
const fonts = loadFontAssets();

const longItems = Array.from({ length: 100 }, (_, index) => line(index, index % 7 === 0 ? '1249999.99' : '18.75', (index % 5) + 1,
  index % 9 === 0 ? `Professional modular workstation component bundle with extended warranty, rack rails, redundant power supply and a deliberately very long descriptive product title number ${index + 1}` : `Synthetic accessory item ${index + 1}`));
const refunded = withPayment(paidOrder({ status: 'CANCELLED' }), { status: 'REFUNDED', refundedAt: new Date('2026-10-03T08:30:00.000Z') },
  { state: 'REFUNDED', refundId: 're_synthetic_0001', refundAmountCents: 135798 });
const unicode = paidOrder({ shippingRecipient: 'أحمد محمد — Zoë Ångström-Łukasz', shippingLine1: 'شارع الحمرا 12، بناية النور (الطابق ٣)',
  shippingLine2: 'Rue de l’Église “Bâtiment B” – Résidence', shippingCity: 'بيروت', shippingState: null, shippingPostalCode: '1103',
  shippingCountry: 'Lebanon — لبنان' }, [line(0, '89.00', 1, 'Écouteurs sans fil — édition spéciale “Café”'), line(1, '45.50', 2, 'سماعات لاسلكية — Model X2 (أسود)'),
  line(2, '12.00', 3, 'Кабель USB-C · Ελληνικά € £ ¥ ₹ ₺')]);
const pending = withPayment(paidOrder({ status: 'AWAITING_CAPTURE' }), { status: 'PROCESSING', paidAt: null, cardBrand: null, cardLast4: null }, { state: 'CAPTURE_PENDING' });

const samples: { name: string; order: DocumentSourceOrder; kind: DocumentKind }[] = [
  { name: '01-invoice', order: paidOrder(), kind: 'invoice' },
  { name: '02-receipt', order: paidOrder(), kind: 'receipt' },
  { name: '03-summary', order: paidOrder(), kind: 'summary' },
  { name: '04-invoice-100-lines', order: (() => { const base = paidOrder({}, longItems); return base; })(), kind: 'invoice' },
  { name: '05-invoice-refunded', order: refunded, kind: 'invoice' },
  { name: '06-receipt-refunded', order: refunded, kind: 'receipt' },
  { name: '07-invoice-unicode-arabic', order: unicode, kind: 'invoice' },
  { name: '08-summary-pending', order: pending, kind: 'summary' },
];

(async () => {
  for (const sample of samples) {
    const decision = evaluateDocuments(sample.order, ASSET_VERSION).find(entry => entry.kind === sample.kind)!;
    if (!decision.available) { console.log(`${sample.name}: UNAVAILABLE ${decision.reason}`); continue; }
    const started = performance.now();
    const pdf = await renderDocument(decision.snapshot!, decision.contentVersion!, fonts);
    const file = path.join(output, `${sample.name}.pdf`);
    writeFileSync(file, pdf.bytes);
    console.log(`${sample.name}.pdf sha256=${createHash('sha256').update(pdf.bytes).digest('hex')} bytes=${pdf.bytes.length} pages=${pdf.pageCount} ms=${Math.round(performance.now() - started)}`);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
