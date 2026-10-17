const marks: string[] = [];
const allowedDetails = new Set(['correlationId', 'attemptId', 'state', 'kind', 'quotePresent', 'quoteEligible', 'shippingValid', 'deliveryValid', 'pending', 'recoveryActive']);
export function markPaymentTiming(event: string, detail?: Record<string, boolean | string | number | null>) {
  if (import.meta.env.DEV && typeof performance !== 'undefined') {
    try {
    if (!/^[a-z-]{1,64}$/.test(event)) return;
    const safe = Object.fromEntries(Object.entries(detail ?? {}).filter(([key, value]) => allowedDetails.has(key) &&
      (typeof value === 'boolean' || value === null || typeof value === 'number' && Number.isFinite(value) ||
        typeof value === 'string' && (['correlationId', 'attemptId'].includes(key) ? /^[a-f0-9-]{36}$/i.test(value) : /^[A-Z_-]{1,32}$/i.test(value)))));
    const name = `electrohub.payment.${event}`;
    if (marks.length >= 128) performance.clearMarks(marks.shift());
    performance.mark(name, { detail: safe });
    marks.push(name);
    } catch { /* Diagnostic failure must not change checkout behavior. */ }
  }
}
