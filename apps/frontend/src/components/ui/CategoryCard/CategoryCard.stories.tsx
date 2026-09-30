import { MemoryRouter } from 'react-router-dom';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { CategoryCard } from './CategoryCard';

const category = { id: 'laptops', name: 'Laptops', slug: 'laptops', description: null,
  imageUrl: '/images/catalog/laptops.jpg', productCount: 18 };
const meta = { title: 'Catalog/CategoryCard', component: CategoryCard,
  args: { category }, decorators: [Story => <MemoryRouter><div style={{ width: 260 }}><Story /></div></MemoryRouter>] } satisfies Meta<typeof CategoryCard>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const NoImage: Story = { args: { category: { ...category, imageUrl: null } } };
