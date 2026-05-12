import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { PostComments } from '../components/PostComments';
import {
  createComment,
  deleteComment,
  listPostComments,
} from '../lib/comment-actions';
import { toast } from '../lib/toast';

jest.mock('../lib/comment-actions', () => ({
  listPostComments: jest.fn(),
  createComment: jest.fn(),
  deleteComment: jest.fn(),
}));

jest.mock('../lib/toast', () => ({
  toast: { error: jest.fn(), success: jest.fn() },
}));

const mockedList = listPostComments as jest.MockedFunction<typeof listPostComments>;
const mockedCreate = createComment as jest.MockedFunction<typeof createComment>;
const mockedDelete = deleteComment as jest.MockedFunction<typeof deleteComment>;

const me = { id: 'me-id', display_name: 'Me', color: '#9C27B0' };
const alice = { id: 'a', display_name: 'Alice', color: '#FF6B6B' };
const bob = { id: 'b', display_name: 'Bob', color: '#4ECDC4' };

const baseProps = {
  postId: 'p1',
  postAuthorId: alice.id,
  currentUserId: me.id,
  composeColor: '#9C27B0',
};

beforeEach(() => {
  jest.clearAllMocks();
});

async function flushAsync() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('PostComments', () => {
  it('fetches comments for the post on mount', async () => {
    mockedList.mockResolvedValue({ data: [], error: null });
    render(<PostComments {...baseProps} />);
    await waitFor(() =>
      expect(mockedList).toHaveBeenCalledWith({ postId: 'p1' }),
    );
  });

  it('shows the empty-state copy when there are no comments yet', async () => {
    mockedList.mockResolvedValue({ data: [], error: null });
    render(<PostComments {...baseProps} />);
    await waitFor(() =>
      expect(screen.getByText(/no comments yet/i)).toBeOnTheScreen(),
    );
  });

  it('renders a row per comment with author + body', async () => {
    mockedList.mockResolvedValue({
      data: [
        {
          id: 'c1',
          postId: 'p1',
          author: bob,
          body: 'Nice post',
          createdAt: new Date(),
        },
      ],
      error: null,
    });
    render(<PostComments {...baseProps} />);
    await waitFor(() => expect(screen.getByTestId('comment-c1')).toBeOnTheScreen());
    expect(screen.getByText('Bob')).toBeOnTheScreen();
    expect(screen.getByText('Nice post')).toBeOnTheScreen();
  });

  it('Post button is disabled with empty / whitespace input', async () => {
    mockedList.mockResolvedValue({ data: [], error: null });
    render(<PostComments {...baseProps} />);
    await flushAsync();
    fireEvent.press(screen.getByTestId('comment-post-p1'));
    expect(mockedCreate).not.toHaveBeenCalled();
    fireEvent.changeText(screen.getByTestId('comment-compose-p1'), '   ');
    fireEvent.press(screen.getByTestId('comment-post-p1'));
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('tap Post → createComment → clears input + refetches', async () => {
    mockedList.mockResolvedValue({ data: [], error: null });
    mockedCreate.mockResolvedValue({ id: 'c-new', error: null });
    render(<PostComments {...baseProps} />);
    await flushAsync();
    fireEvent.changeText(screen.getByTestId('comment-compose-p1'), 'first!');
    fireEvent.press(screen.getByTestId('comment-post-p1'));
    await waitFor(() =>
      expect(mockedCreate).toHaveBeenCalledWith({ postId: 'p1', body: 'first!' }),
    );
    await waitFor(() => expect(mockedList).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('comment-compose-p1').props.value).toBe('');
  });

  it('toasts on createComment failure + keeps the input filled (retry path)', async () => {
    mockedList.mockResolvedValue({ data: [], error: null });
    mockedCreate.mockResolvedValue({
      id: null,
      error: "Couldn't post comment. Please try again.",
    });
    render(<PostComments {...baseProps} />);
    await flushAsync();
    fireEvent.changeText(screen.getByTestId('comment-compose-p1'), 'try me');
    fireEvent.press(screen.getByTestId('comment-post-p1'));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/post comment/i)),
    );
    expect(screen.getByTestId('comment-compose-p1').props.value).toBe('try me');
  });

  describe('delete affordance', () => {
    it("shows a trash icon on the viewer's own comment", async () => {
      mockedList.mockResolvedValue({
        data: [
          { id: 'cmine', postId: 'p1', author: me, body: 'mine', createdAt: new Date() },
        ],
        error: null,
      });
      render(<PostComments {...baseProps} />);
      await waitFor(() => screen.getByTestId('comment-cmine'));
      expect(screen.getByTestId('comment-delete-cmine')).toBeOnTheScreen();
    });

    it("shows a trash icon on any comment when the viewer is the post's author (moderation)", async () => {
      mockedList.mockResolvedValue({
        data: [
          { id: 'cbob', postId: 'p1', author: bob, body: 'hi', createdAt: new Date() },
        ],
        error: null,
      });
      render(
        <PostComments
          {...baseProps}
          postAuthorId={me.id}
          currentUserId={me.id}
        />,
      );
      await waitFor(() => screen.getByTestId('comment-cbob'));
      expect(screen.getByTestId('comment-delete-cbob')).toBeOnTheScreen();
    });

    it("hides the trash icon for a non-author non-post-author viewer", async () => {
      mockedList.mockResolvedValue({
        data: [
          { id: 'cbob', postId: 'p1', author: bob, body: 'hi', createdAt: new Date() },
        ],
        error: null,
      });
      render(
        <PostComments
          {...baseProps}
          postAuthorId={alice.id}
          currentUserId={me.id}
        />,
      );
      await waitFor(() => screen.getByTestId('comment-cbob'));
      expect(screen.queryByTestId('comment-delete-cbob')).toBeNull();
    });

    it('tap trash → Alert → destructive → deleteComment + local prune', async () => {
      mockedList.mockResolvedValue({
        data: [
          { id: 'cmine', postId: 'p1', author: me, body: 'mine', createdAt: new Date() },
        ],
        error: null,
      });
      mockedDelete.mockResolvedValue({ error: null });
      const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, btns) => {
        const destructive = btns?.find((b) => b.style === 'destructive');
        destructive?.onPress?.();
      });
      render(<PostComments {...baseProps} />);
      await waitFor(() => screen.getByTestId('comment-cmine'));
      fireEvent.press(screen.getByTestId('comment-delete-cmine'));
      await waitFor(() => expect(mockedDelete).toHaveBeenCalledWith('cmine'));
      await waitFor(() => expect(screen.queryByTestId('comment-cmine')).toBeNull());
      alertSpy.mockRestore();
    });
  });
});
