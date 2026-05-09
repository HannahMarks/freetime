import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { DismissibleMonthGrid } from '../components/DismissibleMonthGrid';

describe('DismissibleMonthGrid', () => {
  it('renders the wrapper, the dedicated drag handle, and its children', () => {
    render(
      <DismissibleMonthGrid onDismiss={jest.fn()}>
        <Text testID="child">hello</Text>
      </DismissibleMonthGrid>,
    );
    expect(screen.getByTestId('dismissible-month-grid')).toBeOnTheScreen();
    expect(screen.getByTestId('dismiss-handle')).toBeOnTheScreen();
    expect(screen.getByTestId('child')).toBeOnTheScreen();
  });
});
