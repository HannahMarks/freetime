-- Phase 3 P1b — Supabase Storage bucket for event media + RLS on
-- `storage.objects` so the actual file bytes share the same
-- attendees-only gate that already protects the `event_media`
-- metadata rows (from P1a / 20260520000000).
--
-- Path scheme inside the bucket:
--
--   <event_id>/<uploader_id>/<filename>
--
-- (typically `<event_id>/<uploader_id>/<uuid>.<ext>` — the client picks
-- the uuid + extension at upload time). This shape lets the RLS
-- policies authorize each operation by parsing the first two path
-- segments:
--   - segment 1 = event id → feed into `is_attendee_of_event`
--   - segment 2 = uploader id → must match auth.uid() at INSERT time
--
-- The bucket is private (no public read). Album viewers fetch each
-- asset via a signed URL or via PostgREST's storage API once
-- authenticated; either way the SELECT policy gates access.
--
-- No pgTAP for these policies — storage.objects RLS is awkward to
-- exercise from a SQL test (requires the Supabase Storage extension's
-- internals to be cleanly stubbable). The policies are thin wrappers
-- around `is_attendee_of_event` / `is_owner_of_event`, both of which
-- ARE pgTAP-covered, so the regression surface here is just "does the
-- path-parsing logic match what the client uploads". Verified via
-- manual smoke after deploy.

-- ────────────────────────────────────────────────────────────────────
-- Bucket
-- ────────────────────────────────────────────────────────────────────

-- `on conflict do nothing` so a re-run (e.g. someone hits this
-- migration in a partial state) doesn't error out.
insert into storage.buckets (id, name, public)
values ('event-media', 'event-media', false)
on conflict (id) do nothing;

-- ────────────────────────────────────────────────────────────────────
-- storage.objects RLS — gated to `event-media` bucket
-- ────────────────────────────────────────────────────────────────────
-- Supabase enables RLS on storage.objects by default. We just need
-- to add per-bucket policies.

-- SELECT: any attendee of the event can read every object in that
-- event's folder. `split_part(name, '/', 1)::uuid` casts the first
-- path segment to a uuid; if the client uploaded under a malformed
-- path the cast errors out (effectively a denial). Safer than a
-- silent permit.
create policy "event-media: attendees can read"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'event-media'
    and public.is_attendee_of_event((split_part(name, '/', 1))::uuid)
  );

-- INSERT: attendee must:
--   (a) actually be attending the event in path segment 1, AND
--   (b) upload under their OWN folder (segment 2 = auth.uid()).
--
-- Pinning (b) at the storage layer means even if a malicious client
-- forges the path, RLS rejects the write. The metadata table's
-- separate INSERT policy ALSO pins uploader_id; with both layers in
-- place, a bypass would require defeating both, which would in turn
-- require service-role credentials.
create policy "event-media: attendees can upload to their own folder"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'event-media'
    and public.is_attendee_of_event((split_part(name, '/', 1))::uuid)
    and (split_part(name, '/', 2))::uuid = auth.uid()
  );

-- DELETE: uploader (storage.objects.owner column carries the
-- uploading user's auth.uid()) OR the event host (moderation —
-- mirrors event_media.DELETE). Sibling table's DELETE policy
-- handles the metadata side.
create policy "event-media: uploader or host can delete"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'event-media'
    and (
      owner = auth.uid()
      or public.is_owner_of_event((split_part(name, '/', 1))::uuid)
    )
  );

-- No UPDATE policy — Supabase Storage updates would re-key the
-- object (rename); we don't support that for media. New uploads
-- get a new path.
