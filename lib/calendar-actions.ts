import { CalendarItem } from './calendar-helpers';
import { expandOccurrences, isRecurrenceRule } from './recurrence';
import { supabase } from './supabase';

type ProfileRow = {
  id: string;
  display_name: string;
  color: string;
};

type BusyBlockRow = {
  id: string;
  user_id: string;
  title: string | null;
  starts_at: string;
  ends_at: string;
  notes: string | null;
  location: string | null;
  recurrence_rule: unknown;
  user: ProfileRow | null;
};

type UnavailableDayRow = {
  user_id: string;
  date: string;
  title: string | null;
  notes: string | null;
  recurrence_rule: unknown;
  user: ProfileRow | null;
};

const BUSY_SELECT =
  'id, user_id, title, starts_at, ends_at, notes, location, recurrence_rule, user:profiles(id, display_name, color)';
const UNAVAIL_SELECT =
  'user_id, date, title, notes, recurrence_rule, user:profiles(id, display_name, color)';

function describeError(err: unknown): string {
  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.error('[calendar]', err);
  }
  return "Couldn't load your schedule. Please try again.";
}

/**
 * Fetch all calendar items (busy_blocks + unavailable_days) for self
 * and accepted friends that overlap `[fromDate, toDate)`.
 *
 * RLS filters the friend graph automatically — we get the union of own
 * rows and rows owned by users with an accepted friendship to the
 * caller, no client-side joining needed.
 *
 * Multi-day blocks: a block belongs to the window when it starts before
 * `toDate` AND ends after `fromDate`. This catches blocks that started
 * before `fromDate` but extend into the range.
 *
 * Recurring blocks: rows with a non-null `recurrence_rule` are also
 * fetched even when their FIRST occurrence ended before the window —
 * they're then expanded client-side via `expandOccurrences()` to produce
 * one CalendarItem per occurrence in the window. Each expanded item
 * carries the same DB `id` as the underlying series; consumers that
 * need React-unique keys for siblings combine `id` with `startsAt`
 * (DayTimeline does this for its BusyBlockOverlay).
 *
 * Date strings are YYYY-MM-DD and Postgres casts them to timestamptz
 * at UTC midnight when comparing against `busy_blocks.starts_at`. For
 * users in non-UTC zones this means the day-boundary cut-off can be
 * off by a few hours; acceptable for MVP, fix later by passing
 * timestamptz values that account for the user's zone.
 */
export async function listCalendarItems(args: {
  fromDate: string;
  toDate: string;
}): Promise<{ data: CalendarItem[] | null; error: string | null }> {
  const [busyResult, daysResult] = await Promise.all([
    // Combined predicate: `starts_at < toDate` (always required — no
    // future-only series) AND (ends_at > fromDate OR is recurring).
    // The recurring branch lets us pull series whose first occurrence
    // is in the past so we can expand the still-active occurrences
    // forward into the window.
    supabase
      .from('busy_blocks')
      .select(BUSY_SELECT)
      .lt('starts_at', args.toDate)
      .or(`ends_at.gt.${args.fromDate},recurrence_rule.not.is.null`),
    supabase
      .from('unavailable_days')
      .select(UNAVAIL_SELECT)
      // `date < toDate` always — we never need future-only rows.
      // `date >= fromDate` for one-offs OR row is recurring (so series
      // whose base date is before the window are pulled and expanded
      // forward). Mirrors the busy_blocks query shape above.
      .lt('date', args.toDate)
      .or(`date.gte.${args.fromDate},recurrence_rule.not.is.null`),
  ]);

  if (busyResult.error) return { data: null, error: describeError(busyResult.error) };
  if (daysResult.error) return { data: null, error: describeError(daysResult.error) };

  const items: CalendarItem[] = [];
  // Window dates as Date objects — used as the [start, end) bounds for
  // recurrence expansion. Parsed with the local-zone constructor so the
  // boundary aligns with the Postgres comparison (UTC midnight) within
  // the same caveat as the function-level docstring above.
  const [fy, fm, fd] = args.fromDate.split('-').map(Number);
  const [ty, tm, td] = args.toDate.split('-').map(Number);
  const rangeStart = new Date(fy, fm - 1, fd);
  const rangeEnd = new Date(ty, tm - 1, td);

  for (const row of (busyResult.data ?? []) as unknown as BusyBlockRow[]) {
    if (!row.user) continue; // defensive — embedded join failed
    const baseStart = new Date(row.starts_at);
    const baseEnd = new Date(row.ends_at);

    if (isRecurrenceRule(row.recurrence_rule)) {
      // Expand the series. Each occurrence is a separate CalendarItem
      // sharing the row's id + metadata; only startsAt/endsAt vary.
      const occurrences = expandOccurrences({
        rule: row.recurrence_rule,
        baseStart,
        baseEnd,
        rangeStart,
        rangeEnd,
      });
      for (const occ of occurrences) {
        items.push({
          kind: 'busy_block',
          id: row.id,
          user: row.user,
          startsAt: occ.startsAt,
          endsAt: occ.endsAt,
          title: row.title,
          notes: row.notes,
          location: row.location,
          recurrenceRule: row.recurrence_rule,
        });
      }
    } else {
      // One-off: include if the row's actual interval intersects the
      // window. (The OR clause in the query may have over-fetched a
      // recurring row whose rule we can't parse — rather than silently
      // hiding it, fall through and include the base interval.)
      items.push({
        kind: 'busy_block',
        id: row.id,
        user: row.user,
        startsAt: baseStart,
        endsAt: baseEnd,
        title: row.title,
        notes: row.notes,
        location: row.location,
        recurrenceRule: null,
      });
    }
  }

  for (const row of (daysResult.data ?? []) as unknown as UnavailableDayRow[]) {
    if (!row.user) continue;
    if (isRecurrenceRule(row.recurrence_rule)) {
      // Reuse `expandOccurrences` by treating the date as a
      // [midnight, next-midnight) interval. The helper returns one
      // result per occurring day; we map each back to a YYYY-MM-DD
      // string for the UnavailableDayItem.date field. seriesDate is
      // the row's PK component so action layer (edit/delete) can
      // identify the underlying row.
      const [by, bm, bd] = row.date.split('-').map(Number);
      const baseStart = new Date(by, bm - 1, bd);
      const baseEnd = new Date(by, bm - 1, bd + 1);
      const occurrences = expandOccurrences({
        rule: row.recurrence_rule,
        baseStart,
        baseEnd,
        rangeStart,
        rangeEnd,
      });
      for (const occ of occurrences) {
        const occDate = `${occ.startsAt.getFullYear()}-${String(
          occ.startsAt.getMonth() + 1,
        ).padStart(2, '0')}-${String(occ.startsAt.getDate()).padStart(2, '0')}`;
        items.push({
          kind: 'unavailable_day',
          user: row.user,
          date: occDate,
          title: row.title,
          notes: row.notes,
          recurrenceRule: row.recurrence_rule,
          seriesDate: row.date,
        });
      }
    } else {
      items.push({
        kind: 'unavailable_day',
        user: row.user,
        date: row.date,
        title: row.title,
        notes: row.notes,
        recurrenceRule: null,
        seriesDate: row.date,
      });
    }
  }

  return { data: items, error: null };
}
