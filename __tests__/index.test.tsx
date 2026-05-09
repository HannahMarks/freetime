import { render, screen } from '@testing-library/react-native';
import Index from '../app/index';
import { useAuth } from '../lib/auth';

jest.mock('../lib/auth', () => ({
  useAuth: jest.fn(),
}));

const mockedRedirect = jest.fn((_props: { href: string }) => null);
jest.mock('expo-router', () => ({
  Redirect: (props: { href: string }) => {
    mockedRedirect(props);
    return null;
  },
}));

const mockedUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;

describe('Index (root route)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders an activity indicator while auth state is loading', () => {
    mockedUseAuth.mockReturnValue({ session: null, loading: true });
    render(<Index />);
    expect(screen.getByTestId('root-loading')).toBeOnTheScreen();
    expect(mockedRedirect).not.toHaveBeenCalled();
  });

  it('redirects to /(auth)/sign-in when there is no session', () => {
    mockedUseAuth.mockReturnValue({ session: null, loading: false });
    render(<Index />);
    expect(mockedRedirect).toHaveBeenCalledWith({ href: '/(auth)/sign-in' });
  });

  it('redirects to /(app)/calendar when a session exists', () => {
    mockedUseAuth.mockReturnValue({
      session: { user: { id: 'me-id' } } as never,
      loading: false,
    });
    render(<Index />);
    expect(mockedRedirect).toHaveBeenCalledWith({ href: '/(app)/calendar' });
  });
});
