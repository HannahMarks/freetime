-- Phase 4 P4c — comments on posts.
--
-- A comment belongs to a post and is written by some user. RLS on
-- the comment is "visible iff the parent post is visible" — which
-- is "author or accepted friend" via the helper below. Inserts are
-- author-only (the commenting user must be auth.uid()).
--
-- Schema mirrors posts: profiles FK, not-blank body, set_updated_at
-- trigger.
--
-- Helper `is_post_visible(post_id uuid)` is SECURITY DEFINER for the
-- same reason `is_owner_of_event` / `is_invited_to` / `is_attendee_of_event`
-- are: it bypasses posts RLS so a comments-side EXISTS-check
-- doesn't trigger the recursion trap that bit #67. Pattern lock-in
-- post-recursion: cross-table RLS must use a SECURITY DEFINER
-- helper from the start.

-- ────────────────────────────────────────────────────────────────────
-- is_post_visible helper (post author OR accepted-friend of the author)
-- ────────────────────────────────────────────────────────────────────

create or replace function public.is_post_visible(post_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.posts p
    where p.id = is_post_visible.post_id
      and (
        p.author_id = auth.uid()
        or public.is_friend_of(p.author_id)
      )
  );
$$;

comment on function public.is_post_visible(uuid) is
  'True iff the calling user can see the given post (they authored it OR have an accepted friendship with the author). SECURITY DEFINER bypasses posts RLS so comments policies can reference it without triggering RLS recursion.';

-- ────────────────────────────────────────────────────────────────────
-- comments table
-- ────────────────────────────────────────────────────────────────────

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint comments_body_not_blank check (length(trim(body)) > 0)
);

-- Hot query: "all comments on this post, oldest-first" (chronological
-- reading order). Index serves the ORDER BY directly.
create index comments_post_created_idx
  on public.comments (post_id, created_at asc);

create trigger comments_set_updated_at
  before update on public.comments
  for each row
  execute function public.tg_set_updated_at();

alter table public.comments enable row level security;

-- SELECT: visible iff the parent post is visible (author of the
-- post OR accepted friend of the post's author). The post's RLS
-- already filters at SELECT time when the UI queries posts; this
-- policy mirrors that gate so a comments-only query (e.g. paginated
-- "load more comments") can't leak comments on a hidden post.
create policy "users see comments on posts they can see"
  on public.comments
  for select
  to authenticated
  using (public.is_post_visible(post_id));

-- INSERT: anyone who can SEE the post can comment on it. Author is
-- pinned to auth.uid() in WITH CHECK so a forged author_id is
-- rejected at the policy.
create policy "users can INSERT comments on visible posts"
  on public.comments
  for insert
  to authenticated
  with check (
    author_id = auth.uid()
    and public.is_post_visible(post_id)
  );

-- UPDATE: only the comment's author can edit. Edit UI doesn't ship
-- in P4c, but the policy is here so a future "edit comment" path
-- has the right gate from day one.
create policy "users can UPDATE only their own comments"
  on public.comments
  for update
  to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid());

-- DELETE: the comment's author OR the post's author (moderation).
-- This mirrors the event_invites pattern where "either party can
-- delete." Lets a post author cull obvious spam without admin tools.
create policy "comment author or post author can DELETE"
  on public.comments
  for delete
  to authenticated
  using (
    author_id = auth.uid()
    or exists (
      select 1 from public.posts p
      where p.id = post_id and p.author_id = auth.uid()
    )
  );
