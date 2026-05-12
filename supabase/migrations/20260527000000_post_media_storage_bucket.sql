-- Phase 4 P4e — private `post-media` Storage bucket for the actual
-- photo bytes referenced by `posts.media_path`. Mirrors the
-- event-media bucket from 20260521000000.
--
-- Path scheme inside the bucket:
--
--   <author_id>/<post_id>/<filename>
--
-- (typically `<author_id>/<post_id>/<uuid>.jpg`). The RLS policies
-- parse the first two path segments to authorize each operation:
--   - segment 1 = author id → INSERT pins it to auth.uid()
--   - segment 2 = post id → SELECT defers to is_post_visible(post_id)
--                          (the SECURITY DEFINER helper from P4c)
--
-- No pgTAP for the storage policies — same reasoning as the
-- event-media bucket (storage.objects RLS is awkward to exercise
-- from SQL tests; policies are thin wrappers around helpers that
-- ARE covered).

insert into storage.buckets (id, name, public)
values ('post-media', 'post-media', false)
on conflict (id) do nothing;

-- SELECT: anyone who can see the parent post can see its media
-- bytes. is_post_visible (added in P4c) gates this without
-- recursion since it bypasses posts RLS via SECURITY DEFINER.
create policy "post-media: visible-post readers can read"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'post-media'
    and public.is_post_visible((split_part(name, '/', 2))::uuid)
  );

-- INSERT: only the author of the post can upload media under
-- their own folder. The author segment is pinned to auth.uid()
-- at the storage layer so even a forged path can't post bytes
-- "as" someone else; the posts.media_path on the metadata row
-- also goes through the posts.UPDATE policy (author-only), so
-- this is a belt-and-suspenders gate.
create policy "post-media: author can upload to their own folder"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'post-media'
    and (split_part(name, '/', 1))::uuid = auth.uid()
  );

-- DELETE: the object's owner (storage.objects.owner = auth.uid()
-- on a row uploaded by that user) can clean up. Lets the
-- deletePost flow remove its associated bytes.
create policy "post-media: uploader can delete"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'post-media'
    and owner = auth.uid()
  );

-- No UPDATE policy — Storage updates rename objects; new uploads
-- get a new path.
