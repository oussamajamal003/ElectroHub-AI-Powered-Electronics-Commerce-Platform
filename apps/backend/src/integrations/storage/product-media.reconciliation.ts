import type { ProductMediaStorageEntry } from './product-media.storage.js';

export interface ProductMediaReconciliationInput {
  objects: readonly ProductMediaStorageEntry[];
  currentReferences: readonly string[];
  retiredReferences: readonly string[];
  historicalOrderImageUrls: readonly string[];
  supabaseUrl: URL;
  bucket: string;
}

export interface ProductMediaReconciliationReport {
  listedFiles: number;
  listedFolders: number;
  missingCurrentReferences: string[];
  missingRetainedReferences: string[];
  retainedObjects: Array<{ path: string; reasons: Array<'RETIRED' | 'HISTORICAL_ORDER'> }>;
  orphanCandidates: string[];
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const PRODUCT_MEDIA_PATH = new RegExp(`^products/${UUID}/${UUID}/${UUID}/original\\.webp$`, 'i');

/** Accepts only exact public object URLs from the configured project/bucket; it never trusts arbitrary URL input. */
export function storagePathFromPublicUrl(value: string, supabaseUrl: URL, bucket: string): string | null {
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.origin !== supabaseUrl.origin || url.username || url.password || url.search || url.hash) return null;
  const encodedPrefix = `/storage/v1/object/public/${encodeURIComponent(bucket)}/`;
  if (!url.pathname.startsWith(encodedPrefix)) return null;
  const encodedPath = url.pathname.slice(encodedPrefix.length);
  try {
    const decoded = encodedPath.split('/').map(part => decodeURIComponent(part));
    if (decoded.some(part => !part || part === '.' || part === '..' || part.includes('/') || part.includes('\\'))) return null;
    const path = decoded.join('/');
    return PRODUCT_MEDIA_PATH.test(path) ? path : null;
  } catch {
    return null;
  }
}

/** Produces evidence only. Candidates are not safe to delete without an authoritative full reference inventory. */
export function reconcileProductMedia(input: ProductMediaReconciliationInput): ProductMediaReconciliationReport {
  const files = new Set(input.objects.filter(object => object.kind === 'file').map(object => object.path));
  const folders = input.objects.filter(object => object.kind === 'folder').length;
  const current = new Set(input.currentReferences.filter(path => PRODUCT_MEDIA_PATH.test(path)));
  const retired = new Set(input.retiredReferences.filter(path => PRODUCT_MEDIA_PATH.test(path)));
  const historical = new Set(input.historicalOrderImageUrls
    .map(url => storagePathFromPublicUrl(url, input.supabaseUrl, input.bucket))
    .filter((path): path is string => path !== null));

  const allReferences = new Set([...current, ...retired, ...historical]);
  const missingCurrentReferences = [...current].filter(path => !files.has(path)).sort();
  const missingRetainedReferences = [...new Set([...retired, ...historical])].filter(path => !files.has(path)).sort();
  const retainedObjects = [...files]
    .filter(path => retired.has(path) || historical.has(path))
    .sort()
    .map(path => ({ path, reasons: [
      ...(retired.has(path) ? ['RETIRED' as const] : []),
      ...(historical.has(path) ? ['HISTORICAL_ORDER' as const] : []),
    ] }));
  const orphanCandidates = [...files].filter(path => !allReferences.has(path)).sort();
  return {
    listedFiles: files.size,
    listedFolders: folders,
    missingCurrentReferences,
    missingRetainedReferences,
    retainedObjects,
    orphanCandidates,
  };
}

/** Follows only the fixed products/UUID hierarchy, with both page and total-entry ceilings. */
export async function listProductMediaTreeBounded(
  listPage: (prefix: string, limit: number, offset?: number) => Promise<ProductMediaStorageEntry[]>,
  options: { pageSize?: number; maxEntries?: number } = {},
): Promise<ProductMediaStorageEntry[]> {
  const pageSize = options.pageSize ?? 500;
  const maxEntries = options.maxEntries ?? 50_000;
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 1000 || !Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 100_000) {
    throw new RangeError('Storage listing bounds are invalid.');
  }

  const entries: ProductMediaStorageEntry[] = [];
  const pending = ['products'];
  const visited = new Set<string>();
  while (pending.length) {
    const prefix = pending.pop()!;
    if (visited.has(prefix)) continue;
    visited.add(prefix);
    let offset = 0;
    while (true) {
      const page = await listPage(prefix, pageSize, offset);
      if (entries.length + page.length > maxEntries) throw new RangeError('Storage listing exceeded its configured entry limit.');
      entries.push(...page);
      for (const entry of page) {
        if (entry.kind === 'folder') {
          const depth = entry.path.split('/').length - 1;
          if (depth <= 3) pending.push(entry.path);
        }
      }
      if (page.length < pageSize) break;
      offset += page.length;
    }
  }
  return entries;
}
