import { createPost, deletePost, listFeedPosts } from '../lib/post-actions';
import { supabase } from '../lib/supabase';

jest.mock('../lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
    auth: { getUser: jest.fn() },
    storage: { from: jest.fn() },
  },
}));

// expo-image-manipulator mock — same shape used by event-media
// tests: returns the input URI so the fetch().arrayBuffer() mock
// can hand back deterministic bytes.
jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn(async (uri: string) => ({ uri })),
  SaveFormat: { JPEG: 'jpeg' },
}));

const originalFetch = global.fetch;
beforeAll(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).fetch = jest.fn(async () => ({
    arrayBuffer: async () => new ArrayBuffer(8),
  }));
});
afterAll(() => {
  global.fetch = originalFetch;
});

const mockSupabase = supabase as unknown as {
  from: jest.Mock;
  auth: { getUser: jest.Mock };
  storage: { from: jest.Mock };
};

/** Builder for `supabase.storage.from(bucket)` returning upload /
 * remove / createSignedUrls jest mocks. */
function storageBucket(
  uploadResult: unknown = { error: null },
  removeResult: unknown = { error: null },
  signResult: unknown = { data: [], error: null },
) {
  return {
    upload: jest.fn().mockResolvedValue(uploadResult),
    remove: jest.fn().mockResolvedValue(removeResult),
    createSignedUrls: jest.fn().mockResolvedValue(signResult),
  };
}

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
      // P4e: text-only post → media_path is explicitly null on the
      // insert row so the DB CHECK can validate body-or-media.
      media_path: null,
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
      // P4d: each row carries count + me-liked annotations. Missing
      // `likes` defaults to count=0, likedByMe=false.
      likeCount: 0,
      likedByMe: false,
    });
    expect(data?.[0].createdAt).toBeInstanceOf(Date);
    // The select clause must include the likes embed so likeCount /
    // likedByMe can be computed without a separate query.
    expect(builder.select).toHaveBeenCalledWith(
      expect.stringMatching(/likes\(liker_id\)/),
    );
  });

  it('annotates each post with likeCount + likedByMe from the embedded likes (P4d)', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'me-id' } } });
    mockSupabase.from.mockReturnValue(
      chainable({
        data: [
          {
            id: 'p1',
            author_id: alice.id,
            body: 'Liked by me + Bob',
            created_at: '2026-05-22T18:00:00.000Z',
            author: alice,
            likes: [{ liker_id: 'me-id' }, { liker_id: bob.id }],
          },
          {
            id: 'p2',
            author_id: bob.id,
            body: 'Liked by no one',
            created_at: '2026-05-22T17:00:00.000Z',
            author: bob,
            likes: [],
          },
          {
            id: 'p3',
            author_id: alice.id,
            body: 'Liked by Bob only',
            created_at: '2026-05-22T16:00:00.000Z',
            author: alice,
            likes: [{ liker_id: bob.id }],
          },
        ],
        error: null,
      }),
    );
    const { data } = await listFeedPosts();
    expect(data?.[0]).toMatchObject({ id: 'p1', likeCount: 2, likedByMe: true });
    expect(data?.[1]).toMatchObject({ id: 'p2', likeCount: 0, likedByMe: false });
    expect(data?.[2]).toMatchObject({ id: 'p3', likeCount: 1, likedByMe: false });
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

describe('createPost with media (P4e)', () => {
  it('uploads the photo to post-media + inserts the row with media_path', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'me-id' } } });
    const bucket = storageBucket();
    mockSupabase.storage.from.mockReturnValue(bucket);
    const builder = chainable({ data: { id: 'p-new' }, error: null });
    mockSupabase.from.mockReturnValue(builder);

    const { id, error } = await createPost({
      body: 'Look at this',
      mediaUri: 'file:///tmp/photo.jpg',
    });
    expect(error).toBeNull();
    expect(id).toBe('p-new');
    expect(mockSupabase.storage.from).toHaveBeenCalledWith('post-media');
    // Upload path starts with <author_id>/ so the storage RLS
    // (path segment 1 = auth.uid()) admits it.
    const uploadPath = bucket.upload.mock.calls[0][0] as string;
    expect(uploadPath.startsWith('me-id/')).toBe(true);
    expect(uploadPath.endsWith('.jpg')).toBe(true);
    // Insert carries the matching media_path.
    expect(builder.insert).toHaveBeenCalledWith({
      author_id: 'me-id',
      body: 'Look at this',
      media_path: uploadPath,
    });
  });

  it('allows a media-only post (empty body)', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'me-id' } } });
    const bucket = storageBucket();
    mockSupabase.storage.from.mockReturnValue(bucket);
    const builder = chainable({ data: { id: 'p-new' }, error: null });
    mockSupabase.from.mockReturnValue(builder);

    const { error } = await createPost({
      body: '   ',
      mediaUri: 'file:///tmp/photo.jpg',
    });
    expect(error).toBeNull();
    expect(builder.insert).toHaveBeenCalledWith(
      expect.objectContaining({ body: null }),
    );
  });

  it('surfaces a friendly error if the storage upload fails (no insert)', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'me-id' } } });
    mockSupabase.storage.from.mockReturnValue(
      storageBucket({ error: { message: 'storage boom' } }),
    );
    const { id, error } = await createPost({
      body: 'hi',
      mediaUri: 'file:///tmp/photo.jpg',
    });
    expect(id).toBeNull();
    expect(error).toMatch(/couldn't upload/i);
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });

  it('cleans up the orphaned storage object when the row insert fails', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'me-id' } } });
    const bucket = storageBucket();
    mockSupabase.storage.from.mockReturnValue(bucket);
    mockSupabase.from.mockReturnValue(
      chainable({ data: null, error: { message: 'insert boom' } }),
    );
    const { id, error } = await createPost({
      body: 'hi',
      mediaUri: 'file:///tmp/photo.jpg',
    });
    expect(id).toBeNull();
    expect(error).toMatch(/couldn't share/i);
    expect(bucket.remove).toHaveBeenCalledTimes(1);
  });
});

describe('listFeedPosts media (P4e)', () => {
  it("annotates each post's media_path + signed mediaUrl from a batched createSignedUrls call", async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'me-id' } } });
    const bucket = storageBucket(
      undefined,
      undefined,
      {
        data: [
          { path: 'a/x.jpg', signedUrl: 'https://signed/x', error: null },
          { path: 'a/y.jpg', signedUrl: 'https://signed/y', error: null },
        ],
        error: null,
      },
    );
    mockSupabase.storage.from.mockReturnValue(bucket);

    mockSupabase.from.mockReturnValue(
      chainable({
        data: [
          {
            id: 'p1',
            author_id: alice.id,
            body: 'with photo',
            media_path: 'a/x.jpg',
            created_at: '2026-05-22T18:00:00.000Z',
            author: alice,
            likes: [],
          },
          {
            id: 'p2',
            author_id: alice.id,
            body: 'media-only',
            media_path: 'a/y.jpg',
            created_at: '2026-05-22T17:00:00.000Z',
            author: alice,
            likes: [],
          },
          {
            id: 'p3',
            author_id: alice.id,
            body: 'text-only',
            media_path: null,
            created_at: '2026-05-22T16:00:00.000Z',
            author: alice,
            likes: [],
          },
        ],
        error: null,
      }),
    );

    const { data } = await listFeedPosts();
    expect(data?.[0]).toMatchObject({
      mediaPath: 'a/x.jpg',
      mediaUrl: 'https://signed/x',
    });
    expect(data?.[1]).toMatchObject({
      mediaPath: 'a/y.jpg',
      mediaUrl: 'https://signed/y',
    });
    expect(data?.[2]).toMatchObject({
      mediaPath: null,
      mediaUrl: null,
    });
    // Single batched sign call with both paths in one round-trip.
    expect(bucket.createSignedUrls).toHaveBeenCalledTimes(1);
    expect(bucket.createSignedUrls.mock.calls[0][0]).toEqual([
      'a/x.jpg',
      'a/y.jpg',
    ]);
  });

  it('skips the createSignedUrls call when no post in the result has media', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'me-id' } } });
    const bucket = storageBucket();
    mockSupabase.storage.from.mockReturnValue(bucket);
    mockSupabase.from.mockReturnValue(
      chainable({
        data: [
          {
            id: 'p1',
            author_id: alice.id,
            body: 'text only',
            media_path: null,
            created_at: '2026-05-22T18:00:00.000Z',
            author: alice,
            likes: [],
          },
        ],
        error: null,
      }),
    );
    const { data } = await listFeedPosts();
    expect(data?.[0].mediaUrl).toBeNull();
    expect(bucket.createSignedUrls).not.toHaveBeenCalled();
  });
});
