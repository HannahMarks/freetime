import { Pressable, StyleSheet, Text, View } from 'react-native';
import { isoDate } from '../lib/calendar-helpers';

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

type Props = {
  /** YYYY-MM-DD that is currently selected and should be highlighted. */
  selectedDate: string;
  /** YYYY-MM-DD for "today". When today is not the selected day, its
   * number is colored with `todayColor` (or a default bold style). */
  todayIso: string;
  /** Hex color (e.g. "#9C27B0") used to tint today's number when it's
   * visible but not the selected day. Defaults to bold-black. */
  todayColor?: string;
  /** Tap handler — fires with the YYYY-MM-DD of the tapped day. */
  onDateChange: (newDate: string) => void;
};

/** Sunday–Saturday strip of date numbers for the week containing
 * `selectedDate`. Tap a day to select it. */
export function WeekStrip({ selectedDate, todayIso, todayColor, onDateChange }: Props) {
  const [y, m, d] = selectedDate.split('-').map(Number);
  // Find the Sunday at or before `selectedDate`.
  const dow = new Date(y, m - 1, d).getDay(); // 0 = Sunday
  const sundayDay = d - dow;

  const cells = Array.from({ length: 7 }, (_, i) => {
    const cellDate = new Date(y, m - 1, sundayDay + i);
    const iso = isoDate(cellDate);
    return {
      iso,
      day: cellDate.getDate(),
      label: WEEKDAY_LABELS[i],
      isSelected: iso === selectedDate,
      isToday: iso === todayIso,
    };
  });

  return (
    <View style={styles.strip} testID="week-strip">
      {cells.map((cell) => (
        <Pressable
          key={cell.iso}
          testID={`week-cell-${cell.iso}`}
          onPress={() => onDateChange(cell.iso)}
          style={({ pressed }) => [styles.cell, pressed && styles.cellPressed]}
          accessibilityRole="button"
          accessibilityLabel={`${cell.label} ${cell.day}${cell.isSelected ? ' selected' : ''}`}
        >
          <Text
            style={[
              styles.dayLabel,
              cell.isSelected && styles.dayLabelSelected,
              !cell.isSelected && cell.isToday && todayColor
                ? { color: todayColor, fontWeight: '600' as const }
                : null,
            ]}
          >
            {cell.label}
          </Text>
          <View
            style={[
              styles.numberBubble,
              cell.isSelected && styles.numberBubbleSelected,
            ]}
          >
            <Text
              style={[
                styles.dayNumber,
                cell.isSelected && styles.dayNumberSelected,
                !cell.isSelected && cell.isToday
                  ? todayColor
                    ? { color: todayColor, fontWeight: '700' as const }
                    : styles.dayNumberToday
                  : null,
              ]}
            >
              {cell.day}
            </Text>
          </View>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  cell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 4,
    borderRadius: 8,
  },
  cellPressed: { opacity: 0.6 },
  dayLabel: {
    fontSize: 11,
    color: '#888',
    marginBottom: 4,
  },
  dayLabelSelected: { color: '#111', fontWeight: '600' },
  numberBubble: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  numberBubbleSelected: { backgroundColor: '#111' },
  dayNumber: { fontSize: 14, color: '#111' },
  dayNumberSelected: { color: '#fff', fontWeight: '600' },
  dayNumberToday: { color: '#111', fontWeight: '700' },
});
