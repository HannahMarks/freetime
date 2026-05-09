import { fireEvent, render, screen } from '@testing-library/react-native';
import { WeekStrip } from '../components/WeekStrip';

describe('WeekStrip', () => {
  it('renders 7 cells for the week containing the selected date (Sun → Sat)', () => {
    // Wednesday May 13 2026 → week is May 10 (Sun) … May 16 (Sat).
    render(
      <WeekStrip selectedDate="2026-05-13" todayIso="2026-05-13" onDateChange={jest.fn()} />,
    );
    expect(screen.getByTestId('week-cell-2026-05-10')).toBeOnTheScreen();
    expect(screen.getByTestId('week-cell-2026-05-11')).toBeOnTheScreen();
    expect(screen.getByTestId('week-cell-2026-05-12')).toBeOnTheScreen();
    expect(screen.getByTestId('week-cell-2026-05-13')).toBeOnTheScreen();
    expect(screen.getByTestId('week-cell-2026-05-14')).toBeOnTheScreen();
    expect(screen.getByTestId('week-cell-2026-05-15')).toBeOnTheScreen();
    expect(screen.getByTestId('week-cell-2026-05-16')).toBeOnTheScreen();
  });

  it('crosses month boundaries cleanly', () => {
    // Tuesday June 2 2026 → week is May 31 (Sun) … June 6 (Sat).
    render(
      <WeekStrip selectedDate="2026-06-02" todayIso="2026-06-02" onDateChange={jest.fn()} />,
    );
    expect(screen.getByTestId('week-cell-2026-05-31')).toBeOnTheScreen();
    expect(screen.getByTestId('week-cell-2026-06-06')).toBeOnTheScreen();
  });

  it('fires onDateChange with the YYYY-MM-DD of a tapped cell', () => {
    const onDateChange = jest.fn();
    render(
      <WeekStrip selectedDate="2026-05-13" todayIso="2026-05-13" onDateChange={onDateChange} />,
    );
    fireEvent.press(screen.getByTestId('week-cell-2026-05-15'));
    expect(onDateChange).toHaveBeenCalledWith('2026-05-15');
  });

  it('marks the selected day with the selected accessibility hint', () => {
    render(
      <WeekStrip selectedDate="2026-05-13" todayIso="2026-05-13" onDateChange={jest.fn()} />,
    );
    expect(screen.getByLabelText(/Wed 13 selected/)).toBeOnTheScreen();
  });
});
