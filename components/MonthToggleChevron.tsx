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

  const animatedStyle = useAnimatedStyle(() => {
    // RN doesn't merge `transform` arrays across styles — the later
    // style's transform replaces earlier ones. So scaleX + translateY
    // must live INSIDE this animated style, not the static `chevron`
    // style, otherwise they're silently dropped when the rotation is
    // applied (this was a quiet bug for several rounds — the chevron
    // wasn't actually scaled or translated, only rotated).
    //
    // The `⌄` glyph's visible mass shifts up/down depending on
    // rotation (asymmetry inside its line box). Counteract by
    // interpolating translateY against rotation so both the
    // pointing-down and pointing-up states land on the text's
    // optical center: 0° → +3px, 180° → -3px.
    const compensation = 3 - (rotation.value / 180) * 6;
    return {
      transform: [
        { translateY: compensation },
        { scaleX: 3 },
        { rotate: `${rotation.value}deg` },
      ],
    };
  });

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
    // No `transform` here — all transforms (scaleX, translateY,
    // rotate) live in the animated style above, because RN replaces
    // (not merges) `transform` arrays across the style cascade.
  },
});
