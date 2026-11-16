import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, PackageSearch } from 'lucide-react';
import type { Category } from '@/features/products/types';
import styles from './CategoryCard.module.scss';

export function CategoryCard({ category }: { category: Category }) {
  // A missing or undecodable image falls back to a neutral tile so the grid never shows a broken image.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showImage = Boolean(category.imageUrl) && failedUrl !== category.imageUrl;
  const count = `${category.productCount} ${category.productCount === 1 ? 'product' : 'products'}`;
  return <Link to={`/products?category=${encodeURIComponent(category.slug)}`} className={styles.card}>
    <span className={styles.media}>
      {showImage
        ? <img src={category.imageUrl!} alt="" loading="lazy" decoding="async" onError={() => setFailedUrl(category.imageUrl)} />
        : <PackageSearch className={styles.fallback} aria-hidden="true" data-testid="category-image-fallback" />}
    </span>
    <span className={styles.name}>{category.name}</span>
    <span className={styles.meta}><small>{count}</small><ArrowRight size={14} aria-hidden="true" /></span>
  </Link>;
}
