import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '../components/ui/Dialog';

// Mock matchMedia for framer-motion in JSDOM
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock ResizeObserver
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

describe('Dialog Foundation Component', () => {
  afterEach(cleanup);
  const TestDialog = () => (
    <Dialog>
      <DialogTrigger asChild>
        <button>Open Dialog</button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Test Dialog Title</DialogTitle>
        <DialogDescription>Test Dialog Description</DialogDescription>
      </DialogContent>
    </Dialog>
  );

  it('renders closed by default and opens when trigger is clicked', async () => {
    const user = userEvent.setup();
    render(<TestDialog />);
    
    // Closed by default
    expect(screen.queryByText('Test Dialog Title')).not.toBeInTheDocument();
    
    // Click trigger to open
    const triggerButton = screen.getByText('Open Dialog');
    await user.click(triggerButton);
    
    // Wait for the dialog to appear in DOM
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
    
    // Title and description should be visible
    expect(screen.getByText('Test Dialog Title')).toBeInTheDocument();
    expect(screen.getByText('Test Dialog Description')).toBeInTheDocument();
  });

  it('closes when the close button is clicked', async () => {
    const user = userEvent.setup();
    render(<TestDialog />);
    
    await user.click(screen.getByText('Open Dialog'));
    
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
    
    const closeButton = screen.getByLabelText('Close');
    await user.click(closeButton);
    
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('maintains accessible title and description relationships', async () => {
    const user = userEvent.setup();
    render(<TestDialog />);
    
    await user.click(screen.getByText('Open Dialog'));
    
    const dialog = await screen.findByRole('dialog');
    const title = screen.getByText('Test Dialog Title');
    const description = screen.getByText('Test Dialog Description');
    
    // Radix applies aria-labelledby and aria-describedby automatically
    expect(dialog).toHaveAttribute('aria-labelledby', title.id);
    expect(dialog).toHaveAttribute('aria-describedby', description.id);
  });
  
  it('closes when pressing the Escape key', async () => {
    const user = userEvent.setup();
    render(<TestDialog />);
    
    await user.click(screen.getByText('Open Dialog'));
    
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
    
    await user.keyboard('{Escape}');
    
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });
});
