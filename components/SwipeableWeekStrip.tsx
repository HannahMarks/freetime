import { useRef } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { shiftDate } from '../lib/calendar-helpers';
import { WeekStrip } from './WeekStrip';

const SLIDE_DURATION_MS = 220;
const SPRING_BACK_DURATION_MS = 160;
const SLIDE_EASING = Easing.out(Easing.exp);
/** Hard-coded height of a single WeekStrip — chosen to match the
 * intrinsic height of WeekStrip's content (label + 30px bubble +
 * vertical padding). Matters because the panes are absolute-positioned
 * and need their parent to have an explicit height. */
const STRIP_HEIGHT = 70;

type Props = {
  selectedDate: string;
  todayIso: string;
  todayColor?: string;
  /** Tap on any cell, or commit-after-swipe — both fire this. */
  onDateChange: (newDate: string) => void;
};

/**
 * Three WeekStrips side-by-side (last week / this week / next week),
 * with a horizontal Pan gesture that slides them. Past `screenWidth/4`
 * on release, animates the slide and fires `onDateChange` with the
 * same weekday in the adjacent week (i.e. shifted by ±7 days).
 *
 * Mirrors the SwipeableDayCarousel pattern: keyed on `selectedDate` so
 * the post-commit re-mount is visually seamless (the new "curr" pane
 * sits at the same screen position the slide ended on).
 */
export function SwipeableWeekStrip({ selectedDate, todayIso, todayColor, onDateChange }: Props) {
  const { width: screenWidth } = useWindowDimensions();
  const translateX = useSharedValue(0);

  const prevWeekDate = shiftDate(selectedDate, -7);
  const nextWeekDate = shiftDate(selectedDate, 7);

  // Guard against the gesture's animation completion callback firing
  // twice across the key-based re-mount race — without this, a single
  // swipe could occasionally land at +14 days instead of +7.
  const committedRef = useRef(false);
  // True from the moment the Pan activates until well after the slide
  // commits. While true, cell-level taps inside any WeekStrip pane are
  // swallowed — the user just lifted their finger after a swipe; we
  // don't want that lift to register as a fresh date pick.
  const isPanningRef = useRef(false);

  function commit(newDate: string) {
    if (committedRef.current) return;
    committedRef.current = true;
    onDateChange(newDate);
  }

  function setPanning(v: boolean) {
    isPanningRef.current = v;
  }

  // Wraps the inner WeekStrip's onDateChange so cell taps fired during
  // (or just after) a swipe are ignored.
  function guardedDateChange(newDate: string) {
    if (isPanningRef.current) return;
    onDateChange(newDate);
  }

  const pan = Gesture.Pan()
    // 30px is a comfortable threshold — small enough to feel responsive,
    // big enough to never trigger from touch jitter on a tap.
    .activeOffsetX([-30, 30])
    .failOffsetY([-15, 15])
    .onStart(() => {
      runOnJS(setPanning)(true);
    })
    .onUpdate((e) => {
      translateX.value = e.translationX;
    })
    .onEnd((e) => {
      const threshold = screenWidth / 4;
      if (e.translationX < -threshold) {
        translateX.value = withTiming(
          -screenWidth,
          { duration: SLIDE_DURATION_MS, easing: SLIDE_EASING },
          (finished) => {
            if (finished) runOnJS(commit)(nextWeekDate);
          },
        );
      } else if (e.translationX > threshold) {
        translateX.value = withTiming(
          screenWidth,
          { duration: SLIDE_DURATION_MS, easing: SLIDE_EASING },
          (finished) => {
            if (finished) runOnJS(commit)(prevWeekDate);
          },
        );
      } else {
        translateX.value = withTiming(0, {
          duration: SPRING_BACK_DURATION_MS,
          easing: SLIDE_EASING,
        });
      }
    })
    // Keep `isPanning` true through the post-release window so any
    // delayed Pressable.onPress firing from finger-lift is still
    // suppressed. onFinalize fires after onEnd + animation cleanup.
    .onFinalize(() => {
      // Small extra delay before re-enabling cell taps, since the
      // Pressable's onPress fires asynchronously after gesture-handler
      // releases the touch.
      runOnJS(scheduleResetPanning)();
    });

  function scheduleResetPanning() {
    setTimeout(() => setPanning(false), 250);
  }

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  return (
    <View key={selectedDate} style={styles.viewport}>
      <GestureDetector gesture={pan}>
        <Animated.View style={[StyleSheet.absoluteFill, animatedStyle]} collapsable={false}>
          <View style={[styles.pane, { left: -screenWidth, width: screenWidth }]}>
            <WeekStrip
              selectedDate={prevWeekDate}
              todayIso={todayIso}
              todayColor={todayColor}
              onDateChange={guardedDateChange}
            />
          </View>
          <View style={[styles.pane, { left: 0, width: screenWidth }]}>
            <WeekStrip
              selectedDate={selectedDate}
              todayIso={todayIso}
              todayColor={todayColor}
              onDateChange={guardedDateChange}
            />
          </View>
          <View style={[styles.pane, { left: screenWidth, width: screenWidth }]}>
            <WeekStrip
              selectedDate={nextWeekDate}
              todayIso={todayIso}
              todayColor={todayColor}
              onDateChange={guardedDateChange}
            />
          </View>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  viewport: {
    height: STRIP_HEIGHT,
    overflow: 'hidden',
  },
  pane: {
    position: 'absolute',
    top: 0,
    bottom: 0,
  },
});
