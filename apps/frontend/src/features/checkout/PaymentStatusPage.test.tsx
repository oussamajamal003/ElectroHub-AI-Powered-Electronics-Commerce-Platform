import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { expect, it } from 'vitest';
import { PaymentStatusPage } from './PaymentStatusPage';
function Cart() { const location = useLocation(); return <output>{location.pathname + location.search}</output>; }
it('redirects legacy status URLs without losing attempt identity or submitting payment', async () => {
  render(<MemoryRouter initialEntries={['/account/payment-status/attempt-a?scope=CART_CHECKOUT']}><Routes><Route path="/account/payment-status/:attemptId" element={<PaymentStatusPage />} /><Route path="/cart" element={<Cart />} /></Routes></MemoryRouter>);
  await waitFor(() => expect(screen.getByText('/cart?purchase=attempt-a')).toBeVisible());
  expect(screen.queryByText('Checking your payment')).not.toBeInTheDocument();
});
