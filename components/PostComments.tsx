import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  type CommentItem,
  createComment,
  deleteComment,
  listPostComments,
} from '../lib/comment-actions';
import { toast } from '../lib/toast';

type Props = {
  postId: string;
  /** Author of the parent post. Used to gate the comment-delete UI:
   * the comment's own author can always delete; the post's author
   * can delete anyone's comment on their own post (moderation). */
  postAuthorId: string;
  /** The signed-in user's id. Used to gate the inline trash icon
   * on each comment (own + post-author). */
  currentUserId?: string;
  /** Compose color — typically the viewer's profile color. Fills
   * the Post button so the affordance matches the feed's compose
   * row visually. */
  composeColor: string;
};

/** "5m ago" / "3h ago" / "Yesterday" — same scheme the feed row
 * uses. Duplicating the helper here avoids importing FeedScreen's
 * internals; if a third surface needs it we can lift it to
 * `lib/date-helpers.ts`. */
function formatRelative(then: Date, now: Date): string {
  const diffMs = now.getTime() - then.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfThen = new Date(then.getFullYear(), then.getMonth(), then.getDate());
  const dayDelta = Math.round(
    (startOfToday.getTime() - startOfThen.getTime()) / (24 * 60 * 60 * 1000),
  );
  if (dayDelta === 1) return 'Yesterday';
  if (dayDelta < 7) return `${dayDelta}d ago`;
  return then.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Inline comment thread for a single post. Self-contained: owns its
 * own fetch state, compose state, and delete state so the feed screen
 * doesn't have to maintain per-post maps.
 *
 * Renders three sections:
 *   1. Comment list (chronological, oldest-first) — each row tinted
 *      with the author's profile color on the left border, parallel
 *      to feed post rows
 *   2. Compose row — TextInput + Post button (filled in composeColor)
 *   3. Delete affordance per comment, gated to:
 *        - the comment's own author (RLS: author_id = auth.uid()), OR
 *        - the post's author (RLS: post moderation)
 */
export function PostComments({
  postId,
  postAuthorId,
  currentUserId,
  composeColor,
}: Props) {
  const [items, setItems] = useState<CommentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const refetch = useCallback(async () => {
    const { data, error } = await listPostComments({ postId });
    if (error) {
      toast.error(error);
      return;
    }
    if (data) setItems(data);
  }, [postId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    refetch().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [refetch]);

  async function handlePost() {
    if (submitting || body.trim().length === 0) return;
    setSubmitting(true);
    try {
      const { error } = await createComment({ postId, body });
      if (error) {
        toast.error(error);
        return;
      }
      setBody('');
      await refetch();
    } finally {
      setSubmitting(false);
    }
  }

  function handleDelete(comment: CommentItem) {
    Alert.alert('Delete this comment?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const { error } = await deleteComment(comment.id);
          if (error) {
            toast.error(error);
            return;
          }
          // Local prune — RLS already gated the delete.
          setItems((prev) => prev.filter((c) => c.id !== comment.id));
        },
      },
    ]);
  }

  const now = new Date();
  const isPostAuthor =
    currentUserId !== undefined && postAuthorId === currentUserId;

  return (
    <View style={styles.container} testID={`comments-${postId}`}>
      {loading ? (
        <ActivityIndicator />
      ) : items.length === 0 ? (
        <Text style={styles.empty}>No comments yet — be the first.</Text>
      ) : (
        items.map((c) => {
          const canDelete =
            isPostAuthor ||
            (currentUserId !== undefined && c.author.id === currentUserId);
          return (
            <View
              key={c.id}
              testID={`comment-${c.id}`}
              style={[styles.row, { borderLeftColor: c.author.color }]}
            >
              <View style={styles.rowHeader}>
                <Text style={styles.author} numberOfLines={1}>
                  {c.author.display_name}
                </Text>
                <Text style={styles.time}>{formatRelative(c.createdAt, now)}</Text>
              </View>
              <Text style={styles.body}>{c.body}</Text>
              {canDelete ? (
                <Pressable
                  testID={`comment-delete-${c.id}`}
                  accessibilityRole="button"
                  accessibilityLabel="Delete comment"
                  onPress={() => handleDelete(c)}
                  hitSlop={8}
                  style={({ pressed }) => [
                    styles.delete,
                    pressed && styles.deletePressed,
                  ]}
                >
                  <Text style={styles.deleteIcon}>🗑</Text>
                </Pressable>
              ) : null}
            </View>
          );
        })
      )}

      <View style={styles.composeRow}>
        <TextInput
          testID={`comment-compose-${postId}`}
          placeholder="Add a comment…"
          placeholderTextColor="#999"
          style={styles.composeInput}
          value={body}
          onChangeText={setBody}
          multiline
          maxLength={500}
        />
        <Pressable
          testID={`comment-post-${postId}`}
          accessibilityRole="button"
          accessibilityLabel="Post comment"
          onPress={handlePost}
          disabled={submitting || body.trim().length === 0}
          style={({ pressed }) => [
            styles.composeButton,
            { backgroundColor: composeColor },
            pressed && styles.composeButtonPressed,
            (submitting || body.trim().length === 0) &&
              styles.composeButtonDisabled,
          ]}
        >
          <Text style={styles.composeButtonLabel}>
            {submitting ? '…' : 'Post'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#eee',
    gap: 8,
  },
  empty: { fontSize: 12, color: '#888', fontStyle: 'italic' },
  row: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderLeftWidth: 3,
    borderRadius: 4,
    backgroundColor: '#fff',
    gap: 2,
    position: 'relative',
  },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
  },
  author: { flex: 1, fontSize: 12, fontWeight: '600', color: '#222' },
  time: { fontSize: 10, color: '#888' },
  body: { fontSize: 13, color: '#333', lineHeight: 18 },
  delete: { position: 'absolute', top: 4, right: 4, padding: 2 },
  deletePressed: { opacity: 0.5 },
  deleteIcon: { fontSize: 12 },
  composeRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
  },
  composeInput: {
    flex: 1,
    minHeight: 32,
    maxHeight: 96,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#f0f0f0',
    fontSize: 13,
    color: '#111',
  },
  composeButton: {
    paddingHorizontal: 12,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composeButtonPressed: { opacity: 0.7 },
  composeButtonDisabled: { opacity: 0.4 },
  composeButtonLabel: { color: '#fff', fontSize: 12, fontWeight: '600' },
});
