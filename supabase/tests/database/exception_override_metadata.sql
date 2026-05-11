-- pgTAP tests for the per-occurrence override metadata columns added
-- in 20260514000000 — title / notes / location on
-- busy_block_exceptions, title / notes on unavailable_day_exceptions.

begin;

select plan(11);

-- ────────────────────────────────────────────────────────────────────
-- Schema shape: busy_block_exceptions
-- ────────────────────────────────────────────────────────────────────

select has_column('public', 'busy_block_exceptions', 'title', 'busy_block_exceptions has title');
select has_column('public', 'busy_block_exceptions', 'notes', 'busy_block_exceptions has notes');
select has_column('public', 'busy_block_exceptions', 'location', 'busy_block_exceptions has location');
select col_is_null('public', 'busy_block_exceptions', 'title', 'busy_block_exceptions.title is nullable');
select col_is_null('public', 'busy_block_exceptions', 'notes', 'busy_block_exceptions.notes is nullable');
select col_is_null('public', 'busy_block_exceptions', 'location', 'busy_block_exceptions.location is nullable');

-- ────────────────────────────────────────────────────────────────────
-- Schema shape: unavailable_day_exceptions
-- ────────────────────────────────────────────────────────────────────

select has_column('public', 'unavailable_day_exceptions', 'title', 'unavailable_day_exceptions has title');
select has_column('public', 'unavailable_day_exceptions', 'notes', 'unavailable_day_exceptions has notes');

-- ────────────────────────────────────────────────────────────────────
-- not-blank checks (mirrors busy_blocks/unavailable_days)
-- ────────────────────────────────────────────────────────────────────

set local role postgres;

insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, aud, role)
values
  ('00000000-0000-0000-0000-00000000000c', 'gus@example.test', '', now(),
   '{"display_name":"Gus","color":"#3F51B5"}'::jsonb, 'authenticated', 'authenticated');

insert into public.busy_blocks (id, user_id, title, starts_at, ends_at, recurrence_rule)
values (
  '00000000-0000-0000-0000-00000000bbf1',
  '00000000-0000-0000-0000-00000000000c',
  'Yoga',
  '2026-05-11 14:00:00+00',
  '2026-05-11 15:00:00+00',
  '{"freq":"weekly"}'::jsonb
);

-- Whitespace-only override title rejected.
select throws_ok(
  $$insert into public.busy_block_exceptions
      (series_id, original_start, action, new_start, new_end, title)
    values ('00000000-0000-0000-0000-00000000bbf1',
            '2026-05-18 14:00:00+00', 'move',
            '2026-05-18 16:00:00+00',
            '2026-05-18 17:00:00+00',
            '   ')$$,
  '23514',
  null,
  'whitespace-only override title rejected on busy_block_exceptions'
);

-- Valid override metadata accepted.
select lives_ok(
  $$insert into public.busy_block_exceptions
      (series_id, original_start, action, new_start, new_end,
       title, notes, location)
    values ('00000000-0000-0000-0000-00000000bbf1',
            '2026-05-25 14:00:00+00', 'move',
            '2026-05-25 16:00:00+00',
            '2026-05-25 17:00:00+00',
            'Yoga (in studio)', 'Bring extra mat', 'Studio 7')$$,
  'override title/notes/location accepted on move exception'
);

-- Inherits-from-series shape (all override columns null) still accepted.
select lives_ok(
  $$insert into public.busy_block_exceptions
      (series_id, original_start, action, new_start, new_end)
    values ('00000000-0000-0000-0000-00000000bbf1',
            '2026-06-01 14:00:00+00', 'move',
            '2026-06-01 16:00:00+00',
            '2026-06-01 17:00:00+00')$$,
  'move exception with null override columns still accepted (inherits)'
);

select * from finish();
rollback;
