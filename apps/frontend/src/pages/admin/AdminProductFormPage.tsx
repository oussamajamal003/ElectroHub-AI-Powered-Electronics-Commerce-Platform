import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Archive, Image as ImageIcon, Plus, Send, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { SearchSelect, type SearchSelectOption } from '@/components/ui/SearchSelect';
import { Skeleton } from '@/components/ui/Skeleton';
import { Textarea } from '@/components/ui/Textarea';
import {
  useAdminProduct, useCatalogOptions, useCreateProduct, useDeleteProduct, useProductStatus, useUpdateProduct, type AdminProduct, type CatalogOptions,
  type ProductFields, type ProductStatus,
} from '@/features/admin/products/api';
import { ActivePill, ButtonLink, ConfirmDialog, PageHeader, QueryProblem, StockPill, useAdminToast } from '@/features/admin/shared/AdminUi';
import { errorCode, errorMessage, fieldErrors } from '@/features/admin/shared/api';
import { formatCount, formatDateTime } from '@/features/admin/shared/format';
import { useUnsavedChangesGuard } from '@/features/admin/shared/useUnsavedChangesGuard';
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
  if (!MONEY.test(draft.price.trim()) || Number(draft.price) <= 0) errors.price = 'Enter a price greater than zero, for example 98 or 98.50.';
  if (draft.compareAtPrice.trim()) {
    if (!MONEY.test(draft.compareAtPrice.trim())) errors.compareAtPrice = 'Enter an amount, for example 120 or 119.99.';
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

/** The API stores money as "12.30": whole or one-decimal amounts typed by the admin ("98", "12.3") are sent with two decimals. */
const money = (value: string) => Number(value.trim()).toFixed(2);

function toFields(draft: Draft): ProductFields {
  return {
    name: draft.name.trim(), sku: draft.sku.trim(), description: draft.description.trim() || null, modelNumber: draft.modelNumber.trim() || null,
    categoryId: draft.categoryId, brandId: draft.brandId || null, price: money(draft.price), compareAtPrice: draft.compareAtPrice.trim() ? money(draft.compareAtPrice) : null,
    specifications: draft.specifications.map(({ group, name, value }) => ({ group: group.trim(), name: name.trim(), value: value.trim() })),
  };
}

const products = (count: number) => `${formatCount(count)} product${count === 1 ? '' : 's'}`;

/**
 * Category and brand choices ranked by how the live catalog combines them (`pairs`). Ranking only: any active category may be combined with
 * any brand, so a new brand or a first product in a category is never blocked. Hidden categories stay listed but cannot be newly assigned.
 */
function rankedChoices(catalog: CatalogOptions | undefined, draft: { categoryId: string; brandId: string }, currentCategoryId?: string) {
  const pairs = new Map((catalog?.pairs ?? []).map(pair => [`${pair.categoryId}:${pair.brandId}`, pair.products]));
  const brandName = catalog?.brands.find(brand => brand.id === draft.brandId)?.name;
  const categoryName = catalog?.categories.find(category => category.id === draft.categoryId)?.name;

  const categoryCount = (categoryId: string) => draft.brandId ? pairs.get(`${categoryId}:${draft.brandId}`) ?? 0 : 0;
  const brandCount = (brandId: string) => draft.categoryId ? pairs.get(`${draft.categoryId}:${brandId}`) ?? 0 : 0;

  const categories: SearchSelectOption[] = (catalog?.categories ?? []).map(category => ({
    value: category.id, label: category.isActive ? category.name : `${category.name} (hidden)`,
    disabled: !category.isActive && category.id !== currentCategoryId,
  }));
  const usedCategories = categories.filter(option => !option.disabled && categoryCount(option.value) > 0)
    .sort((a, b) => categoryCount(b.value) - categoryCount(a.value));
  const otherCategories = categories.filter(option => !usedCategories.includes(option)).sort((a, b) => Number(a.disabled) - Number(b.disabled));
  const categoryOptions: SearchSelectOption[] = usedCategories.length
    ? [...usedCategories.map(option => ({ ...option, group: `Used with ${brandName}`, hint: products(categoryCount(option.value)) })),
      ...otherCategories.map(option => ({ ...option, group: 'All categories' }))]
    : otherCategories;

  const brands: SearchSelectOption[] = (catalog?.brands ?? []).map(brand => ({ value: brand.id, label: brand.name }));
  const usedBrands = brands.filter(option => brandCount(option.value) > 0).sort((a, b) => brandCount(b.value) - brandCount(a.value));
  const otherBrands = brands.filter(option => !usedBrands.includes(option));
  const brandOptions: SearchSelectOption[] = [{ value: 'NONE', label: 'No brand' }, ...(usedBrands.length
    ? [...usedBrands.map(option => ({ ...option, group: `Common in ${categoryName}`, hint: products(brandCount(option.value)) })),
      ...otherBrands.map(option => ({ ...option, group: 'All brands' }))]
    : otherBrands)];

  /** Active categories that already hold products of this brand. */
  const categoriesFor = (brandId: string) => (catalog?.categories ?? []).filter(category => category.isActive && pairs.has(`${category.id}:${brandId}`));
  return { categoryOptions, brandOptions, categoriesFor };
}

/** Mirrors the form while the product loads, so nothing editable appears before its data does. */
function ProductFormSkeleton({ label = 'Loading product…' }: { label?: string }) {
  const field = (key: number) => <div key={key} className={styles.skeletonField}><Skeleton width="7rem" height="0.875rem" /><Skeleton height="2.75rem" /></div>;
  const panel = (key: number, fields: number) => <section key={key} className={styles.panel}>
    <Skeleton width="9rem" height="1.25rem" />{Array.from({ length: fields }, (_, index) => field(index))}
  </section>;
  return <div className={styles.page} aria-busy="true">
    <span role="status" className={styles.visuallyHidden}>{label}</span>
    <div className={styles.skeletonHeader}><Skeleton width="14rem" height="0.875rem" /><Skeleton width="min(26rem, 80%)" height="2.5rem" />
      <Skeleton width="min(20rem, 60%)" height="0.875rem" /></div>
    <div className={styles.split}>
      <div className={styles.stack}>{panel(1, 4)}{panel(2, 1)}</div>
      <div className={styles.stack}>{panel(3, 3)}{panel(4, 2)}{panel(5, 2)}</div>
    </div>
  </div>;
}

export function AdminProductFormPage() {
  const { productId } = useParams();
  const creating = !productId;
  const product = useAdminProduct(productId);
  // Same skeleton for Add and Edit: the form appears once its categories/brands (and, when editing, the product) have loaded.
  const options = useCatalogOptions();
  if (creating && options.isPending) return <ProductFormSkeleton label="Loading the product form…" />;
  if (!creating && product.isPending) return <ProductFormSkeleton />;
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
  const statusChange = useProductStatus();
  const remove = useDeleteProduct();
  const [lifecycle, setLifecycle] = useState<'status' | 'delete' | null>(null);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const mutation = creating ? create : update;
  const dirty = snapshot(draft) !== snapshot(initial);
  const catalog = options.data?.data;
  const { categoryOptions, brandOptions, categoriesFor } = rankedChoices(catalog, draft, product?.category.id);

  // A created product moves to its edit page; an edit stays guarded after each save (the saved product becomes the new baseline).
  const guard = useUnsavedChangesGuard(dirty && !create.isSuccess);

  const clientErrors = touched ? validate(draft, creating) : {};
  const errors = { ...fieldErrors(mutation.error), ...clientErrors };
  const conflict = errorCode(mutation.error) === 'PRODUCT_CONFLICT';
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft(current => ({ ...current, [key]: value }));
  const chooseCategory = (categoryId: string) => { set('categoryId', categoryId); setSuggestion(null); };
  // A brand chosen first fills an empty category only when exactly one active category already holds that brand's products, and says so.
  const chooseBrand = (value: string) => {
    const brandId = value === 'NONE' ? '' : value;
    const only = brandId && !draft.categoryId ? categoriesFor(brandId) : [];
    if (only.length === 1) {
      setDraft(current => ({ ...current, brandId, categoryId: only[0]!.id }));
      setSuggestion(`Set to ${only[0]!.name}, the only category with ${catalog?.brands.find(brand => brand.id === brandId)?.name} products. You can change it.`);
    } else set('brandId', brandId);
  };
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
        onSuccess: response => {
          toast(response.data.status === 'ACTIVE' ? `${response.data.name} was published.` : `${response.data.name} was saved as a draft.`);
          guard.leave(() => navigate(`/admin/products/${response.data.id}/edit`, { replace: true }));
        },
      });
    } else {
      update.mutate({ ...toFields(draft), expectedUpdatedAt: product.updatedAt }, { onSuccess: () => toast('Product changes saved.') });
    }
  };

  const title = creating ? 'Add product' : product.name;
  const nextStatus: ProductStatus = product?.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
  const changeStatus = () => {
    if (!product) return;
    statusChange.mutate({ id: product.id, status: nextStatus, expectedUpdatedAt: product.updatedAt }, {
      onSuccess: response => { setLifecycle(null); toast(nextStatus === 'ACTIVE' ? `${response.data.name} was published.` : `${response.data.name} was unpublished.`); },
      onError: error => { if (errorCode(error) === 'PRODUCT_CONFLICT') onReload(); },
    });
  };
  const deleteProduct = () => {
    if (!product) return;
    remove.mutate(product.id, {
      onSuccess: () => { setLifecycle(null); toast(`${product.name} was deleted.`); navigate('/admin/products', { replace: true }); },
      onError: error => { if (errorCode(error) === 'PRODUCT_IN_USE') onReload(); },
    });
  };

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
              <Input className={styles.fieldFull} label="Product name" required placeholder="e.g. Sony WH-1000XM5 Wireless Headphones" value={draft.name} maxLength={255} error={errors.name}
                onChange={event => set('name', event.target.value)} fullWidth />
              <Input label="SKU" required placeholder="e.g. SONY-WH1000XM5-BLK" value={draft.sku} maxLength={100} error={errors.sku} helperText="Stored in upper case. Must be unique."
                onChange={event => set('sku', event.target.value)} fullWidth autoCapitalize="characters" spellCheck={false} />
              <Input label="Model number" placeholder="e.g. WH-1000XM5" value={draft.modelNumber} maxLength={100} error={errors.modelNumber}
                onChange={event => set('modelNumber', event.target.value)} fullWidth />
              <Textarea className={styles.fieldFull} label="Description" value={draft.description} placeholder="Key features, what is in the box, compatibility…" maxLength={5000} rows={5} error={errors.description}
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
                <Input label="Group" placeholder="e.g. Display" value={spec.group} maxLength={100} onChange={event => setSpec(spec.key, 'group', event.target.value)} fullWidth
                  error={errors[`specifications.${index}.group`] ?? (errors[`specifications.${index}`] && !spec.group.trim() ? 'Required' : undefined)} />
                <Input label="Name" value={spec.name} placeholder="e.g. Screen size" maxLength={100} onChange={event => setSpec(spec.key, 'name', event.target.value)} fullWidth
                  error={errors[`specifications.${index}.name`] ?? (errors[`specifications.${index}`] && !spec.name.trim() ? 'Required' : undefined)} />
                <Input label="Value" placeholder="e.g. 6.1 in" value={spec.value} maxLength={1000} onChange={event => setSpec(spec.key, 'value', event.target.value)} fullWidth
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
            <SearchSelect label="Category" required options={categoryOptions} value={draft.categoryId || undefined} onValueChange={chooseCategory}
              placeholder={catalog ? 'Choose a category' : 'Loading categories…'} searchPlaceholder="Search categories" disabled={!catalog}
              error={errors.categoryId} helperText={suggestion} fullWidth />
            <SearchSelect label="Brand" options={brandOptions} value={draft.brandId || 'NONE'} onValueChange={chooseBrand}
              placeholder={catalog ? 'No brand' : 'Loading brands…'} searchPlaceholder="Search brands" disabled={!catalog} error={errors.brandId} fullWidth />
            {creating ? <div className={styles.field} role="radiogroup" aria-labelledby="publish-label">
              <span id="publish-label" className={styles.fieldLabel}>Storefront</span>
              <div className={styles.segmented}>
                {([['INACTIVE', 'Save as draft'], ['ACTIVE', 'Publish now']] as const).map(([value, text]) =>
                  <button key={value} type="button" role="radio" aria-checked={draft.status === value} tabIndex={draft.status === value ? 0 : -1}
                    className={styles.segment} onClick={() => set('status', value)}
                    onKeyDown={event => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
                      event.preventDefault(); const other = value === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'; set('status', other);
                      (event.currentTarget.parentElement?.querySelector(`[data-status="${other}"]`) as HTMLElement | null)?.focus(); } }}
                    data-status={value}>{text}</button>)}
              </div>
              <p className={styles.fieldHelp}>{draft.status === 'ACTIVE'
                ? 'Customers can find and buy it as soon as it is created.' : 'Hidden from customers until you publish it.'}</p>
            </div> : <>
              <dl className={styles.details}>
                <dt>Status</dt><dd><ActivePill active={product.status === 'ACTIVE'} activeLabel="Published" inactiveLabel="Unpublished" /></dd>
                <dt>Storefront</dt><dd>{product.storefrontVisible ? 'Visible' : product.status === 'ACTIVE' ? 'Hidden (category is hidden)' : 'Hidden'}</dd>
                <dt>On orders</dt><dd>{formatCount(product.orderLineCount)} order lines</dd>
              </dl>
              <div className={styles.actionsStart}>
                <Button type="button" variant="outline" size="small" disabled={dirty} onClick={() => { statusChange.reset(); setLifecycle('status'); }}>
                  {product.status === 'ACTIVE' ? <><Archive aria-hidden="true" size={16} /> Unpublish</> : <><Send aria-hidden="true" size={16} /> Publish</>}
                </Button>
              </div>
              {dirty && <p className={styles.fieldHelp}>Save or discard your edits before publishing, unpublishing or deleting.</p>}
            </>}
          </section>

          <section className={styles.panel} aria-labelledby="pricing-title">
            <h2 id="pricing-title" className={styles.panelTitle}>Pricing (USD)</h2>
            <Input label="Price" required placeholder="e.g. 349.99" inputMode="decimal" value={draft.price} error={errors.price} onChange={event => set('price', event.target.value)} fullWidth />
            <Input label="Original price" placeholder="e.g. 399.99" inputMode="decimal" value={draft.compareAtPrice} error={errors.compareAtPrice}
              helperText="Optional. Shown struck through when higher than the price." onChange={event => set('compareAtPrice', event.target.value)} fullWidth />
          </section>

          <section className={styles.panel} aria-labelledby="stock-title">
            <h2 id="stock-title" className={styles.panelTitle}>Inventory</h2>
            {creating ? <>
              <Input label="Starting stock" placeholder="e.g. 25" inputMode="numeric" value={draft.quantity} error={errors['inventory.quantity']}
                onChange={event => set('quantity', event.target.value)} fullWidth />
              <Input label="Low-stock alert at" inputMode="numeric" value={draft.lowStockAt} placeholder="e.g. 5" error={errors['inventory.lowStockAt']}
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

          {!creating && <section className={styles.panel} aria-labelledby="delete-title">
            <h2 id="delete-title" className={styles.panelTitle}>Delete product</h2>
            <p className={styles.fieldHelp}>{product.deletable
              ? 'Nothing references this product yet (no orders, carts, reviews, photos or activity), so it can be removed permanently.'
              : `Permanent deletion is not available. ${product.deleteBlocker ?? ''}`}</p>
            <div className={styles.actionsStart}>
              <Button type="button" variant="destructive" size="small" disabled={!product.deletable || dirty} onClick={() => { remove.reset(); setLifecycle('delete'); }}>
                <Trash2 aria-hidden="true" size={16} /> Delete permanently
              </Button>
            </div>
          </section>}
        </div>
      </div>

      <div className={styles.formActions}>
        <ButtonLink to="/admin/products" variant="outline">{dirty ? 'Discard' : 'Back to products'}</ButtonLink>
        <Button type="submit" isLoading={mutation.isPending} disabled={!catalog || (!creating && !dirty)}>
          {creating ? draft.status === 'ACTIVE' ? 'Create and publish' : 'Create draft' : 'Save changes'}</Button>
      </div>
    </form>
    <ConfirmDialog {...guard.dialog} destructive title="Leave without saving?" confirmLabel="Leave page"
      description={<p>Your changes to this product have not been saved and will be lost.</p>} />
    {product && <ConfirmDialog open={lifecycle === 'status'} onOpenChange={open => { if (!open) setLifecycle(null); }} pending={statusChange.isPending}
      title={nextStatus === 'ACTIVE' ? 'Publish product?' : 'Unpublish product?'} confirmLabel={nextStatus === 'ACTIVE' ? 'Publish' : 'Unpublish'}
      destructive={nextStatus === 'INACTIVE'} error={statusChange.isError ? errorMessage(statusChange.error) : null} onConfirm={changeStatus}
      description={nextStatus === 'ACTIVE'
        ? product.category.isActive ? <p><strong>{product.name}</strong> will appear on the storefront and can be added to carts.</p>
          : <p>Its category <strong>{product.category.name}</strong> is hidden. Make the category visible first; the server refuses to publish into a hidden category.</p>
        : <><p><strong>{product.name}</strong> will leave the storefront and cannot be added to new carts.</p><p>Past orders keep their item details.</p></>} />}
    {product && <ConfirmDialog open={lifecycle === 'delete'} onOpenChange={open => { if (!open) setLifecycle(null); }} pending={remove.isPending} destructive
      title={`Delete ${product.name}?`} confirmLabel="Delete permanently" error={remove.isError ? errorMessage(remove.error) : null} onConfirm={deleteProduct}
      description={<><p>SKU <span className={styles.mono}>{product.sku}</span>. The product, its stock record and its specifications are removed.</p>
        <p>This cannot be undone. The server checks again that nothing references it before deleting.</p></>} />}
  </div>;
}
