-- pgTAP tests for the `friendships` table and its RLS policies.
-- Bidirectional friend graph: requester -> addressee -> accepted/declined.

begin;

select plan(18);

-- ────────────────────────────────────────────────────────────────────
-- Schema shape
-- (4-arg form for has_column / col_* avoids pgTAP overload ambiguity
-- with the (table, column, description) variant.)
-- ────────────────────────────────────────────────────────────────────

select has_table('public', 'friendships', 'friendships table exists');
select has_column('public', 'friendships', 'id', 'friendships has id');
select has_column('public', 'friendships', 'requester_id', 'friendships has requester_id');
select has_column('public', 'friendships', 'addressee_id', 'friendships has addressee_id');
select has_column('public', 'friendships', 'status', 'friendships has status');
select has_column('public', 'friendships', 'created_at', 'friendships has created_at');
select has_column('public', 'friendships', 'updated_at', 'friendships has updated_at');

select col_not_null('public', 'friendships', 'requester_id', 'requester_id is NOT NULL');
select col_not_null('public', 'friendships', 'addressee_id', 'addressee_id is NOT NULL');
select col_not_null('public', 'friendships', 'status', 'status is NOT NULL');

select is(
  (select relrowsecurity from pg_class where oid = 'public.friendships'::regclass),
  true,
  'RLS enabled on friendships'
);

-- ────────────────────────────────────────────────────────────────────
-- Setup: three profiles via auth.users + trigger
-- ────────────────────────────────────────────────────────────────────

set local role postgres;

insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, aud, role)
values
  ('00000000-0000-0000-0000-00000000aaa1', 'alice@example.test', '', now(),
   '{"display_name":"Alice","color":"#FF6B6B"}'::jsonb, 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000bbb2', 'bob@example.test', '', now(),
   '{"display_name":"Bob","color":"#4ECDC4"}'::jsonb, 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000ccc3', 'carol@example.test', '', now(),
   '{"display_name":"Carol","color":"#FFE66D"}'::jsonb, 'authenticated', 'authenticated');

-- ────────────────────────────────────────────────────────────────────
-- Constraint: cannot self-friend
-- ────────────────────────────────────────────────────────────────────

select throws_ok(
  $$insert into public.friendships (requester_id, addressee_id)
    values ('00000000-0000-0000-0000-00000000aaa1', '00000000-0000-0000-0000-00000000aaa1')$$,
  '23514',
  null,
  'self-friendship rejected by check constraint'
);

-- ────────────────────────────────────────────────────────────────────
-- RLS: as Alice, can INSERT a request only as the requester
-- ────────────────────────────────────────────────────────────────────

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"00000000-0000-0000-0000-00000000aaa1","role":"authenticated"}';

insert into public.friendships (requester_id, addressee_id)
values ('00000000-0000-0000-0000-00000000aaa1', '00000000-0000-0000-0000-00000000bbb2');

select results_eq(
  $$select count(*)::int from public.friendships
    where requester_id = '00000000-0000-0000-0000-00000000aaa1'
      and addressee_id = '00000000-0000-0000-0000-00000000bbb2'$$,
  'values (1)',
  'Alice can request friendship as herself'
);

-- Alice trying to insert as Bob → blocked by RLS WITH CHECK (42501).
select throws_ok(
  $$insert into public.friendships (requester_id, addressee_id)
    values ('00000000-0000-0000-0000-00000000bbb2', '00000000-0000-0000-0000-00000000ccc3')$$,
  '42501',
  null,
  'Alice cannot insert a request impersonating Bob'
);

-- ────────────────────────────────────────────────────────────────────
-- Constraint: duplicate request rejected
-- ────────────────────────────────────────────────────────────────────

select throws_ok(
  $$insert into public.friendships (requester_id, addressee_id)
    values ('00000000-0000-0000-0000-00000000aaa1', '00000000-0000-0000-0000-00000000bbb2')$$,
  '23505',
  null,
  'duplicate (requester, addressee) rejected by unique constraint'
);

-- ────────────────────────────────────────────────────────────────────
-- RLS: addressee can accept; requester cannot self-accept
-- ────────────────────────────────────────────────────────────────────

update public.friendships set status = 'accepted'
where requester_id = '00000000-0000-0000-0000-00000000aaa1'
  and addressee_id = '00000000-0000-0000-0000-00000000bbb2';

select results_eq(
  $$select status::text from public.friendships
    where requester_id = '00000000-0000-0000-0000-00000000aaa1'
      and addressee_id = '00000000-0000-0000-0000-00000000bbb2'$$,
  $$values ('pending'::text)$$,
  'requester cannot accept their own outgoing request (RLS filters UPDATE)'
);

set local "request.jwt.claims" to '{"sub":"00000000-0000-0000-0000-00000000bbb2","role":"authenticated"}';

update public.friendships set status = 'accepted'
where requester_id = '00000000-0000-0000-0000-00000000aaa1'
  and addressee_id = '00000000-0000-0000-0000-00000000bbb2';

select results_eq(
  $$select status::text from public.friendships
    where requester_id = '00000000-0000-0000-0000-00000000aaa1'
      and addressee_id = '00000000-0000-0000-0000-00000000bbb2'$$,
  $$values ('accepted'::text)$$,
  'addressee can accept a pending request'
);

-- ────────────────────────────────────────────────────────────────────
-- RLS: third party (Carol) cannot SELECT a friendship between others
-- ────────────────────────────────────────────────────────────────────

set local "request.jwt.claims" to '{"sub":"00000000-0000-0000-0000-00000000ccc3","role":"authenticated"}';

select results_eq(
  $$select count(*)::int from public.friendships
    where requester_id = '00000000-0000-0000-0000-00000000aaa1'
      and addressee_id = '00000000-0000-0000-0000-00000000bbb2'$$,
  'values (0)',
  'Carol cannot SELECT the friendship between Alice and Bob'
);

select * from finish();
rollback;
