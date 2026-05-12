import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { PostComments } from '../../components/PostComments';
import { useAuth } from '../../lib/auth';
import { likePost, unlikePost } from '../../lib/like-actions';
import { createPost, deletePost, listFeedPosts } from '../../lib/post-actions';
import type { PostItem } from '../../lib/post-actions';
import { toast } from '../../lib/toast';

const FAB_BG_FALLBACK = '#111';

/** "5m ago" / "3h ago" / "Yesterday" / "Wed, May 13" — keeps the
 * feed scannable without exact timestamps in the foreground. */
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

export default function FeedScreen() {
  const { session, profile } = useAuth();
  const [items, setItems] = useState<PostItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // The compose box state is colocated with the feed screen — a
  // separate "compose modal" would be overkill for a single-line
  // text affordance; posts are short by design.
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // P4e: optional photo attached to a new post. The compose row
  // shows a thumbnail preview when set; "× " on the preview clears
  // it. Stored as a local URI from expo-image-picker until the user
  // taps Post, at which point createPost uploads + persists.
  const [pendingMediaUri, setPendingMediaUri] = useState<string | null>(null);
  // P4c: which posts have their inline comment thread expanded.
  // Multiple can be open at once — the user might scroll between
  // threads. A Set is cheap to add / remove without re-allocating
  // the whole identity.
  const [expandedPosts, setExpandedPosts] = useState<Set<string>>(() => new Set());

  const fetchFeed = useCallback(async () => {
    const { data, error } = await listFeedPosts();
    if (error) {
      toast.error(error);
      return;
    }
    if (data) setItems(data);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchFeed().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchFeed]);

  async function handleRefresh() {
    setRefreshing(true);
    await fetchFeed();
    setRefreshing(false);
  }

  async function handlePost() {
    // Post is valid when there's text OR a pending photo.
    if (submitting || (body.trim().length === 0 && !pendingMediaUri)) return;
    setSubmitting(true);
    try {
      const { error } = await createPost({
        body,
        mediaUri: pendingMediaUri ?? undefined,
      });
      if (error) {
        toast.error(error);
        return;
      }
      setBody('');
      setPendingMediaUri(null);
      await fetchFeed();
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePickPhoto() {
    // Permission first — matches the upload flow on the EventSheet.
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      toast.error('Photo library access is needed to attach a photo.');
      return;
    }
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      quality: 1, // createPost re-compresses
    });
    if (picked.canceled || picked.assets.length === 0) return;
    setPendingMediaUri(picked.assets[0].uri);
  }

  async function handleToggleLike(post: PostItem) {
    // Optimistic update: flip the heart + adjust the count
    // immediately so the tap feels instant. If the action rejects
    // we revert + toast. Failure mode is rare (network blip while
    // double-tapping; RLS denial would mean the post wasn't really
    // visible — also rare).
    const wasLiked = post.likedByMe;
    setItems((prev) =>
      prev.map((p) =>
        p.id === post.id
          ? {
              ...p,
              likedByMe: !wasLiked,
              likeCount: p.likeCount + (wasLiked ? -1 : 1),
            }
          : p,
      ),
    );
    const { error } = wasLiked
      ? await unlikePost({ postId: post.id })
      : await likePost({ postId: post.id });
    if (error) {
      toast.error(error);
      setItems((prev) =>
        prev.map((p) =>
          p.id === post.id
            ? {
                ...p,
                likedByMe: wasLiked,
                likeCount: p.likeCount + (wasLiked ? 1 : -1),
              }
            : p,
        ),
      );
    }
  }

  function handleDelete(post: PostItem) {
    if (post.author.id !== session?.user.id) return;
    Alert.alert('Delete this post?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const { error } = await deletePost(post.id);
          if (error) {
            toast.error(error);
            return;
          }
          // Drop the row locally without a refetch — RLS already
          // gated the delete; we know the row is gone.
          setItems((prev) => prev.filter((p) => p.id !== post.id));
        },
      },
    ]);
  }

  const now = new Date();
  const composeColor = profile?.color ?? FAB_BG_FALLBACK;

  return (
    <View style={styles.container}>
      {/* Compose box — always rendered at the top of the feed,
          even when the list is empty. Keeps the affordance
          discoverable without a separate "create" surface.
          P4e: optional pending-photo preview sits below the text
          input + above the action row. */}
      <View style={styles.composeWrap} testID="compose-row">
        <TextInput
          testID="compose-input"
          placeholder="Share something with friends…"
          placeholderTextColor="#999"
          style={styles.composeInput}
          value={body}
          onChangeText={setBody}
          multiline
          maxLength={1000}
        />
        {pendingMediaUri ? (
          <View style={styles.pendingMediaRow} testID="compose-pending-media">
            <Image
              source={{ uri: pendingMediaUri }}
              style={styles.pendingMediaImage}
              resizeMode="cover"
            />
            <Pressable
              testID="compose-remove-media"
              accessibilityRole="button"
              accessibilityLabel="Remove photo"
              onPress={() => setPendingMediaUri(null)}
              hitSlop={8}
              style={({ pressed }) => [
                styles.pendingMediaRemove,
                pressed && styles.pendingMediaRemovePressed,
              ]}
            >
              <Text style={styles.pendingMediaRemoveLabel}>×</Text>
            </Pressable>
          </View>
        ) : null}
        <View style={styles.composeActionRow}>
          <Pressable
            testID="compose-pick-photo"
            accessibilityRole="button"
            accessibilityLabel="Attach a photo"
            onPress={handlePickPhoto}
            disabled={submitting}
            hitSlop={6}
            style={({ pressed }) => [
              styles.composePickButton,
              pressed && styles.composePickButtonPressed,
              submitting && styles.composePickButtonDisabled,
            ]}
          >
            <Text style={styles.composePickLabel}>📷 Photo</Text>
          </Pressable>
          <Pressable
            testID="compose-post"
            accessibilityRole="button"
            accessibilityLabel="Post"
            onPress={handlePost}
            disabled={
              submitting || (body.trim().length === 0 && !pendingMediaUri)
            }
            style={({ pressed }) => [
              styles.composeButton,
              { backgroundColor: composeColor },
              pressed && styles.composeButtonPressed,
              (submitting || (body.trim().length === 0 && !pendingMediaUri)) &&
                styles.composeButtonDisabled,
            ]}
          >
            <Text style={styles.composeButtonLabel}>
              {submitting ? '…' : 'Post'}
            </Text>
          </Pressable>
        </View>
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator />
        </View>
      ) : items.length === 0 ? (
        <View style={styles.emptyWrap} testID="feed-empty">
          <Text style={styles.emptyTitle}>Nothing on the feed yet</Text>
          <Text style={styles.emptyBody}>
            Be the first to share something — or add a friend or two so
            their posts show up here.
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
          }
        >
          {items.map((post) => {
            const isMine = post.author.id === session?.user.id;
            return (
              <View
                key={post.id}
                testID={`feed-post-${post.id}`}
                style={[
                  styles.postRow,
                  // Tint the left border in the author's color so
                  // friend-attribution reads at a glance without
                  // depending on the avatar text alone.
                  { borderLeftColor: post.author.color },
                ]}
              >
                <View style={styles.postHeader}>
                  <Text style={styles.postAuthor} numberOfLines={1}>
                    {post.author.display_name}
                  </Text>
                  <Text style={styles.postTime}>
                    {formatRelative(post.createdAt, now)}
                  </Text>
                </View>
                {post.body ? (
                  <Text style={styles.postBody}>{post.body}</Text>
                ) : null}
                {post.mediaUrl ? (
                  <Image
                    testID={`feed-post-media-${post.id}`}
                    source={{ uri: post.mediaUrl }}
                    style={styles.postMedia}
                    resizeMode="cover"
                  />
                ) : null}

                <View style={styles.actionRow}>
                  {/* P4d: heart toggle. Optimistic-update — the
                      icon flips instantly + the local count
                      adjusts; if the server rejects (rare; mostly
                      a network blip) we revert + toast. */}
                  <Pressable
                    testID={`feed-like-${post.id}`}
                    accessibilityRole="button"
                    accessibilityLabel={
                      post.likedByMe ? 'Unlike' : 'Like'
                    }
                    onPress={() => handleToggleLike(post)}
                    hitSlop={6}
                    style={({ pressed }) => [
                      styles.likeButton,
                      pressed && styles.likeButtonPressed,
                    ]}
                  >
                    <Text
                      style={[
                        styles.likeIcon,
                        post.likedByMe && styles.likeIconActive,
                      ]}
                    >
                      {post.likedByMe ? '❤' : '♡'}
                    </Text>
                    {post.likeCount > 0 ? (
                      <Text
                        testID={`feed-like-count-${post.id}`}
                        style={styles.likeCount}
                      >
                        {post.likeCount}
                      </Text>
                    ) : null}
                  </Pressable>

                  {/* P4c: Comments toggle + inline thread. Tapping
                      expands / collapses; expanded threads fetch their
                      own comments via the PostComments sub-component
                      (each thread owns its own state so the feed
                      screen doesn't have to maintain per-post maps). */}
                  <Pressable
                    testID={`feed-comments-toggle-${post.id}`}
                    accessibilityRole="button"
                    accessibilityLabel={
                      expandedPosts.has(post.id)
                        ? 'Hide comments'
                        : 'Show comments'
                    }
                    onPress={() => {
                      setExpandedPosts((prev) => {
                        const next = new Set(prev);
                        if (next.has(post.id)) next.delete(post.id);
                        else next.add(post.id);
                        return next;
                      });
                    }}
                    hitSlop={6}
                    style={({ pressed }) => [
                      styles.commentsToggle,
                      pressed && styles.commentsTogglePressed,
                    ]}
                  >
                    <Text style={styles.commentsToggleLabel}>
                      {expandedPosts.has(post.id) ? 'Hide comments' : '💬 Comment'}
                    </Text>
                  </Pressable>
                </View>

                {expandedPosts.has(post.id) ? (
                  <PostComments
                    postId={post.id}
                    postAuthorId={post.author.id}
                    currentUserId={session?.user.id}
                    composeColor={composeColor}
                  />
                ) : null}

                {isMine ? (
                  <Pressable
                    testID={`feed-delete-${post.id}`}
                    accessibilityRole="button"
                    accessibilityLabel="Delete post"
                    onPress={() => handleDelete(post)}
                    hitSlop={8}
                    style={({ pressed }) => [
                      styles.deleteButton,
                      pressed && styles.deleteButtonPressed,
                    ]}
                  >
                    <Text style={styles.deleteIcon}>🗑</Text>
                  </Pressable>
                ) : null}
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  composeWrap: {
    padding: 12,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eee',
  },
  composeInput: {
    minHeight: 40,
    maxHeight: 120,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: '#f7f7f7',
    fontSize: 14,
    color: '#111',
  },
  composeActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  composePickButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  composePickButtonPressed: { opacity: 0.6 },
  composePickButtonDisabled: { opacity: 0.4 },
  composePickLabel: { fontSize: 13, color: '#444', fontWeight: '500' },
  composeButton: {
    paddingHorizontal: 16,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composeButtonPressed: { opacity: 0.7 },
  composeButtonDisabled: { opacity: 0.4 },
  composeButtonLabel: { color: '#fff', fontSize: 14, fontWeight: '600' },
  // Pending-photo preview shown between the text input and the
  // action row when the user has picked a photo but hasn't posted
  // yet. Square thumbnail + an × in the top-right to clear it.
  pendingMediaRow: {
    position: 'relative',
    alignSelf: 'flex-start',
  },
  pendingMediaImage: {
    width: 120,
    height: 120,
    borderRadius: 8,
    backgroundColor: '#eee',
  },
  pendingMediaRemove: {
    position: 'absolute',
    top: -8,
    right: -8,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#111',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pendingMediaRemovePressed: { opacity: 0.6 },
  pendingMediaRemoveLabel: { color: '#fff', fontSize: 16, lineHeight: 18 },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 8,
  },
  emptyTitle: { fontSize: 17, fontWeight: '600', color: '#111' },
  emptyBody: { fontSize: 14, color: '#666', textAlign: 'center', lineHeight: 20 },
  listContent: { padding: 16, gap: 12 },
  postRow: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderLeftWidth: 4,
    borderRadius: 6,
    backgroundColor: '#f7f7f7',
    gap: 6,
    position: 'relative',
  },
  postHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  postAuthor: { flex: 1, fontSize: 14, fontWeight: '600', color: '#111' },
  postTime: { fontSize: 12, color: '#888' },
  postBody: { fontSize: 14, color: '#222', lineHeight: 20 },
  // Attached photo on a post row (P4e). Fills the row width minus
  // the row's horizontal padding + the left-border width; aspect
  // ratio kept square for now, with cover crop so portrait + landscape
  // both look intentional. Tap-to-fullscreen viewer is a follow-up.
  postMedia: {
    marginTop: 6,
    width: '100%',
    aspectRatio: 1,
    borderRadius: 6,
    backgroundColor: '#eee',
  },
  // Horizontal row holding the heart toggle + comments toggle —
  // sits below the post body, before the optional inline thread.
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginTop: 4,
  },
  // P4d: heart button. Outline-state heart is gray-ish; the active
  // (filled) state uses a warm-red so a liked post reads as "you
  // tapped it" even from across the screen.
  likeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 2,
  },
  likeButtonPressed: { opacity: 0.5 },
  likeIcon: { fontSize: 16, color: '#888' },
  likeIconActive: { color: '#e0245e' },
  likeCount: { fontSize: 12, color: '#555', fontWeight: '500' },
  // Inline "Comment" / "Hide comments" button.
  commentsToggle: {
    paddingVertical: 2,
  },
  commentsTogglePressed: { opacity: 0.5 },
  commentsToggleLabel: { fontSize: 12, color: '#555', fontWeight: '500' },
  // The trash icon floats in the top-right of the user's own posts
  // so it doesn't compete with the author / timestamp row.
  deleteButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    padding: 4,
  },
  deleteButtonPressed: { opacity: 0.5 },
  deleteIcon: { fontSize: 16 },
});
