import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminProductMediaPage } from './AdminProductMediaPage';
import type { MediaImage } from '@/features/adminMedia/types';

const mocks = vi.hoisted(() => ({ upload: vi.fn(), replace: vi.fn(), patch: vi.fn(), remove: vi.fn(), retry: vi.fn(), images: [] as MediaImage[], imagesError: false }));
vi.mock('@/features/adminMedia/queries', () => ({
  useAdminMediaProducts: () => ({ data: { data: [{ id: 'product-1', name: 'Studio Headphones', slug: 'studio-headphones' }] } }),
  useAdminMediaProduct: (productId: string) => ({ data: { data: { id: productId, name: productId === 'product-1' ? 'Studio Headphones' : 'Another Product', slug: productId } } }),
  useAdminProductImages: () => ({ data: { data: mocks.images }, isPending: false, isError: mocks.imagesError, refetch: vi.fn() }),
  useMediaMutations: () => ({
    upload: { mutateAsync: mocks.upload, isPending: false }, replace: { mutateAsync: mocks.replace, isPending: false },
    patch: { mutateAsync: mocks.patch, isPending: false }, remove: { mutateAsync: mocks.remove, isPending: false }, retry: { mutateAsync: mocks.retry, isPending: false },
  }),
}));

describe('AdminProductMediaPage upload staging', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.images = [];
    mocks.imagesError = false;
    URL.createObjectURL = vi.fn(() => 'blob:media-preview');
    URL.revokeObjectURL = vi.fn();
  });

  it('shows an image preview before upload and revokes it after confirmed upload', async () => {
    mocks.upload.mockRejectedValueOnce(new Error('Storage unavailable')).mockResolvedValue({ data: { id: 'image-1' } });
    render(<MemoryRouter initialEntries={['/admin/products/product-1/media']}><Routes><Route path="/admin/products/:productId/media" element={<AdminProductMediaPage />} /></Routes></MemoryRouter>);

    const file = new File(['image-bytes'], 'headphones.webp', { type: 'image/webp' });
    fireEvent.change(screen.getByLabelText('Choose product photos'), { target: { files: [file] } });

    expect(await screen.findByRole('region', { name: 'Selected photo previews' })).toBeInTheDocument();
    expect(screen.getByAltText('Preview of headphones.webp')).toHaveAttribute('src', 'blob:media-preview');
    expect(mocks.upload).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Upload 1 photo' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be uploaded');
    expect(screen.getByRole('region', { name: 'Selected photo previews' })).toBeInTheDocument();
    const firstKey = mocks.upload.mock.calls[0]?.[0].idempotencyKey;
    fireEvent.click(screen.getByRole('button', { name: 'Upload 1 photo' }));
    await waitFor(() => expect(mocks.upload).toHaveBeenCalledWith(expect.objectContaining({ file, idempotencyKey: expect.any(String) })));
    expect(firstKey).toMatch(/^[0-9a-f-]{36}$/i);
    expect(mocks.upload.mock.calls[1]?.[0].idempotencyKey).toBe(firstKey);
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:media-preview'));
    expect(await screen.findByText('1 photo published. AI indexing status updates separately.')).toBeInTheDocument();
  });

  it('discards a staged upload and ignores its late response after switching products', async () => {
    let resolveUpload!: (value: { data: { id: string } }) => void;
    mocks.upload.mockImplementationOnce(() => new Promise(resolve => { resolveUpload = resolve; }));
    render(<MemoryRouter initialEntries={['/admin/products/product-1/media']}>
      <Link to="/admin/products/product-2/media">Switch product</Link>
      <Routes><Route path="/admin/products/:productId/media" element={<AdminProductMediaPage />} /></Routes>
    </MemoryRouter>);

    const file = new File(['image-bytes'], 'headphones.webp', { type: 'image/webp' });
    fireEvent.change(screen.getByLabelText('Choose product photos'), { target: { files: [file] } });
    expect(await screen.findByRole('region', { name: 'Selected photo previews' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Upload 1 photo' }));
    await waitFor(() => expect(mocks.upload).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('link', { name: 'Switch product' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Selected photo previews' })).not.toBeInTheDocument());
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:media-preview');
    resolveUpload({ data: { id: 'image-1' } });
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Another Product' })).toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Selected photo previews' })).not.toBeInTheDocument();
  });

  it('keeps the published gallery visible when a background refresh fails', () => {
    mocks.images = [{ id: 'image-1', productId: 'product-1', url: '/photo.webp', altText: 'Front view', sortOrder: 0,
      isPrimary: true, sourceRevision: null, mediaState: 'PUBLISHED', width: null, height: null, updatedAt: '2026-10-28T12:00:00.000Z',
      indexing: { state: 'LEGACY', embeddingVersion: null, errorCode: null } }];
    mocks.imagesError = true;
    render(<MemoryRouter initialEntries={['/admin/products/product-1/media']}><Routes><Route path="/admin/products/:productId/media" element={<AdminProductMediaPage />} /></Routes></MemoryRouter>);

    expect(screen.getByRole('alert')).toHaveTextContent('Product photos could not be loaded');
    expect(screen.getByRole('list', { name: 'Published product photos' })).toBeInTheDocument();
    expect(screen.getByAltText('Front view')).toHaveAttribute('src', '/photo.webp');
  });

  it('keeps descriptive alt text on a loaded admin preview without showing it as a caption', () => {
    mocks.images = [{ id: 'image-1', productId: 'product-1', url: '/photo.webp', altText: 'Front angle of the headphones', sortOrder: 0,
      isPrimary: true, sourceRevision: null, mediaState: 'PUBLISHED', width: 900, height: 900, updatedAt: '2026-10-28T12:00:00.000Z',
      indexing: { state: 'LEGACY', embeddingVersion: null, errorCode: null } }];
    render(<MemoryRouter initialEntries={['/admin/products/product-1/media']}><Routes><Route path="/admin/products/:productId/media" element={<AdminProductMediaPage />} /></Routes></MemoryRouter>);

    const image = screen.getByAltText('Front angle of the headphones');
    fireEvent.load(image);
    expect(image).toHaveAttribute('alt', 'Front angle of the headphones');
    expect(screen.queryByText('Front angle of the headphones')).not.toBeInTheDocument();
  });

  it.each([null, '', '   '])('uses product name and a readable fallback when admin preview alt is %s', altText => {
    mocks.images = [{ id: 'image-1', productId: 'product-1', url: '/missing.webp', altText, sortOrder: 0,
      isPrimary: true, sourceRevision: null, mediaState: 'PUBLISHED', width: 900, height: 900, updatedAt: '2026-10-28T12:00:00.000Z',
      indexing: { state: 'LEGACY', embeddingVersion: null, errorCode: null } }];
    render(<MemoryRouter initialEntries={['/admin/products/product-1/media']}><Routes><Route path="/admin/products/:productId/media" element={<AdminProductMediaPage />} /></Routes></MemoryRouter>);

    const image = screen.getByAltText('Studio Headphones');
    fireEvent.error(image);
    expect(screen.getByRole('img', { name: 'Studio Headphones' })).toBeInTheDocument();
    expect(screen.getByText('Photo unavailable: Studio Headphones')).toBeInTheDocument();
  });

  it('reorders with one position update instead of a stale second neighbor patch', async () => {
    const first: MediaImage = { id: 'image-1', productId: 'product-1', url: '/front.webp', altText: 'Front view', sortOrder: 0,
      isPrimary: true, sourceRevision: null, mediaState: 'PUBLISHED', width: null, height: null, updatedAt: '2026-10-28T12:00:00.000Z',
      indexing: { state: 'LEGACY', embeddingVersion: null, errorCode: null } };
    const second: MediaImage = { ...first, id: 'image-2', url: '/side.webp', altText: 'Side view', sortOrder: 4, isPrimary: false, updatedAt: '2026-10-28T12:00:01.000Z' };
    mocks.images = [first, second];
    mocks.patch.mockResolvedValue({ data: { ...first, sortOrder: 1, updatedAt: '2026-10-28T12:00:02.000Z' } });
    render(<MemoryRouter initialEntries={['/admin/products/product-1/media']}><Routes><Route path="/admin/products/:productId/media" element={<AdminProductMediaPage />} /></Routes></MemoryRouter>);

    fireEvent.click(screen.getByRole('button', { name: 'Move photo 1 down' }));
    await waitFor(() => expect(mocks.patch).toHaveBeenCalledTimes(1));
    expect(mocks.patch).toHaveBeenCalledWith({ image: first, changes: { sortOrder: 1 } });
  });
});
