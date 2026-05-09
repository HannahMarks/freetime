import { fireEvent, render, screen } from '@testing-library/react-native';
import { SwipeableWeekStrip } from '../components/SwipeableWeekStrip';

describe('SwipeableWeekStrip', () => {
  it('renders three WeekStrip panes (prev / curr / next week)', () => {
    // Wed May 13 2026 — current week is May 10-16; prev week is May 3-9;
    // next week is May 17-23. All three sets of cells should be in the
    // tree (the pane outside the viewport is just visually offscreen).
    render(
      <SwipeableWeekStrip
        selectedDate="2026-05-13"
        todayIso="2026-05-13"
        onDateChange={jest.fn()}
      />,
    );
    // Curr week
    expect(screen.getByTestId('week-cell-2026-05-13')).toBeOnTheScreen();
    // Prev week (one cell from each is enough as a sanity check)
    expect(screen.getByTestId('week-cell-2026-05-06')).toBeOnTheScreen();
    // Next week
    expect(screen.getByTestId('week-cell-2026-05-20')).toBeOnTheScreen();
  });

  it('forwards onDateChange when a cell in the current pane is tapped', () => {
    const onDateChange = jest.fn();
    render(
      <SwipeableWeekStrip
        selectedDate="2026-05-13"
        todayIso="2026-05-13"
        onDateChange={onDateChange}
      />,
    );
    fireEvent.press(screen.getByTestId('week-cell-2026-05-15'));
    expect(onDateChange).toHaveBeenCalledWith('2026-05-15');
  });
});
