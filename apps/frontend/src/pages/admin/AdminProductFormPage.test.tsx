import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminProductFormPage } from './AdminProductFormPage';
import { useAdminProduct, useCatalogOptions, useCreateProduct, useUpdateProduct } from '@/features/admin/products/api';

vi.mock('@/features/admin/products/api', async importOriginal => ({
  ...await importOriginal<object>(), useAdminProduct: vi.fn(), useCatalogOptions: vi.fn(), useCreateProduct: vi.fn(), useUpdateProduct: vi.fn(),
}));

const mutation = (overrides = {}) => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, isError: false, isSuccess: false, error: null, ...overrides });

// BrowserRouter on jsdom's real history, so browser Back (popstate) is exercised, not a MemoryRouter stand-in.
function renderForm() {
  window.history.replaceState(null, '', '/admin/products');
  window.history.pushState(null, '', '/admin/products/new');
  render(<BrowserRouter>
    <Link to="/admin/inventory">Inventory</Link>
    <Routes>
      <Route path="/admin/products" element={<p>Products page</p>} />
      <Route path="/admin/products/new" element={<AdminProductFormPage />} />
      <Route path="/admin/inventory" element={<p>Inventory page</p>} />
    </Routes>
  </BrowserRouter>);
}

const edit = (value = 'Unsaved speaker') => fireEvent.change(screen.getByLabelText(/Product name/), { target: { value } });
const back = async () => { await act(async () => { window.history.back(); await new Promise(resolve => setTimeout(resolve, 20)); }); };
const dialog = () => screen.queryByRole('alertdialog') ?? screen.queryByRole('dialog');

describe('AdminProductFormPage unsaved changes', () => {
  beforeEach(() => {
    vi.mocked(useAdminProduct).mockReturnValue({ isPending: false, data: undefined } as never);
    vi.mocked(useCatalogOptions).mockReturnValue({ data: { data: { categories: [], brands: [] } } } as never);
    vi.mocked(useCreateProduct).mockReturnValue(mutation() as never);
    vi.mocked(useUpdateProduct).mockReturnValue(mutation() as never);
  });

  it('leaves without asking while the form is untouched', async () => {
    renderForm();
    fireEvent.click(screen.getByRole('link', { name: 'Inventory' }));
    expect(dialog()).toBeNull();
    expect(screen.getByText('Inventory page')).toBeInTheDocument();
  });

  it('asks in an in-app dialog before a link discards edits, and stays when the admin cancels', () => {
    renderForm();
    edit();
    fireEvent.click(screen.getByRole('link', { name: 'Inventory' }));
    fireEvent.click(within(dialog()!).getByRole('button', { name: 'Cancel' }));
    expect(dialog()).toBeNull();
    expect(screen.queryByText('Inventory page')).toBeNull();
    expect(screen.getByLabelText(/Product name/)).toHaveValue('Unsaved speaker');
  });

  it('navigates once when the admin confirms leaving through a link, without a second prompt', async () => {
    renderForm();
    edit();
    fireEvent.click(screen.getByRole('link', { name: 'Inventory' }));
    await act(async () => { fireEvent.click(within(dialog()!).getByRole('button', { name: 'Leave page' })); await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(await screen.findByText('Inventory page')).toBeInTheDocument();
    expect(dialog()).toBeNull();
    // The Back guard's duplicate entry was removed first: Back returns to the form's own entry, then to the list.
    await back();
    expect(screen.getByLabelText(/Product name/)).toBeInTheDocument();
  });

  it('asks before browser Back discards edits; Cancel keeps the form and Back stays guarded', async () => {
    renderForm();
    edit();
    await back();
    expect(dialog()).not.toBeNull();
    expect(screen.getByLabelText(/Product name/)).toHaveValue('Unsaved speaker');
    fireEvent.click(within(dialog()!).getByRole('button', { name: 'Cancel' }));
    expect(window.location.pathname).toBe('/admin/products/new');

    await back();
    await act(async () => { fireEvent.click(within(dialog()!).getByRole('button', { name: 'Leave page' })); await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(await screen.findByText('Products page')).toBeInTheDocument();
  });

  it('does not ask on Back once the edits are reverted', async () => {
    renderForm();
    edit();
    edit('');
    // Reverting removes the guard's duplicate entry (one async Back); the admin's own Back comes after that settles.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    await back();
    expect(dialog()).toBeNull();
    expect(await screen.findByText('Products page')).toBeInTheDocument();
  });
});
