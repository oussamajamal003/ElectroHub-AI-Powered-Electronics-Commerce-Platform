import { Fragment } from 'react';
import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import styles from './Orders.module.scss';

/** Last item is the current page; earlier items are real, supported destinations. */
export function OrdersBreadcrumb({ items }: { items: { label: string; to?: string }[] }) {
  return <nav className={styles.breadcrumb} aria-label="Breadcrumb"><ol>
    {items.map((item, index) => <Fragment key={item.label}>
      <li>{item.to ? <Link to={item.to}>{item.label}</Link> : <span aria-current="page">{item.label}</span>}</li>
      {index < items.length - 1 && <li aria-hidden="true"><ChevronRight /></li>}
    </Fragment>)}
  </ol></nav>;
}
