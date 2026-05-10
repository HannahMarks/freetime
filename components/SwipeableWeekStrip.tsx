import { useEffect, useRef, useState } from 'react';
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

const SLIDE_DURATION_MS = 240;
const SPRING_BACK_DURATION_MS = 180;
// inOut bezier: gentle start, gentle end, fluid middle — feels smooth
// rather than snappy. Easing.out(Easing.exp) (the previous easing) was
// too aggressive on the front end.
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

  // Re-sync when selectedDate changes from outside (week-strip cell
  // tap, day-carousel swipe across week boundary, month-grid tap).
  useEffect(() => {
    setLayoutDate((current) => (current === selectedDate ? current : selectedDate));
    translateX.value = 0;
  }, [selectedDate, translateX]);

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
    // Atomic swap: layoutDate, translateX, and parent's selectedDate
    // all change together so the next render shows the new "curr"
    // pane already centered without a one-frame flicker.
    setLayoutDate(newDate);
    translateX.value = 0;
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
