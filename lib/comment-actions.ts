// Action layer for `comments` (Phase 4 P4c) — list + create + delete.
// Mirrors post-actions shape. RLS on comments gates visibility +
// insert authorization (via the SECURITY DEFINER `is_post_visible`
// helper, parallel to `is_friend_of`); this file just trusts the
// policy + reads auth.uid() for the live session.

import type { FriendProfile } from './calendar-helpers';
import { supabase } from './supabase';

export type CommentItem = {
  id: string;
  postId: string;
  author: FriendProfile;
  body: string;
  createdAt: Date;
};

type CommentRow = {
  id: string;
  post_id: string;
  author_id: string;
  body: string;
  created_at: string;
  author: FriendProfile | null;
};

const SELECT_CLAUSE =
  'id, post_id, author_id, body, created_at, ' +
  'author:profiles!comments_author_id_fkey(id, display_name, color)';

function describeError(prefix: string, err: unknown): string {
  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.error(`[comments] ${prefix}:`, err);
  }
  return `${prefix}. Please try again.`;
}

/**
 * Fetch all comments on a post, oldest-first (chronological reading
 * order). RLS gates visibility — a non-viewer's call returns an
 * empty array, not an error. Author profile is embedded so the
 * feed UI doesn't need a per-comment profile fetch.
 */
export async function listPostComments(args: {
  postId: string;
}): Promise<{ data: CommentItem[] | null; error: string | null }> {
  const result = await supabase
    .from('comments')
    .select(SELECT_CLAUSE)
    .eq('post_id', args.postId)
    .order('created_at', { ascending: true });

  if (result.error) {
    return { data: null, error: describeError("Couldn't load comments", result.error) };
  }

  const items: CommentItem[] = [];
  for (const row of (result.data ?? []) as unknown as CommentRow[]) {
    if (!row.author) continue;
    items.push({
      id: row.id,
      postId: row.post_id,
      author: row.author,
      body: row.body,
      createdAt: new Date(row.created_at),
    });
  }
  return { data: items, error: null };
}

/** Insert a comment owned by the calling user. RLS pins
 * `author_id = auth.uid()` so we read the user from the live
 * session rather than trusting a caller-supplied id. */
export async function createComment(args: {
  postId: string;
  body: string;
}): Promise<{ id: string | null; error: string | null }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { id: null, error: 'Not signed in.' };

  const trimmed = args.body.trim();
  if (trimmed.length === 0) {
    return { id: null, error: 'Comment cannot be empty.' };
  }

  const { data, error } = await supabase
    .from('comments')
    .insert({ post_id: args.postId, author_id: user.id, body: trimmed })
    .select('id')
    .single();

  if (error) return { id: null, error: describeError("Couldn't post comment", error) };
  return { id: (data as { id: string }).id, error: null };
}

/** Delete a comment by id. RLS enforces "comment author OR post
 * author" so this action doesn't need to check the caller's role. */
export async function deleteComment(id: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('comments').delete().eq('id', id);
  if (error) return { error: describeError("Couldn't delete comment", error) };
  return { error: null };
}
