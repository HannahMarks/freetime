import { likePost, unlikePost } from '../lib/like-actions';
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
    'update',
    'upsert',
    'delete',
    'eq',
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

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

describe('likePost', () => {
  it('upserts (post_id, liker_id=auth.uid()) with ignoreDuplicates so double-tap is a no-op', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'me-id' } } });
    const builder = chainable({ error: null });
    mockSupabase.from.mockReturnValue(builder);

    const { error } = await likePost({ postId: 'p1' });
    expect(error).toBeNull();
    expect(mockSupabase.from).toHaveBeenCalledWith('likes');
    expect(builder.upsert).toHaveBeenCalledWith(
      { post_id: 'p1', liker_id: 'me-id' },
      { onConflict: 'post_id,liker_id', ignoreDuplicates: true },
    );
  });

  it('returns "not signed in" when no session is present', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } });
    const { error } = await likePost({ postId: 'p1' });
    expect(error).toMatch(/not signed in/i);
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });

  it('returns a friendly error on DB failure', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'me-id' } } });
    mockSupabase.from.mockReturnValue(chainable({ error: { message: 'boom' } }));
    const { error } = await likePost({ postId: 'p1' });
    expect(error).toMatch(/couldn't like/i);
  });
});

describe('unlikePost', () => {
  it('deletes the (post_id, liker_id=auth.uid()) row', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'me-id' } } });
    const builder = chainable({ error: null });
    mockSupabase.from.mockReturnValue(builder);

    const { error } = await unlikePost({ postId: 'p1' });
    expect(error).toBeNull();
    expect(mockSupabase.from).toHaveBeenCalledWith('likes');
    expect(builder.delete).toHaveBeenCalled();
    expect(builder.eq).toHaveBeenNthCalledWith(1, 'post_id', 'p1');
    expect(builder.eq).toHaveBeenNthCalledWith(2, 'liker_id', 'me-id');
  });

  it('returns "not signed in" when no session is present', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } });
    const { error } = await unlikePost({ postId: 'p1' });
    expect(error).toMatch(/not signed in/i);
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });

  it('returns a friendly error on DB failure', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'me-id' } } });
    mockSupabase.from.mockReturnValue(chainable({ error: { message: 'boom' } }));
    const { error } = await unlikePost({ postId: 'p1' });
    expect(error).toMatch(/couldn't unlike/i);
  });
});
