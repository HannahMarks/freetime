-- pgTAP tests for `busy_blocks`, `unavailable_days`, and `is_friend_of()`.
--
-- Friends-only SELECT (own + accepted friends), owner-only mutations.

begin;

select plan(30);

-- ────────────────────────────────────────────────────────────────────
-- busy_blocks schema shape
-- ────────────────────────────────────────────────────────────────────

select has_table('public', 'busy_blocks', 'busy_blocks table exists');
select has_column('public', 'busy_blocks', 'id', 'busy_blocks has id');
select has_column('public', 'busy_blocks', 'user_id', 'busy_blocks has user_id');
select has_column('public', 'busy_blocks', 'title', 'busy_blocks has title');
select has_column('public', 'busy_blocks', 'starts_at', 'busy_blocks has starts_at');
select has_column('public', 'busy_blocks', 'ends_at', 'busy_blocks has ends_at');
select col_type_is('public', 'busy_blocks', 'starts_at', 'timestamp with time zone',
  'starts_at is timestamptz');
select col_not_null('public', 'busy_blocks', 'user_id', 'user_id NOT NULL');
select col_not_null('public', 'busy_blocks', 'starts_at', 'starts_at NOT NULL');
select col_not_null('public', 'busy_blocks', 'ends_at', 'ends_at NOT NULL');

select is(
  (select relrowsecurity from pg_class where oid = 'public.busy_blocks'::regclass),
  true,
  'RLS enabled on busy_blocks'
);

-- ────────────────────────────────────────────────────────────────────
-- unavailable_days schema shape
-- ────────────────────────────────────────────────────────────────────

select has_table('public', 'unavailable_days', 'unavailable_days table exists');
select has_column('public', 'unavailable_days', 'user_id', 'unavailable_days has user_id');
select has_column('public', 'unavailable_days', 'date', 'unavailable_days has date');
select col_type_is('public', 'unavailable_days', 'date', 'date',
  'date column is type date (floating, no time zone)');

select is(
  (select relrowsecurity from pg_class where oid = 'public.unavailable_days'::regclass),
  true,
  'RLS enabled on unavailable_days'
);

-- ────────────────────────────────────────────────────────────────────
-- Setup: four users — Alice, Bob (accepted friend), Carol (pending),
-- Dave (no relationship).
-- ────────────────────────────────────────────────────────────────────

set local role postgres;

insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, aud, role)
values
  ('00000000-0000-0000-0000-00000000aaa1', 'alice@example.test', '', now(),
   '{"display_name":"Alice","color":"#FF6B6B"}'::jsonb, 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000bbb2', 'bob@example.test', '', now(),
   '{"display_name":"Bob","color":"#4ECDC4"}'::jsonb, 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000ccc3', 'carol@example.test', '', now(),
   '{"display_name":"Carol","color":"#FFE66D"}'::jsonb, 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000ddd4', 'dave@example.test', '', now(),
   '{"display_name":"Dave","color":"#A8E6CF"}'::jsonb, 'authenticated', 'authenticated');

insert into public.friendships (requester_id, addressee_id, status) values
  ('00000000-0000-0000-0000-00000000aaa1', '00000000-0000-0000-0000-00000000bbb2', 'accepted'),
  ('00000000-0000-0000-0000-00000000aaa1', '00000000-0000-0000-0000-00000000ccc3', 'pending');

-- Alice has one busy block ("Lunch with Sarah") tomorrow noon–1pm.
insert into public.busy_blocks (user_id, title, starts_at, ends_at) values
  ('00000000-0000-0000-0000-00000000aaa1', 'Lunch with Sarah',
   (current_date + interval '1 day' + interval '12 hours'),
   (current_date + interval '1 day' + interval '13 hours'));

-- Alice marks the day after as fully unavailable.
insert into public.unavailable_days (user_id, date) values
  ('00000000-0000-0000-0000-00000000aaa1', current_date + interval '2 days');

-- ────────────────────────────────────────────────────────────────────
-- Constraints on busy_blocks
-- ────────────────────────────────────────────────────────────────────

select throws_ok(
  $$insert into public.busy_blocks (user_id, starts_at, ends_at)
    values ('00000000-0000-0000-0000-00000000aaa1', now() + interval '1 hour', now())$$,
  '23514',
  null,
  'inverted range rejected by busy_blocks_valid_range'
);

select throws_ok(
  $$insert into public.busy_blocks (user_id, title, starts_at, ends_at)
    values ('00000000-0000-0000-0000-00000000aaa1', '   ', now() + interval '1 day', now() + interval '1 day 1 hour')$$,
  '23514',
  null,
  'whitespace-only title rejected by title_not_blank check'
);

-- NULL title is allowed (means "Busy" with no label).
insert into public.busy_blocks (user_id, title, starts_at, ends_at) values
  ('00000000-0000-0000-0000-00000000aaa1', null,
   now() + interval '3 days', now() + interval '3 days 1 hour');
select results_eq(
  $$select count(*)::int from public.busy_blocks
    where user_id = '00000000-0000-0000-0000-00000000aaa1'
      and title is null$$,
  'values (1)',
  'NULL title is permitted'
);

-- unavailable_days PK prevents marking the same date twice.
select throws_ok(
  $$insert into public.unavailable_days (user_id, date)
    values ('00000000-0000-0000-0000-00000000aaa1', current_date + interval '2 days')$$,
  '23505',
  null,
  'unavailable_days (user_id, date) PK rejects duplicate'
);

-- ────────────────────────────────────────────────────────────────────
-- is_friend_of(other) — same semantics as before the schema flip
-- ────────────────────────────────────────────────────────────────────

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"00000000-0000-0000-0000-00000000aaa1","role":"authenticated"}';

select ok(
  public.is_friend_of('00000000-0000-0000-0000-00000000bbb2'),
  'is_friend_of returns true for an accepted friendship'
);

select ok(
  not public.is_friend_of('00000000-0000-0000-0000-00000000ccc3'),
  'is_friend_of returns false for a pending request'
);

select ok(
  not public.is_friend_of('00000000-0000-0000-0000-00000000ddd4'),
  'is_friend_of returns false for a stranger'
);

-- ────────────────────────────────────────────────────────────────────
-- RLS: SELECT visibility for both tables
-- ────────────────────────────────────────────────────────────────────

-- Alice sees her own data.
select results_eq(
  $$select count(*)::int from public.busy_blocks
    where user_id = '00000000-0000-0000-0000-00000000aaa1'$$,
  'values (2)',  -- Lunch + null-title block
  'Alice can SELECT her own busy_blocks'
);
select results_eq(
  $$select count(*)::int from public.unavailable_days
    where user_id = '00000000-0000-0000-0000-00000000aaa1'$$,
  'values (1)',
  'Alice can SELECT her own unavailable_days'
);

-- Bob (accepted friend) sees Alice's data.
set local "request.jwt.claims" to '{"sub":"00000000-0000-0000-0000-00000000bbb2","role":"authenticated"}';
select results_eq(
  $$select count(*)::int from public.busy_blocks
    where user_id = '00000000-0000-0000-0000-00000000aaa1'$$,
  'values (2)',
  'accepted friend can SELECT the other party''s busy_blocks'
);
select results_eq(
  $$select count(*)::int from public.unavailable_days
    where user_id = '00000000-0000-0000-0000-00000000aaa1'$$,
  'values (1)',
  'accepted friend can SELECT the other party''s unavailable_days'
);

-- Dave (stranger) sees nothing.
set local "request.jwt.claims" to '{"sub":"00000000-0000-0000-0000-00000000ddd4","role":"authenticated"}';
select results_eq(
  $$select count(*)::int from public.busy_blocks
    where user_id = '00000000-0000-0000-0000-00000000aaa1'$$,
  'values (0)',
  'stranger cannot SELECT busy_blocks'
);
select results_eq(
  $$select count(*)::int from public.unavailable_days
    where user_id = '00000000-0000-0000-0000-00000000aaa1'$$,
  'values (0)',
  'stranger cannot SELECT unavailable_days'
);

-- ────────────────────────────────────────────────────────────────────
-- RLS: INSERT — only as yourself
-- ────────────────────────────────────────────────────────────────────

set local "request.jwt.claims" to '{"sub":"00000000-0000-0000-0000-00000000bbb2","role":"authenticated"}';

select throws_ok(
  $$insert into public.busy_blocks (user_id, title, starts_at, ends_at)
    values ('00000000-0000-0000-0000-00000000aaa1', 'sneaky', now() + interval '5 days', now() + interval '5 days 1 hour')$$,
  '42501',
  null,
  'cannot INSERT a busy_block impersonating another user'
);

select throws_ok(
  $$insert into public.unavailable_days (user_id, date)
    values ('00000000-0000-0000-0000-00000000aaa1', current_date + interval '10 days')$$,
  '42501',
  null,
  'cannot INSERT an unavailable_day impersonating another user'
);

-- ────────────────────────────────────────────────────────────────────
-- RLS: UPDATE / DELETE — silently filter cross-user attempts
-- ────────────────────────────────────────────────────────────────────

-- Bob trying to delete Alice's busy_block: filtered out by USING.
delete from public.busy_blocks where user_id = '00000000-0000-0000-0000-00000000aaa1';

set local role postgres;
select results_ne(
  $$select count(*)::int from public.busy_blocks
    where user_id = '00000000-0000-0000-0000-00000000aaa1'$$,
  'values (0)',
  'cross-user DELETE on busy_blocks silently filtered out by RLS'
);

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"00000000-0000-0000-0000-00000000aaa1","role":"authenticated"}';

-- Alice updates her own busy_block, updated_at trigger fires.
update public.busy_blocks
   set title = 'Lunch with Sarah (rescheduled)'
 where user_id = '00000000-0000-0000-0000-00000000aaa1' and title = 'Lunch with Sarah';

select ok(
  (select updated_at > created_at from public.busy_blocks
    where title = 'Lunch with Sarah (rescheduled)' limit 1),
  'updated_at trigger fires on busy_blocks UPDATE'
);

-- Alice removes her unavailable_day.
delete from public.unavailable_days
 where user_id = '00000000-0000-0000-0000-00000000aaa1'
   and date = current_date + interval '2 days';

select results_eq(
  $$select count(*)::int from public.unavailable_days
    where user_id = '00000000-0000-0000-0000-00000000aaa1'$$,
  'values (0)',
  'user can DELETE their own unavailable_day'
);

select * from finish();
rollback;
