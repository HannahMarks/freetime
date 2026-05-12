-- pgTAP tests for the `posts` table (Phase 4 P4a) — schema shape,
-- not-blank body, and RLS smoke (author + accepted-friend can SELECT;
-- unrelated user gets an empty result).

begin;

select plan(13);

-- ────────────────────────────────────────────────────────────────────
-- Schema shape
-- ────────────────────────────────────────────────────────────────────

select has_table('public', 'posts', 'posts table exists');
select has_column('public', 'posts', 'id', 'posts has id');
select has_column('public', 'posts', 'author_id', 'posts has author_id');
select has_column('public', 'posts', 'body', 'posts has body');
select has_column('public', 'posts', 'created_at', 'posts has created_at');
select col_not_null('public', 'posts', 'author_id', 'author_id NOT NULL');
select col_not_null('public', 'posts', 'body', 'body NOT NULL');
select is(
  (select relrowsecurity from pg_class where oid = 'public.posts'::regclass),
  true,
  'RLS enabled on posts'
);

-- ────────────────────────────────────────────────────────────────────
-- not-blank body CHECK
-- ────────────────────────────────────────────────────────────────────

set local role postgres;

insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, aud, role)
values
  ('00000000-0000-0000-0000-00000000006a', 'reno@example.test', '', now(),
   '{"display_name":"Reno","color":"#9C27B0"}'::jsonb, 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000006b', 'sage@example.test', '', now(),
   '{"display_name":"Sage","color":"#03A9F4"}'::jsonb, 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000006c', 'theo@example.test', '', now(),
   '{"display_name":"Theo","color":"#FF9800"}'::jsonb, 'authenticated', 'authenticated');

select throws_ok(
  $$insert into public.posts (author_id, body)
    values ('00000000-0000-0000-0000-00000000006a', '   ')$$,
  '23514',
  null,
  'blank body rejected by posts_body_not_blank check'
);

-- ────────────────────────────────────────────────────────────────────
-- RLS: author sees their own post; accepted friend sees it; unrelated
-- user gets nothing.
-- ────────────────────────────────────────────────────────────────────

-- Reno + Sage become accepted friends; Theo is unrelated.
insert into public.friendships (requester_id, addressee_id, status)
values
  ('00000000-0000-0000-0000-00000000006a',
   '00000000-0000-0000-0000-00000000006b', 'accepted');

-- Reno posts.
insert into public.posts (id, author_id, body)
values (
  '00000000-0000-0000-0000-0000000000bb',
  '00000000-0000-0000-0000-00000000006a',
  'Hello world'
);

-- As Reno (author).
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-00000000006a"}',
  true
);
select is(
  (select count(*)::int from public.posts where id = '00000000-0000-0000-0000-0000000000bb'),
  1,
  'author sees their own post'
);

-- As Sage (accepted friend).
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-00000000006b"}',
  true
);
select is(
  (select count(*)::int from public.posts where id = '00000000-0000-0000-0000-0000000000bb'),
  1,
  'accepted friend sees the post'
);

-- As Theo (unrelated).
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-00000000006c"}',
  true
);
select is(
  (select count(*)::int from public.posts where id = '00000000-0000-0000-0000-0000000000bb'),
  0,
  'unrelated user gets empty result set'
);

-- Sage cannot INSERT a post AS Reno (RLS forces author_id = auth.uid()).
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-00000000006b"}',
  true
);
select throws_ok(
  $$insert into public.posts (author_id, body)
    values ('00000000-0000-0000-0000-00000000006a', 'forged')$$,
  '42501',
  null,
  'cannot INSERT a post with a forged author_id'
);

select * from finish();
rollback;
