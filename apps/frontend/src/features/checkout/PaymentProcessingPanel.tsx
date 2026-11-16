import type { ReactNode } from 'react';
import { CreditCard, Fingerprint, LockKeyhole, Package, Radio, ShieldCheck } from 'lucide-react';
import { BrandLogo } from '@/components/ui/BrandLogo';
import styles from './PaymentProcessingPanel.module.scss';

/** Presentation only. The caller supplies the actual browser/server phase; no timers advance it. */
export function PaymentProcessingPanel({ phase, headingId, heading, children, actions }: {
  phase: 'confirming' | 'verifying' | 'unconfirmed';
  headingId: string;
  heading: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  const confirming = phase === 'confirming';
  const unknown = phase === 'unconfirmed';
  return <section className={styles.panel} aria-labelledby={headingId} data-state={phase}>
    <div className={styles.visual} aria-hidden="true" data-testid="payment-processing-visual">
      <div className={styles.visualGrid} />
      <span className={styles.orbit} /><span className={styles.innerOrbit} />
      <div className={styles.paymentCard}>
        <span className={styles.cardHeader}><CreditCard size={22} /><LockKeyhole size={16} /></span>
        <Fingerprint className={styles.fingerprint} size={48} strokeWidth={1.25} />
        <span className={styles.cardLines}><i /><i /><i /><i /></span>
      </div>
      <span className={styles.secureSeal}><ShieldCheck size={26} /></span>
      <span className={styles.signal}><Radio size={19} /></span>
      <span className={styles.visualCaption}>SECURE CHECKOUT</span>
    </div>
    <div className={styles.content}>
      <div className={styles.brand}><BrandLogo /><span>CHECKOUT</span></div>
      <div className={styles.statusBadge}><span />{confirming ? 'Card confirmation in progress' : unknown ? 'Awaiting a confirmed result' : 'Payment verification in progress'}</div>
      <div role="status" aria-live="polite" aria-atomic="true" className={styles.copy}>
        <h1 id={headingId}>{heading}</h1>
        {children}
      </div>
      {/* These are a process outline, not a percentage or a claim that previous stages completed. */}
      <ol className={styles.stages} aria-label="Payment processing stages">
        <li aria-current={confirming ? 'step' : undefined}>
          <span className={styles.stageIcon}><CreditCard size={18} aria-hidden="true" /></span>
          <span><strong>Secure submission</strong><small>{confirming ? 'Confirming your card' : 'Payment attempt saved'}</small></span>
        </li>
        <li aria-current={!confirming ? 'step' : undefined}>
          <span className={styles.stageIcon}><ShieldCheck size={18} aria-hidden="true" /></span>
          <span><strong>Provider verification</strong><small>{confirming ? 'Awaiting card confirmation' : unknown ? 'Result not yet confirmed' : 'Checking the payment result'}</small></span>
        </li>
        <li>
          <span className={styles.stageIcon}><Package size={18} aria-hidden="true" /></span>
          <span><strong>Order confirmation</strong><small>Only after payment is verified</small></span>
        </li>
      </ol>
      <p className={styles.security}><LockKeyhole size={15} aria-hidden="true" />Card details are handled securely by Stripe.</p>
      {actions && <div className={styles.actions}>{actions}</div>}
    </div>
  </section>;
}
