-- pgTAP tests for the `comments` table (Phase 4 P4c) — schema
-- shape, not-blank body, is_post_visible helper, and RLS smoke.

begin;

select plan(13);

-- ────────────────────────────────────────────────────────────────────
-- Schema shape
-- ────────────────────────────────────────────────────────────────────

select has_table('public', 'comments', 'comments table exists');
select has_column('public', 'comments', 'post_id', 'comments has post_id');
select has_column('public', 'comments', 'author_id', 'comments has author_id');
select has_column('public', 'comments', 'body', 'comments has body');
select is(
  (select relrowsecurity from pg_class where oid = 'public.comments'::regclass),
  true,
  'RLS enabled on comments'
);

-- Helper is SECURITY DEFINER so it bypasses posts RLS (same pattern
-- locked in by #67's post-mortem).
select is(
  (select prosecdef from pg_proc
   where proname = 'is_post_visible' and pronamespace = 'public'::regnamespace),
  true,
  'is_post_visible is SECURITY DEFINER'
);

-- ────────────────────────────────────────────────────────────────────
-- Setup: post author + accepted-friend + unrelated user
-- ────────────────────────────────────────────────────────────────────

set local role postgres;

insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, aud, role)
values
  ('00000000-0000-0000-0000-00000000007a', 'una@example.test', '', now(),
   '{"display_name":"Una","color":"#9C27B0"}'::jsonb, 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000007b', 'vic@example.test', '', now(),
   '{"display_name":"Vic","color":"#03A9F4"}'::jsonb, 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000007c', 'wes@example.test', '', now(),
   '{"display_name":"Wes","color":"#FF9800"}'::jsonb, 'authenticated', 'authenticated');

insert into public.friendships (requester_id, addressee_id, status)
values
  ('00000000-0000-0000-0000-00000000007a',
   '00000000-0000-0000-0000-00000000007b', 'accepted');

insert into public.posts (id, author_id, body)
values (
  '00000000-0000-0000-0000-00000000aabb',
  '00000000-0000-0000-0000-00000000007a',
  'Hello world'
);

-- ────────────────────────────────────────────────────────────────────
-- is_post_visible semantics
-- ────────────────────────────────────────────────────────────────────

set local role authenticated;

-- As Una (author).
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-00000000007a"}',
  true
);
select is(
  public.is_post_visible('00000000-0000-0000-0000-00000000aabb'),
  true,
  'author of a post can see it'
);

-- As Vic (accepted friend).
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-00000000007b"}',
  true
);
select is(
  public.is_post_visible('00000000-0000-0000-0000-00000000aabb'),
  true,
  'accepted friend can see the post'
);

-- As Wes (unrelated).
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-00000000007c"}',
  true
);
select is(
  public.is_post_visible('00000000-0000-0000-0000-00000000aabb'),
  false,
  'unrelated user cannot see the post'
);

-- ────────────────────────────────────────────────────────────────────
-- INSERT + SELECT gates
-- ────────────────────────────────────────────────────────────────────

-- Vic can comment on Una's post (visible to him).
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-00000000007b"}',
  true
);
select lives_ok(
  $$insert into public.comments (post_id, author_id, body)
    values ('00000000-0000-0000-0000-00000000aabb',
            '00000000-0000-0000-0000-00000000007b',
            'Nice post')$$,
  'accepted friend can comment on a visible post'
);

-- Wes cannot comment (post not visible to him).
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-00000000007c"}',
  true
);
select throws_ok(
  $$insert into public.comments (post_id, author_id, body)
    values ('00000000-0000-0000-0000-00000000aabb',
            '00000000-0000-0000-0000-00000000007c',
            'Sneaky')$$,
  '42501',
  null,
  'unrelated user CANNOT comment on an invisible post'
);

-- Vic cannot forge an author_id (Una's) on his own comment.
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-00000000007b"}',
  true
);
select throws_ok(
  $$insert into public.comments (post_id, author_id, body)
    values ('00000000-0000-0000-0000-00000000aabb',
            '00000000-0000-0000-0000-00000000007a',
            'Forged')$$,
  '42501',
  null,
  'cannot INSERT a comment with a forged author_id'
);

-- Wes sees zero comments (post is hidden from him).
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-00000000007c"}',
  true
);
select is(
  (select count(*)::int from public.comments
   where post_id = '00000000-0000-0000-0000-00000000aabb'),
  0,
  'unrelated user gets empty comments result set'
);

select * from finish();
rollback;
