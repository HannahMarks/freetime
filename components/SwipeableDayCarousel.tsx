import { ReactElement, useLayoutEffect, useRef, useState } from 'react';
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

// Longer + gentler than week strip. User reported "still too snappy"
// even after matching the week's 320ms / Easing.out(cubic) — likely
// because day-swipe content is a full-screen pane and reads as
// "more substance moving" than the week strip's narrow bar. Bumped to
// 420ms with Easing.inOut(cubic) (gentle start AND gentle end) — the
// inOut curve has no fast-start punch, which is what "snappy" was
// referring to. This intentionally feels different from the week
// swipe's faster Easing.out feel: each carousel's pacing matches the
// visual weight of what it's moving.
const SLIDE_DURATION_MS = 420;
const SPRING_BACK_DURATION_MS = 260;
const SLIDE_EASING = Easing.inOut(Easing.cubic);

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
 * - `activeOffsetX([-12, 12])` so the gesture activates with a
 *   deliberate drag rather than the moment a finger twitches. The
 *   previous 6px threshold made the swipe feel "snappy" / over-eager.
 *   12 is a middle ground between the original 10 and the week strip's
 *   15.
 * - `failOffsetY([-60, 60])` so the gesture survives natural vertical
 *   jitter in horizontal swipes — this was the "really difficult to
 *   use" fix from the previous round and stays.
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

  // Set to true between "swipe-commit fires onDateChange" and "slide
  // animation completes". While true, the useLayoutEffect below SKIPS
  // its `translateX.value = 0` reset — without this guard, the parent
  // re-render that follows the immediate onDateChange would cancel the
  // in-flight withTiming animation (sharedValue assignments cancel
  // running animations), and the slide would never play. Symptom: user
  // releases past threshold, sheet snaps to the new day with no
  // animation. ALSO suppresses the layoutDate sync — we deliberately
  // leave layoutDate on the OLD date during the slide so the
  // user-visible "next" pane keeps showing the destination day's
  // content; only after the animation finishes do we update layoutDate
  // and reset translateX in lockstep.
  const isCommittingRef = useRef(false);

  // Re-sync layoutDate with the prop AND reset translateX in a
  // useLayoutEffect (synchronous after React commit, before paint) so
  // the same paint that shows the new layout has translateX=0 — no
  // visual jolt when the parent flips `date` from outside the carousel
  // (e.g. user picks a date in the month grid). Skipped during the
  // commit-animation window per the ref above.
  useLayoutEffect(() => {
    if (isCommittingRef.current) return;
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
    // Clear the commit flag FIRST so the useLayoutEffect that fires on
    // the setLayoutDate-driven re-render below is allowed to do its
    // `translateX.value = 0` reset. Order matters — clearing AFTER
    // setLayoutDate would race against React's render scheduling.
    isCommittingRef.current = false;
    setLayoutDate(newDate);
    // No explicit translateX reset here: the useLayoutEffect above
    // sees `date === layoutDate` (both are newDate now), the ref is
    // false, so it sets translateX = 0 in the same synchronous
    // post-commit pass — same paint, no flicker.
  }

  function markCommitStart() {
    isCommittingRef.current = true;
  }

  const pan = Gesture.Pan()
    .activeOffsetX([-12, 12])
    .failOffsetY([-60, 60])
    .onUpdate((e) => {
      translateX.value = e.translationX;
    })
    .onEnd((e) => {
      const threshold = screenWidth / 6;
      if (e.translationX < -threshold) {
        // Order matters here:
        // 1. Mark commit-in-progress so the useLayoutEffect that runs
        //    after the parent's onDateChange-driven re-render doesn't
        //    cancel the withTiming below by resetting translateX = 0.
        // 2. Tell the parent NOW so the week-strip highlight bumps
        //    immediately (the user's "waits too long to switch the
        //    highlighted day" complaint from a previous round).
        // 3. Run the slide animation; on completion, commitLayout
        //    clears the ref and updates layoutDate.
        runOnJS(markCommitStart)();
        runOnJS(onDateChange)(nextDate);
        translateX.value = withTiming(
          -screenWidth,
          { duration: SLIDE_DURATION_MS, easing: SLIDE_EASING },
          (finished) => {
            if (finished) runOnJS(commitLayout)(nextDate);
          },
        );
      } else if (e.translationX > threshold) {
        runOnJS(markCommitStart)();
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
