-- Events — Phase 2 kicks off here. An event is a host-organized
-- gathering: a time, a place, an optional title/notes, and (in a
-- follow-up PR) a list of invited friends with RSVPs.
--
-- This first migration lands ONLY the host's side: the `events` table
-- + RLS. `event_invites` and the RSVP machinery arrive in a later
-- migration so each piece ships independently and the schema stays
-- legible.
--
-- Visibility (RLS): for now, an event is visible to its owner and to
-- accepted friends of the owner. Once `event_invites` lands, the
-- SELECT policy will extend to "or invited as an attendee" so non-
-- friend invitees can still see events they're invited to.
--
-- Structure mirrors `busy_blocks` deliberately — same time-range
-- shape, same not-blank constraints on title/notes/location, same
-- index pattern on (owner, starts_at), same updated_at trigger. The
-- table is separate from busy_blocks (rather than reusing it) because
-- events have a different lifecycle: they can be cancelled, they have
-- attendees, and accepting an invite (in a later PR) will auto-create
-- a busy_block on the invitee's side — those are two different rows
-- with different ownership semantics.

create table public.events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  notes text,
  location text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint events_valid_range check (ends_at > starts_at),
  constraint events_title_not_blank check (
    title is null or length(trim(title)) > 0
  ),
  constraint events_notes_not_blank check (
    notes is null or length(trim(notes)) > 0
  ),
  constraint events_location_not_blank check (
    location is null or length(trim(location)) > 0
  )
);

-- Hot query: "all events owned by X starting after T".
create index events_owner_starts_idx
  on public.events (owner_id, starts_at);

create trigger events_set_updated_at
  before update on public.events
  for each row
  execute function public.tg_set_updated_at();

alter table public.events enable row level security;

-- Visibility: owner + accepted friends. Will extend to "or invited"
-- once event_invites ships.
create policy "users see their own events and accepted friends'"
  on public.events
  for select
  to authenticated
  using (owner_id = auth.uid() or public.is_friend_of(owner_id));

create policy "users can INSERT only their own events"
  on public.events
  for insert
  to authenticated
  with check (owner_id = auth.uid());

create policy "users can UPDATE only their own events"
  on public.events
  for update
  to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy "users can DELETE only their own events"
  on public.events
  for delete
  to authenticated
  using (owner_id = auth.uid());
