-- Recurring `unavailable_days`. Mirror of the `busy_blocks.recurrence_rule`
-- column added in 20260510000000_add_recurrence_rule.sql so a user can
-- mark "every Sunday I'm unavailable" without inserting 52 rows per
-- year.
--
-- Storage shape matches `busy_blocks` exactly: JSONB, nullable
-- (null = one-off), CHECK gating `freq` to the freqs the client knows
-- how to expand. v1 supported shape: `{"freq":"weekly"}`. v2 (in the
-- same JSONB column without a schema bump) adds optional `byDay` +
-- `until` — same parser as busy_blocks.
--
-- The PK on this table is `(user_id, date)` which represents the
-- FIRST occurrence; client-side `expandOccurrences` produces the
-- additional dates. (No DB-side per-occurrence row materialization —
-- same client-side-only approach as for busy_blocks.)

alter table public.unavailable_days
  add column recurrence_rule jsonb;

alter table public.unavailable_days
  add constraint unavailable_days_recurrence_rule_freq_supported check (
    recurrence_rule is null
    or (recurrence_rule->>'freq') in ('weekly')
  );
