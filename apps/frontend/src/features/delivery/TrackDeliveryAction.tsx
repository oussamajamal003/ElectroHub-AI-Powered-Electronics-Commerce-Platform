import { Link } from 'react-router-dom';
import { Truck } from 'lucide-react';
import shared from '@/features/orders/Orders.module.scss';
import { canTrackDelivery } from './presentation';

/** Navigation, not an action: a React Router link styled as the shared primary link. */
export function TrackDeliveryAction({ orderReference, status, paymentState, className }: {
  orderReference: string; status: string; paymentState: string; className?: string }) {
  if (!canTrackDelivery(status, paymentState)) return null;
  return <Link className={[shared.primaryLink, className].filter(Boolean).join(' ')} to={`/orders/${encodeURIComponent(orderReference)}/tracking`}>
    <Truck size={18} aria-hidden="true" />{status === 'DELIVERED' ? 'View delivery details' : 'Track delivery'}
  </Link>;
}
