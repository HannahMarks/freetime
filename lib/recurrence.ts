// Recurrence rules for busy_blocks, unavailable_days, and events.
// Stored as JSONB on the `recurrence_rule` column of each table; null
// means the row is a one-off.
//
// Supported shape (v3):
// ```ts
// {
//   freq: 'weekly' | 'monthly' | 'yearly';
//   byDay?: number[];   // 0=Sun, 1=Mon, ..., 6=Sat — WEEKLY ONLY
//   until?: string;     // YYYY-MM-DD, inclusive end-of-day
// }
// ```
//
// `byDay` is weekly-only — ignored for monthly and yearly rules. When
// omitted on a weekly rule (or empty), the implementation infers
// `[ baseStart's weekday ]` — preserving v1 ("Repeat weekly" toggle
// implies the day of the base block).
//
// `until` is optional. When omitted, the series repeats indefinitely
// (still bounded by MAX_OCCURRENCES + the caller's range, so no
// runaway expansion).
//
// Monthly rules walk +1 month from the base, preserving the
// day-of-month and wall-clock time. If the next month is shorter
// than the base's day (Jan 31 → Feb), the occurrence clamps to the
// last day of that month, then resumes the natural day in subsequent
// months that fit it.
//
// Yearly rules walk +1 year preserving month + day-of-month +
// wall-clock. Feb 29 clamps to Feb 28 in non-leap years.
//
// The shape stays a discriminated-union-friendly object so we can grow
// it later (`count`, `interval`, `byMonth`, etc.) without a schema
// change — bump the parser/expander.

export type RecurrenceFreq = 'weekly' | 'monthly' | 'yearly';

export type RecurrenceRule = {
  freq: RecurrenceFreq;
  /** 0=Sun, 1=Mon, ..., 6=Sat. WEEKLY only — ignored for monthly /
   * yearly rules. Falls back to the base block's weekday when omitted
   * or empty (on weekly rules). */
  byDay?: number[];
  /** YYYY-MM-DD, INCLUSIVE end-of-day. After this date the series
   * stops. Optional — omitted = repeats indefinitely. */
  until?: string;
};

/** Hard cap on expansion output to defend against pathological calls
 * (e.g. a thousand-year range). One year of weekly = ~52 occurrences,
 * so 500 is generous for any realistic UI query window. */
const MAX_OCCURRENCES = 500;

/** Type guard for values pulled from the DB / API. Use this to narrow
 * an `unknown` recurrence_rule column to the parsed shape. The byDay
 * and until fields are accepted as-is — they're parsed defensively
 * inside `expandOccurrences` (malformed values fall back to v1
 * defaults rather than throwing). */
export function isRecurrenceRule(v: unknown): v is RecurrenceRule {
  if (typeof v !== 'object' || v === null) return false;
  const obj = v as Record<string, unknown>;
  return obj.freq === 'weekly' || obj.freq === 'monthly' || obj.freq === 'yearly';
}

/** Parse `until` (YYYY-MM-DD) into a local-zone Date at the END of the
 * day (23:59:59.999). Inclusive semantics: an occurrence whose START is
 * <= this Date is still in the series. Returns null if the string is
 * missing or malformed. */
function parseUntil(until: string | undefined): Date | null {
  if (!until) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(until);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  return new Date(y, mo, d, 23, 59, 59, 999);
}

/**
 * Build a Date at the same wall-clock as `base` but on a different
 * month + day. When the target day exceeds the target month's
 * length, clamps to the last valid day of that month (e.g. Jan 31
 * → Feb 28). Wall-clock components (hour, minute, second, ms) are
 * always preserved.
 */
function dateAt(
  year: number,
  monthIndex: number,
  desiredDay: number,
  hour: number,
  minute: number,
  second: number,
  ms: number,
): Date {
  // Days in `monthIndex` of `year`. Day 0 of the next month = last day
  // of the current month, which is what JS Date does naturally.
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const day = Math.min(desiredDay, daysInMonth);
  return new Date(year, monthIndex, day, hour, minute, second, ms);
}

/**
 * Monthly / yearly expansion. Step size is +1 month or +1 year per
 * iteration. The base's day-of-month + wall-clock are preserved on
 * every occurrence; month-end overflow clamps (Jan 31 → Feb 28).
 *
 * `byDay` is ignored for monthly + yearly rules — it's a weekly-only
 * selector. Tests cover the ignore behaviour explicitly.
 *
 * skipKeys / movesByKey use the same `originalStart.toISOString()`
 * key shape as the weekly path so callers don't have to switch on
 * `freq` to build them.
 */
function expandFixedStep(args: {
  rule: RecurrenceRule;
  baseStart: Date;
  baseEnd: Date;
  rangeStart: Date;
  rangeEnd: Date;
  skipKeys?: Set<string>;
  movesByKey?: Map<string, { newStart: Date; newEnd: Date }>;
}): Array<{ startsAt: Date; endsAt: Date; originalStart?: Date }> {
  const durationMs = args.baseEnd.getTime() - args.baseStart.getTime();
  if (durationMs < 0) return [];
  const rangeStartMs = args.rangeStart.getTime();
  const rangeEndMs = args.rangeEnd.getTime();
  const untilEnd = parseUntil(args.rule.until);
  const untilMs = untilEnd?.getTime() ?? Infinity;
  if (untilMs < args.baseStart.getTime()) return [];

  const baseYear = args.baseStart.getFullYear();
  const baseMonth = args.baseStart.getMonth();
  // Preserve the natural day-of-month from the base — when a month is
  // too short (Feb after a Jan-31 base), `dateAt` clamps, but the
  // following months pick the natural day back up.
  const baseDay = args.baseStart.getDate();
  const hour = args.baseStart.getHours();
  const minute = args.baseStart.getMinutes();
  const second = args.baseStart.getSeconds();
  const ms = args.baseStart.getMilliseconds();
  const isYearly = args.rule.freq === 'yearly';

  const out: Array<{ startsAt: Date; endsAt: Date; originalStart?: Date }> = [];
  for (let n = 0; n < MAX_OCCURRENCES; n++) {
    const year = isYearly ? baseYear + n : baseYear;
    const monthIndex = isYearly ? baseMonth : baseMonth + n;
    const start = dateAt(year, monthIndex, baseDay, hour, minute, second, ms);
    const startMs = start.getTime();
    if (startMs > untilMs) break;
    if (startMs >= rangeEndMs) break; // past the range — done

    const originalIso = start.toISOString();
    if (args.skipKeys && args.skipKeys.has(originalIso)) continue;

    const move = args.movesByKey?.get(originalIso);
    if (move) {
      const moveStartMs = move.newStart.getTime();
      const moveEndMs = move.newEnd.getTime();
      if (moveStartMs >= rangeEndMs) continue;
      if (moveEndMs <= rangeStartMs) continue;
      out.push({
        startsAt: new Date(moveStartMs),
        endsAt: new Date(moveEndMs),
        originalStart: new Date(startMs),
      });
      continue;
    }

    const endMs = startMs + durationMs;
    if (endMs <= rangeStartMs) continue; // ends before the window starts
    out.push({ startsAt: start, endsAt: new Date(endMs) });
  }
  if (args.movesByKey && args.movesByKey.size > 0) {
    out.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  }
  return out;
}

/**
 * Expand a recurring busy_block series into individual occurrences whose
 * time intervals overlap `[rangeStart, rangeEnd)`.
 *
 * - `baseStart` / `baseEnd` are the series' first occurrence; subsequent
 *   occurrences are at +7d offsets (preserving wall-clock time across
 *   DST), with the optional `byDay` filter selecting which weekdays
 *   inside each week produce occurrences.
 * - When `byDay` is omitted/empty, it's treated as `[baseStart.getDay()]`
 *   (preserves v1 "Repeat weekly" — repeats on the base's weekday only).
 * - When `byDay` includes weekdays AHEAD of the base's weekday in week 0,
 *   those become same-week occurrences AFTER the base. Weekdays BEFORE
 *   the base in week 0 are skipped: the base itself is the series's
 *   start, and we don't manufacture earlier occurrences in week 0.
 * - `until` (YYYY-MM-DD) caps the series — occurrences whose START is
 *   AFTER end-of-`until`-day are excluded. Inclusive end-of-day.
 * - The returned occurrences are in chronological order.
 * - "Intersect" means the occurrence's `[start, end)` overlaps the
 *   range; an occurrence whose `start` is before `rangeStart` is
 *   included as long as its `end` is after `rangeStart` (handles
 *   cross-midnight blocks queried by the day boundary).
 * - Returns `[]` for unsupported `freq` values rather than throwing.
 */
export function expandOccurrences(args: {
  rule: RecurrenceRule;
  baseStart: Date;
  baseEnd: Date;
  rangeStart: Date; // inclusive
  rangeEnd: Date;   // exclusive
  /** Optional set of `startsAt.toISOString()` keys to omit from the
   * output. Used by `listCalendarItems` to apply per-occurrence skip
   * exceptions (`busy_block_exceptions` rows with `action='skip'`).
   * Each key is an exact ISO timestamp; the helper compares against
   * `occurrence.startsAt.toISOString()`. */
  skipKeys?: Set<string>;
  /** Optional map of per-occurrence MOVES, keyed by the same ISO
   * `original_start` string as `skipKeys`. When matched, the
   * occurrence's `startsAt` / `endsAt` are replaced with the move's
   * `newStart` / `newEnd`, and the original (pre-move) start is
   * carried through on the result's `originalStart` field. The moved
   * occurrence's IN-RANGE-ness is judged against the NEW times: a
   * move can pull an occurrence into the window, or push it out.
   * If a key appears in BOTH `skipKeys` AND `movesByKey`, skip wins
   * (more conservative — produces no result for that key). */
  movesByKey?: Map<string, { newStart: Date; newEnd: Date }>;
}): Array<{ startsAt: Date; endsAt: Date; originalStart?: Date }> {
  if (args.rule.freq === 'monthly' || args.rule.freq === 'yearly') {
    return expandFixedStep(args);
  }
  if (args.rule.freq !== 'weekly') return [];

  const durationMs = args.baseEnd.getTime() - args.baseStart.getTime();
  if (durationMs < 0) return []; // malformed: end before start
  const rangeStartMs = args.rangeStart.getTime();
  const rangeEndMs = args.rangeEnd.getTime();
  const untilEnd = parseUntil(args.rule.until);
  const untilMs = untilEnd?.getTime() ?? Infinity;
  // If `until` is before the base, the series is empty — bail early.
  if (untilMs < args.baseStart.getTime()) return [];

  // Resolve the day-of-week selectors. Empty / missing → just the base's
  // own weekday, preserving v1 behavior.
  const baseWeekday = args.baseStart.getDay();
  const byDayRaw = args.rule.byDay;
  const byDayResolved =
    byDayRaw && byDayRaw.length > 0 ? [...byDayRaw] : [baseWeekday];
  // Normalise + dedupe + sort so iteration order within a week is stable
  // (and the output ends up chronological without needing a final sort).
  const byDay = Array.from(
    new Set(byDayResolved.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)),
  ).sort((a, b) => a - b);
  if (byDay.length === 0) return [];

  // Anchor: the Sunday of the calendar week containing the base. byDay
  // values are weekday indices (0=Sun…6=Sat); each week n's occurrences
  // are at sundayOfBaseWeek + n*7 + targetWeekday DAYS, with the base
  // block's hour/min/sec/ms preserved. Anchoring on Sunday (rather than
  // on the base date) means "byDay = [Mon]" with a Tue base puts the
  // first Mon occurrence on the Mon AFTER the base (the Mon BEFORE the
  // base, in week 0, is filtered out below) — matching the natural
  // expectation that "every Monday at 2pm" means future Mondays.
  const sundayOfBaseWeek = new Date(
    args.baseStart.getFullYear(),
    args.baseStart.getMonth(),
    args.baseStart.getDate() - baseWeekday,
  );
  const hour = args.baseStart.getHours();
  const minute = args.baseStart.getMinutes();
  const second = args.baseStart.getSeconds();
  const ms = args.baseStart.getMilliseconds();
  const baseStartMs = args.baseStart.getTime();

  const out: Array<{ startsAt: Date; endsAt: Date; originalStart?: Date }> = [];
  // Loop over weeks until we exhaust the range or hit the safety cap.
  // Cap on `n` is generous (MAX_OCCURRENCES * 2) so weeks with no
  // in-range occurrences (e.g. weekdays before the base in week 0)
  // don't prematurely terminate.
  for (let n = 0; n <= MAX_OCCURRENCES * 2; n++) {
    let weekHasFutureOccurrence = false;
    for (const targetWeekday of byDay) {
      const start = new Date(sundayOfBaseWeek);
      // setDate preserves wall-clock time across DST — see top-of-file
      // comment on why this is required for "every Monday at 2pm" to
      // stay at 2pm year-round.
      start.setDate(start.getDate() + n * 7 + targetWeekday);
      start.setHours(hour, minute, second, ms);
      const startMs = start.getTime();
      // In week 0, weekdays BEFORE the base are "earlier than the
      // series start" — skip. (The base itself is included when its
      // weekday is in `byDay`.)
      if (startMs < baseStartMs) continue;
      // Cut off at `until` (inclusive end-of-day). Applied to the
      // ORIGINAL occurrence start — moving an occurrence doesn't let
      // a moved date escape the series's natural end-date cap.
      if (startMs > untilMs) continue;
      // Termination signal: track whether the ORIGINAL (unmoved) week
      // had anything before rangeEnd. We don't track moves' new times
      // here — even if a move could pull an out-of-range occurrence
      // back in, the original-start cutoff is the loop's terminator,
      // and we accept that very-far-in-the-past moves into the window
      // won't be emitted (the caller would need to know that and
      // expand a wider range). For typical UI windows this never
      // matters.
      if (startMs < rangeEndMs) weekHasFutureOccurrence = true;
      const originalIso = start.toISOString();
      // Per-occurrence skip exception lookup. Compares against
      // `start.toISOString()` so callers (listCalendarItems) can
      // build the set from `busy_block_exceptions.original_start`
      // raw timestamps without parsing them into Date instances.
      // Skip wins over move (defensive in case the DB has both).
      if (args.skipKeys && args.skipKeys.has(originalIso)) continue;

      // Per-occurrence MOVE exception lookup. When found, the
      // occurrence's visible times come from the move's new_start /
      // new_end; original-start is carried through so callers can find
      // the right exception row for further edits.
      const move = args.movesByKey?.get(originalIso);
      if (move) {
        const moveStartMs = move.newStart.getTime();
        const moveEndMs = move.newEnd.getTime();
        // In-range check uses the MOVED times. An out-of-range moved
        // occurrence (pushed past the window, or pulled before it
        // entirely) is correctly dropped here.
        if (moveStartMs >= rangeEndMs) continue;
        if (moveEndMs <= rangeStartMs) continue;
        out.push({
          startsAt: new Date(moveStartMs),
          endsAt: new Date(moveEndMs),
          originalStart: new Date(startMs),
        });
        if (out.length >= MAX_OCCURRENCES) return out;
        continue;
      }

      // Unmoved occurrence path. Same in-range checks as before.
      if (startMs >= rangeEndMs) continue;
      const endMs = startMs + durationMs;
      if (endMs <= rangeStartMs) continue;
      out.push({ startsAt: start, endsAt: new Date(endMs) });
      if (out.length >= MAX_OCCURRENCES) return out;
    }
    // Past rangeEnd entirely OR past `until` entirely → no further
    // weeks can produce in-range occurrences.
    if (!weekHasFutureOccurrence) {
      // One additional check: if `untilMs` is finite and the week's
      // first possible occurrence is past it, we're done. Otherwise,
      // the week may have been all-before-baseStart (week 0 with
      // byDay weekdays before the base) — keep going to week 1.
      const weekFirstStart = new Date(sundayOfBaseWeek);
      weekFirstStart.setDate(weekFirstStart.getDate() + n * 7);
      weekFirstStart.setHours(hour, minute, second, ms);
      const weekFirstMs = weekFirstStart.getTime();
      if (weekFirstMs >= rangeEndMs) break; // entire week past range
      if (weekFirstMs > untilMs) break; // entire week past `until`
      // else: continue — week 0 with all-before-base weekdays falls
      // here on the very first iteration.
    }
  }
  // Moves can push an occurrence out of its natural chronological
  // slot (e.g. move May 11 forward to May 25, past May 18). Final
  // sort keeps callers from having to re-sort when rendering — a
  // no-op when no moves are present.
  if (args.movesByKey && args.movesByKey.size > 0) {
    out.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  }
  return out;
}
