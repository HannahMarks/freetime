-- Re-point `events.owner_id` foreign key from `auth.users(id)` to
-- `public.profiles(id)`.
--
-- WHY: PostgREST's embed syntax `owner:profiles!events_owner_id_fkey(...)`
-- only resolves when there's an FK NAMED `events_owner_id_fkey` between
-- `events` and `profiles`. The original `init_events` migration pointed
-- the FK at `auth.users` (mirroring how Postgres-typical FKs against
-- the auth schema look), which works for cascade deletes but DOESN'T
-- satisfy PostgREST's relationship discovery — so listEvents fails
-- with PGRST200 "Could not find a relationship between 'events' and
-- 'profiles'".
--
-- Pattern matches `busy_blocks.user_id → profiles(id)` (set up in the
-- original busy_time migration), so this just brings events into line
-- with how the rest of the schema models its user references.
--
-- CASCADE behaviour is unchanged: `profiles.id` is itself
-- `references auth.users(id) on delete cascade`, so deleting an auth
-- user still transitively removes their events. The chain is now
--   auth.users → profiles → events
-- instead of
--   auth.users → events.
--
-- We keep the constraint name `events_owner_id_fkey` so the existing
-- PostgREST embed hint in `event-actions.ts` continues to work without
-- a client change. (Postgres autogen would have produced the same name
-- anyway, but pinning it explicitly is safer.)

alter table public.events
  drop constraint events_owner_id_fkey;

alter table public.events
  add constraint events_owner_id_fkey
    foreign key (owner_id) references public.profiles(id) on delete cascade;
