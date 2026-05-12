-- Phase 4 P4d — likes on posts.
--
-- A "like" is a single binary heart from a user on a post. The
-- composite PK (post_id, liker_id) enforces one-per-pair at the
-- schema level — no risk of double-counting from a double-tap.
--
-- Visibility delegates to is_post_visible(post_id), the same
-- SECURITY DEFINER helper P4c introduced for comments. Pattern
-- consistency:
--   - SELECT: any user who can see the post can see its likes
--   - INSERT: any user who can see the post can like it, pinning
--     liker_id = auth.uid()
--   - DELETE: only the liker (can't unlike on someone else's behalf)
--
-- No UPDATE policy — likes are write-once create / delete. To
-- "change" a like the client deletes + re-inserts (or just leaves
-- it; there's no rating, only presence).

create table public.likes (
  post_id uuid not null references public.posts(id) on delete cascade,
  liker_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),

  primary key (post_id, liker_id)
);

-- Hot query: "is this post liked by me?" — the feed needs to know
-- per-post whether the viewer's heart is filled. Indexed by
-- (liker_id, post_id) so the "where liker_id = auth.uid()" filter
-- can be combined with the per-post check. The composite PK already
-- indexes (post_id, liker_id) for the per-post count query.
create index likes_liker_post_idx
  on public.likes (liker_id, post_id);

alter table public.likes enable row level security;

-- SELECT: anyone who can see the post can see its likes.
create policy "users see likes on visible posts"
  on public.likes
  for select
  to authenticated
  using (public.is_post_visible(post_id));

-- INSERT: anyone who can see the post can like it. liker_id pinned
-- to auth.uid() in WITH CHECK so a forged liker_id is rejected.
create policy "users can INSERT likes on visible posts"
  on public.likes
  for insert
  to authenticated
  with check (
    liker_id = auth.uid()
    and public.is_post_visible(post_id)
  );

-- DELETE: only the liker can unlike (no host moderation here —
-- removing a heart on someone's behalf is weird).
create policy "users can DELETE only their own likes"
  on public.likes
  for delete
  to authenticated
  using (liker_id = auth.uid());

-- No UPDATE policy — likes are presence-only; "edit" doesn't apply.
