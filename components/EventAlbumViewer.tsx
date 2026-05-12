import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  type EventMediaItem,
  deleteEventMedia,
  signEventMediaUrls,
} from '../lib/event-media-actions';
import { toast } from '../lib/toast';

type Props = {
  visible: boolean;
  /** Full ordered list of media items (newest-first — matches the
   * EventSheet album fetch). The viewer pages through this list
   * with Next / Prev buttons. */
  items: EventMediaItem[];
  /** Which item is centered when the viewer opens. */
  initialIndex: number;
  /** Used to gate the trash button — only the uploader OR the host
   * can delete. RLS enforces this server-side; the UI just hides
   * the affordance when the user isn't permitted. */
  currentUserId?: string;
  /** True when the viewer is the event host (allows moderation —
   * delete any photo on their event). Independent of
   * `currentUserId` so callers can pre-derive the host check from
   * `editing.owner.id === currentUserId`. */
  isHost: boolean;
  onClose: () => void;
  /** Fires after a successful delete. Parent uses this to remove the
   * deleted id from its `albumItems` (and refetch / re-sign as
   * needed). Argument is the deleted item's id so the parent can
   * filter the list without re-querying. */
  onDeleted: (id: string) => void;
};

/**
 * Full-screen modal that pages through the event's photos. Tap the
 * thumbnail row on the EventSheet to open the viewer at that item's
 * index. The bucket is private, so each photo is rendered from a
 * Supabase-signed URL (created on open + cached for the session).
 *
 * Pager UX is simple Next / Prev buttons rather than a swipe
 * carousel — keeps the implementation small and works reliably
 * across platforms. A swipe-gesture upgrade can come later if the
 * tap-target friction shows up in usage.
 *
 * Delete (trash icon, top right): visible only to the photo's
 * uploader or to the event host. Fires an Alert confirmation, then
 * calls `deleteEventMedia` and bubbles the id up via `onDeleted` so
 * the parent can drop it from its list without a round-trip.
 */
export function EventAlbumViewer({
  visible,
  items,
  initialIndex,
  currentUserId,
  isHost,
  onClose,
  onDeleted,
}: Props) {
  // `index` is the currently-displayed item position. Initialised
  // from `initialIndex` and reset every time the viewer opens (so a
  // re-open lands on the newly-supplied initial slot, not whatever
  // the user was scrolled to last time).
  const [index, setIndex] = useState<number>(initialIndex);
  // Map of storage_path → signed URL. Built on open via a single
  // batched `signEventMediaUrls` call. Re-built whenever the
  // viewer opens or the items list changes (so a freshly-uploaded
  // photo gets a URL without a manual refresh).
  const [urls, setUrls] = useState<Map<string, string>>(() => new Map());
  const [loadingUrls, setLoadingUrls] = useState<boolean>(false);
  const [deleting, setDeleting] = useState<boolean>(false);

  useEffect(() => {
    if (visible) setIndex(initialIndex);
  }, [visible, initialIndex]);

  const signAllUrls = useCallback(async () => {
    if (items.length === 0) {
      setUrls(new Map());
      return;
    }
    setLoadingUrls(true);
    try {
      const { data, error } = await signEventMediaUrls({
        paths: items.map((i) => i.storagePath),
      });
      if (error) {
        toast.error(error);
        return;
      }
      if (data) setUrls(data);
    } finally {
      setLoadingUrls(false);
    }
  }, [items]);

  useEffect(() => {
    if (visible) signAllUrls();
  }, [visible, signAllUrls]);

  // Clamp the index in case items shrinks (e.g. after a delete the
  // last item is removed but `index` still points at it). Always
  // points at a valid item OR at 0 when the list is empty.
  const safeIndex = items.length === 0 ? 0 : Math.min(index, items.length - 1);
  const current = items[safeIndex];

  const canDelete = useMemo(() => {
    if (!current) return false;
    if (isHost) return true;
    return currentUserId !== undefined && current.uploader.id === currentUserId;
  }, [current, isHost, currentUserId]);

  function handlePrev() {
    setIndex((i) => Math.max(0, i - 1));
  }
  function handleNext() {
    setIndex((i) => Math.min(items.length - 1, i + 1));
  }

  function handleDelete() {
    if (!current || deleting) return;
    Alert.alert('Delete this photo?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setDeleting(true);
          try {
            const { error } = await deleteEventMedia({
              id: current.id,
              storagePath: current.storagePath,
            });
            if (error) {
              toast.error(error);
              return;
            }
            onDeleted(current.id);
            // If this was the last item, step back so the next
            // photo (or close-viewer state) feels natural.
            if (safeIndex >= items.length - 1) {
              setIndex(Math.max(0, items.length - 2));
            }
          } finally {
            setDeleting(false);
          }
        },
      },
    ]);
  }

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent={false}
      animationType="fade"
      onRequestClose={onClose}
      // testID is on the wrapping SafeAreaView so existence
      // queries don't depend on Modal's host-component shape.
    >
      <SafeAreaView style={styles.container} testID="album-viewer">
        <View style={styles.header}>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close"
            hitSlop={12}
            style={({ pressed }) => [
              styles.closeButton,
              pressed && styles.closeButtonPressed,
            ]}
          >
            <Text style={styles.closeIcon}>×</Text>
          </Pressable>
          <Text style={styles.position} testID="album-position">
            {items.length === 0
              ? '0 of 0'
              : `${safeIndex + 1} of ${items.length}`}
          </Text>
          {canDelete ? (
            <Pressable
              onPress={handleDelete}
              accessibilityRole="button"
              accessibilityLabel="Delete photo"
              testID="album-delete"
              disabled={deleting}
              hitSlop={12}
              style={({ pressed }) => [
                styles.deleteButton,
                pressed && styles.deleteButtonPressed,
                deleting && styles.deleteButtonDisabled,
              ]}
            >
              <Text style={styles.deleteIcon}>🗑</Text>
            </Pressable>
          ) : (
            <View style={styles.headerSpacer} />
          )}
        </View>

        <View style={styles.photoArea}>
          {loadingUrls && urls.size === 0 ? (
            <ActivityIndicator color="#fff" />
          ) : current ? (
            <Image
              testID={`album-photo-${current.id}`}
              source={{ uri: urls.get(current.storagePath) ?? '' }}
              style={styles.photo}
              resizeMode="contain"
            />
          ) : (
            <Text style={styles.emptyText}>No photos to show</Text>
          )}
        </View>

        <View style={styles.footer}>
          <Pressable
            onPress={handlePrev}
            accessibilityRole="button"
            accessibilityLabel="Previous photo"
            testID="album-prev"
            disabled={safeIndex <= 0 || items.length === 0}
            style={({ pressed }) => [
              styles.pagerButton,
              pressed && styles.pagerButtonPressed,
              (safeIndex <= 0 || items.length === 0) && styles.pagerButtonDisabled,
            ]}
          >
            <Text style={styles.pagerLabel}>‹ Prev</Text>
          </Pressable>
          {current ? (
            <Text style={styles.uploaderLabel} numberOfLines={1}>
              {current.uploader.display_name}
            </Text>
          ) : null}
          <Pressable
            onPress={handleNext}
            accessibilityRole="button"
            accessibilityLabel="Next photo"
            testID="album-next"
            disabled={safeIndex >= items.length - 1 || items.length === 0}
            style={({ pressed }) => [
              styles.pagerButton,
              pressed && styles.pagerButtonPressed,
              (safeIndex >= items.length - 1 || items.length === 0) &&
                styles.pagerButtonDisabled,
            ]}
          >
            <Text style={styles.pagerLabel}>Next ›</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 12,
  },
  closeButton: { padding: 4 },
  closeButtonPressed: { opacity: 0.5 },
  closeIcon: { color: '#fff', fontSize: 28, lineHeight: 28 },
  position: {
    flex: 1,
    textAlign: 'center',
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  deleteButton: { padding: 4 },
  deleteButtonPressed: { opacity: 0.5 },
  deleteButtonDisabled: { opacity: 0.3 },
  deleteIcon: { fontSize: 20, color: '#fff' },
  headerSpacer: { width: 28 },
  photoArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000',
  },
  photo: { width: '100%', height: '100%' },
  emptyText: { color: '#888' },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  pagerButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#444',
  },
  pagerButtonPressed: { opacity: 0.6 },
  pagerButtonDisabled: { opacity: 0.3 },
  pagerLabel: { color: '#fff', fontSize: 13, fontWeight: '600' },
  uploaderLabel: {
    flex: 1,
    color: '#aaa',
    fontSize: 12,
    textAlign: 'center',
  },
});
