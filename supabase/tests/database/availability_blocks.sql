-- pgTAP tests for `availability_blocks` and the `is_friend_of()` helper.
-- Friend-only visibility: you see your own blocks + any accepted friend's.

begin;

select plan(24);

-- ────────────────────────────────────────────────────────────────────
-- Schema shape
-- (4-arg form for has_column / col_* avoids pgTAP overload ambiguity.)
-- ────────────────────────────────────────────────────────────────────

select has_table('public', 'availability_blocks', 'availability_blocks table exists');

select has_column('public', 'availability_blocks', 'id', 'has id');
select has_column('public', 'availability_blocks', 'user_id', 'has user_id');
select has_column('public', 'availability_blocks', 'starts_at', 'has starts_at');
select has_column('public', 'availability_blocks', 'ends_at', 'has ends_at');
select has_column('public', 'availability_blocks', 'created_at', 'has created_at');
select has_column('public', 'availability_blocks', 'updated_at', 'has updated_at');

select col_type_is('public', 'availability_blocks', 'starts_at', 'timestamp with time zone',
  'starts_at is timestamptz');
select col_type_is('public', 'availability_blocks', 'ends_at', 'timestamp with time zone',
  'ends_at is timestamptz');

select col_not_null('public', 'availability_blocks', 'user_id', 'user_id is NOT NULL');
select col_not_null('public', 'availability_blocks', 'starts_at', 'starts_at is NOT NULL');
select col_not_null('public', 'availability_blocks', 'ends_at', 'ends_at is NOT NULL');

select is(
  (select relrowsecurity from pg_class where oid = 'public.availability_blocks'::regclass),
  true,
  'RLS enabled on availability_blocks'
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

-- Alice ↔ Bob accepted; Alice → Carol pending.
insert into public.friendships (requester_id, addressee_id, status) values
  ('00000000-0000-0000-0000-00000000aaa1', '00000000-0000-0000-0000-00000000bbb2', 'accepted'),
  ('00000000-0000-0000-0000-00000000aaa1', '00000000-0000-0000-0000-00000000ccc3', 'pending');

-- Alice has one free block: tomorrow 4–6pm UTC.
insert into public.availability_blocks (user_id, starts_at, ends_at) values
  ('00000000-0000-0000-0000-00000000aaa1',
   (current_date + interval '1 day' + interval '16 hours'),
   (current_date + interval '1 day' + interval '18 hours'));

-- ────────────────────────────────────────────────────────────────────
-- Constraint: ends_at must be after starts_at
-- ────────────────────────────────────────────────────────────────────

select throws_ok(
  $$insert into public.availability_blocks (user_id, starts_at, ends_at)
    values ('00000000-0000-0000-0000-00000000aaa1', now() + interval '1 hour', now())$$,
  '23514',
  null,
  'inverted range rejected by check constraint'
);

-- ────────────────────────────────────────────────────────────────────
-- is_friend_of(other) helper
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

select ok(
  not public.is_friend_of('00000000-0000-0000-0000-00000000aaa1'),
  'is_friend_of returns false for self'
);

-- ────────────────────────────────────────────────────────────────────
-- RLS: SELECT
-- ────────────────────────────────────────────────────────────────────

-- Alice sees her own block.
select results_eq(
  $$select count(*)::int from public.availability_blocks
    where user_id = '00000000-0000-0000-0000-00000000aaa1'$$,
  'values (1)',
  'Alice can SELECT her own blocks'
);

-- Bob (accepted friend) sees Alice's block.
set local "request.jwt.claims" to '{"sub":"00000000-0000-0000-0000-00000000bbb2","role":"authenticated"}';
select results_eq(
  $$select count(*)::int from public.availability_blocks
    where user_id = '00000000-0000-0000-0000-00000000aaa1'$$,
  'values (1)',
  'accepted friend can SELECT the other party''s blocks'
);

-- Carol (pending) does not see Alice's block.
set local "request.jwt.claims" to '{"sub":"00000000-0000-0000-0000-00000000ccc3","role":"authenticated"}';
select results_eq(
  $$select count(*)::int from public.availability_blocks
    where user_id = '00000000-0000-0000-0000-00000000aaa1'$$,
  'values (0)',
  'pending-request peer cannot SELECT blocks'
);

-- Dave (stranger) does not see Alice's block.
set local "request.jwt.claims" to '{"sub":"00000000-0000-0000-0000-00000000ddd4","role":"authenticated"}';
select results_eq(
  $$select count(*)::int from public.availability_blocks
    where user_id = '00000000-0000-0000-0000-00000000aaa1'$$,
  'values (0)',
  'unrelated user cannot SELECT blocks'
);

-- ────────────────────────────────────────────────────────────────────
-- RLS: INSERT — only as yourself
-- ────────────────────────────────────────────────────────────────────

set local "request.jwt.claims" to '{"sub":"00000000-0000-0000-0000-00000000bbb2","role":"authenticated"}';

-- Bob inserts for himself: ok.
insert into public.availability_blocks (user_id, starts_at, ends_at) values
  ('00000000-0000-0000-0000-00000000bbb2', now() + interval '1 day', now() + interval '1 day 2 hours');
select results_eq(
  $$select count(*)::int from public.availability_blocks
    where user_id = '00000000-0000-0000-0000-00000000bbb2'$$,
  'values (1)',
  'user can INSERT a block for themselves'
);

-- Bob trying to insert for Alice: blocked by RLS WITH CHECK.
select throws_ok(
  $$insert into public.availability_blocks (user_id, starts_at, ends_at)
    values ('00000000-0000-0000-0000-00000000aaa1', now() + interval '2 days', now() + interval '2 days 1 hour')$$,
  '42501',
  null,
  'user cannot INSERT a block impersonating another user'
);

-- ────────────────────────────────────────────────────────────────────
-- RLS: UPDATE — only own; updated_at trigger fires
-- ────────────────────────────────────────────────────────────────────

set local "request.jwt.claims" to '{"sub":"00000000-0000-0000-0000-00000000aaa1","role":"authenticated"}';

-- Alice updates her own block.
update public.availability_blocks
   set ends_at = ends_at + interval '30 minutes'
 where user_id = '00000000-0000-0000-0000-00000000aaa1';

-- updated_at moved past created_at.
select ok(
  (select updated_at > created_at from public.availability_blocks
    where user_id = '00000000-0000-0000-0000-00000000aaa1'
    limit 1),
  'updated_at trigger fires on UPDATE'
);

-- Alice trying to update Bob's block: silently no-ops (RLS USING filters
-- the row out of the UPDATE plan).
update public.availability_blocks
   set ends_at = ends_at + interval '99 hours'
 where user_id = '00000000-0000-0000-0000-00000000bbb2';

set local role postgres;
select results_ne(
  $$select extract(epoch from (ends_at - starts_at))::int from public.availability_blocks
    where user_id = '00000000-0000-0000-0000-00000000bbb2'$$,
  $$values ((99 * 3600 + 2 * 3600)::int)$$,
  'cross-user UPDATE silently filtered out by RLS USING clause'
);

-- ────────────────────────────────────────────────────────────────────
-- RLS: DELETE — only own
-- ────────────────────────────────────────────────────────────────────

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"00000000-0000-0000-0000-00000000bbb2","role":"authenticated"}';

-- Bob trying to delete Alice's block: filtered out.
delete from public.availability_blocks
 where user_id = '00000000-0000-0000-0000-00000000aaa1';

set local role postgres;
select results_eq(
  $$select count(*)::int from public.availability_blocks
    where user_id = '00000000-0000-0000-0000-00000000aaa1'$$,
  'values (1)',
  'cross-user DELETE silently filtered out by RLS USING clause'
);

-- Alice can delete her own.
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"00000000-0000-0000-0000-00000000aaa1","role":"authenticated"}';
delete from public.availability_blocks where user_id = '00000000-0000-0000-0000-00000000aaa1';

set local role postgres;
select results_eq(
  $$select count(*)::int from public.availability_blocks
    where user_id = '00000000-0000-0000-0000-00000000aaa1'$$,
  'values (0)',
  'user can DELETE their own block'
);

select * from finish();
rollback;
