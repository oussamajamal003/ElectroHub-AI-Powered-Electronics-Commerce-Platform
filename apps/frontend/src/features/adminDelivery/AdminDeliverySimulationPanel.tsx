import { useState } from 'react';
import { FlaskConical } from 'lucide-react';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { ApiError } from '@/lib/api';
import { useDeliverySimulation } from '@/features/delivery/queries';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/Dialog';
import type { AdminDeliverySnapshot, DeliverySimulationReason } from '@/features/delivery/types';
import styles from './AdminDeliveryUpdatePanel.module.scss';

const UNAVAILABLE: Record<DeliverySimulationReason, string> = {
  FEATURE_DISABLED: 'The demo simulation is turned off in this environment. It is available only in the approved shared development environment, never in production.',
  QA_SCOPE: 'This QA environment runs the demo simulation only for its approved QA deliveries.',
  ORDER_NOT_FOUND: 'This order could not be found.',
  ORDER_CANCELLED: 'This order was cancelled, so its delivery can no longer be simulated.',
  PAYMENT_INELIGIBLE: 'Delivery tracking needs a confirmed successful payment, so this order cannot be simulated.',
  NOT_OUT_FOR_DELIVERY: 'The demo simulation is available only while the order is out for delivery.',
  DELIVERY_NOT_STARTED: 'Start delivery tracking for this order before running the demo simulation.',
};

/**
 * Task 04.7 admin Demo tools (architecture §8.5). Plays an approved fictional route through the same revisioned update path as an admin,
 * one position every 5 s. It only ever moves the courier position: never status, payment or the order. Available only when the server
 * allows it (flag on, non-production, disposable or verified shared-DEV database, trackable order); every customer surface then labels the data "Simulated demo".
 */
export function AdminDeliverySimulationPanel({ snapshot }: { snapshot: AdminDeliverySnapshot }) {
  const { status, start, stop } = useDeliverySimulation(snapshot.orderReference);
  const data = status.data?.data;
  const [routeId, setRouteId] = useState('');
  const chosen = routeId || data?.routes[0]?.id || '';
  const outForDelivery = snapshot.status === 'OUT_FOR_DELIVERY';
  const [confirming, setConfirming] = useState(false);
  const error = start.error ?? stop.error;
  return <section className={styles.panel} aria-labelledby="admin-delivery-demo">
    <h2 id="admin-delivery-demo"><FlaskConical size={18} aria-hidden="true" /> Demo tools</h2>
    <p>Plays a fictional route for demos and QA. Customers see it labelled “Simulated demo”. It never changes status, payment or the order.</p>
    {status.isPending ? <p className={styles.help}>Checking demo availability…</p>
      : !data ? <Alert variant="warning"><span>Demo availability could not be loaded.</span></Alert>
      : !data.enabled ? <p className={styles.help} role="status">{UNAVAILABLE[data.reason ?? 'FEATURE_DISABLED']}</p>
      : <div className={styles.content}>
        {data.running
          ? <p className={styles.help} role="status">Running “{data.routes.find(route => route.id === data.routeId)?.label ?? data.routeId}”: {data.ticks} of at most
            {' '}{data.maxTicks} positions, one every {data.tickSeconds} s.</p>
          : <Select label="Demo route" options={data.routes.map(route => ({ value: route.id, label: `${route.label} · ${route.points} points` }))}
            value={chosen} onValueChange={setRouteId} disabled={!outForDelivery} fullWidth />}
        {!outForDelivery && !data.running && <p className={styles.help}>Available while the order is out for delivery.</p>}
        {error && <Alert variant="error"><span>{error instanceof ApiError ? error.message : 'The demo could not be changed. Try again.'}</span></Alert>}
        <div className={styles.dialogActions}>
          {data.running
            ? <Button type="button" variant="outline" onClick={() => stop.mutate()} isLoading={stop.isPending} disabled={stop.isPending}>Stop simulation</Button>
            : <Button type="button" onClick={() => setConfirming(true)} isLoading={start.isPending} disabled={!outForDelivery || !chosen || start.isPending}>
              Start simulation</Button>}
        </div>
      </div>}
    <Dialog open={confirming} onOpenChange={open => { if (!open && !start.isPending) setConfirming(false); }}>
      <DialogContent>
        <DialogTitle>Start demo simulation?</DialogTitle>
        <DialogDescription>{snapshot.orderReference}</DialogDescription>
        <p>Demo simulation will replace this order’s customer-visible courier position with fictional movement. Available only in development.</p>
        <div className={styles.dialogActions}>
          <Button type="button" variant="outline" onClick={() => setConfirming(false)} disabled={start.isPending}>Cancel</Button>
          <Button type="button" isLoading={start.isPending} disabled={start.isPending || !chosen}
            onClick={() => start.mutate(chosen, { onSettled: () => setConfirming(false) })}>Confirm and start</Button>
        </div>
      </DialogContent>
    </Dialog>
  </section>;
}
