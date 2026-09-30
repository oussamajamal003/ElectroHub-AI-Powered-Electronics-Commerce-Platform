import type { Meta, StoryObj } from '@storybook/react-vite';
import { ProductSpecifications } from './ProductSpecifications';

const groups = [{ group: 'Performance', items: [
  { id: 'chip', group: 'Performance', name: 'Chip', value: '8-core processor', sortOrder: 0 },
  { id: 'memory', group: 'Performance', name: 'Memory', value: '16GB unified', sortOrder: 1 },
] }, { group: 'Display', items: [
  { id: 'size', group: 'Display', name: 'Size', value: '13.6-inch', sortOrder: 0 },
] }];
const meta = { title: 'Catalog/ProductSpecifications', component: ProductSpecifications, args: { groups } } satisfies Meta<typeof ProductSpecifications>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Populated: Story = {};
export const Empty: Story = { args: { groups: [] } };
