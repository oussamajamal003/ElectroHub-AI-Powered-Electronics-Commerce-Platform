import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, ImageOff, PackageX, SlidersHorizontal, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { conflictRow, useAdminInventory, useInventoryMutations, type InventoryRow } from '@/features/admin/inventory/api';
import { EmptyRows, ListEmpty, FilterBand, KpiCard, PageHeader, Pager, QueryProblem, StatusPill, StockPill, TableCard, useAdminToast } from '@/features/admin/shared/AdminUi';
import { useListParams } from '@/features/admin/shared/useListParams';
import { errorMessage, fieldErrors } from '@/features/admin/shared/api';
import { formatCount, formatDateTime } from '@/features/admin/shared/format';
import uiStyles from '@/features/admin/shared/AdminUi.module.scss';
import styles from '@/features/admin/shared/AdminPages.module.scss';

const FILTERS = { status: ['IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK', 'UNTRACKED'] } as const;
const SORT_KEYS = ['name', 'quantity', 'updatedAt', 'sku'] as const;
const DEFAULT_SORT = { key: 'quantity', order: 'asc' } as const;
const MAX_STOCK = 1_000_000;

function AdjustDialog({ row: initialRow, onClose }: { row: InventoryRow; onClose: () => void }) {
  const { adjust, threshold } = useInventoryMutations();
  const toast = useAdminToast();
  const [row, setRow] = useState(initialRow);
  const [operation, setOperation] = useState<'RESTOCK' | 'SET'>(initialRow.quantity === null ? 'SET' : 'RESTOCK');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [lowStockAt, setLowStockAt] = useState(String(initialRow.lowStockAt ?? 5));
  const [localError, setLocalError] = useState<string | null>(null);
  const busy = adjust.isPending || threshold.isPending;

  const amount = Number(quantity);
  const validAmount = /^\d{1,7}$/.test(quantity) && amount <= MAX_STOCK && (operation === 'SET' || amount >= 1);
  const resulting = validAmount ? (operation === 'RESTOCK' ? (row.quantity ?? 0) + amount : amount) : null;

  const submitAdjust = (event: FormEvent) => {
    event.preventDefault();
    if (!validAmount || (resulting !== null && resulting > MAX_STOCK)) {
      setLocalError(operation === 'RESTOCK' ? 'Enter at least 1 unit to add.' : `Enter a whole number from 0 to ${formatCount(MAX_STOCK)}.`);
      return;
    }
    setLocalError(null);
    adjust.mutate({ productId: row.productId, operation, quantity: amount, expectedQuantity: row.quantity, reason: reason.trim() || undefined }, {
      onSuccess: response => { toast(`${row.name}: stock is now ${formatCount(response.data.quantity ?? 0)}.`); onClose(); },
      onError: error => { const current = conflictRow(error); if (current) setRow(current); },
    });
  };
  const submitThreshold = (event: FormEvent) => {
    event.preventDefault();
    if (!/^\d{1,6}$/.test(lowStockAt) || Number(lowStockAt) > 100_000 || row.lowStockAt === null) {
      setLocalError('Enter a whole number from 0 to 100,000.'); return;
    }
    setLocalError(null);
    threshold.mutate({ productId: row.productId, lowStockAt: Number(lowStockAt), expectedLowStockAt: row.lowStockAt }, {
      onSuccess: response => { setRow(response.data); toast('Low-stock alert updated.'); },
      onError: error => { const current = conflictRow(error); if (current) setRow(current); },
    });
  };
  const error = adjust.error ?? threshold.error;
  const errors = fieldErrors(error);

  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent className={uiStyles.dialog}>
      <DialogTitle className={uiStyles.dialogTitle}>Adjust stock</DialogTitle>
      <DialogDescription asChild><div className={uiStyles.dialogBody}>
        <p><strong>{row.name}</strong> <span className={styles.mono}>{row.sku}</span></p>
        <p>On hand now: <strong className={styles.money}>{row.quantity === null ? 'not tracked' : formatCount(row.quantity)}</strong>
          {row.updatedAt && <> · last change {formatDateTime(row.updatedAt)}</>}</p>
      </div></DialogDescription>
      {conflictRow(error) && <p className={styles.noticeWarning + ' ' + styles.notice} role="alert">
        Stock changed while this dialog was open (for example, an order was placed). The numbers above are current; review them and submit again.
      </p>}
      <form className={styles.form} onSubmit={submitAdjust} noValidate>
        <div className={styles.segmented} role="group" aria-label="Adjustment type">
          <button type="button" className={styles.segment} aria-pressed={operation === 'RESTOCK'} disabled={row.quantity === null}
            onClick={() => setOperation('RESTOCK')}>Add units</button>
          <button type="button" className={styles.segment} aria-pressed={operation === 'SET'} onClick={() => setOperation('SET')}>Set exact count</button>
        </div>
        <Input label={operation === 'RESTOCK' ? 'Units received' : 'Counted quantity'} inputMode="numeric" value={quantity} autoFocus fullWidth
          onChange={event => setQuantity(event.target.value.trim())} error={localError ?? errors.quantity}
          helperText={resulting !== null ? `Stock after saving: ${formatCount(resulting)}` : undefined} />
        <Input label="Reason (optional)" value={reason} maxLength={200} fullWidth onChange={event => setReason(event.target.value)}
          helperText="For example: supplier delivery, cycle count. Not shown to customers." error={errors.reason} />
        {adjust.isError && !conflictRow(adjust.error) && !errors.quantity && <p className={uiStyles.dialogError} role="alert">{errorMessage(adjust.error)}</p>}
        <div className={uiStyles.dialogActions}>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Close</Button>
          <Button type="submit" isLoading={adjust.isPending} disabled={threshold.isPending}>{operation === 'RESTOCK' ? 'Add stock' : 'Set stock'}</Button>
        </div>
      </form>
      {row.lowStockAt !== null && <form className={styles.panel} onSubmit={submitThreshold} noValidate aria-label="Low-stock alert">
        <Input label="Low-stock alert at" inputMode="numeric" value={lowStockAt} fullWidth onChange={event => setLowStockAt(event.target.value.trim())}
          helperText="The product shows as low stock at or below this count." error={errors.lowStockAt} />
        {threshold.isError && !conflictRow(threshold.error) && <p className={uiStyles.dialogError} role="alert">{errorMessage(threshold.error)}</p>}
        <div className={uiStyles.dialogActions}>
          <Button type="submit" variant="outline" isLoading={threshold.isPending} disabled={adjust.isPending || Number(lowStockAt) === row.lowStockAt}>Save alert level</Button>
        </div>
      </form>}
    </DialogContent>
  </Dialog>;
}

export function AdminInventoryPage() {
  const list = useListParams({ filters: FILTERS, sortKeys: SORT_KEYS, defaultSort: DEFAULT_SORT });
  const query = useAdminInventory({ q: list.q, page: list.page, status: list.filters.status, sort: list.sort.key, order: list.sort.order });
  const [adjusting, setAdjusting] = useState<InventoryRow | null>(null);
  const summary = query.data?.meta.summary;

  const columns: Column<InventoryRow>[] = [
    { key: 'name', title: 'Product', sortKey: 'name', render: row => <span className={styles.cellMain}>
      {row.image ? <img className={styles.thumb} src={row.image.url} alt="" loading="lazy" />
        : <span className={`${styles.thumb} ${styles.thumbEmpty}`} aria-hidden="true"><ImageOff /></span>}
      <span className={styles.cellText}><Link className={styles.rowLink} to={`/admin/products/${row.productId}/edit`}><strong>{row.name}</strong></Link>
        <span>{row.category.name}</span></span>
    </span> },
    { key: 'sku', title: 'SKU', sortKey: 'sku', render: row => <span className={styles.mono}>{row.sku}</span> },
    { key: 'quantity', title: 'On hand', sortKey: 'quantity', align: 'right', render: row => <span className={styles.money}>{row.quantity === null ? '—' : formatCount(row.quantity)}</span> },
    { key: 'threshold', title: 'Alert at', align: 'right', render: row => <span className={styles.mono}>{row.lowStockAt === null ? '—' : formatCount(row.lowStockAt)}</span> },
    { key: 'status', title: 'Stock', render: row => <StockPill status={row.stockStatus} /> },
    { key: 'sellable', title: 'Sellable', render: row => row.purchasable ? <StatusPill tone="success" icon={false}>Yes</StatusPill>
      : <StatusPill tone="neutral" icon={false}>{row.productStatus !== 'ACTIVE' ? 'Archived' : !row.category.isActive ? 'Hidden category' : 'No'}</StatusPill> },
    { key: 'updated', title: 'Last change', sortKey: 'updatedAt', render: row => <span className={styles.muted}>{row.updatedAt ? formatDateTime(row.updatedAt) : '—'}</span> },
    { key: 'actions', title: 'Actions', align: 'right', render: row => <Button type="button" variant="outline" size="small" onClick={() => setAdjusting(row)}
      aria-label={`Adjust stock for ${row.name}`}><SlidersHorizontal aria-hidden="true" size={16} /> Adjust</Button> },
  ];

  return <div className={styles.page}>
    <PageHeader title="Inventory" crumbs={[{ label: 'Dashboard', to: '/admin' }, { label: 'Inventory' }]}
      description="Physical stock per product. Every change is checked against the quantity you saw, so concurrent sales are never overwritten." />
    <section className={styles.kpiGrid} aria-label="Stock summary">
      <KpiCard label="In stock" tone="success" icon={<CheckCircle2 />} loading={!summary} value={summary ? formatCount(summary.inStock) : null} to="/admin/inventory?status=IN_STOCK" />
      <KpiCard label="Low stock" tone="warning" icon={<AlertTriangle />} loading={!summary} value={summary ? formatCount(summary.lowStock) : null} to="/admin/inventory?status=LOW_STOCK" />
      <KpiCard label="Out of stock" tone="error" icon={<XCircle />} loading={!summary} value={summary ? formatCount(summary.outOfStock) : null} to="/admin/inventory?status=OUT_OF_STOCK" />
      <KpiCard label="Not tracked" tone="neutral" icon={<PackageX />} loading={!summary} value={summary ? formatCount(summary.untracked) : null}
        hint="Products without a stock record (cannot be sold)" to="/admin/inventory?status=UNTRACKED" />
    </section>
    <FilterBand search={list.search} onSearch={list.setSearch} placeholder="Search by product or SKU" searchLabel="Search inventory"
      chips={[{ value: undefined, label: 'All' }, { value: 'IN_STOCK', label: 'In stock', count: summary?.inStock },
        { value: 'LOW_STOCK', label: 'Low stock', count: summary?.lowStock }, { value: 'OUT_OF_STOCK', label: 'Out of stock', count: summary?.outOfStock },
        { value: 'UNTRACKED', label: 'Not tracked', count: summary?.untracked }]}
      active={list.filters.status} onChip={value => list.setFilter('status', value)} onReset={list.reset} resetDisabled={!list.isFiltered} />
    {query.isError && <QueryProblem error={query.error} hasData={Boolean(query.data)} onRetry={() => void query.refetch()} retrying={query.isFetching} what="Inventory" />}
    <div>
      <TableCard busy={query.isFetching} label="Inventory">
        <DataTable caption="Inventory" data={query.data?.data ?? []} columns={columns} keyExtractor={row => row.productId} sort={list.sort} onSortChange={list.setSort}
          loadingRows={query.isPending ? 8 : undefined}
          emptyMessage={<ListEmpty failed={query.isError && !query.data}>{list.isFiltered ? <EmptyRows title="No products match these filters" hint="Try a different search or reset the filters." />
            : <EmptyRows title="No products to stock yet" hint="Products appear here as soon as they are created." />}</ListEmpty>} />
      </TableCard>
      <Pager meta={query.data?.meta} onPage={list.setPage} disabled={query.isFetching} label="Inventory pages" />
    </div>
    {adjusting && <AdjustDialog key={adjusting.productId} row={adjusting} onClose={() => setAdjusting(null)} />}
  </div>;
}
