import { useEffect } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

const AnimatedText = Animated.createAnimatedComponent(Text);

const ROTATION_DURATION_MS = 200;

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
      <AnimatedText style={[styles.chevron, animatedStyle]}>⌄</AnimatedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { padding: 6 },
  buttonPressed: { opacity: 0.6 },
  chevron: {
    fontSize: 18,
    color: '#666',
    fontWeight: '300',
  },
});
