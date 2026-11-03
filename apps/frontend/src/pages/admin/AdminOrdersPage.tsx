import { Link, useNavigate } from 'react-router-dom';
import { Eye } from 'lucide-react';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Select } from '@/components/ui/Select';
import { useAdminOrders, type AdminOrderRow } from '@/features/admin/orders/api';
import { EmptyRows, ListEmpty, FilterBand, PageHeader, Pager, QueryProblem, TableCard } from '@/features/admin/shared/AdminUi';
import { OrderStatusPill, PaymentPill } from '@/features/admin/shared/labels';
import { ORDER_STATUSES, PAYMENT_STATES, orderStatusLabel, paymentLabel } from '@/features/admin/shared/statusLabels';
import { useListParams } from '@/features/admin/shared/useListParams';
import { formatCount, formatDateTime, formatMoney, shortReference } from '@/features/admin/shared/format';
import styles from '@/features/admin/shared/AdminPages.module.scss';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FILTERS = { status: ORDER_STATUSES, payment: PAYMENT_STATES, customerId: (value: string) => UUID.test(value) } as const;
const SORT_KEYS = ['createdAt', 'total'] as const;
const DEFAULT_SORT = { key: 'createdAt', order: 'desc' } as const;
const PAYMENT_OPTIONS = [{ value: 'ALL', label: 'Any payment' }, ...PAYMENT_STATES.map(state => ({ value: state, label: paymentLabel[state]! }))];

export function AdminOrdersPage() {
  const navigate = useNavigate();
  const list = useListParams({ filters: FILTERS, sortKeys: SORT_KEYS, defaultSort: DEFAULT_SORT });
  const query = useAdminOrders({ q: list.q, page: list.page, ...list.filters, sort: list.sort.key, order: list.sort.order });
  const counts = query.data?.meta.statusCounts;
  const total = counts ? Object.values(counts).reduce((sum, count) => sum + (count ?? 0), 0) : undefined;

  const columns: Column<AdminOrderRow>[] = [
    { key: 'order', title: 'Order', render: row => <Link className={styles.rowLink} to={`/admin/orders/${encodeURIComponent(row.orderReference)}`}
      title={row.orderReference} aria-label={`Order ${row.orderReference}`}><span className={styles.mono}>{shortReference(row.orderReference)}</span></Link> },
    { key: 'customer', title: 'Customer', render: row => <span className={styles.cellText}>
      <Link className={styles.rowLink} to={`/admin/customers/${row.customer.id}`}><strong>{row.customer.name ?? 'Customer'}</strong></Link>
      <span>{row.customer.email}</span></span> },
    { key: 'items', title: 'Items', align: 'right', render: row => <span className={styles.mono}>{formatCount(row.itemCount)}</span> },
    { key: 'total', title: 'Total', sortKey: 'total', align: 'right', render: row => <span className={styles.money}>{formatMoney(row.total, row.currency)}</span> },
    { key: 'payment', title: 'Payment', render: row => <PaymentPill state={row.paymentState} /> },
    { key: 'status', title: 'Status', render: row => <OrderStatusPill status={row.status} /> },
    { key: 'date', title: 'Placed', sortKey: 'createdAt', render: row => <span className={styles.muted}>{formatDateTime(row.createdAt)}</span> },
    { key: 'actions', title: 'Actions', align: 'right', render: row => <span className={styles.rowActions}>
      <Link className={styles.iconAction} to={`/admin/orders/${encodeURIComponent(row.orderReference)}`} aria-label={`View order ${shortReference(row.orderReference)}`}
        title="View order"><Eye aria-hidden="true" /></Link></span> },
  ];

  return <div className={styles.page}>
    <PageHeader title="Orders" crumbs={[{ label: 'Dashboard', to: '/admin' }, { label: 'Orders' }]}
      description="Every customer order with its payment and fulfillment state. Payment status comes from Stripe and is read-only here." />
    <FilterBand search={list.search} onSearch={list.setSearch} placeholder="Search by order reference, customer name or email" searchLabel="Search orders"
      chips={[{ value: undefined, label: 'All', count: total }, ...ORDER_STATUSES.map(status => ({ value: status, label: orderStatusLabel[status]!, count: counts?.[status] ?? (counts ? 0 : undefined) }))]}
      active={list.filters.status} onChip={value => list.setFilter('status', value)} onReset={list.reset} resetDisabled={!list.isFiltered}>
      <Select aria-label="Filter by payment" options={PAYMENT_OPTIONS} value={list.filters.payment ?? 'ALL'} square
        onValueChange={value => list.setFilter('payment', value === 'ALL' ? undefined : value)} />
    </FilterBand>
    {list.filters.customerId && <p className={styles.notice}>Showing orders for one customer. <Link className={styles.rowLink}
      to={`/admin/customers/${list.filters.customerId}`}>View customer</Link></p>}
    {query.isError && <QueryProblem error={query.error} hasData={Boolean(query.data)} onRetry={() => void query.refetch()} retrying={query.isFetching} what="Orders" />}
    <div>
      <TableCard busy={query.isPlaceholderData} label="Orders">
        <DataTable onRowClick={row => navigate(`/admin/orders/${encodeURIComponent(row.orderReference)}`)} caption="Orders" data={query.data?.data ?? []} columns={columns} keyExtractor={row => row.orderReference} sort={list.sort} onSortChange={list.setSort}
          loadingRows={query.isPending ? 8 : undefined}
          emptyMessage={<ListEmpty failed={query.isError && !query.data}>{list.isFiltered ? <EmptyRows title="No orders match these filters" hint="Try a different search or reset the filters." />
            : <EmptyRows title="No orders yet" hint="Orders appear here as soon as customers check out." />}</ListEmpty>} />
      </TableCard>
      <Pager meta={query.data?.meta} onPage={list.setPage} disabled={query.isPlaceholderData} label="Order pages" />
    </div>
  </div>;
}
