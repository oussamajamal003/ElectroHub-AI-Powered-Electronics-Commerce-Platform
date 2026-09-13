import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Alert, AlertTitle, AlertDescription } from './Alert';
import React from 'react';

describe('Alert Component', () => {
  it('renders correctly', () => {
    render(
      <Alert>
        <AlertTitle>Alert Title</AlertTitle>
        <AlertDescription>Alert Description</AlertDescription>
      </Alert>
    );

    const alert = screen.getByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(screen.getByText('Alert Title')).toBeInTheDocument();
    expect(screen.getByText('Alert Description')).toBeInTheDocument();
    expect(alert.className).toMatch(/variant-default/);
  });

  it('renders destructive variant', () => {
    render(<Alert variant="destructive">Error!</Alert>);
    const alert = screen.getByRole('alert');
    expect(alert.className).toMatch(/variant-destructive/);
  });
});
