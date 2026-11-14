import { render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BRAND_TITLE, useDocumentTitle } from './pageTitle';

function Standalone({ label }: { label: string }) {
  useDocumentTitle(label);
  return null;
}

describe('browser tab branding', () => {
  it('titles pages outside the layouts with the brand', () => {
    render(<Standalone label="Admin Login" />);
    expect(document.title).toBe('Admin Login | ElectroHub — Electronics Commerce Platform');
  });

  it('keeps the static index.html title and favicons on the official brand assets', () => {
    const html = readFileSync(resolve(__dirname, '../../index.html'), 'utf8');
    expect(html).toContain(`<title>${BRAND_TITLE}</title>`);
    expect(html).not.toContain('vite.svg');
    // Absolute root paths keep the icon working on every nested deep link.
    expect(html).toContain('href="/brand/electrohub-mark.svg"');
    expect(html).toContain('href="/favicon-32.png"');
    expect(html).toContain('href="/apple-touch-icon.png"');
    for (const asset of ['brand/electrohub-mark.svg', 'favicon-32.png', 'apple-touch-icon.png', 'brand/electrohub-email-logo.png']) {
      expect(readFileSync(resolve(__dirname, '../../public', asset)).length).toBeGreaterThan(100);
    }
  });
});
