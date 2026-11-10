import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/Tooltip';
import { AdminToastProvider } from '@/features/admin/shared/AdminUi';
import { AdminCategoriesPage } from './AdminCategoriesPage';

const category = (overrides: Record<string, unknown>) => ({ id: 'c1', name: 'Phones', slug: 'phones', isActive: true, productCount: 0, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', ...overrides });
const state = { rows: [category({ id: 'c1', name: 'Phones', productCount: 0 }), category({ id: 'c2', name: 'Laptops', productCount: 4 })] };

vi.mock('@/features/admin/categories/api', () => ({
  useAdminCategories: () => ({ data: { data: state.rows, meta: { page: 1, pageSize: 20, total: 2, totalPages: 1, summary: { active: 2, inactive: 0 } } }, isPending: false, isError: false, isFetching: false, error: null, refetch: vi.fn() }),
  useCategoryMutations: () => {
    const idle = { mutate: vi.fn(), isPending: false, isError: false, error: null, reset: vi.fn() };
    return { create: idle, update: idle, status: idle, remove: idle };
  },
}));

describe('Admin categories row actions', () => {
  it('names each icon action and explains a delete that is unavailable', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    render(<MemoryRouter><TooltipProvider delayDuration={0}><AdminToastProvider><AdminCategoriesPage /></AdminToastProvider></TooltipProvider></MemoryRouter>);
    const edit = await screen.findByRole('button', { name: 'Edit Phones' });
    expect(edit).not.toHaveAttribute('title');
    edit.focus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Edit category');
    await user.keyboard('{Escape}');
    const blocked = screen.getByRole('button', { name: 'Delete Laptops' });
    expect(blocked).toBeDisabled();
    const wrapper = blocked.closest<HTMLElement>('[data-tooltip-disabled-wrapper]');
    expect(wrapper).not.toBeNull();
    wrapper!.focus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Only empty categories can be deleted');
  });
});
