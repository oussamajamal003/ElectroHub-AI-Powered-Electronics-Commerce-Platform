import { useEffect } from 'react';

/** Default browser-tab identity. Mirrors the static `<title>` in index.html so first paint and route titles agree. */
export const BRAND_TITLE = 'ElectroHub — Electronics Commerce Platform';
const BRAND_TAGLINE = 'Electronics Commerce Platform';

/** `ElectroHub — Electronics Commerce Platform`, or `<configured store name> — …` when the store profile renames the storefront. */
export function brandTitle(storeName?: string | null): string {
  const name = storeName?.trim();
  return name && name !== 'ElectroHub' ? `${name} — ${BRAND_TAGLINE}` : BRAND_TITLE;
}

/** `Cart | ElectroHub — Electronics Commerce Platform`; the bare brand when a page has no heading yet. */
export function formatPageTitle(heading: string | null | undefined, brand: string = BRAND_TITLE): string {
  const text = heading?.trim();
  return text ? `${text} | ${brand}` : brand;
}

/**
 * Title for pages that render outside the storefront/admin layouts (admin sign-in, activation, the global 404). Layout pages use
 * `usePageTitle`, which derives the title from the rendered h1. Titles never carry user data: pass a fixed label only.
 */
export function useDocumentTitle(heading: string): void {
  useEffect(() => { document.title = formatPageTitle(heading); }, [heading]);
}
