import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import SignInScreen from '../app/(auth)/sign-in';
import { signIn } from '../lib/auth-actions';
import { toast } from '../lib/toast';

jest.mock('../lib/auth-actions', () => ({
  signIn: jest.fn(),
}));

jest.mock('../lib/toast', () => ({
  toast: { error: jest.fn(), success: jest.fn() },
}));

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn() }),
  Link: ({ children }: { children: React.ReactNode }) => children,
}));

const mockedSignIn = signIn as jest.MockedFunction<typeof signIn>;

describe('SignInScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders email and password fields', () => {
    render(<SignInScreen />);
    expect(screen.getByPlaceholderText('Email')).toBeOnTheScreen();
    expect(screen.getByPlaceholderText('Password')).toBeOnTheScreen();
  });

  it('calls signIn with the entered credentials on submit', async () => {
    mockedSignIn.mockResolvedValue({ error: null });
    render(<SignInScreen />);
    fireEvent.changeText(screen.getByPlaceholderText('Email'), 'alice@example.com');
    fireEvent.changeText(screen.getByPlaceholderText('Password'), 'correct-horse');
    fireEvent.press(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() =>
      expect(mockedSignIn).toHaveBeenCalledWith({
        email: 'alice@example.com',
        password: 'correct-horse',
      }),
    );
  });

  it('navigates to the calendar on success', async () => {
    mockedSignIn.mockResolvedValue({ error: null });
    render(<SignInScreen />);
    fireEvent.changeText(screen.getByPlaceholderText('Email'), 'a@b.com');
    fireEvent.changeText(screen.getByPlaceholderText('Password'), 'pw1234');
    fireEvent.press(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(app)/calendar'));
  });

  it('shows an error toast on failure', async () => {
    mockedSignIn.mockResolvedValue({ error: 'Wrong email or password.' });
    render(<SignInScreen />);
    fireEvent.changeText(screen.getByPlaceholderText('Email'), 'a@b.com');
    fireEvent.changeText(screen.getByPlaceholderText('Password'), 'bad');
    fireEvent.press(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Wrong email or password.'));
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('blocks submit when fields are empty', () => {
    render(<SignInScreen />);
    fireEvent.press(screen.getByRole('button', { name: /sign in/i }));
    expect(mockedSignIn).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/fill in/i));
  });
});
