import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DeliveryNotificationPreferences } from './DeliveryNotificationPreferences';

const mocks = vi.hoisted(() => ({ pushStatus: vi.fn(), enablePush: vi.fn(), disablePush: vi.fn(), pushSupported: vi.fn() }));
vi.mock('./pushClient', () => mocks);

const permission = (value: NotificationPermission) => vi.stubGlobal('Notification', { permission: value });
const enableButton = () => screen.getByRole('button', { name: 'Enable delivery notifications' });
const card = () => within(screen.getByRole('region', { name: 'Delivery Notifications' }));

describe('Delivery notification preferences', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    permission('default');
    mocks.pushSupported.mockReturnValue(true);
    mocks.pushStatus.mockResolvedValue({ available: true, enabled: false });
    mocks.enablePush.mockResolvedValue(undefined);
    mocks.disablePush.mockResolvedValue(undefined);
  });

  it('asks for permission only from the Enable button and can be turned off again', async () => {
    render(<DeliveryNotificationPreferences userId="customer" />);
    await waitFor(() => expect(enableButton()).toBeEnabled());
    expect(card().getByText('Available')).toBeVisible();
    // Mounting and reading the status never opens the browser prompt.
    expect(mocks.enablePush).not.toHaveBeenCalled();
    fireEvent.click(enableButton());
    await screen.findByRole('button', { name: 'Turn off notifications' });
    expect(mocks.enablePush).toHaveBeenCalledWith('customer');
    expect(card().getByText('On')).toBeVisible();
    expect(screen.getByText('Notifications are on for this browser.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Turn off notifications' }));
    await waitFor(() => expect(enableButton()).toBeEnabled());
    expect(mocks.disablePush).toHaveBeenCalledWith('customer');
  });

  it('explains an unsupported browser without offering a control or asking for permission', () => {
    mocks.pushSupported.mockReturnValue(false);
    render(<DeliveryNotificationPreferences userId="customer" />);
    expect(screen.getByText(/cannot show delivery alerts here/)).toBeVisible();
    expect(card().getByText('Not supported here')).toBeVisible();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(mocks.pushStatus).not.toHaveBeenCalled();
    expect(mocks.enablePush).not.toHaveBeenCalled();
  });

  it('keeps the control disabled while the server reports push unavailable, and Check again re-reads it', async () => {
    mocks.pushStatus.mockResolvedValue({ available: false, enabled: false });
    render(<DeliveryNotificationPreferences userId="customer" />);
    expect(await screen.findByText(/Browser alerts are not available right now/)).toBeVisible();
    expect(screen.getByText(/still get order updates by email/)).toBeVisible();
    expect(card().getByText('Unavailable')).toBeVisible();
    expect(enableButton()).toBeDisabled();

    // Still unavailable: the customer is told the check ran, and the control stays disabled.
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    expect(await screen.findByText('Checked just now: browser alerts are still unavailable.')).toBeVisible();
    expect(mocks.pushStatus).toHaveBeenCalledTimes(2);
    expect(enableButton()).toBeDisabled();

    // Available on the next check: the control enables, and permission is still not requested until it is pressed.
    mocks.pushStatus.mockResolvedValue({ available: true, enabled: false });
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(enableButton()).toBeEnabled());
    expect(screen.queryByText(/not available right now/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Check again' })).not.toBeInTheDocument();
    expect(mocks.enablePush).not.toHaveBeenCalled();
  });

  it('claims nothing about availability when the lookup fails, and recovers on Check again', async () => {
    mocks.pushStatus.mockRejectedValueOnce(new Error('offline'));
    render(<DeliveryNotificationPreferences userId="customer" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('could not check your notification settings');
    expect(screen.getByText('Notification status could not be checked.')).toBeVisible();
    expect(screen.queryByText(/not available right now/)).not.toBeInTheDocument();
    expect(card().queryByText('Unavailable')).not.toBeInTheDocument();
    expect(enableButton()).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(enableButton()).toBeEnabled());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows a browser block as its own state and reports a denied prompt', async () => {
    permission('denied');
    const view = render(<DeliveryNotificationPreferences userId="customer" />);
    expect(await screen.findByText(/This browser is blocking notifications for ElectroHub/)).toBeVisible();
    expect(card().getByText('Blocked in browser')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Check again' })).toBeEnabled();
    view.unmount();

    permission('default');
    mocks.enablePush.mockImplementation(async () => {
      permission('denied');
      throw new Error('Notifications are blocked. You can allow them in your browser settings.');
    });
    render(<DeliveryNotificationPreferences userId="customer" />);
    await waitFor(() => expect(enableButton()).toBeEnabled());
    fireEvent.click(enableButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('browser settings');
    expect(card().getByText('Blocked in browser')).toBeVisible();
  });

  it('keeps the previous state and explains when enabling fails for another reason', async () => {
    mocks.enablePush.mockRejectedValue(new Error('Permission was not granted. You can try again when ready.'));
    render(<DeliveryNotificationPreferences userId="customer" />);
    await waitFor(() => expect(enableButton()).toBeEnabled());
    fireEvent.click(enableButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('Permission was not granted');
    expect(enableButton()).toBeEnabled();
    expect(card().getByText('Available')).toBeVisible();
  });
});
