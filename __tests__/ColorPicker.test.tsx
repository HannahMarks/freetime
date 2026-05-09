import { fireEvent, render, screen } from '@testing-library/react-native';
import { ColorPicker } from '../components/ColorPicker';

describe('ColorPicker', () => {
  it('renders a preview swatch reflecting the current value', () => {
    render(<ColorPicker value="#FF6B6B" onChange={jest.fn()} />);
    expect(screen.getByTestId('color-picker-preview')).toHaveStyle({
      backgroundColor: '#FF6B6B',
    });
  });

  it('updates the preview when value changes', () => {
    const { rerender } = render(<ColorPicker value="#FF6B6B" onChange={jest.fn()} />);
    rerender(<ColorPicker value="#4ECDC4" onChange={jest.fn()} />);
    expect(screen.getByTestId('color-picker-preview')).toHaveStyle({
      backgroundColor: '#4ECDC4',
    });
  });

  it('renders the 8 preset swatches', () => {
    render(<ColorPicker value="#FF6B6B" onChange={jest.fn()} />);
    for (const preset of [
      '#FF6B6B',
      '#4ECDC4',
      '#FFE66D',
      '#A8E6CF',
      '#FF8CC8',
      '#95B8FF',
      '#FFAA5A',
      '#C7B8EA',
    ]) {
      expect(screen.getByTestId(`color-swatch-${preset}`)).toBeOnTheScreen();
    }
  });

  it('calls onChange with the preset hex when a swatch is tapped', () => {
    const onChange = jest.fn();
    render(<ColorPicker value="#FF6B6B" onChange={onChange} />);
    fireEvent.press(screen.getByTestId('color-swatch-#4ECDC4'));
    expect(onChange).toHaveBeenCalledWith('#4ECDC4');
  });

  it('calls onChange with a normalized uppercase hex when a valid value is typed', () => {
    const onChange = jest.fn();
    render(<ColorPicker value="#FF6B6B" onChange={onChange} />);
    fireEvent.changeText(screen.getByLabelText('Hex color value'), '#abcdef');
    expect(onChange).toHaveBeenCalledWith('#ABCDEF');
  });

  it('accepts hex values without a leading # and prepends one', () => {
    const onChange = jest.fn();
    render(<ColorPicker value="#FF6B6B" onChange={onChange} />);
    fireEvent.changeText(screen.getByLabelText('Hex color value'), '123ABC');
    expect(onChange).toHaveBeenCalledWith('#123ABC');
  });

  it('does not call onChange while the typed value is incomplete or invalid', () => {
    const onChange = jest.fn();
    render(<ColorPicker value="#FF6B6B" onChange={onChange} />);
    fireEvent.changeText(screen.getByLabelText('Hex color value'), '#FF6');
    fireEvent.changeText(screen.getByLabelText('Hex color value'), 'not-a-hex');
    expect(onChange).not.toHaveBeenCalled();
  });
});
