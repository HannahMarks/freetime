import { ReactNode } from 'react';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

/** How far up the user must drag before release dismisses, in pixels. */
const DISMISS_THRESHOLD_PX = -120;
/** Distance the wrapper translates to when fully dismissing (px upward). */
const DISMISSED_TRANSLATE_PX = -360;
/** Drag distance over which opacity fades from 1 to 0. */
const FADE_DISTANCE_PX = 200;

type Props = {
  /** Fires once an upward swipe past `DISMISS_THRESHOLD_PX` is released.
   * The wrapper already animates the contents off-screen — the parent
   * just toggles whatever state hides the grid. */
  onDismiss: () => void;
  children: ReactNode;
};

/**
 * Wraps the month grid so the user can swipe it upward to hide it. Pan
 * activates only after 15px of vertical movement, so day-taps and the
 * Calendar's own horizontal month-swipes are unaffected. On release:
 * past threshold → animate off-screen + fire onDismiss; otherwise spring
 * back to zero.
 */
export function DismissibleMonthGrid({ onDismiss, children }: Props) {
  const translateY = useSharedValue(0);
  const opacity = useSharedValue(1);

  const pan = Gesture.Pan()
    .activeOffsetY([-15, 9999])
    .onUpdate((e) => {
      translateY.value = Math.min(0, e.translationY);
      opacity.value = Math.max(0, 1 + e.translationY / FADE_DISTANCE_PX);
    })
    .onEnd((e) => {
      if (e.translationY < DISMISS_THRESHOLD_PX) {
        translateY.value = withTiming(DISMISSED_TRANSLATE_PX, { duration: 150 });
        opacity.value = withTiming(0, { duration: 150 });
        runOnJS(onDismiss)();
      } else {
        translateY.value = withTiming(0, { duration: 150 });
        opacity.value = withTiming(1, { duration: 150 });
      }
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    opacity: opacity.value,
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View testID="dismissible-month-grid" style={animatedStyle}>
        {children}
      </Animated.View>
    </GestureDetector>
  );
}
