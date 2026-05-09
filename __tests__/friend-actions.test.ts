import {
  acceptFriendRequest,
  cancelOutgoingRequest,
  categorizeFriendships,
  declineFriendRequest,
  listFriendships,
  removeFriend,
  searchProfiles,
  sendFriendRequest,
} from '../lib/friend-actions';
import { supabase } from '../lib/supabase';

jest.mock('../lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
    auth: {
      getUser: jest.fn(),
    },
  },
}));

const mockSupabase = supabase as unknown as {
  from: jest.Mock;
  auth: { getUser: jest.Mock };
};

/**
 * Build a chainable query-builder mock whose terminal `await` resolves to
 * the given value. Every chained method returns the same builder so any
 * sequence (`.select().eq().limit()`, etc.) works without each test having
 * to know the order.
 */
function chainable(resolved: unknown) {
  const builder: Record<string, jest.Mock> = {};
  const terminal = Promise.resolve(resolved);
  const passthrough = ['select', 'insert', 'update', 'delete', 'eq', 'neq', 'ilike', 'order', 'limit'];
  for (const name of passthrough) {
    builder[name] = jest.fn().mockReturnValue(builder);
  }
  // Make the builder awaitable by adding then/catch/finally that delegate
  // to the resolved promise.
  (builder as any).then = (onFulfilled: any, onRejected: any) =>
    terminal.then(onFulfilled, onRejected);
  (builder as any).catch = (onRejected: any) => terminal.catch(onRejected);
  (builder as any).finally = (onFinally: any) => terminal.finally(onFinally);
  return builder;
}

describe('friend-actions', () => {
  // The implementations console.error in dev to aid debugging — silence
  // those during error-path tests to keep output clean.
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  describe('categorizeFriendships (pure)', () => {
    const me = 'me-id';
    const alice = { id: 'alice-id', display_name: 'Alice', color: '#FF6B6B' };
    const bob = { id: 'bob-id', display_name: 'Bob', color: '#4ECDC4' };
    const carol = { id: 'carol-id', display_name: 'Carol', color: '#FFE66D' };
    const meProfile = { id: me, display_name: 'Me', color: '#000000' };

    it('classifies incoming pending requests', () => {
      const rows = [
        {
          id: 'f1',
          status: 'pending' as const,
          requester_id: alice.id,
          addressee_id: me,
          requester: alice,
          addressee: meProfile,
        },
      ];
      const out = categorizeFriendships(rows, me);
      expect(out.incoming).toHaveLength(1);
      expect(out.incoming[0].friend).toEqual(alice);
      expect(out.incoming[0].direction).toBe('incoming');
      expect(out.outgoing).toHaveLength(0);
      expect(out.friends).toHaveLength(0);
    });

    it('classifies outgoing pending requests', () => {
      const rows = [
        {
          id: 'f2',
          status: 'pending' as const,
          requester_id: me,
          addressee_id: bob.id,
          requester: meProfile,
          addressee: bob,
        },
      ];
      const out = categorizeFriendships(rows, me);
      expect(out.outgoing).toHaveLength(1);
      expect(out.outgoing[0].friend).toEqual(bob);
      expect(out.outgoing[0].direction).toBe('outgoing');
    });

    it('classifies accepted friendships in either direction', () => {
      const rows = [
        {
          id: 'f3',
          status: 'accepted' as const,
          requester_id: me,
          addressee_id: alice.id,
          requester: meProfile,
          addressee: alice,
        },
        {
          id: 'f4',
          status: 'accepted' as const,
          requester_id: bob.id,
          addressee_id: me,
          requester: bob,
          addressee: meProfile,
        },
      ];
      const out = categorizeFriendships(rows, me);
      expect(out.friends).toHaveLength(2);
      expect(out.friends.map((f) => f.friend)).toEqual(expect.arrayContaining([alice, bob]));
    });

    it('drops declined and blocked friendships from the UI shape', () => {
      const rows = [
        {
          id: 'f5',
          status: 'declined' as const,
          requester_id: me,
          addressee_id: carol.id,
          requester: meProfile,
          addressee: carol,
        },
        {
          id: 'f6',
          status: 'blocked' as const,
          requester_id: carol.id,
          addressee_id: me,
          requester: carol,
          addressee: meProfile,
        },
      ];
      const out = categorizeFriendships(rows, me);
      expect(out.incoming).toHaveLength(0);
      expect(out.outgoing).toHaveLength(0);
      expect(out.friends).toHaveLength(0);
    });
  });

  describe('searchProfiles', () => {
    it('returns an empty list for blank/whitespace queries without hitting the DB', async () => {
      const { data, error } = await searchProfiles('   ', 'me-id');
      expect(data).toEqual([]);
      expect(error).toBeNull();
      expect(mockSupabase.from).not.toHaveBeenCalled();
    });

    it('queries profiles with a partial name match excluding self', async () => {
      const builder = chainable({ data: [{ id: '1', display_name: 'Alice', color: '#FF6B6B' }], error: null });
      mockSupabase.from.mockReturnValue(builder);

      const { data, error } = await searchProfiles('ali', 'me-id');

      expect(error).toBeNull();
      expect(data).toEqual([{ id: '1', display_name: 'Alice', color: '#FF6B6B' }]);
      expect(mockSupabase.from).toHaveBeenCalledWith('profiles');
      expect(builder.select).toHaveBeenCalledWith('id, display_name, color');
      expect(builder.ilike).toHaveBeenCalledWith('display_name', '%ali%');
      expect(builder.neq).toHaveBeenCalledWith('id', 'me-id');
      expect(builder.limit).toHaveBeenCalledWith(20);
    });

    it('escapes `%` and `_` in the user query so wildcards stay literal', async () => {
      const builder = chainable({ data: [], error: null });
      mockSupabase.from.mockReturnValue(builder);

      await searchProfiles('100%', 'me-id');

      expect(builder.ilike).toHaveBeenCalledWith('display_name', '%100\\%%');
    });

    it('returns a translated error when the DB query fails', async () => {
      const builder = chainable({ data: null, error: { message: 'boom' } });
      mockSupabase.from.mockReturnValue(builder);

      const { data, error } = await searchProfiles('alice', 'me-id');

      expect(data).toBeNull();
      expect(error).toMatch(/search failed/i);
    });
  });

  describe('listFriendships', () => {
    it('queries the friendships table and categorizes the result', async () => {
      const me = 'me-id';
      const builder = chainable({
        data: [
          {
            id: 'f1',
            status: 'accepted',
            requester_id: me,
            addressee_id: 'alice-id',
            requester: { id: me, display_name: 'Me', color: '#000' },
            addressee: { id: 'alice-id', display_name: 'Alice', color: '#FF6B6B' },
          },
        ],
        error: null,
      });
      mockSupabase.from.mockReturnValue(builder);

      const { data, error } = await listFriendships(me);

      expect(error).toBeNull();
      expect(mockSupabase.from).toHaveBeenCalledWith('friendships');
      expect(data?.friends).toHaveLength(1);
      expect(data?.friends[0].friend.display_name).toBe('Alice');
    });

    it('translates DB errors', async () => {
      const builder = chainable({ data: null, error: { message: 'boom' } });
      mockSupabase.from.mockReturnValue(builder);

      const { data, error } = await listFriendships('me-id');

      expect(data).toBeNull();
      expect(error).toMatch(/couldn't load/i);
    });
  });

  describe('sendFriendRequest', () => {
    it('inserts a pending row with the current user as requester', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'me-id' } } });
      const builder = chainable({ error: null });
      mockSupabase.from.mockReturnValue(builder);

      const { error } = await sendFriendRequest('alice-id');

      expect(error).toBeNull();
      expect(mockSupabase.from).toHaveBeenCalledWith('friendships');
      expect(builder.insert).toHaveBeenCalledWith({
        requester_id: 'me-id',
        addressee_id: 'alice-id',
        status: 'pending',
      });
    });

    it('returns a friendly error when no user is signed in', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } });
      const { error } = await sendFriendRequest('alice-id');
      expect(error).toMatch(/not signed in/i);
      expect(mockSupabase.from).not.toHaveBeenCalled();
    });

    it('translates a duplicate-pair error to a friendly message', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'me-id' } } });
      const builder = chainable({ error: { code: '23505', message: 'unique violation' } });
      mockSupabase.from.mockReturnValue(builder);

      const { error } = await sendFriendRequest('alice-id');
      expect(error).toMatch(/already have/i);
    });
  });

  describe('acceptFriendRequest', () => {
    it('updates the friendship to accepted', async () => {
      const builder = chainable({ error: null });
      mockSupabase.from.mockReturnValue(builder);

      const { error } = await acceptFriendRequest('f1');

      expect(error).toBeNull();
      expect(mockSupabase.from).toHaveBeenCalledWith('friendships');
      expect(builder.update).toHaveBeenCalledWith({ status: 'accepted' });
      expect(builder.eq).toHaveBeenCalledWith('id', 'f1');
    });
  });

  describe('declineFriendRequest', () => {
    it('updates the friendship to declined', async () => {
      const builder = chainable({ error: null });
      mockSupabase.from.mockReturnValue(builder);

      await declineFriendRequest('f1');

      expect(builder.update).toHaveBeenCalledWith({ status: 'declined' });
      expect(builder.eq).toHaveBeenCalledWith('id', 'f1');
    });
  });

  describe('cancelOutgoingRequest', () => {
    it('deletes the friendship row', async () => {
      const builder = chainable({ error: null });
      mockSupabase.from.mockReturnValue(builder);

      await cancelOutgoingRequest('f1');

      expect(builder.delete).toHaveBeenCalled();
      expect(builder.eq).toHaveBeenCalledWith('id', 'f1');
    });
  });

  describe('removeFriend', () => {
    it('deletes the friendship row', async () => {
      const builder = chainable({ error: null });
      mockSupabase.from.mockReturnValue(builder);

      await removeFriend('f1');

      expect(builder.delete).toHaveBeenCalled();
      expect(builder.eq).toHaveBeenCalledWith('id', 'f1');
    });
  });
});
