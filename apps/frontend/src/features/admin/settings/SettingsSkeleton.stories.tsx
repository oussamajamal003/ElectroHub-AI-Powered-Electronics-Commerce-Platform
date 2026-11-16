import type { Meta, StoryObj } from '@storybook/react-vite';
import { SettingsSkeleton } from './components/SettingsSkeleton';

const meta = { title: 'Admin/Settings/Loading', component: SettingsSkeleton } satisfies Meta<typeof SettingsSkeleton>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Store: Story = { args: { section: 'store' } };
export const Shipping: Story = { args: { section: 'shipping' } };
export const Notifications: Story = { args: { section: 'notifications' } };
