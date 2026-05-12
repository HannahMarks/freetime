import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Dimensions,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { FriendProfile } from '../lib/calendar-helpers';
import { formatTimeRange } from '../lib/calendar-helpers';
import {
  createEvent,
  deleteEvent,
  inviteFriends,
  respondToInvite,
  uninviteFriends,
  updateEvent,
} from '../lib/event-actions';
import {
  type EventInviteStatus,
  type EventItem,
  summarizeEventRecurrence,
} from '../lib/event-helpers';
import {
  type EventMediaItem,
  listEventMedia,
  uploadEventPhoto,
} from '../lib/event-media-actions';
import type { RecurrenceFreq, RecurrenceRule } from '../lib/recurrence';
import { toast } from '../lib/toast';
import { DatePicker } from './DatePicker';
import { TimePicker } from './TimePicker';

/** YYYY-MM-DD for a local-zone Date — used for the `until` field. */
function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseIsoDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// Same animation timings + behaviors as AddItemSheet — see comments
// there for the rationale (scale-in instead of bounce, swipe-down
// dismiss with continuous slide-off momentum, etc).
const SCREEN_HEIGHT = Dimensions.get('window').height;
const SHEET_TOP_OFFSET = 0;
const ENTER_DURATION_MS = 280;
const EXIT_DURATION_MS = 220;
const PLACEHOLDER_COLOR = '#b5b5b5';
const ENTRY_SCALE_FROM = 0.96;

type Props = {
  visible: boolean;
  /** YYYY-MM-DD used as the default start date for new events. */
  defaultDate: string;
  /** If set, the sheet opens on this event in view mode. The pencil
   * button switches to the edit form. */
  editing?: EventItem | null;
  /** Accepted-friend profiles that can be invited from the picker.
   * The parent (events screen) fetches these via `listFriendships`
   * and passes them in so the sheet doesn't have to know about the
   * friends action layer directly. Empty array is fine — the picker
   * just renders an empty state. */
  friends?: FriendProfile[];
  /** The signed-in user's id. Used to decide whether the sheet shows
   * host controls (pencil + trash on the editing item) OR invitee
   * controls (RSVP pills). When omitted, the sheet defaults to host
   * mode — tests that don't care about RSVP can skip this prop. */
  currentUserId?: string;
  onClose: () => void;
  /** Fires after a successful save OR delete. Parent should refetch. */
  onSaved: () => void;
};

function buildDate(dateStr: string, hour: number, minute: number): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d, hour, minute, 0, 0);
}

function withDate(prev: Date, picked: Date): Date {
  return new Date(
    picked.getFullYear(),
    picked.getMonth(),
    picked.getDate(),
    prev.getHours(),
    prev.getMinutes(),
    0,
    0,
  );
}

function withTime(prev: Date, picked: Date): Date {
  return new Date(
    prev.getFullYear(),
    prev.getMonth(),
    prev.getDate(),
    picked.getHours(),
    picked.getMinutes(),
    0,
    0,
  );
}

/** Append a 2-hex-digit alpha to a "#RRGGBB" hex. Inlined here so the
 * sheet doesn't depend on any other component's helper. Same as the
 * version in DayTimeline + the app layout's tab pill. */
function hexAlpha(hex: string, alpha: number): string {
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex}${a}`;
}

function formatLongDate(d: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(d);
}

/**
 * Full-page modal for viewing, editing, or creating an `event`.
 *
 * Slimmer than `AddItemSheet`: no kind toggle (events are always
 * time-ranged), no recurrence (event = single occurrence; users
 * "hosting every Friday's standup" would model that as a busy_block,
 * not an event), no copy action (we'll add invite-cloning when the
 * invites schema lands in H3).
 *
 * Three modes determined by props + state:
 *   - **Create** (no `editing` prop): heading "Plan an event", form
 *     body, Save button.
 *   - **View** (`editing` set, `formMode` false — default): heading
 *     shows the event title, body shows read-only details. Pencil +
 *     trash buttons in the header. No Save button.
 *   - **Edit** (`editing` set, `formMode` true — entered via pencil
 *     tap): heading "Edit event", form body pre-filled, Save button.
 */
export function EventSheet({
  visible,
  defaultDate,
  editing,
  friends,
  currentUserId,
  onClose,
  onSaved,
}: Props) {
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formMode, setFormMode] = useState<boolean>(!editing);
  // Set of friend ids selected to invite. In CREATE mode this starts
  // empty; in EDIT mode (H5b) it's seeded from `editing.attendees` so
  // existing invites show as already-selected chips, and the host can
  // add/remove by toggling. The save handler diffs against the
  // original set to compute add/remove batches.
  const [inviteeIds, setInviteeIds] = useState<Set<string>>(() => new Set());
  // Snapshot of the invitee ids at the time the sheet opened — used
  // by `runEditSave` to diff against the current selection and
  // compute what to invite vs uninvite. Stays empty in CREATE mode.
  const [originalInviteeIds, setOriginalInviteeIds] = useState<Set<string>>(
    () => new Set(),
  );
  // Recurrence. `repeats=false` → null rule on save (one-off). When
  // on, the rule is built from `freq` + optional `until`. Default
  // freq is 'weekly' so flipping the toggle on without picking a
  // chip produces a sensible rule (matches the AddItemSheet pattern).
  // Events don't expose byDay chips — keep the event UI simpler than
  // the busy UI; "every week on this day" is the implicit pattern.
  const [repeats, setRepeats] = useState<boolean>(false);
  const [freq, setFreq] = useState<RecurrenceFreq>('weekly');
  const [until, setUntil] = useState<string | null>(null);
  // Phase 3 P2a: photo album. Fetched on open when `editing` is set;
  // never fetched in CREATE mode (no event id yet). `albumUploading`
  // is a separate flag from `submitting` so the disabled state of
  // the Add Photo button doesn't disable Save / Delete during an
  // upload (and vice versa).
  const [albumItems, setAlbumItems] = useState<EventMediaItem[]>([]);
  const [albumLoading, setAlbumLoading] = useState<boolean>(false);
  const [albumUploading, setAlbumUploading] = useState<boolean>(false);

  // Default times for a NEW event: 6pm–9pm on the default date — a
  // reasonable host-side guess for "plan something with friends".
  const [start, setStart] = useState<Date>(() =>
    editing ? editing.startsAt : buildDate(defaultDate, 18, 0),
  );
  const [end, setEnd] = useState<Date>(() =>
    editing ? editing.endsAt : buildDate(defaultDate, 21, 0),
  );

  const [rendered, setRendered] = useState<boolean>(visible);
  const translateY = useSharedValue(visible ? 0 : SCREEN_HEIGHT);
  const scale = useSharedValue(visible ? 1 : ENTRY_SCALE_FROM);
  const backdropOpacity = useSharedValue(visible ? 0.4 : 0);

  useEffect(() => {
    if (visible) {
      setRendered(true);
      translateY.value = withSpring(0, { damping: 24, stiffness: 220, mass: 0.9 });
      scale.value = withSpring(1, { damping: 22, stiffness: 220, mass: 0.9 });
      backdropOpacity.value = withTiming(0.4, {
        duration: ENTER_DURATION_MS,
        easing: Easing.out(Easing.cubic),
      });
    } else if (rendered) {
      translateY.value = withTiming(
        SCREEN_HEIGHT,
        { duration: EXIT_DURATION_MS, easing: Easing.out(Easing.cubic) },
        (finished) => {
          if (finished) runOnJS(setRendered)(false);
        },
      );
      scale.value = withTiming(ENTRY_SCALE_FROM, {
        duration: EXIT_DURATION_MS,
        easing: Easing.out(Easing.cubic),
      });
      backdropOpacity.value = withTiming(0, {
        duration: EXIT_DURATION_MS,
        easing: Easing.out(Easing.cubic),
      });
    }
  }, [visible, rendered, translateY, scale, backdropOpacity]);

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }, { scale: scale.value }],
  }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdropOpacity.value }));

  // Reset whenever the sheet (re-)opens or the editing target changes.
  useEffect(() => {
    if (visible) {
      setTitle(editing?.title ?? '');
      setLocation(editing?.location ?? '');
      setNotes(editing?.notes ?? '');
      setStart(editing ? editing.startsAt : buildDate(defaultDate, 18, 0));
      setEnd(editing ? editing.endsAt : buildDate(defaultDate, 21, 0));
      setFormMode(!editing);
      // Seed both inviteeIds + originalInviteeIds from the editing
      // item's attendees. In CREATE mode both are empty; in EDIT
      // mode both reflect the current state of the world. The
      // ORIGINAL set never changes mid-session — the diff at save
      // time compares against this snapshot.
      const initialInvitees = new Set<string>(
        (editing?.attendees ?? []).map((a) => a.invitee.id),
      );
      setInviteeIds(initialInvitees);
      setOriginalInviteeIds(initialInvitees);
      // Pre-fill recurrence state from the editing event. null /
      // missing rule = one-off (toggle off, default to weekly so
      // turning the toggle ON later produces a usable rule).
      const editingRule = editing?.recurrenceRule ?? null;
      setRepeats(editingRule != null);
      setFreq(editingRule?.freq ?? 'weekly');
      setUntil(editingRule?.until ?? null);
      // Reset album state. The fetch fires from a separate effect
      // (below) so that albumItems update independently when the
      // user adds a new photo without re-running this whole block.
      setAlbumItems([]);
    }
  }, [visible, editing, defaultDate]);

  /** Build the RecurrenceRule to persist based on the current
   * toggle + freq + until state, or null when the toggle is off. */
  function buildRecurrenceRule(): RecurrenceRule | null {
    if (!repeats) return null;
    const rule: RecurrenceRule = { freq };
    if (until) rule.until = until;
    return rule;
  }

  /** Fetch the album for the editing event. Wrapped in useCallback
   * so the handler that fires after an upload can reuse the same
   * function reference. Bails when there's no editing event
   * (CREATE mode — no id yet). */
  const refetchAlbum = useCallback(async () => {
    if (!editing) return;
    setAlbumLoading(true);
    try {
      const { data, error } = await listEventMedia({ eventId: editing.id });
      if (error) {
        // The album is a secondary surface — toast but don't block
        // the rest of the sheet from rendering.
        toast.error(error);
        return;
      }
      if (data) setAlbumItems(data);
    } finally {
      setAlbumLoading(false);
    }
  }, [editing]);

  useEffect(() => {
    if (visible && editing) {
      refetchAlbum();
    }
  }, [visible, editing, refetchAlbum]);

  /** Add-photo handler. Launches the image picker, then hands the
   * resulting URI off to `uploadEventPhoto` (which does the
   * compress + storage upload + metadata insert). On success the
   * album refetches so the new photo appears. */
  async function handleAddPhoto() {
    if (!editing || albumUploading) return;
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        toast.error('Photo library access is needed to upload.');
        return;
      }
      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 1, // we re-compress in uploadEventPhoto
      });
      if (picked.canceled || picked.assets.length === 0) return;
      const uri = picked.assets[0].uri;
      setAlbumUploading(true);
      const { error } = await uploadEventPhoto({ eventId: editing.id, uri });
      if (error) {
        toast.error(error);
        return;
      }
      await refetchAlbum();
    } finally {
      setAlbumUploading(false);
    }
  }

  // Swipe-down dismiss — same gesture pattern as AddItemSheet (see
  // comments there for the activation-offset trick + continuous
  // slide-off momentum).
  const dismissActivationY = useSharedValue(0);
  const dismissPan = Gesture.Pan()
    .minDistance(6)
    .onStart((e) => {
      dismissActivationY.value = e.translationY;
    })
    .onUpdate((e) => {
      translateY.value = Math.max(0, e.translationY - dismissActivationY.value);
    })
    .onEnd((e) => {
      const shouldDismiss = e.translationY > SCREEN_HEIGHT * 0.18 || e.velocityY > 450;
      if (shouldDismiss) {
        translateY.value = withTiming(
          SCREEN_HEIGHT,
          { duration: 240, easing: Easing.out(Easing.cubic) },
          (finished) => {
            if (finished) runOnJS(onClose)();
          },
        );
        backdropOpacity.value = withTiming(0, {
          duration: 240,
          easing: Easing.out(Easing.cubic),
        });
        scale.value = withTiming(ENTRY_SCALE_FROM, {
          duration: 240,
          easing: Easing.out(Easing.cubic),
        });
      } else {
        translateY.value = withSpring(0, { damping: 28, stiffness: 200, mass: 0.9 });
      }
    });

  async function handleSave() {
    if (submitting) return;
    setSubmitting(true);
    try {
      const trimmedTitle = title.trim() || null;
      const trimmedLocation = location.trim() || null;
      const trimmedNotes = notes.trim() || null;
      if (end <= start) {
        toast.error('End time must be after start time.');
        return;
      }
      const recurrenceRule = buildRecurrenceRule();
      if (editing) {
        const { error } = await updateEvent({
          id: editing.id,
          startsAt: start,
          endsAt: end,
          title: trimmedTitle,
          notes: trimmedNotes,
          location: trimmedLocation,
          recurrenceRule,
        });
        if (error) {
          toast.error(error);
          return;
        }
        // H5b: diff the picker selection against the original
        // attendees to compute the invite + uninvite batches.
        // Empty batches no-op via the action layer, so we can fire
        // both unconditionally without burning a round-trip when
        // there's nothing to send. If one succeeds and the other
        // fails (rare — Postgres-level network blip mid-flight), we
        // toast the failure but still report success on the event
        // itself; the parent refetch picks up whatever DID land.
        const toInvite: string[] = [];
        const toUninvite: string[] = [];
        for (const id of inviteeIds) {
          if (!originalInviteeIds.has(id)) toInvite.push(id);
        }
        for (const id of originalInviteeIds) {
          if (!inviteeIds.has(id)) toUninvite.push(id);
        }
        if (toInvite.length > 0) {
          const { error: inviteError } = await inviteFriends({
            eventId: editing.id,
            inviteeIds: toInvite,
          });
          if (inviteError) toast.error(inviteError);
        }
        if (toUninvite.length > 0) {
          const { error: uninviteError } = await uninviteFriends({
            eventId: editing.id,
            inviteeIds: toUninvite,
          });
          if (uninviteError) toast.error(uninviteError);
        }
      } else {
        // Create path: createEvent returns the new id, then we
        // chain inviteFriends with whatever the user picked.
        // If invites fail, the event itself still landed (a partial
        // success) — we toast the invite error so the user knows but
        // don't roll back the event. Re-creating with the same picker
        // selection on retry would just no-op via ignoreDuplicates.
        const { id, error } = await createEvent({
          startsAt: start,
          endsAt: end,
          title: trimmedTitle,
          notes: trimmedNotes,
          location: trimmedLocation,
          recurrenceRule,
        });
        if (error || !id) {
          toast.error(error ?? "Couldn't create event. Please try again.");
          return;
        }
        if (inviteeIds.size > 0) {
          const { error: inviteError } = await inviteFriends({
            eventId: id,
            inviteeIds: Array.from(inviteeIds),
          });
          if (inviteError) {
            toast.error(inviteError);
            // Fall through — the event itself was created.
          }
        }
      }
      onSaved();
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  function handleEdit() {
    if (!editing || submitting) return;
    setFormMode(true);
  }

  function handleDelete() {
    if (!editing || submitting) return;
    Alert.alert('Delete this event?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setSubmitting(true);
          try {
            const { error } = await deleteEvent(editing.id);
            if (error) {
              toast.error(error);
              return;
            }
            onSaved();
            onClose();
          } finally {
            setSubmitting(false);
          }
        },
      },
    ]);
  }

  const inViewMode = !!editing && !formMode;
  const heading = !editing
    ? 'Plan an event'
    : inViewMode
      ? (editing.title ?? '')
      : 'Edit event';
  // Role gating for the controls. When the user is the HOST of the
  // event they're viewing, the header shows pencil + trash and the
  // pencil opens the edit form. When they're an INVITEE (not the
  // host, but they have an invite row), the header hides those
  // controls and the body shows RSVP pills instead. Defaults to host
  // mode when `currentUserId` is omitted (e.g. in some tests).
  const isHost = !editing || !currentUserId || editing.owner.id === currentUserId;
  // The user's own attendee row, if any. Used to (a) decide whether
  // to show RSVP pills (only if there IS an invite for them) and
  // (b) highlight the currently-selected status.
  const myRsvp = editing?.attendees?.find(
    (a) => currentUserId !== undefined && a.invitee.id === currentUserId,
  );

  async function handleRespond(status: EventInviteStatus) {
    if (!editing || submitting) return;
    setSubmitting(true);
    try {
      const { error } = await respondToInvite({ eventId: editing.id, status });
      if (error) {
        toast.error(error);
        return;
      }
      onSaved();
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  const viewDate = editing ? formatLongDate(editing.startsAt) : null;
  const viewTimeRange = editing ? formatTimeRange(editing.startsAt, editing.endsAt) : null;

  return (
    <Modal
      visible={rendered}
      animationType="none"
      transparent
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
    >
      <Animated.View
        pointerEvents={rendered ? 'auto' : 'none'}
        style={[styles.backdrop, backdropStyle]}
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityLabel="Dismiss backdrop"
        />
      </Animated.View>
      <GestureDetector gesture={dismissPan}>
        <Animated.View style={[styles.sheet, sheetStyle]} collapsable={false}>
          <SafeAreaView style={styles.container} testID="event-sheet">
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
              <Text style={styles.heading} numberOfLines={1}>{heading}</Text>
              {editing && isHost ? (
                // Host of this event in view mode — show pencil + trash.
                // Hidden for invitees (they get RSVP pills in the body
                // instead) and in edit mode (no buttons needed there).
                <View style={styles.headerRight}>
                  {inViewMode ? (
                    <>
                      <Pressable
                        onPress={handleEdit}
                        accessibilityRole="button"
                        accessibilityLabel="Edit"
                        testID="event-sheet-edit"
                        hitSlop={12}
                        style={({ pressed }) => [
                          styles.headerIconButton,
                          pressed && styles.headerIconButtonPressed,
                        ]}
                      >
                        {/* Manual pencil glyph, same construction as
                            AddItemSheet's pencil (V chevron approach
                            but for a diagonal line) — keeps the icon
                            consistent across iOS/Android. */}
                        <View style={styles.pencilIcon}>
                          <View style={styles.pencilBody} />
                          <View style={styles.pencilTip} />
                        </View>
                      </Pressable>
                      <Pressable
                        onPress={handleDelete}
                        accessibilityRole="button"
                        accessibilityLabel="Delete event"
                        testID="event-sheet-delete"
                        hitSlop={12}
                        style={({ pressed }) => [
                          styles.headerIconButton,
                          pressed && styles.headerIconButtonPressed,
                        ]}
                      >
                        <Text style={styles.trashIcon}>🗑</Text>
                      </Pressable>
                    </>
                  ) : null}
                </View>
              ) : (
                <View style={styles.headerSpacer} />
              )}
            </View>

            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
              style={styles.flex}
            >
              {inViewMode ? (
                <ScrollView contentContainerStyle={styles.viewBody}>
                  <View style={styles.viewRow}>
                    <Text style={styles.viewLabel}>When</Text>
                    <Text style={styles.viewValue} testID="view-date">{viewDate}</Text>
                    <Text style={styles.viewValue} testID="view-time">{viewTimeRange}</Text>
                  </View>
                  {editing?.location ? (
                    <View style={styles.viewRow}>
                      <Text style={styles.viewLabel}>Location</Text>
                      <Text style={styles.viewValue} testID="view-location">
                        {editing.location}
                      </Text>
                    </View>
                  ) : null}
                  {editing?.notes ? (
                    <View style={styles.viewRow}>
                      <Text style={styles.viewLabel}>Notes</Text>
                      <Text style={styles.viewValue} testID="view-notes">{editing.notes}</Text>
                    </View>
                  ) : null}
                  {editing?.recurrenceRule ? (
                    <View style={styles.viewRow}>
                      <Text style={styles.viewLabel}>Repeats</Text>
                      <Text style={styles.viewValue} testID="view-recurrence">
                        {summarizeEventRecurrence(
                          editing.recurrenceRule,
                          // For an expanded occurrence, `startsAt`
                          // varies per occurrence — the summary should
                          // be anchored on a consistent base. Use the
                          // occurrence's startsAt; for weekly + yearly
                          // that produces the right label per-day.
                          // (Monthly/yearly "on the 15th" reads the
                          // same regardless of which occurrence.)
                          editing.startsAt,
                        )}
                      </Text>
                    </View>
                  ) : null}
                  {editing?.attendees && editing.attendees.length > 0 ? (
                    <View style={styles.viewRow}>
                      <Text style={styles.viewLabel}>Invited</Text>
                      <Text style={styles.viewValue} testID="view-attendees">
                        {editing.attendees
                          .map(
                            (a) =>
                              `${a.invitee.display_name}${
                                a.status !== 'pending' ? ` (${a.status})` : ''
                              }`,
                          )
                          .join(', ')}
                      </Text>
                    </View>
                  ) : null}
                  {/* Album section (Phase 3 P2a). Visible to event
                      attendees only — host OR an accepted invitee.
                      Pending / declined / maybe invitees can't add
                      photos, matching the storage.objects RLS.
                      For now we show just the count + an "Add photo"
                      button; the grid view + full-screen pager
                      ship in P2b. */}
                  {editing && (isHost || myRsvp?.status === 'accepted') ? (
                    <View style={styles.viewRow} testID="album-section">
                      <Text style={styles.viewLabel}>Album</Text>
                      <Text style={styles.viewValue} testID="album-count">
                        {albumLoading
                          ? 'Loading…'
                          : albumItems.length === 0
                            ? 'No photos yet'
                            : `${albumItems.length} ${albumItems.length === 1 ? 'photo' : 'photos'}`}
                      </Text>
                      <Pressable
                        onPress={handleAddPhoto}
                        accessibilityRole="button"
                        accessibilityLabel="Add photo"
                        disabled={albumUploading}
                        testID="album-add-photo"
                        style={({ pressed }) => [
                          styles.albumAddButton,
                          pressed && styles.albumAddButtonPressed,
                          albumUploading && styles.albumAddButtonDisabled,
                        ]}
                      >
                        <Text style={styles.albumAddLabel}>
                          {albumUploading ? 'Uploading…' : '+ Add photo'}
                        </Text>
                      </Pressable>
                    </View>
                  ) : null}
                  {/* Invitee RSVP pills. Visible only when the user
                      is NOT the host AND has an invite row on this
                      event. Tapping a pill flips their RSVP via
                      `respondToInvite` and closes the sheet — the
                      parent refetches on `onSaved` so the list re-
                      renders with the new status. The currently-
                      selected pill is filled (dark). */}
                  {editing && !isHost && myRsvp ? (
                    <View style={styles.viewRow} testID="rsvp-pills">
                      <Text style={styles.viewLabel}>Your RSVP</Text>
                      <View style={styles.rsvpRow}>
                        {(['accepted', 'declined', 'maybe'] as const).map((status) => {
                          const isCurrent = myRsvp.status === status;
                          return (
                            <Pressable
                              key={status}
                              onPress={() => handleRespond(status)}
                              accessibilityRole="button"
                              accessibilityLabel={
                                status === 'accepted'
                                  ? "I'm going"
                                  : status === 'declined'
                                    ? "Can't make it"
                                    : 'Maybe'
                              }
                              accessibilityState={{ selected: isCurrent }}
                              testID={`rsvp-${status}`}
                              disabled={submitting}
                              style={({ pressed }) => [
                                styles.rsvpPill,
                                isCurrent && styles.rsvpPillSelected,
                                pressed && !submitting && styles.rsvpPillPressed,
                              ]}
                            >
                              <Text
                                style={
                                  isCurrent
                                    ? styles.rsvpPillLabelSelected
                                    : styles.rsvpPillLabel
                                }
                              >
                                {status === 'accepted'
                                  ? 'Going'
                                  : status === 'declined'
                                    ? "Can't go"
                                    : 'Maybe'}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </View>
                  ) : null}
                </ScrollView>
              ) : (
                <ScrollView
                  contentContainerStyle={styles.body}
                  keyboardShouldPersistTaps="handled"
                >
                  <View style={styles.field}>
                    <TextInput
                      testID="input-title"
                      placeholder="Title (optional)"
                      placeholderTextColor={PLACEHOLDER_COLOR}
                      style={styles.input}
                      value={title}
                      onChangeText={setTitle}
                    />
                  </View>

                  <View style={styles.timeRow}>
                    <Text style={styles.label}>Starts</Text>
                    <View style={styles.pickerGroup}>
                      <DatePicker
                        testID="date-picker-start"
                        value={start}
                        onChange={(picked) => setStart((prev) => withDate(prev, picked))}
                      />
                      <TimePicker
                        testID="time-picker-start"
                        value={start}
                        onChange={(picked) => setStart((prev) => withTime(prev, picked))}
                      />
                    </View>
                  </View>

                  <View style={styles.timeRow}>
                    <Text style={styles.label}>Ends</Text>
                    <View style={styles.pickerGroup}>
                      <DatePicker
                        testID="date-picker-end"
                        value={end}
                        onChange={(picked) => setEnd((prev) => withDate(prev, picked))}
                      />
                      <TimePicker
                        testID="time-picker-end"
                        value={end}
                        onChange={(picked) => setEnd((prev) => withTime(prev, picked))}
                      />
                    </View>
                  </View>

                  <View style={styles.field}>
                    <TextInput
                      testID="input-location"
                      placeholder="Location (optional)"
                      placeholderTextColor={PLACEHOLDER_COLOR}
                      style={styles.input}
                      value={location}
                      onChangeText={setLocation}
                    />
                  </View>

                  <View style={styles.field}>
                    <TextInput
                      testID="input-notes"
                      placeholder="Notes (optional)"
                      placeholderTextColor={PLACEHOLDER_COLOR}
                      style={[styles.input, styles.notesInput]}
                      value={notes}
                      onChangeText={setNotes}
                      multiline
                      textAlignVertical="top"
                    />
                  </View>

                  {/* Recurrence. Hand-rolled mini-switch (not RN's
                      Switch) matches the AddItemSheet visual. Toggle
                      OFF → null rule on save (one-off). Toggle ON →
                      pick a Frequency chip; optionally an Ends-on-a-
                      date sub-toggle to add an `until` cap.
                      Unlike AddItemSheet, EventSheet skips weekly
                      byDay chips — events recur on the base's day. */}
                  <Pressable
                    onPress={() => setRepeats((v) => !v)}
                    accessibilityRole="switch"
                    accessibilityState={{ checked: repeats }}
                    accessibilityLabel="Repeat event"
                    testID="event-repeat-toggle"
                    style={({ pressed }) => [
                      styles.repeatRow,
                      pressed && styles.repeatRowPressed,
                    ]}
                  >
                    <Text style={styles.repeatLabel}>Repeats</Text>
                    <View
                      style={[
                        styles.repeatSwitch,
                        repeats && styles.repeatSwitchOn,
                      ]}
                    >
                      <View
                        style={[
                          styles.repeatSwitchKnob,
                          repeats && styles.repeatSwitchKnobOn,
                        ]}
                      />
                    </View>
                  </Pressable>

                  {repeats ? (
                    <>
                      <View style={styles.freqRow}>
                        {(['weekly', 'monthly', 'yearly'] as const).map((f) => {
                          const selected = freq === f;
                          return (
                            <Pressable
                              key={f}
                              onPress={() => setFreq(f)}
                              accessibilityRole="radio"
                              accessibilityState={{ checked: selected }}
                              accessibilityLabel={`Repeat ${f}`}
                              testID={`event-freq-${f}`}
                              style={[
                                styles.freqChip,
                                selected && styles.freqChipSelected,
                              ]}
                            >
                              <Text
                                style={
                                  selected
                                    ? styles.freqChipLabelSelected
                                    : styles.freqChipLabel
                                }
                              >
                                {f === 'weekly'
                                  ? 'Weekly'
                                  : f === 'monthly'
                                    ? 'Monthly'
                                    : 'Yearly'}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>

                      <Pressable
                        onPress={() => {
                          if (until) {
                            setUntil(null);
                          } else {
                            // Seed a reasonable default: 1 unit of
                            // the freq past the start. For weekly,
                            // that's +3 months (covers ~13 weekly
                            // occurrences) so the default cap feels
                            // useful; for monthly/yearly, +1 year.
                            const def = new Date(start);
                            if (freq === 'weekly') {
                              def.setMonth(def.getMonth() + 3);
                            } else {
                              def.setFullYear(def.getFullYear() + 1);
                            }
                            setUntil(toIsoDate(def));
                          }
                        }}
                        accessibilityRole="switch"
                        accessibilityState={{ checked: until != null }}
                        accessibilityLabel="Set an end date"
                        testID="event-until-toggle"
                        style={({ pressed }) => [
                          styles.repeatRow,
                          pressed && styles.repeatRowPressed,
                        ]}
                      >
                        <Text style={styles.repeatLabel}>Ends on a date</Text>
                        <View
                          style={[
                            styles.repeatSwitch,
                            until != null && styles.repeatSwitchOn,
                          ]}
                        >
                          <View
                            style={[
                              styles.repeatSwitchKnob,
                              until != null && styles.repeatSwitchKnobOn,
                            ]}
                          />
                        </View>
                      </Pressable>

                      {until ? (
                        <View style={styles.untilRow}>
                          <Text style={styles.label}>Ends</Text>
                          <DatePicker
                            testID="event-until-picker"
                            value={parseIsoDate(until)}
                            onChange={(picked) => setUntil(toIsoDate(picked))}
                          />
                        </View>
                      ) : null}
                    </>
                  ) : null}

                  {/* Invite picker — renders in CREATE and EDIT mode
                      (H5b). In edit mode, chips for already-invited
                      friends start pre-selected (seeded from
                      `editing.attendees` in the reset effect); the
                      save handler diffs against that snapshot to
                      compute invite + uninvite batches. Friend list
                      comes in via the parent so the sheet stays
                      side-effect-free. Empty state when there are
                      no accepted friends. */}
                  <View style={styles.field} testID="invite-picker">
                    <Text style={styles.label}>Invite friends</Text>
                      {(friends ?? []).length === 0 ? (
                        <Text style={styles.inviteEmpty}>
                          No friends to invite yet — add some from the
                          Friends tab first.
                        </Text>
                      ) : (
                        <View style={styles.chipRow}>
                          {(friends ?? []).map((f) => {
                            const selected = inviteeIds.has(f.id);
                            return (
                              <Pressable
                                key={f.id}
                                onPress={() => {
                                  setInviteeIds((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(f.id)) next.delete(f.id);
                                    else next.add(f.id);
                                    return next;
                                  });
                                }}
                                accessibilityRole="checkbox"
                                accessibilityState={{ checked: selected }}
                                accessibilityLabel={`Invite ${f.display_name}`}
                                testID={`invite-chip-${f.id}`}
                                style={[
                                  styles.inviteChip,
                                  {
                                    // Always carries the friend's own color
                                    // on the left bar so the chip reads as
                                    // "this person". Selected state fills
                                    // the rest of the chip with a tint of
                                    // that color so the affordance is
                                    // visually obvious without depending on
                                    // text styling alone.
                                    borderLeftColor: f.color,
                                  },
                                  selected && {
                                    backgroundColor: hexAlpha(f.color, 0.22),
                                    borderColor: f.color,
                                  },
                                ]}
                              >
                                <Text
                                  style={
                                    selected
                                      ? styles.inviteChipLabelSelected
                                      : styles.inviteChipLabel
                                  }
                                >
                                  {f.display_name}
                                </Text>
                              </Pressable>
                            );
                          })}
                        </View>
                      )}
                  </View>
                </ScrollView>
              )}
            </KeyboardAvoidingView>

            {!inViewMode ? (
              <View style={styles.footer}>
                <Pressable
                  onPress={handleSave}
                  accessibilityRole="button"
                  accessibilityLabel="Save"
                  disabled={submitting}
                  style={({ pressed }) => [
                    styles.save,
                    pressed && styles.savePressed,
                    submitting && styles.saveDisabled,
                  ]}
                >
                  <Text style={styles.saveLabel}>{submitting ? 'Saving…' : 'Save'}</Text>
                </Pressable>
              </View>
            ) : null}
          </SafeAreaView>
        </Animated.View>
      </GestureDetector>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000' },
  sheet: {
    position: 'absolute',
    top: SHEET_TOP_OFFSET,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#fff',
    overflow: 'hidden',
  },
  container: { flex: 1, backgroundColor: '#fff' },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 52,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eee',
  },
  closeButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
  },
  closeButtonPressed: { backgroundColor: '#f0f0f0' },
  closeIcon: { fontSize: 28, lineHeight: 30, color: '#111', fontWeight: '300' },
  heading: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '600', color: '#111' },
  headerSpacer: { width: 36, height: 36 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  headerIconButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
  },
  headerIconButtonPressed: { backgroundColor: '#f0f0f0' },
  trashIcon: { fontSize: 18, color: '#111' },
  pencilIcon: { width: 22, height: 22, transform: [{ rotate: '-45deg' }] },
  pencilBody: {
    position: 'absolute',
    width: 5,
    height: 14,
    top: 2,
    left: 8.5,
    backgroundColor: '#111',
  },
  pencilTip: {
    position: 'absolute',
    top: 16,
    left: 8.5,
    width: 0,
    height: 0,
    borderLeftWidth: 2.5,
    borderLeftColor: 'transparent',
    borderRightWidth: 2.5,
    borderRightColor: 'transparent',
    borderTopWidth: 4,
    borderTopColor: '#111',
  },
  body: { paddingHorizontal: 20, paddingVertical: 16, gap: 16 },
  viewBody: { paddingHorizontal: 24, paddingVertical: 24, gap: 28 },
  viewRow: { gap: 6 },
  viewLabel: {
    fontSize: 12,
    color: '#888',
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  viewValue: { fontSize: 17, color: '#111', lineHeight: 24 },
  field: { gap: 6 },
  label: { fontSize: 13, fontWeight: '500', color: '#444' },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
  },
  notesInput: { minHeight: 96 },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  pickerGroup: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#eee',
    gap: 10,
  },
  save: { paddingVertical: 9, borderRadius: 8, backgroundColor: '#111', alignItems: 'center' },
  savePressed: { opacity: 0.85 },
  saveDisabled: { opacity: 0.5 },
  saveLabel: { fontSize: 14, color: '#fff', fontWeight: '600' },
  // Invite-picker layout: chips wrap onto multiple rows since a host
  // could have a couple dozen friends. flexWrap + gap keeps the row
  // visually tidy without manual measurement.
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  inviteChip: {
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#ddd',
    borderLeftWidth: 4,
    backgroundColor: '#fff',
  },
  inviteChipLabel: { fontSize: 13, color: '#444' },
  inviteChipLabelSelected: { fontSize: 13, color: '#111', fontWeight: '600' },
  inviteEmpty: { fontSize: 13, color: '#888', lineHeight: 18 },
  // Recurrence section. Visual parity with AddItemSheet's
  // recurrence widgets (`repeatRow` + `repeatSwitch` look) so the
  // toggle reads the same across the two sheets, but the values
  // are duplicated locally to keep EventSheet free of cross-sheet
  // style imports.
  repeatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  repeatRowPressed: { opacity: 0.6 },
  repeatLabel: { fontSize: 14, color: '#222' },
  repeatSwitch: {
    width: 38,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#ddd',
    padding: 2,
    justifyContent: 'center',
  },
  repeatSwitchOn: { backgroundColor: '#111' },
  repeatSwitchKnob: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#fff',
  },
  repeatSwitchKnobOn: { transform: [{ translateX: 16 }] },
  freqRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
    marginTop: 4,
  },
  freqChip: {
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#ddd',
    backgroundColor: '#fff',
  },
  freqChipSelected: {
    borderColor: '#111',
    backgroundColor: '#111',
  },
  freqChipLabel: { fontSize: 13, color: '#444' },
  freqChipLabelSelected: { fontSize: 13, color: '#fff', fontWeight: '600' },
  untilRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 4,
  },
  // Album "+ Add photo" button. Outline-style rounded pill in a
  // neutral dark — kept distinct from the filled Save / RSVP
  // buttons so the affordance reads as secondary (the album is a
  // side-feature, not the primary event action).
  albumAddButton: {
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#111',
    marginTop: 4,
  },
  albumAddButtonPressed: { opacity: 0.6 },
  albumAddButtonDisabled: { opacity: 0.45 },
  albumAddLabel: { fontSize: 13, color: '#111', fontWeight: '600' },
  // Invitee RSVP pills. Three side-by-side rounded buttons; the
  // currently-selected one fills (dark bg + white text) for an
  // unambiguous "this is my RSVP" affordance.
  rsvpRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  rsvpPill: {
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#ddd',
    backgroundColor: '#fff',
  },
  rsvpPillSelected: { backgroundColor: '#111', borderColor: '#111' },
  rsvpPillPressed: { opacity: 0.7 },
  rsvpPillLabel: { fontSize: 14, color: '#444' },
  rsvpPillLabelSelected: { fontSize: 14, color: '#fff', fontWeight: '600' },
});
