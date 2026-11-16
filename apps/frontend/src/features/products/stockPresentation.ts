import type { StockStatus } from './types';

export function stockPresentation(status: StockStatus | null) {
  if (status === 'IN_STOCK') return { label: 'In Stock', variant: 'success' as const };
  if (status === 'LOW_STOCK') return { label: 'Low Stock', variant: 'warning' as const };
  if (status === 'OUT_OF_STOCK') return { label: 'Out of Stock', variant: 'error' as const };
  return { label: 'Unavailable', variant: 'neutral' as const };
}
