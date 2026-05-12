-- Widen the busy_blocks + unavailable_days recurrence CHECK
-- constraints so they accept 'weekly' | 'monthly' | 'yearly' — the
-- same freq set events already supports (since
-- 20260517000000_events_recurrence_rule.sql).
--
-- Why now: user feedback wants "Lunch with Sarah" / "I'm away on the
-- 15th" / annual-leave-day busy markers to repeat at month + year
-- granularity, not just weekly. The client-side recurrence engine in
-- `lib/recurrence.ts` already handles all three freqs (the
-- expandFixedStep branch from PR #65), so this migration just brings
-- the schema's CHECK constraints into agreement with what the JS
-- understands.
--
-- Drop + recreate the constraint (Postgres doesn't have ALTER CHECK).
-- Same constraint name kept across the rewrite so error messages
-- stay stable for any clients pattern-matching on them.

alter table public.busy_blocks
  drop constraint busy_blocks_recurrence_rule_freq_supported;

alter table public.busy_blocks
  add constraint busy_blocks_recurrence_rule_freq_supported check (
    recurrence_rule is null
    or (recurrence_rule->>'freq') in ('weekly', 'monthly', 'yearly')
  );

alter table public.unavailable_days
  drop constraint unavailable_days_recurrence_rule_freq_supported;

alter table public.unavailable_days
  add constraint unavailable_days_recurrence_rule_freq_supported check (
    recurrence_rule is null
    or (recurrence_rule->>'freq') in ('weekly', 'monthly', 'yearly')
  );
