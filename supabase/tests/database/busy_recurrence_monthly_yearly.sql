-- pgTAP tests for the widened freq set on busy_blocks +
-- unavailable_days recurrence (20260522000000). Mirrors the
-- events_recurrence_rule.sql tests, but on the busy + day tables.

begin;

select plan(6);

set local role postgres;

insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, aud, role)
values
  ('00000000-0000-0000-0000-00000000005a', 'pia@example.test', '', now(),
   '{"display_name":"Pia","color":"#9C27B0"}'::jsonb, 'authenticated', 'authenticated');

-- ────────────────────────────────────────────────────────────────────
-- busy_blocks: monthly + yearly accepted, daily still rejected
-- ────────────────────────────────────────────────────────────────────

select lives_ok(
  $$insert into public.busy_blocks (user_id, title, starts_at, ends_at, recurrence_rule)
    values ('00000000-0000-0000-0000-00000000005a', 'Monthly review',
            now() + interval '1 day', now() + interval '1 day 1 hour',
            '{"freq":"monthly"}'::jsonb)$$,
  'monthly busy_block recurrence accepted'
);

select lives_ok(
  $$insert into public.busy_blocks (user_id, title, starts_at, ends_at, recurrence_rule)
    values ('00000000-0000-0000-0000-00000000005a', 'Anniversary',
            now() + interval '2 days', now() + interval '2 days 1 hour',
            '{"freq":"yearly"}'::jsonb)$$,
  'yearly busy_block recurrence accepted'
);

select throws_ok(
  $$insert into public.busy_blocks (user_id, title, starts_at, ends_at, recurrence_rule)
    values ('00000000-0000-0000-0000-00000000005a', 'Standup',
            now() + interval '3 days', now() + interval '3 days 1 hour',
            '{"freq":"daily"}'::jsonb)$$,
  '23514',
  null,
  'unknown freq still rejected on busy_blocks (constraint still gates)'
);

-- ────────────────────────────────────────────────────────────────────
-- unavailable_days: same widening
-- ────────────────────────────────────────────────────────────────────

select lives_ok(
  $$insert into public.unavailable_days (user_id, date, title, recurrence_rule)
    values ('00000000-0000-0000-0000-00000000005a', current_date + 1,
            'Out monthly', '{"freq":"monthly"}'::jsonb)$$,
  'monthly unavailable_day recurrence accepted'
);

select lives_ok(
  $$insert into public.unavailable_days (user_id, date, title, recurrence_rule)
    values ('00000000-0000-0000-0000-00000000005a', current_date + 2,
            'Out annually', '{"freq":"yearly"}'::jsonb)$$,
  'yearly unavailable_day recurrence accepted'
);

select throws_ok(
  $$insert into public.unavailable_days (user_id, date, title, recurrence_rule)
    values ('00000000-0000-0000-0000-00000000005a', current_date + 3,
            'Daily?', '{"freq":"daily"}'::jsonb)$$,
  '23514',
  null,
  'unknown freq still rejected on unavailable_days'
);

select * from finish();
rollback;
