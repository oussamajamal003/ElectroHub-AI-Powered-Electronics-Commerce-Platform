import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Archive, Image as ImageIcon, ImageOff, Pencil, Plus, Send, Trash2 } from 'lucide-react';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Select } from '@/components/ui/Select';
import { SearchSelect } from '@/components/ui/SearchSelect';
import { useAdminProducts, useCatalogOptions, useDeleteProduct, useProductStatus, type AdminProductRow } from '@/features/admin/products/api';
import {
  ActivePill, ButtonLink, ConfirmDialog, EmptyRows, ListEmpty, FilterBand, PageHeader, Pager, QueryProblem, StatusPill, StockPill, TableCard, useAdminToast,
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
  const [deleting, setDeleting] = useState<AdminProductRow | null>(null);
  const remove = useDeleteProduct();
  const rows = query.data?.data ?? [];

  const confirmStatus = () => {
    if (!pending) return;
    const next = pending.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    statusChange.mutate({ id: pending.id, status: next, expectedUpdatedAt: pending.updatedAt }, {
      onSuccess: () => { toast(next === 'ACTIVE' ? `${pending.name} was published.` : `${pending.name} was unpublished.`); setPending(null); },
      // A stale row means someone else changed the product: reload so the next attempt uses the current version.
      onError: error => { if (errorCode(error) === 'PRODUCT_CONFLICT') void query.refetch(); },
    });
  };

  const confirmDelete = () => {
    if (!deleting) return;
    remove.mutate(deleting.id, {
      onSuccess: () => { toast(`${deleting.name} was deleted.`); setDeleting(null); },
      onError: error => { if (errorCode(error) === 'PRODUCT_IN_USE') void query.refetch(); },
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
      {row.inventory && <span className={styles.mono}>{formatCount(row.inventory.quantity)} available</span>}</span> },
    { key: 'status', title: 'Status', render: row => <ActivePill active={row.status === 'ACTIVE'} activeLabel="Published" inactiveLabel="Unpublished" /> },
    { key: 'updated', title: 'Updated', sortKey: 'updatedAt', render: row => <span className={styles.muted}>{formatDate(row.updatedAt)}</span> },
    { key: 'actions', title: 'Actions', align: 'right', render: row => <span className={styles.rowActions}>
      <Link className={styles.iconAction} to={`/admin/products/${row.id}/edit`} aria-label={`Edit ${row.name}`} title="Edit"><Pencil aria-hidden="true" /></Link>
      <Link className={styles.iconAction} to={`/admin/products/${row.id}/media`} aria-label={`Manage media for ${row.name}`} title="Media"><ImageIcon aria-hidden="true" /></Link>
      <button type="button" className={styles.iconAction}
        aria-label={row.status === 'ACTIVE' ? `Unpublish ${row.name}` : `Publish ${row.name}`} title={row.status === 'ACTIVE' ? 'Unpublish' : 'Publish'}
        onClick={() => { statusChange.reset(); setPending(row); }}>
        {row.status === 'ACTIVE' ? <Archive aria-hidden="true" /> : <Send aria-hidden="true" />}
      </button>
      {/* Unavailable deletion stays focusable (aria-disabled), so its reason is reachable by keyboard and screen readers, not only on hover. */}
      <button type="button" className={`${styles.iconAction} ${styles.iconActionDanger}`} aria-disabled={!row.deletable || undefined}
        aria-label={row.deletable ? `Delete ${row.name}` : `Delete ${row.name} (unavailable: ${row.deleteBlocker})`}
        title={row.deletable ? 'Delete permanently' : `Cannot delete: ${row.deleteBlocker}`}
        onClick={() => { if (row.deletable) { remove.reset(); setDeleting(row); } else toast(`${row.name} cannot be deleted. ${row.deleteBlocker}`, 'info'); }}>
        <Trash2 aria-hidden="true" />
      </button>
    </span> },
  ];

  const categoryOptions = [{ value: 'ALL', label: 'All categories' }, ...(options.data?.data.categories ?? [])
    .map(category => ({ value: category.id, label: category.isActive ? category.name : `${category.name} (hidden)` }))];
  const categoryLoaded = !list.filters.categoryId || categoryOptions.some(option => option.value === list.filters.categoryId);
  const activating = pending?.status === 'INACTIVE';

  return <div className={styles.page}>
    <PageHeader title="Products" crumbs={[{ label: 'Dashboard', to: '/admin' }, { label: 'Products' }]}
      description="Create, publish and unpublish catalog products. Unpublished products leave the storefront but stay on past orders."
      actions={<ButtonLink to="/admin/products/new"><Plus aria-hidden="true" /> Add product</ButtonLink>} />
    <FilterBand search={list.search} onSearch={list.setSearch} placeholder="Search by name or SKU" searchLabel="Search products"
      chips={[{ value: undefined, label: 'All' }, { value: 'ACTIVE', label: 'Published' }, { value: 'INACTIVE', label: 'Unpublished' }]}
      active={list.filters.status} onChip={value => list.setFilter('status', value)} onReset={list.reset} resetDisabled={!list.isFiltered}>
      <SearchSelect label="Filter by category" hideLabel options={categoryOptions} value={categoryLoaded ? list.filters.categoryId ?? 'ALL' : undefined}
        placeholder={options.data ? 'All categories' : 'Loading categories…'} searchPlaceholder="Search categories" className={styles.filterPicker}
        onValueChange={value => list.setFilter('categoryId', value === 'ALL' ? undefined : value)} />
      <Select aria-label="Filter by stock" options={STOCK_OPTIONS} value={list.filters.stock ?? 'ALL'} square triggerClassName={styles.filterSelectTrigger}
        onValueChange={value => list.setFilter('stock', value === 'ALL' ? undefined : value)} />
    </FilterBand>
    {query.isError && <QueryProblem error={query.error} hasData={Boolean(query.data)} onRetry={() => void query.refetch()} retrying={query.isFetching} what="Products" />}
    <div>
      <TableCard busy={query.isPlaceholderData} label="Products">
        <DataTable caption="Catalog products" data={rows} columns={columns} keyExtractor={row => row.id} sort={list.sort} onSortChange={list.setSort}
          loadingRows={query.isPending ? 8 : undefined}
          emptyMessage={<ListEmpty failed={query.isError && !query.data}>{list.isFiltered
            ? <EmptyRows title="No products match these filters" hint="Try a different search or reset the filters." />
            : <EmptyRows title="No products yet" hint="Add the first product to start selling." />}</ListEmpty>} />
      </TableCard>
      <Pager meta={query.data?.meta} onPage={list.setPage} disabled={query.isPlaceholderData} label="Product pages" />
    </div>
    <ConfirmDialog open={Boolean(pending)} onOpenChange={open => { if (!open) setPending(null); }} pending={statusChange.isPending}
      title={activating ? 'Publish product?' : 'Unpublish product?'} confirmLabel={activating ? 'Publish' : 'Unpublish'} destructive={!activating}
      error={statusChange.isError ? errorMessage(statusChange.error) : null} onConfirm={confirmStatus}
      description={pending && (activating
        ? pending.category.isActive
          ? <p><strong>{pending.name}</strong> will appear on the storefront and can be added to carts.</p>
          : <p>Its category <strong>{pending.category.name}</strong> is hidden. Make the category visible first; the server refuses to publish into a hidden category.</p>
        : <><p><strong>{pending.name}</strong> will leave the storefront and cannot be added to new carts.</p>
          <p>Past orders keep their item details. Stock and media are kept, and you can publish it again later.</p></>)} />
    <ConfirmDialog open={Boolean(deleting)} onOpenChange={open => { if (!open) setDeleting(null); }} pending={remove.isPending} destructive
      title={deleting ? `Delete ${deleting.name}?` : 'Delete product?'} confirmLabel="Delete permanently"
      error={remove.isError ? errorMessage(remove.error) : null} onConfirm={confirmDelete}
      description={deleting && <><p>SKU <span className={styles.mono}>{deleting.sku}</span>. The product, its stock record and its specifications are removed.</p>
        <p>This cannot be undone. The server checks again that nothing references it before deleting.</p></>} />
  </div>;
}
