// Action layer for `event_media` (Phase 3) — fetch the album for an
// event + upload a new photo to the Storage bucket. Mirrors the shape
// of `event-actions.ts` (action functions return `{data?, error}`,
// errors describe themselves into a friendly string).
//
// Visibility / authorization is enforced by RLS on `event_media` and
// `storage.objects` — attendees only. This file just trusts the
// policies and reads `auth.uid()` for the live session.

import * as ImageManipulator from 'expo-image-manipulator';
import { supabase } from './supabase';

export const EVENT_MEDIA_BUCKET = 'event-media';

export type EventMediaKind = 'photo' | 'video';

/** Reuses `FriendProfile` shape (id + display_name + color) so the
 * album viewer can tint the per-photo "uploaded by ..." accent in
 * the uploader's color, parallel to how calendar items show per-user
 * color elsewhere in the app. */
type UploaderProfile = {
  id: string;
  display_name: string;
  color: string;
};

export type EventMediaItem = {
  id: string;
  eventId: string;
  uploader: UploaderProfile;
  storagePath: string;
  mediaKind: EventMediaKind;
  durationSeconds: number | null;
  createdAt: Date;
};

type EventMediaRow = {
  id: string;
  event_id: string;
  uploader_id: string;
  storage_path: string;
  media_kind: EventMediaKind;
  duration_seconds: number | null;
  created_at: string;
  uploader: UploaderProfile | null;
};

const SELECT_CLAUSE =
  'id, event_id, uploader_id, storage_path, media_kind, duration_seconds, created_at, ' +
  'uploader:profiles(id, display_name, color)';

function describeError(prefix: string, err: unknown): string {
  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.error(`[event-media] ${prefix}:`, err);
  }
  return `${prefix}. Please try again.`;
}

/**
 * Fetch all media rows for an event, newest-first. RLS on
 * `event_media` filters to rows visible to the caller (attendees
 * only — host + accepted invitees). The album viewer renders this
 * list directly; a non-attendee gets an empty array (the policy
 * doesn't error, it just hides rows).
 */
export async function listEventMedia(args: {
  eventId: string;
}): Promise<{ data: EventMediaItem[] | null; error: string | null }> {
  const result = await supabase
    .from('event_media')
    .select(SELECT_CLAUSE)
    .eq('event_id', args.eventId)
    .order('created_at', { ascending: false });

  if (result.error) {
    return { data: null, error: describeError("Couldn't load the album", result.error) };
  }
  const items: EventMediaItem[] = [];
  for (const row of (result.data ?? []) as unknown as EventMediaRow[]) {
    if (!row.uploader) continue;
    items.push({
      id: row.id,
      eventId: row.event_id,
      uploader: row.uploader,
      storagePath: row.storage_path,
      mediaKind: row.media_kind,
      durationSeconds: row.duration_seconds,
      createdAt: new Date(row.created_at),
    });
  }
  return { data: items, error: null };
}

/** Tiny random suffix — enough to avoid collisions when the same
 * user uploads multiple photos in the same millisecond. Avoids
 * pulling in a uuid dep just for this; the FK to event_media row
 * IDs (those use Postgres-side gen_random_uuid()) keeps the
 * "real" uniqueness server-side. The hash is only for the storage
 * path. */
function shortRandomToken(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Pick a photo, compress it, upload to the `event-media` bucket,
 * then insert the matching `event_media` metadata row.
 *
 * Compression: resize to max 1600px wide + JPEG quality 0.75. That
 * lands most phone photos at well under 400KB — well within the
 * 1GB hobby-tier Supabase Storage budget for hundreds of uploads
 * per event before any tier pressure.
 *
 * Path scheme (must match `storage.objects` RLS in
 * 20260521000000_event_media_storage_bucket.sql):
 *   <event_id>/<uploader_id>/<token>.jpg
 *
 * Failure semantics:
 *  - If the storage upload fails: insert isn't attempted, error
 *    bubbles up.
 *  - If the insert fails AFTER a successful storage upload: best-
 *    effort `.remove([path])` to clean up the orphaned bytes, then
 *    the original insert error is surfaced. If the remove also
 *    fails, the orphan stays in the bucket — acceptable for hobby
 *    tier; the bucket is private, and the row is missing so the
 *    album viewer never references the orphan.
 */
export async function uploadEventPhoto(args: {
  eventId: string;
  /** Local file URI from `expo-image-picker` (or any other source
   * — the function fetches it back as bytes). */
  uri: string;
}): Promise<{ error: string | null }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Not signed in.' };

  let bytes: ArrayBuffer;
  try {
    const manipulated = await ImageManipulator.manipulateAsync(
      args.uri,
      [{ resize: { width: 1600 } }],
      { compress: 0.75, format: ImageManipulator.SaveFormat.JPEG },
    );
    // `fetch(uri).arrayBuffer()` is the RN-safe way to read a local
    // file URI into bytes — `.blob()` can return zero-byte blobs on
    // some platforms (a documented RN gotcha; see Supabase RN docs).
    const response = await fetch(manipulated.uri);
    bytes = await response.arrayBuffer();
  } catch (err) {
    return { error: describeError("Couldn't prepare the photo", err) };
  }

  const path = `${args.eventId}/${user.id}/${shortRandomToken()}.jpg`;

  const uploadResult = await supabase.storage
    .from(EVENT_MEDIA_BUCKET)
    .upload(path, bytes, { contentType: 'image/jpeg' });
  if (uploadResult.error) {
    return { error: describeError("Couldn't upload the photo", uploadResult.error) };
  }

  const { error: insertError } = await supabase.from('event_media').insert({
    event_id: args.eventId,
    uploader_id: user.id,
    storage_path: path,
    media_kind: 'photo',
  });
  if (insertError) {
    // Orphan cleanup — best-effort. The .catch swallows any remove
    // error so we surface the original insert error to the caller.
    await supabase.storage
      .from(EVENT_MEDIA_BUCKET)
      .remove([path])
      .catch(() => {});
    return { error: describeError("Couldn't record the upload", insertError) };
  }
  return { error: null };
}

/** How long a signed URL stays valid. 1 hour is generous for a
 * sheet-open session; the viewer re-signs on next list fetch. */
const SIGNED_URL_TTL_SECONDS = 60 * 60;

/**
 * Batch-generate signed URLs for a set of storage paths. Returns a
 * `Map<path, signedUrl>` so the UI can pair URLs back to its
 * EventMediaItem list without re-fetching. Paths whose signing fails
 * are simply absent from the map — the caller decides how to fall
 * back (likely just skip rendering that thumbnail).
 *
 * Bucket is private, so the album viewer can't render Image
 * components from raw paths. Signed URLs are time-limited and
 * scope-pinned to a single object, which keeps the bucket access
 * gate intact while letting the standard <Image> component render
 * the photo.
 */
export async function signEventMediaUrls(args: {
  paths: string[];
}): Promise<{ data: Map<string, string> | null; error: string | null }> {
  const out = new Map<string, string>();
  if (args.paths.length === 0) return { data: out, error: null };

  const result = await supabase.storage
    .from(EVENT_MEDIA_BUCKET)
    .createSignedUrls(args.paths, SIGNED_URL_TTL_SECONDS);

  if (result.error) {
    return { data: null, error: describeError("Couldn't load the album", result.error) };
  }
  for (const row of result.data ?? []) {
    if (row.error || !row.signedUrl || !row.path) continue;
    out.set(row.path, row.signedUrl);
  }
  return { data: out, error: null };
}

/**
 * Delete a media row + its storage object. Used by the album
 * viewer's trash button. Storage object goes first; if its removal
 * fails we abort so we don't end up with a missing-bytes row that
 * the viewer can't render. If the metadata delete fails after a
 * successful storage remove, the object is already gone — surface
 * the error so the user can retry the cleanup.
 *
 * RLS enforces "uploader or host" on both layers, so this action
 * doesn't need to check the caller's role itself.
 */
export async function deleteEventMedia(args: {
  id: string;
  storagePath: string;
}): Promise<{ error: string | null }> {
  const remove = await supabase.storage
    .from(EVENT_MEDIA_BUCKET)
    .remove([args.storagePath]);
  if (remove.error) {
    return { error: describeError("Couldn't delete the photo", remove.error) };
  }
  const { error } = await supabase.from('event_media').delete().eq('id', args.id);
  if (error) {
    return { error: describeError("Couldn't delete the photo record", error) };
  }
  return { error: null };
}
