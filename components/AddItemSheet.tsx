import { useEffect, useMemo, useState } from 'react';
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
import {
  createBusyBlock,
  createUnavailableDay,
  deleteBusyBlock,
  deleteUnavailableDay,
  updateBusyBlock,
  updateUnavailableDay,
} from '../lib/availability-actions';
import { CalendarItem, formatTimeRange } from '../lib/calendar-helpers';
import { toast } from '../lib/toast';
import { DatePicker } from './DatePicker';
import { TimePicker } from './TimePicker';

const SCREEN_HEIGHT = Dimensions.get('window').height;
const SHEET_TOP_OFFSET = 60;
const ENTER_DURATION_MS = 240;
const EXIT_DURATION_MS = 200;
/** Faded color for placeholder text + the "(optional)" hint inside inputs. */
const PLACEHOLDER_COLOR = '#b5b5b5';

type Kind = 'busy' | 'unavailable';

type Props = {
  visible: boolean;
  selectedDate: string; // YYYY-MM-DD
  /**
   * If set, the sheet pre-fills with this item. Tapping an existing item
   * opens this sheet in *view* mode (read-only details). Tapping the
   * pencil button switches to edit mode (form). Save calls update;
   * the three-dots menu offers Copy / Delete.
   */
  editing?: CalendarItem | null;
  onClose: () => void;
  /** Fires after a successful save OR delete. Parent should refetch. */
  onSaved: () => void;
};

/** Build a Date for the selected day at the given local hour:minute. */
function buildDate(dateStr: string, hour: number, minute: number): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d, hour, minute, 0, 0);
}

/** Replace the year/month/day of `prev` with those of `picked`, preserving
 * `prev`'s hour and minute. Used so picking a date doesn't clobber the
 * already-picked time. */
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

/** Replace the hour/minute of `prev` with those of `picked`, preserving
 * `prev`'s date. */
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

/** Format a single date as "Wednesday, May 13, 2026" for view mode. */
function formatLongDate(d: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(d);
}

/**
 * Full-page modal for viewing, editing, or creating a busy_block /
 * unavailable_day.
 *
 * Three modes determined by props + state:
 *   - **Create** (no `editing` prop): heading "Add to your day", form body,
 *     Save button, kind toggle visible.
 *   - **View** (`editing` set, `formMode` false — default when opened):
 *     heading shows the event title, body shows read-only details
 *     (date / time / location / notes). Pencil button + three-dots menu
 *     in the header. No Save button.
 *   - **Edit** (`editing` set, `formMode` true — entered via pencil tap):
 *     heading "Edit", form body pre-filled, Save button.
 */
export function AddItemSheet({ visible, selectedDate, editing, onClose, onSaved }: Props) {
  const editingKind: Kind | null = editing
    ? editing.kind === 'busy_block'
      ? 'busy'
      : 'unavailable'
    : null;

  const [kind, setKind] = useState<Kind>(editingKind ?? 'busy');
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // True = render the form (inputs); false = render read-only details.
  // For an existing item, defaults to view (false) — the user has to tap
  // the pencil to start editing. Creation mode (no `editing`) is always
  // form-mode.
  const [formMode, setFormMode] = useState<boolean>(!editing);
  // Custom popover menu state — opens below the three-dots button.
  const [menuOpen, setMenuOpen] = useState<boolean>(false);

  const initialStart = useMemo(() => {
    if (editing?.kind === 'busy_block') return editing.startsAt;
    return buildDate(selectedDate, 9, 0);
  }, [editing, selectedDate]);
  const initialEnd = useMemo(() => {
    if (editing?.kind === 'busy_block') return editing.endsAt;
    return buildDate(selectedDate, 10, 0);
  }, [editing, selectedDate]);

  const [start, setStart] = useState<Date>(initialStart);
  const [end, setEnd] = useState<Date>(initialEnd);

  // `rendered` lags behind `visible` so we can play an exit animation
  // before the Modal actually unmounts. Mount immediately on open;
  // unmount only after the slide-down completes.
  const [rendered, setRendered] = useState<boolean>(visible);
  const translateY = useSharedValue(visible ? 0 : SCREEN_HEIGHT);
  const scale = useSharedValue(visible ? 1 : 0.94);
  const backdropOpacity = useSharedValue(visible ? 0.4 : 0);

  useEffect(() => {
    if (visible) {
      setRendered(true);
      // Slightly bouncier spring for the slide-up; scale-in on top
      // gives the sheet more presence when it lands.
      translateY.value = withSpring(0, {
        damping: 18,
        stiffness: 220,
        mass: 0.9,
      });
      scale.value = withSpring(1, {
        damping: 16,
        stiffness: 220,
        mass: 0.9,
      });
      backdropOpacity.value = withTiming(0.4, {
        duration: ENTER_DURATION_MS,
        easing: Easing.out(Easing.cubic),
      });
    } else if (rendered) {
      translateY.value = withTiming(
        SCREEN_HEIGHT,
        { duration: EXIT_DURATION_MS, easing: Easing.in(Easing.cubic) },
        (finished) => {
          if (finished) runOnJS(setRendered)(false);
        },
      );
      scale.value = withTiming(0.94, {
        duration: EXIT_DURATION_MS,
        easing: Easing.in(Easing.cubic),
      });
      backdropOpacity.value = withTiming(0, {
        duration: EXIT_DURATION_MS,
        easing: Easing.in(Easing.cubic),
      });
    }
  }, [visible, rendered, translateY, scale, backdropOpacity]);

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }, { scale: scale.value }],
  }));
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
  }));

  // Swipe-down to dismiss. minDistance(8) activates after 8px of
  // touch movement in ANY direction — important for catching swipes
  // that start on text/inputs/the ScrollView body, where directional
  // activation thresholds were getting absorbed by the inner scroll.
  // We still only translate on downward motion (negative translations
  // are clamped to 0).
  const dismissPan = Gesture.Pan()
    .minDistance(8)
    .onUpdate((e) => {
      translateY.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      const shouldDismiss =
        e.translationY > SCREEN_HEIGHT * 0.2 || e.velocityY > 500;
      if (shouldDismiss) {
        runOnJS(onClose)();
      } else {
        translateY.value = withSpring(0, {
          damping: 22,
          stiffness: 240,
          mass: 0.8,
        });
      }
    });

  // Reset whenever the sheet (re-)opens or the editing target changes.
  useEffect(() => {
    if (visible) {
      setKind(editingKind ?? 'busy');
      setTitle(editing?.title ?? '');
      setLocation(editing?.kind === 'busy_block' ? (editing.location ?? '') : '');
      setNotes(editing?.notes ?? '');
      setStart(initialStart);
      setEnd(initialEnd);
      setFormMode(!editing);
      setMenuOpen(false);
    }
  }, [visible, editing, editingKind, initialStart, initialEnd]);

  async function handleSave() {
    if (submitting) return;
    setSubmitting(true);
    try {
      const trimmedTitle = title.trim() || null;
      const trimmedLocation = location.trim() || null;
      const trimmedNotes = notes.trim() || null;
      if (kind === 'busy') {
        if (end <= start) {
          toast.error('End time must be after start time.');
          return;
        }
        const { error } =
          editing?.kind === 'busy_block'
            ? await updateBusyBlock({
                id: editing.id,
                startsAt: start,
                endsAt: end,
                title: trimmedTitle,
                notes: trimmedNotes,
                location: trimmedLocation,
              })
            : await createBusyBlock({
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
        const { error } =
          editing?.kind === 'unavailable_day'
            ? await updateUnavailableDay({
                userId: editing.user.id,
                date: editing.date,
                title: trimmedTitle,
                notes: trimmedNotes,
              })
            : await createUnavailableDay({
                date: selectedDate,
                title: trimmedTitle,
                notes: trimmedNotes,
              });
        if (error) {
          toast.error(error);
          return;
        }
      }
      onSaved();
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCopy() {
    setMenuOpen(false);
    if (!editing || editing.kind !== 'busy_block' || submitting) return;
    setSubmitting(true);
    try {
      const { error } = await createBusyBlock({
        startsAt: editing.startsAt,
        endsAt: editing.endsAt,
        title: editing.title,
        notes: editing.notes,
        location: editing.location,
      });
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

  function handleMore() {
    if (!editing || submitting) return;
    setMenuOpen((v) => !v);
  }

  function handleEdit() {
    if (!editing || submitting) return;
    setMenuOpen(false);
    setFormMode(true);
  }

  function handleDelete() {
    setMenuOpen(false);
    if (!editing || submitting) return;
    Alert.alert('Delete this item?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setSubmitting(true);
          try {
            const { error } =
              editing.kind === 'busy_block'
                ? await deleteBusyBlock(editing.id)
                : await deleteUnavailableDay({ userId: editing.user.id, date: editing.date });
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
    ? 'Add to your day'
    : inViewMode
      ? (editing.title ?? (editing.kind === 'busy_block' ? 'Busy time' : 'Unavailable day'))
      : 'Edit';

  // Read-only display strings for view mode.
  const viewTimeRange = useMemo(() => {
    if (!editing) return null;
    if (editing.kind === 'busy_block') {
      return formatTimeRange(editing.startsAt, editing.endsAt);
    }
    return 'All day';
  }, [editing]);

  const viewDate = useMemo(() => {
    if (!editing) return null;
    if (editing.kind === 'busy_block') {
      return formatLongDate(editing.startsAt);
    }
    const [y, m, d] = editing.date.split('-').map(Number);
    return formatLongDate(new Date(y, m - 1, d));
  }, [editing]);

  return (
    <Modal
      visible={rendered}
      animationType="none"
      transparent
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
    >
      {/* Backdrop fades in/out behind the sheet — tap to dismiss. */}
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
      {/* Sheet slides up from below via spring. Wrapped in a
          GestureDetector so the user can swipe it down to dismiss
          (Pan only activates on a clearly downward drag — vertical
          scroll inside the form is unaffected by smaller motions). */}
      <GestureDetector gesture={dismissPan}>
      <Animated.View style={[styles.sheet, sheetStyle]} collapsable={false}>
        <SafeAreaView style={styles.container} testID="add-item-sheet">
        <View style={styles.header}>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close"
            hitSlop={12}
            style={({ pressed }) => [styles.closeButton, pressed && styles.closeButtonPressed]}
          >
            <Text style={styles.closeIcon}>×</Text>
          </Pressable>
          <Text style={styles.heading} numberOfLines={1}>{heading}</Text>
          {editing ? (
            <View style={styles.headerRight}>
              {inViewMode ? (
                <Pressable
                  onPress={handleEdit}
                  accessibilityRole="button"
                  accessibilityLabel="Edit"
                  testID="event-edit"
                  hitSlop={12}
                  style={({ pressed }) => [
                    styles.headerIconButton,
                    pressed && styles.headerIconButtonPressed,
                  ]}
                >
                  {/* Manual-drawn pencil glyph (two thin Views): a long
                      slanted body + a short tip — keeps alignment
                      consistent across platforms instead of relying on
                      a Unicode glyph (✎ varies wildly by font). */}
                  <View style={styles.pencilBox}>
                    <View style={styles.pencilBody} />
                    <View style={styles.pencilTip} />
                  </View>
                </Pressable>
              ) : null}
              <Pressable
                onPress={handleMore}
                accessibilityRole="button"
                accessibilityLabel="Event actions"
                testID="event-more-actions"
                hitSlop={12}
                style={({ pressed }) => [
                  styles.headerIconButton,
                  pressed && styles.headerIconButtonPressed,
                ]}
              >
                <Text style={styles.moreIcon}>⋯</Text>
              </Pressable>
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
            <ScrollView contentContainerStyle={styles.body}>
              <View style={styles.viewRow}>
                <Text style={styles.viewLabel}>When</Text>
                <Text style={styles.viewValue} testID="view-date">{viewDate}</Text>
                <Text style={styles.viewValue} testID="view-time">{viewTimeRange}</Text>
              </View>
              {editing && editing.kind === 'busy_block' && editing.location ? (
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
            </ScrollView>
          ) : (
            <ScrollView
              contentContainerStyle={styles.body}
              keyboardShouldPersistTaps="handled"
            >
              {!editing ? (
                <View style={styles.toggleRow}>
                  <Pressable
                    onPress={() => setKind('busy')}
                    accessibilityRole="button"
                    accessibilityLabel="Add busy time"
                    testID="kind-busy"
                    style={[styles.toggle, kind === 'busy' && styles.toggleSelected]}
                  >
                    <Text style={kind === 'busy' ? styles.toggleLabelSelected : styles.toggleLabel}>
                      Busy time
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setKind('unavailable')}
                    accessibilityRole="button"
                    accessibilityLabel="Mark whole day unavailable"
                    testID="kind-unavailable"
                    style={[styles.toggle, kind === 'unavailable' && styles.toggleSelected]}
                  >
                    <Text style={kind === 'unavailable' ? styles.toggleLabelSelected : styles.toggleLabel}>
                      Unavailable all day
                    </Text>
                  </Pressable>
                </View>
              ) : null}

              <View style={styles.field}>
                <TextInput
                  placeholder={kind === 'busy' ? 'Lunch with Sarah' : 'Family wedding'}
                  placeholderTextColor={PLACEHOLDER_COLOR}
                  style={styles.input}
                  value={title}
                  onChangeText={setTitle}
                />
              </View>

              {kind === 'busy' ? (
                <>
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
                </>
              ) : null}

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

        {/* Custom popover for the three-dots menu. Rendered LAST inside the
            sheet so it stacks above the form/footer. The transparent
            full-area Pressable behind the menu lets a tap anywhere outside
            close the menu without dismissing the sheet itself. */}
        {menuOpen && editing ? (
          <>
            <Pressable
              style={styles.menuScrim}
              onPress={() => setMenuOpen(false)}
              accessibilityLabel="Close menu"
              testID="event-menu-scrim"
            />
            <View style={styles.menuPopover} testID="event-menu">
              {editing.kind === 'busy_block' ? (
                <Pressable
                  onPress={handleCopy}
                  accessibilityRole="button"
                  accessibilityLabel="Copy event"
                  testID="event-menu-copy"
                  style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]}
                >
                  <Text style={styles.menuItemLabel}>Copy event</Text>
                </Pressable>
              ) : null}
              <Pressable
                onPress={handleDelete}
                accessibilityRole="button"
                accessibilityLabel="Delete event"
                testID="event-menu-delete"
                style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]}
              >
                <Text style={[styles.menuItemLabel, styles.menuItemDanger]}>Delete event</Text>
              </Pressable>
            </View>
          </>
        ) : null}
      </SafeAreaView>
      </Animated.View>
      </GestureDetector>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000',
  },
  sheet: {
    position: 'absolute',
    top: SHEET_TOP_OFFSET,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowOffset: { width: 0, height: -2 },
    shadowRadius: 12,
    elevation: 12,
  },
  container: { flex: 1, backgroundColor: '#fff' },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
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
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  headerIconButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
  },
  headerIconButtonPressed: { backgroundColor: '#f0f0f0' },
  moreIcon: { fontSize: 22, lineHeight: 24, color: '#111', fontWeight: '700' },
  // Manual pencil glyph: a slanted bar (the body) plus a small triangle
  // (drawn as a rotated square stub) for the tip. Keeps the icon visually
  // consistent across iOS / Android instead of relying on a Unicode pencil.
  pencilBox: {
    width: 18,
    height: 18,
    position: 'relative',
  },
  pencilBody: {
    position: 'absolute',
    top: 6.5,
    left: -1,
    width: 18,
    height: 2.5,
    borderRadius: 1.25,
    backgroundColor: '#111',
    transform: [{ rotate: '-45deg' }],
  },
  pencilTip: {
    position: 'absolute',
    top: 11.5,
    left: 0,
    width: 4,
    height: 4,
    backgroundColor: '#111',
    transform: [{ rotate: '45deg' }],
  },
  body: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    gap: 16,
  },
  // View mode rows: small uppercase label, then one or more value lines.
  viewRow: { gap: 4 },
  viewLabel: {
    fontSize: 11,
    color: '#888',
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  viewValue: { fontSize: 16, color: '#111', lineHeight: 22 },
  toggleRow: { flexDirection: 'row', gap: 8 },
  toggle: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    alignItems: 'center',
  },
  toggleSelected: { backgroundColor: '#111', borderColor: '#111' },
  toggleLabel: { fontSize: 14, color: '#444' },
  toggleLabelSelected: { fontSize: 14, color: '#fff', fontWeight: '600' },
  field: { gap: 6 },
  label: { fontSize: 13, fontWeight: '500', color: '#444' },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
  },
  notesInput: {
    minHeight: 96,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  pickerGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 1,
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#eee',
    gap: 10,
  },
  save: {
    paddingVertical: 9,
    borderRadius: 8,
    backgroundColor: '#111',
    alignItems: 'center',
  },
  savePressed: { opacity: 0.85 },
  saveDisabled: { opacity: 0.5 },
  saveLabel: { fontSize: 14, color: '#fff', fontWeight: '600' },
  // Full-sheet transparent area behind the popover — taps here close the
  // menu without dismissing the sheet (which is what `onClose` would do).
  menuScrim: {
    ...StyleSheet.absoluteFillObject,
  },
  // Popover itself: anchored to the top-right of the sheet, just below the
  // header. Rough alignment with the three-dots button without doing a full
  // measure-on-layout pass.
  menuPopover: {
    position: 'absolute',
    top: 56,
    right: 12,
    minWidth: 160,
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingVertical: 4,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 12,
    elevation: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e5e5',
  },
  menuItem: {
    paddingVertical: 11,
    paddingHorizontal: 14,
  },
  menuItemPressed: { backgroundColor: '#f4f4f4' },
  menuItemLabel: { fontSize: 15, color: '#111' },
  menuItemDanger: { color: '#d92d20' },
});
