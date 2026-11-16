import type { Meta, StoryObj } from '@storybook/react-vite';
import { ProductGallery } from './ProductGallery';

const images = [
  { id: 'front', src: '/images/catalog/laptops.jpg', alt: 'Graphite laptop front view' },
  { id: 'side', src: '/images/catalog/laptops-detail.jpg', alt: 'Laptop side detail view' },
];
const meta = { title: 'Catalog/ProductGallery', component: ProductGallery, args: { images }, parameters: { layout: 'centered' } } satisfies Meta<typeof ProductGallery>;
export default meta;
type Story = StoryObj<typeof meta>;
export const OneImage: Story = { args: { images: [images[0]!] } };
export const MultiImage: Story = {};
export const SecondarySelected: Story = { args: { selectedIndex: 1 } };
