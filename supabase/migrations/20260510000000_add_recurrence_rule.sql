-- Recurring busy_blocks. The simplest useful case is "every Monday
-- 2-3pm" — a weekly repeating block. Storing the rule as JSONB lets the
-- shape grow (`byDay`, `until`, `count`, `interval`, etc.) without
-- additional migrations.
--
-- v1 supported shape: `{"freq": "weekly"}`. The base row's `starts_at`
-- and `ends_at` describe the FIRST occurrence; client code expands
-- subsequent occurrences at +7d intervals (preserving wall-clock time
-- across DST).
--
-- NULL means the block is a one-off (existing behavior).
--
-- The CHECK constraint validates the only currently-supported freq;
-- bump it as more variants are added so an old client can't accidentally
-- write a rule a newer one defined.

alter table public.busy_blocks
  add column recurrence_rule jsonb;

alter table public.busy_blocks
  add constraint busy_blocks_recurrence_rule_freq_supported check (
    recurrence_rule is null
    or (recurrence_rule->>'freq') in ('weekly')
  );
