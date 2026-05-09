import { Redirect } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useAuth } from '../lib/auth';

/**
 * Root entry — Expo Router renders this for the `/` path.
 *
 * Redirects to the auth or app stack based on the current Supabase
 * session. Without a screen file at this path, Expo Router shows its
 * "Unmatched route" page on initial mount, even with a redirect effect
 * in `_layout.tsx`, because the layout effect runs after the first
 * render.
 */
export default function Index() {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <View testID="root-loading" style={styles.loading}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return <Redirect href={session ? '/(app)/calendar' : '/(auth)/sign-in'} />;
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
