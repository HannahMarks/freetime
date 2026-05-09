import DateTimePicker from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text } from 'react-native';

type Props = {
  /** Current time as a Date — only the hour/minute portion is read. */
  value: Date;
  /** Fires with a new Date carrying the picked time. */
  onChange: (next: Date) => void;
  testID?: string;
};

/**
 * Native time picker that gives the user a scroll-wheel UX for hour +
 * minute. Wraps `@react-native-community/datetimepicker` so callers
 * don't deal with the iOS/Android API split.
 *
 * - iOS: renders the system "compact" control — small button showing
 *   the time; tap it to popover the wheel picker.
 * - Android: renders a styled button showing the time; tap it to open
 *   the system clock dialog. The dialog handles the picking and closes
 *   itself.
 */
export function TimePicker({ value, onChange, testID }: Props) {
  // Android: dialog is opened on demand by mounting DateTimePicker, then
  // unmounting on change.
  const [androidDialogOpen, setAndroidDialogOpen] = useState(false);

  if (Platform.OS === 'ios') {
    return (
      <DateTimePicker
        testID={testID}
        value={value}
        mode="time"
        display="compact"
        onChange={(_event, picked) => {
          if (picked) onChange(picked);
        }}
      />
    );
  }

  // Android (and web fallback)
  return (
    <>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        onPress={() => setAndroidDialogOpen(true)}
        style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
      >
        <Text style={styles.buttonLabel}>{formatHourMinute(value)}</Text>
      </Pressable>
      {androidDialogOpen ? (
        <DateTimePicker
          value={value}
          mode="time"
          display="default"
          onChange={(event, picked) => {
            setAndroidDialogOpen(false);
            // event.type is 'set' on confirm, 'dismissed' on cancel.
            if (event.type === 'set' && picked) onChange(picked);
          }}
        />
      ) : null}
    </>
  );
}

function formatHourMinute(d: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(d);
}

const styles = StyleSheet.create({
  button: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignSelf: 'flex-start',
  },
  buttonPressed: { opacity: 0.7 },
  buttonLabel: { fontSize: 16, color: '#111' },
});
