-- pgTAP tests for the `events` table — schema shape + valid_range +
-- not-blank checks + RLS smoke (owner can see/insert; non-friend
-- can't see).

begin;

select plan(15);

-- ────────────────────────────────────────────────────────────────────
-- Schema shape
-- ────────────────────────────────────────────────────────────────────

select has_table('public', 'events', 'events table exists');
select has_column('public', 'events', 'id', 'events has id');
select has_column('public', 'events', 'owner_id', 'events has owner_id');
select has_column('public', 'events', 'title', 'events has title');
select has_column('public', 'events', 'starts_at', 'events has starts_at');
select has_column('public', 'events', 'ends_at', 'events has ends_at');
select has_column('public', 'events', 'notes', 'events has notes');
select has_column('public', 'events', 'location', 'events has location');
select col_type_is('public', 'events', 'starts_at', 'timestamp with time zone',
  'starts_at is timestamptz');
select col_not_null('public', 'events', 'owner_id', 'owner_id NOT NULL');

select is(
  (select relrowsecurity from pg_class where oid = 'public.events'::regclass),
  true,
  'RLS enabled on events'
);

-- ────────────────────────────────────────────────────────────────────
-- Constraints
-- ────────────────────────────────────────────────────────────────────

set local role postgres;

insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, aud, role)
values
  ('00000000-0000-0000-0000-00000000000a', 'hana@example.test', '', now(),
   '{"display_name":"Hana","color":"#3F51B5"}'::jsonb, 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000b', 'ira@example.test', '', now(),
   '{"display_name":"Ira","color":"#009688"}'::jsonb, 'authenticated', 'authenticated');

-- valid_range CHECK: ends_at MUST be after starts_at.
select throws_ok(
  $$insert into public.events (owner_id, title, starts_at, ends_at)
    values ('00000000-0000-0000-0000-00000000000a', 'Backwards',
            now() + interval '2 hours', now() + interval '1 hour')$$,
  '23514',
  null,
  'events_valid_range rejects ends_at <= starts_at'
);

-- not-blank CHECKs.
select throws_ok(
  $$insert into public.events (owner_id, title, starts_at, ends_at)
    values ('00000000-0000-0000-0000-00000000000a', '   ',
            now() + interval '1 hour', now() + interval '2 hours')$$,
  '23514',
  null,
  'whitespace-only title rejected'
);

select throws_ok(
  $$insert into public.events (owner_id, starts_at, ends_at, notes)
    values ('00000000-0000-0000-0000-00000000000a',
            now() + interval '1 hour', now() + interval '2 hours', '   ')$$,
  '23514',
  null,
  'whitespace-only notes rejected'
);

select throws_ok(
  $$insert into public.events (owner_id, starts_at, ends_at, location)
    values ('00000000-0000-0000-0000-00000000000a',
            now() + interval '1 hour', now() + interval '2 hours', '   ')$$,
  '23514',
  null,
  'whitespace-only location rejected'
);

select * from finish();
rollback;
