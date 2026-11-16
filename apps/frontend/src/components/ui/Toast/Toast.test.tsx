import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ToastProvider, ToastViewport, Toast, ToastTitle, ToastDescription, ToastClose } from './Toast';

describe('Toast Component', () => {
  it('renders a toast with title and description', () => {
    render(
      <ToastProvider>
        <Toast open={true}>
          <ToastTitle>Toast Title</ToastTitle>
          <ToastDescription>Toast Description</ToastDescription>
          <ToastClose />
        </Toast>
        <ToastViewport />
      </ToastProvider>
    );
    
    expect(screen.getByText('Toast Title')).toBeInTheDocument();
    expect(screen.getByText('Toast Description')).toBeInTheDocument();
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('renders success variant correctly', () => {
    render(
      <ToastProvider>
        <Toast open={true} variant="success" data-testid="my-toast">
          <ToastTitle>Success!</ToastTitle>
        </Toast>
        <ToastViewport />
      </ToastProvider>
    );
    const toast = screen.getByTestId('my-toast');
    expect(toast.className).toContain('variant-success');
    expect(screen.getByText('Success!')).toBeInTheDocument();
  });
});
