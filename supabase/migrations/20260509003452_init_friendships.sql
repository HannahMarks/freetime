-- friendships: bidirectional friend graph with mutual-accept semantics.
-- (requester, addressee) ordered as inserted; status flips from
-- 'pending' to 'accepted'/'declined' by the addressee.

create type public.friendship_status as enum (
  'pending',
  'accepted',
  'declined',
  'blocked'
);

create table public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  addressee_id uuid not null references public.profiles(id) on delete cascade,
  status public.friendship_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint friendships_no_self_friend check (requester_id <> addressee_id),
  constraint friendships_unique_pair unique (requester_id, addressee_id)
);

create index friendships_requester_idx on public.friendships(requester_id);
create index friendships_addressee_idx on public.friendships(addressee_id);

create trigger friendships_set_updated_at
  before update on public.friendships
  for each row
  execute function public.tg_set_updated_at();

-- RLS
alter table public.friendships enable row level security;

create policy "users can see friendships they are part of"
  on public.friendships
  for select
  to authenticated
  using (requester_id = auth.uid() or addressee_id = auth.uid());

create policy "users can request friendships only as themselves"
  on public.friendships
  for insert
  to authenticated
  with check (requester_id = auth.uid() and status = 'pending');

create policy "addressee can update status of incoming requests"
  on public.friendships
  for update
  to authenticated
  using (addressee_id = auth.uid())
  with check (addressee_id = auth.uid());

create policy "either party can delete a friendship"
  on public.friendships
  for delete
  to authenticated
  using (requester_id = auth.uid() or addressee_id = auth.uid());
