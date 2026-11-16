import { Zap } from 'lucide-react';
import styles from './ElectroHubLoader.module.scss';

interface Props { size?: 'sm' | 'md' | 'lg'; page?: boolean }

export function ElectroHubLoader({ size = 'md', page = false }: Props) {
  return <div className={`${styles.root} ${styles[size]} ${page ? styles.page : ''}`} role="status" aria-live="polite">
    <span className={styles.mark} aria-hidden="true"><Zap fill="currentColor" /></span>
    <span className={styles.srOnly}>Loading page…</span>
  </div>;
}
