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
import { EventSheet } from '../../components/EventSheet';
import { EVENT_DARKEN_AMOUNT, FabMultiAction } from '../../components/FabMultiAction';
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
  FriendProfile,
  computeEventMarkings,
  computeMarkings,
  isoDate,
  mergeMarkings,
  monthRange,
} from '../../lib/calendar-helpers';
import { listEvents } from '../../lib/event-actions';
import type { EventItem } from '../../lib/event-helpers';
import { listFriendships } from '../../lib/friend-actions';
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
  // Events that overlap the visible month window. Rendered as a dot
  // in `darken(profile.color, EVENT_DARKEN_AMOUNT)` on the month
  // grid, matching the Events sub-FAB outline. Day-timeline rendering
  // of events is deferred to H5c — for now events show as a
  // calendar-grid signal that says "tap to see what's planned on
  // the Events tab".
  const [events, setEvents] = useState<EventItem[]>([]);
  // Accepted friends fetched once on mount — wired into the
  // EventSheet's invite picker. The events tab fetches this
  // separately for itself; we duplicate the call here so the
  // calendar tab's EventSheet has the list ready as soon as it
  // opens (without needing to round-trip when the user taps).
  const [friends, setFriends] = useState<FriendProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // Month grid is hidden by default — the week strip below is the
  // primary day-picker. Tap the chevron to expand the full month.
  const [monthVisible, setMonthVisible] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<CalendarItem | null>(null);
  const [eventSheetOpen, setEventSheetOpen] = useState(false);

  const fetchMonth = useCallback(async () => {
    const { fromDate, toDate } = monthRange(month.year, month.monthIndex);
    // Fetch busy / unavailable rows and events in parallel — they're
    // independent queries (different tables, both RLS-filtered to
    // the visible set) so paying for two round-trips at once is
    // strictly better than serialising.
    const [calRes, evRes] = await Promise.all([
      listCalendarItems({ fromDate, toDate }),
      listEvents({ fromDate, toDate }),
    ]);
    if (calRes.error) {
      toast.error(calRes.error);
    } else if (calRes.data) {
      setItems(calRes.data);
    }
    if (evRes.error) {
      // Don't shadow a calendar-items error with the events one — the
      // calendar items are the primary surface; events failing only
      // hides the dot accent. Log + toast best-effort.
      toast.error(evRes.error);
    } else if (evRes.data) {
      setEvents(evRes.data);
    }
  }, [month]);

  const fetchFriends = useCallback(async () => {
    if (!session?.user.id) return;
    const { data, error } = await listFriendships(session.user.id);
    if (error) return; // silent — friends are a secondary concern here
    if (data) setFriends(data.friends.map((f) => f.friend));
  }, [session?.user.id]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([fetchMonth(), fetchFriends()]).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchMonth, fetchFriends]);

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

  // Two passes:
  //   1. Friend dots (busy_blocks + unavailable_days) keyed by user id
  //   2. Event dots keyed by the literal string 'events', in
  //      darken(profile.color, EVENT_DARKEN_AMOUNT)
  // mergeMarkings concatenates per-day dot arrays so a day with both
  // a friend's busy_block AND an event the viewer is on renders both
  // dots side-by-side in the calendar grid's multi-dot row.
  const friendDotMarkings = useMemo(() => computeMarkings(items), [items]);
  const eventDotMarkings = useMemo(
    () => computeEventMarkings(events, profile?.color, EVENT_DARKEN_AMOUNT),
    [events, profile?.color],
  );
  const dotMarkings = useMemo(
    () => mergeMarkings(friendDotMarkings, eventDotMarkings),
    [friendDotMarkings, eventDotMarkings],
  );

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

      <FabMultiAction
        color={profile?.color}
        onPressBusy={() => {
          setEditing(null);
          setAddOpen(true);
        }}
        onPressEvent={() => setEventSheetOpen(true)}
      />

      <AddItemSheet
        visible={addOpen}
        selectedDate={selectedDate}
        editing={editing}
        onClose={closeAddSheet}
        onSaved={fetchMonth}
      />

      <EventSheet
        visible={eventSheetOpen}
        defaultDate={selectedDate}
        editing={null}
        friends={friends}
        currentUserId={session?.user.id}
        onClose={() => setEventSheetOpen(false)}
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
});
