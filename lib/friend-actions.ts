import { supabase } from './supabase';

export type FriendProfile = {
  id: string;
  display_name: string;
  color: string;
};

export type FriendshipStatus = 'pending' | 'accepted' | 'declined' | 'blocked';

export type Friendship = {
  id: string;
  status: FriendshipStatus;
  friend: FriendProfile;
  direction: 'incoming' | 'outgoing';
};

export type FriendshipsByCategory = {
  incoming: Friendship[];
  outgoing: Friendship[];
  friends: Friendship[];
};

export type ActionResult<T = void> = T extends void
  ? { error: string | null }
  : { data: T | null; error: string | null };

type FriendshipRow = {
  id: string;
  status: FriendshipStatus;
  requester_id: string;
  addressee_id: string;
  requester: FriendProfile | null;
  addressee: FriendProfile | null;
};

/**
 * Reshape raw friendship rows (with embedded profiles for both parties)
 * into the per-category structure the UI consumes.
 *
 * Pure function — extracted from `listFriendships` so we can test the
 * categorization logic without mocking the entire Supabase chain.
 */
export function categorizeFriendships(
  rows: FriendshipRow[],
  currentUserId: string,
): FriendshipsByCategory {
  const result: FriendshipsByCategory = {
    incoming: [],
    outgoing: [],
    friends: [],
  };

  for (const row of rows) {
    const direction: 'incoming' | 'outgoing' =
      row.requester_id === currentUserId ? 'outgoing' : 'incoming';
    const friend = direction === 'outgoing' ? row.addressee : row.requester;
    if (!friend) continue; // shouldn't happen; defensive

    const item: Friendship = { id: row.id, status: row.status, friend, direction };

    if (row.status === 'accepted') {
      result.friends.push(item);
    } else if (row.status === 'pending') {
      if (direction === 'incoming') result.incoming.push(item);
      else result.outgoing.push(item);
    }
    // declined / blocked: intentionally not surfaced to the UI for now
  }

  return result;
}

const FRIENDSHIPS_SELECT =
  'id, status, requester_id, addressee_id, ' +
  'requester:profiles!friendships_requester_id_fkey (id, display_name, color), ' +
  'addressee:profiles!friendships_addressee_id_fkey (id, display_name, color)';

function describeError(prefix: string, err: { message?: string } | null): string {
  if (process.env.NODE_ENV !== 'production' && err) {
    // eslint-disable-next-line no-console
    console.error(`[friends] ${prefix}:`, err);
  }
  return `${prefix}. Please try again.`;
}

export async function searchProfiles(
  query: string,
  currentUserId: string,
): Promise<{ data: FriendProfile[] | null; error: string | null }> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return { data: [], error: null };

  // Escape `%` and `_` so the user typing them doesn't trigger wildcard expansion.
  const escaped = trimmed.replace(/[%_]/g, (c) => `\\${c}`);

  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name, color')
    .ilike('display_name', `%${escaped}%`)
    .neq('id', currentUserId)
    .order('display_name', { ascending: true })
    .limit(20);

  if (error) return { data: null, error: describeError('Search failed', error) };
  return { data: (data ?? []) as FriendProfile[], error: null };
}

export async function listFriendships(
  currentUserId: string,
): Promise<{ data: FriendshipsByCategory | null; error: string | null }> {
  const { data, error } = await supabase.from('friendships').select(FRIENDSHIPS_SELECT);

  if (error) return { data: null, error: describeError("Couldn't load your friends", error) };
  return {
    data: categorizeFriendships((data ?? []) as unknown as FriendshipRow[], currentUserId),
    error: null,
  };
}

export async function sendFriendRequest(addresseeId: string): Promise<{ error: string | null }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Not signed in.' };

  const { error } = await supabase
    .from('friendships')
    .insert({ requester_id: user.id, addressee_id: addresseeId, status: 'pending' });

  if (error) {
    // Unique-constraint violation = request already exists; surface that nicely.
    if ((error as { code?: string }).code === '23505') {
      return { error: 'You already have a pending or accepted request with this person.' };
    }
    return { error: describeError("Couldn't send request", error) };
  }
  return { error: null };
}

export async function acceptFriendRequest(friendshipId: string): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('friendships')
    .update({ status: 'accepted' })
    .eq('id', friendshipId);

  if (error) return { error: describeError("Couldn't accept request", error) };
  return { error: null };
}

export async function declineFriendRequest(
  friendshipId: string,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('friendships')
    .update({ status: 'declined' })
    .eq('id', friendshipId);

  if (error) return { error: describeError("Couldn't decline request", error) };
  return { error: null };
}

export async function cancelOutgoingRequest(
  friendshipId: string,
): Promise<{ error: string | null }> {
  const { error } = await supabase.from('friendships').delete().eq('id', friendshipId);

  if (error) return { error: describeError("Couldn't cancel request", error) };
  return { error: null };
}

export async function removeFriend(friendshipId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('friendships').delete().eq('id', friendshipId);

  if (error) return { error: describeError("Couldn't remove friend", error) };
  return { error: null };
}
