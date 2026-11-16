import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
  BreadcrumbEllipsis,
} from './Breadcrumb';

describe('Breadcrumb', () => {
  it('renders breadcrumb components correctly', () => {
    render(
      <Breadcrumb data-testid="breadcrumb">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/">Home</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbEllipsis data-testid="ellipsis" />
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Current</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    );

    expect(screen.getByTestId('breadcrumb')).toBeInTheDocument();
    expect(screen.getByTestId('breadcrumb')).toHaveAttribute('aria-label', 'Breadcrumb');
    
    expect(screen.getByRole('link', { name: /home/i })).toBeInTheDocument();
    
    // Check if BreadcrumbPage is correctly assigned aria-current="page"
    const currentPage = screen.getByText('Current');
    expect(currentPage).toBeInTheDocument();
    expect(currentPage).toHaveAttribute('aria-current', 'page');

    expect(screen.getByTestId('ellipsis')).toBeInTheDocument();
  });
});
