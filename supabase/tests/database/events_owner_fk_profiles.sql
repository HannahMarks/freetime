-- pgTAP tests for the FK re-point in
-- 20260518000000_events_owner_fk_profiles.sql.
--
-- Goals:
--   1. The FK on `events.owner_id` now references `profiles(id)`
--      (matching `busy_blocks.user_id`'s pattern). This is what
--      PostgREST needs to satisfy the
--      `owner:profiles!events_owner_id_fkey(...)` embed in listEvents.
--   2. The cascade behaviour still works end-to-end: deleting an
--      auth.users row removes the profile (existing FK cascade), which
--      in turn removes the user's events via the new FK cascade.

begin;

select plan(5);

-- ────────────────────────────────────────────────────────────────────
-- FK shape
-- ────────────────────────────────────────────────────────────────────

select fk_ok(
  'public', 'events', 'owner_id',
  'public', 'profiles', 'id',
  'events.owner_id now references profiles(id)'
);

-- The FK constraint name is exactly `events_owner_id_fkey` so the
-- PostgREST embed hint in event-actions.ts (`owner:profiles!events_owner_id_fkey`)
-- continues to resolve. Pinning the name here lets us catch an
-- accidental rename in any future migration.
select has_fk(
  'public', 'events',
  'events has a foreign key on owner_id'
);

select is(
  (select conname from pg_constraint
   where conrelid = 'public.events'::regclass
     and contype = 'f'
     and conkey = array[
       (select attnum from pg_attribute
        where attrelid = 'public.events'::regclass and attname = 'owner_id')
     ]),
  'events_owner_id_fkey',
  'FK constraint named events_owner_id_fkey (PostgREST embed hint relies on this)'
);

-- ────────────────────────────────────────────────────────────────────
-- Cascade behaviour: auth.users → profiles → events
-- ────────────────────────────────────────────────────────────────────

set local role postgres;

-- 12-char hex UUID tail to avoid the non-hex-char trap that bit earlier
-- pgTAP files (h/g aren't valid hex).
insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, aud, role)
values
  ('00000000-0000-0000-0000-00000000001a', 'erin@example.test', '', now(),
   '{"display_name":"Erin","color":"#4ECDC4"}'::jsonb, 'authenticated', 'authenticated');

insert into public.events (owner_id, title, starts_at, ends_at)
values (
  '00000000-0000-0000-0000-00000000001a',
  'Will be cascade-deleted',
  now() + interval '1 day',
  now() + interval '1 day 1 hour'
);

select is(
  (select count(*)::int from public.events
   where owner_id = '00000000-0000-0000-0000-00000000001a'),
  1,
  'event row exists before user delete'
);

delete from auth.users where id = '00000000-0000-0000-0000-00000000001a';

select is(
  (select count(*)::int from public.events
   where owner_id = '00000000-0000-0000-0000-00000000001a'),
  0,
  'event row removed via auth.users → profiles → events cascade chain'
);

select * from finish();
rollback;
