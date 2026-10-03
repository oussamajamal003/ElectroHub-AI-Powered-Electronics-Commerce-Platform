import type { Meta, StoryObj } from '@storybook/react-vite';
import { MemoryRouter } from 'react-router-dom';
import { WishlistPageContent } from './WishlistPage';
import { wishlistFixture, wishlistProduct } from '@/features/wishlist/fixtures';

const meta = { title: 'Customer/Wishlist Page', component: WishlistPageContent,
  decorators: [Story => <MemoryRouter><Story /></MemoryRouter>],
  args: { wishlist: wishlistFixture(), onAddToCart: async () => undefined, onNavigate: () => undefined },
} satisfies Meta<typeof WishlistPageContent>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Guest: Story = {};
export const Authenticated: Story = {};
export const Empty: Story = { args: { wishlist: wishlistFixture({ data: { items: [], totalItems: 0 }, productIds: [], totalItems: 0 }) } };
export const Loading: Story = { args: { wishlist: wishlistFixture({ data: undefined, isLoading: true, totalItems: 0 }) } };
export const Error: Story = { args: { wishlist: wishlistFixture({ data: undefined, isError: true }) } };
export const BackgroundError: Story = { args: { wishlist: wishlistFixture({ isError: true }) } };
export const MergeRecovery: Story = { args: { wishlist: wishlistFixture({ mergeError: 'Your saved products could not be merged. They are still saved.', unresolved: [wishlistProduct.id] }) } };
export const OutOfStock: Story = { args: { wishlist: wishlistFixture({ data: { totalItems: 1, items: [{ productId: wishlistProduct.id, availability: 'OUT_OF_STOCK', product: { ...wishlistProduct, availability: 'UNAVAILABLE' } }] } }) } };
export const Unavailable: Story = { args: { wishlist: wishlistFixture({ data: { totalItems: 1, items: [{ productId: wishlistProduct.id, availability: 'UNAVAILABLE', product: null }] } }) } };
export const Pending: Story = { args: { wishlist: wishlistFixture({ pending: [wishlistProduct.id] }) } };
