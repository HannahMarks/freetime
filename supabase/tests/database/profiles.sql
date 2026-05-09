-- pgTAP tests for the `profiles` table and its RLS policies.
-- Run with `supabase test db` (requires `supabase start` first).

begin;

select plan(19);

-- ────────────────────────────────────────────────────────────────────
-- Schema shape
-- (4-arg form for has_column / col_* avoids pgTAP overload ambiguity
-- with the (table, column, description) variant.)
-- ────────────────────────────────────────────────────────────────────

select has_table('public', 'profiles', 'profiles table exists');

select has_column('public', 'profiles', 'id', 'profiles has id');
select has_column('public', 'profiles', 'display_name', 'profiles has display_name');
select has_column('public', 'profiles', 'color', 'profiles has color');
select has_column('public', 'profiles', 'created_at', 'profiles has created_at');
select has_column('public', 'profiles', 'updated_at', 'profiles has updated_at');

select col_type_is('public', 'profiles', 'id', 'uuid', 'id is uuid');
select col_type_is('public', 'profiles', 'display_name', 'text', 'display_name is text');
select col_type_is('public', 'profiles', 'color', 'text', 'color is text');

select col_not_null('public', 'profiles', 'display_name', 'display_name is NOT NULL');
select col_not_null('public', 'profiles', 'color', 'color is NOT NULL');

select col_is_pk('public', 'profiles', 'id', 'id is the primary key');

-- ────────────────────────────────────────────────────────────────────
-- RLS enabled
-- ────────────────────────────────────────────────────────────────────

select is(
  (select relrowsecurity from pg_class where oid = 'public.profiles'::regclass),
  true,
  'RLS is enabled on profiles'
);

-- ────────────────────────────────────────────────────────────────────
-- Trigger: profile auto-created when a user signs up in auth.users
-- ────────────────────────────────────────────────────────────────────

set local role postgres;

insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, aud, role)
values
  ('00000000-0000-0000-0000-00000000aaa1', 'alice@example.test', '', now(),
   '{"display_name":"Alice","color":"#FF6B6B"}'::jsonb, 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000bbb2', 'bob@example.test', '', now(),
   '{"display_name":"Bob","color":"#4ECDC4"}'::jsonb, 'authenticated', 'authenticated');

select results_eq(
  $$select display_name, color from public.profiles where id = '00000000-0000-0000-0000-00000000aaa1'$$,
  $$values ('Alice'::text, '#FF6B6B'::text)$$,
  'profile auto-created from auth.users metadata'
);

-- ────────────────────────────────────────────────────────────────────
-- RLS: authenticated users can SELECT all profiles
-- ────────────────────────────────────────────────────────────────────

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"00000000-0000-0000-0000-00000000aaa1","role":"authenticated"}';

select results_eq(
  'select count(*)::int from public.profiles',
  'values (2)',
  'authenticated user can SELECT all profiles'
);

-- ────────────────────────────────────────────────────────────────────
-- RLS: a user can update their own profile
-- ────────────────────────────────────────────────────────────────────

update public.profiles set display_name = 'Alice Updated' where id = '00000000-0000-0000-0000-00000000aaa1';

select results_eq(
  $$select display_name from public.profiles where id = '00000000-0000-0000-0000-00000000aaa1'$$,
  $$values ('Alice Updated'::text)$$,
  'user can update own profile'
);

-- ────────────────────────────────────────────────────────────────────
-- RLS: a user cannot update someone else's profile
-- ────────────────────────────────────────────────────────────────────

update public.profiles set display_name = 'Hacked' where id = '00000000-0000-0000-0000-00000000bbb2';

select results_eq(
  $$select display_name from public.profiles where id = '00000000-0000-0000-0000-00000000bbb2'$$,
  $$values ('Bob'::text)$$,
  'RLS silently filters UPDATE on rows the user does not own'
);

-- ────────────────────────────────────────────────────────────────────
-- Constraint: empty display_name rejected
-- ────────────────────────────────────────────────────────────────────

set local role postgres;

select throws_ok(
  $$update public.profiles set display_name = '' where id = '00000000-0000-0000-0000-00000000aaa1'$$,
  '23514',
  null,
  'empty display_name is rejected by check constraint'
);

-- ────────────────────────────────────────────────────────────────────
-- Constraint: malformed color rejected
-- ────────────────────────────────────────────────────────────────────

select throws_ok(
  $$update public.profiles set color = 'red' where id = '00000000-0000-0000-0000-00000000aaa1'$$,
  '23514',
  null,
  'non-hex color is rejected by check constraint'
);

select * from finish();
rollback;
