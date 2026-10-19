import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Clock3, Info, Mail, MailCheck } from 'lucide-react';
import type { Confirmation, EmailConfirmationSummary } from '@/features/checkout/types';
import styles from './CommerceEmailNotice.module.scss';

const EMAIL_STATES = ['QUEUED', 'DELAYED', 'SENT', 'DELIVERED', 'PARTIAL', 'UNAVAILABLE'] as const;
type EmailState = (typeof EMAIL_STATES)[number];
/** 'NONE' = no projection (historical order or email disabled). */
type NoticeKey = EmailState | 'NONE';

interface NoticeCopy { icon: ReactNode; title: string; text: string }

const COPY: Record<NoticeKey, NoticeCopy> = {
  QUEUED: { icon: <Mail />, title: 'Email confirmations', text: 'Your order and payment confirmations are queued. You can view your order details now.' },
  DELAYED: { icon: <Clock3 />, title: 'Email confirmations', text: 'Your confirmation emails are taking a little longer. Your order and payment are confirmed.' },
  SENT: { icon: <MailCheck />, title: 'Email confirmations', text: 'Your order and payment confirmations have been sent. Check your inbox or spam folder.' },
  DELIVERED: { icon: <MailCheck />, title: 'Email confirmations', text: 'Your order and payment confirmation emails were delivered.' },
  PARTIAL: { icon: <Info />, title: 'Email confirmations', text: 'Some confirmation emails are still pending or could not be confirmed. Your purchase is confirmed.' },
  UNAVAILABLE: { icon: <Info />, title: 'Email confirmations', text: 'Your purchase is confirmed. We couldn’t confirm email delivery. Your order details are available here.' },
  NONE: { icon: <Info />, title: 'Order details', text: 'Your order details are saved here for reference.' },
};

function isEmailState(value: string): value is EmailState {
  return EMAIL_STATES.some(state => state === value);
}

/** Unknown future states are presented like UNAVAILABLE: a calm, truthful "could not confirm" message. */
function noticeKey(emailConfirmation: EmailConfirmationSummary | null | undefined): NoticeKey {
  if (!emailConfirmation) return 'NONE';
  return isEmailState(emailConfirmation.state) ? emailConfirmation.state : 'UNAVAILABLE';
}

export interface CommerceEmailNoticeProps {
  paymentState: Confirmation['paymentState'];
  orderStatus: string;
  emailConfirmation?: EmailConfirmationSummary | null;
  className?: string;
}

/**
 * Compact, truthful notice about the initial order/payment emails. Shown only for a PAID, non-cancelled order.
 * Static text on first render; a polite live announcement only when the email state changes after mount.
 */
export function CommerceEmailNotice({ paymentState, orderStatus, emailConfirmation, className }: CommerceEmailNoticeProps) {
  const visible = paymentState === 'PAID' && orderStatus !== 'CANCELLED';
  const key = noticeKey(emailConfirmation);
  const previousKey = useRef<NoticeKey | null>(null);
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    if (!visible) { previousKey.current = null; return; }
    const previous = previousKey.current;
    previousKey.current = key;
    // First render of the notice never announces; a projection that disappears is not an email event.
    if (previous === null || previous === key || key === 'NONE') return;
    const copy = COPY[key];
    setAnnouncement(`${copy.title}. ${copy.text}`);
  }, [visible, key]);

  if (!visible) return null;
  const copy = COPY[key];
  return <div className={[styles.root, className].filter(Boolean).join(' ')} data-email-state={key.toLowerCase()}>
    <div className={styles.notice}>
      <span className={styles.icon} aria-hidden="true">{copy.icon}</span>
      <div className={styles.body}>
        <h2 className={styles.title}>{copy.title}</h2>
        <p className={styles.text}>{copy.text}</p>
      </div>
    </div>
    <div role="status" aria-live="polite" className={styles.srOnly}>{announcement && <span>{announcement}</span>}</div>
  </div>;
}
