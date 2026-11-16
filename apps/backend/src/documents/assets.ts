import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Trusted, packaged PDF assets (Task 03.9 §9.5). Fonts are read only from this fixed folder, resolved relative to the installed
 * module (src/ and dist/ sit at the same depth), never from the working directory, request data or the network. Every file is
 * verified against its SHA-256 before use; the logo is drawn from vector paths in the layout code, so no image file is loaded.
 */
export const ASSET_ROOT = path.resolve(__dirname, '../../assets/documents');

export type FontRole = 'latin' | 'latinBold' | 'latinMedium' | 'fallback' | 'fallbackBold' | 'arabic' | 'arabicBold';

/** All families: SIL Open Font License 1.1 (license texts are packaged alongside). Source: @expo-google-fonts npm packages. */
export const FONT_MANIFEST: Record<FontRole, { file: string; sha256: string }> = {
  latin: { file: 'fonts/Poppins_400Regular.ttf', sha256: '707fdc5c8bab57a90061c6a8ed7b70d5ffb82fc810e994e79f90bace890c255a' },
  latinMedium: { file: 'fonts/Poppins_500Medium.ttf', sha256: '8d909883de81344e0fbcfef30e931872e92d9aeecdf85b6dcf6e0b28c078e98e' },
  latinBold: { file: 'fonts/Poppins_600SemiBold.ttf', sha256: '248c0244b350ec68880996aa6be6d7796274b49992d5fcbbefe251906aa4ea36' },
  fallback: { file: 'fonts/NotoSans_400Regular.ttf', sha256: 'fe8c022f48d8dd29f17b744d16f9346f4357e16f7d4f7be58b000ae7c291b614' },
  fallbackBold: { file: 'fonts/NotoSans_600SemiBold.ttf', sha256: 'e691fe27813ec6ed11d0a5be4c6c1f6739996ed682462eaa3244a6185217dd6c' },
  arabic: { file: 'fonts/NotoSansArabic_400Regular.ttf', sha256: '252629ca0e87b6233851249b8cbf7b43445211a8caf199f1b306a19202251508' },
  arabicBold: { file: 'fonts/NotoSansArabic_600SemiBold.ttf', sha256: '35e3c8bd9e17754ca30497fcd4a82921ee672c0e36a5e2b9aad7ed4b8d92e427' },
};

/** Changes whenever any packaged font byte changes; part of every document's content version. */
export const ASSET_VERSION = `assets-1.${createHash('sha256')
  .update(Object.entries(FONT_MANIFEST).map(([role, font]) => `${role}:${font.sha256}`).join('\n')).digest('hex').slice(0, 16)}`;

export class DocumentAssetsError extends Error {
  constructor(public readonly role: string) { super('Document assets are unavailable.'); this.name = 'DocumentAssetsError'; }
}

/** Reads and verifies every font; throws DocumentAssetsError naming only the role (never a path) on a missing/corrupt file. */
export function loadFontAssets(root = ASSET_ROOT): Record<FontRole, Buffer> {
  const fonts = {} as Record<FontRole, Buffer>;
  for (const [role, font] of Object.entries(FONT_MANIFEST) as [FontRole, { file: string; sha256: string }][]) {
    let bytes: Buffer;
    try { bytes = readFileSync(path.join(root, font.file)); } catch { throw new DocumentAssetsError(role); }
    if (createHash('sha256').update(bytes).digest('hex') !== font.sha256) throw new DocumentAssetsError(role);
    fonts[role] = bytes;
  }
  return fonts;
}

let readiness: boolean | null = null;
/** Cached readiness probe for health/disabled-mode decisions (cheap after the first verification). */
export function documentAssetsReady(): boolean {
  if (readiness === null) {
    try { loadFontAssets(); readiness = true; } catch { readiness = false; }
  }
  return readiness;
}
