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
import { AddItemSheet } from '../../components/AddItemSheet';
import { DayTimeline } from '../../components/DayTimeline';
import { useAuth } from '../../lib/auth';
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
  const { session, profile } = useAuth();
  const initial = useMemo(todayInfo, []);

  const [month, setMonth] = useState<MonthState>(initial.monthState);
  const [selectedDate, setSelectedDate] = useState<string>(initial.todayIso);
  const [items, setItems] = useState<CalendarItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [monthVisible, setMonthVisible] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<CalendarItem | null>(null);

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

  function handleItemPress(item: CalendarItem) {
    // Only the owner can edit / delete; RLS blocks server-side, this is the
    // UI gate. Tapping your own item opens the edit sheet directly — Edit
    // and Delete both live inside the sheet.
    if (item.user.id !== session?.user.id) return;
    setEditing(item);
    setAddOpen(true);
  }

  function closeAddSheet() {
    setAddOpen(false);
    setEditing(null);
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
          hitSlop={12}
          style={({ pressed }) => [styles.toggleButton, pressed && styles.toggleButtonPressed]}
        >
          <Text style={styles.toggleChevron}>{monthVisible ? '▲' : '▼'}</Text>
        </Pressable>
      </View>

      {loading ? (
        <View testID="calendar-loading" style={styles.loadingRow}>
          <ActivityIndicator />
        </View>
      ) : (
        <DayTimeline
          date={selectedDate}
          items={selectedItems}
          onItemPress={handleItemPress}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
          }
        />
      )}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add to calendar"
        testID="add-fab"
        onPress={() => {
          setEditing(null);
          setAddOpen(true);
        }}
        style={({ pressed }) => [
          styles.fab,
          { backgroundColor: profile?.color ?? SELECTED_BG },
          pressed && styles.fabPressed,
        ]}
      >
        <Text style={styles.fabIcon}>+</Text>
      </Pressable>

      <AddItemSheet
        visible={addOpen}
        selectedDate={selectedDate}
        editing={editing}
        onClose={closeAddSheet}
        onSaved={fetchMonth}
      />
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
  toggleButton: { padding: 4 },
  toggleButtonPressed: { opacity: 0.6 },
  toggleChevron: { fontSize: 14, color: '#666' },
  loadingRow: { flex: 1, alignItems: 'center', justifyContent: 'center' },
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
