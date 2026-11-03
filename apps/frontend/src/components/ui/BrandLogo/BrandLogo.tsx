import clsx from 'clsx';
import { Zap } from 'lucide-react';
import styles from './BrandLogo.module.scss';

/**
 * The ElectroHub logo (blue Zap mark + "Electro" in blue, "Hub" in ink with an accent rule), shared by the storefront header, the
 * admin header and the admin sign-in so they cannot drift apart. Decorative: the surrounding link or heading carries the accessible name.
 */
export function BrandLogo({ className, size = 'medium' }: { className?: string; size?: 'medium' | 'large' }) {
  return <span className={clsx(styles.logo, styles[size], className)} aria-hidden="true">
    <span className={styles.mark} data-brand-mark><Zap className={styles.zap} /></span>
    <span className={styles.text}>Electro<span className={styles.hub}>Hub</span></span>
  </span>;
}
