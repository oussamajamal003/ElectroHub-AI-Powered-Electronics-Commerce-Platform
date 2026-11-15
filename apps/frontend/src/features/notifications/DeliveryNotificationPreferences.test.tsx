import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DeliveryNotificationPreferences } from './DeliveryNotificationPreferences';

const mocks = vi.hoisted(() => ({ pushStatus: vi.fn(), enablePush: vi.fn(), disablePush: vi.fn(), pushSupported: vi.fn(),
  PushSetupError: class PushSetupError extends Error { constructor(readonly stage: string, message: string) { super(message); } } }));
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
    mocks.enablePush.mockImplementation(async () => { permission('granted'); });
    mocks.disablePush.mockResolvedValue(undefined);
  });

  it('asks for permission only from the Enable button and can be turned off again', async () => {
    render(<DeliveryNotificationPreferences userId="customer" />);
    await waitFor(() => expect(enableButton()).toBeEnabled());
    expect(card().getByText('Permission required')).toBeVisible();
    expect(screen.getByText('Browser permission has not been granted.')).toBeVisible();
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

  it('shows Turn off on initial load when this browser already has an active account subscription', async () => {
    permission('granted');
    mocks.pushStatus.mockResolvedValue({ available: true, enabled: true });
    render(<DeliveryNotificationPreferences userId="customer" />);

    // Until the authenticated server and browser subscription are checked, do not flash an Enable action.
    expect(screen.getByRole('button', { name: 'Checking notifications…' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Enable delivery notifications' })).not.toBeInTheDocument();

    expect(await screen.findByRole('button', { name: 'Turn off notifications' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Enable delivery notifications' })).not.toBeInTheDocument();
    expect(card().getByText('On')).toBeVisible();
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

  it('distinguishes server push configuration from a granted browser with no account subscription', async () => {
    permission('granted');
    mocks.pushStatus.mockResolvedValue({ available: false, enabled: false });
    render(<DeliveryNotificationPreferences userId="customer" />);
    expect(await screen.findByText('Setup unavailable', { exact: true })).toBeVisible();
    expect(screen.getByText(/Server notification setup is unavailable/)).toBeVisible();
    expect(screen.getByText(/Order emails are sent separately/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Retry notifications setup' })).toBeEnabled();

    // Configuration remains unavailable, with a clear check result and a retry action.
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    expect(await screen.findByText('Checked just now: server notification setup is unavailable.')).toBeVisible();
    expect(mocks.pushStatus).toHaveBeenCalledTimes(2);

    // Server setup recovering does not claim enabled before the browser subscription exists.
    mocks.pushStatus.mockResolvedValue({ available: true, enabled: false });
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Finish notification setup' })).toBeEnabled());
    expect(screen.getByText(/Browser permission is granted; device setup is still required/)).toBeVisible();
    expect(mocks.enablePush).not.toHaveBeenCalled();
  });

  it('shows setup required when browser permission and server configuration are ready but no subscription is linked', async () => {
    permission('granted');
    render(<DeliveryNotificationPreferences userId="customer" />);
    expect(await screen.findByText('Setup required', { exact: true })).toBeVisible();
    expect(screen.getByText(/no active account subscription is linked/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Finish notification setup' })).toBeEnabled();
  });

  it('claims nothing about availability when the lookup fails, and recovers on Check again', async () => {
    mocks.pushStatus.mockRejectedValueOnce(new Error('offline'));
    render(<DeliveryNotificationPreferences userId="customer" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('could not check notification setup right now');
    expect(screen.getByText('Notifications are not active on this browser.')).toBeVisible();
    expect(card().getByText('Temporarily unavailable')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(enableButton()).toBeEnabled());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows a browser block as its own state and reports a denied prompt', async () => {
    permission('denied');
    const view = render(<DeliveryNotificationPreferences userId="customer" />);
    expect(await screen.findByText(/Notifications are blocked for ElectroHub/)).toBeVisible();
    expect(card().getByText('Permission blocked')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Check again' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Enable delivery notifications' })).not.toBeInTheDocument();
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
    expect(card().getByText('Permission blocked')).toBeVisible();
  });

  it('keeps the previous state and explains when enabling fails for another reason', async () => {
    mocks.enablePush.mockRejectedValue(new Error('Permission was not granted. You can try again when ready.'));
    render(<DeliveryNotificationPreferences userId="customer" />);
    await waitFor(() => expect(enableButton()).toBeEnabled());
    fireEvent.click(enableButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('Permission was not granted');
    expect(screen.getByRole('button', { name: 'Retry notifications setup' })).toBeEnabled();
    expect(card().getByText('Temporarily unavailable')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Retry notifications setup' })).toBeEnabled();
  });

  it('does not claim enabled when push initialization fails and recovers when retried', async () => {
    mocks.enablePush.mockRejectedValueOnce(new Error('Service worker setup failed')).mockImplementationOnce(async () => { permission('granted'); });
    render(<DeliveryNotificationPreferences userId="customer" />);
    await waitFor(() => expect(enableButton()).toBeEnabled());
    fireEvent.click(enableButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('Service worker setup failed');
    expect(card().getByText('Temporarily unavailable')).toBeVisible();
    expect(screen.queryByText('Notifications are on for this browser.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry notifications setup' }));
    expect(await screen.findByRole('button', { name: 'Turn off notifications' })).toBeEnabled();
  });

  it('keeps service-worker failure distinct and safe for retry', async () => {
    mocks.enablePush.mockRejectedValue(new mocks.PushSetupError('service_worker', 'The notification worker could not be installed. Check browser site settings and retry.'));
    render(<DeliveryNotificationPreferences userId="customer" />);
    await waitFor(() => expect(enableButton()).toBeEnabled());
    fireEvent.click(enableButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('notification worker could not be installed');
    expect(card().getByText('Temporarily unavailable')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Retry notifications setup' })).toBeEnabled();
  });

  it('prevents repeated activation while an initialization is in flight', async () => {
    let finish!: () => void;
    mocks.enablePush.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    render(<DeliveryNotificationPreferences userId="customer" />);
    await waitFor(() => expect(enableButton()).toBeEnabled());
    const enable = enableButton();
    fireEvent.click(enable);
    fireEvent.click(enable);
    expect(mocks.enablePush).toHaveBeenCalledTimes(1);
    permission('granted');
    finish();
    await screen.findByRole('button', { name: 'Turn off notifications' });
  });

  it('does not repeat status or push initialization when the account card rerenders', async () => {
    const view = render(<DeliveryNotificationPreferences userId="customer" />);
    await waitFor(() => expect(enableButton()).toBeEnabled());
    view.rerender(<DeliveryNotificationPreferences userId="customer" />);
    await waitFor(() => expect(mocks.pushStatus).toHaveBeenCalledTimes(1));
    expect(mocks.enablePush).not.toHaveBeenCalled();
  });
});
