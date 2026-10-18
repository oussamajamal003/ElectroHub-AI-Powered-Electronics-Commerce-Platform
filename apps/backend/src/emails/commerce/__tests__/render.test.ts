import { describe, expect, it } from 'vitest';
import { commerceEmailSnapshot, TEMPLATE_VERSION, type RenderContext } from '../../../services/commerce-email.domain.js';
import { commerceEmailFixtures, type CommerceEmailFixtureName } from '../fixtures.js';
import { escapeHtml, headerSafe, orderUrl } from '../escape.js';
import { formatCardBrand, formatDateOnly, formatEstimate, formatInstant, formatMoney } from '../format.js';
import { renderCommerceEmail, renderOrderCancelled, renderOrderConfirmed, renderPaymentConfirmed } from '../templates.js';

const ctx: RenderContext = { origin: 'https://electrohub.example' };
const REFERENCE = 'ORD-3F2504E0-4F89-41D3-9A0C-0305E82C3301';
const ORDER_URL = `https://electrohub.example/orders/${REFERENCE}`;
const MALICIOUS: CommerceEmailFixtureName[] = ['orderConfirmedMaliciousNames'];
const NON_MALICIOUS = (Object.keys(commerceEmailFixtures) as CommerceEmailFixtureName[]).filter(name => !MALICIOUS.includes(name));

function render(name: CommerceEmailFixtureName) {
  return renderCommerceEmail(commerceEmailFixtures[name], ctx, TEMPLATE_VERSION);
}

describe('fixtures', () => {
  it.each(Object.keys(commerceEmailFixtures) as CommerceEmailFixtureName[])('%s parses against its zod schema', name => {
    expect(commerceEmailSnapshot.safeParse(commerceEmailFixtures[name]).success).toBe(true);
  });

  it('keeps stress fixtures within their documented bounds', () => {
    expect(commerceEmailFixtures.orderConfirmed25Items.items).toHaveLength(25);
    expect(commerceEmailFixtures.orderConfirmed100Items.items).toHaveLength(100);
  });
});

describe('subjects and headings', () => {
  const expected: Array<[CommerceEmailFixtureName, string, string]> = [
    ['orderConfirmed', `Order confirmed — ${REFERENCE}`, 'Your order is confirmed'],
    ['paymentConfirmed', `Payment confirmed — ${REFERENCE}`, 'Your payment is confirmed'],
    ['orderPreparing', `We’re preparing your order — ${REFERENCE}`, 'Your order is being prepared'],
    ['orderOutForDelivery', `Your order is out for delivery — ${REFERENCE}`, 'Your order is out for delivery'],
    ['orderDelivered', `Order delivered — ${REFERENCE}`, 'Your order is marked delivered'],
    ['orderCancelledUnpaid', `Order cancelled — ${REFERENCE}`, 'Your order was cancelled'],
    ['paymentRefunded', `Refund confirmed — ${REFERENCE}`, 'Your refund is confirmed'],
  ];

  it.each(expected)('%s has exact subject and headline', (name, subject, heading) => {
    const email = render(name);
    expect(email.subject).toBe(subject);
    expect(email.html).toMatch(new RegExp(`<h1[^>]*>${heading}</h1>`));
    expect(email.text).toContain(heading);
  });
});

describe('HTML escaping', () => {
  it('escapes every special character and the backtick', () => {
    expect(escapeHtml(`<&>"'\``)).toBe('&lt;&amp;&gt;&quot;&#39;&#96;');
  });

  it('never emits raw attacker markup from malicious fixtures', () => {
    for (const name of MALICIOUS) {
      const { html } = render(name);
      expect(html).not.toContain('<script');
      expect(html).not.toMatch(/<img/i);
      expect(html).not.toMatch(/<b>/i);
      expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
      expect(html).toContain('&quot;&gt;&lt;img src=x onerror=alert(1)&gt;');
      expect(html).toContain('Tom &amp; Jerry&#39;s &lt;b&gt;Cable&lt;/b&gt;');
      expect(html).toContain('France &amp; &lt;i&gt;Monaco&lt;/i&gt;');
    }
  });

  it('keeps plain text free of HTML entities', () => {
    for (const name of MALICIOUS) {
      const { text } = render(name);
      expect(text).not.toMatch(/&(amp|lt|gt|quot|#39|#96);/);
      expect(text).toContain("Tom & Jerry's <b>Cable</b>");
    }
  });

  it('keeps the preheader out of address and card details', () => {
    for (const name of Object.keys(commerceEmailFixtures) as CommerceEmailFixtureName[]) {
      const { preheader } = render(name);
      expect(preheader).not.toMatch(/Lyon|Rue|4242|Visa|ending/);
    }
  });
});

describe('headerSafe', () => {
  it('removes CR/LF and control characters, trims, and caps length', () => {
    const value = headerSafe('  Order\r\nBcc: attacker@example.com\u0000  ');
    expect(value).not.toContain('\r');
    expect(value).not.toContain('\n');
    expect(value).not.toContain('\u0000');
    expect(value).toBe('OrderBcc: attacker@example.com');
    expect(headerSafe('x'.repeat(300))).toHaveLength(200);
  });
});

describe('plain text', () => {
  it.each(NON_MALICIOUS)('%s has no HTML tags and includes reference and order URL', name => {
    const { text } = render(name);
    expect(text).not.toMatch(/<\/?[a-zA-Z][^>]*>/);
    expect(text).toContain(REFERENCE);
    expect(text.split('\n')).toContain(ORDER_URL);
  });
});

describe('amount and date precision', () => {
  it('formats exact money strings without floating point', () => {
    expect(formatMoney('1234567.80', 'USD')).toBe('$1,234,567.80');
    expect(formatMoney('9999999.99', 'USD')).toBe('$9,999,999.99');
    expect(formatMoney('0.05', 'USD')).toBe('$0.05');
    expect(formatMoney('1234567.80', 'EUR')).toBe('1,234,567.80 EUR');
    expect(() => formatMoney('12.5', 'USD')).toThrow('INVALID_MONEY');
  });

  it('renders precise amounts in the emails', () => {
    expect(render('orderConfirmedLargeAmount').html).toContain('$1,234,567.80');
    expect(render('orderConfirmedLargeAmount').text).toContain('Total: $1,234,567.80');
    expect(render('paymentConfirmedMaxAmount').html).toContain('$9,999,999.99');
    expect(render('paymentConfirmedEuro').text).toContain('1,234,567.80 EUR');
    expect(render('orderConfirmed').text).toContain('Total: $274.00');
    expect(render('orderConfirmed').text).toContain('Shipping: Free');
  });

  it('does not shift date-only values across timezones', () => {
    expect(formatDateOnly('2026-10-23')).toBe('Friday, October 23, 2026');
    expect(formatDateOnly('2026-10-23')).toContain('October 23');
    expect(formatInstant('2026-10-18T23:30:00Z')).toBe('October 18, 2026');
  });

  it('formats estimate windows', () => {
    expect(formatEstimate('2026-10-23', '2026-10-23')).toBe('Friday, October 23, 2026');
    expect(formatEstimate('2026-10-23', '2026-10-27')).toBe('Oct 23 – Oct 27, 2026');
    expect(formatEstimate('2026-12-29', '2027-01-02')).toBe('Dec 29, 2026 – Jan 2, 2027');
    expect(() => formatEstimate('2026-10-27', '2026-10-23')).toThrow('INVALID_ESTIMATE_RANGE');
  });

  it('maps card brands for display', () => {
    expect(formatCardBrand('visa')).toBe('Visa');
    expect(formatCardBrand('mastercard')).toBe('Mastercard');
    expect(formatCardBrand('amex')).toBe('American Express');
    expect(formatCardBrand('discover')).toBe('Discover');
    expect(formatCardBrand('diners_club')).toBe('Diners Club');
  });
});

describe('absent data', () => {
  it.each(Object.keys(commerceEmailFixtures) as CommerceEmailFixtureName[])('%s never prints undefined or null', name => {
    const { html, text } = render(name);
    expect(html).not.toContain('undefined');
    expect(text).not.toContain('undefined');
    expect(html).not.toMatch(/\bnull\b/);
    expect(text).not.toMatch(/\bnull\b/);
  });

  it('uses the neutral greeting when the recipient name is null', () => {
    const { html, text } = render('orderConfirmedMinimalOptional');
    expect(text).toContain('\nHello,\n');
    expect(html).toContain('>Hello,</p>');
  });

  it('omits the card line when no card is present', () => {
    expect(render('paymentConfirmedNoCard').text).not.toContain('Payment method');
    expect(render('paymentConfirmed').text).toContain('Visa ending in 4242');
  });
});

describe('cancellation and refund wording', () => {
  it('claims a refund only when the snapshot carries one', () => {
    const refunded = render('orderCancelledRefunded');
    expect(refunded.text).toContain('A refund of $274.00 has been recorded for this order.');
    expect(refunded.html).toContain('A refund of $274.00 has been recorded for this order.');

    for (const name of ['orderCancelledUnpaid', 'orderCancelledPaidNoRefund'] as const) {
      const email = render(name);
      expect(email.html).not.toContain('A refund of');
      expect(email.text).not.toContain('A refund of');
    }
  });

  it('explains the unpaid cancellation without mentioning refunds', () => {
    const unpaid = render('orderCancelledUnpaid');
    expect(unpaid.text).toContain('No payment was taken for this order.');
    expect(unpaid.text).not.toMatch(/refund/i);
  });

  it('does not promise a refund for paid cancellations without a refund', () => {
    expect(render('orderCancelledPaidNoRefund').text).toContain('We’ll update your order details if a refund is recorded.');
  });
});

describe('payment email scope', () => {
  it('omits shipping address, item list and receipt language', () => {
    const { html, text } = render('paymentConfirmed');
    for (const value of [html, text]) {
      expect(value).not.toContain('Shipping address');
      expect(value).not.toContain('Items');
      expect(value).not.toMatch(/receipt|invoice/i);
    }
  });
});

describe('static safety', () => {
  const forbidden = ['<script', '<form', '<link', 'background-image', 'display:flex', 'display:grid'];

  it.each(Object.keys(commerceEmailFixtures) as CommerceEmailFixtureName[])('%s contains no forbidden markup', name => {
    const { html } = render(name);
    for (const token of forbidden) {
      expect(html.toLowerCase()).not.toContain(token);
    }
  });

  it.each(Object.keys(commerceEmailFixtures) as CommerceEmailFixtureName[])('%s marks every table as presentation', name => {
    const tables = render(name).html.match(/<table\b[^>]*>/g) ?? [];
    expect(tables.length).toBeGreaterThan(0);
    for (const tag of tables) {
      expect(tag).toContain('role="presentation"');
    }
  });

  it('only uses https images with empty alt text', () => {
    const { html } = render('orderConfirmed25Items');
    const images = html.match(/<img\b[^>]*>/g) ?? [];
    expect(images.length).toBeGreaterThan(0);
    for (const tag of images) {
      expect(tag).toMatch(/src="https:\/\/images\.example\.com\//);
      expect(tag).toContain('alt=""');
    }
    expect(render('orderConfirmedMinimalOptional').html).not.toMatch(/<img\b/);
  });

  it('has a light color-scheme declaration and a square, single CTA', () => {
    const { html } = render('orderConfirmed');
    expect(html).toContain('<meta name="color-scheme" content="light">');
    expect(html).not.toMatch(/border-radius:\s*[1-9]/i);
    expect(html.match(/View Order Details/g)).toHaveLength(1);
  });
});

describe('CTA link', () => {
  it.each(NON_MALICIOUS)('%s links to the encoded order route on the validated origin', name => {
    const { html } = render(name);
    expect(html).toContain(`href="${ORDER_URL}"`);
    expect(html).toContain('>View Order Details</a>');
  });
});

describe('orderUrl', () => {
  it('builds the order route for trusted origins', () => {
    expect(orderUrl('https://electrohub.example', REFERENCE)).toBe(ORDER_URL);
    expect(orderUrl('http://localhost:5173', REFERENCE)).toBe(`http://localhost:5173/orders/${REFERENCE}`);
    expect(orderUrl('http://127.0.0.1', REFERENCE)).toBe(`http://127.0.0.1/orders/${REFERENCE}`);
  });

  it.each([
    'javascript:alert(1)',
    'http://evil.com',
    'https://electrohub.example/path',
    'https://electrohub.example?x=1',
    'https://electrohub.example#frag',
    'https://electrohub.example/',
    'https://user:pass@electrohub.example',
    'http://electrohub.example',
    'data:text/html,hello',
    'not a url',
  ])('rejects %s', origin => {
    expect(() => orderUrl(origin, REFERENCE)).toThrow('UNTRUSTED_ORIGIN');
  });
});

describe('dispatcher', () => {
  it('rejects unsupported template versions', () => {
    expect(() => renderCommerceEmail(commerceEmailFixtures.orderConfirmed, ctx, 'v2')).toThrow('UNSUPPORTED_TEMPLATE_VERSION');
    expect(() => renderCommerceEmail(commerceEmailFixtures.orderConfirmed, ctx, '')).toThrow('UNSUPPORTED_TEMPLATE_VERSION');
  });

  it('delegates to the matching typed renderer', () => {
    expect(renderCommerceEmail(commerceEmailFixtures.orderConfirmed, ctx, 'v1'))
      .toEqual(renderOrderConfirmed(commerceEmailFixtures.orderConfirmed, ctx));
    expect(renderCommerceEmail(commerceEmailFixtures.paymentConfirmed, ctx, 'v1'))
      .toEqual(renderPaymentConfirmed(commerceEmailFixtures.paymentConfirmed, ctx));
    expect(renderCommerceEmail(commerceEmailFixtures.orderCancelledUnpaid, ctx, 'v1'))
      .toEqual(renderOrderCancelled(commerceEmailFixtures.orderCancelledUnpaid, ctx));
  });
});

describe('size budget', () => {
  it.each(['orderConfirmed25Items', 'orderConfirmed100Items'] as const)('%s HTML stays under 90 KB', name => {
    const bytes = Buffer.byteLength(render(name).html, 'utf8');
    expect(bytes).toBeLessThan(90_000);
  });
});
