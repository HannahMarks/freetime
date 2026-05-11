-- pgTAP tests for the `recurrence_rule` JSONB column on busy_blocks
-- (added in 20260510000000_add_recurrence_rule.sql).

begin;

select plan(5);

-- ────────────────────────────────────────────────────────────────────
-- Schema shape
-- ────────────────────────────────────────────────────────────────────

select has_column('public', 'busy_blocks', 'recurrence_rule', 'busy_blocks has recurrence_rule');
select col_type_is('public', 'busy_blocks', 'recurrence_rule', 'jsonb', 'recurrence_rule is jsonb');
select col_is_null('public', 'busy_blocks', 'recurrence_rule', 'recurrence_rule is nullable');

-- ────────────────────────────────────────────────────────────────────
-- freq CHECK constraint
-- ────────────────────────────────────────────────────────────────────

set local role postgres;

insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, aud, role)
values
  ('00000000-0000-0000-0000-0000000000c1', 'cara@example.test', '', now(),
   '{"display_name":"Cara","color":"#4ECDC4"}'::jsonb, 'authenticated', 'authenticated');

-- weekly is allowed.
select lives_ok(
  $$insert into public.busy_blocks (user_id, title, starts_at, ends_at, recurrence_rule)
    values ('00000000-0000-0000-0000-0000000000c1', 'Yoga',
            now() + interval '1 day', now() + interval '1 day 1 hour',
            '{"freq":"weekly"}'::jsonb)$$,
  'weekly recurrence_rule accepted'
);

-- daily is NOT allowed (yet) — gate against old clients writing rules
-- the server doesn't know how to expand.
select throws_ok(
  $$insert into public.busy_blocks (user_id, title, starts_at, ends_at, recurrence_rule)
    values ('00000000-0000-0000-0000-0000000000c1', 'Standup',
            now() + interval '2 days', now() + interval '2 days 1 hour',
            '{"freq":"daily"}'::jsonb)$$,
  '23514',
  null,
  'unknown freq rejected by recurrence_rule_freq_supported check'
);

select * from finish();
rollback;
