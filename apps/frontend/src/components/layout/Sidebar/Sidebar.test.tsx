import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Sidebar, SidebarGroup, SidebarItem } from './Sidebar';

describe('Sidebar', () => {
  it('renders Sidebar and its children', () => {
    render(
      <Sidebar data-testid="sidebar">
        <SidebarGroup label="MAIN">
          <SidebarItem icon={<span data-testid="icon">Icon</span>}>Dashboard</SidebarItem>
        </SidebarGroup>
      </Sidebar>
    );

    expect(screen.getByTestId('sidebar')).toBeInTheDocument();
    expect(screen.getByText('MAIN')).toBeInTheDocument();
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByTestId('icon')).toBeInTheDocument();
  });

  it('renders active state correctly', () => {
    render(
      <Sidebar>
        <SidebarItem active>Active Item</SidebarItem>
      </Sidebar>
    );

    const button = screen.getByRole('button', { name: /active item/i });
    expect(button).toHaveAttribute('aria-current', 'page');
  });

  it('handles collapsed state for Sidebar', () => {
    render(
      <Sidebar collapsed data-testid="sidebar">
        <SidebarGroup label="MAIN" collapsed>
          <SidebarItem collapsed icon={<span data-testid="icon">Icon</span>}>
            Dashboard
          </SidebarItem>
        </SidebarGroup>
      </Sidebar>
    );

    expect(screen.getByTestId('sidebar').className).toMatch(/collapsed/i);
    
    // Label should be first char
    expect(screen.getByText('M')).toBeInTheDocument();
    
    // Dashboard text should NOT be rendered when collapsed
    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument();
    expect(screen.getByTestId('icon')).toBeInTheDocument();
  });
  
  it('handles disabled state', () => {
    render(
      <Sidebar>
        <SidebarItem disabled>Disabled Item</SidebarItem>
      </Sidebar>
    );

    const button = screen.getByRole('button', { name: /disabled item/i });
    expect(button).toBeDisabled();
  });
});
