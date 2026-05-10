import { ReactElement, useLayoutEffect, useState } from 'react';
import { RefreshControlProps, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import {
  BusyBlockItem,
  CalendarItem,
  itemsOnDate,
  shiftDate,
} from '../lib/calendar-helpers';
import { DayTimeline } from './DayTimeline';

// Match the week-strip carousel's feel exactly: 320ms with Easing.out(cubic).
// User reported the day swipe's previous longer/different curve felt
// "really difficult to use" while the week swipe felt good — so we just
// adopt the week swipe's timing wholesale.
const SLIDE_DURATION_MS = 320;
const SPRING_BACK_DURATION_MS = 220;
const SLIDE_EASING = Easing.out(Easing.cubic);

type Props = {
  /** YYYY-MM-DD of the day currently centered. */
  date: string;
  /** Full month's calendar items. The carousel slices per-day for each pane. */
  items: CalendarItem[];
  currentUserId?: string;
  /** Fires the moment a swipe-release commits past threshold — BEFORE the
   * slide animation finishes — so the parent's selectedDate (and the
   * week-strip highlight that depends on it) updates promptly. The
   * carousel's internal layoutDate state insulates the pane positioning
   * from that immediate prop change so the slide-out animation still
   * plays cleanly to completion. */
  onDateChange: (newDate: string) => void;
  onItemPress?: (item: CalendarItem) => void;
  onItemReschedule?: (item: BusyBlockItem, newStart: Date, newEnd: Date) => void;
  /** Pull-to-refresh control — only mounted on the centered pane. */
  refreshControl?: ReactElement<RefreshControlProps>;
};

/**
 * Three DayTimelines side-by-side (prev / curr / next), with a horizontal
 * Pan gesture that translates them all together. Past `screenWidth / 6` on
 * release, animates the slide and fires `onDateChange` with the new
 * centered date.
 *
 * Architecture mirrors SwipeableWeekStrip: an internal `layoutDate` state
 * drives the prev/curr/next pane content, decoupled from the parent's
 * `date` prop. This lets the carousel call `onDateChange` IMMEDIATELY
 * when the user crosses the commit threshold (so the week-strip highlight
 * updates without waiting) while the slide-off animation continues to
 * play. When the animation finishes, layoutDate updates, which combined
 * with a synchronous translateX reset in `useLayoutEffect` leaves the
 * carousel re-centered on the new "curr" pane in a single paint.
 *
 * Pan is direction-gated:
 * - `activeOffsetX([-6, 6])` so a relaxed flick activates without needing
 *   to overcome a heavy threshold (was 10; bumped down because real
 *   horizontal drags often have small drift).
 * - `failOffsetY([-60, 60])` so the gesture survives natural vertical
 *   jitter in horizontal swipes (was 30; that was killing the gesture
 *   mid-drag for many users — the "really difficult to use" symptom).
 */
export function SwipeableDayCarousel({
  date,
  items,
  currentUserId,
  onDateChange,
  onItemPress,
  onItemReschedule,
  refreshControl,
}: Props) {
  const { width: screenWidth } = useWindowDimensions();
  const translateX = useSharedValue(0);

  // Internal layout date — drives the prev/curr/next pane dates. Stays
  // independent of the `date` prop while a slide-off animation is in
  // progress (so we can fire onDateChange immediately for the highlight
  // update without re-rendering the panes mid-animation).
  const [layoutDate, setLayoutDate] = useState(date);

  // Re-sync layoutDate with the prop AND reset translateX in a
  // useLayoutEffect (synchronous after React commit, before paint) so
  // the same paint that shows the new layout has translateX=0 — no
  // visual jolt when the parent flips `date` from outside the carousel
  // (e.g. user picks a date in the month grid).
  useLayoutEffect(() => {
    if (layoutDate !== date) {
      setLayoutDate(date);
    }
    translateX.value = 0;
  }, [date, layoutDate, translateX]);

  // Compute neighbours from layoutDate (NOT date). The gesture's worklet
  // captures these at gesture-creation time; tying them to layoutDate
  // (which only updates on commit) ensures the closure can't go stale
  // mid-swipe even if the parent re-renders for an unrelated reason.
  const prevDate = shiftDate(layoutDate, -1);
  const nextDate = shiftDate(layoutDate, 1);
  const prevItems = itemsOnDate(items, prevDate);
  const currItems = itemsOnDate(items, layoutDate);
  const nextItems = itemsOnDate(items, nextDate);

  function commitLayout(newDate: string) {
    setLayoutDate(newDate);
    // No need to reset translateX here — the useLayoutEffect above
    // catches `date !== layoutDate` (one of them just changed) and
    // resets it synchronously before paint.
  }

  const pan = Gesture.Pan()
    .activeOffsetX([-6, 6])
    .failOffsetY([-60, 60])
    .onUpdate((e) => {
      translateX.value = e.translationX;
    })
    .onEnd((e) => {
      const threshold = screenWidth / 6;
      if (e.translationX < -threshold) {
        // Tell the parent NOW so the week-strip highlight bumps to the
        // next day before the slide finishes — this is what fixes the
        // user's "waits too long to switch the highlighted day"
        // complaint.
        runOnJS(onDateChange)(nextDate);
        translateX.value = withTiming(
          -screenWidth,
          { duration: SLIDE_DURATION_MS, easing: SLIDE_EASING },
          (finished) => {
            if (finished) runOnJS(commitLayout)(nextDate);
          },
        );
      } else if (e.translationX > threshold) {
        runOnJS(onDateChange)(prevDate);
        translateX.value = withTiming(
          screenWidth,
          { duration: SLIDE_DURATION_MS, easing: SLIDE_EASING },
          (finished) => {
            if (finished) runOnJS(commitLayout)(prevDate);
          },
        );
      } else {
        translateX.value = withTiming(0, {
          duration: SPRING_BACK_DURATION_MS,
          easing: SLIDE_EASING,
        });
      }
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  return (
    <View style={styles.viewport}>
      <GestureDetector gesture={pan}>
        <Animated.View style={[StyleSheet.absoluteFill, animatedStyle]} collapsable={false}>
          <View style={[styles.pane, { left: -screenWidth, width: screenWidth }]}>
            <DayTimeline
              date={prevDate}
              items={prevItems}
              currentUserId={currentUserId}
              onItemPress={onItemPress}
              onItemReschedule={onItemReschedule}
            />
          </View>
          <View
            testID="day-carousel-current"
            style={[styles.pane, { left: 0, width: screenWidth }]}
          >
            <DayTimeline
              date={layoutDate}
              items={currItems}
              currentUserId={currentUserId}
              onItemPress={onItemPress}
              onItemReschedule={onItemReschedule}
              refreshControl={refreshControl}
            />
          </View>
          <View style={[styles.pane, { left: screenWidth, width: screenWidth }]}>
            <DayTimeline
              date={nextDate}
              items={nextItems}
              currentUserId={currentUserId}
              onItemPress={onItemPress}
              onItemReschedule={onItemReschedule}
            />
          </View>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  viewport: {
    flex: 1,
    overflow: 'hidden',
  },
  pane: {
    position: 'absolute',
    top: 0,
    bottom: 0,
  },
});
