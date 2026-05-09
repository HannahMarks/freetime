import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { listCalendarItems } from '../../lib/calendar-actions';
import {
  buildAgenda,
  CalendarItem,
  DayAgenda,
  formatTimeRange,
  isoDate,
  nextNDays,
} from '../../lib/calendar-helpers';
import { toast } from '../../lib/toast';

const WINDOW_DAYS = 7;

export default function CalendarScreen() {
  const [agenda, setAgenda] = useState<DayAgenda[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchAgenda = useCallback(async () => {
    const today = new Date();
    const dateKeys = nextNDays(WINDOW_DAYS, today);
    const lastKey = dateKeys[dateKeys.length - 1];
    const [y, m, d] = lastKey.split('-').map(Number);
    const dayAfterLast = new Date(y, m - 1, d + 1);

    const { data, error } = await listCalendarItems({
      fromDate: dateKeys[0],
      toDate: isoDate(dayAfterLast),
    });

    if (error) {
      toast.error(error);
      return;
    }
    if (data) setAgenda(buildAgenda(data, dateKeys, today));
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await fetchAgenda();
      setLoading(false);
    })();
  }, [fetchAgenda]);

  async function handleRefresh() {
    setRefreshing(true);
    await fetchAgenda();
    setRefreshing(false);
  }

  if (loading) {
    return (
      <View testID="calendar-loading" style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
    >
      <Text style={styles.heading}>Next {WINDOW_DAYS} days</Text>
      {agenda?.map((day) => (
        <View key={day.date} style={styles.dayBlock}>
          <Text style={styles.dayLabel}>{day.label}</Text>
          {day.items.length === 0 ? (
            <Text style={styles.empty}>Free</Text>
          ) : (
            day.items.map((item) => <ItemRow key={itemKey(item)} item={item} />)
          )}
        </View>
      ))}
    </ScrollView>
  );
}

function itemKey(item: CalendarItem): string {
  return item.kind === 'busy_block'
    ? `bb:${item.id}`
    : `ud:${item.user.id}:${item.date}`;
}

function ItemRow({ item }: { item: CalendarItem }) {
  const subtitle =
    item.kind === 'busy_block' ? formatTimeRange(item.startsAt, item.endsAt) : 'All day';
  const titleSuffix = item.title ? ` · ${item.title}` : '';
  return (
    <View style={styles.row} testID={`calendar-item-${itemKey(item)}`}>
      <View style={[styles.avatar, { backgroundColor: item.user.color }]} />
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>
          {item.user.display_name}
          {titleSuffix}
        </Text>
        <Text style={styles.rowSubtitle}>{subtitle}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 16, gap: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  heading: { fontSize: 13, fontWeight: '600', color: '#888', textTransform: 'uppercase', letterSpacing: 0.5 },
  dayBlock: { gap: 6 },
  dayLabel: { fontSize: 17, fontWeight: '600', color: '#111' },
  empty: { fontSize: 14, color: '#bbb', fontStyle: 'italic', paddingVertical: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
  },
  avatar: { width: 28, height: 28, borderRadius: 14 },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 15, color: '#111' },
  rowSubtitle: { fontSize: 13, color: '#666' },
});
