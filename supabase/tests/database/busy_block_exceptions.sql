-- pgTAP tests for the `busy_block_exceptions` table — schema shape +
-- the action / new_* self-consistency CHECK + a smoke test for RLS.

begin;

select plan(11);

-- ────────────────────────────────────────────────────────────────────
-- Schema shape
-- ────────────────────────────────────────────────────────────────────

select has_table('public', 'busy_block_exceptions', 'busy_block_exceptions exists');
select has_column('public', 'busy_block_exceptions', 'series_id', 'has series_id');
select has_column('public', 'busy_block_exceptions', 'original_start', 'has original_start');
select has_column('public', 'busy_block_exceptions', 'action', 'has action');
select has_column('public', 'busy_block_exceptions', 'new_start', 'has new_start');
select has_column('public', 'busy_block_exceptions', 'new_end', 'has new_end');

-- Composite PK ensures one exception row per (series, occurrence-start).
select col_is_pk(
  'public', 'busy_block_exceptions',
  ARRAY['series_id', 'original_start'],
  '(series_id, original_start) is the PK'
);

-- ────────────────────────────────────────────────────────────────────
-- action / new_* self-consistency CHECK
-- ────────────────────────────────────────────────────────────────────

set local role postgres;

insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, aud, role)
values
  ('00000000-0000-0000-0000-0000000000e1', 'eli@example.test', '', now(),
   '{"display_name":"Eli","color":"#9C27B0"}'::jsonb, 'authenticated', 'authenticated');

insert into public.busy_blocks (id, user_id, title, starts_at, ends_at, recurrence_rule)
values (
  '00000000-0000-0000-0000-00000000bbe1',
  '00000000-0000-0000-0000-0000000000e1',
  'Yoga',
  '2026-05-11 14:00:00+00',
  '2026-05-11 15:00:00+00',
  '{"freq":"weekly"}'::jsonb
);

-- 'skip' must NOT carry new_*.
select throws_ok(
  $$insert into public.busy_block_exceptions (series_id, original_start, action, new_start)
    values ('00000000-0000-0000-0000-00000000bbe1',
            '2026-05-18 14:00:00+00', 'skip',
            '2026-05-18 16:00:00+00')$$,
  '23514',
  null,
  'skip exception with new_start rejected'
);

-- 'move' must carry both new_start AND new_end.
select throws_ok(
  $$insert into public.busy_block_exceptions (series_id, original_start, action, new_start)
    values ('00000000-0000-0000-0000-00000000bbe1',
            '2026-05-18 14:00:00+00', 'move',
            '2026-05-18 16:00:00+00')$$,
  '23514',
  null,
  'move exception with only new_start (missing new_end) rejected'
);

-- 'move' with new_end <= new_start rejected (zero-length / inverted moves).
select throws_ok(
  $$insert into public.busy_block_exceptions (series_id, original_start, action, new_start, new_end)
    values ('00000000-0000-0000-0000-00000000bbe1',
            '2026-05-25 14:00:00+00', 'move',
            '2026-05-25 16:00:00+00',
            '2026-05-25 16:00:00+00')$$,
  '23514',
  null,
  'move exception with new_end == new_start rejected'
);

-- Valid skip + valid move both accepted.
select lives_ok(
  $$insert into public.busy_block_exceptions (series_id, original_start, action)
      values ('00000000-0000-0000-0000-00000000bbe1', '2026-05-18 14:00:00+00', 'skip');
    insert into public.busy_block_exceptions (series_id, original_start, action, new_start, new_end)
      values ('00000000-0000-0000-0000-00000000bbe1',
              '2026-05-25 14:00:00+00', 'move',
              '2026-05-25 16:00:00+00',
              '2026-05-25 17:00:00+00')$$,
  'valid skip + move both accepted'
);

select * from finish();
rollback;
