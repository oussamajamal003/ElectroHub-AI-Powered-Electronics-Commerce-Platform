import type { CartData } from '@/features/cart/types';
export type DeliveryMethod = 'STANDARD' | 'EXPRESS' | 'OVERNIGHT';
export type CheckoutStep = 'shipping' | 'delivery' | 'payment' | 'review';
export interface Shipping { recipient: string; line1: string; line2: string; city: string; state: string; postalCode: string; country: string; phone: string }
export interface Totals { subtotal: string; shipping: string; total: string; currency: string }
export interface DeliveryOption { id: DeliveryMethod; label: string; price: string; estimate: string; minDays: number; maxDays: number; totals: Totals }
export interface CheckoutQuote { cartRevision: string; eligible: boolean; subtotal: string; currency: string;
  blockers: { productId: string; availability: string }[]; deliveryMethods: DeliveryOption[]; scope?: 'BUY_NOW'; summary?: CartData }
export type CheckoutScope = 'CART_CHECKOUT' | 'BUY_NOW';
export interface BuyNowSelection { productId: string; quantity: number }
export interface OrderRequest { shipping: Shipping; deliveryMethod: DeliveryMethod; paymentMethod: 'CARD'; expectedRevision: string; scope?: CheckoutScope; buyNow?: BuyNowSelection }
export interface SubmissionAttempt { submitted?: boolean; key: string; request: OrderRequest; status: 'setup' | 'pending' | 'unknown'; paymentAttemptId?: string; intentId?: string; cartIdentity?: string }
export interface CheckoutDraft { shipping: Shipping; deliveryMethod: DeliveryMethod; shippingComplete: boolean;
  deliveryComplete: boolean; paymentComplete: boolean; reviewReached?: boolean; attempt: SubmissionAttempt | null }
export interface Confirmation { orderReference: string; createdAt: string; status: string; paymentMethod: 'CARD'; paymentState: 'UNPROCESSED' | 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED';
  card?: { brand: string; last4: string } | null;
  shipping: Omit<Shipping, 'line2' | 'state'> & { line2: string | null; state: string | null };
  deliveryMethod: DeliveryMethod; estimatedDeliveryStart: string; estimatedDeliveryEnd: string; currency: string;
  subtotal: string; shippingCost: string; total: string;
  items: { productId: string; productName: string; sku: string; imageUrl: string | null; quantity: number; unitPrice: string; lineTotal: string }[] }
export type PaymentState = 'PREPARING' | 'AWAITING_INPUT' | 'ACTION_REQUIRED' | 'DECLINED' | 'PROCESSING' | 'AUTHORIZED' |
  'CAPTURE_PENDING' | 'PAID' | 'CANCEL_PENDING' | 'CANCELED' | 'COMPENSATION_PENDING' | 'COMPENSATED' | 'REFUND_PENDING' | 'REFUNDED' | 'INCIDENT';
export interface PaymentOutcome { classification?: 'NOT_SUBMITTED' | 'AWAITING_CUSTOMER_ACTION' | 'PROCESSING' | 'AUTHORIZED' | 'ORDER_PROCESSING' | 'SUCCEEDED' | 'DECLINED' | 'FAILED' | 'ABANDONED' | 'UNKNOWN'; submittedAt?: string | null; confirmationStartedAt?: string | null; retryAllowed?: boolean; cancelable?: boolean; scope?: CheckoutScope; attemptId: string; state: PaymentState; providerStatus: string | null; failureCode: string | null;
  cartIdentity?: string; cartRevision?: string; intentId?: string | null; updatedAt?: string | null;
  total: string; currency: string; orderReference: string | null; committed: boolean; cart: CartData;
  confirmation: Confirmation | null; recoveryRemainder: { productId: string; quantity: number }[] | null; recoveryActive: boolean }
export interface PaymentSetup extends PaymentOutcome { clientSecret: string | null; replayed: boolean }
