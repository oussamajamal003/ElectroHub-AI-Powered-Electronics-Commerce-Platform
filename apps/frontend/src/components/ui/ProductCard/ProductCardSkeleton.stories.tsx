import type { Meta, StoryObj } from '@storybook/react-vite';
import { ProductCardSkeleton } from './ProductCardSkeleton';

const meta = { title: 'Catalog/ProductCardSkeleton', component: ProductCardSkeleton, parameters: { layout: 'centered' } } satisfies Meta<typeof ProductCardSkeleton>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Loading: Story = {};
