import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { ElectroHubLoader } from '@/components/ui/ElectroHubLoader/ElectroHubLoader';
import { useAuth } from '@/features/auth/context/AuthContext';
import { useAdminCustomer, useCustomerStatus, type AdminCustomerDetail } from '@/features/admin/customers/api';
import { ButtonLink, ConfirmDialog, EmptyRows, KpiCard, PageHeader, QueryProblem, TableCard, useAdminToast } from '@/features/admin/shared/AdminUi';
import { OrderStatusPill, PaymentPill } from '@/features/admin/shared/labels';
import { errorCode, errorMessage } from '@/features/admin/shared/api';
import { formatCount, formatDate, formatDateTime, formatMoney, formatMoneyList, shortReference } from '@/features/admin/shared/format';
import { CustomerStatusPill } from './AdminCustomersPage';
import styles from '@/features/admin/shared/AdminPages.module.scss';

type RecentOrder = AdminCustomerDetail['recentOrders'][number];

export function AdminCustomerDetailPage() {
  const { userId = '' } = useParams();
  const { user } = useAuth();
  const query = useAdminCustomer(userId);
  const statusChange = useCustomerStatus(userId);
  const toast = useAdminToast();
  const [confirming, setConfirming] = useState(false);
  const customer = query.data?.data;
  const crumbs = [{ label: 'Dashboard', to: '/admin' }, { label: 'Customers', to: '/admin/customers' }, { label: customer?.name ?? 'Customer' }];

  if (!customer) {
    if (query.isPending) return <div className={styles.page}><ElectroHubLoader /></div>;
    const status = (query.error as { status?: number } | null)?.status;
    return <div className={styles.page}>
      <PageHeader title={status === 404 ? 'Customer not found' : 'Customer unavailable'} crumbs={crumbs} />
      {status === 404 ? <div className={styles.notFound}><p>No customer account matches this link.</p><ButtonLink to="/admin/customers" variant="outline">Back to customers</ButtonLink></div>
        : <QueryProblem error={query.error} hasData={false} onRetry={() => void query.refetch()} retrying={query.isFetching} what="The customer" />}
    </div>;
  }

  const deactivating = customer.status === 'ACTIVE';
  const canChange = customer.status !== 'DELETED' && customer.id !== user?.id;
  const columns: Column<RecentOrder>[] = [
    { key: 'order', title: 'Order', render: row => <Link className={styles.rowLink} to={`/admin/orders/${encodeURIComponent(row.orderReference)}`} title={row.orderReference}>
      <span className={styles.mono}>{shortReference(row.orderReference)}</span></Link> },
    { key: 'status', title: 'Status', render: row => <OrderStatusPill status={row.status} /> },
    { key: 'payment', title: 'Payment', render: row => <PaymentPill state={row.paymentState} /> },
    { key: 'total', title: 'Total', align: 'right', render: row => <span className={styles.money}>{formatMoney(row.total, row.currency)}</span> },
    { key: 'date', title: 'Placed', render: row => <span className={styles.muted}>{formatDateTime(row.createdAt)}</span> },
  ];

  return <div className={styles.page}>
    <PageHeader title={customer.name ?? 'Deleted account'} crumbs={crumbs}
      description={<>{customer.email ?? 'Personal data was removed when the customer deleted their account.'} · <CustomerStatusPill status={customer.status} /></>}
      actions={canChange && <Button type="button" variant={deactivating ? 'destructive' : 'primary'} onClick={() => { statusChange.reset(); setConfirming(true); }}>
        {deactivating ? 'Deactivate account' : 'Reactivate account'}</Button>} />
    {query.isError && <QueryProblem error={query.error} hasData onRetry={() => void query.refetch()} retrying={query.isFetching} what="The customer" />}
    <section className={`${styles.kpiGrid} ${styles.kpiGrid3}`} aria-label="Customer activity">
      <KpiCard label="Orders" value={formatCount(customer.orderCount)} tone="primary" to={`/admin/orders?customerId=${customer.id}`} />
      <KpiCard label="Paid spend" value={formatMoneyList(customer.paidSpend)} tone="success" hint="Successful payments, refunded excluded" />
      <KpiCard label="Last order" value={customer.lastOrderAt ? formatDate(customer.lastOrderAt) : 'None'} />
    </section>
    <div className={styles.split}>
      <section className={`${styles.panel} ${styles.panelFlush}`} aria-labelledby="orders-title">
        <div className={styles.panelHeader}>
          <h2 id="orders-title" className={styles.panelTitle}>Recent orders</h2>
          {customer.orderCount > 0 && <Link className={styles.panelLink} to={`/admin/orders?customerId=${customer.id}`}>All orders <ArrowRight aria-hidden="true" /></Link>}
        </div>
        <TableCard label="Recent orders">
          <DataTable caption="Recent orders" data={customer.recentOrders} columns={columns} keyExtractor={row => row.orderReference}
            emptyMessage={<EmptyRows title="No orders yet" />} />
        </TableCard>
      </section>
      <section className={styles.panel} aria-labelledby="account-title">
        <h2 id="account-title" className={styles.panelTitle}>Account</h2>
        <dl className={styles.details}>
          <dt>Status</dt><dd><CustomerStatusPill status={customer.status} /></dd>
          <dt>Email verified</dt><dd>{customer.emailVerified ? 'Yes' : 'No'}</dd>
          <dt>Region</dt><dd>{customer.region ? `${customer.region.city}, ${customer.region.country}` : 'No default address'}</dd>
          <dt>Joined</dt><dd>{formatDate(customer.createdAt)}</dd>
        </dl>
        {customer.id === user?.id && <p className={styles.fieldHelp}>You cannot change the status of your own account.</p>}
        {customer.status === 'DELETED' && <p className={styles.fieldHelp}>Deleted accounts are anonymized and cannot be reactivated. Their orders are kept for records.</p>}
      </section>
    </div>
    <ConfirmDialog open={confirming} onOpenChange={setConfirming} pending={statusChange.isPending} destructive={deactivating}
      title={deactivating ? 'Deactivate this account?' : 'Reactivate this account?'} confirmLabel={deactivating ? 'Deactivate' : 'Reactivate'}
      error={statusChange.isError ? errorMessage(statusChange.error) : null}
      onConfirm={() => statusChange.mutate({ isActive: !deactivating, expectedUpdatedAt: customer.updatedAt }, {
        onSuccess: () => { toast(deactivating ? 'Account deactivated.' : 'Account reactivated.'); setConfirming(false); },
        onError: error => { if (errorCode(error) === 'CUSTOMER_CONFLICT') void query.refetch(); },
      })}
      description={deactivating
        ? <><p><strong>{customer.name}</strong> is signed out everywhere and cannot sign in or place orders until reactivated.</p>
          <p>Their order history, payments and deliveries are not changed.</p></>
        : <p><strong>{customer.name}</strong> will be able to sign in again.</p>} />
  </div>;
}
