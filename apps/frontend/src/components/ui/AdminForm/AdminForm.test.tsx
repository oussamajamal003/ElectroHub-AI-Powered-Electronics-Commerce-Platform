import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { AdminForm, AdminFormHeader, AdminFormTitle, AdminFormContent, AdminFormActions } from './AdminForm';

describe('AdminForm', () => {
  it('renders a compound form structure correctly', () => {
    render(
      <AdminForm data-testid="admin-form">
        <AdminFormHeader>
          <AdminFormTitle>Add Product</AdminFormTitle>
        </AdminFormHeader>
        <AdminFormContent>
          <input type="text" placeholder="Name" />
        </AdminFormContent>
        <AdminFormActions>
          <button type="button">Cancel</button>
          <button type="submit">Save</button>
        </AdminFormActions>
      </AdminForm>
    );

    const form = screen.getByTestId('admin-form');
    expect(form).toBeInTheDocument();
    expect(form.tagName).toBe('FORM');

    expect(screen.getByText('Add Product')).toBeInTheDocument();
    expect(screen.getByText('Add Product').tagName).toBe('H2');
    
    expect(screen.getByPlaceholderText('Name')).toBeInTheDocument();
    
    expect(screen.getByText('Cancel')).toBeInTheDocument();
    expect(screen.getByText('Save')).toBeInTheDocument();
  });
});
