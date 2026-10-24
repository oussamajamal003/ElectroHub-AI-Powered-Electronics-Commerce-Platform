import { Camera, ImageIcon, LayoutGrid } from 'lucide-react';
import { useCategories } from '../queries';
import styles from './Discovery.module.scss';

interface Props { onNavigate: (href: string) => void; onImage: (camera: boolean) => void }

/** The console's resting state: real entry points and the live category list — never invented trending items. */
export function DiscoveryQuickActions({ onNavigate, onImage }: Props) {
  const categories = useCategories(true);
  const list = (categories.data ?? []).filter(category => category.productCount !== 0);
  return <div className={styles.quick}>
    <p className={styles.sectionLabel}>Start here</p>
    <div className={styles.actions}>
      <button type="button" className={`${styles.action} ${styles.actionVisual}`} onClick={() => onImage(false)}>
        <span className={styles.glyph} aria-hidden="true"><ImageIcon size={18} /></span>
        <span className={styles.copy}><span className={styles.title}>Upload a photo</span><span className={styles.meta}>Find products that look alike</span></span>
      </button>
      <button type="button" className={`${styles.action} ${styles.actionVisual}`} onClick={() => onImage(true)}>
        <span className={styles.glyph} aria-hidden="true"><Camera size={18} /></span>
        <span className={styles.copy}><span className={styles.title}>Use camera</span><span className={styles.meta}>Snap the product you want</span></span>
      </button>
      <button type="button" className={styles.action} onClick={() => onNavigate('/products')}>
        <span className={styles.glyph} aria-hidden="true"><LayoutGrid size={18} /></span>
        <span className={styles.copy}><span className={styles.title}>Browse all products</span><span className={styles.meta}>Filters, brands and prices</span></span>
      </button>
    </div>
    <p className={styles.sectionLabel} id="discovery-categories">Shop by category</p>
    {categories.isPending && <div className={styles.chips} aria-hidden="true">{[0, 1, 2, 3, 4, 5].map(chip => <span key={chip} className={styles.chipSkeleton} />)}</div>}
    {categories.isError && <p className={styles.inlineNote}>Categories are unavailable right now. You can still search by name.</p>}
    {list.length > 0 && <ul className={styles.chips} aria-labelledby="discovery-categories">
      {list.map(category => <li key={category.id}>
        <button type="button" className={styles.chip} onClick={() => onNavigate(`/products?${new URLSearchParams({ category: category.slug })}`)}>
          {category.name}<span className={styles.chipCount}>{category.productCount}</span>
        </button>
      </li>)}
    </ul>}
  </div>;
}
