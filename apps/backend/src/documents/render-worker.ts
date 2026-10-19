import { parentPort } from 'node:worker_threads';
import { loadFontAssets, type FontRole } from './assets.js';
import { renderDocument } from './pdf-renderer.js';
import type { DocumentSnapshotV1 } from './document.types.js';

/**
 * Task 03.9 renderer worker thread. Fonts are loaded and checksum-verified once per worker. The pool terminates this thread on
 * deadline/cancellation, which genuinely stops CPU work (a Promise timeout alone would not).
 */
interface Job { id: number; snapshot: DocumentSnapshotV1; contentVersion: string }

const port = parentPort!;
let fonts: Record<FontRole, Buffer> | null = null;
try {
  fonts = loadFontAssets();
  port.postMessage({ type: 'ready' });
} catch {
  port.postMessage({ type: 'init-error' });
}

port.on('message', async (job: Job) => {
  if (!fonts) { port.postMessage({ type: 'result', id: job.id, ok: false, code: 'ASSETS_UNAVAILABLE' }); return; }
  try {
    const pdf = await renderDocument(job.snapshot, job.contentVersion, fonts);
    const transfer = pdf.bytes.buffer.slice(pdf.bytes.byteOffset, pdf.bytes.byteOffset + pdf.bytes.byteLength) as ArrayBuffer;
    port.postMessage({ type: 'result', id: job.id, ok: true, bytes: transfer, pageCount: pdf.pageCount }, [transfer]);
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : 'RENDER_FAILED';
    port.postMessage({ type: 'result', id: job.id, ok: false, code });
  }
});
