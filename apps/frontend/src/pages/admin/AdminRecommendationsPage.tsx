import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Tabs';
import {
  ConfirmDialog, EmptyRows, KpiCard, PageHeader, QueryProblem, StatusPill, TableCard, useAdminToast, type Tone,
} from '@/features/admin/shared/AdminUi';
import { errorCode, errorMessage } from '@/features/admin/shared/api';
import { formatCount, formatDateTime } from '@/features/admin/shared/format';
import {
  useFeaturedPins, useRecommendationConfigurations, useRecommendationMutations, useRecommendationOverview, useRecommendationPreview,
  type FeaturedPin, type PinState, type RecommendationPeriod, type RecommendationSectionMode, type RecommendationSurfaceKey, type SectionConfig,
} from '@/features/admin/recommendations/api';
import { railCopy } from '@/features/recommendations/labels';
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
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CRUMBS = [{ label: 'Dashboard', to: '/admin' }, { label: 'Recommendations' }];
const percent = (value: number | null) => value === null ? 'No data yet' : `${(value * 100).toFixed(1)}%`;
const toIso = (value: string) => value ? new Date(value).toISOString() : null;
const STALE_MESSAGE = 'This changed since you loaded it. Reload to see the latest version, then try again.';

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
      <label className={styles.field}>Period
        <select value={period} onChange={event => setPeriod(event.target.value as RecommendationPeriod)} className={styles.select}>
          {PERIODS.map(value => <option key={value} value={value}>Last {value.replace('d', ' days')}</option>)}
        </select>
      </label>
    </div>
    {overview.isError && !data && <QueryProblem error={overview.error} hasData={false} onRetry={() => void overview.refetch()} what="recommendation performance" />}
    {overview.isPending && <p role="status">Loading performance…</p>}
    {data && <>
      <div className={styles.kpis}>
        <KpiCard label="Impressions" value={formatCount(data.totals.impressions)} hint="Shown to shoppers" />
        <KpiCard label="Clicks" value={formatCount(data.totals.clicks)} hint="Opened from a recommendation" />
        <KpiCard label="Click-through" value={percent(data.totals.ctr)} hint="Clicks ÷ impressions" />
        <KpiCard label="Fallback share" value={percent(data.totals.fallbackShare)} tone={(data.totals.fallbackShare ?? 0) > 0.5 ? 'warning' : 'neutral'}
          hint="Results without measured demand" />
      </div>
      <TableCard label="Performance by strategy">
        <div className={styles.tableScroll} role="region" aria-label="Scrollable table" tabIndex={0}><table className={styles.table}>
          <caption className={styles.visuallyHidden}>Impressions and clicks per surface, section and strategy</caption>
          <thead><tr><th scope="col">Surface</th><th scope="col">Section</th><th scope="col">Strategy</th><th scope="col">Impressions</th><th scope="col">Clicks</th><th scope="col">Click-through</th></tr></thead>
          <tbody>
            {data.breakdown.length === 0 && <tr><td colSpan={6}><EmptyRows title="No recommendations were shown in this period" hint="Results appear here once shoppers see a rail." /></td></tr>}
            {data.breakdown.map(row => <tr key={`${row.surface}-${row.mode}-${row.strategy}`}>
              <td>{SURFACE_LABEL[row.surface]}</td><td>{MODE_LABEL[row.mode]}</td>
              <td>{row.strategy.replace(/_/g, ' ').toLowerCase()}{row.fallback && <StatusPill tone="warning" icon={false}> fallback</StatusPill>}</td>
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
    {configurations.isPending && <p role="status">Loading sections…</p>}
    {configurations.data?.map(config => <SectionRow key={`${config.surface}-${config.mode}-${config.version}`} config={config} />)}
  </section>;
}

function PinDialog({ open, onOpenChange, surface }: { open: boolean; onOpenChange: (open: boolean) => void; surface: RecommendationSurfaceKey | undefined }) {
  const { createPin } = useRecommendationMutations();
  const toast = useAdminToast();
  const [productId, setProductId] = useState('');
  const [pinSurface, setPinSurface] = useState<RecommendationSurfaceKey>(surface ?? 'home');
  const [position, setPosition] = useState('0');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);

  const validate = () => {
    const next: Record<string, string> = {};
    if (!UUID.test(productId.trim())) next.productId = 'Enter the product ID (a UUID) from the product page.';
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
    createPin.mutate({ productId: productId.trim().toLowerCase(), surface: pinSurface, position: Number(position),
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
        <label className={styles.field}>Product ID
          <Input value={productId} onChange={event => setProductId(event.target.value)} aria-invalid={errors.productId ? true : undefined} aria-describedby="pin-product-error" />
        </label>
        {errors.productId && <p id="pin-product-error" role="alert" className={styles.error}>{errors.productId}</p>}
        <label className={styles.field}>Placement
          <select value={pinSurface} onChange={event => setPinSurface(event.target.value as RecommendationSurfaceKey)} className={styles.select}>
            {(Object.keys(SURFACE_LABEL) as RecommendationSurfaceKey[]).map(value => <option key={value} value={value}>{SURFACE_LABEL[value]}</option>)}
          </select>
        </label>
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

function FeaturedRow({ pin }: { pin: FeaturedPin }) {
  const { updatePin, deletePin } = useRecommendationMutations();
  const toast = useAdminToast();
  const [confirming, setConfirming] = useState(false);
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
    <td>{name}{pin.product && <span className={styles.muted}> · {pin.product.sku}</span>}</td>
    <td>{SURFACE_LABEL[pin.surface]}</td>
    <td>{pin.position}</td>
    <td>{pin.startsAt ? formatDateTime(pin.startsAt) : 'Now'} to {pin.endsAt ? formatDateTime(pin.endsAt) : 'no end'}</td>
    <td><StatusPill tone={STATE_TONE[pin.state]} icon={false}>{STATE_LABEL[pin.state]}</StatusPill>
      {message && <p role="alert" className={styles.error}>{message}</p>}</td>
    <td className={styles.actionsCell}>
      <Button variant="ghost" size="small" onClick={toggle} disabled={updatePin.isPending}
        aria-label={`${pin.enabled ? 'Pause' : 'Resume'} featured ${name}`}>{pin.enabled ? 'Pause' : 'Resume'}</Button>
      <Button variant="ghost" size="small" onClick={() => setConfirming(true)} aria-label={`Remove featured ${name}`}>Remove</Button>
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
        <label className={styles.field}>Placement
          <select value={surface ?? ''} onChange={event => setSurface(event.target.value ? event.target.value as RecommendationSurfaceKey : undefined)} className={styles.select}>
            <option value="">All placements</option>
            {(Object.keys(SURFACE_LABEL) as RecommendationSurfaceKey[]).map(value => <option key={value} value={value}>{SURFACE_LABEL[value]}</option>)}
          </select>
        </label>
        <Button onClick={() => setAdding(true)} disabled={rows.length >= max && surface !== undefined}>Add featured product</Button>
      </div>
    </div>
    <p className={styles.help}>Up to {max} featured products per placement. Pins appear first in their rail and are labelled Featured.</p>
    {pins.isError && !pins.data && <QueryProblem error={pins.error} hasData={false} onRetry={() => void pins.refetch()} what="featured products" />}
    {pins.isPending && <p role="status">Loading featured products…</p>}
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

function PreviewPanel() {
  const [surface, setSurface] = useState<RecommendationSurfaceKey>('home');
  const [productId, setProductId] = useState('');
  const [cart, setCart] = useState('');
  const [limit, setLimit] = useState('4');
  const [submitted, setSubmitted] = useState<{ surface: RecommendationSurfaceKey; productId?: string; cartProductIds?: string[]; limit: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const preview = useRecommendationPreview(submitted);

  const run = (event: FormEvent) => {
    event.preventDefault();
    const ids = cart.split(',').map(value => value.trim()).filter(Boolean);
    const count = Number(limit);
    if (!/^\d{1,2}$/.test(limit) || count < 1 || count > 12) { setError('Enter a whole number from 1 to 12.'); return; }
    if (surface === 'product_detail' && !UUID.test(productId.trim())) { setError('Enter the product ID of a product page to preview.'); return; }
    if (surface === 'cart' && (ids.length === 0 || ids.some(id => !UUID.test(id)))) { setError('Enter one or more product IDs for the cart, separated by commas.'); return; }
    setError(null);
    setSubmitted({ surface, productId: surface === 'product_detail' ? productId.trim().toLowerCase() : undefined,
      cartProductIds: surface === 'cart' ? ids.map(id => id.toLowerCase()) : undefined, limit: count });
  };

  return <section aria-labelledby="preview-heading" className={styles.panel}>
    <h2 id="preview-heading" className={styles.sectionTitle}>Preview</h2>
    <p className={styles.help}>See what a shopper would be shown. Previews are not recorded as impressions or clicks.</p>
    <form onSubmit={run} noValidate className={styles.toolbar}>
      <label className={styles.field}>Placement
        <select value={surface} onChange={event => setSurface(event.target.value as RecommendationSurfaceKey)} className={styles.select}>
          {(Object.keys(SURFACE_LABEL) as RecommendationSurfaceKey[]).map(value => <option key={value} value={value}>{SURFACE_LABEL[value]}</option>)}
        </select>
      </label>
      {surface === 'product_detail' && <label className={styles.field}>Product ID
        <Input value={productId} onChange={event => setProductId(event.target.value)} />
      </label>}
      {surface === 'cart' && <label className={styles.field}>Cart product IDs (comma separated)
        <Input value={cart} onChange={event => setCart(event.target.value)} />
      </label>}
      <label className={styles.field}>Items
        <Input inputMode="numeric" value={limit} onChange={event => setLimit(event.target.value)} />
      </label>
      <Button type="submit">Run preview</Button>
    </form>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {preview.isFetching && <p role="status">Loading preview…</p>}
    {preview.isError && <QueryProblem error={preview.error} hasData={false} onRetry={() => void preview.refetch()} what="the preview" />}
    {preview.data && preview.data.sections.length === 0 && <EmptyRows title="No section is shown here" hint="The section may be turned off, or there is no data yet." />}
    {preview.data?.sections.map(section => {
      const copy = railCopy(section);
      return <div key={`${section.surface}-${section.mode}`} className={styles.previewSection}>
        <h3 className={styles.sectionTitle}>{copy?.title ?? MODE_LABEL[section.mode as RecommendationSectionMode] ?? section.mode}</h3>
        <p className={styles.help}>Strategy: {section.strategy.replace(/_/g, ' ').toLowerCase()}{section.fallbackReason ? ` (fallback: ${section.fallbackReason.replace(/_/g, ' ').toLowerCase()})` : ''}</p>
        <ol className={styles.previewList}>
          {section.items.map(item => <li key={item.product.id}>{item.product.name}{item.featured && <StatusPill tone="primary" icon={false}> Featured</StatusPill>}</li>)}
        </ol>
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
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="strategies">Strategies</TabsTrigger>
        <TabsTrigger value="featured">Featured</TabsTrigger>
        <TabsTrigger value="preview">Preview</TabsTrigger>
      </TabsList>
      <TabsContent value="overview"><OverviewPanel /></TabsContent>
      <TabsContent value="strategies"><StrategiesPanel /></TabsContent>
      <TabsContent value="featured"><FeaturedPanel /></TabsContent>
      <TabsContent value="preview"><PreviewPanel /></TabsContent>
    </Tabs>
  </div>;
}
