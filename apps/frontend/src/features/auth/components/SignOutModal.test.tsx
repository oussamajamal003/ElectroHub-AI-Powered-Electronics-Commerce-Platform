/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { SignOutModal } from './SignOutModal';
import { useAuth } from '../context/AuthContext';

// Mock useAuth
vi.mock('../context/AuthContext', () => ({
  useAuth: vi.fn()
}));

describe('SignOutModal', () => {
  it('calls logout and manages loading state without allowing escape or duplicate clicks', async () => {
    let resolveLogout: () => void;
    const mockLogout = vi.fn().mockImplementation(() => new Promise<void>((resolve) => {
      resolveLogout = resolve;
    }));
    const mockOnOpenChange = vi.fn();
    
    (useAuth as any).mockReturnValue({
      logout: mockLogout
    });

    render(
      <BrowserRouter>
        <SignOutModal 
          open={true} 
          onOpenChange={mockOnOpenChange} 
        />
      </BrowserRouter>
    );

    const signOutButton = screen.getByRole('button', { name: /Sign Out/i });
    const cancelButton = screen.getByRole('button', { name: /Cancel/i });

    fireEvent.click(signOutButton);

    // In loading state
    expect(screen.getByRole('button', { name: /Signing out\.\.\./i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Signing out\.\.\./i })).toBeDisabled();
    expect(cancelButton).toBeDisabled();

    // Escape key during loading must NOT trigger close
    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
    expect(mockOnOpenChange).not.toHaveBeenCalled();

    // Duplicate click does not trigger additional calls
    fireEvent.click(screen.getByRole('button', { name: /Signing out\.\.\./i }));
    expect(mockLogout).toHaveBeenCalledTimes(1);

    // Resolve logout
    resolveLogout!();

    await waitFor(() => {
      expect(mockOnOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it('calls onOpenChange(false) when Cancel is clicked', () => {
    const mockLogout = vi.fn();
    const mockOnOpenChange = vi.fn();
    
    (useAuth as any).mockReturnValue({
      logout: mockLogout
    });

    render(
      <BrowserRouter>
        <SignOutModal 
          open={true} 
          onOpenChange={mockOnOpenChange} 
        />
      </BrowserRouter>
    );

    const cancelButton = screen.getByRole('button', { name: /Cancel/i });
    fireEvent.click(cancelButton);

    expect(mockOnOpenChange).toHaveBeenCalledWith(false);
    expect(mockLogout).not.toHaveBeenCalled();
  });
});

