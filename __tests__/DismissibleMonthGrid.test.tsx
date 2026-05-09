import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { DismissibleMonthGrid } from '../components/DismissibleMonthGrid';

describe('DismissibleMonthGrid', () => {
  it('renders its children inside a wrapper carrying the dismissible-month-grid testID', () => {
    render(
      <DismissibleMonthGrid onDismiss={jest.fn()}>
        <Text testID="child">hello</Text>
      </DismissibleMonthGrid>,
    );
    expect(screen.getByTestId('dismissible-month-grid')).toBeOnTheScreen();
    expect(screen.getByTestId('child')).toBeOnTheScreen();
  });
});
