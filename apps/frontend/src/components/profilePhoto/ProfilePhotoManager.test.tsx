import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProfilePhotoManager } from './ProfilePhotoManager';
import { useProfilePhoto, useProfilePhotoMutations } from '@/features/profilePhoto/queries';

vi.mock('@/features/profilePhoto/queries', () => ({ useProfilePhoto: vi.fn(), useProfilePhotoMutations: vi.fn() }));

const upload = vi.fn();
const remove = vi.fn();

describe('ProfilePhotoManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useProfilePhoto).mockReturnValue({ data: { url: null, expiresAt: null }, isError: false } as never);
    vi.mocked(useProfilePhotoMutations).mockReturnValue({
      upload: { mutateAsync: upload, isPending: false }, remove: { mutateAsync: remove, isPending: false },
    } as never);
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:profile-preview') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  });

  it('offers accessible upload and camera actions with initials as the fallback avatar', () => {
    render(<ProfilePhotoManager scope="customer" userId="user-1" sessionVerified initials="JD" displayName="Jane Doe" />);
    expect(screen.getByRole('region', { name: 'Profile photo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: "Edit Jane Doe's profile photo" })).toBeInTheDocument();
    expect(screen.getByText('JD')).toBeInTheDocument();
  });

  async function chooseMenuAction(label: RegExp | string, displayName = 'Jane Doe') {
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: `Edit ${displayName}'s profile photo` }));
    await user.click(await screen.findByRole('menuitem', { name: label }));
  }

  it('validates file types before upload', async () => {
    render(<ProfilePhotoManager scope="admin" userId="admin-1" sessionVerified initials="AD" displayName="Admin Doe" />);
    await chooseMenuAction('Upload photo', 'Admin Doe');
    fireEvent.change(screen.getByLabelText('Choose a profile photo'), {
      target: { files: [new File(['not an image'], 'notes.txt', { type: 'text/plain' })] },
    });
    expect(await screen.findByText('Choose a JPEG, PNG, or WebP image.')).toBeInTheDocument();
    expect(upload).not.toHaveBeenCalled();
  });

  it('rejects files larger than five megabytes before upload', async () => {
    render(<ProfilePhotoManager scope="customer" userId="user-1" sessionVerified initials="JD" displayName="Jane Doe" />);
    await chooseMenuAction('Upload photo');
    fireEvent.change(screen.getByLabelText('Choose a profile photo'), {
      target: { files: [new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' })] },
    });
    expect(await screen.findByText('Choose an image that is 5 MB or smaller.')).toBeInTheDocument();
    expect(upload).not.toHaveBeenCalled();
  });

  it('previews and persists a valid selection, then announces success', async () => {
    upload.mockResolvedValueOnce({ url: 'https://storage.example/signed', expiresAt: '2030-01-01T00:30:00.000Z' });
    render(<ProfilePhotoManager scope="customer" userId="user-1" sessionVerified initials="JD" displayName="Jane Doe" />);
    await chooseMenuAction('Upload photo');
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'portrait.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Choose a profile photo'), { target: { files: [file] } });
    expect(await screen.findByRole('heading', { name: 'Preview profile photo' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save photo' }));
    await waitFor(() => expect(upload).toHaveBeenCalledWith(file));
    expect(await screen.findByRole('status')).toHaveTextContent('Profile photo updated.');
  });

  it('offers native mobile camera capture when browser camera access is unavailable', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
    render(<ProfilePhotoManager scope="customer" userId="user-1" sessionVerified initials="JD" displayName="Jane Doe" />);
    await chooseMenuAction('Take photo');
    expect(await screen.findByRole('status')).toHaveTextContent('Live camera access is unavailable here. Use your device camera or choose a photo.');
    const cameraInput = screen.getByLabelText('Take a profile photo with your device camera');
    expect(cameraInput).toHaveAttribute('accept', 'image/*');
    expect(cameraInput).toHaveAttribute('capture', 'user');
    fireEvent.change(cameraInput, { target: { files: [new File(['photo'], 'camera.jpg', { type: 'image/jpeg' })] } });
    expect(await screen.findByRole('heading', { name: 'Preview profile photo' })).toBeInTheDocument();
  });

  it('falls back to photo selection when the user declines camera permission', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
      getUserMedia: vi.fn().mockRejectedValue(new DOMException('Permission denied.', 'NotAllowedError')),
    } });
    render(<ProfilePhotoManager scope="customer" userId="user-1" sessionVerified initials="JD" displayName="Jane Doe" />);
    await chooseMenuAction('Take photo');
    expect(await screen.findByRole('status')).toHaveTextContent('Live camera access was unavailable or declined. Use your device camera or choose a photo.');
    expect(screen.getByRole('button', { name: 'Use device camera' })).toBeInTheDocument();
  });

  it('removes a saved photo and restores the default avatar', async () => {
    vi.mocked(useProfilePhoto).mockReturnValue({ data: { url: 'https://storage.example/private', expiresAt: '2030-01-01T00:30:00.000Z' }, isError: false } as never);
    remove.mockResolvedValueOnce(undefined);
    render(<ProfilePhotoManager scope="admin" userId="admin-1" sessionVerified initials="AD" displayName="Admin Doe" />);
    await chooseMenuAction('Remove photo', 'Admin Doe');
    await waitFor(() => expect(remove).toHaveBeenCalledOnce());
    expect(await screen.findByRole('status')).toHaveTextContent('Profile photo removed.');
  });

  it('captures a camera photo, supports retake, and stops the stream when cancelled', async () => {
    const track = { stop: vi.fn() };
    const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [track] });
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
    Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, get: () => 640 });
    Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, get: () => 480 });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callback(new Blob(['photo'], { type: 'image/jpeg' })));
    render(<ProfilePhotoManager scope="customer" userId="user-1" sessionVerified initials="JD" displayName="Jane Doe" />);

    await chooseMenuAction('Take photo');
    expect(await screen.findByLabelText('Live camera preview')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Capture photo' }));
    expect(await screen.findByRole('button', { name: 'Retake' })).toBeInTheDocument();
    expect(track.stop).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: 'Retake' }));
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(track.stop).toHaveBeenCalledTimes(2);
  });

  it('stops a camera stream that resolves after the editor unmounts', async () => {
    const track = { stop: vi.fn() };
    let resolveStream: ((stream: MediaStream) => void) | undefined;
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
      getUserMedia: vi.fn(() => new Promise<MediaStream>(resolve => { resolveStream = resolve; })),
    } });
    const view = render(<ProfilePhotoManager scope="customer" userId="user-1" sessionVerified initials="JD" displayName="Jane Doe" />);
    await chooseMenuAction('Take photo');
    view.unmount();
    await act(async () => { resolveStream?.({ getTracks: () => [track as unknown as MediaStreamTrack] } as MediaStream); });
    await waitFor(() => expect(track.stop).toHaveBeenCalledOnce());
  });

  it('keeps the native file inputs hidden so no "No file chosen" text can render', () => {
    render(<ProfilePhotoManager scope="customer" userId="user-1" sessionVerified initials="JD" displayName="Jane Doe" />);
    expect(screen.getByLabelText('Choose a profile photo')).not.toBeVisible();
    expect(screen.getByLabelText('Take a profile photo with your device camera')).not.toBeVisible();
    expect(screen.getByText('JPEG, PNG or WebP · Maximum 5 MB')).toBeInTheDocument();
    expect(screen.queryByText(/No file chosen/i)).not.toBeInTheDocument();
  });

  it('opens the edit menu, not an empty preview, when the avatar has no saved photo', async () => {
    const user = userEvent.setup();
    render(<ProfilePhotoManager scope="customer" userId="user-1" sessionVerified initials="JD" displayName="Jane Doe" />);
    await user.click(screen.getByRole('button', { name: 'Add a profile photo for Jane Doe' }));
    expect(await screen.findByRole('menuitem', { name: 'Upload photo' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'View' })).not.toBeInTheDocument();
  });

  it('opens an accessible preview dialog when a saved photo is clicked and restores focus on Escape', async () => {
    vi.mocked(useProfilePhoto).mockReturnValue({ data: { url: 'https://storage.example/private', expiresAt: '2030-01-01T00:30:00.000Z' }, isError: false } as never);
    const user = userEvent.setup();
    render(<ProfilePhotoManager scope="admin" userId="admin-1" sessionVerified initials="AD" displayName="Admin Doe" />);
    const avatar = screen.getByRole('button', { name: "View Admin Doe's profile photo" });
    await user.click(avatar);
    const dialog = await screen.findByRole('dialog', { name: 'Profile photo' });
    expect(within(dialog).getByRole('img', { name: "Admin Doe's profile photo" })).toHaveAttribute('src', 'https://storage.example/private');
    expect(upload).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(avatar).toHaveFocus());
  });

  it('hides an expired or broken signed photo link and refreshes it once', async () => {
    const refetch = vi.fn();
    vi.mocked(useProfilePhoto).mockReturnValue({ data: { url: 'https://storage.example/expired', expiresAt: '2030-01-01T00:30:00.000Z' }, isError: false, refetch } as never);
    const user = userEvent.setup();
    render(<ProfilePhotoManager scope="customer" userId="user-1" sessionVerified initials="JD" displayName="Jane Doe" />);
    await user.click(screen.getByRole('button', { name: "View Jane Doe's profile photo" }));
    fireEvent.error(within(await screen.findByRole('dialog')).getByRole('img'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(refetch).toHaveBeenCalledOnce();
    expect(screen.getByText(/Your saved photo could not be loaded/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: "Change Jane Doe's profile photo" })).toBeInTheDocument();
  });
  it('keeps the upload preview open while saving so Escape cannot discard an in-flight selection', async () => {
    const props = { scope: 'customer' as const, userId: 'user-1', sessionVerified: true, initials: 'JD', displayName: 'Jane Doe' };
    const view = render(<ProfilePhotoManager {...props} />);
    fireEvent.change(screen.getByLabelText('Choose a profile photo'), { target: { files: [new File(['image'], 'photo.png', { type: 'image/png' })] } });
    expect(await screen.findByRole('dialog', { name: 'Preview profile photo' })).toBeInTheDocument();
    vi.mocked(useProfilePhotoMutations).mockReturnValue({ upload: { mutateAsync: upload, isPending: true }, remove: { mutateAsync: remove, isPending: false } } as never);
    view.rerender(<ProfilePhotoManager {...props} />);
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
  });

});
