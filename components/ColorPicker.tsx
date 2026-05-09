import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

type Props = {
  value: string;
  onChange: (hex: string) => void;
};

/**
 * Hex color picker — 8-swatch quick palette + free-form hex input
 * + live preview.
 *
 * Pure JS, no native deps. Replaced the previous `reanimated-color-picker`
 * wrapper because it crashed on worklet calls in our SDK 54 + new-arch
 * + Reanimated 4 setup. Trade-off: no wheel/panel, but the hex input still
 * lets the user pick any color and the swatches make the common case
 * one tap.
 *
 * Palette intentionally matches the fallback colors in the
 * `handle_new_user` trigger from the profiles migration so a user who
 * keeps the default sees the same color they were auto-assigned.
 */

const PRESETS = [
  '#FF6B6B',
  '#4ECDC4',
  '#FFE66D',
  '#A8E6CF',
  '#FF8CC8',
  '#95B8FF',
  '#FFAA5A',
  '#C7B8EA',
];

const HEX_PATTERN = /^#[0-9A-Fa-f]{6}$/;

function normalizeHex(input: string): string | null {
  const trimmed = input.trim();
  const withHash = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  return HEX_PATTERN.test(withHash) ? withHash.toUpperCase() : null;
}

export function ColorPicker({ value, onChange }: Props) {
  // Local string keeps the input editable while the user is mid-typing
  // (e.g., "#FF6B" — incomplete but on the way to a valid value).
  const [draft, setDraft] = useState(value);

  // Sync local draft when value changes from outside (e.g., a preset tap).
  useEffect(() => {
    setDraft(value);
  }, [value]);

  function handleHexChange(next: string) {
    setDraft(next);
    const normalized = normalizeHex(next);
    if (normalized) onChange(normalized);
  }

  const isValid = normalizeHex(draft) !== null;

  return (
    <View style={styles.container}>
      <View
        testID="color-picker-preview"
        accessibilityRole="image"
        accessibilityLabel={`Selected color ${value}`}
        style={[styles.preview, { backgroundColor: value }]}
      />

      <View style={styles.palette}>
        {PRESETS.map((preset) => {
          const selected = preset.toUpperCase() === value.toUpperCase();
          return (
            <Pressable
              key={preset}
              accessibilityRole="button"
              accessibilityLabel={`Pick color ${preset}`}
              testID={`color-swatch-${preset}`}
              onPress={() => onChange(preset)}
              style={({ pressed }) => [
                styles.swatch,
                { backgroundColor: preset },
                selected && styles.swatchSelected,
                pressed && styles.swatchPressed,
              ]}
            />
          );
        })}
      </View>

      <View style={styles.hexRow}>
        <Text style={styles.hexLabel}>Hex</Text>
        <TextInput
          accessibilityLabel="Hex color value"
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={7}
          placeholder="#FF6B6B"
          style={[styles.hexInput, !isValid && styles.hexInputInvalid]}
          value={draft}
          onChangeText={handleHexChange}
        />
      </View>
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
  palette: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  swatch: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  swatchSelected: {
    borderColor: '#111',
  },
  swatchPressed: { opacity: 0.7 },
  hexRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  hexLabel: { fontSize: 13, fontWeight: '500', color: '#444', width: 36 },
  hexInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 10,
    fontSize: 16,
    fontFamily: 'Menlo',
  },
  hexInputInvalid: { borderColor: '#FF6B6B' },
});
