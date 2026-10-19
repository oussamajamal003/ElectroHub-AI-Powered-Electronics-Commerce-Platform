
import { pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { ASSET_VERSION, loadFontAssets, type FontRole } from './assets.js';
import { DOCUMENT_LIMITS, type DocumentKind, type DocumentSnapshotV1 } from './document.types.js';
import { formatInstant, formatMoney } from './pdf-format.js';
import { renderDocument } from './pdf-renderer.js';
import { evaluateDocuments } from '../services/order-document.domain.js';
import { line, paidOrder, withPayment } from '../services/__tests__/order-document.fixtures.js';

/**
 * Renderer contract tests (Task 03.9). Output is checked independently: the PDF bytes are parsed with pdf.js (not with the
 * renderer's own helpers) and every expectation is a literal value or a property of the source order.
 */

const ORDER_REFERENCE = 'ORD-7C9E6679-7425-40DE-944B-E07FC1F90AE7';

const WORKER_SRC = pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')).href;

let fonts: Record<FontRole, Buffer>;
beforeAll(() => { fonts = loadFontAssets(); });

interface Parsed { numPages: number; pages: string[]; text: string; info: Record<string, unknown>; metadataXml: string | null }

const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();

async function parse(bytes: Buffer): Promise<Parsed> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = WORKER_SRC;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, disableFontFace: true }).promise;
  const pages: string[] = [];
  for (let number = 1; number <= doc.numPages; number++) {
    const page = await doc.getPage(number);
    const content = await page.getTextContent();
    pages.push(content.items.map(item => ('str' in item ? item.str : '')).join(' '));
  }
  const metadata = await doc.getMetadata();
  const xml = (metadata.metadata as { getRaw?: () => string } | null)?.getRaw?.() ?? null;
  return { numPages: doc.numPages, pages, text: normalize(pages.join(' ')), info: metadata.info as Record<string, unknown>, metadataXml: xml };
}

const countOf = (haystack: string, needle: string) => haystack.split(needle).length - 1;

function snapshotOf(order: ReturnType<typeof paidOrder>, kind: DocumentKind): DocumentSnapshotV1 {
  const decision = evaluateDocuments(order, ASSET_VERSION).find(entry => entry.kind === kind)!;
  if (!decision.available) throw new Error(`fixture ${kind} unavailable: ${decision.reason}`);
  return decision.snapshot!;
}

async function renderKind(order: ReturnType<typeof paidOrder>, kind: DocumentKind) {
  const decision = evaluateDocuments(order, ASSET_VERSION).find(entry => entry.kind === kind)!;
  if (!decision.available) throw new Error(`fixture ${kind} unavailable: ${decision.reason}`);
  return renderDocument(decision.snapshot!, decision.contentVersion!, fonts);
}

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try { await promise; return undefined; } catch (error) { return (error as { code?: string }).code; }
}

/** Mirrors the 100-line sample in scripts/generate-document-samples.ts. */
const longItems = Array.from({ length: 100 }, (_, index) => line(index, index % 7 === 0 ? '1249999.99' : '18.75', (index % 5) + 1,
  index % 9 === 0 ? `Professional modular workstation component bundle with extended warranty, rack rails, redundant power supply and a deliberately very long descriptive product title number ${index + 1}` : `Synthetic accessory item ${index + 1}`));

const fiftyItems = Array.from({ length: 50 }, (_, index) => line(index, '5.00', 1, `Synthetic accessory item ${index + 1}`));

const pendingOrder = withPayment(paidOrder({ status: 'AWAITING_CAPTURE' }), { status: 'PROCESSING', paidAt: null, cardBrand: null, cardLast4: null }, { state: 'CAPTURE_PENDING' });

describe('PDF renderer: basic output', () => {
  it.each(['invoice', 'receipt', 'summary'] as DocumentKind[])('renders a %s as a parseable PDF', async kind => {
    const pdf = await renderKind(paidOrder(), kind);
    expect(pdf.bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf.bytes.toString('latin1')).toContain('%%EOF');
    const parsed = await parse(pdf.bytes);
    expect(parsed.numPages).toBe(pdf.pageCount);
    expect(parsed.numPages).toBe(1);
  }, 60_000);

  it('places the page count of 1, 2 and 50 line invoices correctly', async () => {
    const one = await renderKind(paidOrder({}, [line(0)]), 'invoice');
    const two = await renderKind(paidOrder(), 'invoice');
    const fifty = await renderKind(paidOrder({}, fiftyItems), 'invoice');
    expect((await parse(one.bytes)).numPages).toBe(1);
    expect((await parse(two.bytes)).numPages).toBe(1);
    expect((await parse(fifty.bytes)).numPages).toBeGreaterThan(1);
  }, 60_000);

  it('keeps a 100 line invoice within 30 pages with correct "Page N of M" footers on every page', async () => {
    const pdf = await renderKind(paidOrder({}, longItems), 'invoice');
    const parsed = await parse(pdf.bytes);
    expect(parsed.numPages).toBeLessThanOrEqual(30);
    expect(parsed.numPages).toBeGreaterThan(1);
    expect(pdf.pageCount).toBe(parsed.numPages);
    parsed.pages.forEach((pageText, index) => {
      expect(normalize(pageText)).toContain(`Page ${index + 1} of ${parsed.numPages}`);
    });
  }, 60_000);

  it('repeats the Description column header on every page of a multipage invoice', async () => {
    const pdf = await renderKind(paidOrder({}, longItems), 'invoice');
    const parsed = await parse(pdf.bytes);
    expect(parsed.numPages).toBeGreaterThan(1);
    parsed.pages.forEach(pageText => expect(normalize(pageText)).toContain('Description'));
  }, 60_000);

  it('prints "Total paid (USD)" exactly once across all pages of a multipage invoice', async () => {
    const pdf = await renderKind(paidOrder({}, longItems), 'invoice');
    const parsed = await parse(pdf.bytes);
    expect(countOf(parsed.text, 'Total paid (USD)')).toBe(1);
  }, 60_000);

  it('prints every SKU exactly once and the full, untruncated order reference', async () => {
    const pdf = await renderKind(paidOrder({}, longItems), 'invoice');
    const parsed = await parse(pdf.bytes);
    for (let index = 1; index <= longItems.length; index++) {
      const sku = `EH-SYN-${String(index).padStart(4, '0')}`;
      expect(countOf(parsed.text, sku), sku).toBe(1);
    }
    expect(parsed.text).toContain(ORDER_REFERENCE);
  }, 60_000);
});

describe('PDF renderer: legal wording and eligibility-specific copy', () => {
  it('invoice carries the non-tax commercial wording and no tax or billing terms', async () => {
    const pdf = await renderKind(paidOrder(), 'invoice');
    const text = (await parse(pdf.bytes)).text.toLowerCase();
    expect(text).toContain('order invoice — commercial transaction statement'.toLowerCase());
    expect(text).toContain('not a tax invoice');
    expect(/\bvat\b/.test(text)).toBe(false);
    expect(text).not.toContain('tax id');
    expect(text).not.toContain('bill to');
  }, 60_000);

  it('summary for a pending order says it is not proof of payment and never claims payment', async () => {
    const pdf = await renderKind(pendingOrder, 'summary');
    const text = (await parse(pdf.bytes)).text.toLowerCase();
    expect(text).toContain('not proof of payment');
    expect(text).not.toContain('total paid');
    expect(text).not.toContain('payment confirmed');
  }, 60_000);

  it('receipt shows card, amount, TEST TRANSACTION and omits the shipping street', async () => {
    const pdf = await renderKind(paidOrder(), 'receipt');
    const text = (await parse(pdf.bytes)).text;
    expect(text).toContain('Visa ending 4242');
    expect(text).toContain('$1,357.99');
    expect(text).toContain('TEST TRANSACTION');
    expect(text).not.toContain('100 Synthetic Street');
  }, 60_000);

  it('receipt with no card brand renders "Card payment" and no "ending" text', async () => {
    const order = withPayment(paidOrder(), { cardBrand: null, cardLast4: null });
    const pdf = await renderKind(order, 'receipt');
    const text = (await parse(pdf.bytes)).text;
    expect(text).toContain('Card payment');
    expect(text.toLowerCase()).not.toContain('ending');
  }, 60_000);
});

describe('pdf-format helpers', () => {
  it('formats money with thousands separators from exact decimal strings', () => {
    expect(formatMoney('1234567.80')).toBe('$1,234,567.80');
    expect(formatMoney('0.00')).toBe('$0.00');
    expect(formatMoney('9999999999.99')).toBe('$9,999,999,999.99');
  });

  it('rejects money strings that are not plain 2-decimal values', () => {
    expect(() => formatMoney('1e3')).toThrow();
  });

  it('formats instants in explicit UTC', () => {
    expect(formatInstant('2026-10-01T10:00:05.000Z')).toBe('October 1, 2026, 10:00 UTC');
  });
});

describe('PDF renderer: determinism and metadata', () => {
  it('renders identical snapshots to byte-identical buffers', async () => {
    const snapshot = snapshotOf(paidOrder(), 'invoice');
    const first = await renderDocument(snapshot, 'v1.test', fonts);
    const second = await renderDocument(snapshot, 'v1.test', fonts);
    expect(first.bytes.equals(second.bytes)).toBe(true);
  }, 60_000);

  it('derives CreationDate from the purchase date and sets Title, Author without the recipient name', async () => {
    const pdf = await renderKind(paidOrder(), 'invoice');
    const parsed = await parse(pdf.bytes);
    const created = String(parsed.info.CreationDate);
    // PDF date: D:YYYYMMDDHHmmSS with an optional offset; compare as an instant.
    const match = /^D:(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:(Z)|([+-])(\d{2})'?(\d{2})'?)?/.exec(created);
    expect(match, `CreationDate was ${created}`).not.toBeNull();
    const [, y, mo, d, h, mi, s, zulu, sign, oh, om] = match!;
    const offsetMinutes = zulu ? 0 : (sign === '-' ? -1 : 1) * (Number(oh) * 60 + Number(om));
    const instant = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)) - offsetMinutes * 60_000;
    // The fixture's createdAt (purchase date) is 10:00:00Z; paidAt (10:00:05Z) must not drive the document date.
    expect(new Date(instant).toISOString()).toBe('2026-10-01T10:00:00.000Z');
    expect(String(parsed.info.Title)).toContain(ORDER_REFERENCE);
    expect(parsed.info.Author).toBe('ElectroHub');
    const metadata = JSON.stringify(parsed.info) + (parsed.metadataXml ?? '');
    expect(metadata).not.toContain('Alex Example');
  }, 60_000);
});

describe('PDF renderer: Unicode', () => {
  it('renders accented Latin, Cyrillic, Greek, currency symbols and Arabic without throwing', async () => {
    const order = paidOrder({
      shippingRecipient: 'Zoë Ångström — Пётр Иванов — Γιώργος Παπαδόπουλος',
      shippingLine1: 'شارع الحمرا 12',
      shippingLine2: 'أحمد محمد',
      shippingCity: 'Athens',
      shippingState: null,
      shippingPostalCode: '10431',
      shippingCountry: 'Greece',
    }, [line(0, '89.00', 1, 'Écouteurs € £ ¥ — édition “Café”'), line(1, '45.50', 2, 'Кабель USB-C Ελληνικά')]);
    const pdf = await renderKind(order, 'invoice');
    const parsed = await parse(pdf.bytes);
    expect(parsed.text).toContain('Zoë Ångström');
    expect(parsed.text).toContain('€ £ ¥');
    // pdf.js returns a separate item wherever the renderer switches font inside a word (Poppins -> Noto Sans), and the
    // extraction join adds a space at each such item boundary. Compare Greek/Cyrillic with whitespace removed so the check
    // tests glyph content and order rather than pdf.js item segmentation.
    const squashed = parsed.text.replace(/\s+/g, '');
    expect(squashed).toContain('Пётр Иванов'.replace(/\s+/g, ''));
    expect(squashed).toContain('Γιώργος Παπαδόπουλος'.replace(/\s+/g, ''));
    expect(squashed).toContain('КабельUSB-C'.replace(/\s+/g, ''));
    expect(squashed).toContain('Ελληνικά');
  }, 60_000);

  it.each([
    ['emoji in the recipient', { shippingRecipient: 'Alex 😀 Example' }],
    ['Hebrew in the recipient', { shippingRecipient: 'שלום Example' }],
  ])('rejects an uncovered glyph (%s) with UNSUPPORTED_GLYPH', async (_label, overrides) => {
    const snapshot = snapshotOf(paidOrder(overrides), 'invoice');
    await expect(renderDocument(snapshot, 'v1.test', fonts)).rejects.toMatchObject({ code: 'UNSUPPORTED_GLYPH' });
  }, 60_000);
});

describe('PDF renderer: injection', () => {
  it('renders hostile product text as literal text and emits no active PDF actions', async () => {
    const hostile = '<script>alert(1)</script> /JavaScript (x) /Launch';
    const pdf = await renderKind(paidOrder({}, [line(0, '10.00', 1, hostile)]), 'invoice');
    const parsed = await parse(pdf.bytes);
    expect(parsed.text).toContain('<script>alert(1)</script>');
    expect(parsed.text).toContain('/JavaScript (x) /Launch');
    const raw = pdf.bytes.toString('latin1');
    for (const token of ['/JavaScript', '/Launch', '/URI', '/OpenAction']) expect(raw, token).not.toContain(token);
  }, 60_000);
});

describe('PDF renderer: limits', () => {
  it('rejects a 100-line order with extremely long names (page cap or canonical size bound)', async () => {
    const longName = Array.from({ length: 300 }, (_, index) => `word${index}`).join(' ').slice(0, 2000);
    const items = Array.from({ length: 100 }, (_, index) => line(index, '1.00', 1, `${longName} ${index}`));
    const decision = evaluateDocuments(paidOrder({}, items), ASSET_VERSION).find(entry => entry.kind === 'invoice')!;
    if (!decision.available) {
      // Canonical snapshot exceeds the 256 KiB bound, so the eligibility matrix refuses it before any rendering.
      expect(decision.reason).toBe('DOCUMENT_TOO_LARGE');
      return;
    }
    expect(await codeOf(renderDocument(decision.snapshot!, decision.contentVersion!, fonts))).toBe('PAGE_LIMIT');
  }, 60_000);

  it('enforces the 30 page cap on a manually built snapshot that bypasses the eligibility bound', async () => {
    const base = snapshotOf(paidOrder(), 'invoice');
    const longName = Array.from({ length: 300 }, (_, index) => `segment${index}`).join(' ').slice(0, 2000);
    const items = Array.from({ length: 100 }, (_, index) => ({ name: `${longName} ${index}`, sku: `EH-LONG-${String(index + 1).padStart(4, '0')}`,
      quantity: 1, unitPrice: '1.00', lineTotal: '1.00' }));
    const snapshot: DocumentSnapshotV1 = { ...base, items, subtotal: '100.00', total: '109.99' };
    expect(DOCUMENT_LIMITS.maxPages).toBe(30);
    await expect(renderDocument(snapshot, 'v1.test', fonts)).rejects.toMatchObject({ code: 'PAGE_LIMIT' });
  }, 60_000);
});
