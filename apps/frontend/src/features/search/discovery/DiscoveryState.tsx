import type { ReactNode } from 'react';
import styles from './Discovery.module.scss';

interface Props { tone?: 'neutral' | 'visual' | 'error'; icon: ReactNode; title: string; description: string; details?: ReactNode; action?: ReactNode; announce?: boolean; compact?: boolean }

/** Empty, unavailable and error panel; every one names a next action. */
export function DiscoveryState({ tone = 'neutral', icon, title, description, details, action, announce = true, compact = false }: Props) {
  return <div className={`${styles.state} ${styles[`state-${tone}`] ?? ''} ${compact ? styles.stateCompact : ''}`} role={tone === 'error' && announce ? 'alert' : undefined}>
    <span className={styles.stateGlyph} aria-hidden="true">{icon}</span>
    <h3 className={styles.stateTitle}>{title}</h3>
    <p className={styles.stateText}>{description}</p>
    {details}
    {action && <div className={styles.stateActions}>{action}</div>}
  </div>;
}
