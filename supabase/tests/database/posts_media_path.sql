-- pgTAP tests for the media_path column added in
-- 20260526000000_posts_media_path.sql. Confirms the column shape +
-- the widened body-or-media CHECK semantics.

begin;

select plan(7);

-- ────────────────────────────────────────────────────────────────────
-- Schema shape
-- ────────────────────────────────────────────────────────────────────

select has_column('public', 'posts', 'media_path', 'posts has media_path');
select col_type_is('public', 'posts', 'media_path', 'text', 'media_path is text');
select col_is_null('public', 'posts', 'media_path', 'media_path is nullable');

-- ────────────────────────────────────────────────────────────────────
-- Body OR media required (widened from body-only).
-- ────────────────────────────────────────────────────────────────────

set local role postgres;

insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, aud, role)
values
  ('00000000-0000-0000-0000-00000000009a', 'ari@example.test', '', now(),
   '{"display_name":"Ari","color":"#9C27B0"}'::jsonb, 'authenticated', 'authenticated');

-- Body-only post still allowed (regression check for the
-- existing P4a behavior).
select lives_ok(
  $$insert into public.posts (author_id, body)
    values ('00000000-0000-0000-0000-00000000009a', 'Just text')$$,
  'body-only post still allowed after widening'
);

-- Media-only post now allowed (the new affordance).
select lives_ok(
  $$insert into public.posts (author_id, media_path)
    values ('00000000-0000-0000-0000-00000000009a',
            '00000000-0000-0000-0000-00000000009a/p1/photo.jpg')$$,
  'media-only post (no body) now allowed'
);

-- Both body + media is fine.
select lives_ok(
  $$insert into public.posts (author_id, body, media_path)
    values ('00000000-0000-0000-0000-00000000009a',
            'Caption',
            '00000000-0000-0000-0000-00000000009a/p2/photo.jpg')$$,
  'body + media post allowed'
);

-- Neither body nor media is rejected — must supply at least one.
select throws_ok(
  $$insert into public.posts (author_id) values ('00000000-0000-0000-0000-00000000009a')$$,
  '23514',
  null,
  'posts_body_or_media_required rejects body=null + media_path=null'
);

select * from finish();
rollback;
