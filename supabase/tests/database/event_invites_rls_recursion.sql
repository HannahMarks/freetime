-- pgTAP tests for the RLS-recursion fix in
-- 20260519000000_event_invites_rls_recursion.sql.
--
-- Goals:
--   1. The two SECURITY DEFINER helpers exist with the right
--      `security definer` flag (so they bypass RLS as intended).
--   2. The policies still gate access correctly:
--      - invitee can SELECT their own invite row
--      - host can SELECT all invite rows on their events
--      - invitee can SELECT the event they're invited to
--   3. Doing the listEvents-style SELECT (events with embedded
--      event_invites filter) no longer raises 42P17 "infinite
--      recursion detected in policy". This is the regression
--      this PR exists to prevent.

begin;

select plan(7);

-- ────────────────────────────────────────────────────────────────────
-- Helper functions exist + are SECURITY DEFINER
-- ────────────────────────────────────────────────────────────────────

select has_function('public', 'is_owner_of_event', ARRAY['uuid'],
  'is_owner_of_event(uuid) helper exists');
select has_function('public', 'is_invited_to', ARRAY['uuid'],
  'is_invited_to(uuid) helper exists');

-- prosecdef is true iff the function is SECURITY DEFINER. We need
-- BOTH helpers to bypass RLS — that's the whole point of the fix.
select is(
  (select prosecdef from pg_proc
   where proname = 'is_owner_of_event' and pronamespace = 'public'::regnamespace),
  true,
  'is_owner_of_event is SECURITY DEFINER'
);
select is(
  (select prosecdef from pg_proc
   where proname = 'is_invited_to' and pronamespace = 'public'::regnamespace),
  true,
  'is_invited_to is SECURITY DEFINER'
);

-- ────────────────────────────────────────────────────────────────────
-- End-to-end: a host + invitee + the listEvents-style cross-table
-- read does NOT recurse
-- ────────────────────────────────────────────────────────────────────

set local role postgres;

insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, aud, role)
values
  ('00000000-0000-0000-0000-00000000002a', 'kira@example.test', '', now(),
   '{"display_name":"Kira","color":"#9C27B0"}'::jsonb, 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000002b', 'leo@example.test', '', now(),
   '{"display_name":"Leo","color":"#03A9F4"}'::jsonb, 'authenticated', 'authenticated');

-- Kira hosts; Leo is invited (no friendship between them — so the
-- invitee branch of events.SELECT is what should grant Leo visibility).
insert into public.events (id, owner_id, title, starts_at, ends_at)
values (
  '00000000-0000-0000-0000-0000000000ee',
  '00000000-0000-0000-0000-00000000002a',
  'Kira''s housewarming',
  now() + interval '1 day',
  now() + interval '1 day 3 hours'
);

insert into public.event_invites (event_id, invitee_id, status)
values (
  '00000000-0000-0000-0000-0000000000ee',
  '00000000-0000-0000-0000-00000000002b',
  'pending'
);

-- Switch to Leo (the invitee). This is the role where the recursion
-- used to fire: listEvents → events.SELECT consults event_invites,
-- which consults events, which consults event_invites...
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-00000000002b"}',
  true
);

-- The actual regression check. With the old policies this same
-- query raised 42P17. `lives_ok` wraps the query in a try/catch and
-- passes only if it returns cleanly. Mirrors PostgREST's listEvents
-- shape — a SELECT on events joined to event_invites — so a future
-- accidental re-introduction of the cycle would fail this assertion.
select lives_ok(
  $$select e.id
    from public.events e
    left join public.event_invites i on i.event_id = e.id
    where e.id = '00000000-0000-0000-0000-0000000000ee'$$,
  'listEvents-style cross-join no longer raises 42P17'
);

-- Leo should now see the event (via the invitee branch) without
-- throwing.
select is(
  (select count(*)::int from public.events
   where id = '00000000-0000-0000-0000-0000000000ee'),
  1,
  'invitee can see the event they''re invited to (no recursion)'
);

-- And Leo should see their own invite row (via invitee_id =
-- auth.uid()).
select is(
  (select count(*)::int from public.event_invites
   where event_id = '00000000-0000-0000-0000-0000000000ee'
     and invitee_id = '00000000-0000-0000-0000-00000000002b'),
  1,
  'invitee can see their own invite row'
);

select * from finish();
rollback;
