-- pgTAP tests for the `recurrence_rule` JSONB column on unavailable_days
-- (added in 20260511000000_unavailable_days_recurrence.sql).

begin;

select plan(5);

-- ────────────────────────────────────────────────────────────────────
-- Schema shape
-- ────────────────────────────────────────────────────────────────────

select has_column('public', 'unavailable_days', 'recurrence_rule', 'unavailable_days has recurrence_rule');
select col_type_is('public', 'unavailable_days', 'recurrence_rule', 'jsonb', 'recurrence_rule is jsonb');
select col_is_null('public', 'unavailable_days', 'recurrence_rule', 'recurrence_rule is nullable');

-- ────────────────────────────────────────────────────────────────────
-- freq CHECK constraint
-- ────────────────────────────────────────────────────────────────────

set local role postgres;

insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, aud, role)
values
  ('00000000-0000-0000-0000-0000000000d1', 'dana@example.test', '', now(),
   '{"display_name":"Dana","color":"#FFA500"}'::jsonb, 'authenticated', 'authenticated');

-- weekly is allowed.
select lives_ok(
  $$insert into public.unavailable_days (user_id, date, title, recurrence_rule)
    values ('00000000-0000-0000-0000-0000000000d1',
            current_date + interval '1 day', 'Weekly off-day',
            '{"freq":"weekly"}'::jsonb)$$,
  'weekly recurrence_rule accepted on unavailable_days'
);

-- monthly is NOT allowed (yet).
select throws_ok(
  $$insert into public.unavailable_days (user_id, date, title, recurrence_rule)
    values ('00000000-0000-0000-0000-0000000000d1',
            current_date + interval '2 days', 'Test',
            '{"freq":"monthly"}'::jsonb)$$,
  '23514',
  null,
  'unknown freq rejected by recurrence_rule_freq_supported check'
);

select * from finish();
rollback;
