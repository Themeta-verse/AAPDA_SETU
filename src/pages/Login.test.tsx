import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Login from './Login';

const mockSignUp = vi.fn();
const mockSignIn = vi.fn();
const mockRequestLocation = vi.fn();
const mockToast = vi.fn();

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    signUp: mockSignUp,
    signIn: mockSignIn,
    user: null,
    session: null,
    loading: false,
    signOut: vi.fn(),
  }),
}));

vi.mock('@/hooks/useGeolocation', () => ({
  useGeolocation: () => ({
    requestLocation: mockRequestLocation,
    hasFix: false,
    status: 'idle',
  }),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({
    toast: mockToast,
  }),
}));

describe('Login Page - Production Auth & Demolition of Demo Credentials', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does NOT render Admin Demo anywhere on the page', () => {
    render(<Login />);
    expect(screen.queryByText(/Admin Demo/i)).toBeNull();
    expect(screen.queryByText(/admin@baywatch.org/i)).toBeNull();
    expect(screen.queryByTestId('demo-fill-admin')).toBeNull();
  });

  it('does NOT render Responder Demo anywhere on the page', () => {
    render(<Login />);
    expect(screen.queryByText(/Responder Demo/i)).toBeNull();
    expect(screen.queryByText(/responder@baywatch.org/i)).toBeNull();
    expect(screen.queryByTestId('demo-fill-responder')).toBeNull();
  });

  it('does NOT render Citizen Demo anywhere on the page', () => {
    render(<Login />);
    expect(screen.queryByText(/Citizen Demo/i)).toBeNull();
    expect(screen.queryByText(/citizen@baywatch.org/i)).toBeNull();
    expect(screen.queryByTestId('demo-fill-citizen')).toBeNull();
  });

  it('does NOT render Preauthorized Operational Accounts or Quick-fill controls', () => {
    render(<Login />);
    expect(screen.queryByText(/Preauthorized Operational Accounts/i)).toBeNull();
    expect(screen.queryByText(/Quick-fill/i)).toBeNull();
    expect(screen.queryByText(/test role authorization/i)).toBeNull();
  });

  it('does NOT render Evaluator Login or Demo Credentials anywhere', () => {
    render(<Login />);
    expect(screen.queryByText(/Evaluator Login/i)).toBeNull();
    expect(screen.queryByText(/Demo Credentials/i)).toBeNull();
    expect(screen.queryByText(/evaluator credentials/i)).toBeNull();
  });

  it('does NOT expose role selection in sign-up or sign-in modes', () => {
    const { container } = render(<Login />);
    
    // Check select, radio, checkbox, or input elements for roles
    const selectElements = container.querySelectorAll('select');
    expect(selectElements.length).toBe(0);

    const roleInputs = container.querySelectorAll('input[name="role"], select[name="role"]');
    expect(roleInputs.length).toBe(0);

    expect(screen.queryByLabelText(/role/i)).toBeNull();
    expect(screen.queryByText(/Select Role/i)).toBeNull();
    expect(screen.queryByText(/Admin/i)).toBeNull();
    expect(screen.queryByText(/Responder/i)).toBeNull();
  });

  it('defaults to Sign In mode for existing operational and citizen users', async () => {
    mockSignIn.mockResolvedValueOnce({ user: { id: 'test-user-id' } });

    render(<Login />);

    // Default is Sign In
    expect(screen.getByRole('button', { name: /^Sign In$/i })).toBeDefined();
    expect(screen.queryByPlaceholderText('Enter your name')).toBeNull();

    // Perform sign in
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), {
      target: { value: 'officer@example.com' },
    });
    fireEvent.change(screen.getByPlaceholderText('Min 6 characters'), {
      target: { value: 'securepassword123' },
    });

    const submitBtn = screen.getByRole('button', { name: /^Sign In$/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockSignIn).toHaveBeenCalledTimes(1);
    });

    expect(mockSignIn).toHaveBeenCalledWith('officer@example.com', 'securepassword123');
  });

  it('public signup only passes name, phone, email, and password (never an operational role)', async () => {
    mockSignUp.mockResolvedValueOnce({ user: { id: 'test-user-id' } });

    render(<Login />);

    // Switch to Create Citizen Account
    const signUpTab = screen.getByTestId('tab-sign-up');
    fireEvent.click(signUpTab);

    // In signup mode
    fireEvent.change(screen.getByPlaceholderText('Enter your name'), {
      target: { value: 'Aarav Sharma' },
    });
    fireEvent.change(screen.getByPlaceholderText('+91 XXXXXXXXXX'), {
      target: { value: '+91 9876543210' },
    });
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), {
      target: { value: 'aarav@example.com' },
    });
    fireEvent.change(screen.getByPlaceholderText('Min 6 characters'), {
      target: { value: 'securepassword123' },
    });

    const submitBtn = screen.getByRole('button', { name: /Create Account & Enter Dashboard/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockSignUp).toHaveBeenCalledTimes(1);
    });

    // Verify arguments: email, password, name, phone. NO role argument exists.
    expect(mockSignUp).toHaveBeenCalledWith(
      'aarav@example.com',
      'securepassword123',
      'Aarav Sharma',
      '+91 9876543210'
    );
  });

  it('signup cannot request admin or responder role even if form or DOM is manipulated', async () => {
    mockSignUp.mockResolvedValueOnce({ user: { id: 'test-user-id' } });

    const { container } = render(<Login />);

    // Switch to signup mode
    fireEvent.click(screen.getByTestId('tab-sign-up'));

    // Attempt to inject malicious hidden input attempting privilege escalation
    const rogueInput = document.createElement('input');
    rogueInput.setAttribute('type', 'hidden');
    rogueInput.setAttribute('name', 'role');
    rogueInput.setAttribute('value', 'admin');
    container.querySelector('form')?.appendChild(rogueInput);

    fireEvent.change(screen.getByPlaceholderText('Enter your name'), {
      target: { value: 'Infiltrator' },
    });
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), {
      target: { value: 'admin@baywatch.org' },
    });
    fireEvent.change(screen.getByPlaceholderText('Min 6 characters'), {
      target: { value: 'password123456' },
    });

    const submitBtn = screen.getByRole('button', { name: /Create Account & Enter Dashboard/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockSignUp).toHaveBeenCalledTimes(1);
    });

    // Verify mockSignUp strictly receives 4 arguments: email, password, name, phone.
    // Zero role arguments or claims can be forwarded by the client component.
    expect(mockSignUp).toHaveBeenCalledWith(
      'admin@baywatch.org',
      'password123456',
      'Infiltrator',
      undefined
    );
    expect(mockSignUp.mock.calls[0].length).toBe(4);
    expect(mockSignUp.mock.calls[0]).not.toContain('admin');
    expect(mockSignUp.mock.calls[0]).not.toContain('responder');
  });

  it('toggles cleanly between sign-in and sign-up using tabs and link', () => {
    render(<Login />);

    // Starts in sign-in
    expect(screen.getByRole('button', { name: /^Sign In$/i })).toBeDefined();

    // Toggle via tab
    fireEvent.click(screen.getByTestId('tab-sign-up'));
    expect(screen.getByRole('button', { name: /Create Account & Enter Dashboard/i })).toBeDefined();
    expect(screen.getByPlaceholderText('Enter your name')).toBeDefined();

    // Toggle via link
    fireEvent.click(screen.getByTestId('toggle-auth-mode'));
    expect(screen.getByRole('button', { name: /^Sign In$/i })).toBeDefined();
    expect(screen.queryByPlaceholderText('Enter your name')).toBeNull();
  });

  it('preserves emergency 112 / 108 helpline notice and AAPDA SETU branding', () => {
    render(<Login />);

    expect(screen.getByText(/AAPDA SETU/i)).toBeDefined();
    expect(screen.getByText(/Urban Disaster Intelligence & Response/i)).toBeDefined();
    expect(screen.getByText(/112/)).toBeDefined();
    expect(screen.getByText(/108/)).toBeDefined();
  });
});
