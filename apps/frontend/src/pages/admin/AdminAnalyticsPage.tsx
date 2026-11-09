import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import type { UseQueryResult } from '@tanstack/react-query';
import { DollarSign, Minus, Package, ShoppingCart, TrendingDown, TrendingUp, Users } from 'lucide-react';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { ProductImage } from '@/components/ui/ProductImage';
import {
  ANALYTICS_PERIODS, DEFAULT_ANALYTICS_PERIOD, useAnalyticsCategories, useAnalyticsCustomers, useAnalyticsDeliveries,
  useAnalyticsImageSearch, useAnalyticsInventory, useAnalyticsOverview, useAnalyticsProducts, useAnalyticsRecommendations,
  type AnalyticsEnvelope, type AnalyticsMeta, type AnalyticsPeriod, type CategoriesData, type CustomersData, type DeliveriesData,
  type ImageSearchData, type InventoryData, type ProductRow, type RecommendationsData,
} from '@/features/admin/analytics/api';
import { ActivePill, EmptyRows, KpiCard, PageHeader, QueryProblem, TableCard, type Crumb } from '@/features/admin/shared/AdminUi';
import { formatCount, formatDate, formatDateTime, formatMoney } from '@/features/admin/shared/format';
import { STATE_COLOR, seriesColor } from '@/features/admin/shared/chartColors';
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

function SectionSkeleton({ kind }: { kind: string }) {
  const shapes: Record<string, ReactNode> = {
    overview: <><div className={local.skeletonKpis}>{Array.from({ length: 4 }, (_, index) => <span key={index} />)}</div><div className={local.skeletonChart}><span /></div></>,
    products: <div className={local.skeletonRows}>{Array.from({ length: 4 }, (_, index) => <span key={index} />)}</div>,
    categories: <div className={local.skeletonBars}>{Array.from({ length: 5 }, (_, index) => <span key={index} />)}</div>,
    'customer-growth': <><span className={local.skeletonWide} /><div className={local.skeletonChart}><span /></div></>,
    'repeat-customers': <><span className={local.skeletonDonut} /><span className={local.skeletonWide} /></>,
    'orders-per-customer': <><span className={local.skeletonWide} /><span className={local.skeletonWide} /></>,
    'session-duration': <><span className={local.skeletonWide} /><span className={local.skeletonWide} /></>,
    recommendations: <><div className={local.skeletonKpis}>{Array.from({ length: 4 }, (_, index) => <span key={index} />)}</div><div className={local.skeletonRows}>{Array.from({ length: 3 }, (_, index) => <span key={index} />)}</div></>,
    'image-search': <><div className={local.skeletonKpis}>{Array.from({ length: 4 }, (_, index) => <span key={index} />)}</div><div className={local.skeletonBars}>{Array.from({ length: 3 }, (_, index) => <span key={index} />)}</div></>,
    inventory: <><span className={local.skeletonWide} /><div className={local.skeletonRows}>{Array.from({ length: 3 }, (_, index) => <span key={index} />)}</div></>,
    deliveries: <><div className={local.skeletonKpis}>{Array.from({ length: 3 }, (_, index) => <span key={index} />)}</div><div className={local.skeletonRows}>{Array.from({ length: 4 }, (_, index) => <span key={index} />)}</div></>,
  };
  return <div className={local.skeleton} data-testid={`analytics-${kind}-skeleton`} aria-hidden="true">{shapes[kind] ?? <><span /><span /><span /></>}</div>;
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
    {data !== undefined ? children(data, query.data?.meta) : query.isError ? null : <SectionSkeleton kind={id} />}
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
    <div className={styles.visuallyHidden}><table>
      <caption>Revenue per {granularity === 'MONTH' ? 'month' : 'day'} in {currency}</caption>
      <thead><tr><th scope="col">Period</th><th scope="col">Paid revenue</th><th scope="col">Paid orders</th></tr></thead>
      <tbody>{points.map(point => <tr key={point.bucket}><th scope="row">{label(point.bucket)}</th><td>{formatMoney(point.amount, currency)}</td><td>{formatCount(point.paidOrders)}</td></tr>)}</tbody>
    </table></div>
  </div>;
}

function Stat({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return <div className={local.stat}><dt>{label}</dt><dd>{value}</dd>{note && <p className={local.statNote}>{note}</p>}</div>;
}

function BarSeries({ rows, caption }: { rows: { bucket: string; count: number }[]; caption: string }) {
  const max = Math.max(1, ...rows.map(row => row.count));
  return <div className={local.bars}>
    <div className={local.barTrack} aria-hidden="true">
      {rows.map(row => <span key={row.bucket} className={local.bar} style={{ height: `${Math.max(4, (row.count / max) * 100)}%` }} title={`${row.bucket}: ${row.count}`} />)}
    </div>
    <div className={styles.visuallyHidden}><table>
      <caption>{caption}</caption>
      <tbody>{rows.map(row => <tr key={row.bucket}><th scope="row">{row.bucket}</th><td>{formatCount(row.count)}</td></tr>)}</tbody>
    </table></div>
  </div>;
}

/** Running total of new customer accounts across the window, drawn as one area so the slope reads as the growth rate. */
function CustomerGrowth({ data, period }: { data: CustomersData; period: AnalyticsPeriod }) {
  const monthly = data.registrations.granularity === 'MONTH';
  let running = 0;
  const points = data.registrations.buckets.map(row => ({ bucket: row.bucket, count: row.count, total: (running += row.count) }));
  const width = 300;
  const height = 96;
  const max = Math.max(1, running);
  const x = (index: number) => points.length < 2 ? width / 2 : (index / (points.length - 1)) * width;
  const y = (total: number) => height - 4 - (total / max) * (height - 8);
  const line = points.map((point, index) => `${index ? 'L' : 'M'}${x(index).toFixed(1)},${y(point.total).toFixed(1)}`).join(' ');
  return <div className={local.miniCard}>
    <p className={local.bigFigure}>{formatCount(data.newCustomers.current)}<span>new customers</span></p>
    <Growth growth={data.newCustomers.growth} period={period} />
    {running > 0
      ? <div className={local.growthCharts}>
        <div className={local.subsection}>
          <h3 className={local.subsectionTitle}>Running total</h3>
          <svg className={local.growthChart} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img"
            aria-label={`Running total of new customers: ${formatCount(running)} by the end of the period`}>
            <path d={`${line} L${x(points.length - 1).toFixed(1)},${height} L${x(0).toFixed(1)},${height} Z`} className={local.growthArea} />
            <path d={line} className={local.growthLine} vectorEffect="non-scaling-stroke" />
          </svg>
        </div>
        <div className={local.subsection}>
          <h3 className={local.subsectionTitle}>New customers per {monthly ? 'month' : 'day'}</h3>
          <BarSeries rows={data.registrations.buckets} caption="New customers per bucket" />
        </div>
      </div>
      : <EmptyRows title="No new customers in this period" />}
    <div className={styles.visuallyHidden}><table>
      <caption>New customers per {monthly ? 'month' : 'day'}, with running total</caption>
      <thead><tr><th scope="col">{monthly ? 'Month' : 'Day'}</th><th scope="col">New</th><th scope="col">Running total</th></tr></thead>
      <tbody>{points.map(point => <tr key={point.bucket}><th scope="row">{point.bucket}</th><td>{formatCount(point.count)}</td><td>{formatCount(point.total)}</td></tr>)}</tbody>
    </table></div>
  </div>;
}

/** Share of paying customers with two or more paid orders, as a ring with the rate written in its centre. */
function RepeatCustomers({ data }: { data: CustomersData }) {
  const { allTime, inWindow } = data.repeatBuyers;
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  return <div className={local.miniCard}>
    <div className={local.donut} role="img"
      aria-label={`Repeat purchase rate ${percentText(allTime.rate)}: ${formatCount(allTime.repeatCustomers)} of ${formatCount(allTime.payingCustomers)} paying customers`}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r={radius} className={local.donutTrack} />
        {(allTime.rate ?? 0) > 0 && <circle cx="50" cy="50" r={radius} className={local.donutValue} transform="rotate(-90 50 50)"
          strokeDasharray={`${((allTime.rate ?? 0) * circumference).toFixed(2)} ${circumference.toFixed(2)}`} />}
      </svg>
      <strong>{percentText(allTime.rate)}</strong>
    </div>
    <p className={local.coverage}>Repeat purchase rate, all time: {formatCount(allTime.repeatCustomers)} of {formatCount(allTime.payingCustomers)} paying customers.</p>
    <p className={local.statNote}>In this period: {percentText(inWindow.rate)} ({formatCount(inWindow.repeatCustomers)} of {formatCount(inWindow.payingCustomers)}).</p>
  </div>;
}

function OrdersPerCustomer({ data }: { data: CustomersData }) {
  const { average, paidOrders, payingCustomers } = data.ordersPerCustomer;
  return <div className={local.miniCard}>
    <p className={local.bigFigure}>{average === null ? '—' : average.toFixed(2)}<span>orders per customer</span></p>
    <p className={local.coverage}>{average === null ? 'No paid orders in this period.'
      : `${formatCount(paidOrders)} paid orders from ${formatCount(payingCustomers)} paying customers in this period.`}</p>
  </div>;
}

/** "4m 32s" / "45s" / "1h 05m": whole seconds, no fake precision. */
function formatDuration(ms: number) {
  const seconds = Math.round(ms / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  return minutes ? `${minutes}m ${String(seconds % 60).padStart(2, '0')}s` : `${seconds}s`;
}

function SessionDuration({ data, period }: { data: CustomersData; period: AnalyticsPeriod }) {
  const { averageMs, count, growth, trackingSince } = data.sessions;
  if (averageMs === null) return <EmptyRows title="No storefront sessions recorded in this period"
    hint={trackingSince ? `Tracking started ${formatDate(trackingSince)}.` : 'Figures appear once shoppers browse the storefront.'} />;
  return <div className={local.miniCard}>
    <p className={local.bigFigure}>{formatDuration(averageMs)}<span>avg. session duration</span></p>
    <Growth growth={growth} period={period} />
    <p className={local.coverage}>Average visible time across {formatCount(count)} storefront {count === 1 ? 'session' : 'sessions'} in this period.</p>
    {trackingSince && <p className={local.statNote}>Tracking started {formatDate(trackingSince)}; earlier periods are not comparable.</p>}
  </div>;
}

function StatusBreakdown({ rows, total, denominator }: {
  rows: { label: string; to: string; count: number; color?: string }[]; total: number; denominator: string;
}) {
  return <>
    <p className={local.statusNote}>Each bar is a share of {formatCount(total)} {denominator}.</p>
    <ul className={local.statusList}>
      {rows.map((row, index) => {
        const share = total > 0 ? row.count / total : 0;
        return <li key={row.label}>
          <Link className={local.drill} to={row.to}><span className={local.legendDot} style={{ background: row.color ?? seriesColor(index) }} aria-hidden="true" />{row.label}</Link><strong>{formatCount(row.count)}</strong>
          <span className={local.statusTrack} role="img" aria-label={`${row.label}: ${formatCount(row.count)} of ${formatCount(total)} ${denominator}`}>
            <span className={local.statusFill} style={{ width: `${share * 100}%`, background: row.color ?? seriesColor(index) }} />
          </span>
        </li>;
      })}
    </ul>
  </>;
}

const productColumns: Column<ProductRow>[] = [
  { key: 'name', title: 'Product', render: row => <span className={local.productCell}>{row.name}<ActivePill active={row.status === 'ACTIVE'} /></span> },
  { key: 'units', title: 'Units', align: 'right', render: row => formatCount(row.units) },
  { key: 'orders', title: 'Orders', align: 'right', render: row => formatCount(row.orders) },
  { key: 'amount', title: 'Paid amount', align: 'right', render: row => <span className={styles.money}>{formatMoney(row.amount, row.currency)}</span> },
];

function TopProducts({ rows }: { rows: ProductRow[] }) {
  const maxUnits = Math.max(1, ...rows.map(row => row.units));
  return <>
    <ol className={local.rankedProducts} aria-label="Top products ranked by units sold">
      {rows.map((row, index) => <li className={local.productRank} key={`${row.productId}:${row.currency}`}>
        <span className={local.rankNumber} aria-label={`Rank ${index + 1}`}>{String(index + 1).padStart(2, '0')}</span>
        <ProductImage src={row.image?.url} alt="" fallbackText="" loading="lazy" containerClassName={local.productThumbnail} />
        <span className={local.productDetails}>
          <Link className={local.productName} to={`/admin/products/${encodeURIComponent(row.productId)}/edit`}>{row.name}</Link>
          <span className={local.productBarTrack} aria-hidden="true"><span className={local.productBar} style={{ width: `${Math.max(row.units > 0 ? 2 : 0, (row.units / maxUnits) * 100)}%`, background: seriesColor(index) }} /></span>
          <span className={local.productMeta}>{formatCount(row.units)} units · {formatCount(row.orders)} orders</span>
        </span>
        <strong className={local.productAmount}>{formatMoney(row.amount, row.currency)}</strong>
      </li>)}
    </ol>
    <div className={styles.visuallyHidden}><table>
      <caption>Top products ranked by units sold</caption>
      <thead><tr><th scope="col">Rank</th>{productColumns.map(column => <th key={column.key} scope="col">{column.title}</th>)}</tr></thead>
      <tbody>{rows.map((row, index) => <tr key={`${row.productId}:${row.currency}`}>
        <th scope="row">{index + 1}</th><td>{row.name}, {row.status === 'ACTIVE' ? 'Active' : 'Inactive'}</td>
        <td>{formatCount(row.units)}</td><td>{formatCount(row.orders)}</td><td>{formatMoney(row.amount, row.currency)}</td>
      </tr>)}</tbody>
    </table></div>
  </>;
}

function CategoryContribution({ data }: { data: CategoriesData }) {
  return <div className={local.categoryList}>
    {data.categories.map((row, index) => {
      const width = row.share === null ? 0 : Math.max(0, Math.min(100, row.share * 100));
      return <div className={local.categoryRow} key={`${row.categoryId}:${row.currency}`}>
        <div className={local.categoryHeading}>
        <Link to={`/admin/products?categoryId=${encodeURIComponent(row.categoryId)}`} className={local.categoryName}><span className={local.legendDot} style={{ background: seriesColor(index) }} aria-hidden="true" />{row.name}</Link>
          <strong className={local.categoryAmount}>{formatMoney(row.amount, row.currency)}</strong>
        </div>
        <div className={local.categoryTrack} role="img" aria-label={`${row.name}: ${formatMoney(row.amount, row.currency)}${row.share === null ? '' : `, ${percentText(row.share)} of ${row.currency} revenue`}`}>
          <span className={local.categoryFill} style={{ width: `${width}%`, background: seriesColor(index) }} />
        </div>
        <div className={local.categoryMeta}><span>{formatCount(row.units)} units</span><span>{percentText(row.share)} share</span></div>
      </div>;
    })}
    <div className={styles.visuallyHidden}><table>
      <caption>Paid revenue by current catalog category</caption>
      <thead><tr><th scope="col">Category</th><th scope="col">Units</th><th scope="col">Paid amount</th><th scope="col">Share</th></tr></thead>
      <tbody>{data.categories.map(row => <tr key={`table:${row.categoryId}:${row.currency}`}><th scope="row">{row.name}</th><td>{formatCount(row.units)}</td><td>{formatMoney(row.amount, row.currency)}</td><td>{percentText(row.share)}</td></tr>)}</tbody>
    </table></div>
  </div>;
}

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
      description={`Paid revenue, orders, products, customers, recommendations and image search for the selected period. Figures use the store time zone (${meta?.timezone ?? '…'}).`}
      actions={<div role="radiogroup" aria-label="Reporting period" className={local.periodGroup}>
        {ANALYTICS_PERIODS.map((value, index) => <button key={value} ref={element => { radios.current[index] = element; }} type="button" role="radio"
          aria-checked={period === value} tabIndex={period === value ? 0 : -1}
          className={clsx(local.periodOption, period === value && local.periodOptionActive)}
          onClick={() => choose(value)} onKeyDown={event => onRadioKey(event, index)}>{PERIOD_LABEL[value]}</button>)}
      </div>} />

    <div className={local.toolbar}>
      {meta && <p className={local.windowNote}>
        {formatDate(meta.window.start)} to {formatDate(new Date(new Date(meta.window.end).getTime() - 1).toISOString())} ({meta.timezone}). Last updated {formatDateTime(meta.generatedAt)}.
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
      <Section id="products" title="Top products" hint="Ranked by units sold in paid orders. Names are the current catalog names." query={products}
        actions={<Link className={local.drill} to="/admin/products">Manage catalog <span aria-hidden="true">→</span></Link>}>
        {data => data.byUnits.length ? <TopProducts rows={data.byUnits} />
          : <EmptyRows title="No paid orders in this period" hint="Products appear here after a paid order." />}
      </Section>

      <Section id="categories" title="Revenue by category"
        hint="Uses the current catalog category of each product. Orders do not store a category snapshot, so past categories are not reconstructed." query={categories}>
        {(data: CategoriesData) => data.categories.length ? <CategoryContribution data={data} />
          : <EmptyRows title="No categorised sales in this period" />}
      </Section>
    </div>

    <Section id="customer-growth" title="Customer growth" hint="New customer accounts by creation date: the running total and each day's (or month's) sign-ups." query={customers}>
      {(data: CustomersData) => <CustomerGrowth data={data} period={period} />}
    </Section>

    <div className={local.threeColumn}>
      <Section id="repeat-customers" title="Repeat customers" hint="Paying customers with two or more paid orders." query={customers}>
        {(data: CustomersData) => <RepeatCustomers data={data} />}
      </Section>
      <Section id="orders-per-customer" title="Avg. orders per customer" hint="Paid orders divided by the customers who paid in the period." query={customers}>
        {(data: CustomersData) => <OrdersPerCustomer data={data} />}
      </Section>
      <Section id="session-duration" title="Avg. session duration" hint="Time a storefront tab was visible, per tab. Not linked to accounts." query={customers}>
        {(data: CustomersData) => <SessionDuration data={data} period={period} />}
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
              <Stat label="Completed with results" value={formatCount(Math.max(0, data.completed - data.noResults))} />
              <Stat label="Completed with no results" value={formatCount(data.noResults)} note={percentText(data.noResultRate)} />
              <Stat label="Failed" value={formatCount(data.failed)} />
              <Stat label="Selection rate" value={percentText(data.selectionRate)} note={`of ${formatCount(Math.max(0, data.completed - data.noResults))} searches with results · ${formatCount(data.selections)} product selections`} />
              <Stat label="Latency p50 / p95" value={data.latencyMs.p50 === null ? 'Not measured' : `${formatCount(data.latencyMs.p50)} / ${formatCount(data.latencyMs.p95 ?? 0)} ms`} />
            </div>
            <ul className={local.outcomeList} aria-label="Image search request outcomes">
              {[
                { label: 'Completed with results', count: Math.max(0, data.completed - data.noResults), className: local.outcomeFill },
                { label: 'Completed with no results', count: data.noResults, className: `${local.outcomeFill} ${local.outcomeSecondary}` },
                { label: 'Failed', count: data.failed, className: `${local.outcomeFill} ${local.outcomeTertiary}` },
              ].map(row => <li className={local.outcomeRow} key={row.label}>
                <span>{row.label}</span><strong>{formatCount(row.count)}</strong>
                <span className={local.outcomeTrack} role="img" aria-label={`${row.label}: ${formatCount(row.count)} of ${formatCount(data.requests)} searches`}>
                  <span className={row.className} style={{ width: `${data.requests > 0 ? (row.count / data.requests) * 100 : 0}%` }} />
                </span>
              </li>)}
            </ul>
          </>}
      </Section>

      <Section id="inventory" title="Inventory status" hint="Current state only. Past stock levels are not recorded as a time series." query={inventory}>
        {(data: InventoryData) => <>
          <p className={local.coverage}>{formatCount(data.trackedProducts)} tracked products. Untracked products are not counted.</p>
          <StatusBreakdown total={data.trackedProducts} denominator="tracked products" rows={[
            { label: 'In stock', count: data.byStatus.IN_STOCK, to: '/admin/inventory?status=IN_STOCK', color: STATE_COLOR.good },
            { label: 'Low stock', count: data.byStatus.LOW_STOCK, to: '/admin/inventory?status=LOW_STOCK', color: STATE_COLOR.warning },
            { label: 'Out of stock', count: data.byStatus.OUT_OF_STOCK, to: '/admin/inventory?status=OUT_OF_STOCK', color: STATE_COLOR.critical },
          ]} />
        </>}
      </Section>
    </div>

    <Section id="recommendations" title="Recommendations" hint="Impressions and clicks recorded for the period, with last-click conversion for consenting customers." query={recommendations}>
      {(data: RecommendationsData) => <>
        <div className={local.statRow}>
          <Stat label="Impressions" value={formatCount(data.impressions)} />
          <Stat label="Clicks" value={formatCount(data.clicks)} />
          <Stat label="Click-through rate" value={percentText(data.ctr)} />
          <Stat label="Attributed orders" value={formatCount(data.conversion.attributedOrders)}
            note="7-day, last-click attribution for consenting signed-in customers" />
          <Stat label="Attributed order items" value={formatCount(data.conversion.attributedOrderItems)} />
        </div>
        {data.conversion.attributedRevenue.length > 0
          ? <div className={local.currencyRevenue} aria-label="Attributed revenue by currency">
            <strong>Attributed revenue</strong>
            {data.conversion.attributedRevenue.map(row => <div className={local.currencyRevenueRow} key={row.currency}><span>{row.currency}</span><strong>{formatMoney(row.amount, row.currency)}</strong></div>)}
          </div>
          : <p className={local.coverage}>No attributed revenue in this period.</p>}
        <p className={local.coverage}>Conversion counts orders from signed-in customers who opted in to personalization and clicked the same product within 7 days before ordering. Other purchases are not attributed.</p>
        {data.breakdown.bySurface.length === 0 && data.breakdown.byMode.length === 0 && data.breakdown.byStrategy.length === 0
          ? <EmptyRows title="No recommendation activity in this period" />
          : <div className={local.breakdownGrid}>
            {data.breakdown.bySurface.length > 0 && <TableCard label="Recommendations by surface">
              <DataTable caption="Recommendations by surface" data={data.breakdown.bySurface} keyExtractor={row => row.surface}
                columns={[
                  { key: 'surface', title: 'Surface', render: row => row.surface },
                  { key: 'impressions', title: 'Impressions', align: 'right', render: row => formatCount(row.impressions) },
                  { key: 'clicks', title: 'Clicks', align: 'right', render: row => formatCount(row.clicks) },
                  { key: 'ctr', title: 'CTR', align: 'right', render: row => percentText(row.ctr) },
                ]} />
            </TableCard>}
            {data.breakdown.byMode.length > 0 && <TableCard label="Recommendations by mode">
              <DataTable caption="Recommendations by mode" data={data.breakdown.byMode} keyExtractor={row => row.mode}
                columns={[
                  { key: 'mode', title: 'Mode', render: row => row.mode },
                  { key: 'impressions', title: 'Impressions', align: 'right', render: row => formatCount(row.impressions) },
                  { key: 'clicks', title: 'Clicks', align: 'right', render: row => formatCount(row.clicks) },
                  { key: 'ctr', title: 'CTR', align: 'right', render: row => percentText(row.ctr) },
                ]} />
            </TableCard>}
            {data.breakdown.byStrategy.length > 0 && <TableCard label="Recommendations by strategy">
              <DataTable caption="Recommendations by strategy" data={data.breakdown.byStrategy} keyExtractor={row => row.strategy}
                columns={[
                  { key: 'strategy', title: 'Strategy', render: row => row.strategy },
                  { key: 'impressions', title: 'Impressions', align: 'right', render: row => formatCount(row.impressions) },
                  { key: 'clicks', title: 'Clicks', align: 'right', render: row => formatCount(row.clicks) },
                  { key: 'ctr', title: 'CTR', align: 'right', render: row => percentText(row.ctr) },
                ]} />
            </TableCard>}
          </div>}
      </>}
    </Section>

    <Section id="deliveries" title="Deliveries" hint="Active deliveries are the current state. Delivered counts use the delivery time within the period." query={deliveries}>
      {(data: DeliveriesData) => <>
        <div className={local.statRow}>
          <Stat label="Active deliveries" value={formatCount(data.active)} />
          <Stat label="Delivered in period" value={formatCount(data.deliveredInWindow)} />
          <Stat label="Average hours, paid to delivered"
            value={data.averageHoursPaidToDelivered.value === null ? 'Not available' : `${data.averageHoursPaidToDelivered.value} h`}
            note={data.averageHoursPaidToDelivered.unavailableReason ?? `From ${formatCount(data.averageHoursPaidToDelivered.sampleSize)} deliveries with both timestamps`} />
        </div>
        <StatusBreakdown total={Object.values(data.byStatus).reduce((sum, count) => sum + count, 0)} denominator="current delivery statuses" rows={[
          { label: 'Confirmed', count: data.byStatus.CONFIRMED, to: '/admin/deliveries?status=CONFIRMED' },
          { label: 'Preparing', count: data.byStatus.PREPARING, to: '/admin/deliveries?status=PREPARING' },
          { label: 'Out for delivery', count: data.byStatus.OUT_FOR_DELIVERY, to: '/admin/deliveries?status=OUT_FOR_DELIVERY' },
          { label: 'Delivered', count: data.byStatus.DELIVERED, to: '/admin/deliveries?status=DELIVERED' },
        ]} />
      </>}
    </Section>
  </div>;
}
