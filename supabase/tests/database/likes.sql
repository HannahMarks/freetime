-- pgTAP tests for the `likes` table (Phase 4 P4d) — schema shape,
-- composite PK enforces one-per-pair, RLS smoke.

begin;

select plan(11);

-- ────────────────────────────────────────────────────────────────────
-- Schema shape
-- ────────────────────────────────────────────────────────────────────

select has_table('public', 'likes', 'likes table exists');
select has_column('public', 'likes', 'post_id', 'likes has post_id');
select has_column('public', 'likes', 'liker_id', 'likes has liker_id');
select col_is_pk(
  'public', 'likes', ARRAY['post_id', 'liker_id'],
  '(post_id, liker_id) is the PK (one-per-pair)'
);
select is(
  (select relrowsecurity from pg_class where oid = 'public.likes'::regclass),
  true,
  'RLS enabled on likes'
);

-- ────────────────────────────────────────────────────────────────────
-- Setup: post author + accepted-friend + unrelated user
-- ────────────────────────────────────────────────────────────────────

set local role postgres;

insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, aud, role)
values
  ('00000000-0000-0000-0000-00000000008a', 'xan@example.test', '', now(),
   '{"display_name":"Xan","color":"#9C27B0"}'::jsonb, 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000008b', 'yara@example.test', '', now(),
   '{"display_name":"Yara","color":"#03A9F4"}'::jsonb, 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000008c', 'zane@example.test', '', now(),
   '{"display_name":"Zane","color":"#FF9800"}'::jsonb, 'authenticated', 'authenticated');

insert into public.friendships (requester_id, addressee_id, status)
values
  ('00000000-0000-0000-0000-00000000008a',
   '00000000-0000-0000-0000-00000000008b', 'accepted');

insert into public.posts (id, author_id, body)
values (
  '00000000-0000-0000-0000-00000000ccdd',
  '00000000-0000-0000-0000-00000000008a',
  'Like this please'
);

-- ────────────────────────────────────────────────────────────────────
-- RLS: visible friend can like + see likes; unrelated cannot; the
-- composite PK rejects a double-like.
-- ────────────────────────────────────────────────────────────────────

set local role authenticated;

-- Yara (friend) can like.
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-00000000008b"}',
  true
);
select lives_ok(
  $$insert into public.likes (post_id, liker_id)
    values ('00000000-0000-0000-0000-00000000ccdd',
            '00000000-0000-0000-0000-00000000008b')$$,
  'accepted friend can like a visible post'
);

-- A second insert by the same (post_id, liker_id) is rejected by the
-- composite PK — schema-level "one heart per pair" guarantee.
select throws_ok(
  $$insert into public.likes (post_id, liker_id)
    values ('00000000-0000-0000-0000-00000000ccdd',
            '00000000-0000-0000-0000-00000000008b')$$,
  '23505',
  null,
  'composite PK rejects a duplicate like from the same user'
);

-- Zane (unrelated) cannot like the post (RLS denies INSERT).
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-00000000008c"}',
  true
);
select throws_ok(
  $$insert into public.likes (post_id, liker_id)
    values ('00000000-0000-0000-0000-00000000ccdd',
            '00000000-0000-0000-0000-00000000008c')$$,
  '42501',
  null,
  'unrelated user CANNOT like a post they can''t see'
);

-- Forged liker_id rejected even when the post is visible.
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-00000000008b"}',
  true
);
select throws_ok(
  $$insert into public.likes (post_id, liker_id)
    values ('00000000-0000-0000-0000-00000000ccdd',
            '00000000-0000-0000-0000-00000000008a')$$,
  '42501',
  null,
  'cannot INSERT a like with a forged liker_id'
);

-- Zane sees zero likes (post hidden from him → likes hidden too).
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-00000000008c"}',
  true
);
select is(
  (select count(*)::int from public.likes
   where post_id = '00000000-0000-0000-0000-00000000ccdd'),
  0,
  'unrelated user gets empty likes result set'
);

-- Yara can unlike (delete her own row).
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-00000000008b"}',
  true
);
select lives_ok(
  $$delete from public.likes
    where post_id = '00000000-0000-0000-0000-00000000ccdd'
      and liker_id = '00000000-0000-0000-0000-00000000008b'$$,
  'liker can DELETE their own like'
);

select * from finish();
rollback;
