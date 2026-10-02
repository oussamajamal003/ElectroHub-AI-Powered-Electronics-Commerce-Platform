import type { Meta, StoryObj } from '@storybook/react-vite';
import { QuantitySelector } from './QuantitySelector';

const meta = { title: 'Components/QuantitySelector', component: QuantitySelector,
  args: { quantity: 1, productName: 'Apple iPhone 15 Pro', minQuantity: 1, maxQuantity: 5,
    onIncrease: () => undefined, onDecrease: () => undefined } } satisfies Meta<typeof QuantitySelector>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const MidQuantity: Story = { args: { quantity: 3 } };
export const Minimum: Story = { args: { quantity: 1 } };
export const Maximum: Story = { args: { quantity: 5 } };
export const Disabled: Story = { args: { disabled: true } };
