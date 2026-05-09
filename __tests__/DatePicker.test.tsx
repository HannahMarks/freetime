import { fireEvent, render, screen } from '@testing-library/react-native';
import { Platform } from 'react-native';
import { DatePicker } from '../components/DatePicker';

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

describe('DatePicker (iOS)', () => {
  beforeAll(() => {
    Object.defineProperty(Platform, 'OS', { get: () => 'ios', configurable: true });
  });

  it('renders the native picker inline in date mode with display=compact', () => {
    render(<DatePicker value={new Date(2026, 4, 13)} onChange={jest.fn()} testID="dp" />);
    expect(lastNativePickerProps?.mode).toBe('date');
    expect(lastNativePickerProps?.display).toBe('compact');
    expect(lastNativePickerProps?.testID).toBe('dp');
  });

  it("forwards the picker's selected date to onChange", () => {
    const onChange = jest.fn();
    render(<DatePicker value={new Date(2026, 4, 13)} onChange={onChange} />);
    const picked = new Date(2026, 4, 16);
    lastNativePickerProps?.onChange?.({ type: 'set' }, picked);
    expect(onChange).toHaveBeenCalledWith(picked);
  });

  it('does not call onChange when the picker yields no value', () => {
    const onChange = jest.fn();
    render(<DatePicker value={new Date(2026, 4, 13)} onChange={onChange} />);
    lastNativePickerProps?.onChange?.({ type: 'dismissed' }, undefined);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('DatePicker (Android)', () => {
  beforeAll(() => {
    Object.defineProperty(Platform, 'OS', { get: () => 'android', configurable: true });
  });

  it('renders a button (no dialog) until tapped', () => {
    render(<DatePicker value={new Date(2026, 4, 13)} onChange={jest.fn()} testID="dp" />);
    expect(screen.getByTestId('dp')).toBeOnTheScreen();
    expect(lastNativePickerProps).toBeNull();
  });

  it('opens the dialog on tap and forwards the picked date', () => {
    const onChange = jest.fn();
    render(<DatePicker value={new Date(2026, 4, 13)} onChange={onChange} testID="dp" />);
    fireEvent.press(screen.getByTestId('dp'));

    expect(lastNativePickerProps?.mode).toBe('date');
    const picked = new Date(2026, 4, 16);
    lastNativePickerProps?.onChange?.({ type: 'set' }, picked);
    expect(onChange).toHaveBeenCalledWith(picked);
  });

  it('does not call onChange when the dialog is dismissed', () => {
    const onChange = jest.fn();
    render(<DatePicker value={new Date(2026, 4, 13)} onChange={onChange} testID="dp" />);
    fireEvent.press(screen.getByTestId('dp'));
    lastNativePickerProps?.onChange?.({ type: 'dismissed' }, undefined);
    expect(onChange).not.toHaveBeenCalled();
  });
});
