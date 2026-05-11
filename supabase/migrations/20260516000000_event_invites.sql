-- event_invites: per-(event, invitee) RSVP row. The host of an event
-- writes one row per friend they invite; the invitee then flips the
-- status to 'accepted' / 'declined' / 'maybe' (or leaves it 'pending'
-- if they don't respond).
--
-- Composite PK `(event_id, invitee_id)` mirrors the unique-pair shape
-- of `friendships(requester_id, addressee_id)` — same semantics
-- (at most one row per ordered pair) without a separate uniqueness
-- index.
--
-- ON DELETE CASCADE from `events`: deleting an event removes all its
-- invites cleanly so an old event can't leave orphaned invite rows.
--
-- The status enum reuses the same shape pattern as
-- `friendship_status` (pending / accepted / declined / + a non-binary
-- option). For invites, 'maybe' is the non-binary option: useful for
-- "I'll try" responses while still letting the host see who hasn't
-- firmly committed.
--
-- This migration also extends the events.SELECT policy to include
-- invitees (so an invited non-friend can still see the event they're
-- invited to). H1 left a hook for this in its comment; here's the
-- actual policy change.

create type public.event_invite_status as enum (
  'pending',
  'accepted',
  'declined',
  'maybe'
);

create table public.event_invites (
  event_id uuid not null
    references public.events(id) on delete cascade,
  invitee_id uuid not null
    references public.profiles(id) on delete cascade,
  status public.event_invite_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  primary key (event_id, invitee_id)
);

-- Prevent self-invites — the host implicitly attends every event they
-- create, so an "invite myself" row would double-count and complicate
-- the RSVP UI. Friendships uses a CHECK for the same idea
-- (`no_self_friend`) but Postgres CHECK constraints can only reference
-- columns of the row being checked, not other tables — so we use a
-- BEFORE INSERT trigger instead. Update is implicitly safe because
-- (event_id, invitee_id) is the PK and updating them isn't a
-- supported operation in the action layer.

create or replace function public.tg_event_invites_no_self_invite()
returns trigger
language plpgsql
as $$
begin
  if new.invitee_id = (select owner_id from public.events where id = new.event_id) then
    raise exception 'cannot invite the event''s own host as an attendee'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger event_invites_no_self_invite_trigger
  before insert on public.event_invites
  for each row
  execute function public.tg_event_invites_no_self_invite();

-- Hot query: "show me my pending invites" / "show me everyone
-- invited to this event".
create index event_invites_invitee_idx on public.event_invites(invitee_id);

create trigger event_invites_set_updated_at
  before update on public.event_invites
  for each row
  execute function public.tg_set_updated_at();

alter table public.event_invites enable row level security;

-- SELECT visibility on the invites themselves: the invitee can see
-- their own row; the host of the parent event can see ALL invites
-- on the events they own. This lets the RSVP screen and the host's
-- event-detail screen both work without exposing one user's invites
-- to unrelated parties.
create policy "users see invites they're part of"
  on public.event_invites
  for select
  to authenticated
  using (
    invitee_id = auth.uid()
    or exists (
      select 1 from public.events e
      where e.id = event_id and e.owner_id = auth.uid()
    )
  );

-- INSERT: only the host of the event can invite people, and only
-- with status='pending' (an invitee can't be pre-accepted by the host).
create policy "host can INSERT invites with status=pending"
  on public.event_invites
  for insert
  to authenticated
  with check (
    status = 'pending'
    and exists (
      select 1 from public.events e
      where e.id = event_id and e.owner_id = auth.uid()
    )
  );

-- UPDATE: only the invitee can change their own status. The host
-- can't accept/decline on their behalf — keeps the RSVP signal
-- meaningful (the answer always comes from the person attending).
create policy "invitee can UPDATE their own invite status"
  on public.event_invites
  for update
  to authenticated
  using (invitee_id = auth.uid())
  with check (invitee_id = auth.uid());

-- DELETE: the host can revoke an invite (uninvite someone), the
-- invitee can remove themselves entirely (different from declining
-- — "I'm not even going to see this on my list"). Either side can
-- delete.
create policy "host or invitee can DELETE an invite"
  on public.event_invites
  for delete
  to authenticated
  using (
    invitee_id = auth.uid()
    or exists (
      select 1 from public.events e
      where e.id = event_id and e.owner_id = auth.uid()
    )
  );

-- ────────────────────────────────────────────────────────────────────
-- Extend events.SELECT policy to include invitees
-- ────────────────────────────────────────────────────────────────────
-- H1 set up the SELECT policy as "owner + accepted friends" with a
-- comment that this would extend to "or invited" when event_invites
-- shipped. Do that now: drop the existing policy, recreate with the
-- additional invitee branch so non-friend invitees can see the event
-- they're invited to (otherwise the RSVP screen would be querying an
-- event row it can't read).

drop policy "users see their own events and accepted friends'"
  on public.events;

create policy "users see their own events, accepted friends', and ones they're invited to"
  on public.events
  for select
  to authenticated
  using (
    owner_id = auth.uid()
    or public.is_friend_of(owner_id)
    or exists (
      select 1 from public.event_invites i
      where i.event_id = events.id and i.invitee_id = auth.uid()
    )
  );
