/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RegisterModal } from './RegisterModal';
import { useAuth } from '../context/AuthContext';

import { BrowserRouter } from 'react-router-dom';

// Mock useAuth
vi.mock('../context/AuthContext', () => ({
  useAuth: vi.fn()
}));

describe('RegisterModal', () => {
  it('handles automatic login on successful registration', async () => {
    const mockRegister = vi.fn().mockResolvedValue(undefined);
    const mockOnOpenChange = vi.fn();
    
    (useAuth as any).mockReturnValue({
      register: mockRegister,
    });

    render(
      <BrowserRouter>
        <RegisterModal 
          open={true} 
          onOpenChange={mockOnOpenChange} 
          onSwitchToLogin={() => {}} 
        />
      </BrowserRouter>
    );

    // Fill form
    fireEvent.change(screen.getByLabelText(/Full Name/i), { target: { value: 'Test User' } });
    fireEvent.change(screen.getByLabelText(/Email Address/i), { target: { value: 'test@example.com' } });
    fireEvent.change(screen.getByLabelText(/^Password/i), { target: { value: 'password123' } });
    fireEvent.change(screen.getByLabelText(/Confirm Password/i), { target: { value: 'password123' } });

    const submitButton = screen.getByRole('button', { name: /Create Account/i });
    fireEvent.click(submitButton);

    expect(screen.getByRole('button', { name: /Creating account\.\.\./i })).toBeInTheDocument();

    await waitFor(() => {
      expect(mockRegister).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'password123',
        firstName: 'Test',
        lastName: 'User'
      });
    });

    await waitFor(() => {
      expect(mockOnOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it('shows error if registration fails', async () => {
    const mockRegister = vi.fn().mockRejectedValue(new Error('Email already registered'));
    const mockOnOpenChange = vi.fn();
    
    (useAuth as any).mockReturnValue({
      register: mockRegister,
    });

    render(
      <BrowserRouter>
        <RegisterModal 
          open={true} 
          onOpenChange={mockOnOpenChange} 
          onSwitchToLogin={() => {}} 
        />
      </BrowserRouter>
    );

    // Fill form
    fireEvent.change(screen.getByLabelText(/Full Name/i), { target: { value: 'Test User' } });
    fireEvent.change(screen.getByLabelText(/Email Address/i), { target: { value: 'test@example.com' } });
    fireEvent.change(screen.getByLabelText(/^Password/i), { target: { value: 'password123' } });
    fireEvent.change(screen.getByLabelText(/Confirm Password/i), { target: { value: 'password123' } });

    const submitButton = screen.getByRole('button', { name: /Create Account/i });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/Email already registered/i)).toBeInTheDocument();
    });
    
    // Modal remains open
    expect(mockOnOpenChange).not.toHaveBeenCalled();
  });
});

