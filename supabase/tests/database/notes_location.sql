-- pgTAP tests for the `notes` + `location` additions to busy_blocks
-- and the `notes` addition to unavailable_days.

begin;

select plan(11);

-- ────────────────────────────────────────────────────────────────────
-- Schema shape
-- ────────────────────────────────────────────────────────────────────

select has_column('public', 'busy_blocks', 'notes', 'busy_blocks has notes');
select has_column('public', 'busy_blocks', 'location', 'busy_blocks has location');
select col_type_is('public', 'busy_blocks', 'notes', 'text', 'busy_blocks.notes is text');
select col_type_is('public', 'busy_blocks', 'location', 'text', 'busy_blocks.location is text');
select col_is_null('public', 'busy_blocks', 'notes', 'busy_blocks.notes is nullable');
select col_is_null('public', 'busy_blocks', 'location', 'busy_blocks.location is nullable');

select has_column('public', 'unavailable_days', 'notes', 'unavailable_days has notes');
select col_type_is('public', 'unavailable_days', 'notes', 'text', 'unavailable_days.notes is text');

-- ────────────────────────────────────────────────────────────────────
-- not-blank checks
-- ────────────────────────────────────────────────────────────────────

set local role postgres;

insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, aud, role)
values
  ('00000000-0000-0000-0000-0000000000a1', 'eve@example.test', '', now(),
   '{"display_name":"Eve","color":"#FF6B6B"}'::jsonb, 'authenticated', 'authenticated');

select throws_ok(
  $$insert into public.busy_blocks (user_id, title, starts_at, ends_at, notes)
    values ('00000000-0000-0000-0000-0000000000a1', null,
            now() + interval '1 day', now() + interval '1 day 1 hour', '   ')$$,
  '23514',
  null,
  'whitespace-only notes rejected on busy_blocks'
);

select throws_ok(
  $$insert into public.busy_blocks (user_id, title, starts_at, ends_at, location)
    values ('00000000-0000-0000-0000-0000000000a1', null,
            now() + interval '2 days', now() + interval '2 days 1 hour', '   ')$$,
  '23514',
  null,
  'whitespace-only location rejected on busy_blocks'
);

select throws_ok(
  $$insert into public.unavailable_days (user_id, date, notes)
    values ('00000000-0000-0000-0000-0000000000a1', current_date + interval '5 days', '   ')$$,
  '23514',
  null,
  'whitespace-only notes rejected on unavailable_days'
);

select * from finish();
rollback;
