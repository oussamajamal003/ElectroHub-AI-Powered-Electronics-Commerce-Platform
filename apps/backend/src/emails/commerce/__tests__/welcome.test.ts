import { describe, expect, it } from 'vitest';
import { renderCommerceEmail } from '../templates.js';
import { commerceEmailSnapshot } from '../../../services/commerce-email.domain.js';

describe('customer welcome renderer', () => {
  it('renders branded escaped HTML, plain text and configured links without order or authentication secrets', () => {
    const snapshot = commerceEmailSnapshot.parse({ v: 1, type: 'CUSTOMER_WELCOME', recipientName: '<script>Fixture</script>', occurredAt: '2026-11-11T12:00:00.000Z' });
    const message = renderCommerceEmail(snapshot, { origin: 'https://store.example.test' }, 'v1');
    expect(message.subject).toBe('Welcome to ElectroHub!');
    expect(message.html).toContain('&lt;script&gt;Fixture&lt;/script&gt;');
    expect(message.html).toContain('https://store.example.test/brand/electrohub-email-logo.png');
    expect(message.html).toContain('alt="ElectroHub"');
    expect(message.html).toContain('https://store.example.test/products');
    expect(message.html).not.toContain('Order reference');
    expect(message.html).not.toContain('placed an order');
    expect(message.text).toContain('Your account is ready');
    expect(message.text).toContain('https://store.example.test/products');
    expect(message.text).not.toMatch(/password|OTP|token/i);
  });
});
