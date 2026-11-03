import { fireEvent, render, screen } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminProductFormPage } from './AdminProductFormPage';
import { useAdminProduct, useCatalogOptions, useCreateProduct, useUpdateProduct } from '@/features/admin/products/api';

vi.mock('@/features/admin/products/api', async importOriginal => ({
  ...await importOriginal<object>(), useAdminProduct: vi.fn(), useCatalogOptions: vi.fn(), useCreateProduct: vi.fn(), useUpdateProduct: vi.fn(),
}));

const mutation = () => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, isError: false, isSuccess: false, error: null });

function renderForm() {
  render(<MemoryRouter initialEntries={['/admin/products/new']}>
    <Link to="/admin/inventory">Inventory</Link>
    <Routes>
      <Route path="/admin/products/new" element={<AdminProductFormPage />} />
      <Route path="/admin/inventory" element={<p>Inventory page</p>} />
    </Routes>
  </MemoryRouter>);
}

describe('AdminProductFormPage unsaved changes', () => {
  let confirm: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.mocked(useAdminProduct).mockReturnValue({ isPending: false, data: undefined } as never);
    vi.mocked(useCatalogOptions).mockReturnValue({ data: { data: { categories: [], brands: [] } } } as never);
    vi.mocked(useCreateProduct).mockReturnValue(mutation() as never);
    vi.mocked(useUpdateProduct).mockReturnValue(mutation() as never);
    confirm = vi.spyOn(window, 'confirm');
  });
  afterEach(() => { confirm.mockRestore(); });

  it('leaves without asking while the form is untouched', () => {
    renderForm();
    fireEvent.click(screen.getByRole('link', { name: 'Inventory' }));
    expect(confirm).not.toHaveBeenCalled();
    expect(screen.getByText('Inventory page')).toBeInTheDocument();
  });

  it('asks before an in-app link discards edits, and stays when the admin cancels', () => {
    confirm.mockReturnValue(false);
    renderForm();
    fireEvent.change(screen.getByLabelText(/Product name/), { target: { value: 'Unsaved speaker' } });
    fireEvent.click(screen.getByRole('link', { name: 'Inventory' }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Inventory page')).toBeNull();
    expect(screen.getByLabelText(/Product name/)).toHaveValue('Unsaved speaker');
  });

  it('navigates when the admin confirms leaving', () => {
    confirm.mockReturnValue(true);
    renderForm();
    fireEvent.change(screen.getByLabelText(/Product name/), { target: { value: 'Unsaved speaker' } });
    fireEvent.click(screen.getByRole('link', { name: 'Inventory' }));
    expect(screen.getByText('Inventory page')).toBeInTheDocument();
  });
});
