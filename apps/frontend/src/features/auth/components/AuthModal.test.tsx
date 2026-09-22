/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthModal } from './AuthModal';
import { useAuth } from '../context/AuthContext';

// Mock useAuth
vi.mock('../context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => ({ state: { from: '/account' } }),
}));

describe('AuthModal Component', () => {
  const mockLogin = vi.fn();
  const mockRegister = vi.fn();
  const mockOnOpenChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (useAuth as any).mockReturnValue({
      login: mockLogin,
      register: mockRegister,
    });
  });

  describe('Login Popup & Mode Switching', () => {
    it('renders Login UI by default', () => {
      render(<AuthModal open={true} onOpenChange={mockOnOpenChange} initialMode="login" />);

      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByText('Welcome Back')).toBeInTheDocument();
      expect(screen.getByLabelText(/Email Address/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/^Password$/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^Login$/i })).toBeInTheDocument();
    });

    it('switches from Login to Register in the same popup without closing', async () => {
      const user = userEvent.setup();
      render(<AuthModal open={true} onOpenChange={mockOnOpenChange} initialMode="login" />);

      expect(screen.getByRole('heading', { name: /Welcome Back/i })).toBeInTheDocument();
      const registerButton = screen.getByRole('button', { name: /^Register$/i });
      await user.click(registerButton);

      // Same dialog remains open, now showing Register
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: /Create Account/i })).toBeInTheDocument();
      expect(screen.getByLabelText(/Full Name/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/^Confirm Password$/i)).toBeInTheDocument();
      expect(mockOnOpenChange).not.toHaveBeenCalled();
    });

    it('switches from Register back to Login in the same popup without closing', async () => {
      const user = userEvent.setup();
      render(<AuthModal open={true} onOpenChange={mockOnOpenChange} initialMode="register" />);

      expect(screen.getByRole('heading', { name: /Create Account/i })).toBeInTheDocument();
      const loginButton = screen.getByRole('button', { name: /^Login$/i });
      await user.click(loginButton);

      // Same dialog remains open, now showing Login
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: /Welcome Back/i })).toBeInTheDocument();
      expect(mockOnOpenChange).not.toHaveBeenCalled();
    });

    it('allows close button to close the modal', async () => {
      const user = userEvent.setup();
      render(<AuthModal open={true} onOpenChange={mockOnOpenChange} initialMode="login" />);

      const closeButton = screen.getByLabelText('Close');
      await user.click(closeButton);

      expect(mockOnOpenChange).toHaveBeenCalledWith(false);
    });

    it('has submit button enabled initially when form loads', () => {
      render(<AuthModal open={true} onOpenChange={mockOnOpenChange} initialMode="login" />);
      expect(screen.getByRole('button', { name: /^Login$/i })).not.toBeDisabled();
    });
  });

  describe('Validation Timing & Interaction States', () => {
    it('does not show validation errors on initial render', () => {
      render(<AuthModal open={true} onOpenChange={mockOnOpenChange} initialMode="login" />);
      expect(screen.queryByText('Email address is required.')).not.toBeInTheDocument();
      expect(screen.queryByText('Password is required.')).not.toBeInTheDocument();
    });

    it('does not show validation errors when typing the first character into untouched inputs before blur', () => {
      render(<AuthModal open={true} onOpenChange={mockOnOpenChange} initialMode="login" />);

      const emailInput = screen.getByLabelText(/Email Address/i);
      fireEvent.focus(emailInput);
      fireEvent.change(emailInput, { target: { value: 'a' } });

      expect(screen.queryByText('Please enter a valid email address.')).not.toBeInTheDocument();
      expect(screen.queryByText('Email address is required.')).not.toBeInTheDocument();

      const passwordInput = screen.getByLabelText(/^Password$/i);
      fireEvent.focus(passwordInput);
      fireEvent.change(passwordInput, { target: { value: 'a' } });

      expect(screen.queryByText('Password is required.')).not.toBeInTheDocument();
    });

    it('does not show validation errors when focusing and blurring untouched inputs', () => {
      render(<AuthModal open={true} onOpenChange={mockOnOpenChange} initialMode="login" />);

      const emailInput = screen.getByLabelText(/Email Address/i);
      const passwordInput = screen.getByLabelText(/^Password$/i);

      // Focus email then blur without typing
      fireEvent.focus(emailInput);
      fireEvent.blur(emailInput);
      expect(screen.queryByText('Email address is required.')).not.toBeInTheDocument();

      // Focus password then blur without typing
      fireEvent.focus(passwordInput);
      fireEvent.blur(passwordInput);
      expect(screen.queryByText('Password is required.')).not.toBeInTheDocument();
    });

    it('does not show validation errors on Register when focusing and blurring untouched inputs', () => {
      render(<AuthModal open={true} onOpenChange={mockOnOpenChange} initialMode="register" />);

      const nameInput = screen.getByLabelText(/Full Name/i);
      const emailInput = screen.getByLabelText(/Email Address/i);
      const passwordInput = screen.getByLabelText(/^Password$/i);
      const confirmInput = screen.getByLabelText(/^Confirm Password$/i);

      fireEvent.focus(nameInput);
      fireEvent.blur(nameInput);
      fireEvent.focus(emailInput);
      fireEvent.blur(emailInput);
      fireEvent.focus(passwordInput);
      fireEvent.blur(passwordInput);
      fireEvent.focus(confirmInput);
      fireEvent.blur(confirmInput);

      expect(screen.queryByText('Full name is required.')).not.toBeInTheDocument();
      expect(screen.queryByText('Email address is required.')).not.toBeInTheDocument();
      expect(screen.queryByText('Password is required.')).not.toBeInTheDocument();
      expect(screen.queryByText('Please confirm your password.')).not.toBeInTheDocument();
    });

    it('shows errors when blurring invalid values and clears when corrected in Login', () => {
      render(<AuthModal open={true} onOpenChange={mockOnOpenChange} initialMode="login" />);

      const emailInput = screen.getByLabelText(/Email Address/i);

      // Type invalid email and blur to touch field
      fireEvent.change(emailInput, { target: { value: 'invalid-email' } });
      fireEvent.blur(emailInput);
      expect(screen.getByText('Please enter a valid email address.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^Login$/i })).toBeDisabled();

      // Correct email dynamically clears error
      fireEvent.change(emailInput, { target: { value: 'valid@example.com' } });
      expect(screen.queryByText('Please enter a valid email address.')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^Login$/i })).not.toBeDisabled();
    });

    it('shows validation error messages when submitting empty Login form', () => {
      render(<AuthModal open={true} onOpenChange={mockOnOpenChange} initialMode="login" />);

      const form = document.querySelector('form')!;
      fireEvent.submit(form);

      expect(screen.getByText('Email address is required.')).toBeInTheDocument();
      expect(screen.getByText('Password is required.')).toBeInTheDocument();
      expect(mockLogin).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: /^Login$/i })).toBeDisabled();
    });

    it('shows validation error messages when submitting empty Register form', () => {
      render(<AuthModal open={true} onOpenChange={mockOnOpenChange} initialMode="register" />);

      const form = document.querySelector('form')!;
      fireEvent.submit(form);

      expect(screen.getByText('Full name is required.')).toBeInTheDocument();
      expect(screen.getByText('Email address is required.')).toBeInTheDocument();
      expect(screen.getByText('Password is required.')).toBeInTheDocument();
      expect(screen.getByText('Please confirm your password.')).toBeInTheDocument();
      expect(mockRegister).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: /^Create Account$/i })).toBeDisabled();
    });

    it('validates password length and matching confirmation on Register', () => {
      render(<AuthModal open={true} onOpenChange={mockOnOpenChange} initialMode="register" />);

      fireEvent.change(screen.getByLabelText(/Full Name/i), { target: { value: 'John Doe' } });
      fireEvent.change(screen.getByLabelText(/Email Address/i), { target: { value: 'john@example.com' } });
      fireEvent.change(screen.getByLabelText(/^Password$/i), { target: { value: 'short' } });
      fireEvent.change(screen.getByLabelText(/^Confirm Password$/i), { target: { value: 'different' } });

      const form = document.querySelector('form')!;
      fireEvent.submit(form);

      expect(screen.getByText('Password must be at least 8 characters.')).toBeInTheDocument();
      expect(screen.getByText('Passwords do not match.')).toBeInTheDocument();
      expect(mockRegister).not.toHaveBeenCalled();
    });
  });

  describe('Loading State & Dismissal Protection', () => {
    it('Login loading keeps popup open and disables outside clicks, escape, and close button', async () => {
      let resolveLogin: () => void;
      mockLogin.mockImplementation(() => new Promise<void>((resolve) => {
        resolveLogin = resolve;
      }));

      render(<AuthModal open={true} onOpenChange={mockOnOpenChange} initialMode="login" />);

      fireEvent.change(screen.getByLabelText(/Email Address/i), { target: { value: 'test@example.com' } });
      fireEvent.change(screen.getByLabelText(/^Password$/i), { target: { value: 'password123' } });

      const submitButton = screen.getByRole('button', { name: /^Login$/i });
      expect(submitButton).not.toBeDisabled();
      fireEvent.click(submitButton);

      // In loading state
      expect(screen.getByRole('button', { name: /Logging in\.\.\./i })).toBeDisabled();
      expect(screen.getByLabelText('Close')).toBeDisabled();

      // Escape key during loading must NOT trigger close
      fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
      expect(mockOnOpenChange).not.toHaveBeenCalled();

      // Duplicate click does not trigger another call
      fireEvent.click(screen.getByRole('button', { name: /Logging in\.\.\./i }));
      expect(mockLogin).toHaveBeenCalledTimes(1);

      // Resolve login
      resolveLogin!();
      await waitFor(() => {
        expect(mockOnOpenChange).toHaveBeenCalledWith(false);
      });
    });

    it('Register loading keeps popup open and disables outside clicks, escape, and close button', async () => {
      let resolveRegister: () => void;
      mockRegister.mockImplementation(() => new Promise<void>((resolve) => {
        resolveRegister = resolve;
      }));
      mockLogin.mockResolvedValue(undefined);

      render(<AuthModal open={true} onOpenChange={mockOnOpenChange} initialMode="register" />);

      fireEvent.change(screen.getByLabelText(/Full Name/i), { target: { value: 'Jane Smith' } });
      fireEvent.change(screen.getByLabelText(/Email Address/i), { target: { value: 'jane@example.com' } });
      fireEvent.change(screen.getByLabelText(/^Password$/i), { target: { value: 'password123' } });
      fireEvent.change(screen.getByLabelText(/^Confirm Password$/i), { target: { value: 'password123' } });

      const submitButton = screen.getByRole('button', { name: /^Create Account$/i });
      expect(submitButton).not.toBeDisabled();
      fireEvent.click(submitButton);

      // In loading state
      expect(screen.getByRole('button', { name: /Creating account\.\.\./i })).toBeDisabled();
      expect(screen.getByLabelText('Close')).toBeDisabled();

      // Escape key must not close
      fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
      expect(mockOnOpenChange).not.toHaveBeenCalled();

      // Duplicate click does not trigger another call
      fireEvent.click(screen.getByRole('button', { name: /Creating account\.\.\./i }));
      expect(mockRegister).toHaveBeenCalledTimes(1);

      // Resolve register
      resolveRegister!();
      await waitFor(() => {
        expect(mockOnOpenChange).toHaveBeenCalledWith(false);
      });
    });
  });
});
