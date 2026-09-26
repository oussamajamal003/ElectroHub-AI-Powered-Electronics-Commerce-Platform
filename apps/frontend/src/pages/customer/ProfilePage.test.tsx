/* eslint-disable @typescript-eslint/no-explicit-any */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { describe, beforeEach, it, expect, vi } from 'vitest';
import { ProfilePage } from './ProfilePage';
import { useAuth } from '@/features/auth/context/AuthContext';

vi.mock('@/features/auth/context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

const mockNavigate = vi.fn();
const mockUpdateProfile = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

describe('ProfilePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue({
      user: { id: '1', firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com', role: 'CUSTOMER' },
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      updateProfile: mockUpdateProfile,
      verifyEmailChange: vi.fn(),
    } as any);
  });

  const renderWithRouter = (ui: React.ReactElement) => {
    return render(<BrowserRouter>{ui}</BrowserRouter>);
  };

  it('renders breadcrumb and title', () => {
    renderWithRouter(<ProfilePage />);
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByText('Account')).toBeInTheDocument();
    expect(screen.getAllByText('My Profile').length).toBeGreaterThan(0);
  });

  it('renders avatar and subtext', () => {
    renderWithRouter(<ProfilePage />);
    expect(screen.getByText('J')).toBeInTheDocument(); // initial
    expect(screen.getByText('Your profile information')).toBeInTheDocument();
  });

  it('renders input fields with correct initial values and no phone number', () => {
    renderWithRouter(<ProfilePage />);
    const textboxes = screen.getAllByRole('textbox');
    expect(textboxes).toHaveLength(3); // First Name, Last Name, Email
    
    expect(screen.getByDisplayValue('jane@example.com')).toBeEnabled();
    // Phone is removed
    expect(screen.queryByText(/Phone Number/i)).not.toBeInTheDocument();

    // First and Last name are enabled
    expect(screen.getByDisplayValue('Jane')).not.toBeDisabled();
    expect(screen.getByDisplayValue('Doe')).not.toBeDisabled();
  });

  it('renders cancel button that navigates back to account', () => {
    renderWithRouter(<ProfilePage />);
    const cancelBtn = screen.getByText('Cancel');
    fireEvent.click(cancelBtn);
    expect(mockNavigate).toHaveBeenCalledWith('/account');
  });

  it('renders enabled save button initially', () => {
    renderWithRouter(<ProfilePage />);
    const saveBtn = screen.getByRole('button', { name: 'Save Profile' });
    expect(saveBtn).not.toBeDisabled();
  });

  it('sends an email change for verification instead of reporting it as verified', async () => {
    mockUpdateProfile.mockResolvedValueOnce({ user: { email: 'jane@example.com', pendingEmail: 'new@example.com', requiresEmailVerification: true } });
    renderWithRouter(<ProfilePage />);
    fireEvent.change(screen.getByLabelText('Email Address'), { target: { value: 'new@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Profile' }));
    await waitFor(() => expect(mockUpdateProfile).toHaveBeenCalledWith({ firstName: 'Jane', lastName: 'Doe', email: 'new@example.com' }));
    expect(await screen.findByText(/A verification code was requested for the new address/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Verify your new email' })).toBeInTheDocument();
  });
});

