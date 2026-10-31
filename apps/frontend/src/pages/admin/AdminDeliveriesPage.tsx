import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { ElectroHubLoader } from '@/components/ui/ElectroHubLoader/ElectroHubLoader';
import { Select } from '@/components/ui/Select';
import { OrderBadges } from '@/features/orders/OrderBadges';
import { useAdminDeliveries } from '@/features/delivery/queries';
import { formatStamp } from '@/features/delivery/presentation';
import type { AdminDeliveryRow, DeliveryStage } from '@/features/delivery/types';
import styles from './AdminDeliveriesPage.module.scss';

const FILTERS: { value: DeliveryStage | 'ALL'; label: string }[] = [
  { value: 'ALL', label: 'All paid orders' }, { value: 'CONFIRMED', label: 'Confirmed' }, { value: 'PREPARING', label: 'Preparing' },
  { value: 'OUT_FOR_DELIVERY', label: 'Out for delivery' }, { value: 'DELIVERED', label: 'Delivered' },
];

/** Task 04.5 minimum admin list: paid, non-cancelled orders and their delivery state. Filtering and paging are validated server-side. */
export function AdminDeliveriesPage() {
  const [status, setStatus] = useState<DeliveryStage | 'ALL'>('ALL');
  const [page, setPage] = useState(1);
  const deliveries = useAdminDeliveries(status, page);
  const rows = deliveries.data?.data ?? [];
  const meta = deliveries.data?.meta;
  const columns: Column<AdminDeliveryRow>[] = [
    { key: 'order', title: 'Order', render: row => <span className={styles.reference}>{row.orderReference}</span> },
    { key: 'customer', title: 'Customer', render: row => <span className={styles.customer}><strong>{row.customer.name ?? 'Customer'}</strong><span>{row.customer.email}</span></span> },
    { key: 'status', title: 'Order / payment', render: row => <OrderBadges status={row.status} paymentState={row.paymentState} size="small" /> },
    { key: 'tracking', title: 'Tracking', render: row => row.delivery ? <span className={styles.customer}><strong>Revision {row.delivery.revision}</strong>
      <span className={styles.reference}>{row.delivery.trackingReference}</span></span> : <span className={styles.muted}>Not started</span> },
    { key: 'updated', title: 'Last update', render: row => row.delivery ? <time dateTime={row.delivery.updatedAt}>{formatStamp(row.delivery.updatedAt)}</time>
      : <span className={styles.muted}>—</span> },
    { key: 'manage', title: 'Action', align: 'right', render: row => <Link className={styles.manageLink} to={`/admin/deliveries/${encodeURIComponent(row.orderReference)}`}
      aria-label={`Manage delivery for ${row.orderReference}`}>Manage <ArrowRight size={16} aria-hidden="true" /></Link> },
  ];

  return <section className={styles.page}>
    <header className={styles.header}>
      <div><p className={styles.eyebrow}>FULFILLMENT</p><h1>Deliveries</h1><p>Start tracking and record delivery progress for paid orders.</p></div>
      {meta && <span className={styles.count} aria-live="polite">{meta.total} {meta.total === 1 ? 'order' : 'orders'}</span>}
    </header>
    <div className={styles.filters}>
      <Select label="Order status" options={FILTERS} value={status} onValueChange={value => { setStatus(value as DeliveryStage | 'ALL'); setPage(1); }} />
    </div>
    {deliveries.isError && <Alert variant="error"><span>{deliveries.data ? 'The list could not be refreshed. Showing the last loaded orders.'
      : 'Deliveries could not be loaded. Check your connection and try again.'}</span>{' '}
      <Button type="button" variant="outline" size="small" disabled={deliveries.isFetching} onClick={() => void deliveries.refetch()}>Retry</Button></Alert>}
    {deliveries.isPending ? <div className={styles.loading}><ElectroHubLoader /></div>
      : <div className={styles.table} aria-busy={deliveries.isFetching || undefined}>
        <DataTable data={rows} columns={columns} keyExtractor={row => row.orderReference}
          emptyMessage={status === 'ALL' ? 'No paid orders are waiting for delivery tracking.' : 'No paid orders have this status.'} /></div>}
    {meta && meta.totalPages > 1 && <nav className={styles.pagination} aria-label="Delivery result pages">
      <Button type="button" variant="outline" size="small" disabled={page <= 1 || deliveries.isFetching} onClick={() => setPage(value => Math.max(1, value - 1))}>Previous</Button>
      <span aria-live="polite">Page {meta.page} of {meta.totalPages}</span>
      <Button type="button" variant="outline" size="small" disabled={page >= meta.totalPages || deliveries.isFetching} onClick={() => setPage(value => value + 1)}>Next</Button>
    </nav>}
  </section>;
}
