import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DeliveryNotificationPreferences } from './DeliveryNotificationPreferences';
const mocks=vi.hoisted(()=>({pushSupported:vi.fn(),pushStatus:vi.fn(),enablePush:vi.fn(),disablePush:vi.fn()}));
vi.mock('./pushClient',()=>mocks);
describe('Delivery notification preferences',()=>{
 beforeEach(()=>{vi.clearAllMocks();vi.stubGlobal('Notification',{permission:'default'});mocks.pushSupported.mockReturnValue(true);mocks.pushStatus.mockResolvedValue({available:true,enabled:false});});
 it('requires deliberate permission action and supports disable',async()=>{
  render(<DeliveryNotificationPreferences userId="customer"/>);
  await waitFor(()=>expect(screen.getByRole('button',{name:'Enable Delivery Notifications'})).toBeEnabled());
  expect(mocks.enablePush).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Enable Delivery Notifications'}));
  await screen.findByRole('button',{name:'Disable Delivery Notifications'});expect(mocks.enablePush).toHaveBeenCalledWith('customer');
  fireEvent.click(screen.getByRole('button',{name:'Disable Delivery Notifications'}));await screen.findByRole('button',{name:'Enable Delivery Notifications'});expect(mocks.disablePush).toHaveBeenCalledWith('customer');
 });
 it('reports unsupported and unavailable states without requesting permission',async()=>{
  mocks.pushSupported.mockReturnValue(false);const view=render(<DeliveryNotificationPreferences userId="customer"/>);
  expect(screen.getByText(/cannot enable Web Push/)).toBeVisible();expect(mocks.enablePush).not.toHaveBeenCalled();view.unmount();
  mocks.pushSupported.mockReturnValue(true);mocks.pushStatus.mockResolvedValue({available:false,enabled:false});render(<DeliveryNotificationPreferences userId="customer"/>);
  await screen.findByText(/not available yet/);expect(screen.getByRole('button',{name:'Enable Delivery Notifications'})).toBeDisabled();
 });
 it('shows permission denial and allows recovery from lookup errors',async()=>{
  mocks.pushStatus.mockRejectedValueOnce(new Error('unavailable'));render(<DeliveryNotificationPreferences userId="customer"/>);
  await screen.findByRole('alert');fireEvent.click(screen.getByRole('button',{name:'Retry'}));
  await waitFor(()=>expect(screen.getByRole('button',{name:'Enable Delivery Notifications'})).toBeEnabled());
  mocks.enablePush.mockRejectedValue(new Error('Notifications are blocked. You can allow them in your browser settings.'));
  fireEvent.click(screen.getByRole('button',{name:'Enable Delivery Notifications'}));expect(await screen.findByRole('alert')).toHaveTextContent('browser settings');
 });
});
