import {
  createComment,
  deleteComment,
  listPostComments,
} from '../lib/comment-actions';
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

function chainable(resolved: unknown) {
  const builder: Record<string, jest.Mock> = {};
  const terminal = Promise.resolve(resolved);
  for (const name of [
    'select',
    'insert',
    'delete',
    'eq',
    'order',
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

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

describe('listPostComments', () => {
  it('queries by post_id oldest-first; shapes rows into CommentItem[]', async () => {
    const builder = chainable({
      data: [
        {
          id: 'c1',
          post_id: 'p1',
          author_id: alice.id,
          body: 'Nice',
          created_at: '2026-05-20T18:00:00.000Z',
          author: alice,
        },
      ],
      error: null,
    });
    mockSupabase.from.mockReturnValue(builder);

    const { data, error } = await listPostComments({ postId: 'p1' });
    expect(error).toBeNull();
    expect(mockSupabase.from).toHaveBeenCalledWith('comments');
    expect(builder.eq).toHaveBeenCalledWith('post_id', 'p1');
    expect(builder.order).toHaveBeenCalledWith('created_at', { ascending: true });
    expect(data).toHaveLength(1);
    expect(data?.[0]).toMatchObject({
      id: 'c1',
      postId: 'p1',
      author: alice,
      body: 'Nice',
    });
    expect(data?.[0].createdAt).toBeInstanceOf(Date);
  });

  it('drops rows whose embedded author join is null (defensive)', async () => {
    mockSupabase.from.mockReturnValue(
      chainable({
        data: [
          {
            id: 'c-orphan',
            post_id: 'p1',
            author_id: 'missing',
            body: 'x',
            created_at: '2026-05-20T18:00:00.000Z',
            author: null,
          },
        ],
        error: null,
      }),
    );
    const { data } = await listPostComments({ postId: 'p1' });
    expect(data).toEqual([]);
  });

  it('returns a friendly error on DB failure', async () => {
    mockSupabase.from.mockReturnValue(
      chainable({ data: null, error: { message: 'boom' } }),
    );
    const { data, error } = await listPostComments({ postId: 'p1' });
    expect(data).toBeNull();
    expect(error).toMatch(/couldn't load/i);
  });
});

describe('createComment', () => {
  it('inserts with the live user id + trimmed body; returns the new id', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'me-id' } } });
    const builder = chainable({ data: { id: 'c-new' }, error: null });
    mockSupabase.from.mockReturnValue(builder);

    const { id, error } = await createComment({ postId: 'p1', body: '  hi  ' });
    expect(error).toBeNull();
    expect(id).toBe('c-new');
    expect(builder.insert).toHaveBeenCalledWith({
      post_id: 'p1',
      author_id: 'me-id',
      body: 'hi',
    });
  });

  it('returns "not signed in" with id=null when no session is present', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } });
    const { id, error } = await createComment({ postId: 'p1', body: 'hi' });
    expect(error).toMatch(/not signed in/i);
    expect(id).toBeNull();
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });

  it('rejects an empty / whitespace-only body without a DB round-trip', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'me-id' } } });
    const { id, error } = await createComment({ postId: 'p1', body: '   ' });
    expect(error).toMatch(/empty/i);
    expect(id).toBeNull();
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });

  it('returns a friendly error on DB failure', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'me-id' } } });
    mockSupabase.from.mockReturnValue(
      chainable({ data: null, error: { message: 'boom' } }),
    );
    const { id, error } = await createComment({ postId: 'p1', body: 'hi' });
    expect(error).toMatch(/couldn't post/i);
    expect(id).toBeNull();
  });
});

describe('deleteComment', () => {
  it('deletes by id', async () => {
    const builder = chainable({ error: null });
    mockSupabase.from.mockReturnValue(builder);
    const { error } = await deleteComment('c1');
    expect(error).toBeNull();
    expect(builder.delete).toHaveBeenCalled();
    expect(builder.eq).toHaveBeenCalledWith('id', 'c1');
  });

  it('returns a friendly error on DB failure', async () => {
    mockSupabase.from.mockReturnValue(chainable({ error: { message: 'boom' } }));
    const { error } = await deleteComment('c1');
    expect(error).toMatch(/couldn't delete/i);
  });
});
