import type { Meta, StoryObj } from '@storybook/react-vite';
import { CartPageContent } from './CartPage';
import { MemoryRouter } from 'react-router-dom';
import type { CartContextValue } from '@/features/cart/context';
import type { CartData } from '@/features/cart/types';

const item = { id: 'line-1', productId: '8f2813b4-a388-44d3-b51e-5d4c40386677', quantity: 1,
  product: { slug: 'iphone-15-pro', name: 'Apple iPhone 15 Pro', category: 'Phones', price: '1099.99',
    image: { url: '/images/catalog/variety/apple-phone-generic-01.jpg', altText: 'Apple iPhone 15 Pro' } },
  availableQuantity: 4, availability: 'AVAILABLE' as const, lineTotal: '1099.99' };
const populated: CartData = { items: [item], totalQuantity: 1, subtotal: '1099.99', shipping: '0.00', total: '1099.99', currency: 'USD', canCheckout: true };
const empty: CartData = { items: [], totalQuantity: 0, subtotal: '0.00', shipping: '0.00', total: '0.00', currency: 'USD', canCheckout: false };
const cart = (data: CartData | undefined, options: Partial<CartContextValue> = {}): CartContextValue => ({ data,
  totalQuantity: data?.totalQuantity ?? 0, isGuest: true, isLoggingOut: false, isLoading: false, isError: false, isMutating: false, pendingProductIds: [], pendingRemoveProductIds: [],
  mergeError: null, pendingGuestItems: [], addItem: async () => undefined, setQuantity: async () => undefined,
  removeItem: async () => undefined, retry: async () => undefined, retryMerge: async () => undefined,
  removePendingGuestItem: () => undefined, ...options });

const meta = { title: 'Customer/Cart Page', component: CartPageContent,
  decorators: [Story => <MemoryRouter><Story /></MemoryRouter>] } satisfies Meta<typeof CartPageContent>;
export default meta;
type Story = StoryObj<typeof meta>;
export const GuestPopulated: Story = { args: { cart: cart(populated) } };
export const AuthenticatedPopulated: Story = { args: { cart: cart(populated, { isGuest: false }) } };
export const MultipleItems: Story = { args: { cart: cart({ ...populated, items: [{ ...item, quantity: 3, lineTotal: '3299.97' }], totalQuantity: 3, subtotal: '3299.97', total: '3299.97' }) } };
export const Empty: Story = { args: { cart: cart(empty) } };
export const Loading: Story = { args: { cart: cart(undefined, { isLoading: true }) } };
export const Error: Story = { args: { cart: cart(undefined, { isError: true }) } };
export const RevalidationError: Story = { args: { cart: cart(populated, { isError: true }) } };
export const Unavailable: Story = { args: { cart: cart({ ...populated, items: [{ ...item, availability: 'OUT_OF_STOCK', availableQuantity: 0 }], canCheckout: false }) } };
export const LowStock: Story = { args: { cart: cart({ ...populated, items: [{ ...item, quantity: 3, availableQuantity: 2, availability: 'LOW_STOCK', lineTotal: '3299.97' }], totalQuantity: 3, subtotal: '3299.97', total: '3299.97', canCheckout: false }) } };
