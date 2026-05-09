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
/** Both glyph and adjacent label share this fontSize + lineHeight so
 * their line boxes are the same height and align cleanly via the
 * parent row's alignItems: 'center'. */
const HEADER_FONT_SIZE = 22;
const HEADER_LINE_HEIGHT = 28;

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
      {/* Same fontSize + lineHeight as the adjacent month label so the
          two line boxes have identical heights and the parent row's
          alignItems: 'center' centers both visually. scaleX widens
          the glyph horizontally so the chevron isn't a thin sliver. */}
      <AnimatedText style={[styles.chevron, animatedStyle]}>⌄</AnimatedText>
    </Pressable>
  );
}

/** Font sizing exported so the calendar screen can match its month
 * label exactly — keeps the chevron and label on the same line box. */
export const monthHeaderFontSize = HEADER_FONT_SIZE;
export const monthHeaderLineHeight = HEADER_LINE_HEIGHT;

const styles = StyleSheet.create({
  button: {
    paddingHorizontal: 4,
    paddingVertical: 0,
  },
  buttonPressed: { opacity: 0.6 },
  chevron: {
    fontSize: HEADER_FONT_SIZE,
    lineHeight: HEADER_LINE_HEIGHT,
    color: '#444',
    fontWeight: '700',
    textAlign: 'center',
    includeFontPadding: false,
    // Wider chevron — gives the open arrow more presence next to
    // the larger month label.
    transform: [{ scaleX: 1.4 }],
  },
});
