import { Link } from 'react-router-dom';
import { DollarSign, UserCheck, Users } from 'lucide-react';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { useAdminCustomers, type AdminCustomerRow, type CustomerStatus } from '@/features/admin/customers/api';
import { EmptyRows, ListEmpty, FilterBand, KpiCard, PageHeader, Pager, QueryProblem, StatusPill, TableCard } from '@/features/admin/shared/AdminUi';
import { useListParams } from '@/features/admin/shared/useListParams';
import { formatCount, formatDate, formatMoneyList, initials } from '@/features/admin/shared/format';
import styles from '@/features/admin/shared/AdminPages.module.scss';

const FILTERS = { status: ['ACTIVE', 'INACTIVE', 'DELETED'] } as const;
const SORT_KEYS = ['createdAt', 'name', 'email'] as const;
const DEFAULT_SORT = { key: 'createdAt', order: 'desc' } as const;

export const CustomerStatusPill = ({ status }: { status: CustomerStatus }) => status === 'DELETED'
  ? <StatusPill tone="neutral" icon={false}>Deleted account</StatusPill>
  : <StatusPill tone={status === 'ACTIVE' ? 'success' : 'warning'} icon={false}>{status === 'ACTIVE' ? 'Active' : 'Deactivated'}</StatusPill>;

export function AdminCustomersPage() {
  const list = useListParams({ filters: FILTERS, sortKeys: SORT_KEYS, defaultSort: DEFAULT_SORT });
  const query = useAdminCustomers({ q: list.q, page: list.page, status: list.filters.status, sort: list.sort.key, order: list.sort.order });
  const summary = query.data?.meta.summary;

  const columns: Column<AdminCustomerRow>[] = [
    { key: 'name', title: 'Customer', sortKey: 'name', render: row => <span className={styles.cellMain}>
      <span className={`${styles.thumb} ${styles.thumbEmpty}`} aria-hidden="true">{initials(row.name)}</span>
      <span className={styles.cellText}><Link className={styles.rowLink} to={`/admin/customers/${row.id}`}><strong>{row.name ?? 'Deleted account'}</strong></Link>
        <span>{row.email ?? 'Personal data removed'}</span></span>
    </span> },
    { key: 'status', title: 'Status', render: row => <CustomerStatusPill status={row.status} /> },
    { key: 'orders', title: 'Orders', align: 'right', render: row => <span className={styles.mono}>{formatCount(row.orderCount)}</span> },
    { key: 'spend', title: 'Paid spend', align: 'right', render: row => <span className={styles.money}>{formatMoneyList(row.paidSpend)}</span> },
    { key: 'last', title: 'Last order', render: row => <span className={styles.muted}>{row.lastOrderAt ? formatDate(row.lastOrderAt) : 'No orders'}</span> },
    { key: 'joined', title: 'Joined', sortKey: 'createdAt', render: row => <span className={styles.muted}>{formatDate(row.createdAt)}</span> },
  ];

  return <div className={styles.page}>
    <PageHeader title="Customers" crumbs={[{ label: 'Dashboard', to: '/admin' }, { label: 'Customers' }]}
      description="Customer accounts with their order activity. Only the details needed for support are shown." />
    <section className={`${styles.kpiGrid} ${styles.kpiGrid3}`} aria-label="Customer summary">
      <KpiCard label="Customer accounts" icon={<Users />} tone="primary" loading={!summary} value={summary ? formatCount(summary.total) : null} hint="Excludes deleted accounts" />
      <KpiCard label="Active" icon={<UserCheck />} tone="success" loading={!summary} value={summary ? formatCount(summary.active) : null} />
      <KpiCard label="Paid revenue (all time)" icon={<DollarSign />} tone="info" loading={!summary} value={summary ? formatMoneyList(summary.paidRevenue) : null}
        hint="Successful payments, refunded excluded" />
    </section>
    <FilterBand search={list.search} onSearch={list.setSearch} placeholder="Search by name or email" searchLabel="Search customers"
      chips={[{ value: undefined, label: 'All' }, { value: 'ACTIVE', label: 'Active' }, { value: 'INACTIVE', label: 'Deactivated' }, { value: 'DELETED', label: 'Deleted' }]}
      active={list.filters.status} onChip={value => list.setFilter('status', value)} onReset={list.reset} resetDisabled={!list.isFiltered} />
    {query.isError && <QueryProblem error={query.error} hasData={Boolean(query.data)} onRetry={() => void query.refetch()} retrying={query.isFetching} what="Customers" />}
    <div>
      <TableCard busy={query.isPlaceholderData} label="Customers">
        <DataTable caption="Customers" data={query.data?.data ?? []} columns={columns} keyExtractor={row => row.id} sort={list.sort} onSortChange={list.setSort}
          loadingRows={query.isPending ? 8 : undefined}
          emptyMessage={<ListEmpty failed={query.isError && !query.data}>{list.isFiltered ? <EmptyRows title="No customers match these filters" hint="Try a different search or reset the filters." />
            : <EmptyRows title="No customers yet" hint="Customers appear here after they create an account." />}</ListEmpty>} />
      </TableCard>
      <Pager meta={query.data?.meta} onPage={list.setPage} disabled={query.isPlaceholderData} label="Customer pages" />
    </div>
  </div>;
}
