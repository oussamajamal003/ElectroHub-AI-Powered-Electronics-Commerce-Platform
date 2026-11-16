import type { ProductDetail } from '@/features/products/types';
import styles from './ProductSpecifications.module.scss';

export function ProductSpecifications({ groups }: { groups: ProductDetail['specifications'] }) {
  if (groups.length === 0) return <p>No specifications are available.</p>;
  return <div className={styles.groups}>{groups.map(group => <section key={group.group}>
    <h3>{group.group}</h3>
    <dl className={styles.list}>{group.items.map(item => <div key={item.id}><dt>{item.name}</dt><dd>{item.value}</dd></div>)}</dl>
  </section>)}</div>;
}
