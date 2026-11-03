import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Eye, EyeOff, FolderTree, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { useAdminCategories, useCategoryMutations, type AdminCategory } from '@/features/admin/categories/api';
import { ActivePill, ConfirmDialog, EmptyRows, ListEmpty, FilterBand, KpiCard, PageHeader, Pager, QueryProblem, TableCard, useAdminToast } from '@/features/admin/shared/AdminUi';
import { useListParams } from '@/features/admin/shared/useListParams';
import { errorCode, errorMessage, fieldErrors } from '@/features/admin/shared/api';
import { formatCount, formatDate } from '@/features/admin/shared/format';
import uiStyles from '@/features/admin/shared/AdminUi.module.scss';
import styles from '@/features/admin/shared/AdminPages.module.scss';

const FILTERS = { status: ['ACTIVE', 'INACTIVE'] } as const;
const SORT_KEYS = ['name', 'createdAt', 'products'] as const;
const DEFAULT_SORT = { key: 'name', order: 'asc' } as const;

type Editing = { mode: 'create' } | { mode: 'edit'; category: AdminCategory };

function CategoryDialog({ editing, onClose }: { editing: Editing | null; onClose: () => void }) {
  const { create, update } = useCategoryMutations();
  const toast = useAdminToast();
  const current = editing?.mode === 'edit' ? editing.category : null;
  const [name, setName] = useState(current?.name ?? '');
  const [description, setDescription] = useState(current?.description ?? '');
  const [localError, setLocalError] = useState<string | null>(null);
  const mutation = current ? update : create;
  const errors = fieldErrors(mutation.error);
  const conflictCode = errorCode(mutation.error);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim().length < 2) { setLocalError('Enter a category name (at least 2 characters).'); return; }
    setLocalError(null);
    const body = { name: name.trim(), description: description.trim() || null };
    if (current) update.mutate({ id: current.id, ...body, expectedUpdatedAt: current.updatedAt }, { onSuccess: () => { toast('Category saved.'); onClose(); } });
    else create.mutate(body, { onSuccess: response => { toast(`${response.data.name} was created as a hidden category.`); onClose(); } });
  };

  return <Dialog open={Boolean(editing)} onOpenChange={open => { if (!open && !mutation.isPending) onClose(); }}>
    <DialogContent className={uiStyles.dialog}>
      <DialogTitle className={uiStyles.dialogTitle}>{current ? 'Edit category' : 'Add category'}</DialogTitle>
      <DialogDescription className={uiStyles.dialogBody}>
        {current ? <>The URL slug <span className={styles.mono}>{current.slug}</span> stays the same so existing links keep working.</>
          : 'New categories start hidden so you can add products before customers see them.'}
      </DialogDescription>
      <form className={styles.form} onSubmit={submit} noValidate>
        <Input label="Name" required placeholder="e.g. Gaming Laptops" value={name} maxLength={100} autoFocus fullWidth onChange={event => setName(event.target.value)}
          error={localError ?? errors.name ?? (conflictCode === 'CATEGORY_NAME_TAKEN' || conflictCode === 'CATEGORY_SLUG_TAKEN' ? errorMessage(mutation.error) : undefined)} />
        <Textarea label="Description" placeholder="Short summary shown on the category page" value={description} maxLength={1000} rows={3} fullWidth helperText={`${description.length}/1000`}
          error={errors.description} onChange={event => setDescription(event.target.value)} />
        {mutation.isError && !errors.name && !conflictCode?.endsWith('_TAKEN') && <p className={uiStyles.dialogError} role="alert">{errorMessage(mutation.error)}</p>}
        <div className={uiStyles.dialogActions}>
          <Button type="button" variant="outline" onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
          <Button type="submit" isLoading={mutation.isPending}>{current ? 'Save changes' : 'Add category'}</Button>
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}

export function AdminCategoriesPage() {
  const list = useListParams({ filters: FILTERS, sortKeys: SORT_KEYS, defaultSort: DEFAULT_SORT });
  const query = useAdminCategories({ q: list.q, page: list.page, status: list.filters.status, sort: list.sort.key, order: list.sort.order });
  const { status, remove } = useCategoryMutations();
  const toast = useAdminToast();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [toggling, setToggling] = useState<AdminCategory | null>(null);
  const [deleting, setDeleting] = useState<AdminCategory | null>(null);
  const summary = query.data?.meta.summary;

  const columns: Column<AdminCategory>[] = [
    { key: 'name', title: 'Category', sortKey: 'name', render: row => <span className={styles.cellMain}>
      <span className={`${styles.thumb} ${styles.thumbEmpty}`} aria-hidden="true"><FolderTree /></span>
      <span className={styles.cellText}><strong>{row.name}</strong><span>{row.description || row.slug}</span></span>
    </span> },
    { key: 'slug', title: 'Slug', render: row => <span className={styles.mono}>{row.slug}</span> },
    { key: 'products', title: 'Products', sortKey: 'products', align: 'right', render: row => row.productCount
      ? <Link className={styles.rowLink} to={`/admin/products?categoryId=${row.id}`}>{formatCount(row.productCount)}</Link> : <span className={styles.muted}>0</span> },
    { key: 'status', title: 'Storefront', render: row => <ActivePill active={row.isActive} activeLabel="Visible" inactiveLabel="Hidden" /> },
    { key: 'created', title: 'Created', sortKey: 'createdAt', render: row => <span className={styles.muted}>{formatDate(row.createdAt)}</span> },
    { key: 'actions', title: 'Actions', align: 'right', render: row => <span className={styles.rowActions}>
      <button type="button" className={styles.iconAction} aria-label={`Edit ${row.name}`} title="Edit" onClick={() => setEditing({ mode: 'edit', category: row })}>
        <Pencil aria-hidden="true" /></button>
      <button type="button" className={styles.iconAction} aria-label={row.isActive ? `Hide ${row.name}` : `Show ${row.name}`} title={row.isActive ? 'Hide' : 'Show'}
        onClick={() => { status.reset(); setToggling(row); }}>{row.isActive ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}</button>
      <button type="button" className={`${styles.iconAction} ${styles.iconActionDanger}`} aria-label={`Delete ${row.name}`}
        title={row.productCount ? 'Only empty categories can be deleted' : 'Delete'} disabled={row.productCount > 0}
        onClick={() => { remove.reset(); setDeleting(row); }}><Trash2 aria-hidden="true" /></button>
    </span> },
  ];

  return <div className={styles.page}>
    <PageHeader title="Categories" crumbs={[{ label: 'Dashboard', to: '/admin' }, { label: 'Categories' }]}
      description="Group products for storefront browsing. Hiding a category hides every product inside it."
      actions={<Button type="button" onClick={() => setEditing({ mode: 'create' })}><Plus aria-hidden="true" size={16} /> Add category</Button>} />
    <section className={`${styles.kpiGrid} ${styles.kpiGrid3}`} aria-label="Category summary">
      <KpiCard label="Total categories" centered loading={!summary} value={summary ? formatCount(summary.active + summary.inactive) : null} />
      <KpiCard label="Visible" tone="success" centered loading={!summary} value={summary ? formatCount(summary.active) : null} />
      <KpiCard label="Hidden" tone="warning" centered loading={!summary} value={summary ? formatCount(summary.inactive) : null} />
    </section>
    <FilterBand search={list.search} onSearch={list.setSearch} placeholder="Search categories" searchLabel="Search categories"
      chips={[{ value: undefined, label: 'All' }, { value: 'ACTIVE', label: 'Visible', count: summary?.active }, { value: 'INACTIVE', label: 'Hidden', count: summary?.inactive }]}
      active={list.filters.status} onChip={value => list.setFilter('status', value)} onReset={list.reset} resetDisabled={!list.isFiltered} />
    {query.isError && <QueryProblem error={query.error} hasData={Boolean(query.data)} onRetry={() => void query.refetch()} retrying={query.isFetching} what="Categories" />}
    <div>
      <TableCard busy={query.isPlaceholderData} label="Categories">
        <DataTable caption="Categories" data={query.data?.data ?? []} columns={columns} keyExtractor={row => row.id} sort={list.sort} onSortChange={list.setSort}
          loadingRows={query.isPending ? 6 : undefined}
          emptyMessage={<ListEmpty failed={query.isError && !query.data}>{list.isFiltered ? <EmptyRows title="No categories match these filters" hint="Try a different search or reset the filters." />
            : <EmptyRows title="No categories yet" hint="Add a category to start organizing the catalog." />}</ListEmpty>} />
      </TableCard>
      <Pager meta={query.data?.meta} onPage={list.setPage} disabled={query.isPlaceholderData} label="Category pages" />
    </div>

    {editing && <CategoryDialog key={editing.mode === 'edit' ? editing.category.id : 'new'} editing={editing} onClose={() => setEditing(null)} />}

    <ConfirmDialog open={Boolean(toggling)} onOpenChange={open => { if (!open) setToggling(null); }} pending={status.isPending}
      title={toggling?.isActive ? 'Hide category?' : 'Show category?'} confirmLabel={toggling?.isActive ? 'Hide category' : 'Show category'} destructive={toggling?.isActive}
      error={status.isError ? errorMessage(status.error) : null}
      onConfirm={() => toggling && status.mutate({ id: toggling.id, isActive: !toggling.isActive, expectedUpdatedAt: toggling.updatedAt }, {
        onSuccess: () => { toast(toggling.isActive ? `${toggling.name} is hidden.` : `${toggling.name} is visible.`); setToggling(null); },
        onError: error => { if (errorCode(error) === 'CATEGORY_CONFLICT') void query.refetch(); },
      })}
      description={toggling && (toggling.isActive
        ? <p><strong>{toggling.name}</strong> and its {formatCount(toggling.productCount)} products will disappear from the storefront. Products are not archived and come back when the category is shown again.</p>
        : <p><strong>{toggling.name}</strong> will appear on the storefront with its active products.</p>)} />

    <ConfirmDialog open={Boolean(deleting)} onOpenChange={open => { if (!open) setDeleting(null); }} pending={remove.isPending}
      title="Delete category?" confirmLabel="Delete category" destructive error={remove.isError ? errorMessage(remove.error) : null}
      onConfirm={() => deleting && remove.mutate(deleting.id, { onSuccess: () => { toast(`${deleting.name} was deleted.`); setDeleting(null); } })}
      description={deleting && <p><strong>{deleting.name}</strong> has no products and will be permanently deleted. This cannot be undone.</p>} />
  </div>;
}
