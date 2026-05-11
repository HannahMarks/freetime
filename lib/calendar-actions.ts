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

  // Per-occurrence skip exceptions, indexed by series id. Only fetched
  // when there's at least one recurring busy_block in the result —
  // skips a round-trip in the common all-one-offs case. The exceptions
  // query is treated as best-effort: if it fails (e.g. the table
  // doesn't exist on a fresh DB), we log and proceed with no skips
  // applied, since showing every occurrence (with the deleted one
  // mistakenly visible) is preferable to failing the whole calendar.
  const recurringBusyRows = (
    (busyResult.data ?? []) as unknown as BusyBlockRow[]
  ).filter((r) => isRecurrenceRule(r.recurrence_rule));
  const skipKeysBySeriesId = new Map<string, Set<string>>();
  const movesBySeriesId = new Map<
    string,
    Map<string, { newStart: Date; newEnd: Date }>
  >();
  // Per-occurrence override metadata for moved busy_block occurrences,
  // keyed by `${series_id}|${originalIso}`. v7 lets a move exception
  // carry title / notes / location overrides; this map stores them so
  // the per-occurrence loop below can merge them onto the
  // CalendarItem after `expandOccurrences` returns the moved times.
  // (Skip rows never carry overrides — they're hidden — but the
  // application doesn't write them on skip rows anyway.)
  const busyOverridesByKey = new Map<
    string,
    { title: string | null; notes: string | null; location: string | null }
  >();
  if (recurringBusyRows.length > 0) {
    const seriesIds = recurringBusyRows.map((r) => r.id);
    const exceptionsResult = await supabase
      .from('busy_block_exceptions')
      .select(
        'series_id, original_start, action, new_start, new_end, title, notes, location',
      )
      .in('series_id', seriesIds);
    if (exceptionsResult.error) {
      // eslint-disable-next-line no-console
      if (process.env.NODE_ENV !== 'production') {
        console.error('[calendar] exceptions load failed', exceptionsResult.error);
      }
    } else {
      for (const ex of (exceptionsResult.data ?? []) as Array<{
        series_id: string;
        original_start: string;
        action: string;
        new_start: string | null;
        new_end: string | null;
        title: string | null;
        notes: string | null;
        location: string | null;
      }>) {
        // Normalise to the ISO format expandOccurrences emits, so the
        // string comparison inside the helper is exact regardless of
        // however Postgres formatted the timestamp on the wire.
        const key = new Date(ex.original_start).toISOString();
        if (ex.action === 'skip') {
          const existing = skipKeysBySeriesId.get(ex.series_id);
          if (existing) {
            existing.add(key);
          } else {
            skipKeysBySeriesId.set(ex.series_id, new Set([key]));
          }
        } else if (ex.action === 'move' && ex.new_start && ex.new_end) {
          // Defensive: the schema's CHECK guarantees new_start +
          // new_end are non-null on a move row, but tolerate a
          // malformed row by skipping it rather than crashing.
          const move = {
            newStart: new Date(ex.new_start),
            newEnd: new Date(ex.new_end),
          };
          const existing = movesBySeriesId.get(ex.series_id);
          if (existing) {
            existing.set(key, move);
          } else {
            movesBySeriesId.set(ex.series_id, new Map([[key, move]]));
          }
          // v7: stash any override metadata on this move row so the
          // per-occurrence loop below can merge it onto the
          // CalendarItem. Null fields fall back to the series's
          // values (handled at merge-time).
          busyOverridesByKey.set(`${ex.series_id}|${key}`, {
            title: ex.title,
            notes: ex.notes,
            location: ex.location,
          });
        }
      }
    }
  }

  for (const row of (busyResult.data ?? []) as unknown as BusyBlockRow[]) {
    if (!row.user) continue; // defensive — embedded join failed
    const baseStart = new Date(row.starts_at);
    const baseEnd = new Date(row.ends_at);

    if (isRecurrenceRule(row.recurrence_rule)) {
      // Expand the series. Each occurrence is a separate CalendarItem
      // sharing the row's id + metadata; only startsAt/endsAt vary.
      // Per-occurrence skip exceptions are applied via skipKeys;
      // 'move' exceptions are applied via movesByKey, and the
      // resulting occurrence carries its pre-move start on
      // `originalStart` for subsequent edit lookups.
      const occurrences = expandOccurrences({
        rule: row.recurrence_rule,
        baseStart,
        baseEnd,
        rangeStart,
        rangeEnd,
        skipKeys: skipKeysBySeriesId.get(row.id),
        movesByKey: movesBySeriesId.get(row.id),
      });
      for (const occ of occurrences) {
        // v7: for a moved occurrence, merge any override metadata
        // from the exception row on top of the series's metadata.
        // Null overrides fall back to the series's value. Lookup key
        // uses originalStart (pre-move) since exceptions are keyed
        // by original, not by the moved time.
        let title = row.title;
        let notes = row.notes;
        let location = row.location;
        if (occ.originalStart) {
          const override = busyOverridesByKey.get(
            `${row.id}|${occ.originalStart.toISOString()}`,
          );
          if (override) {
            if (override.title !== null) title = override.title;
            if (override.notes !== null) notes = override.notes;
            if (override.location !== null) location = override.location;
          }
        }
        items.push({
          kind: 'busy_block',
          id: row.id,
          user: row.user,
          startsAt: occ.startsAt,
          endsAt: occ.endsAt,
          title,
          notes,
          location,
          recurrenceRule: row.recurrence_rule,
          originalStart: occ.originalStart,
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

  // Per-occurrence skip / move exceptions for recurring unavailable_days.
  // Same best-effort posture as the busy_blocks side: failure here
  // (e.g. table missing on a fresh DB) logs and proceeds with no
  // exceptions applied. Keyed by `${user_id}|${series_date}` since
  // the parent PK is composite (`user_id`, `date`) — a flat string
  // map is simpler than nested Maps here.
  const recurringDayRows = (
    (daysResult.data ?? []) as unknown as UnavailableDayRow[]
  ).filter((r) => isRecurrenceRule(r.recurrence_rule));
  const daySkipKeysBySeriesKey = new Map<string, Set<string>>();
  const dayMovesBySeriesKey = new Map<
    string,
    Map<string, { newStart: Date; newEnd: Date }>
  >();
  // v7 override metadata for moved unavailable_day occurrences. Keyed
  // by `${user_id}|${series_date}|${originalIso}` so the
  // per-occurrence loop can look it up cheaply.
  const dayOverridesByKey = new Map<
    string,
    { title: string | null; notes: string | null }
  >();
  if (recurringDayRows.length > 0) {
    // PostgREST supports composite-key lookups via `.or()` with one
    // clause per series. Each clause AND's user_id + series_date.
    // Example: `and(series_user_id.eq.<u>,series_date.eq.<d>)`.
    const orClauses = recurringDayRows
      .map(
        (r) =>
          `and(series_user_id.eq.${r.user_id},series_date.eq.${r.date})`,
      )
      .join(',');
    const dayExceptionsResult = await supabase
      .from('unavailable_day_exceptions')
      .select(
        'series_user_id, series_date, original_date, action, new_date, title, notes',
      )
      .or(orClauses);
    if (dayExceptionsResult.error) {
      // eslint-disable-next-line no-console
      if (process.env.NODE_ENV !== 'production') {
        console.error(
          '[calendar] unavailable_day exceptions load failed',
          dayExceptionsResult.error,
        );
      }
    } else {
      for (const ex of (dayExceptionsResult.data ?? []) as Array<{
        series_user_id: string;
        series_date: string;
        original_date: string;
        action: string;
        new_date: string | null;
        title: string | null;
        notes: string | null;
      }>) {
        const seriesKey = `${ex.series_user_id}|${ex.series_date}`;
        // Helper's emitted occurrence has `startsAt` at local midnight of
        // the occurring date. Convert original_date (YYYY-MM-DD) to the
        // same form so ISO-string comparison matches.
        const [oy, om, od] = ex.original_date.split('-').map(Number);
        const originalIso = new Date(oy, om - 1, od).toISOString();
        if (ex.action === 'skip') {
          const existing = daySkipKeysBySeriesKey.get(seriesKey);
          if (existing) {
            existing.add(originalIso);
          } else {
            daySkipKeysBySeriesKey.set(seriesKey, new Set([originalIso]));
          }
        } else if (ex.action === 'move' && ex.new_date) {
          // Convert new_date to local-midnight [start, end) so the
          // unmoved expandOccurrences interface (which expects
          // {newStart, newEnd}) can be reused.
          const [ny, nm, nd] = ex.new_date.split('-').map(Number);
          const newStart = new Date(ny, nm - 1, nd);
          const newEnd = new Date(ny, nm - 1, nd + 1);
          const existing = dayMovesBySeriesKey.get(seriesKey);
          if (existing) {
            existing.set(originalIso, { newStart, newEnd });
          } else {
            dayMovesBySeriesKey.set(
              seriesKey,
              new Map([[originalIso, { newStart, newEnd }]]),
            );
          }
          // v7: stash override metadata on this move row.
          dayOverridesByKey.set(`${seriesKey}|${originalIso}`, {
            title: ex.title,
            notes: ex.notes,
          });
        }
      }
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
      const seriesKey = `${row.user_id}|${row.date}`;
      const occurrences = expandOccurrences({
        rule: row.recurrence_rule,
        baseStart,
        baseEnd,
        rangeStart,
        rangeEnd,
        skipKeys: daySkipKeysBySeriesKey.get(seriesKey),
        movesByKey: dayMovesBySeriesKey.get(seriesKey),
      });
      for (const occ of occurrences) {
        const occDate = `${occ.startsAt.getFullYear()}-${String(
          occ.startsAt.getMonth() + 1,
        ).padStart(2, '0')}-${String(occ.startsAt.getDate()).padStart(2, '0')}`;
        // For a moved occurrence, derive `originalDate` from
        // `occ.originalStart` (helper emits it as local midnight of the
        // pre-move date).
        let originalDate: string | undefined;
        if (occ.originalStart) {
          const o = occ.originalStart;
          originalDate = `${o.getFullYear()}-${String(o.getMonth() + 1).padStart(2, '0')}-${String(o.getDate()).padStart(2, '0')}`;
        }
        // v7: merge override metadata onto a moved occurrence. Null
        // overrides fall back to the series's value.
        let title = row.title;
        let notes = row.notes;
        if (occ.originalStart) {
          const override = dayOverridesByKey.get(
            `${seriesKey}|${occ.originalStart.toISOString()}`,
          );
          if (override) {
            if (override.title !== null) title = override.title;
            if (override.notes !== null) notes = override.notes;
          }
        }
        items.push({
          kind: 'unavailable_day',
          user: row.user,
          date: occDate,
          title,
          notes,
          recurrenceRule: row.recurrence_rule,
          seriesDate: row.date,
          originalDate,
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
