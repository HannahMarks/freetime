import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

const ROTATION_DURATION_MS = 240;

/** fontSize + lineHeight that the calendar screen's adjacent month
 * label should match so both line boxes are the same height and
 * `alignItems: 'center'` cleanly aligns visual centers. */
export const monthHeaderFontSize = 22;
export const monthHeaderLineHeight = 28;

/** Chevron geometry — drawn manually with two Views forming a V so
 * the visual center stays at the container's geometric center
 * regardless of rotation (a Unicode `⌄` glyph has its mass off-center
 * within the line box, which made it impossible to align with the
 * adjacent text across both rotated states).
 *
 * The angle for the two arms to meet exactly at the bottom-center
 * vertex satisfies `2 sin θ = 1 + cos θ` — solved at θ ≈ 53.13°,
 * regardless of container dimensions. Arm length then = container
 * height / sin(53.13°) = 1.25 × container height. With container
 * 16×8, arms are 10 wide at 53° and meet exactly at (8, 8). The
 * previous 28° angle left a visible gap between the arm tips, so
 * the V never properly closed.
 */
// 16×8 with a 2.75 stroke. ARM_WIDTH is slightly OVERSIZED beyond the
// strict math — `ARM_WIDTH = HEIGHT × 1.25 = 10` would make the arms
// exactly meet at the bottom-center vertex IF the arms had
// infinitely-thin tips, but with thickness 2.75 (and previously rounded
// borderRadius caps), the arm tips sat shy of the vertex and left a
// visible gap. Bumping ARM_WIDTH 10 → 11 lets the arms overlap by
// ~1px at the vertex, fully closing the V. Sharp (square) ends
// instead of rounded keep the join clean.
const CHEVRON_WIDTH = 16;
const CHEVRON_HEIGHT = 8;
const ARM_WIDTH = 11;
const ARM_THICKNESS = 2.75;
const ARM_TILT_DEG = 53;
/** Default chevron color — matches the calendar header's text. The
 * `color` prop overrides for callers that want a different tint. */
const DEFAULT_CHEVRON_COLOR = '#111';

type Props = {
  /** True when the month grid is expanded (chevron points up). */
  expanded: boolean;
  onPress: () => void;
  /** Color of the V's arms. Defaults to `#111` so the chevron matches
   * the calendar's heavy-weight month label sitting next to it. */
  color?: string;
};

/**
 * Open-chevron toggle for the month-grid drawer. The chevron is two
 * thin View bars that meet at the bottom-center to form a V; rotation
 * 0° → 180° flips it to a Λ. Container is sized via constants so the
 * chevron's exact width/height are predictable.
 */
export function MonthToggleChevron({ expanded, onPress, color = DEFAULT_CHEVRON_COLOR }: Props) {
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
      <Animated.View style={[styles.chevronBox, animatedStyle]}>
        <View style={[styles.arm, styles.armLeft, { backgroundColor: color }]} />
        <View style={[styles.arm, styles.armRight, { backgroundColor: color }]} />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    paddingHorizontal: 4,
    paddingVertical: 0,
    // Match the line-box height of the adjacent month label so
    // alignItems: 'center' in the parent puts our visual center at
    // the same y as the text's visual center.
    height: monthHeaderLineHeight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPressed: { opacity: 0.6 },
  chevronBox: {
    width: CHEVRON_WIDTH,
    height: CHEVRON_HEIGHT,
    position: 'relative',
  },
  arm: {
    position: 'absolute',
    width: ARM_WIDTH,
    height: ARM_THICKNESS,
    // backgroundColor is set inline from the `color` prop so the chevron
    // can match the calendar's text color.
    // No borderRadius: rounded caps were curving back and leaving a
    // visible gap at the vertex where the two arms meet. Square tips
    // close the V cleanly.
    // Vertically center the bars before rotation, so rotating around
    // each bar's geometric center makes them swing symmetrically into
    // a V (or Λ when the parent is rotated 180°).
    top: (CHEVRON_HEIGHT - ARM_THICKNESS) / 2,
  },
  armLeft: {
    left: 0,
    transform: [{ rotate: `${ARM_TILT_DEG}deg` }],
  },
  armRight: {
    right: 0,
    transform: [{ rotate: `${-ARM_TILT_DEG}deg` }],
  },
});
