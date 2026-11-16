import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminDeliverySnapshot, DeliverySimulationStatus } from '@/features/delivery/types';

const hook = vi.hoisted(() => ({ status: { data: undefined as { data: unknown } | undefined, isPending: false }, start: { mutate: vi.fn(), error: null, isPending: false }, stop: { mutate: vi.fn(), error: null, isPending: false } }));
vi.mock('@/features/delivery/queries', () => ({ useDeliverySimulation: () => hook }));

import { AdminDeliverySimulationPanel } from './AdminDeliverySimulationPanel';

const snapshot = { orderReference: 'ORD-AAAA', status: 'OUT_FOR_DELIVERY' } as AdminDeliverySnapshot;
const status = (patch: Partial<DeliverySimulationStatus>): { data: DeliverySimulationStatus } => ({ data: { enabled: true, reason: null, running: false, routeId: null, ticks: 0, maxTicks: 240, tickSeconds: 5,
  routes: [{ id: 'demo-hub-north', label: 'North loop', points: 10 }], ...patch } });

describe('AdminDeliverySimulationPanel', () => {
  beforeEach(() => { hook.start.mutate.mockReset(); hook.status.data = status({}); });

  it('requires an explicit development-only confirmation before Start writes anything', async () => {
    render(<AdminDeliverySimulationPanel snapshot={snapshot} />);
    await userEvent.click(screen.getByRole('button', { name: 'Start simulation' }));
    expect(hook.start.mutate).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/replace this order’s customer-visible courier position with fictional movement\. Available only in development\./)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(hook.start.mutate).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Start simulation' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirm and start' }));
    expect(hook.start.mutate).toHaveBeenCalledWith('demo-hub-north', expect.anything());
  });

  it.each([['PAYMENT_INELIGIBLE', /confirmed successful payment/], ['NOT_OUT_FOR_DELIVERY', /only while the order is out for delivery/], ['FEATURE_DISABLED', /never in production/]] as const)(
    'explains the specific reason (%s) instead of a generic QA-only message', (reason, text) => {
      hook.status.data = status({ enabled: false, reason });
      render(<AdminDeliverySimulationPanel snapshot={snapshot} />);
      expect(screen.getByRole('status').textContent).toMatch(text);
      expect(screen.queryByRole('button', { name: 'Start simulation' })).toBeNull();
    });

  it('keeps Stop available while running', () => {
    hook.status.data = status({ running: true, routeId: 'demo-hub-north', ticks: 2 });
    render(<AdminDeliverySimulationPanel snapshot={snapshot} />);
    expect(screen.getByRole('button', { name: 'Stop simulation' })).toBeTruthy();
  });
});
