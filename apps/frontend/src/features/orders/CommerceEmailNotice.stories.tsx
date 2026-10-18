import type { Meta, StoryObj } from '@storybook/react-vite';
import { CommerceEmailNotice } from './CommerceEmailNotice';

/*
 * The real component with deterministic props. The notice renders only for a PAID, non-cancelled Order;
 * the "nothing rendered" stories document that absence deliberately.
 */

const updatedAt = '2026-09-04T12:02:00.000Z';
const projection = (state: 'QUEUED' | 'DELAYED' | 'SENT' | 'DELIVERED' | 'PARTIAL' | 'UNAVAILABLE') => ({ state, updatedAt });

const meta = {
  title: 'Customer/Order Management/Email Notice',
  component: CommerceEmailNotice,
  args: { paymentState: 'PAID', orderStatus: 'CONFIRMED', emailConfirmation: projection('QUEUED') },
  decorators: [Story => <div style={{ maxWidth: '44rem' }}><Story /></div>],
  parameters: { layout: 'padded' },
} satisfies Meta<typeof CommerceEmailNotice>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Queued: Story = { args: { emailConfirmation: projection('QUEUED') } };
export const Delayed: Story = { args: { emailConfirmation: projection('DELAYED') } };
export const Sent: Story = { args: { emailConfirmation: projection('SENT') } };
export const Delivered: Story = { args: { emailConfirmation: projection('DELIVERED') } };
export const Partial: Story = { args: { emailConfirmation: projection('PARTIAL') } };
export const Unavailable: Story = { args: { emailConfirmation: projection('UNAVAILABLE') } };
export const HistoricalNoProjection: Story = {
  args: { emailConfirmation: null },
  parameters: { docs: { description: { story: 'Historical or email-disabled Order: no projection, so the copy only states that details are saved. It never claims email was queued or sent.' } } },
};
export const PendingPaymentNoSuccessNotice: Story = {
  args: { paymentState: 'PENDING', orderStatus: 'AWAITING_CAPTURE', emailConfirmation: projection('QUEUED') },
  parameters: { docs: { description: { story: 'Renders nothing. A pending payment never shows a success email notice; the existing payment status messaging explains the state.' } } },
};
export const CancelledNoNotice: Story = {
  args: { paymentState: 'PAID', orderStatus: 'CANCELLED', emailConfirmation: projection('SENT') },
  parameters: { docs: { description: { story: 'Renders nothing. A cancelled Order does not show the original success notice as current status.' } } },
};
export const RefundedNoNotice: Story = {
  args: { paymentState: 'REFUNDED', orderStatus: 'CANCELLED', emailConfirmation: projection('SENT') },
  parameters: { docs: { description: { story: 'Renders nothing. A refunded payment is explained by the existing refund status, not by an email notice.' } } },
};
export const LongCopyNarrowContainer: Story = {
  args: { emailConfirmation: projection('UNAVAILABLE') },
  decorators: [Story => <div style={{ width: '320px' }}><Story /></div>],
  parameters: { docs: { description: { story: 'Longest copy inside a 320px container: text wraps naturally with no fixed height and no overflow.' } } },
};
export const Mobile: Story = {
  args: { emailConfirmation: projection('PARTIAL') },
  parameters: { viewport: { defaultViewport: 'mobile390' } },
};
