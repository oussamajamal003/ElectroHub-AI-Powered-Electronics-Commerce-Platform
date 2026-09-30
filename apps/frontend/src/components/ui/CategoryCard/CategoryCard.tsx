import { Link } from 'react-router-dom';
import type { Category } from '@/features/products/types';
import styles from './CategoryCard.module.scss';

export function CategoryCard({ category }: { category: Category }) {
  return <Link to={`/products?category=${encodeURIComponent(category.slug)}`} className={styles.card}>
    {category.imageUrl && <img src={category.imageUrl} alt="" loading="lazy" />}
    <span>{category.name}</span>
    <small>{category.productCount} products</small>
  </Link>;
}
