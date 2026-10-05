import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { ProductPurchaseActions, type ProductPurchaseActionsProps } from './ProductPurchaseActions';
import { WishlistButton } from '@/components/ui/WishlistButton/WishlistButton';
import { Button } from '@/components/ui/Button';

function Actions(args: ProductPurchaseActionsProps) {
  const [quantity, setQuantity] = useState(args.quantity);
  return <ProductPurchaseActions {...args} quantity={quantity} onQuantityChange={setQuantity} />;
}
const meta = { title: 'Customer/Product Purchase Actions', component: ProductPurchaseActions,
  render: Actions, args: { product: { name: 'Apple iPhone 15 Pro', stockStatus: 'IN_STOCK', availableQuantity: 8, purchasable: true, availability: 'AVAILABLE' }, quantity: 1, remainingQuantity: 8,
    onQuantityChange: () => undefined, onAdd: () => undefined, wishlistAction: <WishlistButton title="Apple iPhone 15 Pro" saved={false} onToggle={() => undefined} /> },
} satisfies Meta<typeof ProductPurchaseActions>;
export default meta;
type Story = StoryObj<typeof meta>;
export const InStock: Story = {};
export const LowStock: Story = { args: { product: { ...meta.args.product, stockStatus: 'LOW_STOCK', availableQuantity: 2 }, remainingQuantity: 2 } };
export const OutOfStock: Story = { args: { product: { ...meta.args.product, stockStatus: 'OUT_OF_STOCK', availableQuantity: 0, availability: 'UNAVAILABLE', purchasable: false }, remainingQuantity: 0 } };
export const Unavailable: Story = { args: { product: { name: meta.args.product.name, availableQuantity: 4, availability: 'UNAVAILABLE', purchasable: false }, remainingQuantity: 0 } };
export const AtMaximum: Story = { args: { quantity: 8 } };
export const Loading: Story = { args: { pending: true } };
export const Added: Story = { args: { feedback: 'Apple iPhone 15 Pro added to cart.' } };
export const StockShrink: Story = { render: args => <ShrinkActions {...args} /> };
function ShrinkActions(args: ProductPurchaseActionsProps) {
  const [shrunk, setShrunk] = useState(false);
  const [quantity, setQuantity] = useState(4);
  return <><ProductPurchaseActions {...args} product={{ ...args.product, stockStatus: 'LOW_STOCK', availableQuantity: shrunk ? 3 : 5 }} remainingQuantity={shrunk ? 3 : 5} quantity={quantity} onQuantityChange={setQuantity} />
    <Button onClick={() => { setShrunk(true); setQuantity(1); }}>Simulate stock shrinking to 3</Button></>;
}
