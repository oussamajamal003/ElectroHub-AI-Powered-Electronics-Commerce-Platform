import type { Meta, StoryObj } from '@storybook/react-vite';
import { ProductDetailsTabs } from './ProductDetailsTabs';

const meta = { title: 'Catalog/ProductDetailsTabs', component: ProductDetailsTabs, args: {
  reviewCount: 2,
  description: <section><h2>Product Description</h2><p>A portable device for everyday use.</p></section>,
  specifications: <section><h2>Specifications</h2><p>13.6-inch display · 16GB memory</p></section>,
  reviews: <section><h2>Customer Reviews</h2><p>2 customer reviews</p></section>,
} } satisfies Meta<typeof ProductDetailsTabs>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
