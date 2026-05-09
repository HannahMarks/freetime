import { StyleSheet, View } from 'react-native';
import RnColorPicker, { HueSlider, Panel1 } from 'reanimated-color-picker';

type Props = {
  value: string;
  onChange: (hex: string) => void;
};

/**
 * Hex color picker — saturation/value panel + hue slider.
 *
 * Wraps `reanimated-color-picker` so callers see a stable interface
 * (`value` + `onChange`) and we can swap the underlying library later
 * without touching screens.
 */
export function ColorPicker({ value, onChange }: Props) {
  return (
    <View style={styles.container}>
      <View
        testID="color-picker-preview"
        accessibilityRole="image"
        accessibilityLabel={`Selected color ${value}`}
        style={[styles.preview, { backgroundColor: value }]}
      />
      <RnColorPicker
        style={styles.picker}
        value={value}
        onComplete={({ hex }) => onChange(hex)}
      >
        <Panel1 style={styles.panel} />
        <HueSlider style={styles.hue} />
      </RnColorPicker>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 12 },
  preview: {
    height: 48,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e5e5e5',
  },
  picker: { gap: 12 },
  panel: { height: 200, borderRadius: 8 },
  hue: { borderRadius: 999 },
});
