import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Calendar, DateData } from 'react-native-calendars';
import { listCalendarItems } from '../../lib/calendar-actions';
import {
  CalendarItem,
  computeMarkings,
  formatDayLabel,
  formatTimeRange,
  isoDate,
  itemsOnDate,
  monthRange,
} from '../../lib/calendar-helpers';
import { toast } from '../../lib/toast';

const SELECTED_BG = '#111';

type MonthState = { year: number; monthIndex: number };

function todayInfo() {
  const today = new Date();
  return {
    today,
    todayIso: isoDate(today),
    monthState: { year: today.getFullYear(), monthIndex: today.getMonth() } as MonthState,
  };
}

export default function CalendarScreen() {
  const initial = useMemo(todayInfo, []);

  const [month, setMonth] = useState<MonthState>(initial.monthState);
  const [selectedDate, setSelectedDate] = useState<string>(initial.todayIso);
  const [items, setItems] = useState<CalendarItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchMonth = useCallback(async () => {
    const { fromDate, toDate } = monthRange(month.year, month.monthIndex);
    const { data, error } = await listCalendarItems({ fromDate, toDate });
    if (error) {
      toast.error(error);
      return;
    }
    if (data) setItems(data);
  }, [month]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchMonth().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchMonth]);

  async function handleRefresh() {
    setRefreshing(true);
    await fetchMonth();
    setRefreshing(false);
  }

  const dotMarkings = useMemo(() => computeMarkings(items), [items]);

  // Merge friend-color dots with the selection highlight for the active day.
  const markedDates = useMemo(() => {
    const merged: Record<string, { dots?: { key: string; color: string }[]; selected?: boolean; selectedColor?: string }> = {
      ...dotMarkings,
    };
    merged[selectedDate] = {
      ...(merged[selectedDate] ?? { dots: [] }),
      selected: true,
      selectedColor: SELECTED_BG,
    };
    return merged;
  }, [dotMarkings, selectedDate]);

  const selectedItems = useMemo(
    () => itemsOnDate(items, selectedDate),
    [items, selectedDate],
  );

  const monthInitial = `${month.year}-${String(month.monthIndex + 1).padStart(2, '0')}-01`;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
    >
      <Calendar
        testID="calendar-grid"
        current={monthInitial}
        markedDates={markedDates}
        markingType="multi-dot"
        onDayPress={(d: DateData) => setSelectedDate(d.dateString)}
        onMonthChange={(d: DateData) =>
          // react-native-calendars passes 1-indexed month; convert to 0-indexed.
          setMonth({ year: d.year, monthIndex: d.month - 1 })
        }
        theme={{
          arrowColor: SELECTED_BG,
          todayTextColor: SELECTED_BG,
          selectedDayBackgroundColor: SELECTED_BG,
        }}
      />

      <View style={styles.dayPanel}>
        <Text style={styles.dayLabel}>{formatDayLabel(selectedDate, initial.today)}</Text>
        {loading ? (
          <View testID="calendar-loading" style={styles.loadingRow}>
            <ActivityIndicator />
          </View>
        ) : selectedItems.length === 0 ? (
          <Text style={styles.empty}>Free</Text>
        ) : (
          selectedItems.map((item) => <ItemRow key={itemKey(item)} item={item} />)
        )}
      </View>
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
  content: { paddingBottom: 24 },
  dayPanel: { paddingHorizontal: 16, paddingTop: 16, gap: 8 },
  dayLabel: { fontSize: 18, fontWeight: '600', color: '#111' },
  empty: { fontSize: 14, color: '#bbb', fontStyle: 'italic', paddingVertical: 8 },
  loadingRow: { paddingVertical: 24, alignItems: 'center' },
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
