import { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
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
 * Wraps the month grid (or anything else) with a small drag-handle bar
 * above it. Dragging the handle upward translates the whole group; past
 * `DISMISS_THRESHOLD_PX` on release, fires onDismiss.
 *
 * Why a dedicated handle and not "just drag the calendar":
 * react-native-gesture-handler doesn't reliably release pending-state
 * touches back to non-gesture-handler children. Wrapping the Calendar in
 * a Pan gesture detector — even with `failOffsetX` — broke the
 * Calendar's own next/prev-month horizontal swipe and absorbed taps.
 * Putting the gesture on a dedicated handle leaves the Calendar
 * completely untouched: taps select days, horizontal swipes navigate
 * months, and the handle is the only swipe target.
 */
export function DismissibleMonthGrid({ onDismiss, children }: Props) {
  const translateY = useSharedValue(0);
  const opacity = useSharedValue(1);

  const pan = Gesture.Pan()
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
    <Animated.View testID="dismissible-month-grid" style={animatedStyle}>
      {children}
      <GestureDetector gesture={pan}>
        {/* Dedicated drag-handle area, sits BELOW the calendar so the
            user can drag from the closer-to-center-of-screen edge — the
            top of the calendar tends to be too far up to drag past the
            dismiss threshold comfortably. The handle area is ~28px tall;
            the visible bar inside is smaller. collapsable={false} keeps
            the View as a real Android host so the gesture-handler
            reliably receives touches. */}
        <View
          testID="dismiss-handle"
          collapsable={false}
          style={styles.handleArea}
          accessibilityRole="adjustable"
          accessibilityLabel="Drag up to hide the month grid"
        >
          <View style={styles.handleBar} />
        </View>
      </GestureDetector>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  handleArea: {
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  handleBar: {
    width: 36,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: '#cfcfcf',
  },
});
