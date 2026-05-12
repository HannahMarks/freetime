import { createPost, deletePost, listFeedPosts } from '../lib/post-actions';
import { supabase } from '../lib/supabase';

jest.mock('../lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
    auth: { getUser: jest.fn() },
  },
}));

const mockSupabase = supabase as unknown as {
  from: jest.Mock;
  auth: { getUser: jest.Mock };
};

/** Builder-pattern mock so chained Postgrest calls
 * (`from().select().order().limit()`) all return the same builder. */
function chainable(resolved: unknown) {
  const builder: Record<string, jest.Mock> = {};
  const terminal = Promise.resolve(resolved);
  for (const name of [
    'select',
    'insert',
    'update',
    'delete',
    'eq',
    'order',
    'limit',
  ]) {
    builder[name] = jest.fn().mockReturnValue(builder);
  }
  builder.single = jest.fn().mockReturnValue({
    then: (onFulfilled: unknown) =>
      terminal.then(onFulfilled as (v: unknown) => unknown),
  });
  (builder as { then: unknown }).then = (
    onFulfilled: unknown,
    onRejected: unknown,
  ) =>
    terminal.then(
      onFulfilled as (v: unknown) => unknown,
      onRejected as (r: unknown) => unknown,
    );
  return builder;
}

const alice = { id: 'alice', display_name: 'Alice', color: '#FF6B6B' };
const bob = { id: 'bob', display_name: 'Bob', color: '#4ECDC4' };

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

describe('createPost', () => {
  it('inserts with the live user id + trimmed body; returns the new row id', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'me-id' } } });
    const builder = chainable({ data: { id: 'p-new' }, error: null });
    mockSupabase.from.mockReturnValue(builder);

    const { id, error } = await createPost({ body: '  Hello world  ' });
    expect(error).toBeNull();
    expect(id).toBe('p-new');
    expect(mockSupabase.from).toHaveBeenCalledWith('posts');
    expect(builder.insert).toHaveBeenCalledWith({
      author_id: 'me-id',
      body: 'Hello world',
    });
    // `.select('id').single()` so the caller can use the new id.
    expect(builder.select).toHaveBeenCalledWith('id');
    expect(builder.single).toHaveBeenCalled();
  });

  it('returns "not signed in" when no session is present', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } });
    const { id, error } = await createPost({ body: 'hi' });
    expect(error).toMatch(/not signed in/i);
    expect(id).toBeNull();
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });

  it('rejects an empty / whitespace-only body without a DB round-trip', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'me-id' } } });
    const { id, error } = await createPost({ body: '   ' });
    expect(error).toMatch(/empty/i);
    expect(id).toBeNull();
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });

  it('returns a friendly error on DB failure', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'me-id' } } });
    mockSupabase.from.mockReturnValue(
      chainable({ data: null, error: { message: 'boom' } }),
    );
    const { id, error } = await createPost({ body: 'hi' });
    expect(error).toMatch(/couldn't share/i);
    expect(id).toBeNull();
  });
});

describe('listFeedPosts', () => {
  it('queries newest-first, capped at the feed limit, shaped into PostItem[]', async () => {
    const builder = chainable({
      data: [
        {
          id: 'p1',
          author_id: alice.id,
          body: 'Hi from Alice',
          created_at: '2026-05-22T18:00:00.000Z',
          author: alice,
        },
        {
          id: 'p2',
          author_id: bob.id,
          body: 'Hi from Bob',
          created_at: '2026-05-22T17:00:00.000Z',
          author: bob,
        },
      ],
      error: null,
    });
    mockSupabase.from.mockReturnValue(builder);

    const { data, error } = await listFeedPosts();
    expect(error).toBeNull();
    expect(mockSupabase.from).toHaveBeenCalledWith('posts');
    expect(builder.order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(builder.limit).toHaveBeenCalledWith(expect.any(Number));
    expect(builder.limit.mock.calls[0][0]).toBeGreaterThan(0);
    // Author profile embed is required so the feed can render the
    // name + color without a second round-trip.
    expect(builder.select).toHaveBeenCalledWith(
      expect.stringMatching(/author.*profiles/),
    );

    expect(data).toHaveLength(2);
    expect(data?.[0]).toMatchObject({
      id: 'p1',
      author: alice,
      body: 'Hi from Alice',
    });
    expect(data?.[0].createdAt).toBeInstanceOf(Date);
  });

  it('drops rows whose embedded author join is null (defensive)', async () => {
    mockSupabase.from.mockReturnValue(
      chainable({
        data: [
          {
            id: 'p-orphan',
            author_id: 'missing',
            body: 'no author',
            created_at: '2026-05-22T18:00:00.000Z',
            author: null,
          },
        ],
        error: null,
      }),
    );
    const { data } = await listFeedPosts();
    expect(data).toEqual([]);
  });

  it('returns a friendly error on DB failure', async () => {
    mockSupabase.from.mockReturnValue(
      chainable({ data: null, error: { message: 'boom' } }),
    );
    const { data, error } = await listFeedPosts();
    expect(data).toBeNull();
    expect(error).toMatch(/couldn't load/i);
  });
});

describe('deletePost', () => {
  it('deletes by id', async () => {
    const builder = chainable({ error: null });
    mockSupabase.from.mockReturnValue(builder);

    const { error } = await deletePost('p1');
    expect(error).toBeNull();
    expect(mockSupabase.from).toHaveBeenCalledWith('posts');
    expect(builder.delete).toHaveBeenCalled();
    expect(builder.eq).toHaveBeenCalledWith('id', 'p1');
  });

  it('returns a friendly error on DB failure', async () => {
    mockSupabase.from.mockReturnValue(chainable({ error: { message: 'boom' } }));
    const { error } = await deletePost('p1');
    expect(error).toMatch(/couldn't delete/i);
  });
});
