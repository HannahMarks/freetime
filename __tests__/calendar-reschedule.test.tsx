// Focused suite for the drag-to-reschedule wiring on CalendarScreen.
// The actual gesture behavior in DayTimeline (long-press → pan → release)
// isn't testable from jest without mocking gesture-handler heavily; instead
// we mock DayTimeline as a thin shim that exposes its `onItemReschedule`
// prop via a testID-driven press, then assert the wiring downstream of it.

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import CalendarScreen from '../app/(app)/calendar';
import { updateBusyBlock } from '../lib/availability-actions';
import { listCalendarItems } from '../lib/calendar-actions';
import { BusyBlockItem } from '../lib/calendar-helpers';
import { toast } from '../lib/toast';

jest.mock('../lib/calendar-actions', () => ({
  listCalendarItems: jest.fn(),
}));

jest.mock('../lib/availability-actions', () => ({
  updateBusyBlock: jest.fn(),
  deleteBusyBlock: jest.fn(),
  deleteUnavailableDay: jest.fn(),
}));

// The calendar tab now imports event-actions + friend-actions for its
// EventSheet + dot-rendering paths. Mock both so this focused suite
// doesn't pull in the real Supabase client.
jest.mock('../lib/event-actions', () => ({
  listEvents: jest.fn().mockResolvedValue({ data: [], error: null }),
  createEvent: jest.fn().mockResolvedValue({ id: null, error: null }),
  updateEvent: jest.fn().mockResolvedValue({ error: null }),
  deleteEvent: jest.fn().mockResolvedValue({ error: null }),
  inviteFriends: jest.fn().mockResolvedValue({ error: null }),
  respondToInvite: jest.fn().mockResolvedValue({ error: null }),
}));

jest.mock('../lib/friend-actions', () => ({
  listFriendships: jest.fn().mockResolvedValue({
    data: { incoming: [], outgoing: [], friends: [] },
    error: null,
  }),
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

jest.mock('react-native-calendars', () => {
  return {
    Calendar: () => {
      const React = require('react');
      const { View } = require('react-native');
      return React.createElement(View, { testID: 'calendar-grid' });
    },
  };
});

// Capture DayTimeline's props on each render. Each owned busy_block gets a
// testID="reschedule-${id}" Pressable that, when fired, calls
// `onItemReschedule(item, newStart, newEnd)` with a +30min shift —
// representing what the real gesture-end handler would do after snapping.
let lastTimelineProps: {
  date?: string;
  items?: BusyBlockItem[];
  currentUserId?: string;
  onItemReschedule?: (item: BusyBlockItem, newStart: Date, newEnd: Date) => void;
  onItemPress?: (item: unknown) => void;
} = {};

jest.mock('../components/DayTimeline', () => ({
  DayTimeline: (props: typeof lastTimelineProps) => {
    lastTimelineProps = props;
    const React = require('react');
    const { View, Pressable, Text } = require('react-native');
    return React.createElement(
      View,
      { testID: 'day-timeline-stub' },
      ...(props.items ?? []).map((item) =>
        item.kind === 'busy_block'
          ? React.createElement(
              Pressable,
              {
                key: item.id,
                testID: `reschedule-${item.id}`,
                onPress: () => {
                  const newStart = new Date(item.startsAt.getTime() + 30 * 60_000);
                  const newEnd = new Date(item.endsAt.getTime() + 30 * 60_000);
                  props.onItemReschedule?.(item, newStart, newEnd);
                },
              },
              React.createElement(Text, null, `block-${item.id}`),
            )
          : null,
      ),
    );
  },
}));

const mockedList = listCalendarItems as jest.MockedFunction<typeof listCalendarItems>;
const mockedUpdate = updateBusyBlock as jest.MockedFunction<typeof updateBusyBlock>;

const me = { id: 'me-id', display_name: 'Me', color: '#888888' };
const alice = { id: 'a', display_name: 'Alice', color: '#FF6B6B' };

const myBlock: BusyBlockItem = {
  kind: 'busy_block',
  id: 'bb1',
  user: me,
  startsAt: new Date(2026, 4, 13, 12, 0),
  endsAt: new Date(2026, 4, 13, 13, 0),
  title: 'Lunch',
  notes: 'Bring deck',
  location: 'Cafe Borrone',
};

const friendsBlock: BusyBlockItem = {
  ...myBlock,
  id: 'bb-other',
  user: alice,
};

beforeEach(() => {
  jest.clearAllMocks();
  lastTimelineProps = {};
  jest.useFakeTimers().setSystemTime(new Date(2026, 4, 13, 9, 0));
});

afterEach(() => {
  jest.useRealTimers();
});

async function flushAsync() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('CalendarScreen drag-to-reschedule wiring', () => {
  it('passes the current user id and an onItemReschedule callback to DayTimeline', async () => {
    mockedList.mockResolvedValue({ data: [myBlock], error: null });
    render(<CalendarScreen />);
    await flushAsync();

    expect(lastTimelineProps.currentUserId).toBe('me-id');
    expect(typeof lastTimelineProps.onItemReschedule).toBe('function');
  });

  it('calls updateBusyBlock with the new start/end (preserving title, notes, location) and refetches', async () => {
    mockedList.mockResolvedValue({ data: [myBlock], error: null });
    mockedUpdate.mockResolvedValue({ error: null });

    render(<CalendarScreen />);
    await flushAsync();

    fireEvent.press(screen.getByTestId('reschedule-bb1'));

    await waitFor(() => expect(mockedUpdate).toHaveBeenCalledTimes(1));
    const call = mockedUpdate.mock.calls[0][0];
    expect(call.id).toBe('bb1');
    // Mock shift is +30 minutes, so start moves 12:00 → 12:30, end 13:00 → 13:30.
    expect(call.startsAt.getHours()).toBe(12);
    expect(call.startsAt.getMinutes()).toBe(30);
    expect(call.endsAt.getHours()).toBe(13);
    expect(call.endsAt.getMinutes()).toBe(30);
    // Title, notes, location are carried over unchanged.
    expect(call.title).toBe('Lunch');
    expect(call.notes).toBe('Bring deck');
    expect(call.location).toBe('Cafe Borrone');

    // Refetch fires after a successful reschedule (mount + post-update).
    await waitFor(() => expect(mockedList).toHaveBeenCalledTimes(2));
  });

  it('toasts and does not refetch when updateBusyBlock fails', async () => {
    mockedList.mockResolvedValue({ data: [myBlock], error: null });
    mockedUpdate.mockResolvedValue({ error: 'Server is grumpy' });

    render(<CalendarScreen />);
    await flushAsync();

    fireEvent.press(screen.getByTestId('reschedule-bb1'));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Server is grumpy'));
    // Only the initial mount fetch — no post-failure refetch.
    expect(mockedList).toHaveBeenCalledTimes(1);
  });

  it("does not surface a reschedule handle for someone else's block", async () => {
    mockedList.mockResolvedValue({ data: [friendsBlock], error: null });
    render(<CalendarScreen />);
    await flushAsync();

    // Friend's block is rendered (so DayTimeline can show it), but the screen
    // passes currentUserId so the timeline knows not to install the gesture.
    // We assert that the pure wiring doesn't fire updateBusyBlock when the
    // mock invokes the callback for a non-owned block — i.e. the screen-level
    // reschedule handler is a no-op for friends' items.
    fireEvent.press(screen.getByTestId('reschedule-bb-other'));
    await flushAsync();
    expect(mockedUpdate).not.toHaveBeenCalled();
  });
});
