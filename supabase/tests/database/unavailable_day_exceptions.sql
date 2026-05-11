-- pgTAP tests for the `unavailable_day_exceptions` table — schema
-- shape + the action / new_date self-consistency CHECK + a couple of
-- smoke inserts.

begin;

select plan(10);

-- ────────────────────────────────────────────────────────────────────
-- Schema shape
-- ────────────────────────────────────────────────────────────────────

select has_table('public', 'unavailable_day_exceptions', 'unavailable_day_exceptions exists');
select has_column('public', 'unavailable_day_exceptions', 'series_user_id', 'has series_user_id');
select has_column('public', 'unavailable_day_exceptions', 'series_date', 'has series_date');
select has_column('public', 'unavailable_day_exceptions', 'original_date', 'has original_date');
select has_column('public', 'unavailable_day_exceptions', 'action', 'has action');
select has_column('public', 'unavailable_day_exceptions', 'new_date', 'has new_date');
select col_is_pk(
  'public', 'unavailable_day_exceptions',
  ARRAY['series_user_id', 'series_date', 'original_date'],
  '(series_user_id, series_date, original_date) is the PK'
);

-- ────────────────────────────────────────────────────────────────────
-- action / new_date self-consistency CHECK
-- ────────────────────────────────────────────────────────────────────

set local role postgres;

insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, aud, role)
values
  ('00000000-0000-0000-0000-0000000000f1', 'fae@example.test', '', now(),
   '{"display_name":"Fae","color":"#9C27B0"}'::jsonb, 'authenticated', 'authenticated');

-- Parent series row (Mondays unavailable).
insert into public.unavailable_days (user_id, date, title, recurrence_rule)
values (
  '00000000-0000-0000-0000-0000000000f1',
  '2026-05-11',
  'Mondays off',
  '{"freq":"weekly"}'::jsonb
);

-- 'skip' must NOT carry new_date.
select throws_ok(
  $$insert into public.unavailable_day_exceptions
      (series_user_id, series_date, original_date, action, new_date)
    values ('00000000-0000-0000-0000-0000000000f1',
            '2026-05-11', '2026-05-18',
            'skip', '2026-05-19')$$,
  '23514',
  null,
  'skip exception with new_date rejected'
);

-- 'move' must carry new_date.
select throws_ok(
  $$insert into public.unavailable_day_exceptions
      (series_user_id, series_date, original_date, action)
    values ('00000000-0000-0000-0000-0000000000f1',
            '2026-05-11', '2026-05-25',
            'move')$$,
  '23514',
  null,
  'move exception with missing new_date rejected'
);

-- Valid skip + valid move both accepted.
select lives_ok(
  $$insert into public.unavailable_day_exceptions
      (series_user_id, series_date, original_date, action)
    values ('00000000-0000-0000-0000-0000000000f1',
            '2026-05-11', '2026-05-18', 'skip');
    insert into public.unavailable_day_exceptions
      (series_user_id, series_date, original_date, action, new_date)
    values ('00000000-0000-0000-0000-0000000000f1',
            '2026-05-11', '2026-05-25', 'move', '2026-05-26')$$,
  'valid skip + move both accepted'
);

select * from finish();
rollback;
