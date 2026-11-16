/** Escaping and URL helpers for commerce email rendering. Pure: no I/O. */

const HTML_ENTITIES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '`': '&#96;',
};

const MAX_HEADER_LENGTH = 200;

/** Escapes a value for HTML text and quoted attribute contexts. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"'`]/g, char => HTML_ENTITIES[char] ?? char);
}

/** Makes a value safe for a single header line: removes control characters (including CR/LF), trims and caps length. */
export function headerSafe(value: string): string {
  const printable = Array.from(value)
    .filter(char => {
      const code = char.codePointAt(0) ?? 0;
      return code >= 0x20 && code !== 0x7f;
    })
    .join('');
  return Array.from(printable.trim()).slice(0, MAX_HEADER_LENGTH).join('');
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

/** Accepts `https://host` and explicit local development `http://localhost[:port]` / `http://127.0.0.1[:port]` only. */
export function assertTrustedOrigin(origin: string): string {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new Error('UNTRUSTED_ORIGIN');
  }
  const hasNoPath = parsed.pathname === '/' && parsed.search === '' && parsed.hash === '';
  const hasNoCredentials = parsed.username === '' && parsed.password === '';
  const noTrailingSlash = !origin.endsWith('/');
  const isHttps = parsed.protocol === 'https:';
  const isLocal = parsed.protocol === 'http:' && LOCAL_HOSTS.has(parsed.hostname);
  if (!(isHttps || isLocal) || !hasNoPath || !hasNoCredentials || !noTrailingSlash) {
    throw new Error('UNTRUSTED_ORIGIN');
  }
  return origin;
}

/** Builds the public order-details link from a validated frontend origin and the public order reference. */
export function orderUrl(origin: string, orderReference: string): string {
  return `${assertTrustedOrigin(origin)}/orders/${encodeURIComponent(orderReference)}`;
}
