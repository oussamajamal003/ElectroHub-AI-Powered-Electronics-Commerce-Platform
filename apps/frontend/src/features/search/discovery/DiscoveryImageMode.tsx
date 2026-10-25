import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { AlertTriangle, Camera, ImageIcon, ImageOff, RefreshCw, Search, SearchX, Trash2, Upload, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import type { ProductSummary } from '@/features/products/types';
import { DiscoveryCamera } from './DiscoveryCamera';
import { DiscoveryState } from './DiscoveryState';
import { IMAGE_ACCEPT, MAX_IMAGE_LABEL, formatBytes, imageSearchEnabled, searchByImage, validateImageFile, type ImageSearchOutcome } from './imageSearch';
import styles from './Discovery.module.scss';

type Step = 'entry' | 'camera' | 'ready' | 'searching' | 'done';
interface Props {
  startCamera: boolean;
  backRef: MutableRefObject<(() => boolean) | null>;
  onNavigate: (href: string) => void;
  onSearchText: () => void;
}

const FILE_PROBLEMS = {
  type: 'That file isn’t a supported image. Use a JPEG, PNG or WebP photo.',
  size: `This photo is too large. Choose one under ${MAX_IMAGE_LABEL}.`,
  empty: 'That file is empty. Choose another photo.',
} as const;
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const STOCK = { IN_STOCK: ['In stock', 'in'], LOW_STOCK: ['Low stock', 'low'], OUT_OF_STOCK: ['Out of stock', 'out'] } as const;
const stockOf = (product: ProductSummary) => product.stockStatus ? STOCK[product.stockStatus]
  : product.availability === 'AVAILABLE' ? STOCK.IN_STOCK : STOCK.OUT_OF_STOCK;

export function DiscoveryImageMode({ startCamera, backRef, onNavigate, onSearchText }: Props) {
  const picker = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);
  const [step, setStep] = useState<Step>(startCamera ? 'camera' : 'entry');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [problem, setProblem] = useState('');
  const [dragging, setDragging] = useState(false);
  const [outcome, setOutcome] = useState<ImageSearchOutcome | null>(null);
  useEffect(() => {
    if (!file) { setPreview(null); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  useEffect(() => () => request.current?.abort(), []);
  const choose = useCallback((selected?: File | null) => {
    if (!selected) return;
    const invalid = validateImageFile(selected);
    if (invalid) { setProblem(FILE_PROBLEMS[invalid]); return; }
    request.current?.abort();
    setProblem(''); setOutcome(null); setFile(selected); setStep('ready');
    request.current = null;
  }, []);
  const remove = () => { request.current?.abort(); request.current = null; setFile(null); setOutcome(null); setProblem(''); setStep('entry'); };
  const search = async () => {
    if (!file || step === 'searching') return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setStep('searching'); setOutcome(null); setProblem('');
    const result = await searchByImage(file, controller.signal);
    if (request.current !== controller) return;
    request.current = null;
    if (result.status === 'cancelled') { setStep('ready'); return; }
    if (result.status === 'invalid') { setProblem(result.message); setStep('ready'); return; }
    setOutcome(result); setStep('done');
  };
  const cancel = () => { request.current?.abort(); request.current = null; setStep('ready'); };
  // Escape steps back out of nested views before it closes the console.
  useEffect(() => {
    backRef.current = () => {
      if (step === 'camera') { setStep(file ? 'ready' : 'entry'); return true; }
      if (step === 'searching') { cancel(); return true; }
      if (step === 'done') { setOutcome(null); setStep('ready'); return true; }
      return false;
    };
    return () => { backRef.current = null; };
  });
  // Paste an image from the clipboard while image mode is open.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (step === 'searching' || step === 'camera') return;
      const item = Array.from(event.clipboardData?.files ?? []).find(candidate => candidate.type.startsWith('image/'));
      if (item) { event.preventDefault(); choose(item); }
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [choose, step]);
  const openPicker = () => picker.current?.click();
  // One persistent region owns image request announcements; visual error panels do not announce a second time.
  const announcement = problem || (step === 'searching' ? 'Finding visually similar products…'
    : step === 'done' && outcome ? outcomeAnnouncement(outcome)
      : file ? 'Photo selected. Choose Search similar products to submit it.' : 'Choose, drop or paste a photo to search.');
  const fileInput = <input ref={picker} type="file" accept={IMAGE_ACCEPT} hidden aria-label="Choose a photo"
    onChange={event => { choose(event.target.files?.[0]); event.target.value = ''; }} />;

  if (step === 'camera') return <div className={styles.imageMode}>{fileInput}
    <DiscoveryCamera onCapture={captured => choose(captured)} onUpload={() => { setStep(file ? 'ready' : 'entry'); openPicker(); }}
      onCancel={() => setStep(file ? 'ready' : 'entry')} />
  </div>;

  return <div className={styles.imageMode}>
    <p role="status" aria-live="polite" aria-atomic="true" aria-label="Photo search status" className={styles.srOnly}>{announcement}</p>
    {fileInput}
    {!file ? <>
      <div className={`${styles.drop} ${dragging ? styles.dropDragging : ''}`}
        onDragOver={event => { event.preventDefault(); setDragging(true); }}
        onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
        onDrop={event => { event.preventDefault(); setDragging(false); choose(event.dataTransfer.files[0]); }}>
        <span className={`${styles.corner} ${styles.tl}`} aria-hidden="true" /><span className={`${styles.corner} ${styles.tr}`} aria-hidden="true" />
        <span className={`${styles.corner} ${styles.bl}`} aria-hidden="true" /><span className={`${styles.corner} ${styles.br}`} aria-hidden="true" />
        <span className={styles.dropGlyph} aria-hidden="true"><ImageIcon size={22} /></span>
        <div className={styles.dropCopy}>
          <h3 className={styles.dropTitle}>{dragging ? 'Release to use this photo' : 'Search with a photo'}</h3>
          <p className={styles.dropText}>{dragging ? 'Nothing is uploaded until you choose Search.' : `Drop, paste or choose a JPEG, PNG or WebP image up to ${MAX_IMAGE_LABEL}.`}</p>
        </div>
        <div className={styles.dropActions}>
          <Button type="button" variant="outline" size="small" onClick={() => setStep('camera')}><Camera size={16} aria-hidden="true" />Camera</Button>
          <Button type="button" size="small" onClick={openPicker}><Upload size={16} aria-hidden="true" />Upload</Button>
        </div>
      </div>
      {problem && <p className={styles.fieldError}><AlertTriangle size={16} aria-hidden="true" />{problem}</p>}
      <p className={styles.privacyNote}>{imageSearchEnabled() ? 'Your photo is used only for this search and isn’t saved to your account.'
        : 'Visual matching isn’t switched on yet. You can preview a photo, but nothing is uploaded.'}</p>
    </> : <>
      <div className={`${styles.preview} ${step === 'done' ? styles.previewCompact : ''}`} aria-busy={step === 'searching' || undefined}>
        <div className={styles.photo}>
          {preview && <img src={preview} alt="Selected photo" onError={() => { setFile(null); setStep('entry'); setProblem('This photo couldn’t be opened. It may be damaged — try another image.'); }} />}
          {step === 'searching' && <span className={styles.scanLine} aria-hidden="true" />}
        </div>
        <div className={styles.previewBody}>
          <p className={styles.fileName} title={file.name}>{file.name}</p>
          <p className={styles.fileMeta}>{formatBytes(file.size)} · {file.type.replace('image/', '').toUpperCase()}</p>
          {step === 'searching' ? <>
            <p className={styles.processing}><span className={styles.spinner} aria-hidden="true" />Finding visually similar products…</p>
            <div className={styles.previewActions}><Button type="button" size="small" variant="outline" onClick={cancel}>Cancel</Button></div>
          </> : <div className={styles.previewActions}>
            <Button type="button" onClick={() => void search()}><Search size={16} aria-hidden="true" />{outcome ? 'Search again' : 'Search similar products'}</Button>
            <Button type="button" size="small" variant="outline" onClick={openPicker}><RefreshCw size={16} aria-hidden="true" />Replace</Button>
            <Button type="button" size="small" variant="ghost" onClick={remove}><Trash2 size={16} aria-hidden="true" />Remove</Button>
          </div>}
          {problem && <p className={styles.fieldError}><AlertTriangle size={16} aria-hidden="true" />{problem}</p>}
        </div>
      </div>
      {step === 'done' && outcome && <Outcome outcome={outcome} onNavigate={onNavigate} onRetry={() => void search()} onSearchText={onSearchText} onReplace={openPicker} />}
    </>}
  </div>;
}

function outcomeAnnouncement(outcome: ImageSearchOutcome): string {
  switch (outcome.status) {
    case 'success': return outcome.items.length ? `${outcome.items.length} visually similar ${outcome.items.length === 1 ? 'product found' : 'products found'}. Results are ordered by visual relevance.` : 'No similar products found. Try another photo or search by text.';
    case 'unavailable': return imageSearchEnabled() ? 'Image search is unavailable right now. Search by text or browse products.' : 'Image search isn’t available yet. Your photo was not sent.';
    case 'timeout': return 'The search took too long. Try again or search by text.';
    case 'network': return 'You appear to be offline. Check your connection and try again.';
    case 'invalid': return outcome.message;
    case 'cancelled': return 'Photo search cancelled.';
    case 'error': return 'Image search ran into a problem. Try again or search by text.';
  }
}

function Outcome({ outcome, onNavigate, onRetry, onSearchText, onReplace }: {
  outcome: ImageSearchOutcome; onNavigate: (href: string) => void; onRetry: () => void; onSearchText: () => void; onReplace: () => void;
}) {
  if (outcome.status === 'success' && outcome.items.length) return <section className={styles.visualResults} aria-label="Visually similar products">
    <div className={styles.resultsHead}>
      <span className={styles.visualChip}><ImageIcon size={14} aria-hidden="true" />Visual search</span>
      <span className={styles.meta}>{outcome.items.length} {outcome.items.length === 1 ? 'product' : 'products'} · ordered by visual relevance</span>
    </div>
    <p className={styles.meta}>These products look similar to your photo. Colour and storage versions can look identical, so check the details before you buy.</p>
    <ol className={styles.resultGrid}>
      {outcome.items.map((product, index) => {
        const href = `/products/${encodeURIComponent(product.slug)}`;
        const [stockLabel, stockTone] = stockOf(product);
        return <li key={product.id}>
          <a className={styles.resultCard} href={href} onClick={event => { if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return; event.preventDefault(); onNavigate(href); }}>
            <span className={styles.resultImage}>
              <span className={styles.rank} aria-label={`Match ${index + 1}`}>#{index + 1}</span>
              {product.primaryImage ? <img src={product.primaryImage.url} alt="" loading="lazy" /> : <ImageOff size={24} aria-hidden="true" />}
            </span>
            <span className={styles.resultBody}>
              <span className={styles.resultTitle}>{product.name}</span>
              <span className={styles.resultRow}>
                <span className={styles.price}>{money.format(Number(product.price))}</span>
                <span className={`${styles.stock} ${styles[`stock-${stockTone}`] ?? ''}`}>{stockLabel}</span>
              </span>
            </span>
          </a>
        </li>;
      })}
    </ol>
  </section>;
  if (outcome.status === 'success') return <DiscoveryState icon={<SearchX size={20} />} title="No similar products found"
    description="Nothing in the catalog looks close enough to this photo. Try a clearer shot, or search by name."
    action={<><Button type="button" size="small" variant="outline" onClick={onReplace}>Try another photo</Button><Button type="button" size="small" variant="ghost" onClick={onSearchText}>Search by text</Button></>} />;
  // Disabled deployment: nothing was uploaded. Enabled but offline: the photo reached our server and was discarded unsaved.
  if (outcome.status === 'unavailable') return <DiscoveryState tone="visual" icon={<Camera size={20} />}
    title={imageSearchEnabled() ? 'Image search is unavailable right now' : 'Image search isn’t available yet'}
    description={imageSearchEnabled()
      ? 'Visual matching is offline at the moment, so we couldn’t compare your photo. It wasn’t saved. Text search and the full catalog still work.'
      : 'Visual matching isn’t switched on yet, so your photo wasn’t sent anywhere. Text search and the full catalog still work.'}
    action={<><Button type="button" size="small" onClick={onSearchText}>Search by text</Button><Button type="button" size="small" variant="outline" onClick={() => onNavigate('/products')}>Browse products</Button></>} />;
  if (outcome.status === 'network') return <DiscoveryState announce={false} tone="error" icon={<WifiOff size={20} />} title="You appear to be offline"
    description="Check your connection, then try the search again." action={<Button type="button" size="small" onClick={onRetry}>Try again</Button>} />;
  if (outcome.status === 'timeout') return <DiscoveryState announce={false} tone="error" icon={<AlertTriangle size={20} />} title="The search took too long"
    description="Image search didn’t answer in time. Try again in a moment, or search by name." action={<><Button type="button" size="small" onClick={onRetry}>Try again</Button><Button type="button" size="small" variant="ghost" onClick={onSearchText}>Search by text</Button></>} />;
  return <DiscoveryState announce={false} tone="error" icon={<AlertTriangle size={20} />} title="Image search ran into a problem"
    description="We couldn’t finish this search. Try again, or search by name instead." action={<><Button type="button" size="small" onClick={onRetry}>Try again</Button><Button type="button" size="small" variant="ghost" onClick={onSearchText}>Search by text</Button></>} />;
}
