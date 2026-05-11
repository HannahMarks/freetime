import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { CalendarList, DateData } from 'react-native-calendars';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { AddItemSheet } from '../../components/AddItemSheet';
import {
  MonthToggleChevron,
  monthHeaderFontSize,
  monthHeaderLineHeight,
} from '../../components/MonthToggleChevron';
import { SwipeableDayCarousel } from '../../components/SwipeableDayCarousel';
import { SwipeableWeekStrip } from '../../components/SwipeableWeekStrip';
import { useAuth } from '../../lib/auth';
import { moveBusyBlockOccurrence, updateBusyBlock } from '../../lib/availability-actions';
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
const WEEK_STRIP_HEIGHT = 70;
// CalendarList day-row height + weekday-header-row height. Add together
// + small buffer to size the wrapper for any month — a 4-row month
// (e.g. Feb 2026, Sun-aligned) gets 4 rows of cells; a 6-row month
// (e.g. May 2026, Fri-start with 31 days) gets 6.
const CAL_HEADER_HEIGHT = 32;
const CAL_ROW_HEIGHT = 50;
const CAL_BOTTOM_BUFFER = 8;

/** How many week-rows the visible month grid will render. Counts the
 * cells the days occupy: leading-blank cells + days-in-month, divided
 * by 7 (rounded up). */
function monthRowCount(year: number, monthIndex: number): number {
  const firstDayOfWeek = new Date(year, monthIndex, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  return Math.ceil((firstDayOfWeek + daysInMonth) / 7);
}

function monthGridHeightFor(year: number, monthIndex: number): number {
  return CAL_HEADER_HEIGHT + monthRowCount(year, monthIndex) * CAL_ROW_HEIGHT + CAL_BOTTOM_BUFFER;
}

type MonthState = { year: number; monthIndex: number };

function todayInfo() {
  const today = new Date();
  return {
    today,
    todayIso: isoDate(today),
    monthState: { year: today.getFullYear(), monthIndex: today.getMonth() } as MonthState,
  };
}

function formatMonthLabel(dateStr: string, todayYear: number): string {
  const [y, m] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, 1);
  // Only include the year when the displayed month is not in the current
  // calendar year — keeps the header tight ("May" most of the time)
  // while still disambiguating when the user scrolls into another year.
  return date.toLocaleDateString(undefined, {
    month: 'long',
    ...(y === todayYear ? {} : { year: 'numeric' }),
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
    // Routing decision: for recurring items, the drag writes a `move`
    // exception for THIS occurrence only (so other Mondays in the
    // series stay at 14:00); for one-offs, the drag mutates the row
    // itself via updateBusyBlock. The `originalStart` field is the
    // unmoved timestamp — present on already-moved occurrences so a
    // second drag updates the same exception row rather than orphaning
    // it under a new key.
    const { error } = item.recurrenceRule
      ? await moveBusyBlockOccurrence({
          seriesId: item.id,
          originalStart: item.originalStart ?? item.startsAt,
          newStart,
          newEnd,
        })
      : await updateBusyBlock({
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

  // FAB icon rotates 45° as the sheet opens (the "+" morphs into an "×"
  // visually). Reverses on close.
  const fabRotation = useSharedValue(0);
  useEffect(() => {
    fabRotation.value = withTiming(addOpen ? 45 : 0, {
      duration: 200,
      easing: Easing.out(Easing.cubic),
    });
  }, [addOpen, fabRotation]);
  const fabIconStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${fabRotation.value}deg` }],
  }));

  // Animated height for the toggle between the compact week strip and
  // the full month grid. The wrapper expands/collapses over ~240ms,
  // revealing/hiding the inner content under `overflow: hidden`. Single
  // layer at a time keeps tests simple (only one of the two is in the
  // tree at any moment). The expanded-state height is computed
  // per-month so 4-row and 5-row months don't leave empty space below
  // the grid.
  const expandedHeight = useMemo(
    () => monthGridHeightFor(month.year, month.monthIndex),
    [month.year, month.monthIndex],
  );
  const heightAnim = useSharedValue(monthVisible ? expandedHeight : WEEK_STRIP_HEIGHT);
  useEffect(() => {
    heightAnim.value = withTiming(monthVisible ? expandedHeight : WEEK_STRIP_HEIGHT, {
      duration: 240,
      easing: Easing.out(Easing.cubic),
    });
  }, [monthVisible, expandedHeight, heightAnim]);
  const monthWrapperStyle = useAnimatedStyle(() => ({
    height: heightAnim.value,
  }));

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

  // CalendarList scrolls smoothly only when its `current` prop is stable
  // across re-renders. Each time `monthInitial` changes (via the user
  // paging the grid → setMonth via onVisibleMonthsChange) we'd otherwise
  // push a "new" current at it and it could yank the scroll position.
  // Capture the value once on first render and pass that — CalendarList
  // manages its own internal scroll position thereafter.
  const initialCalendarMonthRef = useRef(monthInitial);

  return (
    <View style={styles.container}>
      {/* Header: month label on the left, chevron toggle on the right.
          The whole row is a Pressable so tapping the label OR the
          chevron toggles the month grid. The chevron itself owns the
          accessibility label + role; the outer row is just an
          extended hit area, so it stays accessibility-invisible to
          avoid duplicate labels for screen readers + tests. */}
      <Pressable
        style={styles.headerRow}
        onPress={() => setMonthVisible((v) => !v)}
        accessible={false}
      >
        <Text style={styles.monthLabel} testID="month-label">
          {formatMonthLabel(monthInitial, initial.today.getFullYear())}
        </Text>
        <MonthToggleChevron
          expanded={monthVisible}
          onPress={() => setMonthVisible((v) => !v)}
          // Match the month label's color so the V reads as part of the
          // same heading rather than a contrasting accent glyph.
          color="#111"
        />
      </Pressable>

      {/* Single-layer toggle with an animated height. When the user
          taps the chevron, monthVisible flips and the wrapper grows
          (or shrinks) over ~240ms while the inner content is clipped
          by overflow:hidden — the calendar reveals itself like a
          drawer rather than appearing instantly. */}
      <Animated.View style={[styles.monthWrapper, monthWrapperStyle]}>
        {monthVisible ? (
          <CalendarList
            testID="calendar-grid"
            current={initialCalendarMonthRef.current}
            markedDates={markedDates}
            markingType="multi-dot"
            horizontal
            pagingEnabled
            pastScrollRange={12}
            futureScrollRange={12}
            // Our outer chevron + month label IS the header. The
            // package's per-month header (month name + < > arrows
            // inside the grid) is redundant — hide it.
            renderHeader={() => null}
            hideArrows
            onDayPress={(d: DateData) => setSelectedDate(d.dateString)}
            onVisibleMonthsChange={(months: DateData[]) => {
              if (months.length > 0) {
                setMonth({ year: months[0].year, monthIndex: months[0].month - 1 });
              }
            }}
            theme={{
              arrowColor: SELECTED_BG,
              todayTextColor: SELECTED_BG,
              selectedDayBackgroundColor: SELECTED_BG,
            }}
          />
        ) : (
          <SwipeableWeekStrip
            selectedDate={selectedDate}
            todayIso={initial.todayIso}
            todayColor={profile?.color}
            onDateChange={navigateToDate}
          />
        )}
      </Animated.View>

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
        <Animated.Text style={[styles.fabIcon, fabIconStyle]}>+</Animated.Text>
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
    // 'center' + the chevron's own translateY nudge gives a more
    // predictable alignment than 'baseline', which behaved oddly with
    // the non-letter `⌄` glyph.
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 4,
    gap: 8,
  },
  monthLabel: {
    // Match the chevron's font sizing exactly so both glyphs share a
    // line box of the same height and align cleanly via the row's
    // alignItems: 'center'.
    fontSize: monthHeaderFontSize,
    lineHeight: monthHeaderLineHeight,
    fontWeight: '700',
    color: '#111',
    includeFontPadding: false,
  },
  monthWrapper: {
    overflow: 'hidden',
    // Faint divider underneath the calendar/week strip — separates the
    // header section from the day timeline below.
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e5e5',
  },
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
