import { render, screen } from '@testing-library/react-native';
import { ColorPicker } from '../components/ColorPicker';

// Stub the heavy reanimated-color-picker lib — we only need to verify that
// our wrapper renders a preview reflecting the current value. The library's
// own gesture/animation behavior isn't ours to test.
jest.mock('reanimated-color-picker', () => {
  const React = require('react');
  const View = ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children);
  return {
    __esModule: true,
    default: View,
    Panel1: () => null,
    HueSlider: () => null,
    Preview: () => null,
    Swatches: () => null,
  };
});

describe('ColorPicker', () => {
  it('renders a preview swatch reflecting the current value', () => {
    render(<ColorPicker value="#FF6B6B" onChange={jest.fn()} />);
    const preview = screen.getByTestId('color-picker-preview');
    expect(preview).toHaveStyle({ backgroundColor: '#FF6B6B' });
  });

  it('updates the preview when value changes', () => {
    const { rerender } = render(<ColorPicker value="#FF6B6B" onChange={jest.fn()} />);
    rerender(<ColorPicker value="#4ECDC4" onChange={jest.fn()} />);
    expect(screen.getByTestId('color-picker-preview')).toHaveStyle({
      backgroundColor: '#4ECDC4',
    });
  });
});
