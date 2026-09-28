import type { Meta, StoryObj } from '@storybook/react-vite';
import { ElectroHubLoader } from './ElectroHubLoader';

const meta = {
  title: 'Components/ElectroHubLoader',
  component: ElectroHubLoader,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof ElectroHubLoader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Small: Story = { args: { size: 'sm' } };
export const Medium: Story = { args: { size: 'md' } };
export const Large: Story = { args: { size: 'lg' } };
export const Page: Story = { args: { size: 'lg', page: true }, parameters: { layout: 'fullscreen' } };
