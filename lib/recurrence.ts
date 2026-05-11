// Recurrence rules for busy_blocks. v1 supports a single shape:
// `{ freq: 'weekly' }` — repeats the base block at +7d intervals,
// preserving local time-of-day and duration. Stored as JSONB on the
// `busy_blocks` table; null means the block is a one-off.
//
// The shape is deliberately a discriminated-union-friendly object so we
// can grow it later (`byDay`, `until`, `count`, `interval`, etc.) without
// a schema change — just bump the parser/expander.

export type RecurrenceRule = {
  freq: 'weekly';
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_WEEK = 7 * MS_PER_DAY;
/** Hard cap on expansion output to defend against pathological calls
 * (e.g. a thousand-year range). One year of weekly = ~52 occurrences,
 * so 500 is generous for any realistic UI query window. */
const MAX_OCCURRENCES = 500;

/** Type guard for values pulled from the DB / API. Use this to narrow
 * an `unknown` recurrence_rule column to the parsed shape. */
export function isRecurrenceRule(v: unknown): v is RecurrenceRule {
  if (typeof v !== 'object' || v === null) return false;
  const obj = v as Record<string, unknown>;
  return obj.freq === 'weekly';
}

/**
 * Expand a recurring busy_block series into individual occurrences whose
 * time intervals overlap `[rangeStart, rangeEnd)`.
 *
 * - `baseStart` / `baseEnd` are the series' first occurrence; subsequent
 *   occurrences are at +7d, +14d, +21d, ... preserving the wall-clock
 *   time and duration.
 * - The first occurrence (`baseStart`..`baseEnd`) IS included if it
 *   intersects the range — callers should NOT separately add the base.
 * - "Intersect" means the occurrence's `[start, end)` overlaps the range;
 *   an occurrence whose `start` is before `rangeStart` is included as
 *   long as its `end` is after `rangeStart` (handles cross-midnight
 *   blocks queried by the day boundary).
 * - Returns `[]` for unsupported `freq` values rather than throwing —
 *   defensive against future rule variants reaching old client code.
 */
export function expandOccurrences(args: {
  rule: RecurrenceRule;
  baseStart: Date;
  baseEnd: Date;
  rangeStart: Date; // inclusive
  rangeEnd: Date;   // exclusive
}): Array<{ startsAt: Date; endsAt: Date }> {
  if (args.rule.freq !== 'weekly') return [];

  const durationMs = args.baseEnd.getTime() - args.baseStart.getTime();
  if (durationMs < 0) return []; // malformed: end before start
  const rangeStartMs = args.rangeStart.getTime();
  const rangeEndMs = args.rangeEnd.getTime();

  // Walk from week 0 of the series forward. We use `setDate(... + n*7)`
  // (NOT `+ n * MS_PER_WEEK` on the millisecond value) so that DST
  // transitions don't shift the wall-clock time of subsequent
  // occurrences. With raw-ms addition, an event at 14:00 PST in winter
  // becomes 15:00 PDT in spring — the user's "every Monday at 2pm"
  // expectation breaks.
  //
  // Performance: iteration is O(weeks-from-base-to-rangeEnd), which is
  // bounded in practice (typical query window = 1 month, base is
  // usually within the past year → ~52 iterations max). Iterations
  // before `rangeStart` are cheap (just a Date construction + compare),
  // so we don't bother with a skip-ahead optimization.
  const out: Array<{ startsAt: Date; endsAt: Date }> = [];
  for (let n = 0; n <= MAX_OCCURRENCES * 2; n++) {
    const start = new Date(args.baseStart);
    start.setDate(start.getDate() + n * 7);
    const startMs = start.getTime();
    if (startMs >= rangeEndMs) break;
    const endMs = startMs + durationMs;
    if (endMs > rangeStartMs) {
      out.push({ startsAt: start, endsAt: new Date(endMs) });
      if (out.length >= MAX_OCCURRENCES) break;
    }
  }
  return out;
}
