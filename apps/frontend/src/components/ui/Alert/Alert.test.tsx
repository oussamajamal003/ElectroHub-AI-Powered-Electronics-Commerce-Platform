import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Alert, AlertTitle, AlertDescription } from './Alert';

describe('Alert Component', () => {
  it('renders default alert correctly', () => {
    render(
      <Alert>
        <AlertTitle>Alert Title</AlertTitle>
        <AlertDescription>Alert Description</AlertDescription>
      </Alert>
    );
    
    const alertElement = screen.getByRole('alert');
    expect(alertElement).toBeInTheDocument();
    expect(screen.getByText('Alert Title')).toBeInTheDocument();
    expect(screen.getByText('Alert Description')).toBeInTheDocument();
  });

  it('renders success variant correctly', () => {
    render(<Alert variant="success">Success!</Alert>);
    const alert = screen.getByRole('alert');
    expect(alert.className).toContain('variant-success');
    expect(screen.getByText('Success!')).toBeInTheDocument();
  });

  it('renders error variant correctly', () => {
    render(<Alert variant="error">Error!</Alert>);
    const alert = screen.getByRole('alert');
    expect(alert.className).toContain('variant-error');
    expect(screen.getByText('Error!')).toBeInTheDocument();
  });

  it('renders close button when onDismiss is provided and triggers callback', async () => {
    const onDismissMock = vi.fn();
    const user = userEvent.setup();
    
    render(<Alert onDismiss={onDismissMock}>Dismissible Alert</Alert>);
    
    const closeBtn = screen.getByRole('button', { name: /close alert/i });
    expect(closeBtn).toBeInTheDocument();
    
    await user.click(closeBtn);
    expect(onDismissMock).toHaveBeenCalledTimes(1);
  });
});
