import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationPrevious,
  PaginationNext,
  PaginationEllipsis,
} from './Pagination';

describe('Pagination', () => {
  it('renders pagination components', () => {
    render(
      <Pagination>
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious />
          </PaginationItem>
          <PaginationItem>
            <PaginationLink isActive>1</PaginationLink>
          </PaginationItem>
          <PaginationItem>
            <PaginationLink>2</PaginationLink>
          </PaginationItem>
          <PaginationItem>
            <PaginationEllipsis data-testid="ellipsis" />
          </PaginationItem>
          <PaginationItem>
            <PaginationNext />
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    );

    expect(screen.getByRole('navigation', { name: /pagination/i })).toBeInTheDocument();
    
    // Check previous/next
    expect(screen.getByRole('button', { name: /previous/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /next/i })).toBeInTheDocument();

    // Check active state
    const page1 = screen.getByRole('button', { name: '1' });
    expect(page1).toHaveAttribute('aria-current', 'page');
    expect(page1.className).toMatch(/active/i);

    // Check ellipsis
    expect(screen.getByTestId('ellipsis')).toBeInTheDocument();
  });
});
