import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    render(<ProfilePhotoManager scope="customer" userId="user-1" initials="JD" displayName="Jane Doe" />);
    expect(screen.getByRole('region', { name: 'Profile photo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Upload photo/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Take photo/ })).toBeInTheDocument();
    expect(screen.getByText('JD')).toBeInTheDocument();
  });

  it('validates file types before upload', async () => {
    render(<ProfilePhotoManager scope="admin" userId="admin-1" initials="AD" displayName="Admin Doe" />);
    fireEvent.click(screen.getByRole('button', { name: /Upload photo/ }));
    fireEvent.change(screen.getByLabelText('Choose a profile photo'), {
      target: { files: [new File(['not an image'], 'notes.txt', { type: 'text/plain' })] },
    });
    expect(await screen.findByText('Choose a JPEG, PNG, or WebP image.')).toBeInTheDocument();
    expect(upload).not.toHaveBeenCalled();
  });

  it('previews and persists a valid selection, then announces success', async () => {
    upload.mockResolvedValueOnce({ url: 'https://storage.example/signed', expiresAt: '2030-01-01T00:30:00.000Z' });
    render(<ProfilePhotoManager scope="customer" userId="user-1" initials="JD" displayName="Jane Doe" />);
    fireEvent.click(screen.getByRole('button', { name: /Upload photo/ }));
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'portrait.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Choose a profile photo'), { target: { files: [file] } });
    expect(await screen.findByRole('heading', { name: 'Preview profile photo' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save photo' }));
    await waitFor(() => expect(upload).toHaveBeenCalledWith(file));
    expect(await screen.findByRole('status')).toHaveTextContent('Profile photo saved.');
  });

  it('announces camera fallback when browser camera access is unavailable', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
    render(<ProfilePhotoManager scope="customer" userId="user-1" initials="JD" displayName="Jane Doe" />);
    fireEvent.click(screen.getByRole('button', { name: /Take photo/ }));
    expect(await screen.findByRole('status')).toHaveTextContent('Camera access is unavailable here. Choose a photo from your device instead.');
  });

  it('falls back to photo selection when the user declines camera permission', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
      getUserMedia: vi.fn().mockRejectedValue(new DOMException('Permission denied.', 'NotAllowedError')),
    } });
    render(<ProfilePhotoManager scope="customer" userId="user-1" initials="JD" displayName="Jane Doe" />);
    fireEvent.click(screen.getByRole('button', { name: /Take photo/ }));
    expect(await screen.findByRole('status')).toHaveTextContent('Camera access was unavailable or declined. Choose a photo from your device instead.');
  });

  it('removes a saved photo and restores the default avatar', async () => {
    vi.mocked(useProfilePhoto).mockReturnValue({ data: { url: 'https://storage.example/private', expiresAt: '2030-01-01T00:30:00.000Z' }, isError: false } as never);
    remove.mockResolvedValueOnce(undefined);
    render(<ProfilePhotoManager scope="admin" userId="admin-1" initials="AD" displayName="Admin Doe" />);
    fireEvent.click(screen.getByRole('button', { name: /Remove/ }));
    await waitFor(() => expect(remove).toHaveBeenCalledOnce());
    expect(await screen.findByRole('status')).toHaveTextContent('Profile photo removed.');
  });
});
