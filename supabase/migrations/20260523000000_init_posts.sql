-- Phase 4 — social feed.
--
-- A post is a short status update visible to the author and their
-- accepted friends. Comments + likes ship in follow-up migrations
-- (P4c + P4d); media attachments ship in P4e. For P4a we land just
-- the table + RLS + the author/profiles FK + the hot index on
-- (author_id, created_at) the feed query will use.
--
-- Visibility model mirrors busy_blocks / events: posts are readable
-- by the author + anyone who has an accepted friendship with the
-- author (the `is_friend_of()` SECURITY DEFINER helper from
-- init_busy_time.sql).
--
-- Schema decisions:
--   - `author_id → profiles(id)` (not auth.users) — same pattern the
--     events FK fix landed in #66, so PostgREST embeds resolve
--     cleanly via `author:profiles!posts_author_id_fkey(...)`.
--   - `body text` is currently non-null + non-blank. When P4e adds
--     a `media_path` column, the CHECK will widen to "body OR
--     media_path is non-null" so a media-only post is allowed.

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint posts_body_not_blank check (length(trim(body)) > 0)
);

-- Hot query: "all posts visible to me, newest first" — the feed
-- screen pulls this on every refresh. Index on (author_id,
-- created_at desc) so the per-author scans inside the RLS-driven
-- query are index-served.
create index posts_author_created_idx
  on public.posts (author_id, created_at desc);

create trigger posts_set_updated_at
  before update on public.posts
  for each row
  execute function public.tg_set_updated_at();

alter table public.posts enable row level security;

-- SELECT: author + accepted friends. is_friend_of() bypasses
-- friendships RLS (it's SECURITY DEFINER), so this policy doesn't
-- introduce the cross-table recursion trap that bit event_invites
-- in #67.
create policy "users see their own posts and accepted friends'"
  on public.posts
  for select
  to authenticated
  using (
    author_id = auth.uid()
    or public.is_friend_of(author_id)
  );

-- INSERT: only the author can create their own post. WITH CHECK
-- pins author_id = auth.uid() so a malicious client can't forge a
-- post in someone else's name.
create policy "users can INSERT only their own posts"
  on public.posts
  for insert
  to authenticated
  with check (author_id = auth.uid());

-- UPDATE: the author can edit their own post body. (Edit support
-- doesn't land in P4b's UI, but the policy is here so a future
-- "edit" feature has the right gate from day one.)
create policy "users can UPDATE only their own posts"
  on public.posts
  for update
  to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid());

-- DELETE: the author can remove their own post. No moderation tier
-- yet (friends can't report).
create policy "users can DELETE only their own posts"
  on public.posts
  for delete
  to authenticated
  using (author_id = auth.uid());
