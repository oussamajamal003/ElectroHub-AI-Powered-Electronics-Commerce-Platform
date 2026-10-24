import type { ReactNode } from 'react';
import styles from './Discovery.module.scss';

interface Props { tone?: 'neutral' | 'visual' | 'error'; icon: ReactNode; title: string; description: string; action?: ReactNode }

/** Empty, unavailable and error panel; every one names a next action. */
export function DiscoveryState({ tone = 'neutral', icon, title, description, action }: Props) {
  return <div className={`${styles.state} ${styles[`state-${tone}`] ?? ''}`} role={tone === 'error' ? 'alert' : undefined}>
    <span className={styles.stateGlyph} aria-hidden="true">{icon}</span>
    <h3 className={styles.stateTitle}>{title}</h3>
    <p className={styles.stateText}>{description}</p>
    {action && <div className={styles.stateActions}>{action}</div>}
  </div>;
}
