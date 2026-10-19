declare module 'fontkit' {
  /** Minimal surface used by the Task 03.9 document text engine (glyph coverage and vertical metrics only). */
  export interface Font {
    unitsPerEm: number;
    ascent: number;
    descent: number;
    hasGlyphForCodePoint(codePoint: number): boolean;
  }
  export function create(buffer: Buffer): Font;
}
