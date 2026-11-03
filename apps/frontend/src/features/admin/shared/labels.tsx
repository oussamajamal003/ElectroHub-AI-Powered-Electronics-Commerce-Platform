import { StatusPill } from './AdminUi';
import { orderStatusLabel, orderStatusTone, paymentLabel, paymentTone } from './statusLabels';

export const OrderStatusPill = ({ status }: { status: string }) =>
  <StatusPill tone={orderStatusTone[status] ?? 'neutral'} icon={false}>{orderStatusLabel[status] ?? status}</StatusPill>;
export const PaymentPill = ({ state }: { state: string }) =>
  <StatusPill tone={paymentTone[state] ?? 'neutral'}>{paymentLabel[state] ?? state}</StatusPill>;
