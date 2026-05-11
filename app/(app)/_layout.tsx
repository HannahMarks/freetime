import { Tabs } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useAuth } from '../../lib/auth';

/** Append a 2-hex-digit alpha to a "#RRGGBB" hex string.
 *
 * Inlined here (rather than imported from a shared lib) because it's a
 * 4-line helper and pulling it into a shared module just for the tab
 * bar didn't feel worth the indirection. Keep in sync with the
 * identically-named helper in DayTimeline.tsx if either changes shape. */
function hexAlpha(hex: string, alpha: number): string {
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex}${a}`;
}

/** Fallback tint when no profile color is loaded yet (e.g. first paint
 * before the auth profile resolves). Neutral gray matches the
 * tab-bar inactive style. */
const FALLBACK_TINT = '#888888';

/**
 * Manual-drawn calendar icon — monochrome (black + white). The previous
 * 📅 Unicode emoji rendered as a colorful glyph that didn't match the
 * monochrome aesthetic of the rest of the app. Composing the icon from
 * Views means we get exactly the look we want, identical across iOS /
 * Android, and the color is controllable per-state via props.
 *
 * Layout: a rounded outer rectangle (the pad), a darker top header
 * strip (the date title bar), and two small bars sticking up from the
 * top edge (the binder rings).
 */
function CalendarIcon({ color }: { color: string }) {
  return (
    <View style={iconStyles.container}>
      <View style={[iconStyles.ringLeft, { backgroundColor: color }]} />
      <View style={[iconStyles.ringRight, { backgroundColor: color }]} />
      <View style={[iconStyles.body, { borderColor: color }]}>
        <View style={[iconStyles.header, { backgroundColor: color }]} />
      </View>
    </View>
  );
}

/**
 * Manual-drawn events icon — a starburst / sparkle, deliberately
 * different from the calendar icon (the calendar tab is "your
 * schedule"; the events tab is "things you're hosting"). Drawn from
 * five thin bars rotated around a common center: top–bottom,
 * left–right, plus diagonals. The visual is "✦"-shaped without
 * depending on a Unicode glyph.
 */
function EventsIcon({ color }: { color: string }) {
  return (
    <View style={iconStyles.container}>
      <View style={[iconStyles.sparkVertical, { backgroundColor: color }]} />
      <View style={[iconStyles.sparkHorizontal, { backgroundColor: color }]} />
      <View
        style={[
          iconStyles.sparkDiagonal,
          { backgroundColor: color, transform: [{ rotate: '45deg' }] },
        ]}
      />
      <View
        style={[
          iconStyles.sparkDiagonal,
          { backgroundColor: color, transform: [{ rotate: '-45deg' }] },
        ]}
      />
    </View>
  );
}

const iconStyles = StyleSheet.create({
  // Outer wrapper holds enough vertical room for the rings to extend
  // ABOVE the calendar body without being clipped (the body is 22 tall
  // and starts 4px down to make room for the rings).
  container: {
    width: 24,
    height: 26,
    position: 'relative',
  },
  // The pad — outer rectangle with 1.75px stroke.
  body: {
    position: 'absolute',
    top: 4,
    left: 0,
    width: 24,
    height: 22,
    borderWidth: 1.75,
    borderRadius: 3,
    backgroundColor: 'transparent',
  },
  // Solid top strip representing the calendar's header ("MAY" etc).
  // Sits flush against the inside-top of the body's border.
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 4,
  },
  // The two binder rings — small vertical bars protruding above the
  // body's top edge. Positioned at ~1/3 and 2/3 of the body's width.
  ringLeft: {
    position: 'absolute',
    top: 0,
    left: 6,
    width: 2,
    height: 5,
    borderRadius: 1,
  },
  ringRight: {
    position: 'absolute',
    top: 0,
    right: 6,
    width: 2,
    height: 5,
    borderRadius: 1,
  },
  // Events-icon spark bars. All four overlap at the icon's center; the
  // rotated ones are length-matched so the resulting glyph reads as a
  // symmetrical four-pointed star.
  sparkVertical: {
    position: 'absolute',
    top: 3,
    left: 11,
    width: 2,
    height: 20,
    borderRadius: 1,
  },
  sparkHorizontal: {
    position: 'absolute',
    top: 12,
    left: 2,
    width: 20,
    height: 2,
    borderRadius: 1,
  },
  sparkDiagonal: {
    position: 'absolute',
    top: 8,
    left: 4,
    width: 16,
    height: 2,
    borderRadius: 1,
  },
});

export default function AppTabsLayout() {
  // Profile color is the user's chosen hex from sign-up. Used to tint
  // the calendar tab's BACKGROUND PILL when the tab is focused so the
  // active state visually matches the user's events on the calendar
  // grid (which are also drawn in their color). The icon itself stays
  // black-and-white per request — the user color only appears as the
  // pill backdrop.
  const { profile } = useAuth();
  const userColor = profile?.color ?? FALLBACK_TINT;

  return (
    <Tabs screenOptions={{ headerShown: true }}>
      <Tabs.Screen
        name="calendar"
        options={{
          title: 'Calendar',
          // User color tints the LABEL when the calendar tab is focused
          // (the icon stays black-and-white per request; the colored
          // pill backdrop is what visually carries the user-color
          // accent on the icon side).
          tabBarActiveTintColor: userColor,
          tabBarIcon: ({ focused }) => (
            <View
              style={[
                styles.iconPill,
                {
                  backgroundColor: focused
                    ? hexAlpha(userColor, 0.28)
                    : 'transparent',
                },
              ]}
            >
              <CalendarIcon color={focused ? '#111' : '#888'} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="events"
        options={{
          title: 'Events',
          // Same focus-pill treatment as the calendar tab so the
          // bottom-nav is visually consistent — the user-color
          // backdrop signals "active tab," the icon stays
          // monochrome for legibility.
          tabBarActiveTintColor: userColor,
          tabBarIcon: ({ focused }) => (
            <View
              style={[
                styles.iconPill,
                {
                  backgroundColor: focused
                    ? hexAlpha(userColor, 0.28)
                    : 'transparent',
                },
              ]}
            >
              <EventsIcon color={focused ? '#111' : '#888'} />
            </View>
          ),
        }}
      />
      <Tabs.Screen name="friends" options={{ title: 'Friends' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  iconPill: {
    width: 40,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    // Tiny leftward nudge: the calendar icon's binder rings sit slightly
    // off-center inside the body, so geometric-center alignment makes
    // the icon's visual mass appear a hair to the right of the column
    // it occupies. A 3px left margin compensates.
    marginLeft: -3,
  },
});
