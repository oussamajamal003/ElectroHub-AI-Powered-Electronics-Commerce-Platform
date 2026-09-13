import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Navigation, NavigationList, NavigationItem } from './Navigation';
import React from 'react';

describe('Navigation Component', () => {
  it('renders navigation elements correctly', () => {
    render(
      <Navigation>
        <NavigationList>
          <NavigationItem>Home</NavigationItem>
          <NavigationItem>Products</NavigationItem>
        </NavigationList>
      </Navigation>
    );

    expect(screen.getByRole('navigation')).toBeInTheDocument();
    
    // Test items
    const list = screen.getByRole('list');
    expect(list).toBeInTheDocument();

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Home');
    expect(items[1]).toHaveTextContent('Products');
  });
});
