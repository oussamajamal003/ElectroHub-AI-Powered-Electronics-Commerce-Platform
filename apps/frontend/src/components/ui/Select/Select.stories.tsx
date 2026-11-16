import type { Meta, StoryObj } from '@storybook/react-vite';
import { Select } from './Select';

const options = [
  { value: 'relevance', label: 'Relevance' },
  { value: 'price-asc', label: 'Price: low to high' },
  { value: 'price-desc', label: 'Price: high to low' },
];

const meta = {
  title: 'Components/Select',
  component: Select,
  args: { label: 'Sort by', options, defaultValue: 'relevance', fullWidth: true },
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Select>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { ...meta.args, fullWidth: false } };
export const FullWidth: Story = {};
export const Disabled: Story = { args: { ...meta.args, disabled: true } };
