export interface CartInputItem { productId: string; quantity: number }
export interface CartLine {
  id: string | null;
  productId: string;
  quantity: number;
  product: { slug: string; name: string; category: string; price: string;
    image: { url: string; altText: string | null } | null } | null;
  availableQuantity: number;
  stockStatus?: import('@/features/products/types').StockStatus | null;
  availability: 'AVAILABLE' | 'LOW_STOCK' | 'OUT_OF_STOCK' | 'UNAVAILABLE' | 'NOT_FOUND';
  lineTotal: string | null;
}
export interface CartData {
  revision: string;
  items: CartLine[];
  totalQuantity: number;
  subtotal: string;
  shipping: string;
  total: string;
  currency: 'USD';
  canCheckout: boolean;
}
