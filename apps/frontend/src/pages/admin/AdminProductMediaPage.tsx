import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ImagePlus, RefreshCw, Star, Trash2, Upload } from 'lucide-react';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { ElectroHubLoader } from '@/components/ui/ElectroHubLoader/ElectroHubLoader';
import { Input } from '@/components/ui/Input';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/Dialog';
import { ProductImage } from '@/components/ui/ProductImage';
import { useAdminMediaProduct, useAdminProductImages, useMediaMutations } from '@/features/adminMedia/queries';
import { newIdempotencyKey, type MediaImage } from '@/features/adminMedia/types';
import { formatBytes } from '@/features/search/discovery/imageSearch';
import styles from './AdminProductMediaPage.module.scss';

const ACCEPTED = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_FILE_BYTES = 6 * 1024 * 1024;
const MAX_PRODUCT_IMAGES = 8;
const indexLabels: Record<MediaImage['indexing']['state'], string> = {
  LEGACY: 'Index status unavailable', PENDING: 'AI indexing pending', PROCESSING: 'AI indexing in progress',
  INDEXED: 'Indexed for image search', RETRY_WAIT: 'AI indexing will retry', FAILED: 'AI indexing failed',
};

function apiMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function AdminProductMediaPage() {
  const { productId = '' } = useParams();
  const productQuery = useAdminMediaProduct(productId);
  const product = productQuery.data?.data;
  const imagesQuery = useAdminProductImages(productId);
  const mutations = useMediaMutations(productId);
  const picker = useRef<HTMLInputElement>(null);
  const replacePicker = useRef<HTMLInputElement>(null);
  const previousProductId = useRef(productId);
  const routeGeneration = useRef(0);
  const uploadRun = useRef(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const removeButtonsRef = useRef(new Map<string, HTMLButtonElement>());
  const lastDeleteTargetId = useRef<string | null>(null);
  const [replaceTarget, setReplaceTarget] = useState<MediaImage | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MediaImage | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [busyImageIds, setBusyImageIds] = useState<Set<string>>(() => new Set());
  const [altTextValues, setAltTextValues] = useState<Record<string, string>>({});
  const editingAltImageId = useRef<string | null>(null);
  const busyImageIdsRef = useRef(busyImageIds);
  busyImageIdsRef.current = busyImageIds;
  const [pendingUploads, setPendingUploads] = useState<Array<{ file: File; url: string; idempotencyKey: string; replaceTarget?: MediaImage }>>([]);
  const pendingUploadsRef = useRef(pendingUploads);
  pendingUploadsRef.current = pendingUploads;
  useEffect(() => () => { pendingUploadsRef.current.forEach(item => URL.revokeObjectURL(item.url)); }, []);
  useEffect(() => {
    if (previousProductId.current === productId) return;
    previousProductId.current = productId;
    routeGeneration.current += 1;
    pendingUploadsRef.current.forEach(item => URL.revokeObjectURL(item.url));
    uploadRun.current += 1;
    setPendingUploads([]);
    setUploading(false);
    setUploadProgress('');
    setReplaceTarget(null);
    setDeleteTarget(null);
    lastDeleteTargetId.current = null;
    busyImageIdsRef.current = new Set();
    setBusyImageIds(new Set());
    setNotice(null);
  }, [productId]);
  const images = useMemo(() => imagesQuery.data?.data ?? [], [imagesQuery.data?.data]);
  useEffect(() => {
    setAltTextValues(current => {
      let changed = false;
      const next = { ...current };
      for (const image of images) {
        if (editingAltImageId.current === image.id) continue;
        const value = image.altText ?? '';
        if (next[image.id] !== value) { next[image.id] = value; changed = true; }
      }
      return changed ? next : current;
    });
  }, [images]);
  const remainingSlots = Math.max(0, MAX_PRODUCT_IMAGES - images.length);
  const canAddPhotos = remainingSlots > 0;

  async function withImagesBusy(imageIds: string[], action: () => Promise<void>) {
    if (imageIds.some(imageId => busyImageIdsRef.current.has(imageId))) return;
    const generation = routeGeneration.current;
    const next = new Set(busyImageIdsRef.current); imageIds.forEach(imageId => next.add(imageId));
    busyImageIdsRef.current = next; setBusyImageIds(next);
    try { await action(); }
    finally {
      if (routeGeneration.current === generation) {
        const cleared = new Set(busyImageIdsRef.current); imageIds.forEach(imageId => cleared.delete(imageId));
        busyImageIdsRef.current = cleared; setBusyImageIds(cleared);
      }
    }
  }
  const withImageBusy = (imageId: string, action: () => Promise<void>) => withImagesBusy([imageId], action);

  function stageFiles(files: FileList | File[], replacement?: MediaImage) {
    const selected = [...files];
    if (!selected.length) return;
    if (!replacement && selected.length > remainingSlots) {
      setNotice({ type: 'error', text: `You can add ${remainingSlots} more ${remainingSlots === 1 ? 'photo' : 'photos'} to this product. Replacing an existing photo remains available.` });
      return;
    }
    const invalid = selected.filter(file => !ACCEPTED.has(file.type) || file.size > MAX_FILE_BYTES || file.size === 0);
    if (invalid.length) {
      setNotice({ type: 'error', text: 'Choose non-empty JPEG, PNG or WebP images up to 6 MiB each. The server performs the final validation.' });
      return;
    }
    setNotice(null);
    pendingUploads.forEach(item => URL.revokeObjectURL(item.url));
    setPendingUploads(selected.map((file, index) => ({ file, url: URL.createObjectURL(file), idempotencyKey: newIdempotencyKey(), ...(replacement && index === 0 ? { replaceTarget: replacement } : {}) })));
  }
  function cancelStagedUploads() {
    pendingUploads.forEach(item => URL.revokeObjectURL(item.url));
    setPendingUploads([]);
  }
  async function uploadStaged() {
    if (!pendingUploads.length) return;
    const run = ++uploadRun.current;
    const staged = [...pendingUploads];
    setUploading(true); setNotice(null);
    let succeeded = 0; let failed = 0;
    for (let index = 0; index < staged.length; index += 1) {
      const item = staged[index]!;
      setUploadProgress(`Uploading ${index + 1} of ${staged.length}: ${item.file.name}`);
      try {
        if (item.replaceTarget) await mutations.replace.mutateAsync({ image: item.replaceTarget, file: item.file, altText: item.replaceTarget.altText ?? '', idempotencyKey: item.idempotencyKey });
        else await mutations.upload.mutateAsync({ file: item.file, idempotencyKey: item.idempotencyKey });
        if (uploadRun.current !== run) return;
        succeeded += 1;
        URL.revokeObjectURL(item.url);
        setPendingUploads(current => current.filter(candidate => candidate !== item));
      } catch (error) {
        if (uploadRun.current !== run) return;
        failed += 1;
        setNotice({ type: 'error', text: `${item.file.name} could not be uploaded: ${apiMessage(error, 'Please try again.')}` });
        if (item.replaceTarget) break;
      }
    }
    if (uploadRun.current !== run) return;
    setUploadProgress(''); setUploading(false);
    if (failed === 0) setNotice({ type: 'success', text: staged.some(item => item.replaceTarget) ? 'Photo replaced. AI indexing status updates separately.' : `${succeeded} ${succeeded === 1 ? 'photo' : 'photos'} published. AI indexing status updates separately.` });
    else if (succeeded) setNotice(current => ({ type: 'error', text: `${succeeded} uploaded; ${failed} failed. Successful uploads are saved. ${current?.text ?? ''}` }));
  }

  async function saveAltText(image: MediaImage, value: string) {
    if (value === (image.altText ?? '')) return;
    const generation = routeGeneration.current;
    await withImageBusy(image.id, async () => {
      try { await mutations.patch.mutateAsync({ image, changes: { altText: value } }); }
      catch (error) {
        if (routeGeneration.current !== generation) return;
        setNotice({ type: 'error', text: `Alt text could not be saved: ${apiMessage(error, 'Try again.')}` });
        void imagesQuery.refetch();
      }
    });
  }
  async function move(image: MediaImage, delta: -1 | 1) {
    const generation = routeGeneration.current;
    const index = images.findIndex(item => item.id === image.id);
    const target = index + delta;
    if (target < 0 || target >= images.length) return;
    await withImagesBusy([image.id, images[target]!.id], async () => {
      try {
        await mutations.patch.mutateAsync({ image, changes: { sortOrder: target } });
      } catch (error) { if (routeGeneration.current === generation) setNotice({ type: 'error', text: `Photo order could not be saved: ${apiMessage(error, 'Try again.')}` }); }
    });
  }
  async function setPrimary(image: MediaImage) {
    const generation = routeGeneration.current;
    await withImageBusy(image.id, async () => {
      try { await mutations.patch.mutateAsync({ image, changes: { isPrimary: true } }); }
      catch (error) { if (routeGeneration.current === generation) setNotice({ type: 'error', text: `Primary photo could not be changed: ${apiMessage(error, 'Try again.')}` }); }
    });
  }

  return <section className={styles.page}>
    <Link to="/admin/products" className={styles.back}><ArrowLeft size={17} aria-hidden="true" /> All products</Link>
    <header className={styles.header}>
      <div><p className={styles.eyebrow}>PRODUCT MEDIA</p><h1 ref={headingRef} tabIndex={-1}>{product?.name ?? 'Manage product photos'}</h1><p>Published photos appear on the storefront. Image search indexing runs separately.</p></div>
      <Button onClick={() => picker.current?.click()} disabled={uploading || !canAddPhotos || imagesQuery.isPending || imagesQuery.isError}><ImagePlus size={18} aria-hidden="true" /> Add photos</Button>
      <input ref={picker} className={styles.hiddenInput} type="file" accept="image/jpeg,image/png,image/webp" multiple aria-label="Choose product photos" onChange={event => { if (event.target.files) stageFiles(event.target.files); event.target.value = ''; }} />
    </header>
    {notice && <Alert variant={notice.type === 'success' ? 'success' : 'error'} onDismiss={() => setNotice(null)}>{notice.text}</Alert>}
    {pendingUploads.length > 0 && <section className={styles.staging} aria-label="Selected photo previews">
      <div className={styles.stagingHeader}><div><h2>{pendingUploads.some(item => item.replaceTarget) ? 'Review replacement' : 'Review photos'}</h2><p>Preview the selected photo{pendingUploads.length === 1 ? '' : 's'} before sending to the server.</p></div>
        <div className={styles.dialogActions}><Button variant="outline" onClick={cancelStagedUploads} disabled={uploading}>Cancel</Button><Button onClick={() => void uploadStaged()} disabled={uploading}><Upload size={16} />{uploading ? uploadProgress : `Upload ${pendingUploads.length} ${pendingUploads.length === 1 ? 'photo' : 'photos'}`}</Button></div></div>
      <div className={styles.stagingGrid}>{pendingUploads.map(item => <div key={`${item.file.name}-${item.url}`} className={styles.stagedPhoto}>
        {item.replaceTarget && <div className={styles.beforeAfter}><div><ProductImage src={item.replaceTarget.url} alt="Current photo" /><span>Current</span></div><ArrowRight aria-hidden="true" /><div><img src={item.url} alt={`Replacement preview for ${item.file.name}`} /><span>Replacement preview</span></div></div>}
        {!item.replaceTarget && <img src={item.url} alt={`Preview of ${item.file.name}`} />}
        <span className={styles.fileName}>{item.file.name}</span><small>{formatBytes(item.file.size)}</small>
      </div>)}</div>
    </section>}
    {productQuery.isError && <Alert variant="error">This product could not be found. Return to the catalog and select it again.</Alert>}
    {imagesQuery.isError && <Alert variant="error">Product photos could not be loaded. <Button variant="link" onClick={() => void imagesQuery.refetch()}>Try again</Button></Alert>}
    {imagesQuery.isPending && images.length === 0 ? <div className={styles.loading}><ElectroHubLoader /></div> : <>
      {!images.length && !imagesQuery.isError && <div className={styles.empty}>
        <span><ImagePlus size={25} aria-hidden="true" /></span><h2>No product photos yet</h2><p>Add a JPEG, PNG or WebP image to publish the first product photo.</p><Button variant="outline" onClick={() => picker.current?.click()} disabled={!canAddPhotos}><Upload size={17} /> Choose photos</Button>
      </div>}
      <div className={`${styles.dropZone} ${dragging ? styles.dropActive : ''} ${!canAddPhotos ? styles.dropDisabled : ''}`} onDragOver={event => { event.preventDefault(); if (canAddPhotos && !uploading) setDragging(true); }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }} onDrop={event => { event.preventDefault(); setDragging(false); if (canAddPhotos && !uploading) stageFiles(event.dataTransfer.files); }}>
        <Upload size={19} aria-hidden="true" /><span>{canAddPhotos ? <>Drop photos here or <button type="button" onClick={() => picker.current?.click()}>browse files</button></> : 'Photo limit reached. Replace an existing photo to update the gallery.'}</span><small>{canAddPhotos ? `JPEG, PNG or WebP · up to 6 MiB per photo · ${remainingSlots} slot${remainingSlots === 1 ? '' : 's'} remaining` : 'Maximum 8 photos per product'}</small>
      </div>
      {images.length > 0 && <><p className={styles.imageCount}>{images.length} {images.length === 1 ? 'photo' : 'photos'} · Use arrow buttons to set gallery order</p>
      <ul className={styles.grid} aria-label="Published product photos">{images.map((image, index) => {
        const busy = busyImageIds.has(image.id);
        return <li className={styles.card} key={image.id}>
        <div className={styles.preview}><ProductImage src={image.url} alt={image.altText?.trim() || product?.name || 'Product image'} loading="lazy" width={image.width ?? undefined} height={image.height ?? undefined} /><div className={styles.badges}><span className={styles.published}>Published</span>{image.isPrimary && <span className={styles.primary}>Primary</span>}</div></div>
        <div className={styles.cardBody}><p className={styles.indexState} data-state={image.indexing.state} role="status" aria-live="polite"><span aria-hidden="true" className={styles.stateDot} />{indexLabels[image.indexing.state]}</p>{image.indexing.errorCode && <p className={styles.errorCode}>Reference: {image.indexing.errorCode}</p>}
          {busy && <p className={styles.busyStatus} role="status">Saving photo changes…</p>}
          <Input label="Alt text" value={altTextValues[image.id] ?? image.altText ?? ''} placeholder="Describe this product photo" maxLength={255} disabled={busy || uploading}
            onFocus={() => { editingAltImageId.current = image.id; }}
            onChange={event => { const value = event.currentTarget.value; setAltTextValues(current => ({ ...current, [image.id]: value })); }}
            onBlur={event => { if (editingAltImageId.current === image.id) editingAltImageId.current = null; void saveAltText(image, event.currentTarget.value); }} fullWidth />
          <div className={styles.actions}>
            <Button variant="outline" size="small" aria-label={`Move photo ${index + 1} up`} disabled={index === 0 || uploading || busy} onClick={() => void move(image, -1)}><ArrowUp size={16} /> Up</Button>
            <Button variant="outline" size="small" aria-label={`Move photo ${index + 1} down`} disabled={index === images.length - 1 || uploading || busy} onClick={() => void move(image, 1)}><ArrowDown size={16} /> Down</Button>
            {!image.isPrimary && <Button variant="ghost" size="small" onClick={() => void setPrimary(image)} disabled={uploading || busy}><Star size={15} /> Set primary</Button>}
          </div>
          <div className={styles.actions}><Button variant="outline" size="small" onClick={() => { setReplaceTarget(image); replacePicker.current?.click(); }} disabled={uploading || busy}><RefreshCw size={15} /> Replace</Button>
            {image.indexing.state === 'FAILED' && <Button variant="outline" size="small" onClick={() => { const generation = routeGeneration.current; void withImageBusy(image.id, async () => { try { await mutations.retry.mutateAsync(image); } catch (error) { if (routeGeneration.current === generation) setNotice({ type: 'error', text: apiMessage(error, 'Index retry failed.') }); } }); }} disabled={busy || uploading}><RefreshCw size={15} /> Retry index</Button>}
            <Button ref={element => { if (element) removeButtonsRef.current.set(image.id, element); else removeButtonsRef.current.delete(image.id); }} variant="ghost" size="small" onClick={() => { lastDeleteTargetId.current = image.id; setDeleteTarget(image); }} disabled={uploading || busy}><Trash2 size={15} /> Remove</Button>
          </div>
        </div>
      </li>;})}</ul></>}
    </>}
    <input ref={replacePicker} className={styles.hiddenInput} type="file" accept="image/jpeg,image/png,image/webp" aria-label="Choose replacement photo" onChange={event => { if (event.target.files?.[0] && replaceTarget) stageFiles([event.target.files[0]], replaceTarget); event.target.value = ''; setReplaceTarget(null); }} />
    <Dialog open={Boolean(deleteTarget)} onOpenChange={open => { if (!open) setDeleteTarget(null); }}>
      <DialogContent onCloseAutoFocus={event => {
        const imageId = lastDeleteTargetId.current;
        if (!imageId) return;
        event.preventDefault();
        requestAnimationFrame(() => {
          const removeButton = removeButtonsRef.current.get(imageId);
          if (removeButton?.isConnected) removeButton.focus(); else headingRef.current?.focus();
        });
        lastDeleteTargetId.current = null;
      }}><DialogTitle>Remove this photo?</DialogTitle><DialogDescription>The photo will stop appearing on the storefront. Historical order photos are preserved.</DialogDescription>
        <div className={styles.dialogActions}><Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={Boolean(deleteTarget && busyImageIds.has(deleteTarget.id))}>Cancel</Button><Button variant="destructive" isLoading={Boolean(deleteTarget && busyImageIds.has(deleteTarget.id))} onClick={() => { if (!deleteTarget) return; const target = deleteTarget; const generation = routeGeneration.current; void withImageBusy(target.id, async () => { try { await mutations.remove.mutateAsync(target); if (routeGeneration.current !== generation) return; setDeleteTarget(null); setNotice({ type: 'success', text: 'Photo removed from the storefront.' }); } catch (error) { if (routeGeneration.current === generation) setNotice({ type: 'error', text: `Photo could not be removed: ${apiMessage(error, 'Try again.')}` }); } }); }}>Remove photo</Button></div>
      </DialogContent>
    </Dialog>
  </section>;
}
