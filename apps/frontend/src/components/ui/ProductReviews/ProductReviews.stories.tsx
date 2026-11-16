import type { Meta, StoryObj } from '@storybook/react-vite';
import { ProductReviews } from './ProductReviews';

const reviews = [
  { id: 'review-a', rating: 5, body: 'Lightweight, quiet, and fast for my daily work.', author: { displayName: 'Taylor M.' }, createdAt: '2026-09-01T12:00:00.000Z', updatedAt: '2026-09-01T12:00:00.000Z' },
  { id: 'review-b', rating: 4, body: 'Great display and battery life. Setup was simple.', author: { displayName: 'Jordan K.' }, createdAt: '2026-08-22T12:00:00.000Z', updatedAt: '2026-08-22T12:00:00.000Z' },
];
const meta = { title: 'Catalog/ProductReviews', component: ProductReviews, args: { reviews } } satisfies Meta<typeof ProductReviews>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Populated: Story = {};
export const Empty: Story = { args: { reviews: [] } };
