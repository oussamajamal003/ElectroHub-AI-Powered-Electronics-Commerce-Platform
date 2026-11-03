import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminProductFormPage } from './AdminProductFormPage';
import {
  useAdminProduct, useCatalogOptions, useCreateProduct, useDeleteProduct, useProductStatus, useUpdateProduct, type AdminProduct,
} from '@/features/admin/products/api';

vi.mock('@/features/admin/products/api', async importOriginal => ({
  ...await importOriginal<object>(), useAdminProduct: vi.fn(), useCatalogOptions: vi.fn(), useCreateProduct: vi.fn(), useUpdateProduct: vi.fn(),
  useProductStatus: vi.fn(), useDeleteProduct: vi.fn(),
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
    vi.mocked(useProductStatus).mockReturnValue(mutation() as never);
    vi.mocked(useDeleteProduct).mockReturnValue(mutation() as never);
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

// Real-looking catalog: Apple appears in two categories, Sony in one, Nokia in none (a brand with no products yet).
const IDS = { phones: 'c1', laptops: 'c2', audio: 'c3', hidden: 'c4', apple: 'b1', sony: 'b2', nokia: 'b3' };
const CATALOG = { data: { data: {
  categories: [{ id: IDS.audio, name: 'Audio', isActive: true }, { id: IDS.laptops, name: 'Laptops', isActive: true },
    { id: IDS.phones, name: 'Smartphones', isActive: true }, { id: IDS.hidden, name: 'Archive bin', isActive: false }],
  brands: [{ id: IDS.apple, name: 'Apple' }, { id: IDS.nokia, name: 'Nokia' }, { id: IDS.sony, name: 'Sony' }],
  pairs: [{ categoryId: IDS.phones, brandId: IDS.apple, products: 7 }, { categoryId: IDS.laptops, brandId: IDS.apple, products: 3 },
    { categoryId: IDS.audio, brandId: IDS.sony, products: 4 }],
} } };

function renderNew() {
  window.history.replaceState(null, '', '/admin/products/new');
  render(<BrowserRouter><Routes><Route path="/admin/products/new" element={<AdminProductFormPage />} /></Routes></BrowserRouter>);
}
const pick = (label: RegExp, option: string) => {
  fireEvent.click(screen.getByRole('button', { name: label }));
  fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: new RegExp(`^${option}`) }));
};

describe('AdminProductFormPage catalog choices and publishing', () => {
  let create: ReturnType<typeof mutation>;
  beforeEach(() => {
    create = mutation();
    vi.mocked(useAdminProduct).mockReturnValue({ isPending: false, data: undefined } as never);
    vi.mocked(useCatalogOptions).mockReturnValue(CATALOG as never);
    vi.mocked(useCreateProduct).mockReturnValue(create as never);
    vi.mocked(useUpdateProduct).mockReturnValue(mutation() as never);
    vi.mocked(useProductStatus).mockReturnValue(mutation() as never);
    vi.mocked(useDeleteProduct).mockReturnValue(mutation() as never);
  });

  it('fills an empty category only when the brand has exactly one, and says so', () => {
    renderNew();
    pick(/^Brand/, 'Sony');
    expect(screen.getByRole('button', { name: /^Category/ })).toHaveTextContent('Audio');
    expect(screen.getByText(/Set to Audio, the only category with Sony products/)).toBeInTheDocument();
  });

  it('ranks the categories a brand already uses first, without restricting the others', () => {
    renderNew();
    pick(/^Brand/, 'Apple');
    expect(screen.getByRole('button', { name: /^Category/ })).toHaveTextContent('Choose a category');
    fireEvent.click(screen.getByRole('button', { name: /^Category/ }));
    const options = within(screen.getByRole('listbox')).getAllByRole('option');
    expect(options.map(option => option.textContent)).toEqual(['Smartphones7 products', 'Laptops3 products', 'Audio', 'Archive bin (hidden)']);
    expect(within(screen.getByRole('listbox')).getByRole('group', { name: 'Used with Apple' })).toBeInTheDocument();
    expect(options[3]).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(options[2]!);
    expect(screen.getByRole('button', { name: /^Category/ })).toHaveTextContent('Audio');
  });

  it('never changes a category the admin already chose, and accepts a brand with no products yet', () => {
    renderNew();
    pick(/^Category/, 'Laptops');
    pick(/^Brand/, 'Nokia');
    expect(screen.getByRole('button', { name: /^Category/ })).toHaveTextContent('Laptops');
    expect(screen.getByRole('button', { name: /^Brand/ })).toHaveTextContent('Nokia');
  });

  it('searches long lists and filters options as the admin types', () => {
    renderNew();
    fireEvent.click(screen.getByRole('button', { name: /^Category/ }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Search category' }), { target: { value: 'lap' } });
    expect(within(screen.getByRole('listbox')).getAllByRole('option').map(option => option.textContent)).toEqual(['Laptops']);
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Search category' }), { key: 'Enter' });
    expect(screen.getByRole('button', { name: /^Category/ })).toHaveTextContent('Laptops');
  });

  it('sends status ACTIVE when Publish now is chosen, and INACTIVE for a draft', () => {
    renderNew();
    fireEvent.change(screen.getByLabelText(/Product name/), { target: { value: 'Galaxy Probe' } });
    fireEvent.change(screen.getByLabelText(/^SKU/), { target: { value: 'QA-PUB-1' } });
    fireEvent.change(screen.getByLabelText(/^Price/), { target: { value: '19.99' } });
    pick(/^Category/, 'Smartphones');
    expect(screen.getByRole('radio', { name: 'Save as draft' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('radio', { name: 'Publish now' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create and publish' }));
    expect(create.mutate).toHaveBeenCalledWith(expect.objectContaining({ status: 'ACTIVE', categoryId: IDS.phones, sku: 'QA-PUB-1' }), expect.anything());
    fireEvent.click(screen.getByRole('radio', { name: 'Save as draft' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create draft' }));
    expect(create.mutate).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'INACTIVE' }), expect.anything());
  });

  it('keeps submit disabled until categories and brands have loaded', () => {
    vi.mocked(useCatalogOptions).mockReturnValue({ data: undefined, isPending: true } as never);
    renderNew();
    expect(screen.getByRole('button', { name: 'Create draft' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^Category/ })).toHaveTextContent('Loading categories…');
  });
});

describe('AdminProductFormPage lifecycle actions', () => {
  const product = (overrides: Partial<AdminProduct> = {}): AdminProduct => ({
    id: 'p1', name: 'QA Draft', sku: 'QA-DRAFT', slug: 'qa-draft', price: '10.00', compareAtPrice: null, currency: 'USD', status: 'INACTIVE',
    category: { id: IDS.audio, name: 'Audio', isActive: true }, brand: null, image: null, imageCount: 0, inventory: null, storefrontVisible: false,
    createdAt: '2026-11-03T10:00:00.000Z', updatedAt: '2026-11-03T10:00:00.000Z', description: null, modelNumber: null, specifications: [],
    orderLineCount: 0, deletable: true, deleteBlocker: null, ...overrides,
  });
  let remove: ReturnType<typeof mutation>;
  function renderEdit(item: AdminProduct) {
    vi.mocked(useAdminProduct).mockReturnValue({ isPending: false, data: { data: item } } as never);
    window.history.replaceState(null, '', '/admin/products/p1/edit');
    render(<BrowserRouter><Routes><Route path="/admin/products/:productId/edit" element={<AdminProductFormPage />} /></Routes></BrowserRouter>);
  }
  beforeEach(() => {
    remove = mutation();
    vi.mocked(useCatalogOptions).mockReturnValue(CATALOG as never);
    vi.mocked(useCreateProduct).mockReturnValue(mutation() as never);
    vi.mocked(useUpdateProduct).mockReturnValue(mutation() as never);
    vi.mocked(useProductStatus).mockReturnValue(mutation() as never);
    vi.mocked(useDeleteProduct).mockReturnValue(remove as never);
  });

  it('deletes an eligible draft only after confirmation', () => {
    renderEdit(product());
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));
    expect(remove.mutate).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete permanently' }));
    expect(remove.mutate).toHaveBeenCalledWith('p1', expect.anything());
  });

  it('explains why a product with history cannot be deleted', () => {
    renderEdit(product({ deletable: false, deleteBlocker: 'It is on orders or checkouts, which keep their history. Keep it archived.', orderLineCount: 2 }));
    expect(screen.getByRole('button', { name: 'Delete permanently' })).toBeDisabled();
    expect(screen.getByText(/Permanent deletion is not available. It is on orders or checkouts/)).toBeInTheDocument();
  });

  it('blocks publish and delete while there are unsaved edits', () => {
    renderEdit(product());
    fireEvent.change(screen.getByLabelText(/Product name/), { target: { value: 'QA Draft edited' } });
    expect(screen.getByRole('button', { name: 'Publish' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete permanently' })).toBeDisabled();
  });
});
