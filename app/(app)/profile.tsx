import { Pressable, StyleSheet, Text, View } from 'react-native';
import { signOut } from '../../lib/auth-actions';
import { toast } from '../../lib/toast';

export default function ProfileScreen() {
  async function handleSignOut() {
    const { error } = await signOut();
    if (error) toast.error(error);
    // On success the AuthProvider's onAuthStateChange listener clears the
    // session and the root layout redirects back to /(auth)/sign-in.
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Profile</Text>
      <Text style={styles.subtitle}>Display name + color editing lands in a follow-up PR.</Text>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Sign out"
        onPress={handleSignOut}
        style={({ pressed }) => [styles.signOut, pressed && styles.signOutPressed]}
      >
        <Text style={styles.signOutLabel}>Sign out</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#fff',
    gap: 16,
  },
  title: { fontSize: 24, fontWeight: '600' },
  subtitle: { fontSize: 14, color: '#666', textAlign: 'center', marginBottom: 8 },
  signOut: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  signOutPressed: { opacity: 0.7 },
  signOutLabel: { fontSize: 16, fontWeight: '500', color: '#111' },
});
