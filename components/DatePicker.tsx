import DateTimePicker from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text } from 'react-native';

type Props = {
  /** Current date as a Date — only the year/month/day portion is read. */
  value: Date;
  /** Fires with a new Date carrying the picked day. */
  onChange: (next: Date) => void;
  testID?: string;
};

/**
 * Native date picker. Mirrors `TimePicker` but with mode='date':
 * inline compact picker on iOS, tap-to-open dialog on Android.
 */
export function DatePicker({ value, onChange, testID }: Props) {
  const [androidDialogOpen, setAndroidDialogOpen] = useState(false);

  if (Platform.OS === 'ios') {
    return (
      <DateTimePicker
        testID={testID}
        value={value}
        mode="date"
        display="compact"
        onChange={(_event, picked) => {
          if (picked) onChange(picked);
        }}
      />
    );
  }

  return (
    <>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        onPress={() => setAndroidDialogOpen(true)}
        style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
      >
        <Text style={styles.buttonLabel}>{formatDate(value)}</Text>
      </Pressable>
      {androidDialogOpen ? (
        <DateTimePicker
          value={value}
          mode="date"
          display="default"
          onChange={(event, picked) => {
            setAndroidDialogOpen(false);
            if (event.type === 'set' && picked) onChange(picked);
          }}
        />
      ) : null}
    </>
  );
}

function formatDate(d: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
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
