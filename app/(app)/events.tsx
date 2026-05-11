import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { EventSheet } from '../../components/EventSheet';
import { useAuth } from '../../lib/auth';
import { formatTimeRange, isoDate } from '../../lib/calendar-helpers';
import { listEvents } from '../../lib/event-actions';
import type { EventItem } from '../../lib/event-helpers';
import { toast } from '../../lib/toast';

const FAB_BG_FALLBACK = '#111';
/** How far ahead `listEvents` queries on this screen. 6 months gives
 * a comfortable "what's coming up" window without scrolling into
 * indefinite-future territory; can be revisited (and made
 * load-on-demand) if users actually plan further out. */
const HORIZON_MONTHS = 6;

/** "Tomorrow · 6:00 PM – 9:00 PM" / "Wed, May 13 · 6:00 PM – 9:00 PM". */
function formatEventLine(item: EventItem, today: Date): string {
  const todayIso = isoDate(today);
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const tomorrowIso = isoDate(tomorrow);
  const dateIso = isoDate(item.startsAt);
  let dayLabel: string;
  if (dateIso === todayIso) dayLabel = 'Today';
  else if (dateIso === tomorrowIso) dayLabel = 'Tomorrow';
  else
    dayLabel = item.startsAt.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  return `${dayLabel} · ${formatTimeRange(item.startsAt, item.endsAt)}`;
}

export default function EventsScreen() {
  const { profile } = useAuth();
  const [items, setItems] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<EventItem | null>(null);

  const fetchEvents = useCallback(async () => {
    const now = new Date();
    const fromDate = isoDate(now);
    const horizon = new Date(now);
    horizon.setMonth(horizon.getMonth() + HORIZON_MONTHS);
    const toDate = isoDate(horizon);
    const { data, error } = await listEvents({ fromDate, toDate });
    if (error) {
      toast.error(error);
      return;
    }
    if (data) {
      // Server doesn't impose a stable order; sort client-side by
      // start time so the list always reads chronologically.
      data.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
      setItems(data);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchEvents().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchEvents]);

  async function handleRefresh() {
    setRefreshing(true);
    await fetchEvents();
    setRefreshing(false);
  }

  // Same FAB-rotation animation as the calendar screen: "+" → "×" as
  // the sheet opens, gives a tiny morphing-affordance touch.
  const fabRotation = useSharedValue(0);
  useEffect(() => {
    fabRotation.value = withTiming(sheetOpen ? 45 : 0, {
      duration: 200,
      easing: Easing.out(Easing.cubic),
    });
  }, [sheetOpen, fabRotation]);
  const fabIconStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${fabRotation.value}deg` }],
  }));

  const today = new Date();
  const todayIso = isoDate(today);

  return (
    <View style={styles.container}>
      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator />
        </View>
      ) : items.length === 0 ? (
        // Empty state: more inviting than a blank screen. Encourages
        // the user to tap the FAB without a sterile "No data" line.
        <View style={styles.emptyWrap} testID="events-empty">
          <Text style={styles.emptyTitle}>No events yet</Text>
          <Text style={styles.emptyBody}>
            Tap the + to host one. Invites + RSVPs are coming soon — for
            now you can create events for yourself.
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
          }
        >
          {items.map((item) => (
            <Pressable
              key={item.id}
              testID={`event-row-${item.id}`}
              onPress={() => {
                setEditing(item);
                setSheetOpen(true);
              }}
              style={({ pressed }) => [
                styles.row,
                {
                  // Tint the left border in the host's color, same
                  // pattern as busy_block / unavailable_day rendering
                  // on the day timeline.
                  borderLeftColor: item.owner.color,
                },
                pressed && styles.rowPressed,
              ]}
            >
              <Text style={styles.rowTitle} numberOfLines={1}>
                {item.title ?? 'Untitled event'}
              </Text>
              <Text style={styles.rowMeta}>{formatEventLine(item, today)}</Text>
              {item.location ? (
                <Text style={styles.rowMetaDim} numberOfLines={1}>
                  {item.location}
                </Text>
              ) : null}
            </Pressable>
          ))}
        </ScrollView>
      )}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Plan an event"
        testID="events-fab"
        onPress={() => {
          setEditing(null);
          setSheetOpen(true);
        }}
        style={({ pressed }) => [
          styles.fab,
          { backgroundColor: profile?.color ?? FAB_BG_FALLBACK },
          pressed && styles.fabPressed,
        ]}
      >
        <Animated.Text style={[styles.fabIcon, fabIconStyle]}>+</Animated.Text>
      </Pressable>

      <EventSheet
        visible={sheetOpen}
        defaultDate={todayIso}
        editing={editing}
        onClose={() => setSheetOpen(false)}
        onSaved={() => {
          // Refetch on any successful save / delete so the list
          // reflects the change. The Calendar screen uses the same
          // pattern (parent re-fetches on child onSaved).
          fetchEvents();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 8,
  },
  emptyTitle: { fontSize: 17, fontWeight: '600', color: '#111' },
  emptyBody: { fontSize: 14, color: '#666', textAlign: 'center', lineHeight: 20 },
  listContent: { padding: 16, gap: 10 },
  row: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderLeftWidth: 4,
    borderRadius: 6,
    backgroundColor: '#f7f7f7',
    gap: 4,
  },
  rowPressed: { opacity: 0.5, transform: [{ scale: 0.98 }] },
  rowTitle: { fontSize: 15, fontWeight: '600', color: '#111' },
  rowMeta: { fontSize: 13, color: '#444' },
  rowMetaDim: { fontSize: 12, color: '#888' },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
    elevation: 6,
  },
  fabPressed: { opacity: 0.85 },
  fabIcon: { color: '#fff', fontSize: 30, lineHeight: 32, fontWeight: '300' },
});
