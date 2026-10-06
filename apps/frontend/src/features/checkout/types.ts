import type { CartData } from '@/features/cart/types';
export type DeliveryMethod = 'STANDARD' | 'EXPRESS' | 'OVERNIGHT';
export type CheckoutStep = 'shipping' | 'delivery' | 'payment' | 'review';
export interface Shipping { recipient: string; line1: string; line2: string; city: string; state: string; postalCode: string; country: string; phone: string }
export interface Totals { subtotal: string; shipping: string; total: string; currency: string }
export interface DeliveryOption { id: DeliveryMethod; label: string; price: string; estimate: string; minDays: number; maxDays: number; totals: Totals }
export interface CheckoutQuote { cartRevision: string; eligible: boolean; subtotal: string; currency: string;
  blockers: { productId: string; availability: string }[]; deliveryMethods: DeliveryOption[] }
export interface OrderRequest { shipping: Shipping; deliveryMethod: DeliveryMethod; paymentMethod: 'CARD'; expectedRevision: string }
export interface SubmissionAttempt { key: string; request: OrderRequest; status: 'pending' | 'unknown' }
export interface CheckoutDraft { shipping: Shipping; deliveryMethod: DeliveryMethod; shippingComplete: boolean;
  deliveryComplete: boolean; paymentComplete: boolean; attempt: SubmissionAttempt | null }
export interface Confirmation { orderReference: string; createdAt: string; status: string; paymentMethod: 'CARD'; paymentState: 'UNPROCESSED';
  shipping: Omit<Shipping, 'line2' | 'state'> & { line2: string | null; state: string | null };
  deliveryMethod: DeliveryMethod; estimatedDeliveryStart: string; estimatedDeliveryEnd: string; currency: string;
  subtotal: string; shippingCost: string; total: string;
  items: { productId: string; productName: string; sku: string; imageUrl: string | null; quantity: number; unitPrice: string; lineTotal: string }[] }
export interface PurchaseResponse { confirmation: Confirmation; cart: CartData; replayed: boolean }
