-- Busy-time data model. Two semantically distinct concepts, two tables.
--
-- 1) `busy_blocks` — activities anchored to wall-clock time in the user's
--    zone, with an optional title. e.g. "Lunch with Sarah" 12:00–13:00.
-- 2) `unavailable_days` — floating-date markers ("don't try to plan with me
--    that day"), timezone-independent so a friend in another zone sees the
--    same date.
--
-- Default state for a day is "free" — friends can plan with you unless one
-- of these rows says otherwise.

-- ────────────────────────────────────────────────────────────────────
-- Helper: is_friend_of(other_id)
-- ────────────────────────────────────────────────────────────────────
-- Reused by RLS policies on both new tables (and likely by future schemas
-- that share the same friends-only visibility). SECURITY DEFINER bypasses
-- the friendships RLS policy; the predicate still pins one party to
-- auth.uid() so the function can only confirm friendships the caller is
-- actually a part of.

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
  'True iff the calling user has an accepted bidirectional friendship with the given user. Used by RLS policies that grant friends-only visibility (e.g. busy_blocks, unavailable_days).';

-- ────────────────────────────────────────────────────────────────────
-- busy_blocks — time-ranged activities
-- ────────────────────────────────────────────────────────────────────

create table public.busy_blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint busy_blocks_valid_range check (ends_at > starts_at),
  -- Title is optional (nullable means "Busy" with no label) but if present
  -- must not be all-whitespace.
  constraint busy_blocks_title_not_blank check (
    title is null or length(trim(title)) > 0
  )
);

create index busy_blocks_user_starts_idx
  on public.busy_blocks (user_id, starts_at);

create trigger busy_blocks_set_updated_at
  before update on public.busy_blocks
  for each row
  execute function public.tg_set_updated_at();

alter table public.busy_blocks enable row level security;

create policy "users see their own busy_blocks and accepted friends'"
  on public.busy_blocks
  for select
  to authenticated
  using (user_id = auth.uid() or public.is_friend_of(user_id));

create policy "users can INSERT only their own busy_blocks"
  on public.busy_blocks
  for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "users can UPDATE only their own busy_blocks"
  on public.busy_blocks
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "users can DELETE only their own busy_blocks"
  on public.busy_blocks
  for delete
  to authenticated
  using (user_id = auth.uid());

-- ────────────────────────────────────────────────────────────────────
-- unavailable_days — floating-date markers
-- ────────────────────────────────────────────────────────────────────

create table public.unavailable_days (
  user_id uuid not null references public.profiles(id) on delete cascade,
  date date not null,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  primary key (user_id, date),
  -- Same shape as busy_blocks.title: nullable means "unavailable, no
  -- label" (UI can render as "Not free"); when set, must not be
  -- all-whitespace.
  constraint unavailable_days_title_not_blank check (
    title is null or length(trim(title)) > 0
  )
);

create trigger unavailable_days_set_updated_at
  before update on public.unavailable_days
  for each row
  execute function public.tg_set_updated_at();

alter table public.unavailable_days enable row level security;

create policy "users see their own unavailable_days and accepted friends'"
  on public.unavailable_days
  for select
  to authenticated
  using (user_id = auth.uid() or public.is_friend_of(user_id));

create policy "users can INSERT only their own unavailable_days"
  on public.unavailable_days
  for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "users can UPDATE only their own unavailable_days"
  on public.unavailable_days
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "users can DELETE only their own unavailable_days"
  on public.unavailable_days
  for delete
  to authenticated
  using (user_id = auth.uid());
