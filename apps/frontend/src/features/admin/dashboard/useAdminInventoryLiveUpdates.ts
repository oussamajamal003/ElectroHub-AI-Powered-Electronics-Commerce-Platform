import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAdminAuth } from '@/features/auth/context/AuthContext';
import { acquireDeliverySocket, releaseDeliverySocket } from '@/features/delivery/realtime/deliverySocket';
import { adminKeys } from '../shared/api';

/**
 * The server event is an MFA-assured administrator-only invalidation hint. React Query remains the only client store: every event,
 * reconnect and foreground transition re-reads the normal REST projections instead of accepting client-side stock counts.
 */
export function useAdminInventoryLiveUpdates() {
  const client = useQueryClient();
  const { user, isSessionVerified, isLoggingOut } = useAdminAuth();
  const userId = user?.id ?? '';

  useEffect(() => {
    if (!userId || !isSessionVerified || isLoggingOut) return;
    const socket = acquireDeliverySocket(userId);
    let disposed = false;
    const refresh = () => {
      if (disposed) return;
      for (const key of [adminKeys.alerts, adminKeys.inventory, ['admin', 'dashboard'] as const]) {
        void client.invalidateQueries({ queryKey: key });
      }
    };
    const onConnect = () => refresh();
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    socket.on('connect', onConnect);
    socket.on('admin:inventory-changed', refresh);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisible);
    if (socket.connected) refresh();
    return () => {
      disposed = true;
      socket.off('connect', onConnect);
      socket.off('admin:inventory-changed', refresh);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVisible);
      releaseDeliverySocket(socket);
    };
  }, [client, isLoggingOut, isSessionVerified, userId]);
}
