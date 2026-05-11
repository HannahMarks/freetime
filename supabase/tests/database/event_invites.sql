-- pgTAP tests for `event_invites` + the events.SELECT policy extension
-- shipped alongside in 20260516000000.

begin;

select plan(12);

-- ────────────────────────────────────────────────────────────────────
-- Schema shape
-- ────────────────────────────────────────────────────────────────────

select has_table('public', 'event_invites', 'event_invites table exists');
select has_column('public', 'event_invites', 'event_id', 'has event_id');
select has_column('public', 'event_invites', 'invitee_id', 'has invitee_id');
select has_column('public', 'event_invites', 'status', 'has status');
select col_is_pk(
  'public', 'event_invites', ARRAY['event_id', 'invitee_id'],
  '(event_id, invitee_id) is the PK'
);
select is(
  (select relrowsecurity from pg_class where oid = 'public.event_invites'::regclass),
  true,
  'RLS enabled on event_invites'
);

-- Enum exists with the four expected values.
select has_type('public', 'event_invite_status', 'event_invite_status type exists');
select enum_has_labels(
  'public', 'event_invite_status',
  ARRAY['pending', 'accepted', 'declined', 'maybe'],
  'enum has pending / accepted / declined / maybe'
);

-- ────────────────────────────────────────────────────────────────────
-- Setup users + an event
-- ────────────────────────────────────────────────────────────────────

set local role postgres;

insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, aud, role)
values
  ('00000000-0000-0000-0000-00000000000d', 'iris@example.test', '', now(),
   '{"display_name":"Iris","color":"#3F51B5"}'::jsonb, 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000e', 'jay@example.test', '', now(),
   '{"display_name":"Jay","color":"#009688"}'::jsonb, 'authenticated', 'authenticated');

-- Iris hosts an event.
insert into public.events (id, owner_id, title, starts_at, ends_at)
values (
  '00000000-0000-0000-0000-0000000000e1',
  '00000000-0000-0000-0000-00000000000d',
  'Iris''s party',
  now() + interval '5 days',
  now() + interval '5 days 3 hours'
);

-- ────────────────────────────────────────────────────────────────────
-- Self-invite trigger
-- ────────────────────────────────────────────────────────────────────

select throws_ok(
  $$insert into public.event_invites (event_id, invitee_id)
    values ('00000000-0000-0000-0000-0000000000e1',
            '00000000-0000-0000-0000-00000000000d')$$,
  '23514',
  null,
  'self-invite (invitee_id = event.owner_id) rejected by trigger'
);

-- ────────────────────────────────────────────────────────────────────
-- Valid invite path
-- ────────────────────────────────────────────────────────────────────

select lives_ok(
  $$insert into public.event_invites (event_id, invitee_id)
    values ('00000000-0000-0000-0000-0000000000e1',
            '00000000-0000-0000-0000-00000000000e')$$,
  'inviting a different user accepted'
);

-- Default status is 'pending'.
select is(
  (select status::text from public.event_invites
   where event_id = '00000000-0000-0000-0000-0000000000e1'
     and invitee_id = '00000000-0000-0000-0000-00000000000e'),
  'pending',
  'inserted invite defaults to status=pending'
);

-- ────────────────────────────────────────────────────────────────────
-- Composite PK: duplicate (event, invitee) rejected
-- ────────────────────────────────────────────────────────────────────

select throws_ok(
  $$insert into public.event_invites (event_id, invitee_id)
    values ('00000000-0000-0000-0000-0000000000e1',
            '00000000-0000-0000-0000-00000000000e')$$,
  '23505',
  null,
  'duplicate (event_id, invitee_id) rejected by PK'
);

-- ────────────────────────────────────────────────────────────────────
-- ON DELETE CASCADE: deleting the parent event removes invites
-- ────────────────────────────────────────────────────────────────────

delete from public.events where id = '00000000-0000-0000-0000-0000000000e1';

select is(
  (select count(*)::int from public.event_invites
   where event_id = '00000000-0000-0000-0000-0000000000e1'),
  0,
  'deleting the parent event cascades to its invites'
);

select * from finish();
rollback;
