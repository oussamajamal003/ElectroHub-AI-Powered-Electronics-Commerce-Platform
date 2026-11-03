import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { SearchSelect, type SearchSelectOption, type SearchSelectProps } from './SearchSelect';

const options: SearchSelectOption[] = [
  { value: 'phones', label: 'Smartphones', group: 'Used with Apple', hint: '7 products' },
  { value: 'laptops', label: 'Laptops', group: 'Used with Apple', hint: '3 products' },
  { value: 'audio', label: 'Audio', group: 'All categories' },
  { value: 'cameras', label: 'Cameras & Photography', group: 'All categories' },
  { value: 'long', label: 'stripe-acceptance-1218e692-079c-42ad-bd6c-303aa5213c9b', group: 'All categories' },
  { value: 'hidden', label: 'Archive bin (hidden)', group: 'All categories', disabled: true },
];

function Controlled(args: SearchSelectProps) {
  const [value, setValue] = useState(args.value);
  return <div style={{ maxWidth: 360 }}><SearchSelect {...args} value={value} onValueChange={setValue} /></div>;
}

const meta = {
  title: 'Components/SearchSelect',
  component: SearchSelect,
  args: { label: 'Category', options, value: undefined, onValueChange: () => undefined, placeholder: 'Choose a category', searchPlaceholder: 'Search categories' },
  parameters: { layout: 'padded' },
  render: args => <Controlled {...args} />,
} satisfies Meta<typeof SearchSelect>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Grouped: Story = {};
export const Selected: Story = { args: { value: 'long' } };
export const WithError: Story = { args: { required: true, error: 'Choose a category.' } };
export const Loading: Story = { args: { disabled: true, placeholder: 'Loading categories…' } };
