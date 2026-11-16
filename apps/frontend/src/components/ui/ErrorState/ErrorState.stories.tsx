import type { Meta, StoryObj } from '@storybook/react-vite';
import { ErrorState } from './ErrorState';

const meta = {
  title: 'Components/States/ErrorState',
  component: ErrorState,
  args: { title: 'Unable to load products', description: 'Please try again.' },
  parameters: { layout: 'padded' },
} satisfies Meta<typeof ErrorState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
