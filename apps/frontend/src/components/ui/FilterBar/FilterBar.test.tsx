import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { FilterBar } from './FilterBar';

describe('FilterBar', () => {
  it('renders search input and apply button', () => {
    const handleApply = vi.fn();
    render(<FilterBar onApply={handleApply} />);
    
    expect(screen.getByPlaceholderText('Search products')).toBeInTheDocument();
    
    const applyBtn = screen.getByRole('button', { name: 'Apply' });
    expect(applyBtn).toBeInTheDocument();
    
    fireEvent.click(applyBtn);
    expect(handleApply).toHaveBeenCalled();
  });

  it('renders selects when options are provided', () => {
    const categoryOptions = [{ value: 'electronics', label: 'Electronics' }];
    const statusOptions = [{ value: 'in_stock', label: 'In Stock' }];
    
    render(
      <FilterBar 
        categoryOptions={categoryOptions} 
        statusOptions={statusOptions} 
      />
    );
    
    expect(screen.getByRole('combobox', { name: 'Filter by category' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Filter by status' })).toBeInTheDocument();
  });

  it('renders active filters and handles clear', () => {
    const activeFilters = [
      { key: 'category', label: 'Headphones', value: 'headphones' },
      { key: 'status', label: 'In Stock', value: 'in_stock' }
    ];
    
    const handleClear = vi.fn();
    
    render(
      <FilterBar 
        activeFilters={activeFilters} 
        onClearFilter={handleClear} 
      />
    );
    
    expect(screen.getByText('Headphones')).toBeInTheDocument();
    expect(screen.getByText('In Stock')).toBeInTheDocument();
    
    const clearBtn = screen.getByRole('button', { name: /remove filter headphones/i });
    fireEvent.click(clearBtn);
    
    expect(handleClear).toHaveBeenCalledWith('category');
  });

  it('calls onSearchChange when typing in search input', () => {
    const handleSearchChange = vi.fn();
    render(<FilterBar onSearchChange={handleSearchChange} />);
    
    const input = screen.getByPlaceholderText('Search products');
    fireEvent.change(input, { target: { value: 'test' } });
    
    expect(handleSearchChange).toHaveBeenCalledWith('test');
  });
});
