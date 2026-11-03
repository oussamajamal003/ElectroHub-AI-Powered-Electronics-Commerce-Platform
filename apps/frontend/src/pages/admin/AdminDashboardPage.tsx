import { useMemo, useState, type KeyboardEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import { ArrowRight, Boxes, ClipboardList, DollarSign, Package, ShoppingCart, Truck, Users } from 'lucide-react';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { useDashboard, type DashboardOverview } from '@/features/admin/dashboard/api';
import type { AdminOrderRow } from '@/features/admin/orders/api';
import { EmptyRows, ListEmpty, KpiCard, PageHeader, QueryProblem, StockPill, TableCard } from '@/features/admin/shared/AdminUi';
import { OrderStatusPill, PaymentPill } from '@/features/admin/shared/labels';
import { ORDER_STATUSES, orderStatusLabel } from '@/features/admin/shared/statusLabels';
import { formatCount, formatDate, formatDateTime, formatMoney, formatMoneyList, shortReference } from '@/features/admin/shared/format';
import styles from '@/features/admin/shared/AdminPages.module.scss';

const WINDOWS = [7, 30, 90] as const;

/** Real daily revenue for one currency, with empty days filled as zero so the axis is honest about quiet days. */
function RevenueChart({ overview }: { overview: DashboardOverview }) {
  const currency = overview.revenue[0]?.currency ?? 'USD';
  const days = useMemo(() => {
    const byDay = new Map(overview.revenueSeries.filter(row => row.currency === currency).map(row => [row.day, Number(row.amount)]));
    const start = new Date(overview.window.since);
    return Array.from({ length: overview.window.days }, (_, index) => {
      const day = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + index)).toISOString().slice(0, 10);
      return { day, amount: byDay.get(day) ?? 0 };
    });
  }, [overview, currency]);
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(...days.map(day => day.amount), 0);
  const top = niceCeiling(max);
  const total = days.reduce((sum, day) => sum + day.amount, 0);
  const best = days.reduce((winner, day) => day.amount > winner.amount ? day : winner, days[0]!);
  const paidDays = days.filter(day => day.amount > 0).length;
  const money = (amount: number) => formatMoney(amount.toFixed(2), currency);
  const compact = new Intl.NumberFormat('en-US', { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 });
  const label = (day: string) => formatDate(`${day}T12:00:00Z`);
  const focused = active === null ? null : days[active]!;
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); setActive(event.key === 'Home' ? 0 : days.length - 1); return; }
    if (!step) return;
    event.preventDefault();
    setActive(current => Math.min(days.length - 1, Math.max(0, (current ?? (step > 0 ? -1 : days.length)) + step)));
  };
  return <div className={styles.chart}>
    <dl className={styles.chartStats}>
      <div><dt>Total</dt><dd>{money(total)}</dd></div>
      <div><dt>Daily average</dt><dd>{money(total / days.length)}</dd></div>
      <div><dt>Best day</dt><dd>{max ? <>{money(best.amount)} <small>{label(best.day)}</small></> : '—'}</dd></div>
      <div><dt>Days with sales</dt><dd>{formatCount(paidDays)} <small>of {formatCount(days.length)}</small></dd></div>
    </dl>
    <div className={styles.chartFrame}>
      <div className={styles.chartScale} aria-hidden="true"><span>{compact.format(top)}</span><span>{compact.format(top / 2)}</span><span>{compact.format(0)}</span></div>
      {/* One focusable chart: hover or Left/Right/Home/End reads a day; the live line below repeats it for screen readers. */}
      <div className={styles.bars} role="group" tabIndex={0} onKeyDown={onKey} onMouseLeave={() => setActive(null)} onBlur={() => setActive(null)}
        aria-label={max === 0 ? `No paid revenue in the last ${overview.window.days} days.`
          : `Daily paid revenue in ${currency} over the last ${overview.window.days} days, totalling ${money(total)}. Use the arrow keys to read each day.`}>
        {days.map((day, index) => <span key={day.day} className={clsx(styles.bar, day.amount === 0 && styles.barEmpty, index === active && styles.barActive)}
          style={{ height: top ? `${Math.max(1.5, (day.amount / top) * 100)}%` : '2px' }} onMouseEnter={() => setActive(index)} />)}
        {focused && <span className={clsx(styles.chartTip, active! < days.length * 0.15 && styles.chartTipStart, active! > days.length * 0.85 && styles.chartTipEnd)} style={{ left: `${((active! + 0.5) / days.length) * 100}%` }} aria-hidden="true">
          <strong>{money(focused.amount)}</strong>{label(focused.day)}</span>}
      </div>
    </div>
    <div className={styles.chartAxis} aria-hidden="true">
      <span>{label(days[0]!.day)}</span><span>{label(days[Math.floor((days.length - 1) / 2)]!.day)}</span><span>{label(days[days.length - 1]!.day)}</span>
    </div>
    <p className={styles.visuallyHidden} aria-live="polite">{focused ? `${label(focused.day)}: ${money(focused.amount)}` : ''}</p>
    {overview.revenue.length > 1 && <p className={styles.panelHint}>Chart shows {currency}. Other currencies are listed in the revenue total and are never converted.</p>}
  </div>;
}

/** Rounds the axis maximum up to 1, 2 or 5 × 10ⁿ so the scale labels are readable round numbers. */
function niceCeiling(value: number) {
  if (value <= 0) return 0;
  const power = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find(candidate => candidate * power >= value)!;
  return step * power;
}

export function AdminDashboardPage() {
  const [params, setParams] = useSearchParams();
  const requested = Number(params.get('days'));
  const days = (WINDOWS as readonly number[]).includes(requested) ? requested : 30;
  const query = useDashboard(days);
  const overview = query.data?.data;
  const loading = query.isPending;

  const recentColumns: Column<AdminOrderRow>[] = [
    { key: 'order', title: 'Order', render: row => <Link className={styles.rowLink} to={`/admin/orders/${encodeURIComponent(row.orderReference)}`}
      title={row.orderReference}><span className={styles.mono}>{shortReference(row.orderReference)}</span></Link> },
    { key: 'customer', title: 'Customer', render: row => <span className={styles.cellText}><strong>{row.customer.name ?? 'Customer'}</strong><span>{row.customer.email}</span></span> },
    { key: 'status', title: 'Status', render: row => <OrderStatusPill status={row.status} /> },
    { key: 'payment', title: 'Payment', render: row => <PaymentPill state={row.paymentState} /> },
    { key: 'total', title: 'Total', align: 'right', render: row => <span className={styles.money}>{formatMoney(row.total, row.currency)}</span> },
    { key: 'date', title: 'Placed', render: row => <span className={styles.muted}>{formatDateTime(row.createdAt)}</span> },
  ];

  return <div className={styles.page}>
    <PageHeader title="Dashboard" crumbs={[{ label: 'Dashboard' }]}
      description={overview ? `Store activity for the last ${overview.window.days} days (UTC). Updated ${formatDateTime(overview.generatedAt)}.` : 'Store activity at a glance.'}
      actions={<div className={styles.segmented} role="group" aria-label="Reporting window">
        {WINDOWS.map(value => <button key={value} type="button" className={styles.segment} aria-pressed={days === value}
          onClick={() => setParams(value === 30 ? {} : { days: String(value) }, { replace: true })}>{value} days</button>)}
      </div>} />

    {query.isError && <QueryProblem error={query.error} hasData={Boolean(overview)} onRetry={() => void query.refetch()} retrying={query.isFetching} what="Dashboard data" />}

    <section className={styles.kpiGrid} aria-label="Key figures">
      <KpiCard label="Paid revenue" tone="success" icon={<DollarSign />} loading={loading}
        value={overview ? formatMoneyList(overview.revenue) : null}
        hint={overview ? `${formatCount(overview.revenue.reduce((sum, row) => sum + row.payments, 0))} successful payments · refunded payments excluded` : undefined} />
      <KpiCard label="Orders" tone="primary" icon={<ShoppingCart />} loading={loading} to="/admin/orders"
        value={overview ? formatCount(overview.orders.inWindow) : null}
        hint={overview ? `${formatCount(overview.orders.total)} orders all time` : undefined} />
      <KpiCard label="Sellable products" tone="info" icon={<Package />} loading={loading} to="/admin/products?status=ACTIVE"
        value={overview ? formatCount(overview.products.sellable) : null}
        hint={overview ? `of ${formatCount(overview.products.total)} catalog products` : undefined} />
      <KpiCard label="Active customers" tone="neutral" icon={<Users />} loading={loading} to="/admin/customers"
        value={overview ? formatCount(overview.customers.active) : null}
        hint={overview ? `${formatCount(overview.customers.total)} customer accounts` : undefined} />
    </section>

    <div className={styles.split}>
      <section className={styles.panel} aria-labelledby="revenue-title">
        <div className={styles.panelHeader}>
          <h2 id="revenue-title" className={styles.panelTitle}>Paid revenue by day</h2>
          <span className={styles.panelHint}>Successful payments by payment date</span>
        </div>
        {overview ? <RevenueChart overview={overview} /> : <div className={styles.bars} aria-hidden="true" />}
      </section>
      <section className={styles.panel} aria-labelledby="fulfillment-title">
        <div className={styles.panelHeader}>
          <h2 id="fulfillment-title" className={styles.panelTitle}>Fulfillment</h2>
          <Link to="/admin/deliveries" className={styles.panelLink}>Deliveries <ArrowRight aria-hidden="true" /></Link>
        </div>
        <div className={styles.stack}>
          <KpiCard label="Paid, awaiting fulfillment" tone="warning" icon={<ClipboardList />} loading={loading} to="/admin/orders?status=CONFIRMED&payment=PAID"
            value={overview ? formatCount(overview.fulfillment.awaitingFulfillment) : null} />
          <KpiCard label="Preparing" tone="primary" icon={<Boxes />} loading={loading} to="/admin/orders?status=PREPARING"
            value={overview ? formatCount(overview.fulfillment.preparing) : null} />
          <KpiCard label="Out for delivery" tone="info" icon={<Truck />} loading={loading} to="/admin/deliveries?status=OUT_FOR_DELIVERY"
            value={overview ? formatCount(overview.fulfillment.outForDelivery) : null} />
        </div>
      </section>
    </div>

    <div className={styles.split}>
      <section className={clsx(styles.panel, styles.panelFlush)} aria-labelledby="recent-title">
        <div className={styles.panelHeader}>
          <h2 id="recent-title" className={styles.panelTitle}>Recent orders</h2>
          <Link to="/admin/orders" className={styles.panelLink}>All orders <ArrowRight aria-hidden="true" /></Link>
        </div>
        <TableCard busy={query.isPlaceholderData} label="Recent orders">
          <DataTable caption="Recent orders" data={overview?.recentOrders ?? []} columns={recentColumns} keyExtractor={row => row.orderReference}
            loadingRows={loading ? 5 : undefined} emptyMessage={<ListEmpty failed={query.isError && !query.data}><EmptyRows title="No orders yet" hint="Orders appear here as soon as customers check out." /></ListEmpty>} />
        </TableCard>
      </section>
      <div className={styles.stack}>
        <section className={styles.panel} aria-labelledby="status-title">
          <h2 id="status-title" className={styles.panelTitle}>Orders by status</h2>
          {overview ? <ul className={styles.statusList}>
            {ORDER_STATUSES.map(status => {
              const count = overview.orders.byStatus[status] ?? 0;
              return <li key={status} className={styles.statusRow}>
                <Link className={styles.rowLink} to={`/admin/orders?status=${status}`}>{orderStatusLabel[status]}</Link>
                <span className={styles.money}>{formatCount(count)}</span>
                <span className={styles.meter} aria-hidden="true"><span style={{ width: overview.orders.total ? `${(count / overview.orders.total) * 100}%` : 0 }} /></span>
              </li>;
            })}
          </ul> : <p className={styles.panelHint} role="status">Loading…</p>}
        </section>
        <section className={styles.panel} aria-labelledby="stock-title">
          <div className={styles.panelHeader}>
            <h2 id="stock-title" className={styles.panelTitle}>Stock attention</h2>
            <Link to="/admin/inventory?status=LOW_STOCK" className={styles.panelLink}>Inventory <ArrowRight aria-hidden="true" /></Link>
          </div>
          {overview && <p className={styles.panelHint}>
            {formatCount(overview.inventory.outOfStock)} out of stock · {formatCount(overview.inventory.lowStock)} low · {formatCount(overview.inventory.inStock)} in stock
          </p>}
          {overview ? overview.inventory.attention.length ? <ul className={styles.statusList}>
            {overview.inventory.attention.map(item => <li key={item.productId} className={styles.statusRow}>
              <span className={styles.cellText}><strong>{item.name}</strong><span className={styles.mono}>{item.sku} · {formatCount(item.quantity)} left</span></span>
              <StockPill status={item.stockStatus} />
            </li>)}
          </ul> : <p className={styles.panelHint}>Every tracked product is above its low-stock threshold.</p> : <p className={styles.panelHint} role="status">Loading…</p>}
        </section>
      </div>
    </div>
  </div>;
}
