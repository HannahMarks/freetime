import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { darkenHexColor } from '../lib/color-helpers';

/** Primary FAB matches the existing single-FAB used elsewhere in the
 * app: 56px circle, profile-color background, white "+" icon. The
 * sub-FABs are slightly smaller (48px) outlined circles with the
 * relevant color, white interior — visually subordinate so the
 * primary keeps reading as the entry point. */
const PRIMARY_SIZE = 56;
const SUB_SIZE = 48;
const SUB_GAP = 14;
const DEFAULT_COLOR = '#111';
/** How much darker the event accent is vs. the user's color. 0.35
 * keeps it recognisably the same hue while being a clearly distinct
 * shade against the user's primary color. The same constant feeds
 * the calendar's event-dot rendering so the FAB outline and the
 * dot stay identical. */
export const EVENT_DARKEN_AMOUNT = 0.35;

type Props = {
  /** The user's profile color (#RRGGBB). When omitted, falls back to
   * `DEFAULT_COLOR` — keeps the component safe to mount before the
   * auth profile has loaded. */
  color?: string;
  /** Tap handler for the "Busy" sub-FAB — opens the AddItemSheet
   * (which itself toggles between busy_block + unavailable_day
   * inside). */
  onPressBusy: () => void;
  /** Tap handler for the "Event" sub-FAB — opens the EventSheet in
   * create mode. */
  onPressEvent: () => void;
};

/**
 * Speed-dial style FAB stack. Collapsed: a single primary circle in
 * the user's color. Tap → expands upward to reveal two smaller
 * outlined sub-FABs (Busy + Event). Tap a sub-FAB → fires its
 * handler and auto-collapses. Tap the primary again → collapses.
 *
 * The Events sub-FAB's outline uses `darkenHexColor(color,
 * EVENT_DARKEN_AMOUNT)` so it visually distinguishes events from
 * busy days. The calendar's event dot rendering uses the same
 * helper + amount, keeping the FAB and on-calendar treatment
 * consistent.
 */
export function FabMultiAction({ color, onPressBusy, onPressEvent }: Props) {
  const [expanded, setExpanded] = useState(false);
  const userColor = color ?? DEFAULT_COLOR;
  const eventColor = darkenHexColor(userColor, EVENT_DARKEN_AMOUNT);

  // FAB icon rotates 45° as the stack opens (the "+" morphs into an
  // "×" visually). Mirrors the rotation animation the calendar tab's
  // existing FAB uses on sheet open / close, so the affordance reads
  // consistently between this component and other FABs in the app.
  const rotation = useSharedValue(0);
  useEffect(() => {
    rotation.value = withTiming(expanded ? 45 : 0, {
      duration: 200,
      easing: Easing.out(Easing.cubic),
    });
  }, [expanded, rotation]);
  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  function handleBusy() {
    setExpanded(false);
    onPressBusy();
  }
  function handleEvent() {
    setExpanded(false);
    onPressEvent();
  }

  return (
    <View style={styles.wrapper} pointerEvents="box-none">
      {expanded ? (
        <View style={styles.actionStack} pointerEvents="box-none">
          {/* Event sub-FAB — darker outline. Sits ABOVE the busy
              sub-FAB so the two are stacked, primary at the bottom,
              event at the top. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Plan an event"
            testID="fab-action-event"
            onPress={handleEvent}
            style={({ pressed }) => [
              styles.subFab,
              { borderColor: eventColor },
              pressed && styles.subFabPressed,
            ]}
          >
            <SparkIcon color={eventColor} />
          </Pressable>
          <View style={styles.gap} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add a busy time or day"
            testID="fab-action-busy"
            onPress={handleBusy}
            style={({ pressed }) => [
              styles.subFab,
              { borderColor: userColor },
              pressed && styles.subFabPressed,
            ]}
          >
            <ClockIcon color={userColor} />
          </Pressable>
          <View style={styles.gap} />
        </View>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={expanded ? 'Close add menu' : 'Add to calendar'}
        testID="fab-primary"
        onPress={() => setExpanded((v) => !v)}
        style={({ pressed }) => [
          styles.primary,
          { backgroundColor: userColor },
          pressed && styles.primaryPressed,
        ]}
      >
        <Animated.Text style={[styles.primaryIcon, iconStyle]}>+</Animated.Text>
      </Pressable>
    </View>
  );
}

/** Four-point spark — matches the Events tab icon. Drawn with two
 * diagonal Views rotated to form a cross. Same proportion the tab
 * bar uses, just sized for an FAB-sized circle. */
function SparkIcon({ color }: { color: string }) {
  return (
    <View style={iconStyles.spark}>
      <View style={[iconStyles.sparkArm, { backgroundColor: color, transform: [{ rotate: '45deg' }] }]} />
      <View style={[iconStyles.sparkArm, { backgroundColor: color, transform: [{ rotate: '-45deg' }] }]} />
    </View>
  );
}

/** Simple clock-face glyph for the Busy sub-FAB — a ringed circle with
 * a horizontal bar for the minute hand. Cheap and recognisable
 * without pulling an icon font. */
function ClockIcon({ color }: { color: string }) {
  return (
    <View style={[iconStyles.clockRing, { borderColor: color }]}>
      <View style={[iconStyles.clockHand, { backgroundColor: color }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    right: 20,
    bottom: 24,
    alignItems: 'center',
  },
  actionStack: {
    alignItems: 'center',
    marginBottom: SUB_GAP,
  },
  gap: { height: SUB_GAP },
  primary: {
    width: PRIMARY_SIZE,
    height: PRIMARY_SIZE,
    borderRadius: PRIMARY_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
    elevation: 6,
  },
  primaryPressed: { opacity: 0.85 },
  primaryIcon: {
    color: '#fff',
    fontSize: 30,
    lineHeight: 32,
    fontWeight: '300',
  },
  subFab: {
    width: SUB_SIZE,
    height: SUB_SIZE,
    borderRadius: SUB_SIZE / 2,
    backgroundColor: '#fff',
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 4,
  },
  subFabPressed: { opacity: 0.75 },
});

const iconStyles = StyleSheet.create({
  spark: {
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sparkArm: {
    position: 'absolute',
    width: 22,
    height: 2.5,
    borderRadius: 1.25,
  },
  clockRing: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clockHand: {
    width: 5,
    height: 1.5,
    position: 'absolute',
    // Offset slightly above the centre so the hand reads as pointing
    // to the 9-ish position (rather than dead-centre, which would
    // just look like a smudge).
    top: 8,
    left: 4,
  },
});
