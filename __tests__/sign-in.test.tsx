import { render, screen } from '@testing-library/react-native';
import SignInScreen from '../app/(auth)/sign-in';

describe('SignInScreen (smoke)', () => {
  it('renders the freetime title', () => {
    render(<SignInScreen />);
    expect(screen.getByText('freetime')).toBeOnTheScreen();
  });
});
