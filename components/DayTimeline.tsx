import { ReactElement } from 'react';
import { Pressable, RefreshControlProps, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import {
  BusyBlockItem,
  CalendarItem,
  formatTimeRange,
  shiftBlockByMinutes,
  snapMinutes,
  UnavailableDayItem,
} from '../lib/calendar-helpers';

const HOUR_HEIGHT = 48;
const HOUR_LABEL_WIDTH = 56;
const TOTAL_HEIGHT = HOUR_HEIGHT * 24;
const SNAP_MINUTES = 15;
const LONG_PRESS_MS = 250;
const MS_PER_HOUR = 60 * 60 * 1000;

type Props = {
  /** YYYY-MM-DD of the day this timeline is rendering. Multi-day blocks
   * are clipped to this day's window. */
  date: string;
  items: CalendarItem[];
  /** id of the signed-in user. Owned busy_blocks become draggable; others
   * remain tap-only. */
  currentUserId?: string;
  /**
   * Optional pull-to-refresh handle. Wired into the inner ScrollView so the
   * gesture works even though the parent layout doesn't scroll.
   */
  refreshControl?: ReactElement<RefreshControlProps>;
  /** Tap handler for any item — banner or block. */
  onItemPress?: (item: CalendarItem) => void;
  /** Drag-release handler for an owned busy_block. Fires once the user
   * lifts their finger after a long-press + pan. start/end are already
   * snapped to 15-minute increments and shifted equally so duration is
   * preserved. */
  onItemReschedule?: (item: BusyBlockItem, newStart: Date, newEnd: Date) => void;
};

/** Pretty hour label like "12 AM", "1 PM". */
function formatHour(hour: number): string {
  if (hour === 0) return '12 AM';
  if (hour < 12) return `${hour} AM`;
  if (hour === 12) return '12 PM';
  return `${hour - 12} PM`;
}

/** Append a 2-hex-digit alpha to a "#RRGGBB" string. */
function hexAlpha(hex: string, alpha: number): string {
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex}${a}`;
}

/**
 * 24-hour vertical day view with hour gridlines + colored overlays for each
 * busy_block at its actual time. unavailable_days appear as a banner above
 * the timeline (whole-day items don't fit on a time scale).
 *
 * Owned busy_blocks are draggable: long-press 250ms to enter drag mode,
 * pan vertically to shift the block (snaps to 15-minute increments),
 * release to commit via onItemReschedule. A short tap still fires
 * onItemPress.
 */
export function DayTimeline({
  date,
  items,
  currentUserId,
  refreshControl,
  onItemPress,
  onItemReschedule,
}: Props) {
  const blocks = items.filter((i): i is BusyBlockItem => i.kind === 'busy_block');
  const days = items.filter((i): i is UnavailableDayItem => i.kind === 'unavailable_day');

  // 00:00 of `date` and 00:00 of the next day, both in local time. All
  // block math is done in ms since `dayStart` and converted to hours.
  const [yyyy, mm, dd] = date.split('-').map(Number);
  const dayStart = new Date(yyyy, mm - 1, dd).getTime();
  const dayEnd = new Date(yyyy, mm - 1, dd + 1).getTime();

  return (
    <View style={styles.container}>
      {days.length > 0 ? (
        <View testID="day-timeline-banner" style={styles.banner}>
          {days.map((d) => (
            <Pressable
              key={`${d.user.id}:${d.date}`}
              testID={`day-banner-${d.user.id}`}
              onPress={onItemPress ? () => onItemPress(d) : undefined}
              style={({ pressed }) => [
                styles.bannerItem,
                { backgroundColor: hexAlpha(d.user.color, 0.18), borderLeftColor: d.user.color },
                pressed && styles.bannerItemPressed,
              ]}
            >
              <Text style={styles.bannerTitle}>
                {d.user.display_name}
                {d.title ? ` · ${d.title}` : ' · Unavailable all day'}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <ScrollView
        style={styles.timeline}
        contentContainerStyle={{ height: TOTAL_HEIGHT }}
        showsVerticalScrollIndicator
        refreshControl={refreshControl}
      >
        {/* Hour gridlines + labels */}
        {Array.from({ length: 24 }).map((_, hour) => (
          <View
            key={hour}
            style={[styles.hourRow, { top: hour * HOUR_HEIGHT, height: HOUR_HEIGHT }]}
          >
            <Text style={styles.hourLabel}>{formatHour(hour)}</Text>
            <View style={styles.hourLine} />
          </View>
        ))}

        {/* Busy block overlays — clipped to `date`'s 24h window. A block
            that started yesterday and ends tomorrow renders from 0 to 24
            here; one that ends at exactly 00:00 of `date` doesn't render
            at all. */}
        {blocks.map((block) => {
          const visibleStart = Math.max(block.startsAt.getTime(), dayStart);
          const visibleEnd = Math.min(block.endsAt.getTime(), dayEnd);
          if (visibleEnd <= visibleStart) return null;
          const startHour = (visibleStart - dayStart) / MS_PER_HOUR;
          const endHour = (visibleEnd - dayStart) / MS_PER_HOUR;
          const top = startHour * HOUR_HEIGHT;
          const height = Math.max((endHour - startHour) * HOUR_HEIGHT, 24);
          const owned = currentUserId !== undefined && block.user.id === currentUserId;

          return (
            <BusyBlockOverlay
              key={block.id}
              block={block}
              top={top}
              height={height}
              owned={owned}
              onPress={onItemPress}
              onReschedule={onItemReschedule}
            />
          );
        })}
      </ScrollView>
    </View>
  );
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type OverlayProps = {
  block: BusyBlockItem;
  top: number;
  height: number;
  owned: boolean;
  onPress?: (item: CalendarItem) => void;
  onReschedule?: (item: BusyBlockItem, newStart: Date, newEnd: Date) => void;
};

/**
 * Single positioned block. For owned blocks, wraps with a long-press-then-pan
 * gesture detector that lets the user drag the block to a new time (snapped
 * to SNAP_MINUTES). A short tap still fires onPress through the underlying
 * Pressable.
 */
function BusyBlockOverlay({ block, top, height, owned, onPress, onReschedule }: OverlayProps) {
  const offsetY = useSharedValue(0);
  const isDragging = useSharedValue(0);

  const pan = Gesture.Pan()
    .activateAfterLongPress(LONG_PRESS_MS)
    .onStart(() => {
      isDragging.value = withTiming(1, { duration: 120 });
    })
    .onUpdate((e) => {
      offsetY.value = e.translationY;
    })
    .onEnd((e) => {
      const rawDeltaMinutes = (e.translationY / HOUR_HEIGHT) * 60;
      const snapped = snapMinutes(rawDeltaMinutes, SNAP_MINUTES);
      offsetY.value = withTiming(0, { duration: 150 });
      isDragging.value = withTiming(0, { duration: 150 });
      if (snapped !== 0 && onReschedule) {
        const { startsAt, endsAt } = shiftBlockByMinutes(block, snapped);
        runOnJS(onReschedule)(block, startsAt, endsAt);
      }
    })
    .enabled(owned && !!onReschedule);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: offsetY.value }, { scale: 1 + isDragging.value * 0.02 }],
    shadowOpacity: 0.15 * isDragging.value,
    shadowRadius: 8 * isDragging.value,
    zIndex: isDragging.value > 0 ? 10 : 0,
  }));

  return (
    <GestureDetector gesture={pan}>
      <AnimatedPressable
        testID={`day-block-${block.id}`}
        onPress={onPress ? () => onPress(block) : undefined}
        style={[
          styles.block,
          {
            top,
            height,
            backgroundColor: hexAlpha(block.user.color, 0.35),
            borderLeftColor: block.user.color,
          },
          animatedStyle,
        ]}
      >
        <Text style={styles.blockTitle} numberOfLines={1}>
          {block.user.display_name}
          {block.title ? ` · ${block.title}` : ''}
        </Text>
        <Text style={styles.blockTime} numberOfLines={1}>
          {formatTimeRange(block.startsAt, block.endsAt)}
        </Text>
      </AnimatedPressable>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  banner: { gap: 6, paddingHorizontal: 16, paddingVertical: 8 },
  bannerItem: {
    borderLeftWidth: 4,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 4,
  },
  bannerTitle: { fontSize: 14, color: '#111' },
  bannerItemPressed: { opacity: 0.6 },
  timeline: { flex: 1 },
  hourRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  hourLabel: {
    width: HOUR_LABEL_WIDTH,
    paddingLeft: 8,
    paddingTop: 2,
    fontSize: 11,
    color: '#888',
  },
  hourLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#eee',
    marginTop: 8,
  },
  block: {
    position: 'absolute',
    left: HOUR_LABEL_WIDTH + 4,
    right: 8,
    borderLeftWidth: 4,
    borderRadius: 4,
    padding: 6,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
  },
  blockTitle: { fontSize: 13, fontWeight: '600', color: '#111' },
  blockTime: { fontSize: 11, color: '#444', marginTop: 2 },
});
