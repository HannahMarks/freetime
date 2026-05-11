-- Recurring events. Mirrors the `busy_blocks.recurrence_rule` column
-- (migration 20260510000000) but with the widened freq set: weekly,
-- monthly, yearly. Events are the canonical place to ask for monthly
-- + yearly repetition (anniversaries, monthly meetups, birthdays);
-- busy_blocks stay weekly-only at the schema level until the UI
-- exposes those frequencies for them.
--
-- Shape (matches `lib/recurrence.ts` v3):
-- ```json
-- {
--   "freq": "weekly" | "monthly" | "yearly",
--   "byDay": [0..6],     // optional; weekly-only — ignored otherwise
--   "until": "YYYY-MM-DD" // optional; inclusive end-of-day
-- }
-- ```
--
-- NULL = one-off (default existing behavior).
--
-- The CHECK constraint validates `freq` only — `byDay` / `until` are
-- parsed defensively client-side (malformed values fall back to v1
-- defaults rather than throwing). Bumping freq in a future migration
-- means adding values to the IN list here so an old client can't
-- write a rule a newer one introduced.

alter table public.events
  add column recurrence_rule jsonb;

alter table public.events
  add constraint events_recurrence_rule_freq_supported check (
    recurrence_rule is null
    or (recurrence_rule->>'freq') in ('weekly', 'monthly', 'yearly')
  );
