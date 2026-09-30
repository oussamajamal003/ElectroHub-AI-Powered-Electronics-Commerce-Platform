import type { Meta, StoryObj } from '@storybook/react-vite';
import { Rating } from './Rating';

const meta = { title: 'Catalog/ProductRating', component: Rating, args: { value: 4.6, reviewCount: 24 } } satisfies Meta<typeof Rating>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Reviewed: Story = {};
export const NoReviews: Story = { args: { value: 0, reviewCount: 0 } };
