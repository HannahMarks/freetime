// Action layer for `likes` (Phase 4 P4d) — like / unlike. The
// "count + has-the-viewer-liked" annotations on each PostItem are
// produced inside `listFeedPosts` (post-actions.ts) via a single
// PostgREST embed, so we don't need a per-post fetch.

import { supabase } from './supabase';

function describeError(prefix: string, err: unknown): string {
  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.error(`[likes] ${prefix}:`, err);
  }
  return `${prefix}. Please try again.`;
}

/**
 * Like a post on behalf of the calling user. RLS pins
 * `liker_id = auth.uid()` so we read from the live session. The
 * (post_id, liker_id) PK rejects a double-like at the DB level —
 * but we still upsert with ignoreDuplicates so an accidental
 * double-tap doesn't surface as an error to the UI.
 */
export async function likePost(args: {
  postId: string;
}): Promise<{ error: string | null }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Not signed in.' };

  const { error } = await supabase
    .from('likes')
    .upsert(
      { post_id: args.postId, liker_id: user.id },
      { onConflict: 'post_id,liker_id', ignoreDuplicates: true },
    );
  if (error) return { error: describeError("Couldn't like post", error) };
  return { error: null };
}

/** Unlike a post — delete the (post, liker=auth.uid()) row. If no
 * row exists, the delete is a silent no-op (RLS still allows it
 * because the WHERE filters down to zero rows). */
export async function unlikePost(args: {
  postId: string;
}): Promise<{ error: string | null }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Not signed in.' };

  const { error } = await supabase
    .from('likes')
    .delete()
    .eq('post_id', args.postId)
    .eq('liker_id', user.id);
  if (error) return { error: describeError("Couldn't unlike post", error) };
  return { error: null };
}
