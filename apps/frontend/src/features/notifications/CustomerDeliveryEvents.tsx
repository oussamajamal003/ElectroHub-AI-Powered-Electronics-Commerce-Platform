import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/context/AuthContext';
import { acquireDeliverySocket, releaseDeliverySocket } from '@/features/delivery/realtime/deliverySocket';
import { queryKeys } from '@/lib/query';
import { binding, clearBrowserPush } from './pushClient';
/** Background query reconciliation survives removal of the header bell. Web Push is independent. */
export default function CustomerDeliveryEvents() {
  const { user, isSessionVerified, isLoggingOut } = useAuth(); const client = useQueryClient();
  const id = user?.role === 'CUSTOMER' && isSessionVerified && !isLoggingOut ? user.id : null;
  useEffect(() => {
    if (!id) return;
    if (binding() && binding()?.userId !== id) void clearBrowserPush();
    const socket = acquireDeliverySocket(id);
    const reconcile = () => { void client.invalidateQueries({ queryKey: ['orders'] }); void client.invalidateQueries({ queryKey: ['delivery'] }); };
    const receive = (value: unknown) => {
      if (!value || typeof value !== 'object' || !('v' in value) || value.v !== 1 || !('type' in value) || value.type !== 'ORDER_OUT_FOR_DELIVERY' || !('orderReference' in value) || typeof value.orderReference !== 'string' || !/^ORD-[0-9A-F-]{36}$/.test(value.orderReference)) return;
      void client.invalidateQueries({ queryKey: queryKeys.orders.detail(id, value.orderReference) });
      void client.invalidateQueries({ queryKey: queryKeys.delivery.snapshot(id, value.orderReference) });
      reconcile();
    };
    socket.on('notification:created', receive); socket.on('connect', reconcile);
    return () => { socket.off('notification:created', receive); socket.off('connect', reconcile); releaseDeliverySocket(socket); };
  }, [id, client]);
  return null;
}
