import { fireEvent, render, screen } from '@testing-library/react-native';
import { FabMultiAction } from '../components/FabMultiAction';

describe('FabMultiAction', () => {
  const profileColor = '#9C27B0';

  it('renders only the primary FAB when collapsed', () => {
    render(
      <FabMultiAction
        color={profileColor}
        onPressBusy={jest.fn()}
        onPressEvent={jest.fn()}
      />,
    );
    expect(screen.getByTestId('fab-primary')).toBeOnTheScreen();
    // Sub-FABs are hidden — actions can only fire via the primary
    // FAB → expand → tap-action flow.
    expect(screen.queryByTestId('fab-action-busy')).toBeNull();
    expect(screen.queryByTestId('fab-action-event')).toBeNull();
  });

  it('reveals both sub-FABs after tapping the primary FAB', () => {
    render(
      <FabMultiAction
        color={profileColor}
        onPressBusy={jest.fn()}
        onPressEvent={jest.fn()}
      />,
    );
    fireEvent.press(screen.getByTestId('fab-primary'));
    expect(screen.getByTestId('fab-action-busy')).toBeOnTheScreen();
    expect(screen.getByTestId('fab-action-event')).toBeOnTheScreen();
  });

  it('collapses again on a second primary tap', () => {
    render(
      <FabMultiAction
        color={profileColor}
        onPressBusy={jest.fn()}
        onPressEvent={jest.fn()}
      />,
    );
    fireEvent.press(screen.getByTestId('fab-primary'));
    fireEvent.press(screen.getByTestId('fab-primary'));
    expect(screen.queryByTestId('fab-action-busy')).toBeNull();
    expect(screen.queryByTestId('fab-action-event')).toBeNull();
  });

  it('fires onPressBusy and collapses when the Busy sub-FAB is tapped', () => {
    const onPressBusy = jest.fn();
    const onPressEvent = jest.fn();
    render(
      <FabMultiAction
        color={profileColor}
        onPressBusy={onPressBusy}
        onPressEvent={onPressEvent}
      />,
    );
    fireEvent.press(screen.getByTestId('fab-primary'));
    fireEvent.press(screen.getByTestId('fab-action-busy'));
    expect(onPressBusy).toHaveBeenCalledTimes(1);
    expect(onPressEvent).not.toHaveBeenCalled();
    // Expanded sub-FABs auto-collapse so the user doesn't have to tap
    // the primary again to dismiss the row.
    expect(screen.queryByTestId('fab-action-busy')).toBeNull();
  });

  it('fires onPressEvent and collapses when the Event sub-FAB is tapped', () => {
    const onPressBusy = jest.fn();
    const onPressEvent = jest.fn();
    render(
      <FabMultiAction
        color={profileColor}
        onPressBusy={onPressBusy}
        onPressEvent={onPressEvent}
      />,
    );
    fireEvent.press(screen.getByTestId('fab-primary'));
    fireEvent.press(screen.getByTestId('fab-action-event'));
    expect(onPressEvent).toHaveBeenCalledTimes(1);
    expect(onPressBusy).not.toHaveBeenCalled();
    expect(screen.queryByTestId('fab-action-event')).toBeNull();
  });

  it("paints the event sub-FAB outline in a darker version of the user's color", () => {
    render(
      <FabMultiAction
        color="#9C27B0"
        onPressBusy={jest.fn()}
        onPressEvent={jest.fn()}
      />,
    );
    fireEvent.press(screen.getByTestId('fab-primary'));
    const eventFab = screen.getByTestId('fab-action-event');
    const style = Array.isArray(eventFab.props.style)
      ? Object.assign({}, ...eventFab.props.style)
      : eventFab.props.style;
    // 9C → 9C*0.7 = 109.2 → 109 = 0x6d; 27 → 27 → 0x1b; B0 → 0x7b
    // (rounded). The exact channel math is verified in
    // color-helpers.test.ts; here we just assert it's NOT the original.
    expect(style.borderColor.toLowerCase()).not.toBe('#9c27b0');
  });

  it('paints the busy sub-FAB outline in the user color (unmodified)', () => {
    render(
      <FabMultiAction
        color="#9C27B0"
        onPressBusy={jest.fn()}
        onPressEvent={jest.fn()}
      />,
    );
    fireEvent.press(screen.getByTestId('fab-primary'));
    const busyFab = screen.getByTestId('fab-action-busy');
    const style = Array.isArray(busyFab.props.style)
      ? Object.assign({}, ...busyFab.props.style)
      : busyFab.props.style;
    expect(style.borderColor.toLowerCase()).toBe('#9c27b0');
  });

  it('falls back to a sensible default color when no color is provided', () => {
    // Should NOT crash if profile.color hasn't loaded yet (auth in
    // flight). The component just paints with the fallback.
    expect(() =>
      render(
        <FabMultiAction
          onPressBusy={jest.fn()}
          onPressEvent={jest.fn()}
        />,
      ),
    ).not.toThrow();
    expect(screen.getByTestId('fab-primary')).toBeOnTheScreen();
  });
});
