-- availability_blocks: each row is a *free* time range owned by one user.
-- Absence of any rows for a day means "not free" (no explicit busy marker
-- needed for the MVP). Storage is timestamptz so cross-timezone friends
-- read the same wall-clock from their own zones.

-- ────────────────────────────────────────────────────────────────────
-- Helper: is_friend_of(other_id)
-- ────────────────────────────────────────────────────────────────────
-- SECURITY DEFINER so RLS on `friendships` doesn't filter out the lookup
-- (the policy on friendships restricts SELECT to the two parties of a row;
-- the function still asserts the caller is one of those parties via
-- auth.uid() in the predicate, so this is not an escalation).

create or replace function public.is_friend_of(other_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.friendships
    where status = 'accepted'
      and (
        (requester_id = auth.uid() and addressee_id = other_id) or
        (requester_id = other_id and addressee_id = auth.uid())
      )
  );
$$;

comment on function public.is_friend_of(uuid) is
  'True iff the calling user has an accepted bidirectional friendship with the given user. Used by RLS policies that grant friends-only visibility (e.g. availability_blocks).';

-- ────────────────────────────────────────────────────────────────────
-- availability_blocks
-- ────────────────────────────────────────────────────────────────────

create table public.availability_blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint availability_blocks_valid_range check (ends_at > starts_at)
);

-- Most queries are "show me <user>'s blocks for [from, to]" — covered by
-- a composite (user_id, starts_at). Also useful for "all my blocks
-- chronologically".
create index availability_blocks_user_starts_idx
  on public.availability_blocks (user_id, starts_at);

-- Reuse the trigger function defined in the profiles migration.
create trigger availability_blocks_set_updated_at
  before update on public.availability_blocks
  for each row
  execute function public.tg_set_updated_at();

-- ────────────────────────────────────────────────────────────────────
-- RLS — friends-only visibility, owner-only mutation
-- ────────────────────────────────────────────────────────────────────

alter table public.availability_blocks enable row level security;

create policy "users see their own blocks and accepted friends'"
  on public.availability_blocks
  for select
  to authenticated
  using (user_id = auth.uid() or public.is_friend_of(user_id));

create policy "users can INSERT only their own blocks"
  on public.availability_blocks
  for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "users can UPDATE only their own blocks"
  on public.availability_blocks
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "users can DELETE only their own blocks"
  on public.availability_blocks
  for delete
  to authenticated
  using (user_id = auth.uid());
