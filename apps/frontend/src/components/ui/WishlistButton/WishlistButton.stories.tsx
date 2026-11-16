import type { Meta, StoryObj } from '@storybook/react-vite';
import { WishlistButton } from './WishlistButton';
import { Button } from '@/components/ui/Button';
import detailStyles from '@/pages/customer/ProductDetailPage.module.scss';
const meta = { title: 'Components/Wishlist Button', component: WishlistButton,
  args: { title: 'Apple iPhone 15 Pro', saved: false, onToggle: () => undefined } } satisfies Meta<typeof WishlistButton>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Unsaved: Story = {};
export const Saved: Story = { args: { saved: true } };
export const Pending: Story = { args: { saved: true, pending: true } };
export const Error: Story = { render: args => <div><WishlistButton {...args} /><p role="alert">Wishlist could not be updated. Your previous saved state was restored. Please retry.</p></div> };
export const DetailsActions: Story = { render: args => <div className={detailStyles.purchaseButtons}><Button type="button">Add to Cart</Button><WishlistButton {...args} /></div> };
