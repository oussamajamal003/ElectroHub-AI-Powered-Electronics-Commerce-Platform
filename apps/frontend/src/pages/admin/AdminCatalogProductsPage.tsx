import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Archive, ArchiveRestore, Image as ImageIcon, ImageOff, Pencil, Plus } from 'lucide-react';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Select } from '@/components/ui/Select';
import { useAdminProducts, useCatalogOptions, useProductStatus, type AdminProductRow } from '@/features/admin/products/api';
import {
  ActivePill, ButtonLink, ConfirmDialog, EmptyRows, FilterBand, PageHeader, Pager, QueryProblem, StatusPill, StockPill, TableCard, useAdminToast,
} from '@/features/admin/shared/AdminUi';
import { useListParams } from '@/features/admin/shared/useListParams';
import { errorCode, errorMessage } from '@/features/admin/shared/api';
import { formatCount, formatDate, formatMoney } from '@/features/admin/shared/format';
import styles from '@/features/admin/shared/AdminPages.module.scss';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FILTERS = {
  status: ['ACTIVE', 'INACTIVE'], stock: ['IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK', 'UNTRACKED'], categoryId: (value: string) => UUID.test(value),
} as const;
const SORT_KEYS = ['name', 'price', 'createdAt', 'updatedAt', 'sku'] as const;
const DEFAULT_SORT = { key: 'updatedAt', order: 'desc' } as const;
const STOCK_OPTIONS = [{ value: 'ALL', label: 'Any stock' }, { value: 'IN_STOCK', label: 'In stock' }, { value: 'LOW_STOCK', label: 'Low stock' },
  { value: 'OUT_OF_STOCK', label: 'Out of stock' }, { value: 'UNTRACKED', label: 'Not tracked' }];

export function AdminCatalogProductsPage() {
  const list = useListParams({ filters: FILTERS, sortKeys: SORT_KEYS, defaultSort: DEFAULT_SORT });
  const options = useCatalogOptions();
  const query = useAdminProducts({ q: list.q, page: list.page, ...list.filters, sort: list.sort.key, order: list.sort.order });
  const statusChange = useProductStatus();
  const toast = useAdminToast();
  const [pending, setPending] = useState<AdminProductRow | null>(null);
  const rows = query.data?.data ?? [];

  const confirmStatus = () => {
    if (!pending) return;
    const next = pending.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    statusChange.mutate({ id: pending.id, status: next, expectedUpdatedAt: pending.updatedAt }, {
      onSuccess: () => { toast(next === 'ACTIVE' ? `${pending.name} is active again.` : `${pending.name} was archived.`); setPending(null); },
      // A stale row means someone else changed the product: reload so the next attempt uses the current version.
      onError: error => { if (errorCode(error) === 'PRODUCT_CONFLICT') void query.refetch(); },
    });
  };

  const columns: Column<AdminProductRow>[] = [
    { key: 'name', title: 'Product', sortKey: 'name', render: row => <span className={styles.cellMain}>
      {row.image ? <img className={styles.thumb} src={row.image.url} alt="" loading="lazy" />
        : <span className={`${styles.thumb} ${styles.thumbEmpty}`} aria-hidden="true"><ImageOff /></span>}
      <span className={styles.cellText}>
        <Link className={styles.rowLink} to={`/admin/products/${row.id}/edit`}><strong>{row.name}</strong></Link>
        <span>{row.brand?.name ?? 'No brand'}</span>
      </span>
    </span> },
    { key: 'sku', title: 'SKU', sortKey: 'sku', render: row => <span className={styles.mono}>{row.sku}</span> },
    { key: 'category', title: 'Category', render: row => <span className={styles.tags}>{row.category.name}
      {!row.category.isActive && <StatusPill tone="warning" icon={false}>Hidden category</StatusPill>}</span> },
    { key: 'price', title: 'Price', sortKey: 'price', align: 'right', render: row => <span className={styles.money}>{formatMoney(row.price, row.currency)}
      {row.compareAtPrice && <span className={styles.strike}>{formatMoney(row.compareAtPrice, row.currency)}</span>}</span> },
    { key: 'stock', title: 'Stock', render: row => <span className={styles.tags}><StockPill status={row.inventory?.status ?? null} />
      {row.inventory && <span className={styles.mono}>{formatCount(row.inventory.quantity)}</span>}</span> },
    { key: 'status', title: 'Status', render: row => <ActivePill active={row.status === 'ACTIVE'} inactiveLabel="Archived" /> },
    { key: 'updated', title: 'Updated', sortKey: 'updatedAt', render: row => <span className={styles.muted}>{formatDate(row.updatedAt)}</span> },
    { key: 'actions', title: 'Actions', align: 'right', render: row => <span className={styles.rowActions}>
      <Link className={styles.iconAction} to={`/admin/products/${row.id}/edit`} aria-label={`Edit ${row.name}`} title="Edit"><Pencil aria-hidden="true" /></Link>
      <Link className={styles.iconAction} to={`/admin/products/${row.id}/media`} aria-label={`Manage media for ${row.name}`} title="Media"><ImageIcon aria-hidden="true" /></Link>
      <button type="button" className={`${styles.iconAction} ${row.status === 'ACTIVE' ? styles.iconActionDanger : ''}`}
        aria-label={row.status === 'ACTIVE' ? `Archive ${row.name}` : `Reactivate ${row.name}`} title={row.status === 'ACTIVE' ? 'Archive' : 'Reactivate'}
        onClick={() => { statusChange.reset(); setPending(row); }}>
        {row.status === 'ACTIVE' ? <Archive aria-hidden="true" /> : <ArchiveRestore aria-hidden="true" />}
      </button>
    </span> },
  ];

  const categoryOptions = [{ value: 'ALL', label: 'All categories' }, ...(options.data?.data.categories ?? [])
    .map(category => ({ value: category.id, label: category.isActive ? category.name : `${category.name} (hidden)` }))];
  const activating = pending?.status === 'INACTIVE';

  return <div className={styles.page}>
    <PageHeader title="Products" crumbs={[{ label: 'Dashboard', to: '/admin' }, { label: 'Products' }]}
      description="Create, edit and archive catalog products. Archived products stay on past orders but leave the storefront."
      actions={<ButtonLink to="/admin/products/new"><Plus aria-hidden="true" /> Add product</ButtonLink>} />
    <FilterBand search={list.search} onSearch={list.setSearch} placeholder="Search by name or SKU" searchLabel="Search products"
      chips={[{ value: undefined, label: 'All' }, { value: 'ACTIVE', label: 'Active' }, { value: 'INACTIVE', label: 'Archived' }]}
      active={list.filters.status} onChip={value => list.setFilter('status', value)} onReset={list.reset} resetDisabled={!list.isFiltered}>
      <Select aria-label="Filter by category" options={categoryOptions} value={list.filters.categoryId ?? 'ALL'} square
        onValueChange={value => list.setFilter('categoryId', value === 'ALL' ? undefined : value)} />
      <Select aria-label="Filter by stock" options={STOCK_OPTIONS} value={list.filters.stock ?? 'ALL'} square
        onValueChange={value => list.setFilter('stock', value === 'ALL' ? undefined : value)} />
    </FilterBand>
    {query.isError && <QueryProblem error={query.error} hasData={Boolean(query.data)} onRetry={() => void query.refetch()} retrying={query.isFetching} what="Products" />}
    <div>
      <TableCard busy={query.isFetching} label="Products">
        <DataTable caption="Catalog products" data={rows} columns={columns} keyExtractor={row => row.id} sort={list.sort} onSortChange={list.setSort}
          loadingRows={query.isPending ? 8 : undefined}
          emptyMessage={list.isFiltered
            ? <EmptyRows title="No products match these filters" hint="Try a different search or reset the filters." />
            : <EmptyRows title="No products yet" hint="Add the first product to start selling." />} />
      </TableCard>
      <Pager meta={query.data?.meta} onPage={list.setPage} disabled={query.isFetching} label="Product pages" />
    </div>
    <ConfirmDialog open={Boolean(pending)} onOpenChange={open => { if (!open) setPending(null); }} pending={statusChange.isPending}
      title={activating ? 'Reactivate product?' : 'Archive product?'} confirmLabel={activating ? 'Reactivate' : 'Archive'} destructive={!activating}
      error={statusChange.isError ? errorMessage(statusChange.error) : null} onConfirm={confirmStatus}
      description={pending && (activating
        ? pending.category.isActive
          ? <p><strong>{pending.name}</strong> will be visible on the storefront again.</p>
          : <p>Its category <strong>{pending.category.name}</strong> is hidden. Activate the category first; the server refuses to activate a product in a hidden category.</p>
        : <><p><strong>{pending.name}</strong> will be removed from the storefront and cannot be added to new carts.</p>
          <p>Past orders keep their item details. Stock and media are kept, and you can reactivate it later.</p></>)} />
  </div>;
}
