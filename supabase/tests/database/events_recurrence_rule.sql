-- pgTAP tests for the `recurrence_rule` JSONB column on events (added
-- in 20260517000000_events_recurrence_rule.sql). Mirrors the busy_blocks
-- recurrence test shape, but the CHECK admits a wider freq set —
-- 'weekly' | 'monthly' | 'yearly' — since events are the primary place
-- the UI offers monthly + yearly repetition (anniversaries, birthdays).

begin;

select plan(7);

-- ────────────────────────────────────────────────────────────────────
-- Schema shape
-- ────────────────────────────────────────────────────────────────────

select has_column('public', 'events', 'recurrence_rule',
  'events has recurrence_rule');
select col_type_is('public', 'events', 'recurrence_rule', 'jsonb',
  'recurrence_rule is jsonb');
select col_is_null('public', 'events', 'recurrence_rule',
  'recurrence_rule is nullable');

-- ────────────────────────────────────────────────────────────────────
-- freq CHECK constraint
-- ────────────────────────────────────────────────────────────────────

set local role postgres;

-- Seed auth user with a 12-char hex tail (avoid non-hex chars like
-- 'g'/'h' that would fail the uuid parser — same gotcha that broke
-- the events.sql/exception_override_metadata.sql earlier in this
-- project; see git log).
insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, aud, role)
values
  ('00000000-0000-0000-0000-00000000000d', 'dani@example.test', '', now(),
   '{"display_name":"Dani","color":"#9C27B0"}'::jsonb, 'authenticated', 'authenticated');

-- weekly is allowed.
select lives_ok(
  $$insert into public.events (owner_id, title, starts_at, ends_at, recurrence_rule)
    values ('00000000-0000-0000-0000-00000000000d', 'Monthly meetup',
            now() + interval '1 day', now() + interval '1 day 1 hour',
            '{"freq":"weekly"}'::jsonb)$$,
  'weekly recurrence_rule accepted on events'
);

-- monthly is allowed.
select lives_ok(
  $$insert into public.events (owner_id, title, starts_at, ends_at, recurrence_rule)
    values ('00000000-0000-0000-0000-00000000000d', 'Book club',
            now() + interval '2 days', now() + interval '2 days 1 hour',
            '{"freq":"monthly"}'::jsonb)$$,
  'monthly recurrence_rule accepted on events'
);

-- yearly is allowed.
select lives_ok(
  $$insert into public.events (owner_id, title, starts_at, ends_at, recurrence_rule)
    values ('00000000-0000-0000-0000-00000000000d', 'Birthday',
            now() + interval '3 days', now() + interval '3 days 1 hour',
            '{"freq":"yearly"}'::jsonb)$$,
  'yearly recurrence_rule accepted on events'
);

-- daily is NOT allowed — gates against an old/new client mismatch
-- where the client writes a rule the server can't expand.
select throws_ok(
  $$insert into public.events (owner_id, title, starts_at, ends_at, recurrence_rule)
    values ('00000000-0000-0000-0000-00000000000d', 'Standup',
            now() + interval '4 days', now() + interval '4 days 1 hour',
            '{"freq":"daily"}'::jsonb)$$,
  '23514',
  null,
  'unknown freq rejected by events_recurrence_rule_freq_supported check'
);

select * from finish();
rollback;
