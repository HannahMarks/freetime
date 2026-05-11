import { useEffect, useState } from 'react';
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
  updateEvent,
} from '../lib/event-actions';
import type { EventItem } from '../lib/event-helpers';
import { toast } from '../lib/toast';
import { DatePicker } from './DatePicker';
import { TimePicker } from './TimePicker';

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
  onClose,
  onSaved,
}: Props) {
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formMode, setFormMode] = useState<boolean>(!editing);
  // Set of friend ids selected to invite. Only relevant in CREATE
  // mode — edit-and-add and edit-and-remove invitees comes in H5's
  // event-detail view. We reset this whenever the sheet opens.
  const [inviteeIds, setInviteeIds] = useState<Set<string>>(() => new Set());

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
      setInviteeIds(new Set());
    }
  }, [visible, editing, defaultDate]);

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
      if (editing) {
        const { error } = await updateEvent({
          id: editing.id,
          startsAt: start,
          endsAt: end,
          title: trimmedTitle,
          notes: trimmedNotes,
          location: trimmedLocation,
        });
        if (error) {
          toast.error(error);
          return;
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
              {editing ? (
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

                  {/* Invite picker (CREATE mode only — adding /
                      removing invitees on an existing event lives in
                      the H5 event-detail view). Renders a chip per
                      accepted friend; tapping toggles selection. The
                      friend list comes in via the parent — we don't
                      fetch it here to keep this component side-
                      effect-free. Empty state when there are no
                      accepted friends: hints how to get there. */}
                  {!editing ? (
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
                  ) : null}
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
});
