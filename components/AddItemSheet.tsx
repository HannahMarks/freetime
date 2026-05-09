import { useEffect, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  createBusyBlock,
  createUnavailableDay,
  updateBusyBlock,
  updateUnavailableDay,
} from '../lib/availability-actions';
import { CalendarItem } from '../lib/calendar-helpers';
import { toast } from '../lib/toast';
import { DatePicker } from './DatePicker';
import { TimePicker } from './TimePicker';

type Kind = 'busy' | 'unavailable';

type Props = {
  visible: boolean;
  selectedDate: string; // YYYY-MM-DD
  /**
   * If set, the sheet pre-fills with this item and saves via the update
   * path instead of create. The kind toggle is hidden in edit mode (a
   * busy_block stays a busy_block; switching kinds is delete + re-add).
   */
  editing?: CalendarItem | null;
  onClose: () => void;
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
 * Modal sheet for adding OR editing either a busy_block (with start/end
 * times + optional title) or an unavailable_day (just an optional title)
 * on the currently-selected calendar date. Native scroll-wheel time
 * pickers via `TimePicker`.
 */
export function AddItemSheet({ visible, selectedDate, editing, onClose, onSaved }: Props) {
  const editingKind: Kind | null = editing
    ? editing.kind === 'busy_block'
      ? 'busy'
      : 'unavailable'
    : null;

  const [kind, setKind] = useState<Kind>(editingKind ?? 'busy');
  const [title, setTitle] = useState('');
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

  // Reset whenever the sheet (re-)opens or the editing target changes.
  useEffect(() => {
    if (visible) {
      setKind(editingKind ?? 'busy');
      setTitle(editing?.title ?? '');
      setStart(initialStart);
      setEnd(initialEnd);
    }
  }, [visible, editing, editingKind, initialStart, initialEnd]);

  async function handleSave() {
    if (submitting) return;
    setSubmitting(true);
    try {
      const trimmedTitle = title.trim() || null;
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
              })
            : await createBusyBlock({
                startsAt: start,
                endsAt: end,
                title: trimmedTitle,
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
              })
            : await createUnavailableDay({
                date: selectedDate,
                title: trimmedTitle,
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

  const heading = editing ? 'Edit' : 'Add to your day';

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityLabel="Dismiss"
        />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.sheetWrap}
        >
          <View style={styles.sheet} testID="add-item-sheet">
            <Text style={styles.heading}>{heading}</Text>

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
              </>
            ) : null}

            <View style={styles.actions}>
              <Pressable
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="Cancel"
                style={({ pressed }) => [styles.cancel, pressed && styles.cancelPressed]}
              >
                <Text style={styles.cancelLabel}>Cancel</Text>
              </Pressable>
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
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheetWrap: {},
  sheet: {
    backgroundColor: '#fff',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 32,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    gap: 14,
  },
  heading: { fontSize: 18, fontWeight: '700', color: '#111' },
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
  actions: { flexDirection: 'row', gap: 10, marginTop: 8 },
  cancel: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    alignItems: 'center',
  },
  cancelPressed: { opacity: 0.7 },
  cancelLabel: { fontSize: 15, color: '#111' },
  save: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#111',
    alignItems: 'center',
  },
  savePressed: { opacity: 0.85 },
  saveDisabled: { opacity: 0.5 },
  saveLabel: { fontSize: 15, color: '#fff', fontWeight: '600' },
});
