import type { Confirmation } from '@/features/checkout/types';
import { CommerceEmailNotice } from './CommerceEmailNotice';
import { useEmailNoticeWindow } from './emailNoticeWindow';

type NoticeOrder = Pick<Confirmation, 'orderReference' | 'createdAt' | 'paymentState' | 'status' | 'emailConfirmation'>;

/**
 * The initial-email notice with its 60-second lifetime. Renders nothing (no wrapper, no spacing) outside the window, for another owner,
 * for an unpaid/cancelled order, or without an owner (signed out).
 */
export function TransientEmailNotice({ ownerId, order }: { ownerId: string; order: NoticeOrder }) {
  const eligible = order.paymentState === 'PAID' && order.status !== 'CANCELLED';
  const visible = useEmailNoticeWindow({ ownerId, orderReference: order.orderReference, createdAt: order.createdAt, eligible });
  if (!visible) return null;
  return <CommerceEmailNotice paymentState={order.paymentState} orderStatus={order.status} emailConfirmation={order.emailConfirmation} />;
}
