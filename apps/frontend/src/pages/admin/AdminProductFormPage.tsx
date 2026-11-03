import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Image as ImageIcon, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { ElectroHubLoader } from '@/components/ui/ElectroHubLoader/ElectroHubLoader';
import {
  useAdminProduct, useCatalogOptions, useCreateProduct, useUpdateProduct, type AdminProduct, type ProductFields, type ProductStatus,
} from '@/features/admin/products/api';
import { ActivePill, ButtonLink, PageHeader, QueryProblem, StockPill, useAdminToast } from '@/features/admin/shared/AdminUi';
import { errorCode, errorMessage, fieldErrors } from '@/features/admin/shared/api';
import { formatCount, formatDateTime } from '@/features/admin/shared/format';
import styles from '@/features/admin/shared/AdminPages.module.scss';

const MAX_SPECS = 60;
const MONEY = /^\d{1,10}(\.\d{1,2})?$/;

interface SpecDraft { key: number; group: string; name: string; value: string }
interface Draft {
  name: string; sku: string; description: string; modelNumber: string; categoryId: string; brandId: string; price: string; compareAtPrice: string;
  specifications: SpecDraft[]; status: ProductStatus; quantity: string; lowStockAt: string;
}

let specKey = 0;
const nextKey = () => ++specKey;
const emptyDraft = (): Draft => ({ name: '', sku: '', description: '', modelNumber: '', categoryId: '', brandId: '', price: '', compareAtPrice: '',
  specifications: [], status: 'INACTIVE', quantity: '0', lowStockAt: '5' });
const fromProduct = (product: AdminProduct): Draft => ({
  name: product.name, sku: product.sku, description: product.description ?? '', modelNumber: product.modelNumber ?? '', categoryId: product.category.id,
  brandId: product.brand?.id ?? '', price: product.price, compareAtPrice: product.compareAtPrice ?? '',
  specifications: product.specifications.map(spec => ({ key: nextKey(), group: spec.group, name: spec.name, value: spec.value })),
  status: product.status, quantity: String(product.inventory?.quantity ?? 0), lowStockAt: String(product.inventory?.lowStockAt ?? 5),
});

/** Comparable form state: specification row keys are UI identity only and never count as a change. */
const snapshot = (draft: Draft) => JSON.stringify({ ...draft, specifications: draft.specifications.map(spec => [spec.group, spec.name, spec.value]) });

/** Client checks mirror the server schema for fast feedback; the server remains authoritative and its field errors are shown too. */
function validate(draft: Draft, creating: boolean) {
  const errors: Record<string, string> = {};
  if (draft.name.trim().length < 2) errors.name = 'Enter a product name (at least 2 characters).';
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{1,99}$/.test(draft.sku.trim())) errors.sku = 'Use 2–100 letters, numbers, dots, dashes or underscores.';
  if (!draft.categoryId) errors.categoryId = 'Choose a category.';
  if (!MONEY.test(draft.price.trim()) || Number(draft.price) <= 0) errors.price = 'Enter a price greater than zero, with up to 2 decimals.';
  if (draft.compareAtPrice.trim()) {
    if (!MONEY.test(draft.compareAtPrice.trim())) errors.compareAtPrice = 'Enter an amount with up to 2 decimals.';
    else if (!errors.price && Number(draft.compareAtPrice) <= Number(draft.price)) errors.compareAtPrice = 'The original price must be higher than the price.';
  }
  if (creating) {
    if (!/^\d{1,7}$/.test(draft.quantity)) errors['inventory.quantity'] = 'Enter a whole number of units.';
    if (!/^\d{1,6}$/.test(draft.lowStockAt) || Number(draft.lowStockAt) > 100_000) errors['inventory.lowStockAt'] = 'Enter a whole number up to 100,000.';
  }
  draft.specifications.forEach((spec, index) => {
    if (!spec.group.trim() || !spec.name.trim() || !spec.value.trim()) errors[`specifications.${index}`] = 'Fill in group, name and value, or remove this row.';
  });
  return errors;
}

function toFields(draft: Draft): ProductFields {
  return {
    name: draft.name.trim(), sku: draft.sku.trim(), description: draft.description.trim() || null, modelNumber: draft.modelNumber.trim() || null,
    categoryId: draft.categoryId, brandId: draft.brandId || null, price: draft.price.trim(), compareAtPrice: draft.compareAtPrice.trim() || null,
    specifications: draft.specifications.map(({ group, name, value }) => ({ group: group.trim(), name: name.trim(), value: value.trim() })),
  };
}

export function AdminProductFormPage() {
  const { productId } = useParams();
  const creating = !productId;
  const product = useAdminProduct(productId);
  if (!creating && product.isPending) return <div className={styles.page}><ElectroHubLoader /></div>;
  if (!creating && !product.data) {
    const notFound = (product.error as { status?: number } | null)?.status === 404;
    return <div className={styles.page}>
      <PageHeader title={notFound ? 'Product not found' : 'Product unavailable'} crumbs={[{ label: 'Dashboard', to: '/admin' }, { label: 'Products', to: '/admin/products' }, { label: 'Edit' }]} />
      {notFound ? <div className={styles.notFound}><p>This product does not exist or is a protected test fixture.</p><ButtonLink to="/admin/products" variant="outline">Back to products</ButtonLink></div>
        : <QueryProblem error={product.error} hasData={false} onRetry={() => void product.refetch()} retrying={product.isFetching} what="The product" />}
    </div>;
  }
  // Remount the form when a newer version is loaded after a conflict so the draft is rebuilt from server truth.
  return <ProductForm key={product.data?.data.updatedAt ?? 'new'} product={product.data?.data} onReload={() => void product.refetch()} />;
}

function ProductForm({ product, onReload }: { product?: AdminProduct; onReload: () => void }) {
  const creating = !product;
  const navigate = useNavigate();
  const toast = useAdminToast();
  const options = useCatalogOptions();
  const initial = useMemo(() => product ? fromProduct(product) : emptyDraft(), [product]);
  const [draft, setDraft] = useState<Draft>(initial);
  const [touched, setTouched] = useState(false);
  const create = useCreateProduct();
  const update = useUpdateProduct(product?.id ?? '');
  const mutation = creating ? create : update;
  const dirty = snapshot(draft) !== snapshot(initial);

  useEffect(() => {
    if (!dirty || mutation.isSuccess) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, mutation.isSuccess]);

  const clientErrors = touched ? validate(draft, creating) : {};
  const errors = { ...fieldErrors(mutation.error), ...clientErrors };
  const conflict = errorCode(mutation.error) === 'PRODUCT_CONFLICT';
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft(current => ({ ...current, [key]: value }));
  const setSpec = (key: number, field: 'group' | 'name' | 'value', value: string) =>
    set('specifications', draft.specifications.map(spec => spec.key === key ? { ...spec, [field]: value } : spec));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    const found = validate(draft, creating);
    if (Object.keys(found).length) {
      window.requestAnimationFrame(() => document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    if (creating) {
      create.mutate({ ...toFields(draft), status: draft.status, inventory: { quantity: Number(draft.quantity), lowStockAt: Number(draft.lowStockAt) } }, {
        onSuccess: response => { toast(`${response.data.name} was created.`); navigate(`/admin/products/${response.data.id}/edit`, { replace: true }); },
      });
    } else {
      update.mutate({ ...toFields(draft), expectedUpdatedAt: product.updatedAt }, { onSuccess: () => toast('Product changes saved.') });
    }
  };

  const categoryOptions = (options.data?.data.categories ?? []).map(category => ({
    value: category.id, label: category.isActive ? category.name : `${category.name} (hidden)`,
    // A hidden category cannot receive new or moved products; the current one stays selectable.
    disabled: !category.isActive && category.id !== product?.category.id,
  }));
  const brandOptions = [{ value: 'NONE', label: 'No brand' }, ...(options.data?.data.brands ?? []).map(brand => ({ value: brand.id, label: brand.name }))];
  const title = creating ? 'Add product' : product.name;

  return <div className={styles.page}>
    <PageHeader title={title} crumbs={[{ label: 'Dashboard', to: '/admin' }, { label: 'Products', to: '/admin/products' }, { label: creating ? 'Add product' : 'Edit' }]}
      description={creating ? 'New products start as drafts (not on the storefront) unless you publish them now.'
        : <>Slug <span className={styles.mono}>{product.slug}</span> · updated {formatDateTime(product.updatedAt)}</>}
      actions={!creating && <ButtonLink to={`/admin/products/${product.id}/media`} variant="outline"><ImageIcon aria-hidden="true" /> Manage media ({product.imageCount})</ButtonLink>} />

    {options.isError && <QueryProblem error={options.error} hasData={false} onRetry={() => void options.refetch()} retrying={options.isFetching} what="Categories and brands" />}

    <form className={styles.form} onSubmit={submit} noValidate aria-label={creating ? 'New product' : `Edit ${product.name}`}>
      {mutation.isError && !Object.keys(fieldErrors(mutation.error)).length && <div className={styles.formError} role="alert">
        {errorMessage(mutation.error)}
        {conflict && <> <Button type="button" variant="outline" size="small" onClick={onReload}>Load latest version</Button></>}
      </div>}

      <div className={styles.split}>
        <div className={styles.stack}>
          <section className={styles.panel} aria-labelledby="details-title">
            <h2 id="details-title" className={styles.panelTitle}>Details</h2>
            <div className={styles.fieldGrid}>
              <Input className={styles.fieldFull} label="Product name" required value={draft.name} maxLength={255} error={errors.name}
                onChange={event => set('name', event.target.value)} fullWidth />
              <Input label="SKU" required value={draft.sku} maxLength={100} error={errors.sku} helperText="Stored in upper case. Must be unique."
                onChange={event => set('sku', event.target.value)} fullWidth autoCapitalize="characters" spellCheck={false} />
              <Input label="Model number" value={draft.modelNumber} maxLength={100} error={errors.modelNumber}
                onChange={event => set('modelNumber', event.target.value)} fullWidth />
              <Textarea className={styles.fieldFull} label="Description" value={draft.description} maxLength={5000} rows={5} error={errors.description}
                helperText={`${draft.description.length}/5000`} onChange={event => set('description', event.target.value)} fullWidth />
            </div>
          </section>

          <section className={styles.panel} aria-labelledby="specs-title">
            <div className={styles.panelHeader}>
              <h2 id="specs-title" className={styles.panelTitle}>Specifications</h2>
              <Button type="button" variant="outline" size="small" disabled={draft.specifications.length >= MAX_SPECS}
                onClick={() => set('specifications', [...draft.specifications, { key: nextKey(), group: draft.specifications.at(-1)?.group ?? 'General', name: '', value: '' }])}>
                <Plus aria-hidden="true" size={16} /> Add specification
              </Button>
            </div>
            {draft.specifications.length === 0 ? <p className={styles.panelHint}>No specifications yet. They appear in the storefront product details.</p>
              : draft.specifications.map((spec, index) => <fieldset key={spec.key} className={styles.specRow}>
                <legend className={styles.visuallyHidden}>Specification {index + 1}</legend>
                <Input label="Group" value={spec.group} maxLength={100} onChange={event => setSpec(spec.key, 'group', event.target.value)} fullWidth
                  error={errors[`specifications.${index}.group`] ?? (errors[`specifications.${index}`] && !spec.group.trim() ? 'Required' : undefined)} />
                <Input label="Name" value={spec.name} maxLength={100} onChange={event => setSpec(spec.key, 'name', event.target.value)} fullWidth
                  error={errors[`specifications.${index}.name`] ?? (errors[`specifications.${index}`] && !spec.name.trim() ? 'Required' : undefined)} />
                <Input label="Value" value={spec.value} maxLength={1000} onChange={event => setSpec(spec.key, 'value', event.target.value)} fullWidth
                  error={errors[`specifications.${index}.value`] ?? (errors[`specifications.${index}`] && !spec.value.trim() ? 'Required' : undefined)} />
                <button type="button" className={`${styles.iconAction} ${styles.iconActionDanger}`} aria-label={`Remove specification ${index + 1}`}
                  onClick={() => set('specifications', draft.specifications.filter(item => item.key !== spec.key))}><Trash2 aria-hidden="true" /></button>
              </fieldset>)}
            {draft.specifications.length >= MAX_SPECS && <p className={styles.fieldHelp}>A product can have up to {MAX_SPECS} specifications.</p>}
          </section>
        </div>

        <div className={styles.stack}>
          <section className={styles.panel} aria-labelledby="organization-title">
            <h2 id="organization-title" className={styles.panelTitle}>Organization</h2>
            <Select label="Category" required options={categoryOptions} value={draft.categoryId || undefined} placeholder="Choose a category"
              onValueChange={value => set('categoryId', value)} error={errors.categoryId} fullWidth square />
            <Select label="Brand" options={brandOptions} value={draft.brandId || 'NONE'} onValueChange={value => set('brandId', value === 'NONE' ? '' : value)}
              error={errors.brandId} fullWidth square />
            {creating ? <div className={styles.field} role="group" aria-labelledby="publish-label">
              <span id="publish-label" className={styles.fieldLabel}>Storefront</span>
              <div className={styles.segmented}>
                <button type="button" className={styles.segment} aria-pressed={draft.status === 'INACTIVE'} onClick={() => set('status', 'INACTIVE')}>Save as draft</button>
                <button type="button" className={styles.segment} aria-pressed={draft.status === 'ACTIVE'} onClick={() => set('status', 'ACTIVE')}>Publish now</button>
              </div>
            </div> : <dl className={styles.details}>
              <dt>Status</dt><dd><ActivePill active={product.status === 'ACTIVE'} inactiveLabel="Archived" /></dd>
              <dt>Storefront</dt><dd>{product.storefrontVisible ? 'Visible' : 'Hidden'}</dd>
              <dt>On orders</dt><dd>{formatCount(product.orderLineCount)} order lines</dd>
            </dl>}
          </section>

          <section className={styles.panel} aria-labelledby="pricing-title">
            <h2 id="pricing-title" className={styles.panelTitle}>Pricing (USD)</h2>
            <Input label="Price" required inputMode="decimal" value={draft.price} error={errors.price} onChange={event => set('price', event.target.value)} fullWidth />
            <Input label="Original price" inputMode="decimal" value={draft.compareAtPrice} error={errors.compareAtPrice}
              helperText="Optional. Shown struck through when higher than the price." onChange={event => set('compareAtPrice', event.target.value)} fullWidth />
          </section>

          <section className={styles.panel} aria-labelledby="stock-title">
            <h2 id="stock-title" className={styles.panelTitle}>Inventory</h2>
            {creating ? <>
              <Input label="Starting stock" inputMode="numeric" value={draft.quantity} error={errors['inventory.quantity']}
                onChange={event => set('quantity', event.target.value)} fullWidth />
              <Input label="Low-stock alert at" inputMode="numeric" value={draft.lowStockAt} error={errors['inventory.lowStockAt']}
                onChange={event => set('lowStockAt', event.target.value)} fullWidth />
            </> : <>
              <dl className={styles.details}>
                <dt>On hand</dt><dd>{product.inventory ? formatCount(product.inventory.quantity) : 'Not tracked'}</dd>
                <dt>Status</dt><dd><StockPill status={product.inventory?.status ?? null} /></dd>
              </dl>
              <p className={styles.fieldHelp}>Stock changes are recorded through the inventory screen so concurrent edits cannot overwrite each other.</p>
              <Link className={styles.panelLink} to={`/admin/inventory?q=${encodeURIComponent(product.sku)}`}>Adjust stock</Link>
            </>}
          </section>
        </div>
      </div>

      <div className={styles.formActions}>
        <ButtonLink to="/admin/products" variant="outline">{dirty ? 'Discard' : 'Back to products'}</ButtonLink>
        <Button type="submit" isLoading={mutation.isPending} disabled={!creating && !dirty}>{creating ? 'Create product' : 'Save changes'}</Button>
      </div>
    </form>
  </div>;
}
