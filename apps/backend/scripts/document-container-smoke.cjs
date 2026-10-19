/* Runtime image smoke: run against the compiled production modules with no database or network. */
const path = require('node:path');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const appRoot = process.env.ELECTROHUB_BACKEND_ROOT || path.resolve(__dirname, '..');
const appRequire = createRequire(path.join(appRoot, 'package.json'));
const { ASSET_VERSION, loadFontAssets } = appRequire(path.join(appRoot, 'dist/documents/assets.js'));
const { TEMPLATE_VERSION, SELLER_PROFILE_VERSION } = appRequire(path.join(appRoot, 'dist/documents/document.types.js'));
const { renderDocument } = appRequire(path.join(appRoot, 'dist/documents/pdf-renderer.js'));

async function main() {
  const snapshot = {
    version: 1, kind: 'invoice', policy: 'COMMERCIAL_V1', templateVersion: TEMPLATE_VERSION,
    assetVersion: ASSET_VERSION, sellerProfileVersion: SELLER_PROFILE_VERSION, testTransaction: true,
    orderReference: 'ORD-7C9E6679-7425-40DE-944B-E07FC1F90AE7', purchaseDate: '2026-10-01T10:00:00.000Z',
    fulfillmentStatus: 'CONFIRMED',
    items: [{ name: 'Synthetic QA product', sku: 'EH-SYN-0001', quantity: 1, unitPrice: '90.00', lineTotal: '90.00' }],
    subtotal: '90.00', shipping: '10.00', total: '100.00',
    delivery: { method: 'STANDARD', estimateStart: '2026-10-05', estimateEnd: '2026-10-07' },
    shipTo: { recipient: 'Synthetic QA', lines: ['42 Test Avenue', 'Testville, CA 90002', 'United States'] },
    payment: { evidence: 'VERIFIED', paidAt: '2026-10-01T10:00:05.000Z', amount: '100.00',
      receiptReference: 'RCP-7C9E6679-7425-40DE-944B-E07FC1F90AE7', cardBrand: 'Visa', cardLast4: '4242' },
    annotation: { cancelled: false, refundedAt: null, refundAmount: null },
  };
  const rendered = await renderDocument(snapshot, 'v1.container-smoke', loadFontAssets());
  if (!rendered.bytes.subarray(0, 5).equals(Buffer.from('%PDF-')) || !rendered.bytes.includes(Buffer.from('/FontFile2'))) {
    throw new Error('PDF header or embedded TrueType font missing');
  }
  const pdfjs = await import(pathToFileURL(appRequire.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href);
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(rendered.bytes), disableFontFace: true }).promise;
  if (pdf.numPages !== rendered.pageCount || pdf.numPages < 1) throw new Error('PDF parse or page count check failed');
  const page = await pdf.getPage(1);
  const content = await page.getTextContent();
  const text = content.items.map(item => ('str' in item ? item.str : '')).join(' ');
  if (!text.includes('Synthetic QA product') || !text.includes('100.00') || !text.includes('Not a tax invoice')) {
    throw new Error('Expected invoice content missing from parsed PDF');
  }
  console.log(`container-smoke PASS: ${rendered.bytes.length} bytes, ${pdf.numPages} page(s), embedded font, parsed invoice`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
