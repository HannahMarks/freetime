import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import FriendsScreen from '../app/(app)/friends';
import {
  acceptFriendRequest,
  cancelOutgoingRequest,
  declineFriendRequest,
  listFriendships,
  removeFriend,
  searchProfiles,
  sendFriendRequest,
} from '../lib/friend-actions';
import { toast } from '../lib/toast';

jest.mock('../lib/friend-actions', () => ({
  searchProfiles: jest.fn(),
  listFriendships: jest.fn(),
  sendFriendRequest: jest.fn(),
  acceptFriendRequest: jest.fn(),
  declineFriendRequest: jest.fn(),
  cancelOutgoingRequest: jest.fn(),
  removeFriend: jest.fn(),
}));

jest.mock('../lib/toast', () => ({
  toast: { error: jest.fn(), success: jest.fn() },
}));

jest.mock('../lib/auth', () => ({
  useAuth: () => ({ session: { user: { id: 'me-id' } }, loading: false }),
}));

const mocked = {
  searchProfiles: searchProfiles as jest.MockedFunction<typeof searchProfiles>,
  listFriendships: listFriendships as jest.MockedFunction<typeof listFriendships>,
  sendFriendRequest: sendFriendRequest as jest.MockedFunction<typeof sendFriendRequest>,
  acceptFriendRequest: acceptFriendRequest as jest.MockedFunction<typeof acceptFriendRequest>,
  declineFriendRequest: declineFriendRequest as jest.MockedFunction<typeof declineFriendRequest>,
  cancelOutgoingRequest: cancelOutgoingRequest as jest.MockedFunction<typeof cancelOutgoingRequest>,
  removeFriend: removeFriend as jest.MockedFunction<typeof removeFriend>,
};

const alice = { id: 'alice-id', display_name: 'Alice', color: '#FF6B6B' };
const bob = { id: 'bob-id', display_name: 'Bob', color: '#4ECDC4' };
const carol = { id: 'carol-id', display_name: 'Carol', color: '#FFE66D' };

function fixtureFriendships(overrides: Partial<{ incoming: any[]; outgoing: any[]; friends: any[] }> = {}) {
  return {
    incoming: [],
    outgoing: [],
    friends: [],
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  // Default: empty friendships, no search results.
  mocked.listFriendships.mockResolvedValue({ data: fixtureFriendships(), error: null });
  mocked.searchProfiles.mockResolvedValue({ data: [], error: null });
});

afterEach(() => {
  jest.useRealTimers();
});

async function flushAsync() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('FriendsScreen', () => {
  it('shows empty states for incoming, outgoing, and friends when there are none', async () => {
    render(<FriendsScreen />);
    await flushAsync();

    expect(screen.getByText(/no pending requests/i)).toBeOnTheScreen();
    expect(screen.getByText(/haven't sent any requests/i)).toBeOnTheScreen();
    expect(screen.getByText(/search above to add your first friend/i)).toBeOnTheScreen();
  });

  it('renders incoming, outgoing, and accepted friends in their sections', async () => {
    mocked.listFriendships.mockResolvedValue({
      data: fixtureFriendships({
        incoming: [{ id: 'inc1', status: 'pending', friend: alice, direction: 'incoming' }],
        outgoing: [{ id: 'out1', status: 'pending', friend: bob, direction: 'outgoing' }],
        friends: [{ id: 'fr1', status: 'accepted', friend: carol, direction: 'incoming' }],
      }),
      error: null,
    });

    render(<FriendsScreen />);
    await flushAsync();

    expect(screen.getByText('Alice')).toBeOnTheScreen();
    expect(screen.getByText('Bob')).toBeOnTheScreen();
    expect(screen.getByText('Carol')).toBeOnTheScreen();
    // Action buttons live in their own rows, scoped by row.
    expect(screen.getByRole('button', { name: 'Accept' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeOnTheScreen();
  });

  it('debounces search input then renders matching profiles', async () => {
    mocked.searchProfiles.mockResolvedValue({ data: [alice], error: null });

    render(<FriendsScreen />);
    await flushAsync();

    fireEvent.changeText(screen.getByPlaceholderText('Search friends by name'), 'ali');

    // Search shouldn't fire before the debounce window.
    expect(mocked.searchProfiles).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(300);
    });

    expect(mocked.searchProfiles).toHaveBeenCalledWith('ali', 'me-id');
    expect(screen.getByText('Alice')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Add' })).toBeOnTheScreen();
  });

  it('sends a friend request when Add is tapped and refreshes the list', async () => {
    mocked.searchProfiles.mockResolvedValue({ data: [alice], error: null });
    mocked.sendFriendRequest.mockResolvedValue({ error: null });

    render(<FriendsScreen />);
    await flushAsync();

    fireEvent.changeText(screen.getByPlaceholderText('Search friends by name'), 'ali');
    await act(async () => {
      jest.advanceTimersByTime(300);
    });

    fireEvent.press(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(mocked.sendFriendRequest).toHaveBeenCalledWith('alice-id'));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/sent.+alice/i)),
    );
    // listFriendships called once on mount + once after the request.
    await waitFor(() => expect(mocked.listFriendships).toHaveBeenCalledTimes(2));
  });

  it('accepts an incoming request and refreshes', async () => {
    mocked.listFriendships.mockResolvedValue({
      data: fixtureFriendships({
        incoming: [{ id: 'inc1', status: 'pending', friend: alice, direction: 'incoming' }],
      }),
      error: null,
    });
    mocked.acceptFriendRequest.mockResolvedValue({ error: null });

    render(<FriendsScreen />);
    await flushAsync();

    fireEvent.press(screen.getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(mocked.acceptFriendRequest).toHaveBeenCalledWith('inc1'));
    await waitFor(() => expect(mocked.listFriendships).toHaveBeenCalledTimes(2));
  });

  it('cancels an outgoing request and refreshes', async () => {
    mocked.listFriendships.mockResolvedValue({
      data: fixtureFriendships({
        outgoing: [{ id: 'out1', status: 'pending', friend: bob, direction: 'outgoing' }],
      }),
      error: null,
    });
    mocked.cancelOutgoingRequest.mockResolvedValue({ error: null });

    render(<FriendsScreen />);
    await flushAsync();

    fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(mocked.cancelOutgoingRequest).toHaveBeenCalledWith('out1'));
  });

  it('shows an error toast when a friendship action fails', async () => {
    mocked.listFriendships.mockResolvedValue({
      data: fixtureFriendships({
        incoming: [{ id: 'inc1', status: 'pending', friend: alice, direction: 'incoming' }],
      }),
      error: null,
    });
    mocked.declineFriendRequest.mockResolvedValue({ error: 'Something went wrong.' });

    render(<FriendsScreen />);
    await flushAsync();

    fireEvent.press(screen.getByRole('button', { name: 'Decline' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Something went wrong.'));
  });

  it('shows "Already added" instead of Add for someone already in your friend graph', async () => {
    mocked.listFriendships.mockResolvedValue({
      data: fixtureFriendships({
        friends: [{ id: 'fr1', status: 'accepted', friend: alice, direction: 'incoming' }],
      }),
      error: null,
    });
    mocked.searchProfiles.mockResolvedValue({ data: [alice], error: null });

    render(<FriendsScreen />);
    await flushAsync();

    fireEvent.changeText(screen.getByPlaceholderText('Search friends by name'), 'ali');
    await act(async () => {
      jest.advanceTimersByTime(300);
    });

    expect(screen.getByText('Already added')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Add' })).toBeNull();
  });

  it("removes a friend and refreshes when 'Remove' is tapped", async () => {
    mocked.listFriendships.mockResolvedValue({
      data: fixtureFriendships({
        friends: [{ id: 'fr1', status: 'accepted', friend: carol, direction: 'incoming' }],
      }),
      error: null,
    });
    mocked.removeFriend.mockResolvedValue({ error: null });

    render(<FriendsScreen />);
    await flushAsync();

    fireEvent.press(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(mocked.removeFriend).toHaveBeenCalledWith('fr1'));
  });
});
