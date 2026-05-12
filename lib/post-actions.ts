// Action layer for `posts` (Phase 4) — create / list / delete. Same
// shape as event-actions.ts: action functions return `{data?, error}`,
// errors describe themselves into a friendly string. RLS on posts
// gates author + accepted-friend visibility; this file just trusts
// the policy + reads `auth.uid()` for the live session.

import type { FriendProfile } from './calendar-helpers';
import { supabase } from './supabase';

export type PostItem = {
  id: string;
  author: FriendProfile;
  body: string;
  createdAt: Date;
  /** Total like count on this post (P4d). Embedded into the feed
   * fetch so the heart counter renders without a second query. */
  likeCount: number;
  /** Whether the viewing user has liked this post (P4d). Drives
   * the filled-vs-outline heart on the feed row. */
  likedByMe: boolean;
};

type PostRow = {
  id: string;
  author_id: string;
  body: string;
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
  'id, author_id, body, created_at, ' +
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

/** Insert a post owned by the calling user. RLS pins
 * `author_id = auth.uid()` so we read the user from the live
 * session instead of trusting a caller-supplied id. */
export async function createPost(args: {
  body: string;
}): Promise<{ id: string | null; error: string | null }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { id: null, error: 'Not signed in.' };

  const trimmed = args.body.trim();
  if (trimmed.length === 0) {
    return { id: null, error: 'Post body cannot be empty.' };
  }

  const { data, error } = await supabase
    .from('posts')
    .insert({ author_id: user.id, body: trimmed })
    .select('id')
    .single();

  if (error) return { id: null, error: describeError("Couldn't share post", error) };
  return { id: (data as { id: string }).id, error: null };
}

/**
 * Fetch the feed — every post visible to the caller (own +
 * accepted-friends', per RLS), newest-first, capped at FEED_LIMIT.
 *
 * Returns `PostItem[]` with the author profile joined in so the
 * feed UI can render names + colors without a second round-trip.
 */
export async function listFeedPosts(): Promise<{
  data: PostItem[] | null;
  error: string | null;
}> {
  // Need the live user id to compute `likedByMe` per row. Same
  // session round-trip create/delete already make; doesn't add a
  // meaningful latency cost (the call is cached client-side after
  // the first auth.getUser).
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

  const items: PostItem[] = [];
  for (const row of (result.data ?? []) as unknown as PostRow[]) {
    if (!row.author) continue;
    const likes = row.likes ?? [];
    items.push({
      id: row.id,
      author: row.author,
      body: row.body,
      createdAt: new Date(row.created_at),
      likeCount: likes.length,
      likedByMe: myId !== null && likes.some((l) => l.liker_id === myId),
    });
  }
  return { data: items, error: null };
}

/** Delete a post by id. RLS enforces author-only, so this action
 * doesn't need to check the caller's role itself. */
export async function deletePost(id: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('posts').delete().eq('id', id);
  if (error) return { error: describeError("Couldn't delete post", error) };
  return { error: null };
}
