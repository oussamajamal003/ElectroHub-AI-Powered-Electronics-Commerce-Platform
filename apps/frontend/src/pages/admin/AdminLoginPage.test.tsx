/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter, MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { AdminLoginPage } from './AdminLoginPage';
import { useAuth } from '@/features/auth/context/AuthContext';
import { ApiError } from '@/lib/api';

const { mockStartAuthentication } = vi.hoisted(() => ({ mockStartAuthentication: vi.fn() }));
vi.mock('@simplewebauthn/browser', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@simplewebauthn/browser')>();
  return { ...actual, browserSupportsWebAuthn: () => false, startAuthentication: (...args: unknown[]) => mockStartAuthentication(...args) };
});

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
      completeAdminSession: vi.fn(),
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
    expect(screen.queryByRole('button', { name: /Forgot Password/i })).not.toBeInTheDocument();
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
      accessToken: 'test-access-token',
      user: {
      id: 'admin-1',
      email: 'admin@electrohub.com',
      firstName: 'Admin',
      lastName: 'ElectroHub',
      role: 'ADMIN',
      },
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
      accessToken: 'test-customer-token',
      user: {
      id: 'cust-1',
      email: 'customer@electrohub.com',
      firstName: 'Customer',
      lastName: 'User',
      role: 'CUSTOMER',
      },
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
  it('moves a verified password to the second-factor step without signing in', async () => {
    mockLogin.mockResolvedValueOnce({
      requiresMfa: true,
      mfaToken: 'challenge-token-1234567890',
      expiresAt: new Date(Date.now() + 300000).toISOString(),
      factors: { totp: true, passkey: false, recoveryCode: true },
      enrollmentRequired: false,
    });
    renderComponent();

    fireEvent.change(screen.getByLabelText(/Email Address/i), { target: { value: 'admin@electrohub.com' } });
    fireEvent.change(screen.getByLabelText(/^Password/i), { target: { value: 'AdminPassword123!' } });
    fireEvent.click(screen.getByRole('button', { name: /^Sign In$/i }));

    expect(await screen.findByRole('heading', { name: "Verify it's you" })).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockLogout).not.toHaveBeenCalled();
  });

  it('presents MFA methods as a keyboard-operable selector without changing the initial method', async () => {
    mockLogin.mockResolvedValueOnce({
      requiresMfa: true,
      mfaToken: 'challenge-token-1234567890',
      expiresAt: new Date(Date.now() + 300000).toISOString(),
      factors: { totp: true, passkey: true, recoveryCode: true },
      enrollmentRequired: false,
    });
    renderComponent();
    fireEvent.change(screen.getByLabelText(/Email Address/i), { target: { value: 'admin@electrohub.com' } });
    fireEvent.change(screen.getByLabelText(/^Password/i), { target: { value: 'AdminPassword123!' } });
    fireEvent.click(screen.getByRole('button', { name: /^Sign In$/i }));

    const authenticatorTab = await screen.findByRole('tab', { name: 'Authenticator app' });
    const passkeyTab = screen.getByRole('tab', { name: 'Passkey' });
    const recoveryTab = screen.getByRole('tab', { name: 'Recovery code' });
    expect(authenticatorTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('6-digit code')).toHaveAttribute('autocomplete', 'one-time-code');

    authenticatorTab.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(passkeyTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: 'Use passkey' })).toBeInTheDocument();
    await userEvent.keyboard('{ArrowRight}');
    expect(recoveryTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Recovery code', { selector: 'input' })).toBeInTheDocument();
  });

  it('keeps passkey sign-in unavailable when the browser does not support WebAuthn', async () => {
    mockLogin.mockResolvedValueOnce({
      requiresMfa: true,
      mfaToken: 'challenge-token-1234567890',
      expiresAt: new Date(Date.now() + 300000).toISOString(),
      factors: { totp: true, passkey: true, recoveryCode: true },
      enrollmentRequired: false,
    });
    renderComponent();

    fireEvent.change(screen.getByLabelText(/Email Address/i), { target: { value: 'admin@electrohub.com' } });
    fireEvent.change(screen.getByLabelText(/^Password/i), { target: { value: 'AdminPassword123!' } });
    fireEvent.click(screen.getByRole('button', { name: /^Sign In$/i }));
    await screen.findByRole('heading', { name: "Verify it's you" });

    await userEvent.setup().click(screen.getByRole('tab', { name: 'Passkey' }));
    const passkeyButton = await screen.findByRole('button', { name: 'Use passkey' });
    expect(passkeyButton).toBeDisabled();
    expect(passkeyButton.closest('[role="tabpanel"]')).toHaveTextContent(/Passkeys are not available in this browser/);
    fireEvent.click(passkeyButton);
    expect(mockStartAuthentication).not.toHaveBeenCalled();
  });

  describe('return path after sign-in', () => {
    const Landing = () => { const location = useLocation(); return <p>at {location.pathname + location.search}</p>; };
    const renderSignedIn = (state: unknown) => {
      (useAuth as any).mockReturnValue({ login: mockLogin, logout: mockLogout, isAuthenticated: true, user: { role: 'ADMIN' }, isInitializing: false });
      render(<MemoryRouter initialEntries={[{ pathname: '/admin/login', state }]}>
        <Routes><Route path="/admin/login" element={<AdminLoginPage />} /><Route path="*" element={<Landing />} /></Routes>
      </MemoryRouter>);
    };

    it('returns to the deep-linked admin page with its list filters', () => {
      renderSignedIn({ from: '/admin/orders', search: '?payment=PAID&status=CONFIRMED' });
      expect(screen.getByText('at /admin/orders?payment=PAID&status=CONFIRMED')).toBeInTheDocument();
    });

    it('ignores a crafted return path, keeping the dashboard as the destination', () => {
      renderSignedIn({ from: '//evil.example/admin', search: '?x=1' });
      expect(screen.getByText('at /admin')).toBeInTheDocument();
    });
  });
});
