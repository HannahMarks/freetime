// Action layer for `posts` (Phase 4) — create / list / delete. Same
// shape as event-actions.ts: action functions return `{data?, error}`,
// errors describe themselves into a friendly string. RLS on posts
// gates author + accepted-friend visibility; this file just trusts
// the policy + reads `auth.uid()` for the live session.

import * as ImageManipulator from 'expo-image-manipulator';
import type { FriendProfile } from './calendar-helpers';
import { supabase } from './supabase';

export const POST_MEDIA_BUCKET = 'post-media';

/** Signed-URL TTL for post media (1 hour). Matches the event-media
 * viewer pattern; the feed re-signs on every refetch. */
const SIGNED_URL_TTL_SECONDS = 60 * 60;

export type PostItem = {
  id: string;
  author: FriendProfile;
  /** Now nullable — a media-only post (just a photo) has body=null
   * (P4e widened the body CHECK to "body OR media_path required"). */
  body: string | null;
  createdAt: Date;
  /** Total like count on this post (P4d). Embedded into the feed
   * fetch so the heart counter renders without a second query. */
  likeCount: number;
  /** Whether the viewing user has liked this post (P4d). Drives
   * the filled-vs-outline heart on the feed row. */
  likedByMe: boolean;
  /** Storage path of the attached photo (P4e). Null for text-only
   * posts. */
  mediaPath: string | null;
  /** Pre-signed URL for the attached photo, if any. `listFeedPosts`
   * batches signs all attached photos in a single round-trip so the
   * feed UI can render <Image source={{uri: mediaUrl}}> directly
   * without a per-post sign call. Null if no media OR if signing
   * failed (rare; the feed just skips rendering the photo). */
  mediaUrl: string | null;
};

type PostRow = {
  id: string;
  author_id: string;
  body: string | null;
  media_path: string | null;
  created_at: string;
  author: FriendProfile | null;
  /** Embedded likes from the postgrest join — RLS already filters
   * to likes on visible posts only, so this is just "likes I'm
   * allowed to see on this row" (always = all likes for posts I
   * can see). Each entry has just liker_id since that's all the
   * feed needs to compute count + likedByMe. */
  likes: { liker_id: string }[] | null;
};

const SELECT_CLAUSE =
  'id, author_id, body, media_path, created_at, ' +
  'author:profiles!posts_author_id_fkey(id, display_name, color), ' +
  'likes(liker_id)';

/** Cap on `listFeedPosts` results — hobby tier, low volume, so a
 * single query is fine for now. Pagination ships when feeds grow
 * past this. */
const FEED_LIMIT = 50;

function describeError(prefix: string, err: unknown): string {
  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.error(`[posts] ${prefix}:`, err);
  }
  return `${prefix}. Please try again.`;
}

/** Tiny random suffix for storage path uniqueness — same shape
 * uploadEventPhoto uses. */
function shortRandomToken(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Insert a post owned by the calling user, optionally with an
 * attached photo. RLS pins `author_id = auth.uid()` so we read the
 * user from the live session instead of trusting a caller-supplied
 * id.
 *
 * P4e: `mediaUri` (local URI from expo-image-picker) is optional;
 * when present, the action compresses + uploads the photo to the
 * `post-media` bucket BEFORE the post row insert (so the row
 * always references real bytes — no half-state). On upload
 * success we generate a row id client-side (UUID v4), use it in
 * the path, then insert the post row pointing at that path.
 * Reverse the order if needed: orphan-cleanup on insert failure.
 */
export async function createPost(args: {
  /** Post body. Can be empty / whitespace only when `mediaUri`
   * is provided (media-only posts). */
  body: string;
  /** Optional local URI for an image to attach. */
  mediaUri?: string;
}): Promise<{ id: string | null; error: string | null }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { id: null, error: 'Not signed in.' };

  const trimmed = args.body.trim();
  if (trimmed.length === 0 && !args.mediaUri) {
    // No body AND no media — same gate the DB CHECK enforces, but
    // bail early without a round-trip.
    return { id: null, error: 'Post body cannot be empty.' };
  }

  let mediaPath: string | null = null;
  if (args.mediaUri) {
    try {
      const manipulated = await ImageManipulator.manipulateAsync(
        args.mediaUri,
        [{ resize: { width: 1600 } }],
        { compress: 0.75, format: ImageManipulator.SaveFormat.JPEG },
      );
      const response = await fetch(manipulated.uri);
      const bytes = await response.arrayBuffer();
      // Path: <author_id>/<token>.jpg. The author segment matches
      // the storage.objects RLS WITH CHECK (segment 1 = auth.uid()).
      mediaPath = `${user.id}/${shortRandomToken()}.jpg`;
      const uploadResult = await supabase.storage
        .from(POST_MEDIA_BUCKET)
        .upload(mediaPath, bytes, { contentType: 'image/jpeg' });
      if (uploadResult.error) {
        return { id: null, error: describeError("Couldn't upload the photo", uploadResult.error) };
      }
    } catch (err) {
      return { id: null, error: describeError("Couldn't prepare the photo", err) };
    }
  }

  const { data, error } = await supabase
    .from('posts')
    .insert({
      author_id: user.id,
      body: trimmed.length > 0 ? trimmed : null,
      media_path: mediaPath,
    })
    .select('id')
    .single();

  if (error) {
    // Orphan-cleanup: a successful storage upload + failed row
    // insert would leave bytes in the bucket nobody references.
    // Best-effort remove; suppress errors so we surface the
    // original insert failure.
    if (mediaPath) {
      await supabase.storage.from(POST_MEDIA_BUCKET).remove([mediaPath]).catch(() => {});
    }
    return { id: null, error: describeError("Couldn't share post", error) };
  }
  return { id: (data as { id: string }).id, error: null };
}

/**
 * Fetch the feed — every post visible to the caller (own +
 * accepted-friends', per RLS), newest-first, capped at FEED_LIMIT.
 *
 * Returns `PostItem[]` with the author profile joined in so the
 * feed UI can render names + colors without a second round-trip.
 * Posts with an attached photo also carry a `mediaUrl` (signed URL,
 * 1h TTL) so `<Image source={{uri: mediaUrl}}>` works against the
 * private `post-media` bucket.
 */
export async function listFeedPosts(): Promise<{
  data: PostItem[] | null;
  error: string | null;
}> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const myId = user?.id ?? null;

  const result = await supabase
    .from('posts')
    .select(SELECT_CLAUSE)
    .order('created_at', { ascending: false })
    .limit(FEED_LIMIT);

  if (result.error) {
    return { data: null, error: describeError("Couldn't load the feed", result.error) };
  }

  // Build a path → signed URL map for every row with an attached
  // photo. Single batched round-trip rather than per-row signing.
  // Partial signing failure (one path errored) just leaves that
  // row without a URL; the feed UI gracefully omits the image.
  const rows = (result.data ?? []) as unknown as PostRow[];
  const paths = rows
    .map((r) => r.media_path)
    .filter((p): p is string => typeof p === 'string' && p.length > 0);
  const urlsByPath = new Map<string, string>();
  if (paths.length > 0) {
    const sign = await supabase.storage
      .from(POST_MEDIA_BUCKET)
      .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
    for (const row of sign.data ?? []) {
      if (row.error || !row.signedUrl || !row.path) continue;
      urlsByPath.set(row.path, row.signedUrl);
    }
  }

  const items: PostItem[] = [];
  for (const row of rows) {
    if (!row.author) continue;
    const likes = row.likes ?? [];
    items.push({
      id: row.id,
      author: row.author,
      body: row.body,
      createdAt: new Date(row.created_at),
      likeCount: likes.length,
      likedByMe: myId !== null && likes.some((l) => l.liker_id === myId),
      mediaPath: row.media_path,
      mediaUrl: row.media_path ? (urlsByPath.get(row.media_path) ?? null) : null,
    });
  }
  return { data: items, error: null };
}

/** Delete a post by id. RLS enforces author-only, so this action
 * doesn't need to check the caller's role itself. ON DELETE CASCADE
 * removes the matching likes + comments rows automatically. The
 * Storage object (if any) is best-effort removed by the caller —
 * the metadata row is gone the moment this returns, so the URL
 * stops resolving even before the bytes go. */
export async function deletePost(id: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('posts').delete().eq('id', id);
  if (error) return { error: describeError("Couldn't delete post", error) };
  return { error: null };
}
