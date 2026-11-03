import type { Money } from './api';

/** Display-only formatting of server decimal strings; amounts are never recalculated client-side. */
export const formatMoney = (amount: string, currency = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(amount));

/** Several currencies are listed side by side, never summed. An empty list is a truthful zero in the default currency. */
export const formatMoneyList = (values: Money[], emptyCurrency = 'USD') =>
  values.length ? values.map(value => formatMoney(value.amount, value.currency)).join(' · ') : formatMoney('0', emptyCurrency);

export const formatDate = (value: string) =>
  new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(value));

export const formatDateTime = (value: string) =>
  new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value));

export const formatCount = (value: number) => new Intl.NumberFormat('en-US').format(value);

/** Shortened public order reference for dense tables; the full reference stays in title/aria and links. */
export const shortReference = (reference: string) => reference.length > 16 ? `${reference.slice(0, 12)}…` : reference;

export const initials = (name: string | null | undefined, fallback = '?') => {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  return parts.length ? (parts[0]![0]! + (parts.length > 1 ? parts[parts.length - 1]![0]! : '')).toUpperCase() : fallback;
};

export const stockLabel: Record<string, string> = { IN_STOCK: 'In stock', LOW_STOCK: 'Low stock', OUT_OF_STOCK: 'Out of stock' };
