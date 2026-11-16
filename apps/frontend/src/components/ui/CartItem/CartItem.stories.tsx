import type { Meta, StoryObj } from '@storybook/react-vite';
import { CartItem } from './CartItem';

const meta = { title: 'Components/CartItem', component: CartItem,
  args: { id: 'line-1', title: 'Apple iPhone 15 Pro', subtitle: 'Phones', price: 1099.99,
    imageUrl: '/images/catalog/variety/apple-phone-generic-01.jpg', quantity: 1, maxQuantity: 5,
    onQuantityChange: () => undefined, onRemove: () => undefined } } satisfies Meta<typeof CartItem>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Available: Story = {};
export const MultipleQuantity: Story = { args: { quantity: 3 } };
export const LowStock: Story = { args: { quantity: 4, maxQuantity: 2 } };
export const OutOfStock: Story = { args: { quantity: 1, maxQuantity: 0, unavailable: true } };
export const Unavailable: Story = { args: { title: 'Product unavailable', price: null, imageUrl: '', unavailable: true } };
export const MutationPending: Story = { args: { disabled: true } };
