-- Phase 3 — per-event photo + video albums.
--
-- This migration lands the **metadata** table only. The actual file
-- bytes live in Supabase Storage (a separate bucket + policies arrive
-- in the next PR); each `event_media` row stores the storage path so
-- the album viewer can resolve every uploaded asset back to its
-- bytes without crawling the bucket.
--
-- Visibility model: an event's media is visible only to its
-- **attendees** — the host plus invitees with `status='accepted'`.
-- 'pending' / 'declined' / 'maybe' invitees cannot read the album.
-- Conservative for MVP — easier to widen later than to tighten.
--
-- Cross-table predicates again risk the same RLS-recursion trap
-- that bit event_invites in #67, so the helper that gates access is
-- SECURITY DEFINER from the start (the pattern locked in by #67's
-- post-mortem). Helper goes in this migration since this is the
-- first place that needs it; future RLS that wants "is this user
-- attending the event" reuses the same function.

-- ────────────────────────────────────────────────────────────────────
-- is_attendee_of_event helper (host + accepted invitees)
-- ────────────────────────────────────────────────────────────────────

create or replace function public.is_attendee_of_event(eid uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.events
    where id = eid and owner_id = auth.uid()
  )
  or exists (
    select 1 from public.event_invites
    where event_id = eid
      and invitee_id = auth.uid()
      and status = 'accepted'
  );
$$;

comment on function public.is_attendee_of_event(uuid) is
  'True iff the calling user is attending the event (hosts it OR has an accepted invite). SECURITY DEFINER bypasses events + event_invites RLS so event_media policies can reference it without triggering RLS recursion.';

-- ────────────────────────────────────────────────────────────────────
-- event_media table
-- ────────────────────────────────────────────────────────────────────

create table public.event_media (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  -- FK to profiles (NOT auth.users) — same pattern as
  -- busy_blocks.user_id + events.owner_id. PostgREST embeds need the
  -- FK target on profiles to resolve `uploader:profiles(...)`. Cascade
  -- chain runs through profiles which already cascades from auth.users.
  uploader_id uuid not null references public.profiles(id) on delete cascade,
  -- Path within the (forthcoming) `event-media` Storage bucket. Stored
  -- as text so the next PR can land any path shape that works for the
  -- bucket policies (likely `<event_id>/<uploader_id>/<uuid>.<ext>`).
  storage_path text not null,
  -- 'photo' or 'video' so the viewer can route to the right player.
  -- Constrained at the DB level so an old client can't slip an unknown
  -- kind past us — bump the CHECK as we add new kinds.
  media_kind text not null,
  -- Video length cap is enforced client-side at upload time (hobby
  -- tier: keep clips short to stay under storage limits). Column
  -- exists so the viewer can show "0:42" without reading metadata
  -- out of the file. Null for photos.
  duration_seconds integer,
  created_at timestamptz not null default now(),

  constraint event_media_storage_path_not_blank check (
    length(trim(storage_path)) > 0
  ),
  constraint event_media_kind_supported check (
    media_kind in ('photo', 'video')
  ),
  constraint event_media_duration_nonneg check (
    duration_seconds is null or duration_seconds >= 0
  ),
  -- Duration only makes sense on a video. Photos with a non-null
  -- duration would be a client-side bug; pin it here.
  constraint event_media_duration_only_on_video check (
    media_kind = 'video' or duration_seconds is null
  )
);

-- Hot query: "all media for an event, newest first" for the album
-- viewer. Index on (event_id, created_at desc) so the viewer's
-- ORDER BY is index-served.
create index event_media_event_created_idx
  on public.event_media (event_id, created_at desc);

-- ────────────────────────────────────────────────────────────────────
-- RLS
-- ────────────────────────────────────────────────────────────────────

alter table public.event_media enable row level security;

-- SELECT: attendees of the event (host + accepted invitees) can see
-- every media row on that event. Same gate used by all three policies
-- so the function call deduplicates the "am I in this event" check.
create policy "attendees can see event media"
  on public.event_media
  for select
  to authenticated
  using (public.is_attendee_of_event(event_id));

-- INSERT: an attendee can upload media for the event. uploader_id
-- pinned to auth.uid() in the WITH CHECK so no one can post media
-- "as" someone else (the trigger-free way to enforce "always your
-- own row"; same pattern as busy_blocks INSERT).
create policy "attendees can INSERT their own media"
  on public.event_media
  for insert
  to authenticated
  with check (
    uploader_id = auth.uid()
    and public.is_attendee_of_event(event_id)
  );

-- DELETE: the uploader can always remove their own media. The host
-- can also moderate (remove anyone's media from their event) since
-- they own the gathering. Mirrors the "host or invitee can DELETE"
-- pattern from event_invites.
create policy "uploader or host can DELETE event media"
  on public.event_media
  for delete
  to authenticated
  using (
    uploader_id = auth.uid()
    or public.is_owner_of_event(event_id)
  );

-- No UPDATE policy by design — media rows are write-once. Editing a
-- caption (if we add one) would need an UPDATE policy added then.
