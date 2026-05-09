import { useEffect, useState } from 'react';
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
import { createBusyBlock, createUnavailableDay } from '../lib/availability-actions';
import { combineDateAndTime, parseTime } from '../lib/calendar-helpers';
import { toast } from '../lib/toast';

type Kind = 'busy' | 'unavailable';

type Props = {
  visible: boolean;
  selectedDate: string; // YYYY-MM-DD
  onClose: () => void;
  onSaved: () => void;
};

/**
 * Modal sheet for adding either a busy_block (with start/end times +
 * optional title) or an unavailable_day (just an optional title) on the
 * currently-selected calendar date.
 *
 * Time inputs are plain TextInputs that accept "9:00 AM", "9 AM",
 * "14:30", etc. — see `parseTime`. Less polished than a native picker
 * but pure-JS, dep-free, and works on every platform without
 * conditional rendering.
 */
export function AddItemSheet({ visible, selectedDate, onClose, onSaved }: Props) {
  const [kind, setKind] = useState<Kind>('busy');
  const [title, setTitle] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Reset whenever the sheet (re-)opens.
  useEffect(() => {
    if (visible) {
      setKind('busy');
      setTitle('');
      setStartTime('');
      setEndTime('');
    }
  }, [visible]);

  async function handleSave() {
    if (submitting) return;
    setSubmitting(true);
    try {
      if (kind === 'busy') {
        const start = parseTime(startTime);
        const end = parseTime(endTime);
        if (!start || !end) {
          toast.error('Times must look like 9:00 AM or 14:30.');
          return;
        }
        const startsAt = combineDateAndTime(selectedDate, start);
        const endsAt = combineDateAndTime(selectedDate, end);
        if (endsAt <= startsAt) {
          toast.error('End time must be after start time.');
          return;
        }
        const { error } = await createBusyBlock({
          startsAt,
          endsAt,
          title: title.trim() || null,
        });
        if (error) {
          toast.error(error);
          return;
        }
      } else {
        const { error } = await createUnavailableDay({
          date: selectedDate,
          title: title.trim() || null,
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

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Dismiss" />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.sheetWrap}
        >
          <View style={styles.sheet} testID="add-item-sheet">
            <Text style={styles.heading}>Add to your day</Text>

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
                <View style={styles.field}>
                  <Text style={styles.label}>Starts</Text>
                  <TextInput
                    placeholder="9:00 AM"
                    autoCapitalize="characters"
                    autoCorrect={false}
                    style={styles.input}
                    value={startTime}
                    onChangeText={setStartTime}
                  />
                </View>
                <View style={styles.field}>
                  <Text style={styles.label}>Ends</Text>
                  <TextInput
                    placeholder="10:00 AM"
                    autoCapitalize="characters"
                    autoCorrect={false}
                    style={styles.input}
                    value={endTime}
                    onChangeText={setEndTime}
                  />
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
