import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import ProfileScreen from '../app/(app)/profile';
import { signOut } from '../lib/auth-actions';
import { toast } from '../lib/toast';

jest.mock('../lib/auth-actions', () => ({
  signOut: jest.fn(),
}));

jest.mock('../lib/toast', () => ({
  toast: { error: jest.fn(), success: jest.fn() },
}));

const mockedSignOut = signOut as jest.MockedFunction<typeof signOut>;

describe('ProfileScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls signOut helper when the button is pressed', async () => {
    mockedSignOut.mockResolvedValue({ error: null });
    render(<ProfileScreen />);
    fireEvent.press(screen.getByRole('button', { name: /sign out/i }));
    await waitFor(() => expect(mockedSignOut).toHaveBeenCalledTimes(1));
  });

  it('shows an error toast if sign out fails', async () => {
    mockedSignOut.mockResolvedValue({ error: 'Something went wrong. Please try again.' });
    render(<ProfileScreen />);
    fireEvent.press(screen.getByRole('button', { name: /sign out/i }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Something went wrong. Please try again.'),
    );
  });
});
