import { Tooltip } from '@/components/ui/Tooltip';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BarChart3, Eye, SlidersHorizontal, Star, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { SearchSelect } from '@/components/ui/SearchSelect';
import { Select } from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/Skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Tabs';
import {
  ConfirmDialog, EmptyRows, KpiCard, PageHeader, QueryProblem, StatusPill, TableCard, useAdminToast, type Tone,
} from '@/features/admin/shared/AdminUi';
import { errorCode, errorMessage } from '@/features/admin/shared/api';
import { formatCount, formatDateTime, formatMoney } from '@/features/admin/shared/format';
import {
  useFeaturedPins, useRecommendationConfigurations, useRecommendationMutations, useRecommendationOverview, useRecommendationPreview,
  type FeaturedPin, type PinState, type RecommendationPeriod, type RecommendationSectionMode, type RecommendationSurfaceKey, type SectionConfig,
} from '@/features/admin/recommendations/api';
import { railCopy } from '@/features/recommendations/labels';
import { useAdminProducts } from '@/features/admin/products/api';
import { seriesColor } from '@/features/admin/shared/chartColors';
import styles from './AdminRecommendationsPage.module.scss';

const TABS = ['overview', 'strategies', 'featured', 'preview'] as const;
type Tab = (typeof TABS)[number];
const PERIODS: RecommendationPeriod[] = ['7d', '30d', '90d'];
const SURFACE_LABEL: Record<RecommendationSurfaceKey, string> = { home: 'Home', product_detail: 'Product page', cart: 'Cart' };
const MODE_LABEL: Record<RecommendationSectionMode, string> = {
  POPULAR_PRODUCTS: 'Popular products', RECOMMENDED_FOR_YOU: 'Recommended for you', SIMILAR_PRODUCTS: 'Similar products',
  YOU_MAY_ALSO_LIKE: 'You may also like', FREQUENTLY_BOUGHT_TOGETHER: 'Frequently bought together',
};
const STATE_TONE: Record<PinState, Tone> = { ACTIVE: 'success', SCHEDULED: 'info', EXPIRED: 'neutral', PAUSED: 'warning', INELIGIBLE: 'error' };
const STATE_LABEL: Record<PinState, string> = { ACTIVE: 'Active', SCHEDULED: 'Scheduled', EXPIRED: 'Ended', PAUSED: 'Paused', INELIGIBLE: 'Not eligible' };
const CRUMBS = [{ label: 'Dashboard', to: '/admin' }, { label: 'Recommendations' }];
const percent = (value: number | null) => value === null ? 'No data yet' : `${(value * 100).toFixed(1)}%`;
const toIso = (value: string) => value ? new Date(value).toISOString() : null;
const toDateTimeLocal = (value: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const STALE_MESSAGE = 'This changed since you loaded it. Reload to see the latest version, then try again.';

function LoadingFrame({ label, children }: { label: string; children: ReactNode }) {
  return <div className={styles.loadingFrame} role="status" aria-label={`Loading ${label}`} aria-busy="true">{children}</div>;
}

function OverviewSkeleton() {
  return <LoadingFrame label="recommendation performance"><div className={styles.kpis}>
    {Array.from({ length: 4 }, (_, index) => <div className={styles.kpiPlaceholder} key={index}><Skeleton width="42%" height={13} /><Skeleton width="58%" height={27} /><Skeleton width="70%" height={12} /></div>)}
  </div><div className={styles.chartSkeleton}><Skeleton width="38%" height={18} />{Array.from({ length: 4 }, (_, index) => <div className={styles.breakdownPlaceholder} key={index}><Skeleton width="18%" height={14} /><Skeleton width="24%" height={14} /><Skeleton width="100%" height={8} /></div>)}</div></LoadingFrame>;
}

function StrategiesSkeleton() {
  return <LoadingFrame label="strategy settings"><div className={styles.strategySkeletonList}>{[0, 1, 2].map(item => <div className={styles.strategyPlaceholder} key={item}><Skeleton width="30%" height={16} /><Skeleton width="48%" height={12} /><div className={styles.strategyPlaceholderControls}><Skeleton width={42} height={24} /><Skeleton width="22%" height={40} /><Skeleton width={104} height={40} /></div></div>)}</div></LoadingFrame>;
}

function FeaturedSkeleton() {
  return <LoadingFrame label="featured products"><div className={styles.featuredSkeleton}>{[0, 1, 2].map(item => <div className={styles.featuredPlaceholder} key={item}><Skeleton width={42} height={42} /><div><Skeleton width="52%" height={15} /><Skeleton width="30%" height={12} /></div><Skeleton width="24%" height={14} /><Skeleton width="20%" height={26} /></div>)}</div></LoadingFrame>;
}

function PreviewSkeleton() {
  return <LoadingFrame label="recommendation preview"><div className={styles.previewSkeleton}><Skeleton width="32%" height={18} /><Skeleton width="55%" height={13} /><div className={styles.previewSkeletonCards}>{[0, 1, 2, 3].map(item => <div className={styles.previewSkeletonCard} key={item}><Skeleton width="100%" height={112} /><Skeleton width="76%" height={14} /><Skeleton width="34%" height={13} /></div>)}</div></div></LoadingFrame>;
}

function staleOrMessage(error: unknown, fallback: string) {
  return errorCode(error) === 'VERSION_CONFLICT' ? STALE_MESSAGE : errorMessage(error, fallback);
}

function OverviewPanel() {
  const [period, setPeriod] = useState<RecommendationPeriod>('30d');
  const overview = useRecommendationOverview(period);
  const data = overview.data;
  return <section aria-labelledby="overview-heading" className={styles.panel}>
    <div className={styles.toolbar}>
      <h2 id="overview-heading" className={styles.sectionTitle}>Performance</h2>
      <Select label="Period" value={period} onValueChange={value => setPeriod(value as RecommendationPeriod)}
        options={PERIODS.map(value => ({ value, label: `Last ${value.replace('d', ' days')}` }))} />
    </div>
    {overview.isError && !data && <QueryProblem error={overview.error} hasData={false} onRetry={() => void overview.refetch()} what="recommendation performance" />}
    {overview.isPending && !data && <OverviewSkeleton />}
    {data && <>
      <div className={styles.kpis}>
        <KpiCard label="Impressions" value={formatCount(data.totals.impressions)} hint="Shown to shoppers" />
        <KpiCard label="Clicks" value={formatCount(data.totals.clicks)} hint="Opened from a recommendation" />
        <KpiCard label="Click-through" value={percent(data.totals.ctr)} hint="Clicks ÷ impressions" />
        <KpiCard label="Fallback share" value={percent(data.totals.fallbackShare)} tone={data.totals.fallbackShare !== null && data.totals.fallbackShare > 0.5 ? 'warning' : 'neutral'}
          hint="Results without measured demand" />
      </div>
      <TableCard label="Performance by strategy">
        <div className={styles.tableScroll} role="region" aria-label="Scrollable table" tabIndex={0}><table className={styles.table}>
          <caption className={styles.visuallyHidden}>Impressions and clicks per surface, section and strategy</caption>
          <thead><tr><th scope="col">Surface</th><th scope="col">Section</th><th scope="col">Strategy</th><th scope="col">Impressions</th><th scope="col">Clicks</th><th scope="col">Click-through</th></tr></thead>
          <tbody>
            {data.breakdown.length === 0 && <tr><td colSpan={6}><EmptyRows title="No recommendations were shown in this period" hint="Results appear here once shoppers see a rail." /></td></tr>}
            {data.breakdown.map((row, index) => <tr key={`${row.surface}-${row.mode}-${row.strategy}`}>
              <td>{SURFACE_LABEL[row.surface]}</td><td>{MODE_LABEL[row.mode]}</td>
              <td><span className={styles.strategyLabel}>{row.strategy.replace(/_/g, ' ').toLowerCase()}{row.fallback && <StatusPill tone="warning" icon={false}>fallback</StatusPill>}</span><span className={styles.performanceTrack} aria-hidden="true"><span style={{ background: seriesColor(index), width: `${data.totals.impressions ? Math.max(4, row.impressions / data.totals.impressions * 100) : 0}%` }} /></span></td>
              <td>{formatCount(row.impressions)}</td><td>{formatCount(row.clicks)}</td><td>{percent(row.ctr)}</td>
            </tr>)}
          </tbody>
        </table></div>
      </TableCard>
    </>}
  </section>;
}

function SectionRow({ config }: { config: SectionConfig }) {
  const { saveSection } = useRecommendationMutations();
  const toast = useAdminToast();
  const [enabled, setEnabled] = useState(config.enabled);
  const [itemLimit, setItemLimit] = useState(String(config.itemLimit));
  const [message, setMessage] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const label = `${MODE_LABEL[config.mode]} on ${SURFACE_LABEL[config.surface]}`;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const limit = Number(itemLimit);
    if (!/^\d{1,2}$/.test(itemLimit) || limit < 1 || limit > config.maxLimit) {
      setFieldError(`Enter a whole number from 1 to ${config.maxLimit}.`);
      return;
    }
    setFieldError(null);
    saveSection.mutate({ surface: config.surface, mode: config.mode, enabled, itemLimit: limit, expectedVersion: config.version }, {
      onSuccess: () => { setMessage(null); toast(`${label} saved.`); },
      onError: error => setMessage(staleOrMessage(error, 'Could not save this section.')),
    });
  };

  return <form onSubmit={submit} className={styles.sectionRow} aria-label={label}>
    <div className={styles.sectionName}>
      <strong>{label}</strong>
      <span className={styles.modePurpose}>{config.mode === 'POPULAR_PRODUCTS' ? 'Highlights products with measured shopper demand.' : config.mode === 'RECOMMENDED_FOR_YOU' ? 'Personalized picks for eligible shoppers.' : config.mode === 'SIMILAR_PRODUCTS' ? 'Related products for the current product.' : config.mode === 'YOU_MAY_ALSO_LIKE' ? 'Additional product suggestions.' : 'Products commonly purchased together.'}</span>
      <StatusPill tone={config.enabled ? 'success' : 'neutral'} icon={false}>{config.enabled ? 'On' : 'Off'}</StatusPill>
    </div>
    <label className={styles.checkLabel}><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} /> Show this section</label>
    <label className={styles.field}>Items shown (1 to {config.maxLimit})
      <Input inputMode="numeric" value={itemLimit} onChange={event => setItemLimit(event.target.value)} aria-invalid={fieldError ? true : undefined}
        aria-describedby={fieldError ? `${config.surface}-${config.mode}-limit-error` : undefined} />
    </label>
    {fieldError && <p id={`${config.surface}-${config.mode}-limit-error`} role="alert" className={styles.error}>{fieldError}</p>}
    {message && <p role="alert" className={styles.error}>{message}</p>}
    <Button type="submit" variant="secondary" disabled={saveSection.isPending}>{saveSection.isPending ? 'Saving…' : 'Save section'}</Button>
  </form>;
}

function StrategiesPanel() {
  const configurations = useRecommendationConfigurations();
  return <section aria-labelledby="strategies-heading" className={styles.panel}>
    <h2 id="strategies-heading" className={styles.sectionTitle}>Strategies</h2>
    <p className={styles.help}>Turn a section off or limit how many items it shows. Changes apply to the storefront within about 30 seconds.</p>
    {configurations.isError && !configurations.data && <QueryProblem error={configurations.error} hasData={false} onRetry={() => void configurations.refetch()} what="section settings" />}
    {configurations.isPending && !configurations.data && <StrategiesSkeleton />}
    {configurations.data?.map(config => <SectionRow key={`${config.surface}-${config.mode}-${config.version}`} config={config} />)}
  </section>;
}

function PinDialog({ open, onOpenChange, surface }: { open: boolean; onOpenChange: (open: boolean) => void; surface: RecommendationSurfaceKey | undefined }) {
  const { createPin } = useRecommendationMutations();
  const toast = useAdminToast();
  const [productSearch, setProductSearch] = useState('');
  const [productPage, setProductPage] = useState(1);
  const [productId, setProductId] = useState('');
  const [pinSurface, setPinSurface] = useState<RecommendationSurfaceKey>(surface ?? 'home');
  const [position, setPosition] = useState('0');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  // Filter by physical quantity below rather than catalog stock status: LOW_STOCK remains purchasable while quantity is positive.
  const products = useAdminProducts({ q: productSearch.trim() || undefined, page: productPage, status: 'ACTIVE', sort: 'name', order: 'asc' });
  const eligibleProducts = (products.data?.data ?? []).filter(product => product.storefrontVisible && product.category.isActive && (product.inventory?.quantity ?? 0) > 0);
  const productOptions = eligibleProducts.map(product => ({ value: product.id, label: `${product.name} · ${product.sku}` }));

  const validate = () => {
    const next: Record<string, string> = {};
    if (!productId) next.productId = 'Choose an eligible product.';
    const pos = Number(position);
    if (!/^\d{1,2}$/.test(position) || pos > 99) next.position = 'Enter a whole number from 0 to 99.';
    if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) next.endsAt = 'The end must be after the start.';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setServerError(null);
    if (!validate()) return;
    createPin.mutate({ productId, surface: pinSurface, position: Number(position),
      startsAt: toIso(startsAt), endsAt: toIso(endsAt), enabled }, {
      onSuccess: () => { toast('Featured product added.'); onOpenChange(false); },
      onError: error => setServerError(errorMessage(error, 'Could not add this product.')),
    });
  };

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent>
      <DialogTitle>Add featured product</DialogTitle>
      <DialogDescription>Only products that are active, visible and in stock can be featured.</DialogDescription>
      <form onSubmit={submit} noValidate className={styles.form}>
        <Input label="Search products" value={productSearch} onChange={event => { setProductSearch(event.target.value); setProductPage(1); }} placeholder="Search by name or SKU" />
        <SearchSelect label="Eligible product" value={productId || undefined} onValueChange={value => { setProductId(value); setErrors(current => ({ ...current, productId: '' })); }}
          options={productOptions} placeholder={products.isPending ? 'Loading products…' : 'Choose a product'} searchPlaceholder="Filter loaded products"
          emptyText={products.isError ? 'Products could not be loaded' : 'No eligible products in these results. Search by name or SKU, or browse another page.'} error={errors.productId} disabled={products.isFetching || productOptions.length === 0}
          helperText="Only active, visible products with stock are listed. Search by name or SKU to find products beyond this page." />
        {products.data?.meta && products.data.meta.totalPages > 1 && <div className={styles.actions} aria-label="Product result pages">
          <Button type="button" variant="outline" size="small" disabled={productPage <= 1 || products.isFetching} onClick={() => setProductPage(page => page - 1)}>Previous products</Button>
          <span className={styles.help}>Page {products.data.meta.page} of {products.data.meta.totalPages}</span>
          <Button type="button" variant="outline" size="small" disabled={productPage >= products.data.meta.totalPages || products.isFetching} onClick={() => setProductPage(page => page + 1)}>Next products</Button>
        </div>}
        {errors.productId && <p id="pin-product-error" role="alert" className={styles.error}>{errors.productId}</p>}
        <Select label="Placement" value={pinSurface} onValueChange={value => setPinSurface(value as RecommendationSurfaceKey)}
          options={(Object.keys(SURFACE_LABEL) as RecommendationSurfaceKey[]).map(value => ({ value, label: SURFACE_LABEL[value] }))} />
        <label className={styles.field}>Position (0 is first)
          <Input inputMode="numeric" value={position} onChange={event => setPosition(event.target.value)} aria-invalid={errors.position ? true : undefined} />
        </label>
        {errors.position && <p role="alert" className={styles.error}>{errors.position}</p>}
        <label className={styles.field}>Starts (optional)
          <input type="datetime-local" value={startsAt} onChange={event => setStartsAt(event.target.value)} className={styles.input} />
        </label>
        <label className={styles.field}>Ends (optional)
          <input type="datetime-local" value={endsAt} onChange={event => setEndsAt(event.target.value)} className={styles.input} aria-invalid={errors.endsAt ? true : undefined} />
        </label>
        {errors.endsAt && <p role="alert" className={styles.error}>{errors.endsAt}</p>}
        <label className={styles.checkLabel}><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} /> Active</label>
        {serverError && <p role="alert" className={styles.error}>{serverError}</p>}
        <div className={styles.actions}>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" disabled={createPin.isPending}>{createPin.isPending ? 'Adding…' : 'Add featured product'}</Button>
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}

function PinEditDialog({ pin, open, onOpenChange }: { pin: FeaturedPin; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { updatePin } = useRecommendationMutations();
  const toast = useAdminToast();
  const [position, setPosition] = useState(String(pin.position));
  const [startsAt, setStartsAt] = useState(() => toDateTimeLocal(pin.startsAt));
  const [endsAt, setEndsAt] = useState(() => toDateTimeLocal(pin.endsAt));
  const [enabled, setEnabled] = useState(pin.enabled);
  const [error, setError] = useState<string | null>(null);

  // The row stays mounted while its dialog is closed; every open must reflect the latest pin version, not an old draft.
  useEffect(() => {
    if (!open) return;
    setPosition(String(pin.position));
    setStartsAt(toDateTimeLocal(pin.startsAt));
    setEndsAt(toDateTimeLocal(pin.endsAt));
    setEnabled(pin.enabled);
    setError(null);
  }, [open, pin]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const nextPosition = Number(position);
    if (!/^\d{1,2}$/.test(position) || nextPosition > 99) { setError('Enter a whole number from 0 to 99.'); return; }
    if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) { setError('The end must be after the start.'); return; }
    setError(null);
    const startUnchanged = startsAt === toDateTimeLocal(pin.startsAt);
    const endUnchanged = endsAt === toDateTimeLocal(pin.endsAt);
    updatePin.mutate({ id: pin.id, expectedVersion: pin.version, position: nextPosition, enabled,
      ...(startUnchanged ? {} : { startsAt: toIso(startsAt) }),
      ...(endUnchanged ? {} : { endsAt: toIso(endsAt) }),
    }, {
      onSuccess: () => { toast('Featured placement updated.'); onOpenChange(false); },
      onError: failure => setError(staleOrMessage(failure, 'Could not update this placement.')),
    });
  };

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent>
      <DialogTitle>Edit featured product</DialogTitle>
      <DialogDescription>Update when this product appears, its position, or whether the placement is active.</DialogDescription>
      <form onSubmit={submit} noValidate className={styles.form}>
        <p className={styles.help}>{pin.product?.name ?? 'Product'} · {SURFACE_LABEL[pin.surface]}</p>
        <label className={styles.field}>Position (0 is first)
          <Input inputMode="numeric" value={position} onChange={event => setPosition(event.target.value)} aria-invalid={Boolean(error) || undefined} />
        </label>
        <label className={styles.field}>Starts (optional)
          <input type="datetime-local" value={startsAt} onChange={event => setStartsAt(event.target.value)} className={styles.input} />
        </label>
        <label className={styles.field}>Ends (optional)
          <input type="datetime-local" value={endsAt} onChange={event => setEndsAt(event.target.value)} className={styles.input} />
        </label>
        <label className={styles.checkLabel}><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} /> Active</label>
        {error && <p role="alert" className={styles.error}>{error}</p>}
        <div className={styles.actions}>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={updatePin.isPending}>Cancel</Button>
          <Button type="submit" disabled={updatePin.isPending}>{updatePin.isPending ? 'Saving…' : 'Save changes'}</Button>
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}

function FeaturedRow({ pin }: { pin: FeaturedPin }) {
  const { updatePin, deletePin } = useRecommendationMutations();
  const toast = useAdminToast();
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const name = pin.product?.name ?? 'Product';

  const toggle = () => updatePin.mutate({ id: pin.id, expectedVersion: pin.version, enabled: !pin.enabled }, {
    onSuccess: () => { setMessage(null); toast(`${name} ${pin.enabled ? 'paused' : 'resumed'}.`); },
    onError: error => setMessage(staleOrMessage(error, 'Could not update this placement.')),
  });
  const remove = () => deletePin.mutate({ id: pin.id, expectedVersion: pin.version }, {
    onSuccess: () => { setConfirming(false); toast(`${name} removed from featured.`); },
    onError: error => { setConfirming(false); setMessage(staleOrMessage(error, 'Could not remove this placement.')); },
  });

  return <tr>
    <td><div className={styles.productIdentity}><span className={styles.productMark} aria-hidden="true">{name.slice(0, 1).toLocaleUpperCase()}</span><span><strong>{name}</strong>{pin.product && <span className={styles.muted}>{pin.product.sku}</span>}</span></div></td>
    <td>{SURFACE_LABEL[pin.surface]}</td>
    <td>{pin.position}</td>
    <td>{pin.startsAt ? formatDateTime(pin.startsAt) : 'Now'} to {pin.endsAt ? formatDateTime(pin.endsAt) : 'no end'}</td>
    <td><StatusPill tone={STATE_TONE[pin.state]} icon={false}>{STATE_LABEL[pin.state]}</StatusPill>
      {message && <p role="alert" className={styles.error}>{message}</p>}</td>
    <td className={styles.actionsCell}>
      <Button variant="ghost" size="small" onClick={toggle} disabled={updatePin.isPending}
        aria-label={`${pin.enabled ? 'Pause' : 'Resume'} featured ${name}`}>{pin.enabled ? 'Pause' : 'Resume'}</Button>
      <Button variant="ghost" size="small" onClick={() => setEditing(true)} aria-label={`Edit featured ${name}`}>Edit</Button>
      <Button variant="ghost" size="small" onClick={() => setConfirming(true)} aria-label={`Remove featured ${name}`}>Remove</Button>
      <PinEditDialog pin={pin} open={editing} onOpenChange={setEditing} />
      <ConfirmDialog open={confirming} onOpenChange={setConfirming} title={`Remove ${name} from featured?`}
        description="The product stays in the store; it just stops being featured here." confirmLabel="Remove" destructive
        pending={deletePin.isPending} error={deletePin.isError ? errorMessage(deletePin.error) : undefined} onConfirm={remove}>
        {null}
      </ConfirmDialog>
    </td>
  </tr>;
}

function FeaturedPanel() {
  const [surface, setSurface] = useState<RecommendationSurfaceKey | undefined>(undefined);
  const [adding, setAdding] = useState(false);
  const pins = useFeaturedPins(surface);
  const max = pins.data?.meta.maxPerSurface ?? 8;
  const rows = pins.data?.data ?? [];
  return <section aria-labelledby="featured-heading" className={styles.panel}>
    <div className={styles.toolbar}>
      <h2 id="featured-heading" className={styles.sectionTitle}>Featured products</h2>
      <div className={styles.toolbarActions}>
        <Select label="Placement" value={surface ?? 'all'} onValueChange={value => setSurface(value === 'all' ? undefined : value as RecommendationSurfaceKey)}
          options={[{ value: 'all', label: 'All placements' }, ...(Object.keys(SURFACE_LABEL) as RecommendationSurfaceKey[]).map(value => ({ value, label: SURFACE_LABEL[value] }))]} />
        <Button onClick={() => setAdding(true)} disabled={rows.length >= max && surface !== undefined}>Add featured product</Button>
      </div>
    </div>
    <p className={styles.help}>Up to {max} featured products per placement. Pins appear first in their rail and are labelled Featured.</p>
    {pins.isError && !pins.data && <QueryProblem error={pins.error} hasData={false} onRetry={() => void pins.refetch()} what="featured products" />}
    {pins.isPending && !pins.data && <FeaturedSkeleton />}
    {pins.data && <TableCard label="Featured products">
      <div className={styles.tableScroll} role="region" aria-label="Scrollable table" tabIndex={0}><table className={styles.table}>
        <thead><tr><th scope="col">Product</th><th scope="col">Placement</th><th scope="col">Position</th><th scope="col">Window</th><th scope="col">Status</th><th scope="col"><span className={styles.visuallyHidden}>Actions</span></th></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={6}><EmptyRows title="Nothing is featured yet" hint="Add a product to pin it at the top of a rail." /></td></tr>}
          {rows.map(pin => <FeaturedRow key={`${pin.id}-${pin.version}`} pin={pin} />)}
        </tbody>
      </table></div>
    </TableCard>}
    <PinDialog open={adding} onOpenChange={setAdding} surface={surface} />
  </section>;
}

/**
 * Find a product by name or SKU instead of typing its ID. Lists published products a shopper can open (any stock level), searched on
 * the server so the whole catalog is reachable; `exclude` hides products already chosen.
 */
function ProductPicker({ label, value, onChange, exclude = [], helperText }: {
  label: string; value: string; onChange: (product: { id: string; name: string; sku: string }) => void; exclude?: string[]; helperText?: string;
}) {
  const [search, setSearch] = useState('');
  const products = useAdminProducts({ q: search.trim() || undefined, page: 1, status: 'ACTIVE', sort: 'name', order: 'asc' });
  const rows = (products.data?.data ?? []).filter(product => product.storefrontVisible && product.category.isActive && !exclude.includes(product.id));
  const options = rows.map(product => ({ value: product.id, label: `${product.name} · ${product.sku}` }));
  return <div className={styles.pickerGroup}>
    <Input label={`Search ${label.toLowerCase()}`} value={search} onChange={event => setSearch(event.target.value)} placeholder="Search by name or SKU" />
    <SearchSelect label={label} value={value || undefined} options={options}
      onValueChange={id => { const product = rows.find(row => row.id === id); if (product) onChange({ id: product.id, name: product.name, sku: product.sku }); }}
      placeholder={products.isPending ? 'Loading products…' : 'Choose a product'} searchPlaceholder="Filter these results"
      emptyText={products.isError ? 'Products could not be loaded' : 'No published products match. Try another name or SKU.'}
      disabled={products.isPending || options.length === 0} helperText={helperText} />
  </div>;
}

function PreviewPanel() {
  const [surface, setSurface] = useState<RecommendationSurfaceKey>('home');
  const [product, setProduct] = useState<{ id: string; name: string; sku: string } | null>(null);
  const [cart, setCart] = useState<{ id: string; name: string; sku: string }[]>([]);
  const [limit, setLimit] = useState('4');
  const [submitted, setSubmitted] = useState<{ surface: RecommendationSurfaceKey; productId?: string; cartProductIds?: string[]; limit: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const preview = useRecommendationPreview(submitted);

  const run = (event: FormEvent) => {
    event.preventDefault();
    const ids = cart.map(item => item.id);
    const count = Number(limit);
    if (!/^\d{1,2}$/.test(limit) || count < 1 || count > 12) { setError('Enter a whole number from 1 to 12.'); return; }
    if (surface === 'product_detail' && !product) { setError('Choose the product whose page you want to preview.'); return; }
    if (surface === 'cart' && ids.length === 0) { setError('Add at least one product to the cart to preview.'); return; }
    setError(null);
    setSubmitted({ surface, productId: surface === 'product_detail' ? product?.id : undefined,
      cartProductIds: surface === 'cart' ? ids : undefined, limit: count });
  };

  return <section aria-labelledby="preview-heading" className={styles.panel}>
    <h2 id="preview-heading" className={styles.sectionTitle}>Preview</h2>
    <p className={styles.help}>See what a shopper would be shown. Previews are not recorded as impressions or clicks.</p>
    <form onSubmit={run} noValidate className={styles.toolbar}>
      <Select label="Placement" value={surface} onValueChange={value => setSurface(value as RecommendationSurfaceKey)}
        options={(Object.keys(SURFACE_LABEL) as RecommendationSurfaceKey[]).map(value => ({ value, label: SURFACE_LABEL[value] }))} />
      {surface === 'product_detail' && <ProductPicker label="Product page" value={product?.id ?? ''}
        onChange={choice => { setProduct(choice); setError(null); }} />}
      {surface === 'cart' && <div className={styles.pickerGroup}>
        <ProductPicker label="Add to cart" value="" exclude={cart.map(item => item.id)}
          onChange={choice => { setCart(current => current.length >= 20 ? current : [...current, choice]); setError(null); }}
          helperText={cart.length ? undefined : 'Pick each product a shopper has in their cart.'} />
        {cart.length > 0 && <ul className={styles.chosenList} aria-label="Products in the preview cart">
          {cart.map(item => <li key={item.id} className={styles.chosenItem}>
            <span>{item.name} <span className={styles.muted}>{item.sku}</span></span>
            <Tooltip content="Remove from preview cart"><button type="button" className={styles.chosenRemove} onClick={() => setCart(current => current.filter(row => row.id !== item.id))}
              aria-label={`Remove ${item.name} from the preview cart`}><X aria-hidden="true" size={14} /></button></Tooltip>
          </li>)}
        </ul>}
      </div>}
      <label className={styles.field}>Items
        <Input inputMode="numeric" value={limit} onChange={event => setLimit(event.target.value)} />
      </label>
      <Button type="submit">Run preview</Button>
    </form>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {preview.isFetching && !preview.data && <PreviewSkeleton />}
    {preview.isError && <QueryProblem error={preview.error} hasData={false} onRetry={() => void preview.refetch()} what="the preview" />}
    {preview.data && preview.data.sections.length === 0 && <EmptyRows title="No section is shown here" hint="The section may be turned off, or there is no data yet." />}
    {preview.data?.sections.map(section => {
      const copy = railCopy(section);
      return <div key={`${section.surface}-${section.mode}`} className={styles.previewSection}>
        <h3 className={styles.sectionTitle}>{copy?.title ?? MODE_LABEL[section.mode as RecommendationSectionMode] ?? section.mode}</h3>
        <p className={styles.help}>Strategy: {section.strategy.replace(/_/g, ' ').toLowerCase()}{section.fallbackReason ? ` (fallback: ${section.fallbackReason.replace(/_/g, ' ').toLowerCase()})` : ''}</p>
        <ul className={styles.previewProducts}>
          {section.items.map(item => <li key={item.product.id} className={styles.previewProduct}>
            {item.product.primaryImage?.url ? <img className={styles.previewImage} src={item.product.primaryImage.url} alt={item.product.primaryImage.altText ?? ''} /> : <span className={styles.previewImageFallback} aria-hidden="true">{item.product.name.slice(0, 1).toLocaleUpperCase()}</span>}
            <span className={styles.previewProductInfo}><strong>{item.product.name}</strong>{item.product.category?.name && <span>{item.product.category.name}</span>}{item.product.price != null && <strong className={styles.previewPrice}>{formatMoney(item.product.price, item.product.currency)}</strong>}</span>
            {item.featured && <StatusPill tone="primary" icon={false}>Featured</StatusPill>}
          </li>)}
        </ul>
      </div>;
    })}
  </section>;
}

export function AdminRecommendationsPage() {
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab');
  const tab: Tab = (TABS as readonly string[]).includes(requested ?? '') ? requested as Tab : 'overview';
  const setTab = (value: string) => setParams(previous => {
    const next = new URLSearchParams(previous);
    next.set('tab', value);
    return next;
  });

  return <div className={styles.page}>
    <PageHeader title="Recommendations" description="Control what shoppers see on the storefront, pin products and check how it performs."
      crumbs={CRUMBS} />
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList aria-label="Recommendation management sections" className={styles.tabs}>
        <TabsTrigger value="overview" className={styles.tab}><BarChart3 aria-hidden="true" focusable="false" /><span>Overview</span></TabsTrigger>
        <TabsTrigger value="strategies" className={styles.tab}><SlidersHorizontal aria-hidden="true" focusable="false" /><span>Strategies</span></TabsTrigger>
        <TabsTrigger value="featured" className={styles.tab}><Star aria-hidden="true" focusable="false" /><span>Featured</span></TabsTrigger>
        <TabsTrigger value="preview" className={styles.tab}><Eye aria-hidden="true" focusable="false" /><span>Preview</span></TabsTrigger>
      </TabsList>
      <TabsContent value="overview"><OverviewPanel /></TabsContent>
      <TabsContent value="strategies"><StrategiesPanel /></TabsContent>
      <TabsContent value="featured"><FeaturedPanel /></TabsContent>
      <TabsContent value="preview"><PreviewPanel /></TabsContent>
    </Tabs>
  </div>;
}
