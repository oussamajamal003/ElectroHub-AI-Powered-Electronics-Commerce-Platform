import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableRow,
  TableHead,
  TableCell,
  TableCaption,
} from './Table';
import React from 'react';

describe('Table Component', () => {
  it('renders all table elements correctly', () => {
    render(
      <Table>
        <TableCaption>A test table.</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>Head 1</TableHead>
            <TableHead>Head 2</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>Cell 1</TableCell>
            <TableCell>Cell 2</TableCell>
          </TableRow>
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell>Footer 1</TableCell>
            <TableCell>Footer 2</TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    );

    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText('A test table.')).toBeInTheDocument();
    
    // Check headers
    expect(screen.getByText('Head 1')).toBeInTheDocument();
    expect(screen.getByText('Head 2')).toBeInTheDocument();

    // Check cells
    expect(screen.getByText('Cell 1')).toBeInTheDocument();
    expect(screen.getByText('Cell 2')).toBeInTheDocument();

    // Check footers
    expect(screen.getByText('Footer 1')).toBeInTheDocument();
    expect(screen.getByText('Footer 2')).toBeInTheDocument();
  });
});
