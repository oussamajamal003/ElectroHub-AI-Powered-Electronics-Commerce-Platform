import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { OrderBadges } from '@/features/orders/OrderBadges';
import { useAdminDeliveries } from '@/features/delivery/queries';
import { formatStamp } from '@/features/delivery/presentation';
import type { AdminDeliveryRow, DeliveryStage } from '@/features/delivery/types';
import { EmptyRows, FilterBand, ListEmpty, PageHeader } from '@/features/admin/shared/AdminUi';
import { scrollToContentTop } from '@/features/admin/shared/scroll';
import { useListParams } from '@/features/admin/shared/useListParams';
import styles from './AdminDeliveriesPage.module.scss';

const STAGES: { value: DeliveryStage; label: string }[] = [
  { value: 'CONFIRMED', label: 'Confirmed' }, { value: 'PREPARING', label: 'Preparing' },
  { value: 'OUT_FOR_DELIVERY', label: 'Out for delivery' }, { value: 'DELIVERED', label: 'Delivered' },
];
const FILTERS = { status: STAGES.map(stage => stage.value) } as const;
const NO_SORT = [] as const;
const DEFAULT_SORT = { key: 'createdAt', order: 'desc' } as const;
const SHIPPING: Record<AdminDeliveryRow['deliveryMethod'], string> = { STANDARD: 'Standard', EXPRESS: 'Express', OVERNIGHT: 'Overnight' };

/** Task 04.5 minimum admin list: paid, non-cancelled orders and their delivery state. Filtering and paging are validated server-side. */
export function AdminDeliveriesPage() {
  // Task 05.1: filter and page live in the URL so header alerts and dashboard cards can deep-link (e.g. ?status=OUT_FOR_DELIVERY).
  const list = useListParams({ filters: FILTERS, sortKeys: NO_SORT, defaultSort: DEFAULT_SORT });
  const [, setParams] = useSearchParams();
  const status = (list.filters.status ?? 'ALL') as DeliveryStage | 'ALL';
  const page = list.page;
  const setPage = (update: (value: number) => number) => {
    setParams(current => {
      const next = new URLSearchParams(current);
      const value = update(page);
      if (value > 1) next.set('page', String(value)); else next.delete('page');
      return next;
    }, { replace: true });
    scrollToContentTop();
  };
  const deliveries = useAdminDeliveries(status, page, list.q);
  const counts = deliveries.data?.meta.statusCounts;
  const total = counts ? Object.values(counts).reduce((sum, count) => sum + (count ?? 0), 0) : undefined;
  const rows = deliveries.data?.data ?? [];
  const meta = deliveries.data?.meta;
  const columns: Column<AdminDeliveryRow>[] = [
    { key: 'order', title: 'Order', render: row => <span className={styles.reference}>{row.orderReference}</span> },
    { key: 'customer', title: 'Customer', render: row => <span className={styles.customer}><strong>{row.customer.name ?? 'Customer'}</strong><span>{row.customer.email}</span></span> },
    { key: 'shipping', title: 'Shipping method', render: row => <span>{SHIPPING[row.deliveryMethod] ?? row.deliveryMethod}</span> },
    { key: 'status', title: 'Order / payment', render: row => <OrderBadges status={row.status} paymentState={row.paymentState} size="small" /> },
    { key: 'tracking', title: 'Tracking', render: row => row.delivery ? <span className={styles.customer}><strong>Revision {row.delivery.revision}</strong>
      <span className={styles.reference}>{row.delivery.trackingReference}</span></span> : <span className={styles.muted}>Not started</span> },
    { key: 'updated', title: 'Last update', render: row => row.delivery ? <time dateTime={row.delivery.updatedAt}>{formatStamp(row.delivery.updatedAt)}</time>
      : <span className={styles.muted}>—</span> },
    { key: 'manage', title: 'Action', align: 'right', render: row => <Link className={styles.manageLink} to={`/admin/deliveries/${encodeURIComponent(row.orderReference)}`}
      aria-label={`Manage delivery for ${row.orderReference}`}>Manage <ArrowRight size={16} aria-hidden="true" /></Link> },
  ];

  return <section className={styles.page}>
    <PageHeader title="Delivery" crumbs={[{ label: 'Dashboard', to: '/admin' }, { label: 'Delivery' }]}
      description="Start tracking and record delivery progress for paid orders."
      actions={meta && <span className={styles.count} aria-live="polite">{meta.total} {meta.total === 1 ? 'order' : 'orders'}</span>} />
    <FilterBand search={list.search} onSearch={list.setSearch} placeholder="Search by order reference, customer name or email" searchLabel="Search deliveries"
      chips={[{ value: undefined, label: 'All', count: total }, ...STAGES.map(stage => ({ value: stage.value, label: stage.label, count: counts?.[stage.value] ?? (counts ? 0 : undefined) }))]}
      active={list.filters.status} onChip={value => list.setFilter('status', value)} onReset={list.reset} resetDisabled={!list.isFiltered} />
    {deliveries.isError && <Alert variant="error"><span>{deliveries.data ? 'The list could not be refreshed. Showing the last loaded orders.'
      : 'Deliveries could not be loaded. Check your connection and try again.'}</span>{' '}
      <Button type="button" variant="outline" size="small" disabled={deliveries.isFetching} onClick={() => void deliveries.refetch()}>Retry</Button></Alert>}
    {/* Same convention as the other admin lists: the table frame renders at once with skeleton rows, and earlier rows stay during refetches. */}
    <div className={styles.table} aria-busy={deliveries.isPlaceholderData || undefined}>
      <DataTable caption="Deliveries" data={rows} columns={columns} keyExtractor={row => row.orderReference} loadingRows={deliveries.isPending ? 8 : undefined}
        emptyMessage={<ListEmpty failed={deliveries.isError && !deliveries.data}>
          <EmptyRows title={list.q ? 'No deliveries match your search.' : status === 'ALL' ? 'No paid orders are waiting for delivery tracking.' : 'No paid orders have this status.'} /></ListEmpty>} />
    </div>
    {meta && meta.totalPages > 1 && <nav className={styles.pagination} aria-label="Delivery result pages">
      <Button type="button" variant="outline" size="small" disabled={page <= 1 || deliveries.isPlaceholderData} onClick={() => setPage(value => Math.max(1, value - 1))}>Previous</Button>
      <span aria-live="polite">Page {meta.page} of {meta.totalPages}</span>
      <Button type="button" variant="outline" size="small" disabled={page >= meta.totalPages || deliveries.isPlaceholderData} onClick={() => setPage(value => value + 1)}>Next</Button>
    </nav>}
  </section>;
}
