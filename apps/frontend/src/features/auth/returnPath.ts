export type CustomerReturnPath = '/cart' | '/checkout' | `/checkout/confirmation/ORD-${string}`;
export function customerReturnPath(value: unknown): CustomerReturnPath | undefined {
  if (value === '/cart' || value === '/checkout') return value;
  if (typeof value === 'string' && /^\/checkout\/confirmation\/ORD-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return value as CustomerReturnPath;
  return undefined;
}
