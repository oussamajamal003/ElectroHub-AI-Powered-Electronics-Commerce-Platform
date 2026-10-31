import type { ReactNode } from 'react';
import { AlertTriangle, Calendar, Hourglass, MapPin, PackageCheck, XCircle, type LucideIcon } from 'lucide-react';
import styles from '../Delivery.module.scss';

const NOTICES: Record<string, { icon: LucideIcon; title: string; text: string; tone?: 'error' }> = {
  paymentPending: { icon: Hourglass, title: 'Tracking isn’t available yet',
    text: 'We are finalizing your order and confirming your payment. Please do not pay again. Tracking appears after confirmation.' },
  notStarted: { icon: PackageCheck, title: 'Tracking hasn’t started',
    text: 'Detailed tracking begins once your order is being prepared. We will show each step as it is recorded.' },
  cancelled: { icon: XCircle, title: 'This order was cancelled', text: 'There is nothing left to deliver. Any recorded delivery history is kept below.', tone: 'error' },
  failed: { icon: AlertTriangle, title: 'Tracking could not be loaded', text: 'Your order is safe. Please try again.', tone: 'error' },
  noEta: { icon: Calendar, title: 'No estimate yet', text: 'We will show an arrival estimate once one is recorded. The checkout window still applies.' },
  noLocation: { icon: MapPin, title: 'No location yet', text: 'Location appears once your order is out for delivery.' },
};
export type DeliveryNoticeKind = keyof typeof NOTICES;

/** One visual language for every non-normal state (handoff §9.3): icon tile, title, text, optional actions. */
export function DeliveryStateNotice({ kind, actions, inline = false, headingLevel = 2, role }: {
  kind: DeliveryNoticeKind; actions?: ReactNode; inline?: boolean; headingLevel?: 2 | 3; role?: 'alert' | 'status' }) {
  const notice = NOTICES[kind]!;
  const Icon = notice.icon;
  const Heading = inline ? 'h3' : (`h${headingLevel}` as const);
  return <section className={[styles.notice, notice.tone === 'error' && styles.noticeError, inline && styles.noticeInline].filter(Boolean).join(' ')} role={role}>
    <span className={styles.noticeIcon}><Icon aria-hidden="true" /></span>
    <div><Heading>{notice.title}</Heading><p>{notice.text}</p>{actions && <div className={styles.noticeActions}>{actions}</div>}</div>
  </section>;
}
