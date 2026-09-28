import type { Meta, StoryObj } from '@storybook/react-vite';
import { Skeleton } from './Skeleton';

const meta = {
  title: 'Components/Skeleton',
  component: Skeleton,
  args: { width: '20rem', height: '1rem' },
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Skeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Rectangular: Story = {};
export const Text: Story = { args: { variant: 'text', width: '16rem' } };
export const Circular: Story = { args: { variant: 'circular', width: '3rem', height: '3rem' } };
