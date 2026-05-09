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
import { SwipeableDayCarousel } from '../../components/SwipeableDayCarousel';
import { WeekStrip } from '../../components/WeekStrip';
import { useAuth } from '../../lib/auth';
import { updateBusyBlock } from '../../lib/availability-actions';
import { listCalendarItems } from '../../lib/calendar-actions';
import {
  BusyBlockItem,
  CalendarItem,
  computeMarkings,
  isoDate,
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

function formatMonthLabel(dateStr: string): string {
  const [y, m] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });
}

export default function CalendarScreen() {
  const { session, profile } = useAuth();
  const initial = useMemo(todayInfo, []);

  const [month, setMonth] = useState<MonthState>(initial.monthState);
  const [selectedDate, setSelectedDate] = useState<string>(initial.todayIso);
  const [items, setItems] = useState<CalendarItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // Month grid is hidden by default — the week strip below is the
  // primary day-picker. Tap the chevron to expand the full month.
  const [monthVisible, setMonthVisible] = useState(false);
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

  async function handleItemReschedule(
    item: BusyBlockItem,
    newStart: Date,
    newEnd: Date,
  ) {
    if (item.user.id !== session?.user.id) return;
    const { error } = await updateBusyBlock({
      id: item.id,
      startsAt: newStart,
      endsAt: newEnd,
      title: item.title,
      notes: item.notes,
      location: item.location,
    });
    if (error) {
      toast.error(error);
      return;
    }
    await fetchMonth();
  }

  function closeAddSheet() {
    setAddOpen(false);
    setEditing(null);
  }

  // Used by the week strip and the day-carousel: when the user picks a
  // date in a different month, fetch that month's items too. The grid
  // has its own `onMonthChange` so it doesn't go through this wrapper —
  // browsing months via the grid arrows shouldn't auto-jump selectedDate.
  const navigateToDate = useCallback(
    (newDate: string) => {
      setSelectedDate(newDate);
      const [y, m] = newDate.split('-').map(Number);
      if (y !== month.year || m - 1 !== month.monthIndex) {
        setMonth({ year: y, monthIndex: m - 1 });
      }
    },
    [month.year, month.monthIndex],
  );

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

  const monthInitial = `${month.year}-${String(month.monthIndex + 1).padStart(2, '0')}-01`;

  return (
    <View style={styles.container}>
      {/* Header: chevron toggle on the left, month label next to it. */}
      <View style={styles.headerRow}>
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
        <Text style={styles.monthLabel} testID="month-label">
          {formatMonthLabel(selectedDate)}
        </Text>
      </View>

      {/* Week strip — always visible. Sun-Sat for the week containing
          selectedDate; tap a cell to select that day. */}
      <WeekStrip
        selectedDate={selectedDate}
        todayIso={initial.todayIso}
        onDateChange={navigateToDate}
      />

      {/* Month grid — toggled by the chevron. */}
      {monthVisible ? (
        <Calendar
          testID="calendar-grid"
          current={monthInitial}
          markedDates={markedDates}
          markingType="multi-dot"
          enableSwipeMonths
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

      {loading ? (
        <View testID="calendar-loading" style={styles.loadingRow}>
          <ActivityIndicator />
        </View>
      ) : (
        <SwipeableDayCarousel
          date={selectedDate}
          items={items}
          currentUserId={session?.user.id}
          onItemPress={handleItemPress}
          onItemReschedule={handleItemReschedule}
          onDateChange={navigateToDate}
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
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 4,
    gap: 8,
  },
  toggleButton: { padding: 6 },
  toggleButtonPressed: { opacity: 0.6 },
  toggleChevron: { fontSize: 14, color: '#666' },
  monthLabel: { fontSize: 17, fontWeight: '600', color: '#111' },
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
