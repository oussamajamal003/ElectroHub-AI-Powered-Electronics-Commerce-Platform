import * as fontkit from 'fontkit';
import bidiFactory from 'bidi-js';
import type { FontRole } from './assets.js';

/**
 * Task 03.9 text engine on top of PDFKit: per-character font fallback (Poppins → Noto Sans → Noto Sans Arabic), Unicode
 * bidirectional ordering (bidi-js, UAX #9 rule L2) and measured wrapping. Text is only ever drawn as literal glyph runs; nothing
 * becomes a link, action or markup. A character no packaged font covers fails closed (no squares or question marks).
 */
const bidi = bidiFactory();

export type Weight = 'regular' | 'medium' | 'bold';
export interface TextStyle { size: number; weight?: Weight; color?: string }

export class DocumentDataError extends Error {
  constructor(public readonly code: 'UNSUPPORTED_GLYPH' | 'LAYOUT_OVERFLOW') { super('Document text cannot be rendered.'); this.name = 'DocumentDataError'; }
}

const ARABIC = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
const COMBINING = /\p{M}/u;
const WHITESPACE = /\s/;
/** Scripts fontkit lays out right-to-left (it reverses those glyph runs itself). Only Arabic is packaged. */
const fontkitReverses = (text: string) => ARABIC.test(text);

interface Run { text: string; role: FontRole; level: number }

/** Minimal PDFKit surface the engine needs (kept narrow so tests can reason about it). */
type Doc = PDFKit.PDFDocument;

export class TextEngine {
  private readonly metrics: Record<FontRole, fontkit.Font>;

  constructor(private readonly doc: Doc, fonts: Record<FontRole, Buffer>) {
    this.metrics = {} as Record<FontRole, fontkit.Font>;
    for (const role of Object.keys(fonts) as FontRole[]) {
      doc.registerFont(role, fonts[role]);
      this.metrics[role] = fontkit.create(fonts[role]);
    }
  }

  private roleFor(char: string, weight: Weight): FontRole | null {
    const codePoint = char.codePointAt(0)!;
    const bold = weight === 'bold';
    if (ARABIC.test(char)) return this.metrics[bold ? 'arabicBold' : 'arabic'].hasGlyphForCodePoint(codePoint) ? (bold ? 'arabicBold' : 'arabic') : null;
    const latin: FontRole = bold ? 'latinBold' : weight === 'medium' ? 'latinMedium' : 'latin';
    if (this.metrics[latin].hasGlyphForCodePoint(codePoint)) return latin;
    const fallback: FontRole = bold ? 'fallbackBold' : 'fallback';
    return this.metrics[fallback].hasGlyphForCodePoint(codePoint) ? fallback : null;
  }

  /** Splits into same-font segments; whitespace and combining marks stay with their neighbour. Throws on an uncovered glyph. */
  private segments(text: string, weight: Weight): { text: string; role: FontRole; start: number }[] {
    const out: { text: string; role: FontRole; start: number }[] = [];
    let index = 0;
    for (const char of text) {
      const previous = out[out.length - 1];
      if (previous && (WHITESPACE.test(char) || COMBINING.test(char))) previous.text += char;
      else {
        const role = this.roleFor(char, weight);
        if (!role) throw new DocumentDataError('UNSUPPORTED_GLYPH');
        if (previous && previous.role === role) previous.text += char; else out.push({ text: char, role, start: index });
      }
      index += char.length;
    }
    return out;
  }

  /** Throws DocumentDataError when a meaningful character has no packaged glyph. */
  assertCoverage(text: string) { this.segments(text, 'regular'); this.segments(text, 'bold'); }

  width(text: string, style: TextStyle): number {
    if (!text) return 0;
    return this.segments(text, style.weight ?? 'regular')
      .reduce((sum, segment) => sum + this.doc.font(segment.role).fontSize(style.size).widthOfString(segment.text), 0);
  }

  lineHeight(style: TextStyle, factor = 1.4) { return style.size * factor; }

  /** Greedy measured wrapping in logical order. Words longer than the width break by character (never truncated). */
  wrap(text: string, maxWidth: number, style: TextStyle): string[] {
    if (!text) return [''];
    const tokens = text.split(/(\s+)/).filter(token => token.length);
    const lines: string[] = [];
    let line = '';
    const push = () => { if (line.trim()) lines.push(line.trimEnd()); line = ''; };
    for (const token of tokens) {
      if (/^\s+$/.test(token)) { if (line) line += ' '; continue; }
      if (this.width(line + token, style) <= maxWidth) { line += token; continue; }
      if (line.trim()) push();
      if (this.width(token, style) <= maxWidth) { line = token; continue; }
      let chunk = '';
      for (const char of token) {
        if (chunk && !COMBINING.test(char) && this.width(chunk + char, style) > maxWidth) { lines.push(chunk); chunk = ''; }
        chunk += char;
      }
      line = chunk;
    }
    push();
    return lines.length ? lines : [''];
  }

  /**
   * Draws one already-wrapped line with its baseline at `baseline`. Mixed-direction lines are split into bidi runs, ordered
   * visually by rule L2 and wrapped in a Span with ActualText = logical text so copy/search returns the stored text order.
   */
  drawLine(text: string, x: number, baseline: number, width: number, style: TextStyle, align: 'left' | 'right' | 'center' = 'left') {
    if (!text) return;
    const weight = style.weight ?? 'regular';
    const doc = this.doc;
    const runs = this.visualRuns(text, weight);
    const total = runs.reduce((sum, run) => sum + doc.font(run.role).fontSize(style.size).widthOfString(run.text), 0);
    let cursor = align === 'right' ? x + width - total : align === 'center' ? x + (width - total) / 2 : x;
    const mixed = runs.some(run => run.level % 2 === 1);
    if (mixed) doc.markContent('Span', { actual: text } as PDFKit.Mixins.MarkingOptions);
    doc.fillColor(style.color ?? '#0F172A');
    for (const run of runs) {
      doc.font(run.role).fontSize(style.size);
      doc.text(run.text, cursor, baseline, { lineBreak: false, baseline: 'alphabetic' });
      cursor += doc.widthOfString(run.text);
    }
    if (mixed) doc.endMarkedContent();
  }

  /** Paragraph direction comes from the first strong character; runs are split by (level, font) and reordered for display. */
  private visualRuns(text: string, weight: Weight): Run[] {
    const segments = this.segments(text, weight);
    if (!/[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/.test(text)) return segments.map(segment => ({ text: segment.text, role: segment.role, level: 0 }));
    const { levels } = bidi.getEmbeddingLevels(text);
    const runs: Run[] = [];
    for (const segment of segments) {
      let offset = segment.start;
      for (const char of segment.text) {
        const level = levels[offset]!;
        const last = runs[runs.length - 1];
        if (last && last.role === segment.role && last.level === level) last.text += char; else runs.push({ text: char, role: segment.role, level });
        offset += char.length;
      }
    }
    // Rule L2: from the highest level down to the lowest odd level, reverse every maximal sequence at or above that level.
    const highest = Math.max(...runs.map(run => run.level));
    const lowestOdd = Math.min(...runs.map(run => run.level).filter(level => level % 2 === 1), highest + 1);
    let ordered = runs;
    for (let level = highest; level >= lowestOdd && level >= 1; level--) {
      const next: Run[] = [];
      for (let i = 0; i < ordered.length;) {
        if (ordered[i]!.level >= level) {
          let j = i;
          while (j < ordered.length && ordered[j]!.level >= level) j++;
          next.push(...ordered.slice(i, j).reverse());
          i = j;
        } else next.push(ordered[i++]!);
      }
      ordered = next;
    }
    // fontkit reverses Arabic-script runs itself. Odd-level runs it would not reverse (neutrals in a Latin font) are reversed and
    // mirrored here; even-level runs it would reverse (Arabic-Indic digits) are pre-reversed so the net order stays left-to-right.
    return ordered.map(run => {
      const rtl = run.level % 2 === 1;
      if (rtl && !fontkitReverses(run.text)) return { ...run, text: [...run.text].reverse().map(char => bidi.getMirroredCharacter(char) ?? char).join('') };
      if (!rtl && fontkitReverses(run.text)) return { ...run, text: [...run.text].reverse().join('') };
      return run;
    });
  }
}
