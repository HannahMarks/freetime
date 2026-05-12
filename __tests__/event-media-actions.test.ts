import { listEventMedia, uploadEventPhoto } from '../lib/event-media-actions';
import { supabase } from '../lib/supabase';

jest.mock('../lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
    auth: { getUser: jest.fn() },
    storage: { from: jest.fn() },
  },
}));

const mockSupabase = supabase as unknown as {
  from: jest.Mock;
  auth: { getUser: jest.Mock };
  storage: { from: jest.Mock };
};

// expo-image-manipulator mock: returns the same uri so the fetch
// mock below can hand back deterministic bytes. The actual resize
// is exercised on-device, not in jest.
jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn(async (uri: string) => ({ uri })),
  SaveFormat: { JPEG: 'jpeg' },
}));

// fetch(local-uri).arrayBuffer() — the RN-safe path-to-bytes shape
// that uploadEventPhoto uses. Mock it to return a tiny buffer so
// the action runs to completion in jest.
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

/** Builder-pattern mock so chained Postgrest calls (`from().select()
 * .eq().order()`) all return the same builder, with a final
 * thenable that resolves to `{data, error}`. */
function chainable(resolved: unknown) {
  const builder: Record<string, jest.Mock> = {};
  const terminal = Promise.resolve(resolved);
  for (const name of [
    'select',
    'insert',
    'update',
    'delete',
    'eq',
    'in',
    'order',
  ]) {
    builder[name] = jest.fn().mockReturnValue(builder);
  }
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

/** Builder for `supabase.storage.from(bucket)` returning upload /
 * remove jest mocks. Each call is independent — tests check call
 * args directly. */
function storageBucket(uploadResult: unknown, removeResult: unknown = { error: null }) {
  return {
    upload: jest.fn().mockResolvedValue(uploadResult),
    remove: jest.fn().mockResolvedValue(removeResult),
  };
}

const alice = { id: 'alice', display_name: 'Alice', color: '#FF6B6B' };

beforeEach(() => {
  jest.clearAllMocks();
});

describe('listEventMedia', () => {
  it('queries event_media for the given event, orders by created_at desc, shapes rows into EventMediaItem[]', async () => {
    const builder = chainable({
      data: [
        {
          id: 'm1',
          event_id: 'ev1',
          uploader_id: alice.id,
          storage_path: 'ev1/alice/abc.jpg',
          media_kind: 'photo',
          duration_seconds: null,
          created_at: '2026-05-20T18:00:00.000Z',
          uploader: alice,
        },
      ],
      error: null,
    });
    mockSupabase.from.mockReturnValue(builder);

    const { data, error } = await listEventMedia({ eventId: 'ev1' });
    expect(error).toBeNull();
    expect(mockSupabase.from).toHaveBeenCalledWith('event_media');
    expect(builder.eq).toHaveBeenCalledWith('event_id', 'ev1');
    expect(builder.order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(data).toHaveLength(1);
    expect(data?.[0]).toMatchObject({
      id: 'm1',
      eventId: 'ev1',
      uploader: alice,
      storagePath: 'ev1/alice/abc.jpg',
      mediaKind: 'photo',
      durationSeconds: null,
    });
    expect(data?.[0].createdAt).toBeInstanceOf(Date);
  });

  it('drops rows whose embedded uploader join is null (defensive)', async () => {
    const builder = chainable({
      data: [
        {
          id: 'm-orphan',
          event_id: 'ev1',
          uploader_id: 'missing',
          storage_path: 'ev1/missing/x.jpg',
          media_kind: 'photo',
          duration_seconds: null,
          created_at: '2026-05-20T18:00:00.000Z',
          uploader: null,
        },
      ],
      error: null,
    });
    mockSupabase.from.mockReturnValue(builder);
    const { data } = await listEventMedia({ eventId: 'ev1' });
    expect(data).toEqual([]);
  });

  it('returns a friendly error on DB failure', async () => {
    mockSupabase.from.mockReturnValue(
      chainable({ data: null, error: { message: 'boom' } }),
    );
    const { data, error } = await listEventMedia({ eventId: 'ev1' });
    expect(data).toBeNull();
    expect(error).toMatch(/couldn't load/i);
  });
});

describe('uploadEventPhoto', () => {
  it('happy path: compress → upload → insert event_media row', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'me-id' } } });
    const bucket = storageBucket({ data: { path: '...' }, error: null });
    mockSupabase.storage.from.mockReturnValue(bucket);
    const insertBuilder = chainable({ error: null });
    mockSupabase.from.mockReturnValue(insertBuilder);

    const { error } = await uploadEventPhoto({ eventId: 'ev1', uri: 'file:///tmp/p.jpg' });
    expect(error).toBeNull();
    // Upload was issued against the event-media bucket with a path
    // that starts with `<event_id>/<uploader_id>/` (matches the
    // storage RLS).
    expect(mockSupabase.storage.from).toHaveBeenCalledWith('event-media');
    expect(bucket.upload).toHaveBeenCalledTimes(1);
    const uploadPath = bucket.upload.mock.calls[0][0] as string;
    expect(uploadPath.startsWith('ev1/me-id/')).toBe(true);
    expect(uploadPath.endsWith('.jpg')).toBe(true);
    // Insert into event_media uses the same path.
    expect(insertBuilder.insert).toHaveBeenCalledWith({
      event_id: 'ev1',
      uploader_id: 'me-id',
      storage_path: uploadPath,
      media_kind: 'photo',
    });
  });

  it('returns "not signed in" when no session is present', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } });
    const { error } = await uploadEventPhoto({ eventId: 'ev1', uri: 'file:///tmp/p.jpg' });
    expect(error).toMatch(/not signed in/i);
    expect(mockSupabase.storage.from).not.toHaveBeenCalled();
  });

  it('surfaces a friendly error if the storage upload fails (no insert attempted)', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'me-id' } } });
    const bucket = storageBucket({ data: null, error: { message: 'storage boom' } });
    mockSupabase.storage.from.mockReturnValue(bucket);

    const { error } = await uploadEventPhoto({ eventId: 'ev1', uri: 'file:///tmp/p.jpg' });
    expect(error).toMatch(/couldn't upload/i);
    expect(bucket.upload).toHaveBeenCalledTimes(1);
    // No metadata insert when storage upload fails — the bucket
    // would have rejected the bytes, so there's nothing to point at.
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });

  it('cleans up the orphaned storage object when the metadata insert fails', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'me-id' } } });
    const bucket = storageBucket({ data: { path: '...' }, error: null });
    mockSupabase.storage.from.mockReturnValue(bucket);
    const insertBuilder = chainable({ error: { message: 'insert boom' } });
    mockSupabase.from.mockReturnValue(insertBuilder);

    const { error } = await uploadEventPhoto({ eventId: 'ev1', uri: 'file:///tmp/p.jpg' });
    expect(error).toMatch(/couldn't record/i);
    // Best-effort orphan cleanup fired.
    expect(bucket.remove).toHaveBeenCalledTimes(1);
    const removePathList = bucket.remove.mock.calls[0][0] as string[];
    expect(removePathList).toHaveLength(1);
    expect(removePathList[0].startsWith('ev1/me-id/')).toBe(true);
  });
});
