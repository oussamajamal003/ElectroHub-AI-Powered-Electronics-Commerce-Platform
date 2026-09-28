import type { Meta, StoryObj } from '@storybook/react-vite';
import { Search } from 'lucide-react';
import { EmptyState } from './EmptyState';

const meta = {
  title: 'Components/States/EmptyState',
  component: EmptyState,
  args: { icon: <Search aria-hidden="true" />, title: 'No products found', description: 'Try changing your search or filters.' },
  parameters: { layout: 'padded' },
} satisfies Meta<typeof EmptyState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
