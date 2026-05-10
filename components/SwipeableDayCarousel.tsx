import { ReactElement } from 'react';
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

// Match the week-strip carousel's slow + smooth feel.
// Easing.inOut(cubic) has a gentle start and end with fluid middle,
// rather than the punchy front-loaded curve of Easing.out(cubic).
const SLIDE_DURATION_MS = 240;
const SPRING_BACK_DURATION_MS = 180;
const SLIDE_EASING = Easing.inOut(Easing.cubic);

type Props = {
  /** YYYY-MM-DD of the day currently centered. */
  date: string;
  /** Full month's calendar items. The carousel slices per-day for each pane. */
  items: CalendarItem[];
  currentUserId?: string;
  /** Fires after a swipe-release past threshold. The parent should set
   * its `selectedDate` to this value. */
  onDateChange: (newDate: string) => void;
  onItemPress?: (item: CalendarItem) => void;
  onItemReschedule?: (item: BusyBlockItem, newStart: Date, newEnd: Date) => void;
  /** Pull-to-refresh control — only mounted on the centered pane. */
  refreshControl?: ReactElement<RefreshControlProps>;
};

/**
 * Three DayTimelines side-by-side (prev / curr / next), with a horizontal
 * Pan gesture that translates them all together. Past `screenWidth / 4` on
 * release, animates the slide and fires `onDateChange` with the new
 * centered date.
 *
 * Pan is direction-gated:
 * - `activeOffsetX([-10, 10])` so small movements don't activate.
 * - `failOffsetY([-15, 15])` so vertical drags fail and let the inner
 *   ScrollView's vertical scroll + the BusyBlockOverlay's long-press pan
 *   take over.
 *
 * After commit, `translateX` resets to 0 in the `runOnJS` callback. The
 * subsequent re-render with the new `date` prop recomputes the three
 * panes' contents — the visual position of the new "curr" pane (at
 * left=0, translateX=0) matches where the old pane just slid to, so
 * there's no flicker.
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

  const prevDate = shiftDate(date, -1);
  const nextDate = shiftDate(date, 1);
  const prevItems = itemsOnDate(items, prevDate);
  const currItems = itemsOnDate(items, date);
  const nextItems = itemsOnDate(items, nextDate);

  function commit(newDate: string) {
    // Setting React state triggers re-render. We rely on the outer
    // `key={date}` re-mount to give us a fresh translateX of 0 with the
    // new "curr" pane already centered — avoids the one-frame race where
    // the old translateX of -screenWidth would briefly show the wrong
    // pane under the new layout.
    onDateChange(newDate);
  }

  const pan = Gesture.Pan()
    .activeOffsetX([-10, 10])
    // Widened from [-15, 15] so the horizontal swipe isn't aborted by
    // the small vertical jitter that's natural when dragging a finger
    // across a phone screen — was making day-changes very hard to
    // trigger in practice.
    .failOffsetY([-30, 30])
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
            if (finished) runOnJS(commit)(nextDate);
          },
        );
      } else if (e.translationX > threshold) {
        translateX.value = withTiming(
          screenWidth,
          { duration: SLIDE_DURATION_MS, easing: SLIDE_EASING },
          (finished) => {
            if (finished) runOnJS(commit)(prevDate);
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
    // Key on `date` so a successful swipe-commit cleanly re-mounts with
    // a fresh translateX of 0 and the new curr/prev/next layout. The old
    // viewport (translateX = -screenWidth showing the new date in its
    // "next" pane) and the new viewport (translateX = 0 showing the new
    // date in its "curr" pane) put the same date at screen center, so
    // the swap is visually seamless.
    <View key={date} style={styles.viewport}>
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
              date={date}
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
