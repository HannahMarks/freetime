import { fireEvent, render, screen } from '@testing-library/react-native';
import { Platform } from 'react-native';
import { TimePicker } from '../components/TimePicker';

// Capture the most recent props the underlying lib was rendered with so
// tests can both verify the props *and* simulate a pick.
let lastNativePickerProps: {
  value?: Date;
  mode?: string;
  display?: string;
  onChange?: (event: { type: string }, picked?: Date) => void;
  testID?: string;
} | null = null;

jest.mock('@react-native-community/datetimepicker', () => {
  return function NativePickerStub(props: typeof lastNativePickerProps) {
    lastNativePickerProps = props;
    return null;
  };
});

beforeEach(() => {
  lastNativePickerProps = null;
});

describe('TimePicker (iOS)', () => {
  beforeAll(() => {
    Object.defineProperty(Platform, 'OS', { get: () => 'ios', configurable: true });
  });

  it('renders the native picker inline with display=compact', () => {
    render(<TimePicker value={new Date(2026, 4, 13, 9, 0)} onChange={jest.fn()} testID="tp" />);
    expect(lastNativePickerProps?.mode).toBe('time');
    expect(lastNativePickerProps?.display).toBe('compact');
    expect(lastNativePickerProps?.testID).toBe('tp');
  });

  it("forwards the picker's selected date to onChange", () => {
    const onChange = jest.fn();
    render(<TimePicker value={new Date(2026, 4, 13, 9, 0)} onChange={onChange} />);
    const picked = new Date(2026, 4, 13, 14, 30);
    lastNativePickerProps?.onChange?.({ type: 'set' }, picked);
    expect(onChange).toHaveBeenCalledWith(picked);
  });

  it('does not call onChange when the picker yields no value', () => {
    const onChange = jest.fn();
    render(<TimePicker value={new Date(2026, 4, 13, 9, 0)} onChange={onChange} />);
    lastNativePickerProps?.onChange?.({ type: 'dismissed' }, undefined);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('TimePicker (Android)', () => {
  beforeAll(() => {
    Object.defineProperty(Platform, 'OS', { get: () => 'android', configurable: true });
  });

  it('renders a button (no dialog) until tapped', () => {
    render(<TimePicker value={new Date(2026, 4, 13, 9, 0)} onChange={jest.fn()} testID="tp" />);
    expect(screen.getByTestId('tp')).toBeOnTheScreen();
    expect(lastNativePickerProps).toBeNull();
  });

  it('opens the dialog on tap and forwards the picked date', () => {
    const onChange = jest.fn();
    render(<TimePicker value={new Date(2026, 4, 13, 9, 0)} onChange={onChange} testID="tp" />);
    fireEvent.press(screen.getByTestId('tp'));

    // After tap, the picker is mounted.
    expect(lastNativePickerProps?.mode).toBe('time');
    const picked = new Date(2026, 4, 13, 14, 30);
    lastNativePickerProps?.onChange?.({ type: 'set' }, picked);
    expect(onChange).toHaveBeenCalledWith(picked);
  });

  it('does not call onChange when the dialog is dismissed', () => {
    const onChange = jest.fn();
    render(<TimePicker value={new Date(2026, 4, 13, 9, 0)} onChange={onChange} testID="tp" />);
    fireEvent.press(screen.getByTestId('tp'));
    lastNativePickerProps?.onChange?.({ type: 'dismissed' }, undefined);
    expect(onChange).not.toHaveBeenCalled();
  });
});
