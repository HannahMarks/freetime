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
import { CalendarItem } from '../lib/calendar-helpers';
import { toast } from '../lib/toast';
import { DatePicker } from './DatePicker';
import { TimePicker } from './TimePicker';

const SCREEN_HEIGHT = Dimensions.get('window').height;
const SHEET_TOP_OFFSET = 60;
const ENTER_DURATION_MS = 240;
const EXIT_DURATION_MS = 200;

type Kind = 'busy' | 'unavailable';

type Props = {
  visible: boolean;
  selectedDate: string; // YYYY-MM-DD
  /**
   * If set, the sheet pre-fills with this item and saves via the update
   * path instead of create. The kind toggle is hidden in edit mode (a
   * busy_block stays a busy_block; switching kinds is delete + re-add).
   * Edit mode also reveals a Delete button in the footer.
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

/**
 * Full-page modal for adding OR editing a busy_block or unavailable_day.
 * Header has a Close (×) button + the heading; body has the form fields;
 * footer has Save and (in edit mode) a destructive Delete button. Tapping
 * an existing item from the calendar opens this sheet directly in edit
 * mode — there is no separate edit-or-delete action sheet.
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
  const backdropOpacity = useSharedValue(visible ? 0.4 : 0);

  useEffect(() => {
    if (visible) {
      setRendered(true);
      translateY.value = withSpring(0, {
        damping: 22,
        stiffness: 240,
        mass: 0.8,
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
      backdropOpacity.value = withTiming(0, {
        duration: EXIT_DURATION_MS,
        easing: Easing.in(Easing.cubic),
      });
    }
  }, [visible, rendered, translateY, backdropOpacity]);

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
  }));

  // Swipe-down to dismiss. Activates only after a clearly downward
  // drag (>20px), and fails on horizontal motion >30px so it doesn't
  // hijack scrolls / drags inside the sheet content. On release past
  // a threshold (~25% of screen height OR a fast flick), call onClose
  // — the existing `visible` effect plays the exit animation. Below
  // threshold: spring back to 0.
  const dismissPan = Gesture.Pan()
    .activeOffsetY([-9999, 20])
    .failOffsetX([-30, 30])
    .onUpdate((e) => {
      // Track downward drag only. Subtle resistance for over-pull
      // by halving the translation past the dismiss threshold.
      translateY.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      const shouldDismiss =
        e.translationY > SCREEN_HEIGHT * 0.25 || e.velocityY > 600;
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

  function handleDelete() {
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

  const heading = editing ? 'Edit' : 'Add to your day';

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
          <Text style={styles.heading}>{heading}</Text>
          <View style={styles.headerSpacer} />
        </View>

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.flex}
        >
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
              <Text style={styles.label}>Label (optional)</Text>
              <TextInput
                placeholder={kind === 'busy' ? 'Lunch with Sarah' : 'Family wedding'}
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
                  <Text style={styles.label}>Location (optional)</Text>
                  <TextInput
                    testID="input-location"
                    placeholder="Where?"
                    style={styles.input}
                    value={location}
                    onChangeText={setLocation}
                  />
                </View>
              </>
            ) : null}

            <View style={styles.field}>
              <Text style={styles.label}>Notes (optional)</Text>
              <TextInput
                testID="input-notes"
                placeholder="Anything to remember?"
                style={[styles.input, styles.notesInput]}
                value={notes}
                onChangeText={setNotes}
                multiline
                textAlignVertical="top"
              />
            </View>
          </ScrollView>
        </KeyboardAvoidingView>

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
          {editing ? (
            <Pressable
              onPress={handleDelete}
              accessibilityRole="button"
              accessibilityLabel="Delete"
              disabled={submitting}
              style={({ pressed }) => [
                styles.delete,
                pressed && styles.deletePressed,
                submitting && styles.deleteDisabled,
              ]}
            >
              <Text style={styles.deleteLabel}>Delete</Text>
            </Pressable>
          ) : null}
        </View>
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
  body: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    gap: 16,
  },
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
  delete: {
    paddingVertical: 9,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d92d20',
    alignItems: 'center',
  },
  deletePressed: { backgroundColor: '#fff5f5' },
  deleteDisabled: { opacity: 0.5 },
  deleteLabel: { fontSize: 14, color: '#d92d20', fontWeight: '600' },
});
