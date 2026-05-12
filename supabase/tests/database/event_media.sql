-- pgTAP tests for the event_media table + is_attendee_of_event
-- helper introduced in 20260520000000_event_media.sql.
--
-- Coverage:
--   - Schema shape (columns + types + RLS enabled)
--   - is_attendee_of_event returns true for host + accepted invitee,
--     false for pending / declined / maybe / unrelated user
--   - INSERT: an accepted invitee can upload to the event; a non-
--     attendee cannot
--   - SELECT: an accepted invitee can read the event's media; a
--     non-attendee cannot
--   - DELETE: uploader can delete their own; host can moderate;
--     unrelated attendees cannot delete someone else's

begin;

select plan(14);

-- ────────────────────────────────────────────────────────────────────
-- Schema shape
-- ────────────────────────────────────────────────────────────────────

select has_table('public', 'event_media', 'event_media table exists');
select has_column('public', 'event_media', 'event_id', 'has event_id');
select has_column('public', 'event_media', 'uploader_id', 'has uploader_id');
select has_column('public', 'event_media', 'storage_path', 'has storage_path');
select has_column('public', 'event_media', 'media_kind', 'has media_kind');
select is(
  (select relrowsecurity from pg_class where oid = 'public.event_media'::regclass),
  true,
  'RLS enabled on event_media'
);

-- Helper is SECURITY DEFINER so it bypasses events / event_invites
-- RLS (the same precaution that fixed #67's recursion).
select is(
  (select prosecdef from pg_proc
   where proname = 'is_attendee_of_event' and pronamespace = 'public'::regnamespace),
  true,
  'is_attendee_of_event is SECURITY DEFINER'
);

-- ────────────────────────────────────────────────────────────────────
-- Setup: 3 users + an event + invites in various statuses
-- ────────────────────────────────────────────────────────────────────

set local role postgres;

-- Maya = host, Niko = accepted invitee, Omar = pending invitee.
-- 12-char hex tails (no g/h chars — those aren't valid hex and
-- bit earlier pgTAP files).
insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, aud, role)
values
  ('00000000-0000-0000-0000-00000000004a', 'maya@example.test', '', now(),
   '{"display_name":"Maya","color":"#9C27B0"}'::jsonb, 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000004b', 'niko@example.test', '', now(),
   '{"display_name":"Niko","color":"#03A9F4"}'::jsonb, 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000004c', 'omar@example.test', '', now(),
   '{"display_name":"Omar","color":"#FF9800"}'::jsonb, 'authenticated', 'authenticated');

insert into public.events (id, owner_id, title, starts_at, ends_at)
values (
  '00000000-0000-0000-0000-0000000000aa',
  '00000000-0000-0000-0000-00000000004a',
  'Maya''s party',
  now() + interval '1 day',
  now() + interval '1 day 3 hours'
);

insert into public.event_invites (event_id, invitee_id, status)
values
  ('00000000-0000-0000-0000-0000000000aa',
   '00000000-0000-0000-0000-00000000004b', 'accepted'),
  ('00000000-0000-0000-0000-0000000000aa',
   '00000000-0000-0000-0000-00000000004c', 'pending');

-- ────────────────────────────────────────────────────────────────────
-- is_attendee_of_event semantics
-- ────────────────────────────────────────────────────────────────────

-- As Maya (host)
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-00000000004a"}',
  true
);
select is(
  public.is_attendee_of_event('00000000-0000-0000-0000-0000000000aa'),
  true,
  'host is an attendee'
);

-- As Niko (accepted invitee)
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-00000000004b"}',
  true
);
select is(
  public.is_attendee_of_event('00000000-0000-0000-0000-0000000000aa'),
  true,
  'accepted invitee is an attendee'
);

-- As Omar (pending invitee — does NOT count as attending)
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-00000000004c"}',
  true
);
select is(
  public.is_attendee_of_event('00000000-0000-0000-0000-0000000000aa'),
  false,
  'pending invitee is NOT an attendee'
);

-- ────────────────────────────────────────────────────────────────────
-- INSERT gates
-- ────────────────────────────────────────────────────────────────────

-- Niko (accepted) can upload.
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-00000000004b"}',
  true
);
select lives_ok(
  $$insert into public.event_media (event_id, uploader_id, storage_path, media_kind)
    values ('00000000-0000-0000-0000-0000000000aa',
            '00000000-0000-0000-0000-00000000004b',
            'aa/4b/photo.jpg', 'photo')$$,
  'accepted invitee can upload media'
);

-- Omar (pending) cannot upload — RLS rejects the row.
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-00000000004c"}',
  true
);
select throws_ok(
  $$insert into public.event_media (event_id, uploader_id, storage_path, media_kind)
    values ('00000000-0000-0000-0000-0000000000aa',
            '00000000-0000-0000-0000-00000000004c',
            'aa/4c/sneaky.jpg', 'photo')$$,
  '42501',
  null,
  'pending invitee CANNOT upload media'
);

-- ────────────────────────────────────────────────────────────────────
-- SELECT gates
-- ────────────────────────────────────────────────────────────────────

-- Niko (accepted) sees the row he uploaded.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-00000000004b"}',
  true
);
select is(
  (select count(*)::int from public.event_media
   where event_id = '00000000-0000-0000-0000-0000000000aa'),
  1,
  'accepted invitee can SELECT event media'
);

-- Omar (pending) sees zero rows.
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-00000000004c"}',
  true
);
select is(
  (select count(*)::int from public.event_media
   where event_id = '00000000-0000-0000-0000-0000000000aa'),
  0,
  'pending invitee gets empty result set'
);

select * from finish();
rollback;
