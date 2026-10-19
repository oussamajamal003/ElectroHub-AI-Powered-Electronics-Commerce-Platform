import PDFDocument from 'pdfkit';
import type { FontRole } from './assets.js';
import { DOCUMENT_LIMITS, type DocumentSnapshotV1 } from './document.types.js';
import {
  DOCUMENT_TITLES, deliveryLabel, formatEstimate, formatInstant, formatMoney, fulfillmentLabel, paymentMethodLabel,
  paymentStateLabel, statusNotes,
} from './pdf-format.js';
import { TextEngine, type TextStyle } from './pdf-text.js';

/**
 * Task 03.9 shared print layout: A4 portrait, 40pt side / 42pt top margins, a reserved 36pt footer, embedded fonts, selectable
 * text, repeated table headers and "Page X of Y". Pure model-to-bytes: no database, network, filesystem path or clock input.
 */
export class DocumentLimitError extends Error {
  constructor(public readonly code: 'PAGE_LIMIT' | 'BYTE_LIMIT') { super('Document exceeds its rendering limits.'); this.name = 'DocumentLimitError'; }
}

const PAGE = { width: 595.28, height: 841.89 };
const MARGIN_X = 40;
const MARGIN_TOP = 42;
const FOOTER = 36;
const CONTENT_WIDTH = PAGE.width - MARGIN_X * 2;
const CONTENT_BOTTOM = PAGE.height - FOOTER - 14;
const COLOR = { primary: '#2563EB', text: '#0F172A', secondary: '#475569', border: '#E2E8F0', surface: '#F8FAFC', faint: '#64748B' };
/** Lucide "zap" (ISC), the storefront header mark, drawn as a vector path (24-unit viewBox). */
const ZAP = 'M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z';
const TEST_LABEL = 'TEST TRANSACTION — no live payment';

const style = (size: number, weight: TextStyle['weight'] = 'regular', color = COLOR.text): TextStyle => ({ size, weight, color });
const S = {
  title: style(19, 'bold'), qualifier: style(10, 'bold'), body: style(9.5), small: style(8, 'regular', COLOR.secondary),
  label: style(7.5, 'medium', COLOR.secondary), value: style(9.5, 'medium'), heading: style(10.5, 'bold'), th: style(8, 'bold', COLOR.secondary),
  total: style(11.5, 'bold'), footer: style(7.5, 'regular', COLOR.faint),
};

interface Column { header: string; width: number; align: 'left' | 'right' }

class Layout {
  readonly doc: PDFKit.PDFDocument;
  readonly text: TextEngine;
  private y = 0;
  private pages = 0;
  private readonly titles;

  constructor(private readonly snapshot: DocumentSnapshotV1, private readonly contentVersion: string, fonts: Record<FontRole, Buffer>) {
    const date = new Date(snapshot.purchaseDate);
    this.titles = DOCUMENT_TITLES[snapshot.kind];
    // Fixed metadata (source-event dates, no customer data) makes identical inputs produce identical bytes, including the file ID.
    this.doc = new PDFDocument({
      size: 'A4', margin: 0, autoFirstPage: false, bufferPages: true, compress: true, pdfVersion: '1.7', lang: 'en-US', displayTitle: true,
      info: { Title: `${this.titles.short} — ${snapshot.orderReference}`, Author: 'ElectroHub', Subject: this.titles.qualifier,
        Creator: 'ElectroHub documents', Producer: `ElectroHub ${snapshot.templateVersion}`, CreationDate: date, ModDate: date },
    });
    this.text = new TextEngine(this.doc, fonts);
  }

  get cursor() { return this.y; }
  gap(points: number) { this.y += points; }

  page(continued: boolean) {
    if (++this.pages > DOCUMENT_LIMITS.maxPages) throw new DocumentLimitError('PAGE_LIMIT');
    this.doc.addPage({ size: 'A4', margin: 0 });
    this.y = continued ? this.continuationHeader() : this.firstHeader();
  }

  /** Breaks to a new page (with the repeating header) when `height` does not fit; returns true when it broke. */
  ensure(height: number) {
    if (this.y + height <= CONTENT_BOTTOM) return false;
    this.page(true);
    return true;
  }

  private logo(x: number, y: number, size: number) {
    const doc = this.doc;
    doc.save().rect(x, y, size, size).fill(COLOR.primary);
    const icon = size * 0.66;
    doc.translate(x + (size - icon) / 2, y + (size - icon) / 2).scale(icon / 24)
      .path(ZAP).lineWidth(2).lineJoin('round').lineCap('round').stroke('#FFFFFF');
    doc.restore();
    const word = style(size * 0.66, 'bold', COLOR.primary);
    const baseline = y + size * 0.74;
    this.text.drawLine('Electro', x + size + 7, baseline, 200, word);
    this.text.drawLine('Hub', x + size + 7 + this.text.width('Electro', word), baseline, 100, { ...word, color: COLOR.text });
  }

  private testLabel(top: number) {
    if (!this.snapshot.testTransaction) return;
    const label = style(7, 'bold', COLOR.text);
    const width = this.text.width(TEST_LABEL, label) + 12;
    const x = PAGE.width - MARGIN_X - width;
    this.doc.save().lineWidth(0.75).rect(x, top, width, 15).stroke(COLOR.text).restore();
    this.text.drawLine(TEST_LABEL, x + 6, top + 10.2, width, label);
  }

  private firstHeader() {
    this.logo(MARGIN_X, MARGIN_TOP, 24);
    this.testLabel(MARGIN_TOP + 4.5);
    this.rule(MARGIN_TOP + 36, COLOR.primary, 1.5);
    let y = MARGIN_TOP + 52;
    for (const line of this.text.wrap(this.titles.title, CONTENT_WIDTH, S.title)) {
      this.text.drawLine(line, MARGIN_X, y + S.title.size, CONTENT_WIDTH, S.title);
      y += this.text.lineHeight(S.title, 1.3);
    }
    // The legal-mode qualifier is prominent first-page text, not a hidden footer disclaimer.
    const body = this.snapshot.kind === 'invoice'
      ? 'Commercial statement of a completed purchase. Tax details are not recorded, and the order reference is not a sequential invoice number.'
      : this.snapshot.kind === 'receipt'
        ? 'Confirms a payment ElectroHub recorded as successful. The confirmation time is not a bank settlement time.'
        : 'Shows the order as placed and its current status.';
    const lines = this.text.wrap(body, CONTENT_WIDTH - 20, S.small);
    const height = 12 + S.qualifier.size + 4 + lines.length * this.text.lineHeight(S.small, 1.35) + 6;
    this.doc.save().rect(MARGIN_X, y + 6, CONTENT_WIDTH, height).fill(COLOR.surface)
      .rect(MARGIN_X, y + 6, 3, height).fill(COLOR.primary).restore();
    let inner = y + 6 + 10 + S.qualifier.size;
    this.text.drawLine(this.titles.qualifier, MARGIN_X + 14, inner, CONTENT_WIDTH - 20, S.qualifier);
    inner += 5;
    for (const line of lines) { inner += this.text.lineHeight(S.small, 1.35); this.text.drawLine(line, MARGIN_X + 14, inner - 3, CONTENT_WIDTH - 20, S.small); }
    return y + 6 + height + 18;
  }

  private continuationHeader() {
    this.logo(MARGIN_X, MARGIN_TOP, 16);
    const right = `${this.titles.short} — continued · ${this.snapshot.orderReference}`;
    this.text.drawLine(right, MARGIN_X, MARGIN_TOP + 11.5, CONTENT_WIDTH, style(8, 'medium', COLOR.secondary), 'right');
    this.rule(MARGIN_TOP + 26, COLOR.primary, 1);
    return MARGIN_TOP + 42;
  }

  rule(y: number, color = COLOR.border, width = 0.75, x = MARGIN_X, length = CONTENT_WIDTH) {
    this.doc.save().moveTo(x, y).lineTo(x + length, y).lineWidth(width).stroke(color).restore();
  }

  /** Wrapped paragraph that continues across pages line by line. */
  paragraph(text: string, textStyle: TextStyle, x = MARGIN_X, width = CONTENT_WIDTH, factor = 1.4) {
    const height = this.text.lineHeight(textStyle, factor);
    for (const line of this.text.wrap(text, width, textStyle)) {
      this.ensure(height);
      this.y += height;
      this.text.drawLine(line, x, this.y - height * 0.28, width, textStyle);
    }
  }

  heading(text: string) {
    this.ensure(40);
    this.y += 16;
    this.text.drawLine(text, MARGIN_X, this.y, CONTENT_WIDTH, S.heading);
    this.y += 8;
  }

  /** Label/value pairs in two columns; values wrap fully (references are never ellipsized). */
  facts(rows: [string, string][]) {
    const columnWidth = (CONTENT_WIDTH - 24) / 2;
    for (let i = 0; i < rows.length; i += 2) {
      const pair = rows.slice(i, i + 2).map(([label, value]) => ({ label, lines: this.text.wrap(value, columnWidth, S.value) }));
      const height = 12 + Math.max(...pair.map(cell => cell.lines.length)) * this.text.lineHeight(S.value, 1.35) + 8;
      this.ensure(height);
      pair.forEach((cell, index) => {
        const x = MARGIN_X + index * (columnWidth + 24);
        this.text.drawLine(cell.label.toUpperCase(), x, this.y + 8, columnWidth, S.label);
        cell.lines.forEach((line, lineIndex) => this.text.drawLine(line, x, this.y + 12 + (lineIndex + 1) * this.text.lineHeight(S.value, 1.35) - 3, columnWidth, S.value));
      });
      this.y += height;
    }
  }

  /** Side-by-side blocks (e.g. Ship to / Delivery) with a small heading each. */
  blocks(blocks: { heading: string; lines: string[] }[]) {
    const columnWidth = (CONTENT_WIDTH - 24) / 2;
    const wrapped = blocks.map(block => ({ heading: block.heading, lines: block.lines.flatMap(line => this.text.wrap(line, columnWidth, S.body)) }));
    const lineHeight = this.text.lineHeight(S.body, 1.4);
    const height = 16 + Math.max(...wrapped.map(block => block.lines.length)) * lineHeight + 6;
    if (height <= CONTENT_BOTTOM - MARGIN_TOP - 60) this.ensure(height);
    const top = this.y;
    let bottom = top;
    wrapped.forEach((block, index) => {
      const x = MARGIN_X + index * (columnWidth + 24);
      this.y = top;
      this.text.drawLine(block.heading.toUpperCase(), x, this.y + 8, columnWidth, S.label);
      this.y += 12;
      for (const line of block.lines) {
        if (this.ensure(lineHeight)) this.text.drawLine(`${block.heading} (continued)`.toUpperCase(), x, this.y - 2, columnWidth, S.label);
        this.y += lineHeight;
        this.text.drawLine(line, x, this.y - lineHeight * 0.28, columnWidth, S.body);
      }
      bottom = Math.max(bottom, this.y);
    });
    this.y = bottom + 6;
  }

  private tableHeader(columns: Column[]) {
    const height = 22;
    this.doc.save().rect(MARGIN_X, this.y, CONTENT_WIDTH, height).fill(COLOR.surface).restore();
    this.rule(this.y, COLOR.border, 0.75);
    this.rule(this.y + height, COLOR.border, 0.75);
    let x = MARGIN_X;
    for (const column of columns) {
      this.text.drawLine(column.header, x + 6, this.y + 14.5, column.width - 12, S.th, column.align);
      x += column.width;
    }
    this.y += height;
  }

  /**
   * Item table with measured row heights. Column headers repeat on every continuation page; a row that fits is never split;
   * a row taller than a whole page is split deliberately with "(continued)" and its quantity/amounts appear exactly once.
   */
  table(columns: Column[], rows: { description: string[]; detail: string[]; cells: string[] }[]) {
    const nameHeight = this.text.lineHeight(S.body, 1.38);
    const detailHeight = this.text.lineHeight(S.small, 1.38);
    const padding = 8;
    this.ensure(22 + nameHeight * 2 + padding * 2);
    this.tableHeader(columns);
    const descriptionWidth = columns[0]!.width - 12;
    for (const row of rows) {
      const lines = [
        ...row.description.flatMap(text => this.text.wrap(text, descriptionWidth, S.body).map(line => ({ line, detail: false }))),
        ...row.detail.flatMap(text => this.text.wrap(text, descriptionWidth, S.small).map(line => ({ line, detail: true }))),
      ];
      const heightOf = (part: typeof lines) => padding * 2 + part.reduce((sum, item) => sum + (item.detail ? detailHeight : nameHeight), 0);
      if (this.y + heightOf(lines) > CONTENT_BOTTOM && heightOf(lines) <= CONTENT_BOTTOM - (MARGIN_TOP + 42) - 22) {
        this.page(true);
        this.tableHeader(columns);
      }
      let remaining = lines;
      let first = true;
      while (remaining.length) {
        let take = 0;
        let used = padding * 2 + (first ? 0 : detailHeight);
        while (take < remaining.length && this.y + used + (remaining[take]!.detail ? detailHeight : nameHeight) <= CONTENT_BOTTOM) {
          used += remaining[take]!.detail ? detailHeight : nameHeight;
          take++;
        }
        if (take === 0) { this.page(true); this.tableHeader(columns); continue; }
        const top = this.y;
        let lineY = top + padding;
        if (!first) { lineY += detailHeight; this.text.drawLine('(continued)', MARGIN_X + 6, lineY - 3, descriptionWidth, S.small); }
        for (const item of remaining.slice(0, take)) {
          const height = item.detail ? detailHeight : nameHeight;
          lineY += height;
          this.text.drawLine(item.line, MARGIN_X + 6, lineY - height * 0.3, descriptionWidth, item.detail ? S.small : S.body);
        }
        if (first) {
          let x = MARGIN_X + columns[0]!.width;
          row.cells.forEach((cell, index) => {
            const column = columns[index + 1]!;
            this.text.drawLine(cell, x + 6, top + padding + nameHeight - nameHeight * 0.3, column.width - 12, S.body, column.align);
            x += column.width;
          });
        }
        this.y = top + used;
        this.rule(this.y);
        remaining = remaining.slice(take);
        first = false;
        if (remaining.length) { this.page(true); this.tableHeader(columns); }
      }
    }
  }

  /** Right-aligned totals block, kept together on one page; the final amount appears exactly once. */
  totals(rows: { label: string; value: string; strong?: boolean }[]) {
    const width = 250;
    const x = PAGE.width - MARGIN_X - width;
    const height = 14 + rows.length * 22 + 6;
    this.ensure(height);
    this.y += 14;
    for (const row of rows) {
      if (row.strong) this.rule(this.y + 2, COLOR.text, 1, x, width);
      const rowStyle = row.strong ? S.total : S.body;
      this.y += 20;
      this.text.drawLine(row.label, x, this.y - 4, width / 2, row.strong ? S.heading : { ...S.body, color: COLOR.secondary });
      this.text.drawLine(row.value, x + width / 2, this.y - 4, width / 2, rowStyle, 'right');
      this.y += 2;
    }
    this.y += 6;
  }

  /** A short disclosure block with a left bar (monochrome-safe: meaning is carried by the text, not the colour). */
  note(title: string, body: string) {
    const lines = this.text.wrap(body, CONTENT_WIDTH - 24, S.body);
    const lineHeight = this.text.lineHeight(S.body, 1.4);
    const height = 14 + S.heading.size + lines.length * lineHeight + 8;
    this.ensure(height + 10);
    this.y += 10;
    this.doc.save().rect(MARGIN_X, this.y, CONTENT_WIDTH, height).fill(COLOR.surface).rect(MARGIN_X, this.y, 3, height).fill(COLOR.secondary).restore();
    let inner = this.y + 10 + S.heading.size;
    this.text.drawLine(title, MARGIN_X + 14, inner, CONTENT_WIDTH - 24, S.heading);
    inner += 4;
    for (const line of lines) { inner += lineHeight; this.text.drawLine(line, MARGIN_X + 14, inner - lineHeight * 0.28, CONTENT_WIDTH - 24, S.body); }
    this.y += height;
  }

  /** Second pass once the page count is known: footer with brand, kind, full reference, qualifiers and "Page X of Y". */
  footers() {
    const range = this.doc.bufferedPageRange();
    const qualifier = [this.snapshot.kind === 'invoice' ? 'Not a tax invoice' : this.snapshot.kind === 'summary' ? 'Not an invoice or proof of payment' : 'Payment receipt',
      this.snapshot.testTransaction ? 'TEST TRANSACTION' : null, `Version ${this.contentVersion}`].filter(Boolean).join(' · ');
    for (let index = 0; index < range.count; index++) {
      this.doc.switchToPage(range.start + index);
      const top = PAGE.height - FOOTER;
      this.rule(top, COLOR.border, 0.75);
      this.text.drawLine(`ElectroHub · ${this.titles.short} · ${this.snapshot.orderReference}`, MARGIN_X, top + 13, CONTENT_WIDTH - 70, S.footer);
      this.text.drawLine(`Page ${index + 1} of ${range.count}`, MARGIN_X, top + 13, CONTENT_WIDTH, style(7.5, 'medium', COLOR.secondary), 'right');
      this.text.drawLine(qualifier, MARGIN_X, top + 24, CONTENT_WIDTH, S.footer);
    }
  }

  get pageCount() { return this.pages; }
}

function itemTable(layout: Layout, snapshot: DocumentSnapshotV1) {
  const money = (value: string) => formatMoney(value);
  const numeric = (header: string, values: string[], minimum: number): Column => ({ header, align: 'right',
    width: Math.max(minimum, ...[header, ...values].map(value => layout.text.width(value, { size: 9.5, weight: 'bold' }) + 14)) });
  const columns: Column[] = [numeric('Qty', snapshot.items.map(item => String(item.quantity)), 40),
    numeric('Unit price', snapshot.items.map(item => money(item.unitPrice)), 78), numeric('Amount', snapshot.items.map(item => money(item.lineTotal)), 84)];
  const description: Column = { header: 'Description', align: 'left', width: CONTENT_WIDTH - columns.reduce((sum, column) => sum + column.width, 0) };
  layout.table([description, ...columns], snapshot.items.map(item => ({
    description: [item.name], detail: [`SKU ${item.sku}`], cells: [String(item.quantity), money(item.unitPrice), money(item.lineTotal)],
  })));
}

function totals(layout: Layout, snapshot: DocumentSnapshotV1, finalLabel: string) {
  layout.totals([
    { label: 'Subtotal', value: formatMoney(snapshot.subtotal) },
    { label: 'Shipping', value: formatMoney(snapshot.shipping) },
    { label: `${finalLabel} (USD)`, value: formatMoney(snapshot.total), strong: true },
  ]);
}

function shipping(layout: Layout, snapshot: DocumentSnapshotV1) {
  const blocks = [];
  if (snapshot.shipTo) blocks.push({ heading: 'Ship to', lines: [snapshot.shipTo.recipient, ...snapshot.shipTo.lines] });
  if (snapshot.delivery) blocks.push({ heading: 'Delivery', lines: [deliveryLabel(snapshot.delivery.method),
    `Estimated ${formatEstimate(snapshot.delivery.estimateStart, snapshot.delivery.estimateEnd)}`, 'Business-day estimate, not a guaranteed date.'] });
  if (blocks.length) layout.blocks(blocks);
}

function renderInvoice(layout: Layout, snapshot: DocumentSnapshotV1, contentVersion: string) {
  layout.facts([
    ['Order reference', snapshot.orderReference], ['Purchase date', formatInstant(snapshot.purchaseDate)],
    ['Payment', `Paid in full by card — ${paymentMethodLabel(snapshot)}`], ['Payment confirmed', formatInstant(snapshot.payment.paidAt!)],
    ['Order status', fulfillmentLabel(snapshot.fulfillmentStatus)], ['Document version', contentVersion],
  ]);
  layout.gap(6);
  shipping(layout, snapshot);
  layout.heading('Purchased items');
  itemTable(layout, snapshot);
  totals(layout, snapshot, 'Total paid');
  for (const note of statusNotes(snapshot)) layout.note(note.title, note.body);
}

function renderReceipt(layout: Layout, snapshot: DocumentSnapshotV1, contentVersion: string) {
  const amount = style(24, 'bold');
  layout.ensure(70);
  layout.text.drawLine('ORIGINAL AMOUNT PAID', MARGIN_X, layout.cursor + 8, CONTENT_WIDTH, S.label);
  layout.text.drawLine(`${formatMoney(snapshot.payment.amount!)} USD`, MARGIN_X, layout.cursor + 40, CONTENT_WIDTH, amount);
  layout.gap(56);
  layout.rule(layout.cursor);
  layout.gap(8);
  layout.facts([
    ['Receipt reference', snapshot.payment.receiptReference!], ['Order reference', snapshot.orderReference],
    ['Payment confirmed', formatInstant(snapshot.payment.paidAt!)], ['Payment method', paymentMethodLabel(snapshot)],
    ['Amount', `${formatMoney(snapshot.payment.amount!)}`], ['Currency', 'USD (US dollar)'],
    ['Payment status', snapshot.annotation.refundedAt ? 'Successful — subsequently refunded' : 'Successful'], ['Purchase date', formatInstant(snapshot.purchaseDate)],
    ['Document version', contentVersion],
  ]);
  for (const note of statusNotes(snapshot)) layout.note(note.title, note.body);
}

function renderSummary(layout: Layout, snapshot: DocumentSnapshotV1, contentVersion: string) {
  const verified = snapshot.payment.evidence === 'VERIFIED';
  layout.facts([
    ['Order reference', snapshot.orderReference], ['Order date', formatInstant(snapshot.purchaseDate)],
    ['Order status', fulfillmentLabel(snapshot.fulfillmentStatus)], ['Payment', paymentStateLabel(snapshot)],
    ...(verified ? [['Payment confirmed', formatInstant(snapshot.payment.paidAt!)], ['Payment method', paymentMethodLabel(snapshot)]] as [string, string][] : []),
    ['Document version', contentVersion],
  ]);
  layout.gap(6);
  shipping(layout, snapshot);
  layout.heading('Items');
  itemTable(layout, snapshot);
  totals(layout, snapshot, verified ? 'Total paid' : 'Order total');
  for (const note of statusNotes(snapshot)) layout.note(note.title, note.body);
}

/** Collects the complete PDF in memory with a hard byte ceiling; a truncated document is never returned. */
function collect(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let failed = false;
    doc.on('data', (chunk: Buffer) => {
      if (failed) return;
      size += chunk.length;
      if (size > DOCUMENT_LIMITS.maxPdfBytes) { failed = true; chunks.length = 0; reject(new DocumentLimitError('BYTE_LIMIT')); return; }
      chunks.push(chunk);
    });
    doc.on('end', () => { if (!failed) resolve(Buffer.concat(chunks, size)); });
    doc.on('error', reject);
  });
}

export async function renderDocument(snapshot: DocumentSnapshotV1, contentVersion: string, fonts: Record<FontRole, Buffer>) {
  const layout = new Layout(snapshot, contentVersion, fonts);
  const bytes = collect(layout.doc);
  bytes.catch(() => undefined); // observed below; avoids an unhandled rejection if layout throws first
  layout.page(false);
  if (snapshot.kind === 'invoice') renderInvoice(layout, snapshot, contentVersion);
  else if (snapshot.kind === 'receipt') renderReceipt(layout, snapshot, contentVersion);
  else renderSummary(layout, snapshot, contentVersion);
  layout.footers();
  layout.doc.end();
  const pdf = await bytes;
  return { bytes: pdf, pageCount: layout.pageCount };
}
