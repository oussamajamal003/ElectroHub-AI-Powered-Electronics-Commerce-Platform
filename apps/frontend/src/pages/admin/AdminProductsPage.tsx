import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, PackageSearch } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { Alert } from '@/components/ui/Alert';
import { useAdminMediaProducts } from '@/features/adminMedia/queries';
import styles from './AdminProductsPage.module.scss';

export function AdminProductsPage() {
  const [search, setSearch] = useState('');
  const products = useAdminMediaProducts(search);
  return <section className={styles.page}>
    <header className={styles.header}>
      <div><p className={styles.eyebrow}>CATALOG</p><h1>Product media</h1><p>Choose a product to manage its published photographs and search indexing.</p></div>
      <span className={styles.count}>{products.data?.data.length ?? 0} shown</span>
    </header>
    <Input label="Find a product" placeholder="Search by name or SKU" value={search} onChange={event => setSearch(event.target.value)} fullWidth />
    {products.isError && <Alert variant="error">Products could not be loaded. Check your connection and try again.</Alert>}
    {products.isPending ? <p className={styles.state} role="status">Loading products…</p> : products.data?.data.length ?
      <ul className={styles.list}>{products.data.data.map(product => <li key={product.id}>
        <div className={styles.productIcon}><PackageSearch aria-hidden="true" /></div>
        <div className={styles.productInfo}><strong>{product.name}</strong><span>{product.slug}</span></div>
        <Link className={styles.manageLink} to={`/admin/products/${encodeURIComponent(product.id)}/media`} aria-label={`Manage media for ${product.name}`}>Manage media <ArrowRight size={16} aria-hidden="true" /></Link>
      </li>)}</ul> : <p className={styles.state}>{search ? 'No products match this search.' : 'No products are available yet.'}</p>}
  </section>;
}
