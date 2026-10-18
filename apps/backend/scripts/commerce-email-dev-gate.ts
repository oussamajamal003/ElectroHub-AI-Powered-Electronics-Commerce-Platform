/**
 * Task 03.8 controlled DEV live gate (G01–G12). Owner-approved, single run, shared DEV + Stripe TEST MODE only.
 *
 *   npx tsx scripts/commerce-email-dev-gate.ts --confirm=pzxekjybdiulzmssalfo --mailbox=<approved address> [--send-otp]
 *
 * Creates one disposable account at a plus-alias of the approved mailbox, one hidden (storefront-invisible) product, and performs ONE
 * genuine Stripe Test Mode purchase through the real PaymentService lifecycle (setup → submit → confirm pm_card_visa → durable worker).
 * The commerce producer is enabled for THIS process only; the dispatcher runs in allowlist mode with exactly that one address, so no
 * other DEV event or recipient can be claimed. Prints credential-free evidence; message ids are hashed.
 */
import { createHash, randomUUID } from 'node:crypto';

const confirm = process.argv.find(arg => arg.startsWith('--confirm='))?.slice(10);
const mailbox = process.argv.find(arg => arg.startsWith('--mailbox='))?.slice(10)?.toLowerCase() ?? '';
if (confirm !== 'pzxekjybdiulzmssalfo' || !/^[^@+\s]+@[^@\s]+\.[a-z]{2,}$/.test(mailbox)) throw new Error('Usage: --confirm=<DEV ref> --mailbox=<approved address>');
process.env.NODE_ENV = 'development';
const [local, domain] = mailbox.split('@');
// --resume=<runId> continues an earlier run's paid order (no second purchase) after an interrupted gate.
const resume = process.argv.find(arg => arg.startsWith('--resume='))?.slice(9);
if (resume !== undefined && !/^[0-9a-f]{8}$/.test(resume)) throw new Error('--resume expects the 8-hex runId.');
const runId = resume ?? randomUUID().slice(0, 8);
const recipient = `${local}+eh038-${runId}@${domain}`;
process.env.COMMERCE_EMAIL_ENQUEUE_ENABLED = 'true';

const hash = (value: string | null | undefined) => value ? createHash('sha256').update(value).digest('hex').slice(0, 16) : null;
const results: Record<string, unknown> = {};
const gate = (id: string, pass: boolean, detail: unknown) => { results[id] = { pass, detail }; console.log(`${id} ${pass ? 'PASS' : 'FAIL'}`, JSON.stringify(detail)); };

async function main() {
  const { env } = await import('../src/config/env.js');
  for (const url of [env.DATABASE_URL, env.DIRECT_URL]) {
    if (!url.includes('pzxekjybdiulzmssalfo') || url.includes('yepfgjehdstlxbpespun')) throw new Error('Not the DEV database.');
  }
  if (!env.STRIPE_SECRET_KEY?.startsWith('sk_test_')) throw new Error('Stripe Test Mode key required.');
  const { resolvePaymentIsolation } = await import('../src/payment-isolation.js');
  // Owner-approved scoped mutation for this one process (never the watched dev server).
  process.env.PAYMENT_SHARED_MUTATIONS_APPROVED = resolvePaymentIsolation().identity;
  const { prisma } = await import('../src/lib/prisma.js');
  const { PaymentService } = await import('../src/services/payment.service.js');
  const { CartService } = await import('../src/services/cart.service.js');
  const { OrderService } = await import('../src/services/order.service.js');
  const { stripeProvider } = await import('../src/services/stripe.provider.js');
  const { enqueuePaymentSucceeded } = await import('../src/services/commerce-email.producer.js');
  const { CommerceEmailDispatcher } = await import('../src/services/commerce-email.dispatcher.js');
  const { commerceEmailConfig } = await import('../src/services/commerce-email.config.js');
  const { BrevoProvider } = await import('../src/integrations/brevo/brevo.provider.js');
  const { BrevoClient } = await import('../src/integrations/brevo/brevo.client.js');
  const { renderCommerceEmail } = await import('../src/emails/commerce/templates.js');
  const { commerceEmailSnapshot } = await import('../src/services/commerce-email.domain.js');
  const payment = new PaymentService(prisma); const cart = new CartService(prisma);
  if (!resolvePaymentIsolation().allowed) throw new Error('Payment isolation refused the scoped DEV run.');

  // Fixtures: disposable account and hidden product (never on the storefront).
  const role = await prisma.role.findUniqueOrThrow({ where: { name: 'CUSTOMER' } });
  const user = resume ? await prisma.user.findUniqueOrThrow({ where: { email: recipient } })
    : await prisma.user.create({ data: { roleId: role.id, email: recipient, firstName: 'Gate', lastName: 'EH038', emailVerifiedAt: new Date() } });
  const category = resume ? await prisma.category.findUniqueOrThrow({ where: { slug: `eh038-gate-${runId}` } })
    : await prisma.category.create({ data: { name: `EH038 gate ${runId}`, slug: `eh038-gate-${runId}` } });
  const product = resume ? await prisma.product.findUniqueOrThrow({ where: { sku: `EH038-${runId}` } }) : await prisma.product.create({ data: { categoryId: category.id, sku: `EH038-${runId}`, slug: `eh038-${runId}`, name: 'EH038 Email Gate Test Item',
    price: '12.34', status: 'ACTIVE', isTestFixture: false, storefrontVisible: false, inventory: { create: { quantity: 3, lowStockAt: 1, status: 'IN_STOCK' } } } });
  console.log('fixtures', JSON.stringify({ runId, userId: user.id, productId: product.id, recipient: `${local}+eh038-${runId}@…` }));
  try {
    const prior = resume ? await prisma.paymentAttempt.findFirstOrThrow({ where: { userId: user.id, state: 'PAID' } }) : null;
    if (!prior) await cart.add(user.id, { productId: product.id, quantity: 1 });
    const active = prior ? null : await cart.get(user.id);
    const setup = prior ? { attemptId: prior.id } : await payment.setup(user.id, randomUUID(), { shipping: { recipient: 'Gate EH038', line1: '1 Test Avenue', city: 'Seoul', postalCode: '04524',
      country: 'South Korea', phone: '+821012345678' }, deliveryMethod: 'STANDARD', paymentMethod: 'CARD', expectedRevision: active!.revision });
    if (!prior) await payment.submit(user.id, setup.attemptId);
    const attemptRow = await prisma.paymentAttempt.findUniqueOrThrow({ where: { id: setup.attemptId } });
    if (!prior) await stripeProvider.sdk().paymentIntents.confirm(attemptRow.providerIntentId!, { payment_method: 'pm_card_visa', return_url: 'http://localhost:3000/checkout?step=review' });
    let state = '';
    for (let round = 0; round < 12 && state !== 'PAID'; round++) {
      await payment.wake(setup.attemptId); await payment.process(setup.attemptId);
      state = (await prisma.paymentAttempt.findUniqueOrThrow({ where: { id: setup.attemptId } })).state;
      if (state !== 'PAID') await new Promise(resolve => setTimeout(resolve, 1500));
    }
    const attempt = await prisma.paymentAttempt.findUniqueOrThrow({ where: { id: setup.attemptId } });
    const order = await prisma.order.findUniqueOrThrow({ where: { id: attempt.orderId! }, include: { payment: true } });
    const events = await prisma.commerceEmailOutbox.findMany({ where: { orderId: order.id }, orderBy: { type: 'asc' } });
    gate('G01', attempt.state === 'PAID' && order.status === 'CONFIRMED' && order.payment?.status === 'SUCCEEDED' && events.length === 2 &&
      events[0]!.type === 'ORDER_CONFIRMED' && events[1]!.type === 'PAYMENT_CONFIRMED',
    { attempt: attempt.state, order: order.status, payment: order.payment?.status, events: events.map(event => event.type) });
    gate('G02', events[0]!.eventKey === `order:${order.id}:confirmed` && events[1]!.eventKey === `payment:${order.payment!.id}:succeeded` &&
      events.every(event => event.recipient === recipient && event.dispatchState === 'READY'), { keys: events.map(event => event.eventKey.replace(/:[0-9a-f-]{36}:/, ':<id>:')) });

    // G09 duplicate replay: another durable pass and a direct producer replay create nothing.
    await payment.wake(setup.attemptId); await payment.process(setup.attemptId);
    // Same bounds as payment transactions: several round trips to the remote DEV pooler exceed Prisma's 5 s default.
    const replay = await prisma.$transaction(tx => enqueuePaymentSucceeded(tx, { orderId: order.id, paidAt: new Date(), card: null }), { timeout: 30_000, maxWait: 10_000 });
    gate('G09', replay.every(item => item === null) && await prisma.commerceEmailOutbox.count({ where: { orderId: order.id } }) === 2, { replayInserted: replay.filter(Boolean).length });

    // G06 snapshots match persisted facts.
    const [orderSnapshot, paymentSnapshot] = events.map(event => commerceEmailSnapshot.parse(event.snapshot));
    gate('G06', orderSnapshot!.type === 'ORDER_CONFIRMED' && orderSnapshot!.total === order.total.toFixed(2) && paymentSnapshot!.type === 'PAYMENT_CONFIRMED' &&
      paymentSnapshot!.amount === order.payment!.amount.toFixed(2) && orderSnapshot!.orderReference === `ORD-${order.id.toUpperCase()}`,
    { reference: `ORD-${order.id.toUpperCase()}`, total: order.total.toFixed(2), paymentAmount: order.payment!.amount.toFixed(2),
      card: paymentSnapshot!.type === 'PAYMENT_CONFIRMED' ? paymentSnapshot!.card : null });

    // Dispatch: allowlist of exactly this alias, real Brevo transport.
    const config = { ...commerceEmailConfig({ ...process.env, COMMERCE_EMAIL_DISPATCH_ENABLED: 'true', COMMERCE_EMAIL_SEND_MODE: 'allowlist',
      COMMERCE_EMAIL_ALLOWED_RECIPIENTS: recipient }), sendMode: 'allowlist' as const, allowedRecipients: [recipient] };
    if (!config.origin) throw new Error('No trusted origin (FRONTEND_URL) for email links.');
    const brevo = new BrevoProvider(new BrevoClient({ apiKey: env.BREVO_API_KEY, timeoutMs: config.providerTimeoutMs }));
    const sentTo: string[] = [];
    const dispatcher = new CommerceEmailDispatcher(prisma, { name: 'BREVO', send: message => { sentTo.push(message.to);
      return brevo.sendTransactionalEmail({ to: message.to, subject: message.subject, htmlContent: message.html, textContent: message.text, tags: message.tags }); } },
    renderCommerceEmail, config);
    const claims = await dispatcher.claim();
    gate('G03', claims.length === 2 && claims.every(claim => events.some(event => event.id === claim.id)), { claimed: claims.length });
    for (const claim of claims) await dispatcher.process(claim);
    const after = await prisma.commerceEmailOutbox.findMany({ where: { orderId: order.id }, include: { attempts: true }, orderBy: { type: 'asc' } });
    gate('G04', after.every(event => event.dispatchState === 'ACCEPTED' && event.providerMessageId && event.acceptedAt && event.deliveryState === 'UNKNOWN'),
      { states: after.map(event => event.dispatchState), messageIdHashes: after.map(event => hash(event.providerMessageId)) });
    gate('G07', sentTo.length === 2 && sentTo.every(address => address === recipient), { sends: sentTo.length, distinctRecipients: new Set(sentTo).size });
    gate('G12', after.every(event => event.attempts.length === 1 && event.attempts[0]!.outcome === 'ACCEPTED' && event.attemptCount === 1 && event.lastErrorCode === null),
      { attempts: after.map(event => event.attempts.map(item => ({ n: item.attemptNumber, outcome: item.outcome, httpStatus: item.httpStatus, errorCode: item.errorCode }))) });
    // G08 ownership and the customer projection.
    const orders = new OrderService(prisma);
    const details = await orders.getDetails(user.id, `ORD-${order.id.toUpperCase()}`);
    const stranger = await prisma.user.upsert({ where: { email: `eh038-stranger-${runId}@example.invalid` }, update: {},
      create: { roleId: role.id, email: `eh038-stranger-${runId}@example.invalid`, firstName: 'Other', lastName: 'Gate' } });
    const foreign = await orders.getDetails(stranger.id, `ORD-${order.id.toUpperCase()}`).then(() => 'VISIBLE', (error: { statusCode?: number }) => error.statusCode);
    gate('G08', details.emailConfirmation?.state === 'SENT' && foreign === 404 && !JSON.stringify(details).includes(recipient), { projection: details.emailConfirmation, foreign });
    // G10 email outcome never touched payment/order success.
    const finalOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { payment: true } });
    gate('G10', finalOrder.status === 'CONFIRMED' && finalOrder.payment?.status === 'SUCCEEDED' && finalOrder.payment.paidAt?.getTime() === order.payment!.paidAt?.getTime(),
      { order: finalOrder.status, payment: finalOrder.payment?.status });
    if (process.argv.includes('--send-otp')) {
      const { emailService } = await import('../src/services/email.service.js');
      const sent = await emailService.sendAccountVerificationOtp(recipient, '000000', user.id);
      const delivery = await prisma.emailDelivery.findFirst({ where: { userId: user.id }, orderBy: { createdAt: 'desc' } });
      gate('G11', sent && delivery?.status === 'SENT' && Boolean(delivery.providerMessageId), { otpSent: sent, status: delivery?.status, messageIdHash: hash(delivery?.providerMessageId) });
    }
    await prisma.user.update({ where: { id: stranger.id }, data: { isActive: false } });
    console.log('ORDER_REFERENCE', `ORD-${order.id.toUpperCase()}`);
  } finally {
    // Owned fixtures only: the cart is emptied and the hidden product/category retired. The paid Order, its Stripe TEST payment and the
    // outbox rows are retained as gate evidence (outbox FKs are RESTRICT by design).
    await prisma.cartItem.deleteMany({ where: { cart: { userId: user.id } } });
    await prisma.product.update({ where: { id: product.id }, data: { status: 'INACTIVE' } });
    await prisma.category.update({ where: { id: category.id }, data: { isActive: false } });
    await prisma.$disconnect();
  }
  const failed = Object.entries(results).filter(([, value]) => !(value as { pass: boolean }).pass).map(([key]) => key);
  console.log(JSON.stringify({ runId, failed }));
  process.exitCode = failed.length ? 2 : 0;
}
void main().catch(error => { console.error('DEV gate aborted:', error instanceof Error ? error.message : 'unknown'); process.exitCode = 1; });
