import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ShippingSettingsForm } from './ShippingSettingsForm';
import type { ShippingView } from '../api';

vi.mock('../api', () => ({ useUpdateShippingSettings: () => ({ isPending: false, mutateAsync: vi.fn() }), isVersionConflict: () => false }));
vi.mock('@/features/admin/shared/AdminUi', () => ({ useAdminToast: () => vi.fn() }));
const view: ShippingView = { version: 1, currency: 'USD', freeShippingThreshold: '50.00', methods: [
  { method: 'STANDARD', label: 'Standard Delivery', price: '5.00', enabled: false, minDays: 5, maxDays: 7, estimate: '5–7 business days' },
  { method: 'EXPRESS', label: 'Express Delivery', price: '9.99', enabled: true, minDays: 2, maxDays: 3, estimate: '2–3 business days' },
  { method: 'OVERNIGHT', label: 'Overnight Delivery', price: '19.99', enabled: false, minDays: 1, maxDays: 1, estimate: 'Next business day' },
] };

describe('shipping toggle explanations', () => {
  it('explains free STANDARD independence and switches regular wording with the free-shipping draft', () => {
    render(<ShippingSettingsForm view={view} onDirtyChange={vi.fn()} onSaved={vi.fn()} onReload={vi.fn()} />);
    expect(screen.getByText('Orders at or above this subtotal qualify for free Standard Delivery, even when the regular Standard Delivery option is disabled.')).toBeVisible();
    expect(screen.getByLabelText('Enable regular Standard Delivery for orders below the free-shipping threshold.')).not.toBeChecked();
    fireEvent.click(screen.getByLabelText('Enable free shipping for orders above threshold'));
    expect(screen.getByLabelText('Enable standard delivery option')).not.toBeChecked();
    expect(screen.getByLabelText('Free Shipping Threshold ($)')).toBeDisabled();
  });
});
