import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiBinary, apiClient, ApiError, isAbortError, setAccessToken } from './api';

afterEach(() => { vi.unstubAllGlobals(); setAccessToken(null); });

const encoder = new TextEncoder();
const pdfBytes = (text = '%PDF-1.7\n%test\n') => encoder.encode(text);
const pdfResponse = (body: Uint8Array = pdfBytes(), headers: Record<string, string> = {}) => new Response(body, {
  status: 200,
  headers: { 'content-type': 'application/pdf', 'content-length': String(body.byteLength), ...headers },
});
const json = (status: number, body: unknown, headers?: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const invoicePath = '/api/orders/ORD-X/documents/invoice?disposition=attachment';
const options = { fallbackFilename: 'ElectroHub-ORD-X-invoice.pdf' };

/** A body that enqueues the given chunks and records whether the consumer cancelled it. */
function chunkedBody(chunks: Uint8Array[], onCancel: () => void = () => {}) {
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) controller.enqueue(chunks[index++]);
      else controller.close();
    },
    cancel() { onCancel(); },
  });
}

describe('apiBinary transport', () => {
  it('attaches the bearer token from the shared store, uses no-store and credentials, and never puts the token in the URL', async () => {
    setAccessToken('token-abc');
    const fetchMock = vi.fn().mockResolvedValue(pdfResponse());
    vi.stubGlobal('fetch', fetchMock);
    await apiBinary(invoicePath, options);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(invoicePath);
    expect(url).not.toContain('token-abc');
    expect(init.cache).toBe('no-store');
    expect(init.credentials).toBe('include');
    expect((init.headers as Headers).get('Authorization')).toBe('Bearer token-abc');
    expect((init.headers as Headers).get('Accept')).toBe('application/pdf, application/json');
  });

  it('refreshes once after a 401 and retries the document with the new bearer', async () => {
    setAccessToken('expired');
    const fetchMock = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
      if (url === '/api/auth/refresh') return json(200, { accessToken: 'fresh' });
      return (init.headers as Headers).get('Authorization') === 'Bearer fresh'
        ? pdfResponse() : json(401, { error: { code: 'UNAUTHENTICATED', message: 'Expired.' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await apiBinary(invoicePath, options);
    expect(result.byteLength).toBe(pdfBytes().byteLength);
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual([invoicePath, '/api/auth/refresh', invoicePath]);
  });

  it('shares ONE refresh between a concurrent JSON request and a binary request that both receive 401', async () => {
    setAccessToken('expired');
    let refreshCalls = 0;
    const fetchMock = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
      if (url === '/api/auth/refresh') { refreshCalls++; return json(200, { accessToken: 'fresh' }); }
      if ((init.headers as Headers).get('Authorization') !== 'Bearer fresh') return json(401, { error: 'Expired' });
      return url === '/api/products' ? json(200, { data: [] }) : pdfResponse();
    });
    vi.stubGlobal('fetch', fetchMock);
    const [products, document] = await Promise.all([apiClient('/api/products'), apiBinary(invoicePath, options)]);
    expect(products).toEqual({ data: [] });
    expect(document.filename).toBe('ElectroHub-ORD-X-invoice.pdf');
    expect(refreshCalls).toBe(1);
  });

  it('maps a JSON error envelope on a 409 to ApiError with the server code, not a blob', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(409, { error: { code: 'DOCUMENT_NOT_AVAILABLE', message: 'This document is no longer available.' } })));
    const error = await apiBinary(invoicePath, options).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, code: 'DOCUMENT_NOT_AVAILABLE', message: 'This document is no longer available.' });
  });
});

describe('apiBinary validation', () => {
  it.each([
    ['text/html content type', () => new Response('<html>ok</html>', { status: 200, headers: { 'content-type': 'text/html' } })],
    ['application/json success content type', () => json(200, { data: { pdf: false } })],
    ['empty body', () => new Response(null, { status: 200, headers: { 'content-type': 'application/pdf' } })],
    ['body not starting with %PDF-', () => pdfResponse(pdfBytes('NOTPDF-1.7 body'))],
  ])('rejects a 200 with %s as DOCUMENT_INVALID_RESPONSE', async (_label, build) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(build()));
    await expect(apiBinary(invoicePath, options)).rejects.toMatchObject({ name: 'ApiError', status: 200, code: 'DOCUMENT_INVALID_RESPONSE' });
  });

  it('rejects a declared Content-Length above the byte cap', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(pdfResponse(pdfBytes('%PDF-1.7 0123456789'))));
    await expect(apiBinary(invoicePath, { ...options, maxBytes: 10 })).rejects.toMatchObject({ code: 'DOCUMENT_INVALID_RESPONSE' });
  });

  it('stops and rejects a streamed body that exceeds the cap when no Content-Length is declared', async () => {
    let cancelled = false;
    const chunks = [pdfBytes('%PDF-1.7'), new Uint8Array(10), new Uint8Array(10), new Uint8Array(10)];
    const stream = chunkedBody(chunks, () => { cancelled = true; });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(stream, { status: 200, headers: { 'content-type': 'application/pdf' } })));
    await expect(apiBinary(invoicePath, { ...options, maxBytes: 16 })).rejects.toMatchObject({ code: 'DOCUMENT_INVALID_RESPONSE' });
    expect(cancelled).toBe(true);
  });

  it('rejects a truncated transfer when fewer bytes arrive than Content-Length declares', async () => {
    const stream = chunkedBody([new Uint8Array(500).fill(0x25)]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(stream, { status: 200,
      headers: { 'content-type': 'application/pdf', 'content-length': '1000' } })));
    await expect(apiBinary(invoicePath, options)).rejects.toMatchObject({ code: 'DOCUMENT_INVALID_RESPONSE' });
  });
});

describe('apiBinary success', () => {
  it('returns a PDF Blob with size, contentVersion and the server-approved filename', async () => {
    const body = pdfBytes();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(pdfResponse(body, {
      'x-document-version': 'v1.3',
      'content-disposition': "attachment; filename*=UTF-8''ElectroHub-ORD-X-invoice.pdf",
    })));
    const result = await apiBinary(invoicePath, options);
    expect(result.blob).toBeInstanceOf(Blob);
    expect(result.blob.type).toBe('application/pdf');
    expect(result.blob.size).toBe(body.byteLength);
    expect(result.byteLength).toBe(body.byteLength);
    expect(result.contentVersion).toBe('v1.3');
    expect(result.filename).toBe('ElectroHub-ORD-X-invoice.pdf');
  });

  it.each([
    ['a traversal path in filename*', "attachment; filename*=UTF-8''..%2F..%2Fevil.exe"],
    ['a traversal path in quoted filename', 'attachment; filename="../../evil.exe"'],
    ['a quote-injected name', 'attachment; filename="a"b.pdf"'],
    ['a percent-encoded quote', "attachment; filename*=UTF-8''a%22b.pdf"],
  ])('falls back to the canonical filename for %s', async (_label, disposition) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(pdfResponse(pdfBytes(), { 'content-disposition': disposition })));
    const result = await apiBinary(invoicePath, options);
    expect(result.filename).toBe('ElectroHub-ORD-X-invoice.pdf');
  });
});

describe('apiBinary cancellation', () => {
  it('rejects with an AbortError (not an ApiError) when the signal aborts while the request is pending', async () => {
    const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('The user aborted a request.', 'AbortError')));
    })));
    const pending = apiBinary(invoicePath, { ...options, signal: controller.signal }).catch((caught: unknown) => caught);
    controller.abort();
    const error = await pending;
    expect(isAbortError(error)).toBe(true);
    expect(error).not.toBeInstanceOf(ApiError);
  });

  it('rejects with an AbortError when the signal aborts while the body is still streaming', async () => {
    const controller = new AbortController();
    const stream = new ReadableStream<Uint8Array>({
      start(streamController) {
        streamController.enqueue(pdfBytes());
        controller.signal.addEventListener('abort', () => streamController.error(new DOMException('aborted', 'AbortError')));
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(stream, { status: 200, headers: { 'content-type': 'application/pdf' } })));
    const pending = apiBinary(invoicePath, { ...options, signal: controller.signal }).catch((caught: unknown) => caught);
    await new Promise(resolve => setTimeout(resolve, 0));
    controller.abort();
    const error = await pending;
    expect(isAbortError(error)).toBe(true);
    expect(error).not.toBeInstanceOf(ApiError);
  });
});

describe('existing JSON transport regression', () => {
  it('still parses JSON and maps an unexpected 500 to the safe message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json(200, { data: { ok: true } }))
      .mockResolvedValueOnce(json(500, { error: 'Prisma secret path' })));
    await expect(apiClient('/api/products')).resolves.toEqual({ data: { ok: true } });
    await expect(apiClient('/api/products')).rejects.toMatchObject({ status: 500, message: 'Something went wrong. Please try again later.' });
  });
});
