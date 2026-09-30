import type { Meta, StoryObj } from '@storybook/react-vite';
import { Price } from './Price';

const meta = { title: 'Catalog/ProductPrice', component: Price, args: { currentPrice: 899, originalPrice: 999 } } satisfies Meta<typeof Price>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Discounted: Story = {};
export const Regular: Story = { args: { currentPrice: 1299 } };
