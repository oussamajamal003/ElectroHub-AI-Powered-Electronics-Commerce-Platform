import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, PackageSearch } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Alert } from '@/components/ui/Alert';
import { ElectroHubLoader } from '@/components/ui/ElectroHubLoader/ElectroHubLoader';
import { useAdminMediaProducts } from '@/features/adminMedia/queries';
import styles from './AdminProductsPage.module.scss';

const PAGE_SIZE = 30;
const SEARCH_DELAY_MS = 250;

export function AdminProductsPage() {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [search]);
  const products = useAdminMediaProducts(debouncedSearch, page, PAGE_SIZE);
  const productList = products.data?.data ?? [];
  const pageInfo = products.data?.meta;
  const currentPage = pageInfo?.page ?? page;
  const totalPages = pageInfo?.totalPages ?? 1;
  const total = pageInfo?.total;
  const start = productList.length === 0 ? 0 : (currentPage - 1) * (pageInfo?.pageSize ?? PAGE_SIZE) + 1;
  const end = productList.length === 0 ? 0 : start + productList.length - 1;

  useEffect(() => {
    if (pageInfo && page > Math.max(pageInfo.totalPages, 1)) setPage(Math.max(pageInfo.totalPages, 1));
  }, [page, pageInfo]);

  return <section className={styles.page}>
    <header className={styles.header}>
      <div><p className={styles.eyebrow}>CATALOG</p><h1>Product media</h1><p>Choose a product to manage its published photographs and search indexing.</p></div>
      {!products.isPending && <span className={styles.count} aria-live="polite">{total === undefined
        ? `${productList.length} products on this page`
        : `Showing ${start}–${end} of ${total} products`}</span>}
    </header>
    <Input label="Find a product" placeholder="Search by name or SKU" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} fullWidth />
    {products.isError && <Alert variant="error"><span>{products.data
      ? 'The catalog could not be refreshed. The last loaded products are still available.'
      : 'Products could not be loaded. Check your connection and try again.'}</span>{' '}
      <Button type="button" variant="outline" size="small" disabled={products.isFetching || search.trim() !== debouncedSearch} onClick={() => void products.refetch()}>Retry</Button>
    </Alert>}
    {(search.trim() !== debouncedSearch || products.isFetching) && <p className={styles.updateStatus} role="status" aria-live="polite">
      {search.trim() !== debouncedSearch ? 'Updating search…' : products.isPending ? 'Loading products…' : 'Refreshing products…'}
    </p>}
    {products.isPending ? <div className={styles.loading}><ElectroHubLoader /></div> : productList.length ?
      <ul className={styles.list}>{productList.map(product => <li key={product.id}>
        <div className={styles.productIcon}><PackageSearch aria-hidden="true" /></div>
        <div className={styles.productInfo}><strong>{product.name}</strong><span>{product.slug}</span></div>
        <Link className={styles.manageLink} to={`/admin/products/${encodeURIComponent(product.id)}/media`} aria-label={`Manage media for ${product.name}`}>Manage media <ArrowRight size={16} aria-hidden="true" /></Link>
      </li>)}</ul> : !products.isError && <p className={styles.state}>{debouncedSearch ? 'No products match this search.' : 'No products are available yet.'}</p>}
    {!products.isPending && totalPages > 1 && <nav className={styles.pagination} aria-label="Product result pages">
      <Button type="button" variant="outline" size="small" disabled={page <= 1 || products.isFetching || search.trim() !== debouncedSearch} onClick={() => setPage(value => Math.max(1, value - 1))}>Previous</Button>
      <span aria-live="polite">Page {pageInfo?.page ?? page} of {totalPages}</span>
      <Button type="button" variant="outline" size="small" disabled={page >= totalPages || products.isFetching || search.trim() !== debouncedSearch} onClick={() => setPage(value => value + 1)}>Next</Button>
    </nav>}
  </section>;
}
