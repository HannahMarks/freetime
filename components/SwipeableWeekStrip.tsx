import { useLayoutEffect, useRef, useState } from 'react';
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

// Slightly longer than 180ms ("almost there but smoother") with the
// same gentle inOut(cubic) curve. Pre-rendered next-pane content
// means there's no actual layout flicker — what felt like "catch-up"
// in the past was the slide duration itself, so 240 is a comfortable
// landing.
const SLIDE_DURATION_MS = 240;
const SPRING_BACK_DURATION_MS = 180;
const SLIDE_EASING = Easing.inOut(Easing.cubic);
/** Hard-coded height of a single WeekStrip — chosen to match the
 * intrinsic height of WeekStrip's content (label + 30px bubble +
 * vertical padding). Matters because the panes are absolute-positioned
 * and need their parent to have an explicit height. */
const STRIP_HEIGHT = 70;
/** How far the user must drag horizontally before the swipe activates.
 * Bigger = harder to trigger from a tap with finger jitter. */
const ACTIVATION_OFFSET_PX = 30;
/** Window after a swipe during which cell-level taps are swallowed —
 * stops the finger-lift from being read as a fresh date pick. */
const POST_SWIPE_TAP_LOCKOUT_MS = 250;

type Props = {
  selectedDate: string;
  todayIso: string;
  todayColor?: string;
  /** Tap on any cell, or commit-after-swipe — both fire this. */
  onDateChange: (newDate: string) => void;
};

/**
 * Three WeekStrips side-by-side (last week / this week / next week),
 * with a horizontal Pan gesture that slides them.
 *
 * Architecture: the carousel keeps its own `layoutDate` state for
 * positioning the three panes, decoupled from the parent's
 * `selectedDate` prop. On a swipe-commit, layoutDate + translateX +
 * onDateChange are all updated atomically, avoiding the race
 * conditions that came with key-based remount (the previous attempt
 * left a useRef-backed `committedRef` stuck at `true` after the first
 * swipe, blocking subsequent ones — and let parent re-renders feed
 * stale `nextWeekDate` closures into the gesture mid-swipe).
 *
 * When `selectedDate` changes externally (e.g. tap in the month grid),
 * the `useEffect` resyncs layoutDate and re-centers translateX.
 */
export function SwipeableWeekStrip({ selectedDate, todayIso, todayColor, onDateChange }: Props) {
  const { width: screenWidth } = useWindowDimensions();
  const translateX = useSharedValue(0);

  // Internal layout date — drives the prev/curr/next pane dates. Stays
  // independent of the `selectedDate` prop while a swipe is in
  // progress (the Pan gesture's closure captures THIS, not the prop,
  // so it can't go stale mid-swipe).
  const [layoutDate, setLayoutDate] = useState(selectedDate);

  // Sync layoutDate with the prop AND reset translateX, both in
  // useLayoutEffect (synchronous after React commit, before paint) so
  // the same paint shows the new layout AT translateX=0. Without this,
  // the worklet's translateX update could land on a different frame
  // than the React layout commit, briefly painting the wrong pane at
  // center → "text changes after the swipe" flicker.
  useLayoutEffect(() => {
    if (layoutDate !== selectedDate) {
      setLayoutDate(selectedDate);
    }
    translateX.value = 0;
  }, [selectedDate, layoutDate, translateX]);

  // True from Pan activation until POST_SWIPE_TAP_LOCKOUT_MS after the
  // gesture finalizes. While true, cell-level taps inside any pane are
  // swallowed — prevents the finger-lift after a swipe from registering
  // as a fresh date pick on the cell that happens to be under the finger.
  const isPanningRef = useRef(false);
  const lockoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function setPanning(v: boolean) {
    isPanningRef.current = v;
  }

  function scheduleLockoutEnd() {
    if (lockoutTimerRef.current) clearTimeout(lockoutTimerRef.current);
    lockoutTimerRef.current = setTimeout(() => {
      isPanningRef.current = false;
    }, POST_SWIPE_TAP_LOCKOUT_MS);
  }

  // Forward-only on cell tap — but suppress during/just-after a swipe.
  function guardedDateChange(newDate: string) {
    if (isPanningRef.current) return;
    onDateChange(newDate);
  }

  function commitSwipe(newDate: string) {
    // Just dispatch the React state updates — translateX will be
    // reset to 0 by the useLayoutEffect above as soon as
    // setSelectedDate / setLayoutDate commit. Doing translateX = 0
    // here would happen on the worklet's next sync, which can land on
    // a different paint than the React commit and briefly show the
    // wrong pane at center.
    setLayoutDate(newDate);
    onDateChange(newDate);
  }

  // Pre-compute neighbors from layoutDate (NOT selectedDate). The
  // gesture's worklet captures these values at gesture-creation time;
  // tying them to layoutDate (which only updates on commit) means a
  // single swipe can't pick up a stale closure.
  const prevWeekDate = shiftDate(layoutDate, -7);
  const nextWeekDate = shiftDate(layoutDate, 7);

  const pan = Gesture.Pan()
    .activeOffsetX([-ACTIVATION_OFFSET_PX, ACTIVATION_OFFSET_PX])
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
            if (finished) runOnJS(commitSwipe)(nextWeekDate);
          },
        );
      } else if (e.translationX > threshold) {
        translateX.value = withTiming(
          screenWidth,
          { duration: SLIDE_DURATION_MS, easing: SLIDE_EASING },
          (finished) => {
            if (finished) runOnJS(commitSwipe)(prevWeekDate);
          },
        );
      } else {
        translateX.value = withTiming(0, {
          duration: SPRING_BACK_DURATION_MS,
          easing: SLIDE_EASING,
        });
      }
    })
    .onFinalize(() => {
      runOnJS(scheduleLockoutEnd)();
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  return (
    <View style={styles.viewport}>
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
