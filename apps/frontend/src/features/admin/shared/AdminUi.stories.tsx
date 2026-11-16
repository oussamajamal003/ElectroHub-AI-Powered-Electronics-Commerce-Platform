import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { MemoryRouter } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, DollarSign, XCircle } from 'lucide-react';
import { DataTable, type Column, type DataTableSort } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { ActivePill, AdminToastProvider, ConfirmDialog, EmptyRows, FilterBand, KpiCard, PageHeader, Pager, QueryProblem, StockPill, TableCard } from './AdminUi';
import pageStyles from './AdminPages.module.scss';

/** Task 05.1 admin primitives with deterministic fixture data (no API). */
const meta = {
  title: 'Admin/Primitives',
  decorators: [Story => <MemoryRouter><AdminToastProvider><div style={{ padding: 24, background: '#f8fafc' }}><Story /></div></AdminToastProvider></MemoryRouter>],
  parameters: { layout: 'fullscreen' },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

interface Row { id: string; name: string; sku: string; quantity: number; status: string; active: boolean }
const rows: Row[] = [
  { id: '1', name: 'Studio Monitor Headphones', sku: 'AUD-1001', quantity: 42, status: 'IN_STOCK', active: true },
  { id: '2', name: 'Mechanical Keyboard TKL', sku: 'KEY-2040', quantity: 3, status: 'LOW_STOCK', active: true },
  { id: '3', name: 'USB-C Dock 12-in-1', sku: 'DOC-0912', quantity: 0, status: 'OUT_OF_STOCK', active: false },
];
const columns: Column<Row>[] = [
  { key: 'name', title: 'Product', sortKey: 'name' },
  { key: 'sku', title: 'SKU', render: row => <span className={pageStyles.mono}>{row.sku}</span> },
  { key: 'quantity', title: 'On hand', sortKey: 'quantity', align: 'right' },
  { key: 'stock', title: 'Stock', render: row => <StockPill status={row.status} /> },
  { key: 'status', title: 'Status', render: row => <ActivePill active={row.active} inactiveLabel="Archived" /> },
];

export const Header: Story = {
  render: () => <PageHeader title="Products" crumbs={[{ label: 'Dashboard', to: '/admin' }, { label: 'Products' }]}
    description="Create, edit and archive catalog products." actions={<Button>Add product</Button>} />,
};

export const KpiRow: Story = {
  render: () => <div className={pageStyles.kpiGrid}>
    <KpiCard label="Paid revenue" tone="success" icon={<DollarSign />} value="$12,480.00" hint="38 successful payments" />
    <KpiCard label="Low stock" tone="warning" icon={<AlertTriangle />} value="4" to="/admin/inventory" />
    <KpiCard label="Out of stock" tone="error" icon={<XCircle />} value={null} loading />
    <KpiCard label="In stock" tone="success" icon={<CheckCircle2 />} value={null} hint="Unavailable reads as a dash, never a zero" />
  </div>,
};

export const TableWithFilters: Story = {
  render: function Render() {
    const [search, setSearch] = useState('');
    const [status, setStatus] = useState<string | undefined>();
    const [sort, setSort] = useState<DataTableSort>({ key: 'name', order: 'asc' });
    return <div className={pageStyles.page}>
      <FilterBand search={search} onSearch={setSearch} placeholder="Search by name or SKU" searchLabel="Search products"
        chips={[{ value: undefined, label: 'All', count: 3 }, { value: 'ACTIVE', label: 'Active', count: 2 }, { value: 'INACTIVE', label: 'Archived', count: 1 }]}
        active={status} onChip={setStatus} onReset={() => { setSearch(''); setStatus(undefined); }} resetDisabled={!search && !status} />
      <div>
        <TableCard label="Products"><DataTable caption="Products" data={rows} columns={columns} keyExtractor={row => row.id} sort={sort} onSortChange={setSort} /></TableCard>
        <Pager meta={{ page: 1, pageSize: 20, total: 3, totalPages: 1 }} onPage={() => undefined} label="Pages" />
      </div>
    </div>;
  },
};

export const LoadingAndEmpty: Story = {
  render: () => <div className={pageStyles.page}>
    <TableCard label="Loading"><DataTable caption="Loading" data={[]} columns={columns} keyExtractor={row => row.id} loadingRows={4} /></TableCard>
    <TableCard label="Empty"><DataTable caption="Empty" data={[]} columns={columns} keyExtractor={row => row.id}
      emptyMessage={<EmptyRows title="No products match these filters" hint="Try a different search or reset the filters." />} /></TableCard>
  </div>,
};

export const Errors: Story = {
  render: () => <div className={pageStyles.page}>
    <QueryProblem error={new Error('offline')} hasData={false} onRetry={() => undefined} what="Products" />
    <QueryProblem error={new Error('offline')} hasData onRetry={() => undefined} what="Products" />
  </div>,
};

export const ArchiveConfirmation: Story = {
  render: function Render() {
    const [open, setOpen] = useState(true);
    return <>
      <Button onClick={() => setOpen(true)}>Open dialog</Button>
      <ConfirmDialog open={open} onOpenChange={setOpen} title="Archive product?" confirmLabel="Archive" destructive onConfirm={() => setOpen(false)}
        description={<><p><strong>USB-C Dock 12-in-1</strong> will be removed from the storefront and cannot be added to new carts.</p>
          <p>Past orders keep their item details. You can reactivate it later.</p></>} />
    </>;
  },
};
