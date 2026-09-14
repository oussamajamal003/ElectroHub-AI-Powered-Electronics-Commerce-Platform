import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { DataTable, Column } from './DataTable';

describe('DataTable', () => {
  interface TestData {
    id: number;
    name: string;
    price: number;
  }

  const columns: Column<TestData>[] = [
    { key: 'name', title: 'Product Name' },
    { key: 'price', title: 'Price', render: (item) => `$${item.price.toFixed(2)}` }
  ];

  const data: TestData[] = [
    { id: 1, name: 'Headphones', price: 129.99 },
    { id: 2, name: 'Keyboard', price: 89.50 }
  ];

  it('renders headers and data correctly', () => {
    render(<DataTable data={data} columns={columns} keyExtractor={(item) => item.id} />);
    
    expect(screen.getByText('Product Name')).toBeInTheDocument();
    expect(screen.getByText('Price')).toBeInTheDocument();
    
    expect(screen.getByText('Headphones')).toBeInTheDocument();
    expect(screen.getByText('$129.99')).toBeInTheDocument();
    expect(screen.getByText('Keyboard')).toBeInTheDocument();
    expect(screen.getByText('$89.50')).toBeInTheDocument();
  });

  it('renders empty message when data is empty', () => {
    render(
      <DataTable 
        data={[]} 
        columns={columns} 
        keyExtractor={(item) => item.id} 
        emptyMessage="No items found" 
      />
    );
    
    expect(screen.getByText('No items found')).toBeInTheDocument();
  });

  it('calls onRowClick when a row is clicked', () => {
    const handleRowClick = vi.fn();
    render(<DataTable data={data} columns={columns} keyExtractor={(item) => item.id} onRowClick={handleRowClick} />);
    
    fireEvent.click(screen.getByText('Headphones'));
    expect(handleRowClick).toHaveBeenCalledWith(data[0]);
  });

  it('calls onActionClick when action button is clicked', () => {
    const handleActionClick = vi.fn();
    render(<DataTable data={data} columns={columns} keyExtractor={(item) => item.id} onActionClick={handleActionClick} />);
    
    const actionButtons = screen.getAllByRole('button', { name: 'Actions' });
    expect(actionButtons[0]).toBeDefined();
    fireEvent.click(actionButtons[0] as HTMLElement);
    
    expect(handleActionClick).toHaveBeenCalledWith(data[0], expect.any(Object));
  });
});
