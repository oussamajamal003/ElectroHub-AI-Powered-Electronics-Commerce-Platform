import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Drawer, DrawerContent, DrawerTitle, DrawerDescription, DrawerOverlay, DrawerPortal } from './Drawer';

describe('Drawer Component', () => {
  it('renders drawer content when open', () => {
    render(
      <Drawer open={true}>
        <DrawerPortal>
          <DrawerOverlay />
          <DrawerContent>
            <DrawerTitle>Drawer Title</DrawerTitle>
            <DrawerDescription>Drawer Description</DrawerDescription>
          </DrawerContent>
        </DrawerPortal>
      </Drawer>
    );

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Drawer Title')).toBeInTheDocument();
    expect(screen.getByText('Drawer Description')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /close drawer/i })).toBeInTheDocument();
  });
});
