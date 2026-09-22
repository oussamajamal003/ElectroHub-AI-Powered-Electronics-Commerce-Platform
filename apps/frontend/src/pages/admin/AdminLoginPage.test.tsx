/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { AdminLoginPage } from './AdminLoginPage';
import { useAuth } from '@/features/auth/context/AuthContext';
import { ApiError } from '@/lib/api';

vi.mock('@/features/auth/context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

describe('AdminLoginPage', () => {
  const mockLogin = vi.fn();
  const mockLogout = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (useAuth as any).mockReturnValue({
      login: mockLogin,
      logout: mockLogout,
      isAuthenticated: false,
      user: null,
      isInitializing: false,
    });
  });

  const renderComponent = () => {
    return render(
      <BrowserRouter>
        <AdminLoginPage />
      </BrowserRouter>
    );
  };

  it('renders correctly with matching visual structure', () => {
    renderComponent();

    expect(screen.getByText('ElectroHub')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Sign In to Admin' })).toBeInTheDocument();
    expect(screen.getByText('Admin Portal')).toBeInTheDocument();
    expect(screen.getByLabelText(/Email Address/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Forgot Password\?/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sign In/i })).toBeInTheDocument();
  });

  it('does not show validation error when focusing and blurring untouched inputs', () => {
    renderComponent();

    const emailInput = screen.getByLabelText(/Email Address/i);
    const passwordInput = screen.getByLabelText(/^Password/i);

    fireEvent.focus(emailInput);
    fireEvent.blur(emailInput);
    expect(screen.queryByText('Email address is required.')).not.toBeInTheDocument();

    fireEvent.focus(passwordInput);
    fireEvent.blur(passwordInput);
    expect(screen.queryByText('Password is required.')).not.toBeInTheDocument();
  });

  it('typing the first character into an untouched field does not show a validation error before blur', () => {
    renderComponent();

    const emailInput = screen.getByLabelText(/Email Address/i);
    fireEvent.focus(emailInput);
    fireEvent.change(emailInput, { target: { value: 'a' } });

    expect(screen.queryByText('Please enter a valid email address.')).not.toBeInTheDocument();
    expect(screen.queryByText('Email address is required.')).not.toBeInTheDocument();

    const passwordInput = screen.getByLabelText(/^Password/i);
    fireEvent.focus(passwordInput);
    fireEvent.change(passwordInput, { target: { value: 'a' } });

    expect(screen.queryByText('Password is required.')).not.toBeInTheDocument();
  });

  it('shows error when blurring invalid email and clears when corrected', () => {
    renderComponent();

    const emailInput = screen.getByLabelText(/Email Address/i);
    fireEvent.change(emailInput, { target: { value: 'invalid-email' } });
    fireEvent.blur(emailInput);
    expect(screen.getByText('Please enter a valid email address.')).toBeInTheDocument();

    fireEvent.change(emailInput, { target: { value: 'admin@electrohub.com' } });
    expect(screen.queryByText('Please enter a valid email address.')).not.toBeInTheDocument();
  });

  it('validates email and password on submit', async () => {
    renderComponent();

    const submitBtn = screen.getByRole('button', { name: /^Sign In$/i });
    fireEvent.click(submitBtn);

    expect(await screen.findByText('Email address is required.')).toBeInTheDocument();
    expect(await screen.findByText('Password is required.')).toBeInTheDocument();
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it('toggles password visibility with eye button', () => {
    renderComponent();

    const passwordInput = screen.getByLabelText(/^Password/i);
    expect(passwordInput).toHaveAttribute('type', 'password');

    const toggleBtn = screen.getByRole('button', { name: /Show password/i });
    fireEvent.click(toggleBtn);
    expect(passwordInput).toHaveAttribute('type', 'text');

    fireEvent.click(screen.getByRole('button', { name: /Hide password/i }));
    expect(passwordInput).toHaveAttribute('type', 'password');
  });

  it('submits successfully with valid ADMIN credentials', async () => {
    mockLogin.mockResolvedValueOnce({
      id: 'admin-1',
      email: 'admin@electrohub.com',
      firstName: 'Admin',
      lastName: 'ElectroHub',
      role: 'ADMIN',
    });
    renderComponent();

    fireEvent.change(screen.getByLabelText(/Email Address/i), {
      target: { value: 'admin@electrohub.com' },
    });
    fireEvent.change(screen.getByLabelText(/^Password/i), {
      target: { value: 'AdminPassword123!' },
    });

    const submitBtn = screen.getByRole('button', { name: /^Sign In$/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith({
        email: 'admin@electrohub.com',
        password: 'AdminPassword123!',
      });
      expect(mockNavigate).toHaveBeenCalledWith('/admin', { replace: true });
    });
  });

  it('denies admin access when valid CUSTOMER credentials are used', async () => {
    mockLogin.mockResolvedValueOnce({
      id: 'cust-1',
      email: 'customer@electrohub.com',
      firstName: 'Customer',
      lastName: 'User',
      role: 'CUSTOMER',
    });
    renderComponent();

    fireEvent.change(screen.getByLabelText(/Email Address/i), {
      target: { value: 'customer@electrohub.com' },
    });
    fireEvent.change(screen.getByLabelText(/^Password/i), {
      target: { value: 'CustomerPass123!' },
    });

    const submitBtn = screen.getByRole('button', { name: /^Sign In$/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith({
        email: 'customer@electrohub.com',
        password: 'CustomerPass123!',
      });
      expect(mockLogout).toHaveBeenCalled();
      expect(mockNavigate).not.toHaveBeenCalledWith('/admin', expect.anything());
    });

    expect(await screen.findByText('Access denied. Administrator privileges required.')).toBeInTheDocument();
  });

  it('displays API error message on login failure (e.g. invalid credentials or unknown email)', async () => {
    mockLogin.mockRejectedValueOnce(new ApiError(401, 'Invalid credentials'));
    renderComponent();

    fireEvent.change(screen.getByLabelText(/Email Address/i), {
      target: { value: 'admin@electrohub.com' },
    });
    fireEvent.change(screen.getByLabelText(/^Password/i), {
      target: { value: 'wrongpassword' },
    });

    const submitBtn = screen.getByRole('button', { name: /^Sign In$/i });
    fireEvent.click(submitBtn);

    expect(await screen.findByText('Invalid credentials')).toBeInTheDocument();
  });
});
