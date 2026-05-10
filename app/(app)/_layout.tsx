import { Tabs } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
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

export default function AppTabsLayout() {
  // Profile color is the user's chosen hex from sign-up. Used to tint
  // the calendar tab's background pill when the tab is focused so the
  // active state visually matches the user's events on the calendar
  // grid (which are also drawn in their color).
  const { profile } = useAuth();
  const userColor = profile?.color ?? FALLBACK_TINT;

  return (
    <Tabs screenOptions={{ headerShown: true }}>
      <Tabs.Screen
        name="calendar"
        options={{
          title: 'Calendar',
          tabBarIcon: ({ focused }) => (
            <View
              style={[
                styles.iconPill,
                {
                  // When focused, fill the pill with the user's color
                  // (low alpha so the emoji on top stays readable).
                  // When unfocused, transparent — the emoji sits on the
                  // tab bar's background unchanged.
                  backgroundColor: focused
                    ? hexAlpha(userColor, 0.28)
                    : 'transparent',
                },
              ]}
            >
              {/* 📅 (TEAR-OFF CALENDAR, U+1F4C5) — pure emoji
                  presentation. Default colorful glyph; the user-color
                  highlight comes from the pill background, not from
                  tinting the emoji (which Text doesn't support for
                  emoji glyphs). */}
              <Text style={styles.iconEmoji}>📅</Text>
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
    width: 36,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
  },
  iconEmoji: {
    fontSize: 20,
    lineHeight: 22,
  },
});
