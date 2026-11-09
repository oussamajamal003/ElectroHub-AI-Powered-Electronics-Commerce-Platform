import { useEffect, type ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn, userEvent, within } from 'storybook/test';
import { StepUpDialog, type StepUpDialogProps } from './StepUpDialog';

/** Intercepts only this dialog's verification endpoints. All outcomes are synthetic failures; no authentication can complete. */
function SyntheticStepUpBoundary({ children }: { children: ReactNode }) {
  useEffect(() => {
    const originalFetch = window.fetch;
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('/api/admin/me/security/step-up')) {
        return new Response(JSON.stringify({
          error: {
            code: 'MFA_CODE_INVALID',
            message: 'Synthetic Storybook response: verification was not accepted.',
          },
        }), { status: 401, headers: { 'Content-Type': 'application/json' } });
      }
      return originalFetch(input, init);
    };
    return () => { window.fetch = originalFetch; };
  }, []);

  return <>{children}</>;
}

const meta = {
  title: 'Admin/Security/StepUpDialog',
  component: StepUpDialog,
  args: { open: true, onOpenChange: fn(), onVerified: fn() },
  parameters: { layout: 'centered' },
  render: (args: StepUpDialogProps) => <SyntheticStepUpBoundary><StepUpDialog {...args} /></SyntheticStepUpBoundary>,
} satisfies Meta<typeof StepUpDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Authenticator: Story = {};

export const RecoveryCodeSelected: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement.ownerDocument.body).getByRole('tab', { name: 'Recovery code' }));
  },
};

export const PasskeySelected: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement.ownerDocument.body).getByRole('tab', { name: 'Passkey' }));
  },
};
