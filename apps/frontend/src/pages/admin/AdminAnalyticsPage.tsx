import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import type { UseQueryResult } from '@tanstack/react-query';
import { DollarSign, Minus, Package, ShoppingCart, TrendingDown, TrendingUp, Users } from 'lucide-react';
import { DataTable, type Column } from '@/components/ui/DataTable';
import {
  ANALYTICS_PERIODS, DEFAULT_ANALYTICS_PERIOD, useAnalyticsCategories, useAnalyticsCustomers, useAnalyticsDeliveries,
  useAnalyticsImageSearch, useAnalyticsInventory, useAnalyticsOverview, useAnalyticsProducts, useAnalyticsRecommendations,
  type AnalyticsEnvelope, type AnalyticsMeta, type AnalyticsPeriod, type CategoriesData, type CustomersData, type DeliveriesData,
  type ImageSearchData, type InventoryData, type ProductRow, type RecommendationsData,
} from '@/features/admin/analytics/api';
import { ActivePill, EmptyRows, KpiCard, PageHeader, QueryProblem, TableCard, type Crumb } from '@/features/admin/shared/AdminUi';
import { formatCount, formatDate, formatDateTime, formatMoney } from '@/features/admin/shared/format';
import styles from '@/features/admin/shared/AdminPages.module.scss';
import local from './AdminAnalyticsPage.module.scss';

const PERIOD_LABEL: Record<AnalyticsPeriod, string> = { '7d': '7 days', '30d': '30 days', '90d': '90 days', '12m': '12 months' };
const PREVIOUS_LABEL: Record<AnalyticsPeriod, string> = { '7d': 'previous 7 days', '30d': 'previous 30 days', '90d': 'previous 90 days', '12m': 'previous 12 months' };
const CRUMBS: Crumb[] = [{ label: 'Dashboard', to: '/admin' }, { label: 'Analytics' }];

const isPeriod = (value: string | null): value is AnalyticsPeriod => (ANALYTICS_PERIODS as readonly string[]).includes(value ?? '');
const percentText = (value: number | null) => value === null ? 'Not available' : `${(value * 100).toFixed(1)}%`;
const signedPercent = (ratio: number) => {
  const value = ratio * 100;
  return `${value > 0 ? '+' : ''}${value.toFixed(Math.abs(value) < 10 ? 1 : 0)}%`;
};

/** Previous-period change. A null growth means the previous period had nothing to compare with, shown honestly. */
function Growth({ growth, period }: { growth: number | null; period: AnalyticsPeriod }) {
  if (growth === null) return <span className={local.muted}>No prior data</span>;
  const Icon = growth > 0.05 ? TrendingUp : growth < -0.05 ? TrendingDown : Minus;
  const tone = growth > 0.05 ? local.up : growth < -0.05 ? local.down : local.muted;
  return <span className={clsx(local.growth, tone)}><Icon aria-hidden="true" size={14} />{signedPercent(growth)} vs {PREVIOUS_LABEL[period]}</span>;
}

function SectionSkeleton() {
  return <div className={local.skeleton} aria-hidden="true"><span /><span /><span /></div>;
}

interface SectionProps<T> {
  id: string;
  title: string;
  hint?: string;
  actions?: ReactNode;
  query: UseQueryResult<AnalyticsEnvelope<T>, Error>;
  children: (data: T, meta: AnalyticsMeta | undefined) => ReactNode;
}

/** One report panel with its own skeleton, stale-data notice, blocking error with Retry, and body. A failure never blocks other panels. */
function Section<T>({ id, title, hint, actions, query, children }: SectionProps<T>) {
  const data = query.data?.data;
  return <section className={local.panel} aria-labelledby={`${id}-title`} aria-busy={query.isFetching || undefined}>
    <div className={local.panelHeader}>
      <div className={local.panelHeading}>
        <h2 id={`${id}-title`} className={local.panelTitle}>{title}</h2>
        {hint && <p className={local.panelHint}>{hint}</p>}
      </div>
      {actions}
    </div>
    {query.isError && <QueryProblem error={query.error} hasData={data !== undefined} onRetry={() => void query.refetch()} retrying={query.isFetching} what={title} />}
    {data !== undefined ? children(data, query.data?.meta) : query.isError ? null : <SectionSkeleton />}
  </section>;
}

function RevenueChart({ points, currency, granularity }: {
  points: { bucket: string; amount: string; paidOrders: number }[]; currency: string; granularity: 'DAY' | 'MONTH';
}) {
  const [focused, setFocused] = useState<number | null>(null);
  const values = points.map(point => Number(point.amount));
  const max = Math.max(0, ...values);
  const width = 600;
  const height = 200;
  const count = points.length;
  // Bars, as in the Figma reference: one per bucket, each a discrete period total (no interpolation between buckets).
  const slot = count > 0 ? width / count : width;
  const barWidth = Math.max(1, slot * (count > 40 ? 0.7 : 0.82));
  const barHeight = (value: number) => max > 0 && value > 0 ? Math.max(2, (value / max) * height) : 0;
  const label = (bucket: string) => granularity === 'MONTH'
    ? new Date(`${bucket}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
    : new Date(`${bucket}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const peakIndex = max > 0 ? values.indexOf(max) : -1;
  const peak = peakIndex >= 0 ? points[peakIndex] : undefined;
  const summary = peak
    ? `Revenue over time in ${currency}. Peak ${formatMoney(peak.amount, currency)} on ${label(peak.bucket)}. The table below lists every bucket.`
    : `Revenue over time in ${currency}. No paid revenue in these buckets.`;
  const middle = Math.floor((count - 1) / 2);
  const first = points[0];
  const middlePoint = points[middle];
  const last = points[count - 1];
  const focusedPoint = focused !== null ? points[focused] : undefined;
  return <div className={local.chart}>
    <div className={local.chartFrame}>
      <div className={local.yAxis} aria-hidden="true"><span>{formatMoney(max.toFixed(2), currency)}</span><span>{formatMoney('0', currency)}</span></div>
      <div className={local.plot}>
        <svg viewBox={`0 0 ${width} ${height}`} className={local.svg} role="img" aria-label={summary} preserveAspectRatio="none">
          <line x1="0" x2={width} y1={height} y2={height} className={local.baseline} vectorEffect="non-scaling-stroke" />
          {points.map((point, index) => <rect key={point.bucket} x={index * slot + (slot - barWidth) / 2} width={barWidth}
            y={height - barHeight(values[index] ?? 0)} height={barHeight(values[index] ?? 0)}
            className={clsx(local.bar2, focused === index && local.bar2Active)} />)}
        </svg>
        {points.map((point, index) => point.paidOrders > 0 && <button key={point.bucket} type="button"
          className={clsx(local.point, focused === index && local.pointActive)}
          style={{ left: `${((index * slot) / width) * 100}%`, width: `${(slot / width) * 100}%`, top: 0, height: '100%' }}
          aria-label={`${label(point.bucket)}: ${formatMoney(point.amount, currency)}, ${formatCount(point.paidOrders)} paid orders`}
          onFocus={() => setFocused(index)} onBlur={() => setFocused(null)} onMouseEnter={() => setFocused(index)} onMouseLeave={() => setFocused(null)} />)}
      </div>
    </div>
    <div className={local.xAxis} aria-hidden="true">
      <span>{first && count > 0 ? label(first.bucket) : ''}</span>
      {count > 2 && middlePoint && <span>{label(middlePoint.bucket)}</span>}
      <span>{last && count > 1 ? label(last.bucket) : ''}</span>
    </div>
    <p className={local.readout} aria-live="polite">{focusedPoint
      ? `${label(focusedPoint.bucket)}: ${formatMoney(focusedPoint.amount, currency)}, ${formatCount(focusedPoint.paidOrders)} paid orders`
      : 'Hover or focus a bar to read its value. Only periods with paid orders are focusable.'}</p>
    <table className={styles.visuallyHidden}>
      <caption>Revenue per {granularity === 'MONTH' ? 'month' : 'day'} in {currency}</caption>
      <thead><tr><th scope="col">Period</th><th scope="col">Paid revenue</th><th scope="col">Paid orders</th></tr></thead>
      <tbody>{points.map(point => <tr key={point.bucket}><th scope="row">{label(point.bucket)}</th><td>{formatMoney(point.amount, currency)}</td><td>{formatCount(point.paidOrders)}</td></tr>)}</tbody>
    </table>
  </div>;
}

function BarSeries({ rows, caption }: { rows: { bucket: string; count: number }[]; caption: string }) {
  const max = Math.max(1, ...rows.map(row => row.count));
  return <div className={local.bars}>
    <div className={local.barTrack} aria-hidden="true">
      {rows.map(row => <span key={row.bucket} className={local.bar} style={{ height: `${Math.max(4, (row.count / max) * 100)}%` }} title={`${row.bucket}: ${row.count}`} />)}
    </div>
    <table className={styles.visuallyHidden}>
      <caption>{caption}</caption>
      <tbody>{rows.map(row => <tr key={row.bucket}><th scope="row">{row.bucket}</th><td>{formatCount(row.count)}</td></tr>)}</tbody>
    </table>
  </div>;
}

function Stat({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return <div className={local.stat}><dt>{label}</dt><dd>{value}</dd>{note && <p className={local.statNote}>{note}</p>}</div>;
}

const productColumns: Column<ProductRow>[] = [
  { key: 'name', title: 'Product', render: row => <span className={local.productCell}>{row.name}<ActivePill active={row.status === 'ACTIVE'} /></span> },
  { key: 'units', title: 'Units', align: 'right', render: row => formatCount(row.units) },
  { key: 'orders', title: 'Orders', align: 'right', render: row => formatCount(row.orders) },
  { key: 'amount', title: 'Paid amount', align: 'right', render: row => <span className={styles.money}>{formatMoney(row.amount, row.currency)}</span> },
];

export function AdminAnalyticsPage() {
  const [params, setParams] = useSearchParams();
  const period: AnalyticsPeriod = isPeriod(params.get('period')) ? (params.get('period') as AnalyticsPeriod) : DEFAULT_ANALYTICS_PERIOD;
  const overview = useAnalyticsOverview(period);
  const products = useAnalyticsProducts(period);
  const categories = useAnalyticsCategories(period);
  const inventory = useAnalyticsInventory(period);
  const recommendations = useAnalyticsRecommendations(period);
  const imageSearch = useAnalyticsImageSearch(period);
  const deliveries = useAnalyticsDeliveries(period);
  const customers = useAnalyticsCustomers(period);

  const radios = useRef<(HTMLButtonElement | null)[]>([]);
  const choose = (next: AnalyticsPeriod) => {
    const copy = new URLSearchParams(params);
    copy.set('period', next);
    setParams(copy);
  };
  const onRadioKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = ANALYTICS_PERIODS.length - 1;
    const target = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? (index === last ? 0 : index + 1)
      : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? (index === 0 ? last : index - 1)
        : event.key === 'Home' ? 0 : event.key === 'End' ? last : null;
    const next = target === null ? undefined : ANALYTICS_PERIODS[target];
    if (target === null || next === undefined) return;
    event.preventDefault();
    choose(next);
    radios.current[target]?.focus();
  };

  const meta = overview.data?.meta ?? customers.data?.meta;
  return <div className={styles.page}>
    {/* Period control sits on the title row, right-aligned, as in the Figma reference (it wraps under the title on narrow screens). */}
    <PageHeader title="Analytics" crumbs={CRUMBS}
      description="Paid revenue, orders, products, customers, recommendations and image search for the selected period. Figures are computed on the server in UTC."
      actions={<div role="radiogroup" aria-label="Reporting period" className={local.periodGroup}>
        {ANALYTICS_PERIODS.map((value, index) => <button key={value} ref={element => { radios.current[index] = element; }} type="button" role="radio"
          aria-checked={period === value} tabIndex={period === value ? 0 : -1}
          className={clsx(local.periodOption, period === value && local.periodOptionActive)}
          onClick={() => choose(value)} onKeyDown={event => onRadioKey(event, index)}>{PERIOD_LABEL[value]}</button>)}
      </div>} />

    <div className={local.toolbar}>
      {meta && <p className={local.windowNote}>
        {formatDate(meta.window.start)} to {formatDate(new Date(new Date(meta.window.end).getTime() - 1).toISOString())} (UTC). Last updated {formatDateTime(meta.generatedAt)}.
      </p>}
    </div>

    <Section id="overview" title="Overview" hint={`Compared with the ${PREVIOUS_LABEL[period]}.`} query={overview}
      actions={<Link className={local.drill} to="/admin/orders?payment=PAID">View paid orders <span aria-hidden="true">→</span></Link>}>
      {data => {
        const primary = data.byCurrency[0];
        const series = primary ? data.revenueSeries.byCurrency.find(item => item.currency === primary.currency) : undefined;
        const others = data.byCurrency.slice(1).map(row => `${row.currency} ${row.revenue.current}`).join(', ');
        return <>
          <div className={local.kpis}>
            <KpiCard label="Paid revenue" tone="primary" icon={<DollarSign />}
              value={primary ? formatMoney(primary.revenue.current, primary.currency) : null}
              hint={primary ? <>
                <Growth growth={primary.revenue.growth} period={period} />
                {others && <span className={local.muted}>Other currencies, not added together: {others}</span>}
              </> : 'No paid orders in this period'} />
            <KpiCard label="Paid orders" icon={<ShoppingCart />} value={formatCount(data.paidOrders.current)}
              hint={<Growth growth={data.paidOrders.growth} period={period} />} />
            <KpiCard label="Average order value" icon={<Package />}
              value={primary?.averageOrderValue.current ? formatMoney(primary.averageOrderValue.current, primary.currency) : null}
              hint={primary?.averageOrderValue.current ? <Growth growth={primary.averageOrderValue.growth} period={period} /> : 'No paid orders in this period'} />
            <KpiCard label="New customers" icon={<Users />} value={formatCount(data.newCustomers.current)}
              hint={<Growth growth={data.newCustomers.growth} period={period} />} />
          </div>
          <div className={local.subsection}>
            <h3 className={local.subsectionTitle}>Revenue over time</h3>
            {series && primary && series.points.some(point => point.paidOrders > 0)
              ? <RevenueChart points={series.points} currency={primary.currency} granularity={data.revenueSeries.granularity} />
              : <EmptyRows title="No paid orders in this period" hint="Paid revenue appears here once payments succeed." />}
          </div>
        </>;
      }}
    </Section>

    <div className={clsx(local.twoColumn, local.twoColumnWide)}>
      <Section id="products" title="Top products" hint="Ranked by units sold in paid orders. Names are the current catalog names." query={products}>
        {data => <TableCard label="Top products by units sold">
          <DataTable caption="Top products by units sold" data={data.byUnits} columns={productColumns}
            keyExtractor={row => `${row.productId}:${row.currency}`}
            emptyMessage={<EmptyRows title="No paid orders in this period" hint="Products appear here after a paid order." />} />
        </TableCard>}
      </Section>

      <Section id="categories" title="Revenue by category"
        hint="Uses the current catalog category of each product. Orders do not store a category snapshot, so past categories are not reconstructed." query={categories}>
        {(data: CategoriesData) => <TableCard label="Revenue by current catalog category">
          <DataTable caption="Revenue by current catalog category" data={data.categories} keyExtractor={row => `${row.categoryId}:${row.currency}`}
            columns={[
              { key: 'name', title: 'Category', render: row => row.name },
              { key: 'units', title: 'Units', align: 'right', render: row => formatCount(row.units) },
              { key: 'amount', title: 'Paid amount', align: 'right', render: row => <span className={styles.money}>{formatMoney(row.amount, row.currency)}</span> },
              { key: 'share', title: 'Share', align: 'right', render: row => percentText(row.share) },
            ]}
            emptyMessage={<EmptyRows title="No categorised sales in this period" />} />
        </TableCard>}
      </Section>
    </div>

    <div className={local.twoColumn}>
      <Section id="customers" title="Customers" hint="New accounts by creation date. Repeat buyers have two or more paid orders." query={customers}>
        {(data: CustomersData) => <>
          <div className={local.statRow}>
            <Stat label="Repeat buyers, all time" value={percentText(data.repeatBuyers.allTime.rate)}
              note={`${formatCount(data.repeatBuyers.allTime.repeatCustomers)} of ${formatCount(data.repeatBuyers.allTime.payingCustomers)} paying customers`} />
            <Stat label="Repeat buyers in period" value={percentText(data.repeatBuyers.inWindow.rate)}
              note={`${formatCount(data.repeatBuyers.inWindow.repeatCustomers)} of ${formatCount(data.repeatBuyers.inWindow.payingCustomers)} paying customers in period`} />
          </div>
          <div className={local.subsection}>
            <h3 className={local.subsectionTitle}>New customers per {data.registrations.granularity === 'MONTH' ? 'month' : 'day'}</h3>
            {data.registrations.buckets.some(row => row.count > 0)
              ? <BarSeries rows={data.registrations.buckets} caption="New customers per bucket" />
              : <EmptyRows title="No new customers in this period" />}
          </div>
        </>}
      </Section>

      <Section id="recommendations" title="Recommendations" hint="Impressions and clicks recorded for the period, with last-click conversion for consenting customers." query={recommendations}>
        {(data: RecommendationsData) => <>
          <div className={local.statRow}>
            <Stat label="Impressions" value={formatCount(data.impressions)} />
            <Stat label="Clicks" value={formatCount(data.clicks)} />
            <Stat label="Click-through rate" value={percentText(data.ctr)} />
            <Stat label="Attributed orders" value={formatCount(data.conversion.attributedOrders)}
              note={data.conversion.attributedRevenue.length
                ? data.conversion.attributedRevenue.map(row => formatMoney(row.amount, row.currency)).join(', ')
                : 'No attributed revenue in this period'} />
          </div>
          <p className={local.coverage}>Conversion counts orders from signed-in customers who opted in to personalization and clicked the same product within 7 days before ordering. Other purchases are not attributed.</p>
          {data.breakdown.bySurface.length > 0
            ? <TableCard label="Recommendations by surface">
              <DataTable caption="Recommendations by surface" data={data.breakdown.bySurface} keyExtractor={row => row.surface}
                columns={[
                  { key: 'surface', title: 'Surface', render: row => row.surface },
                  { key: 'impressions', title: 'Impressions', align: 'right', render: row => formatCount(row.impressions) },
                  { key: 'clicks', title: 'Clicks', align: 'right', render: row => formatCount(row.clicks) },
                  { key: 'ctr', title: 'CTR', align: 'right', render: row => percentText(row.ctr) },
                ]} />
            </TableCard>
            : <EmptyRows title="No recommendation activity in this period" />}
        </>}
      </Section>
    </div>

    <div className={local.twoColumn}>
      <Section id="image-search" title="Image search" hint="Server-side counts of image searches and the selections customers made from results." query={imageSearch}>
        {(data: ImageSearchData) => data.trackingSince === null && data.requests === 0
          ? <EmptyRows title="No image-search activity recorded yet" hint="Figures appear once customers run image searches." />
          : <>
            {data.trackingSince && <p className={local.coverage}>Tracking started {formatDate(data.trackingSince)}. Earlier periods are not comparable.</p>}
            <div className={local.statRow}>
              <Stat label="Searches" value={formatCount(data.requests)} />
              <Stat label="Completed" value={formatCount(data.completed)} note={`${formatCount(data.noResults)} with no results (${percentText(data.noResultRate)})`} />
              <Stat label="Failed" value={formatCount(data.failed)} />
              <Stat label="Selection rate" value={percentText(data.selectionRate)} note={`${formatCount(data.selections)} selections`} />
              <Stat label="Latency p50 / p95" value={data.latencyMs.p50 === null ? 'Not measured' : `${formatCount(data.latencyMs.p50)} / ${formatCount(data.latencyMs.p95 ?? 0)} ms`} />
            </div>
          </>}
      </Section>

      <Section id="inventory" title="Inventory status" hint="Current state only. Past stock levels are not recorded as a time series." query={inventory}>
        {(data: InventoryData) => <>
          <p className={local.coverage}>{formatCount(data.trackedProducts)} tracked products. Untracked products are not counted.</p>
          <ul className={local.statusList}>
            <li><Link className={local.drill} to="/admin/inventory?status=IN_STOCK">In stock</Link><strong>{formatCount(data.byStatus.IN_STOCK)}</strong></li>
            <li><Link className={local.drill} to="/admin/inventory?status=LOW_STOCK">Low stock</Link><strong>{formatCount(data.byStatus.LOW_STOCK)}</strong></li>
            <li><Link className={local.drill} to="/admin/inventory?status=OUT_OF_STOCK">Out of stock</Link><strong>{formatCount(data.byStatus.OUT_OF_STOCK)}</strong></li>
          </ul>
        </>}
      </Section>
    </div>

    <Section id="deliveries" title="Deliveries" hint="Active deliveries are the current state. Delivered counts use the delivery time within the period." query={deliveries}>
      {(data: DeliveriesData) => <>
        <div className={local.statRow}>
          <Stat label="Active deliveries" value={formatCount(data.active)} />
          <Stat label="Delivered in period" value={formatCount(data.deliveredInWindow)} />
          <Stat label="Average hours, paid to delivered"
            value={data.averageHoursPaidToDelivered.value === null ? 'Not available' : `${data.averageHoursPaidToDelivered.value} h`}
            note={data.averageHoursPaidToDelivered.unavailableReason ?? `From ${formatCount(data.averageHoursPaidToDelivered.sampleSize)} deliveries with both timestamps`} />
        </div>
        <ul className={local.statusList}>
          <li><Link className={local.drill} to="/admin/deliveries?status=CONFIRMED">Confirmed</Link><strong>{formatCount(data.byStatus.CONFIRMED)}</strong></li>
          <li><Link className={local.drill} to="/admin/deliveries?status=PREPARING">Preparing</Link><strong>{formatCount(data.byStatus.PREPARING)}</strong></li>
          <li><Link className={local.drill} to="/admin/deliveries?status=OUT_FOR_DELIVERY">Out for delivery</Link><strong>{formatCount(data.byStatus.OUT_FOR_DELIVERY)}</strong></li>
          <li><Link className={local.drill} to="/admin/deliveries?status=DELIVERED">Delivered</Link><strong>{formatCount(data.byStatus.DELIVERED)}</strong></li>
        </ul>
      </>}
    </Section>
  </div>;
}
