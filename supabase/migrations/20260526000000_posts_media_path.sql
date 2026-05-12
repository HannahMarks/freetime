-- Phase 4 P4e — media attachments on posts.
--
-- Adds a single `media_path` text column for the (forthcoming)
-- `post-media` Storage bucket. One image per post for now; if
-- multi-image post composition becomes a thing, the column can
-- promote to a separate `post_media` table later (parallel to
-- event_media). Single-column is sufficient for the hobby-tier
-- "one shareable photo with optional caption" pattern.
--
-- The existing `posts_body_not_blank` CHECK is widened to
-- "body OR media_path is non-null" so a media-only post (just a
-- photo, no caption) is allowed. Body keeps the not-blank guard
-- (if non-null, it must have visible content).

alter table public.posts
  add column media_path text;

-- `body` was NOT NULL since P4a. Relax it so a media-only post can
-- have body=null. The CHECK below preserves the "at least one of
-- body / media must be present" invariant — losing NOT NULL alone
-- without the CHECK would allow truly empty posts.
alter table public.posts
  alter column body drop not null;

-- Drop the old body-required CHECK and replace with a broader one
-- that admits media-only posts. Path is also length-gated so the
-- column can't store empty strings.
alter table public.posts
  drop constraint posts_body_not_blank;

alter table public.posts
  add constraint posts_body_or_media_required check (
    (body is not null and length(trim(body)) > 0)
    or (media_path is not null and length(trim(media_path)) > 0)
  );

-- Also keep the "if body is set it can't be blank" semantics so a
-- caller that supplies both a media + a whitespace-only body still
-- gets rejected at the row level.
alter table public.posts
  add constraint posts_body_not_blank_when_present check (
    body is null or length(trim(body)) > 0
  );

-- For the same reason, gate media_path against blank when set.
alter table public.posts
  add constraint posts_media_path_not_blank_when_present check (
    media_path is null or length(trim(media_path)) > 0
  );
