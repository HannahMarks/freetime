import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import SignUpScreen from '../app/(auth)/sign-up';
import { signUp } from '../lib/auth-actions';
import { toast } from '../lib/toast';

jest.mock('../lib/auth-actions', () => ({
  signUp: jest.fn(),
}));

jest.mock('../lib/toast', () => ({
  toast: { error: jest.fn(), success: jest.fn() },
}));

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn() }),
  Link: ({ children }: { children: React.ReactNode }) => children,
}));

// Stub the picker so the heavy dep doesn't run in tests.
jest.mock('reanimated-color-picker', () => {
  const React = require('react');
  const Pass = ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children);
  return {
    __esModule: true,
    default: Pass,
    Panel1: () => null,
    HueSlider: () => null,
    Preview: () => null,
  };
});

const mockedSignUp = signUp as jest.MockedFunction<typeof signUp>;

describe('SignUpScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function fillValidForm() {
    fireEvent.changeText(screen.getByPlaceholderText('Email'), 'alice@example.com');
    fireEvent.changeText(screen.getByPlaceholderText('Password'), 'correct-horse');
    fireEvent.changeText(screen.getByPlaceholderText('Display name'), 'Alice');
  }

  it('renders email, password, and display-name fields plus a color picker preview', () => {
    render(<SignUpScreen />);
    expect(screen.getByPlaceholderText('Email')).toBeOnTheScreen();
    expect(screen.getByPlaceholderText('Password')).toBeOnTheScreen();
    expect(screen.getByPlaceholderText('Display name')).toBeOnTheScreen();
    expect(screen.getByTestId('color-picker-preview')).toBeOnTheScreen();
  });

  it('calls signUp with form values when submit is pressed', async () => {
    mockedSignUp.mockResolvedValue({ error: null });
    render(<SignUpScreen />);
    fillValidForm();
    fireEvent.press(screen.getByRole('button', { name: /sign up/i }));

    await waitFor(() => expect(mockedSignUp).toHaveBeenCalledTimes(1));
    expect(mockedSignUp).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'alice@example.com',
        password: 'correct-horse',
        displayName: 'Alice',
        color: expect.stringMatching(/^#[0-9A-Fa-f]{6}$/),
      }),
    );
  });

  it('navigates to the calendar on success', async () => {
    mockedSignUp.mockResolvedValue({ error: null });
    render(<SignUpScreen />);
    fillValidForm();
    fireEvent.press(screen.getByRole('button', { name: /sign up/i }));

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(app)/calendar'));
  });

  it('shows an error toast when signUp returns an error', async () => {
    mockedSignUp.mockResolvedValue({ error: 'An account with this email already exists.' });
    render(<SignUpScreen />);
    fillValidForm();
    fireEvent.press(screen.getByRole('button', { name: /sign up/i }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('An account with this email already exists.'),
    );
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('does not call signUp when required fields are empty', () => {
    render(<SignUpScreen />);
    fireEvent.press(screen.getByRole('button', { name: /sign up/i }));
    expect(mockedSignUp).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/fill in/i));
  });
});
