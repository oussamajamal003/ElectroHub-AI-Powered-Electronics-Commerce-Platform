import type { Meta, StoryObj } from '@storybook/react-vite';
import { StatusBadge } from './StatusBadge';

const meta = { title: 'Components/StatusBadge', component: StatusBadge } satisfies Meta<typeof StatusBadge>;
export default meta;
type Story = StoryObj<typeof meta>;
export const InStock: Story = { args: { children: 'In Stock', variant: 'success' } };
export const LowStock: Story = { args: { children: 'Low Stock', variant: 'warning' } };
export const OutOfStock: Story = { args: { children: 'Out of Stock', variant: 'error' } };
