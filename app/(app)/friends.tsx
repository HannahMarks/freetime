import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useAuth } from '../../lib/auth';
import {
  acceptFriendRequest,
  cancelOutgoingRequest,
  declineFriendRequest,
  Friendship,
  FriendProfile,
  FriendshipsByCategory,
  listFriendships,
  removeFriend,
  searchProfiles,
  sendFriendRequest,
} from '../../lib/friend-actions';
import { toast } from '../../lib/toast';

export default function FriendsScreen() {
  const { session } = useAuth();
  const userId = session?.user.id;

  const [friendships, setFriendships] = useState<FriendshipsByCategory | null>(null);
  const [loadingFriendships, setLoadingFriendships] = useState(true);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FriendProfile[]>([]);
  const [searching, setSearching] = useState(false);

  // Track ids that have an outgoing request so we can render "Request sent"
  // in the search results without re-querying.
  const knownIds = useMemo(() => {
    if (!friendships) return new Set<string>();
    const ids = new Set<string>();
    for (const f of friendships.friends) ids.add(f.friend.id);
    for (const f of friendships.outgoing) ids.add(f.friend.id);
    for (const f of friendships.incoming) ids.add(f.friend.id);
    return ids;
  }, [friendships]);

  const refreshFriendships = useCallback(async () => {
    if (!userId) return;
    setLoadingFriendships(true);
    const { data, error } = await listFriendships(userId);
    setLoadingFriendships(false);
    if (error) {
      toast.error(error);
      return;
    }
    if (data) setFriendships(data);
  }, [userId]);

  useEffect(() => {
    refreshFriendships();
  }, [refreshFriendships]);

  // Debounced search.
  useEffect(() => {
    if (!userId) return;
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      setResults([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    const handle = setTimeout(async () => {
      const { data, error } = await searchProfiles(trimmed, userId);
      setSearching(false);
      if (error) {
        toast.error(error);
        return;
      }
      setResults(data ?? []);
    }, 250);

    return () => clearTimeout(handle);
  }, [query, userId]);

  async function handleSendRequest(profile: FriendProfile) {
    const { error } = await sendFriendRequest(profile.id);
    if (error) {
      toast.error(error);
      return;
    }
    toast.success(`Friend request sent to ${profile.display_name}.`);
    refreshFriendships();
  }

  async function handleAccept(friendship: Friendship) {
    const { error } = await acceptFriendRequest(friendship.id);
    if (error) {
      toast.error(error);
      return;
    }
    refreshFriendships();
  }

  async function handleDecline(friendship: Friendship) {
    const { error } = await declineFriendRequest(friendship.id);
    if (error) {
      toast.error(error);
      return;
    }
    refreshFriendships();
  }

  async function handleCancel(friendship: Friendship) {
    const { error } = await cancelOutgoingRequest(friendship.id);
    if (error) {
      toast.error(error);
      return;
    }
    refreshFriendships();
  }

  async function handleRemove(friendship: Friendship) {
    const { error } = await removeFriend(friendship.id);
    if (error) {
      toast.error(error);
      return;
    }
    refreshFriendships();
  }

  const isSearching = query.trim().length > 0;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <TextInput
        placeholder="Search friends by name"
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.search}
        value={query}
        onChangeText={setQuery}
      />

      {isSearching ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Search results</Text>
          {searching ? (
            <ActivityIndicator />
          ) : results.length === 0 ? (
            <Text style={styles.empty}>No one matches “{query.trim()}”.</Text>
          ) : (
            results.map((profile) => (
              <PersonRow key={profile.id} profile={profile}>
                {knownIds.has(profile.id) ? (
                  <Text style={styles.statusText}>Already added</Text>
                ) : (
                  <ActionButton
                    label="Add"
                    onPress={() => handleSendRequest(profile)}
                    primary
                  />
                )}
              </PersonRow>
            ))
          )}
        </View>
      ) : (
        <>
          <Section
            title={`Incoming requests${friendships?.incoming.length ? ` (${friendships.incoming.length})` : ''}`}
          >
            {friendships?.incoming.length === 0 ? (
              <Text style={styles.empty}>No pending requests right now.</Text>
            ) : (
              friendships?.incoming.map((f) => (
                <PersonRow key={f.id} profile={f.friend}>
                  <View style={styles.actions}>
                    <ActionButton label="Accept" onPress={() => handleAccept(f)} primary />
                    <ActionButton label="Decline" onPress={() => handleDecline(f)} />
                  </View>
                </PersonRow>
              ))
            )}
          </Section>

          <Section
            title={`Outgoing requests${friendships?.outgoing.length ? ` (${friendships.outgoing.length})` : ''}`}
          >
            {friendships?.outgoing.length === 0 ? (
              <Text style={styles.empty}>You haven&apos;t sent any requests yet.</Text>
            ) : (
              friendships?.outgoing.map((f) => (
                <PersonRow key={f.id} profile={f.friend}>
                  <ActionButton label="Cancel" onPress={() => handleCancel(f)} />
                </PersonRow>
              ))
            )}
          </Section>

          <Section
            title={`Friends${friendships?.friends.length ? ` (${friendships.friends.length})` : ''}`}
          >
            {loadingFriendships ? (
              <ActivityIndicator />
            ) : friendships?.friends.length === 0 ? (
              <Text style={styles.empty}>Search above to add your first friend.</Text>
            ) : (
              friendships?.friends.map((f) => (
                <PersonRow key={f.id} profile={f.friend}>
                  <ActionButton label="Remove" onPress={() => handleRemove(f)} />
                </PersonRow>
              ))
            )}
          </Section>
        </>
      )}
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function PersonRow({
  profile,
  children,
}: {
  profile: FriendProfile;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.row}>
      <View style={[styles.avatar, { backgroundColor: profile.color }]} />
      <Text style={styles.name}>{profile.display_name}</Text>
      <View style={styles.rowActions}>{children}</View>
    </View>
  );
}

function ActionButton({
  label,
  onPress,
  primary,
}: {
  label: string;
  onPress: () => void;
  primary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        primary ? styles.buttonPrimary : styles.buttonSecondary,
        pressed && styles.buttonPressed,
      ]}
    >
      <Text style={primary ? styles.buttonLabelPrimary : styles.buttonLabelSecondary}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 16, gap: 16 },
  search: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
  },
  section: { gap: 8 },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: '#111' },
  empty: { fontSize: 14, color: '#888', paddingVertical: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
  },
  avatar: { width: 32, height: 32, borderRadius: 16 },
  name: { flex: 1, fontSize: 15, color: '#111' },
  rowActions: { marginLeft: 'auto' },
  actions: { flexDirection: 'row', gap: 6 },
  button: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
  },
  buttonPrimary: { backgroundColor: '#111', borderColor: '#111' },
  buttonSecondary: { backgroundColor: '#fff', borderColor: '#ddd' },
  buttonPressed: { opacity: 0.7 },
  buttonLabelPrimary: { color: '#fff', fontSize: 13, fontWeight: '600' },
  buttonLabelSecondary: { color: '#111', fontSize: 13, fontWeight: '500' },
  statusText: { fontSize: 13, color: '#888', fontStyle: 'italic' },
});
