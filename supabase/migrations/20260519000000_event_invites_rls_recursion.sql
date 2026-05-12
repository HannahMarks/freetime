-- Break the RLS recursion between `events.SELECT` and `event_invites`
-- policies.
--
-- WHY:
--   - `events.SELECT` (extended in 20260516000000) had:
--       OR exists (select 1 from event_invites
--                  where event_id = events.id and invitee_id = auth.uid())
--   - `event_invites.{SELECT,INSERT,DELETE}` each had:
--       OR exists (select 1 from events
--                  where id = event_id and owner_id = auth.uid())
--
-- Each policy's cross-table EXISTS triggers RLS on the OTHER table,
-- whose policy then queries this one — Postgres detects the loop and
-- aborts with 42P17 ("infinite recursion detected in policy for
-- relation \"event_invites\"").
--
-- The bug was latent since H3 (the events.SELECT extension landed in
-- 20260516000000), but stayed masked because the events.owner_id FK
-- pointed at auth.users instead of profiles — PostgREST short-
-- circuited with PGRST200 before evaluating the embed. PR #66's FK
-- repair made the embed runnable; now listEvents triggers the
-- recursion.
--
-- FIX: same pattern as `is_friend_of` in init_busy_time. Introduce
-- two SECURITY DEFINER helpers that bypass RLS for the cross-table
-- check, then rebuild every policy that used the cross-table EXISTS
-- to use the helper instead. The helpers still pin one party to
-- auth.uid() so they can only answer "yes" for relationships the
-- caller is actually part of — same safety guarantee as
-- is_friend_of.

-- ────────────────────────────────────────────────────────────────────
-- Helpers
-- ────────────────────────────────────────────────────────────────────

create or replace function public.is_owner_of_event(event_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.events
    where id = is_owner_of_event.event_id
      and owner_id = auth.uid()
  );
$$;

comment on function public.is_owner_of_event(uuid) is
  'True iff the calling user owns (hosts) the given event. SECURITY DEFINER bypasses events RLS so event_invites policies can reference it without triggering RLS recursion.';

create or replace function public.is_invited_to(event_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.event_invites
    where event_invites.event_id = is_invited_to.event_id
      and invitee_id = auth.uid()
  );
$$;

comment on function public.is_invited_to(uuid) is
  'True iff the calling user has an invite row for the given event (any status). SECURITY DEFINER bypasses event_invites RLS so events.SELECT can reference it without triggering RLS recursion.';

-- ────────────────────────────────────────────────────────────────────
-- Rebuild events.SELECT using is_invited_to
-- ────────────────────────────────────────────────────────────────────

drop policy "users see their own events, accepted friends', and ones they're invited to"
  on public.events;

create policy "users see their own events, accepted friends', and ones they're invited to"
  on public.events
  for select
  to authenticated
  using (
    owner_id = auth.uid()
    or public.is_friend_of(owner_id)
    or public.is_invited_to(id)
  );

-- ────────────────────────────────────────────────────────────────────
-- Rebuild event_invites policies using is_owner_of_event
-- ────────────────────────────────────────────────────────────────────

drop policy "users see invites they're part of" on public.event_invites;

create policy "users see invites they're part of"
  on public.event_invites
  for select
  to authenticated
  using (
    invitee_id = auth.uid()
    or public.is_owner_of_event(event_id)
  );

drop policy "host can INSERT invites with status=pending" on public.event_invites;

create policy "host can INSERT invites with status=pending"
  on public.event_invites
  for insert
  to authenticated
  with check (
    status = 'pending'
    and public.is_owner_of_event(event_id)
  );

drop policy "host or invitee can DELETE an invite" on public.event_invites;

create policy "host or invitee can DELETE an invite"
  on public.event_invites
  for delete
  to authenticated
  using (
    invitee_id = auth.uid()
    or public.is_owner_of_event(event_id)
  );

-- The UPDATE policy on event_invites only references invitee_id =
-- auth.uid() (no cross-table EXISTS) — already cycle-free, no
-- rebuild needed.
