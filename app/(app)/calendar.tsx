import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Calendar, DateData } from 'react-native-calendars';
import { DayTimeline } from '../../components/DayTimeline';
import { listCalendarItems } from '../../lib/calendar-actions';
import {
  CalendarItem,
  computeMarkings,
  formatDayLabel,
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
  const [monthVisible, setMonthVisible] = useState(true);

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

  const markedDates = useMemo(() => {
    const merged: Record<
      string,
      { dots?: { key: string; color: string }[]; selected?: boolean; selectedColor?: string }
    > = { ...dotMarkings };
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
    <View style={styles.container}>
      {monthVisible ? (
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
      ) : null}

      <View style={styles.dayHeader}>
        <Text style={styles.dayLabel}>{formatDayLabel(selectedDate, initial.today)}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={monthVisible ? 'Hide month grid' : 'Show month grid'}
          testID="toggle-month-grid"
          onPress={() => setMonthVisible((v) => !v)}
          hitSlop={8}
          style={({ pressed }) => [styles.toggleButton, pressed && styles.toggleButtonPressed]}
        >
          <Text style={styles.toggleText}>{monthVisible ? 'Hide month' : 'Show month'}</Text>
          <Text style={styles.toggleChevron}>{monthVisible ? '▲' : '▼'}</Text>
        </Pressable>
      </View>

      {loading ? (
        <View testID="calendar-loading" style={styles.loadingRow}>
          <ActivityIndicator />
        </View>
      ) : (
        <DayTimeline
          items={selectedItems}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  dayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#eee',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eee',
  },
  dayLabel: { fontSize: 17, fontWeight: '600', color: '#111' },
  toggleButton: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  toggleButtonPressed: { opacity: 0.6 },
  toggleText: { fontSize: 13, color: '#666' },
  toggleChevron: { fontSize: 11, color: '#666' },
  loadingRow: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
