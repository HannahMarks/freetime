import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import FeedScreen from '../app/(app)/feed';
import { createPost, deletePost, listFeedPosts } from '../lib/post-actions';
import type { PostItem } from '../lib/post-actions';
import { toast } from '../lib/toast';

jest.mock('../lib/post-actions', () => ({
  listFeedPosts: jest.fn(),
  createPost: jest.fn(),
  deletePost: jest.fn(),
}));

// PostComments transitively imports Supabase via comment-actions.
// Stub it with a thin shim so feed tests don't have to mock the
// whole comments stack — the component's own behavior is covered
// in PostComments.test.tsx.
jest.mock('../components/PostComments', () => ({
  PostComments: (props: { postId: string }) => {
    const React = require('react');
    const { View } = require('react-native');
    return React.createElement(View, { testID: `comments-${props.postId}` });
  },
}));

jest.mock('../lib/toast', () => ({
  toast: { error: jest.fn(), success: jest.fn() },
}));

jest.mock('../lib/auth', () => ({
  useAuth: () => ({
    session: { user: { id: 'me-id' } },
    profile: { id: 'me-id', display_name: 'Me', color: '#9C27B0' },
    loading: false,
    refreshProfile: jest.fn(),
  }),
}));

const mockedList = listFeedPosts as jest.MockedFunction<typeof listFeedPosts>;
const mockedCreate = createPost as jest.MockedFunction<typeof createPost>;
const mockedDelete = deletePost as jest.MockedFunction<typeof deletePost>;

const alice = { id: 'a', display_name: 'Alice', color: '#FF6B6B' };
const me = { id: 'me-id', display_name: 'Me', color: '#9C27B0' };

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers().setSystemTime(new Date(2026, 4, 22, 9, 0));
});
afterEach(() => {
  jest.useRealTimers();
});

async function flushAsync() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('FeedScreen', () => {
  it('renders empty state copy + the compose row when the feed has no posts', async () => {
    mockedList.mockResolvedValue({ data: [], error: null });
    render(<FeedScreen />);
    await flushAsync();
    expect(screen.getByTestId('feed-empty')).toBeOnTheScreen();
    expect(screen.getByTestId('compose-row')).toBeOnTheScreen();
    expect(screen.getByTestId('compose-input')).toBeOnTheScreen();
  });

  it('toasts when listFeedPosts errors', async () => {
    mockedList.mockResolvedValue({
      data: null,
      error: "Couldn't load the feed. Please try again.",
    });
    render(<FeedScreen />);
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/load/i)),
    );
  });

  it('renders one row per post with author name + relative time', async () => {
    const now = new Date(2026, 4, 22, 9, 0);
    const fiveMinAgo = new Date(now.getTime() - 5 * 60_000);
    mockedList.mockResolvedValue({
      data: [
        {
          id: 'p1',
          author: alice,
          body: 'Hi everyone',
          createdAt: fiveMinAgo,
        },
      ],
      error: null,
    });
    render(<FeedScreen />);
    await flushAsync();
    expect(screen.getByTestId('feed-post-p1')).toBeOnTheScreen();
    expect(screen.getByText('Alice')).toBeOnTheScreen();
    expect(screen.getByText('Hi everyone')).toBeOnTheScreen();
    expect(screen.getByText(/5m ago/)).toBeOnTheScreen();
  });

  it('Post button is disabled when the compose box is empty / whitespace', async () => {
    mockedList.mockResolvedValue({ data: [], error: null });
    render(<FeedScreen />);
    await flushAsync();
    const btn = screen.getByTestId('compose-post');
    // Pressing while disabled is a no-op — verify by attempting a
    // press and asserting createPost wasn't called.
    fireEvent.press(btn);
    expect(mockedCreate).not.toHaveBeenCalled();
    // Whitespace-only also shouldn't enable submission.
    fireEvent.changeText(screen.getByTestId('compose-input'), '   ');
    fireEvent.press(btn);
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('tap Post → createPost with the typed body → clears input + refetches', async () => {
    mockedList.mockResolvedValue({ data: [], error: null });
    mockedCreate.mockResolvedValue({ id: 'p-new', error: null });
    render(<FeedScreen />);
    await flushAsync();

    fireEvent.changeText(screen.getByTestId('compose-input'), 'Just shipped P4a!');
    fireEvent.press(screen.getByTestId('compose-post'));
    await waitFor(() =>
      expect(mockedCreate).toHaveBeenCalledWith({ body: 'Just shipped P4a!' }),
    );
    // Refetch fires after a successful create.
    await waitFor(() => expect(mockedList).toHaveBeenCalledTimes(2));
    // Input gets cleared after a successful create.
    expect(screen.getByTestId('compose-input').props.value).toBe('');
  });

  it('toasts on createPost failure and does NOT clear the input (so the user can retry)', async () => {
    mockedList.mockResolvedValue({ data: [], error: null });
    mockedCreate.mockResolvedValue({
      id: null,
      error: "Couldn't share post. Please try again.",
    });
    render(<FeedScreen />);
    await flushAsync();

    fireEvent.changeText(screen.getByTestId('compose-input'), 'hi');
    fireEvent.press(screen.getByTestId('compose-post'));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/share/i)),
    );
    expect(screen.getByTestId('compose-input').props.value).toBe('hi');
  });

  it("shows a delete button only on the viewer's own posts", async () => {
    mockedList.mockResolvedValue({
      data: [
        { id: 'p1', author: alice, body: 'from alice', createdAt: new Date() },
        { id: 'p2', author: me, body: 'from me', createdAt: new Date() },
      ],
      error: null,
    });
    render(<FeedScreen />);
    await flushAsync();
    expect(screen.queryByTestId('feed-delete-p1')).toBeNull();
    expect(screen.getByTestId('feed-delete-p2')).toBeOnTheScreen();
  });

  it('tap trash → Alert → destructive → calls deletePost + removes the row locally', async () => {
    mockedList.mockResolvedValue({
      data: [{ id: 'p2', author: me, body: 'from me', createdAt: new Date() }],
      error: null,
    });
    mockedDelete.mockResolvedValue({ error: null });
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, btns) => {
      const destructive = btns?.find((b) => b.style === 'destructive');
      destructive?.onPress?.();
    });
    render(<FeedScreen />);
    await flushAsync();
    fireEvent.press(screen.getByTestId('feed-delete-p2'));
    await waitFor(() => expect(mockedDelete).toHaveBeenCalledWith('p2'));
    // Row gone after the delete completes (no full refetch — RLS
    // already gated the action, so the local prune is safe).
    await waitFor(() => expect(screen.queryByTestId('feed-post-p2')).toBeNull());
    alertSpy.mockRestore();
  });

  it('Alert "Cancel" does NOT call deletePost', async () => {
    mockedList.mockResolvedValue({
      data: [{ id: 'p2', author: me, body: 'from me', createdAt: new Date() }],
      error: null,
    });
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, btns) => {
      const cancel = btns?.find((b) => b.style === 'cancel');
      cancel?.onPress?.();
    });
    render(<FeedScreen />);
    await flushAsync();
    fireEvent.press(screen.getByTestId('feed-delete-p2'));
    expect(mockedDelete).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it("toasts and doesn't remove the row when deletePost fails", async () => {
    mockedList.mockResolvedValue({
      data: [{ id: 'p2', author: me, body: 'from me', createdAt: new Date() }],
      error: null,
    });
    mockedDelete.mockResolvedValue({
      error: "Couldn't delete post. Please try again.",
    });
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, btns) => {
      const destructive = btns?.find((b) => b.style === 'destructive');
      destructive?.onPress?.();
    });
    render(<FeedScreen />);
    await flushAsync();
    fireEvent.press(screen.getByTestId('feed-delete-p2'));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/delete/i)),
    );
    // Row stays in the list.
    expect(screen.getByTestId('feed-post-p2')).toBeOnTheScreen();
    alertSpy.mockRestore();
  });

  describe('comments toggle (P4c)', () => {
    it('shows a "Comment" toggle on each post row, with the comments thread hidden by default', async () => {
      mockedList.mockResolvedValue({
        data: [{ id: 'p1', author: alice, body: 'hi', createdAt: new Date() }],
        error: null,
      });
      render(<FeedScreen />);
      await flushAsync();
      expect(screen.getByTestId('feed-comments-toggle-p1')).toBeOnTheScreen();
      // PostComments is stubbed; its testID is `comments-${postId}`. It
      // should NOT be rendered until the user opens the thread.
      expect(screen.queryByTestId('comments-p1')).toBeNull();
    });

    it('tapping the toggle expands the inline comments thread; tap again collapses', async () => {
      mockedList.mockResolvedValue({
        data: [{ id: 'p1', author: alice, body: 'hi', createdAt: new Date() }],
        error: null,
      });
      render(<FeedScreen />);
      await flushAsync();
      fireEvent.press(screen.getByTestId('feed-comments-toggle-p1'));
      expect(screen.getByTestId('comments-p1')).toBeOnTheScreen();
      fireEvent.press(screen.getByTestId('feed-comments-toggle-p1'));
      expect(screen.queryByTestId('comments-p1')).toBeNull();
    });

    it('multiple posts can have their threads open at the same time', async () => {
      mockedList.mockResolvedValue({
        data: [
          { id: 'p1', author: alice, body: 'one', createdAt: new Date() },
          { id: 'p2', author: alice, body: 'two', createdAt: new Date() },
        ],
        error: null,
      });
      render(<FeedScreen />);
      await flushAsync();
      fireEvent.press(screen.getByTestId('feed-comments-toggle-p1'));
      fireEvent.press(screen.getByTestId('feed-comments-toggle-p2'));
      expect(screen.getByTestId('comments-p1')).toBeOnTheScreen();
      expect(screen.getByTestId('comments-p2')).toBeOnTheScreen();
    });
  });
});
