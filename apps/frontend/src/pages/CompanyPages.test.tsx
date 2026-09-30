import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AboutPage } from './AboutPage';
import { ContactPage } from './ContactPage';

describe('company pages', () => {
  it('shows About content and a Products CTA', () => {
    render(<MemoryRouter><AboutPage /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'Technology made simple.' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Explore Products' })).toHaveAttribute('href', '/products');
  });

  it('validates Contact and never claims delivery', () => {
    render(<MemoryRouter><ContactPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Send Message' }));
    expect(screen.getByText('Name is required.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Test User' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'test@example.com' } });
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Question' } });
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send Message' }));
    expect(screen.getByRole('status')).toHaveTextContent('not connected to a delivery service');
  });
});
