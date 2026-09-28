import { useState, type PropsWithChildren } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';
import { SearchField } from './SearchField';

function QueryProvider({ children }: PropsWithChildren) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const withQueryClient: Decorator = Story => <QueryProvider><Story /></QueryProvider>;

function SearchFieldExample() {
  const [value, setValue] = useState('');
  return <div style={{ width: 'min(44rem, 90vw)' }}>
    <SearchField value={value} onChange={setValue} onSelect={suggestion => setValue(suggestion.label)} />
  </div>;
}

const meta = {
  title: 'Components/SearchField',
  component: SearchFieldExample,
  decorators: [withQueryClient],
  parameters: { layout: 'padded' },
} satisfies Meta<typeof SearchFieldExample>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
