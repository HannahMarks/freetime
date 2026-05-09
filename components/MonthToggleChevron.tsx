import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

const AnimatedText = Animated.createAnimatedComponent(Text);

const ROTATION_DURATION_MS = 240;
/** Visual center of the chevron glyph and of the adjacent month label
 * are aligned by rendering both inside line boxes of this exact height
 * with `justifyContent: 'center'`. */
const ALIGN_LINE_HEIGHT = 22;

type Props = {
  /** True when the month grid is expanded (chevron points up). */
  expanded: boolean;
  onPress: () => void;
};

/**
 * Open-chevron toggle that rotates 180° when `expanded` flips. The arrow
 * itself is a single `⌄` (Down Arrowhead, U+2304) — pointing-down at
 * rest, rotating to point up when the month grid is open.
 */
export function MonthToggleChevron({ expanded, onPress }: Props) {
  const rotation = useSharedValue(expanded ? 180 : 0);

  useEffect(() => {
    rotation.value = withTiming(expanded ? 180 : 0, {
      duration: ROTATION_DURATION_MS,
      easing: Easing.out(Easing.cubic),
    });
  }, [expanded, rotation]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={expanded ? 'Hide month grid' : 'Show month grid'}
      testID="toggle-month-grid"
      onPress={onPress}
      hitSlop={12}
      style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
    >
      {/* Fixed-height box centers the glyph vertically. With the parent
          row using alignItems: 'center', this puts the glyph's visual
          center exactly at the row's middle line — same as the
          adjacent month label. */}
      <View style={styles.glyphBox}>
        <AnimatedText style={[styles.chevron, animatedStyle]}>⌄</AnimatedText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    paddingHorizontal: 2,
    paddingVertical: 0,
  },
  buttonPressed: { opacity: 0.6 },
  glyphBox: {
    height: ALIGN_LINE_HEIGHT,
    width: ALIGN_LINE_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chevron: {
    fontSize: 16,
    lineHeight: 16,
    color: '#444',
    fontWeight: '700',
    textAlign: 'center',
    includeFontPadding: false,
  },
});
