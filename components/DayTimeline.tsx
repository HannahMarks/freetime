import { ReactElement } from 'react';
import { RefreshControlProps, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  BusyBlockItem,
  CalendarItem,
  formatTimeRange,
  UnavailableDayItem,
} from '../lib/calendar-helpers';

const HOUR_HEIGHT = 48;
const HOUR_LABEL_WIDTH = 56;
const TOTAL_HEIGHT = HOUR_HEIGHT * 24;

type Props = {
  items: CalendarItem[];
  /**
   * Optional pull-to-refresh handle. Wired into the inner ScrollView so the
   * gesture works even though the parent layout doesn't scroll.
   */
  refreshControl?: ReactElement<RefreshControlProps>;
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
 * Overlapping blocks visually overlap with translucent fills so colors
 * blend rather than hide each other. A column-layout pass for true
 * side-by-side rendering can be added later if it gets crowded.
 */
export function DayTimeline({ items, refreshControl }: Props) {
  const blocks = items.filter((i): i is BusyBlockItem => i.kind === 'busy_block');
  const days = items.filter((i): i is UnavailableDayItem => i.kind === 'unavailable_day');

  return (
    <View style={styles.container}>
      {days.length > 0 ? (
        <View testID="day-timeline-banner" style={styles.banner}>
          {days.map((d) => (
            <View
              key={`${d.user.id}:${d.date}`}
              testID={`day-banner-${d.user.id}`}
              style={[styles.bannerItem, { backgroundColor: hexAlpha(d.user.color, 0.18), borderLeftColor: d.user.color }]}
            >
              <Text style={styles.bannerTitle}>
                {d.user.display_name}
                {d.title ? ` · ${d.title}` : ' · Unavailable all day'}
              </Text>
            </View>
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

        {/* Busy block overlays */}
        {blocks.map((block) => {
          const startHour = block.startsAt.getHours() + block.startsAt.getMinutes() / 60;
          const endHourRaw = block.endsAt.getHours() + block.endsAt.getMinutes() / 60;
          // If the block crosses midnight in the user's local zone, clamp to
          // end-of-day so the rectangle stays within the 24h window.
          const endHour =
            endHourRaw <= startHour ? 24 : Math.min(endHourRaw, 24);
          const top = startHour * HOUR_HEIGHT;
          const height = Math.max((endHour - startHour) * HOUR_HEIGHT, 24);

          return (
            <View
              key={block.id}
              testID={`day-block-${block.id}`}
              style={[
                styles.block,
                {
                  top,
                  height,
                  backgroundColor: hexAlpha(block.user.color, 0.35),
                  borderLeftColor: block.user.color,
                },
              ]}
            >
              <Text style={styles.blockTitle} numberOfLines={1}>
                {block.user.display_name}
                {block.title ? ` · ${block.title}` : ''}
              </Text>
              <Text style={styles.blockTime} numberOfLines={1}>
                {formatTimeRange(block.startsAt, block.endsAt)}
              </Text>
            </View>
          );
        })}
      </ScrollView>
    </View>
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
  },
  blockTitle: { fontSize: 13, fontWeight: '600', color: '#111' },
  blockTime: { fontSize: 11, color: '#444', marginTop: 2 },
});
