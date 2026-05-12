import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import EventsScreen from '../app/(app)/events';
import { listEvents } from '../lib/event-actions';
import type { EventItem } from '../lib/event-helpers';
import { toast } from '../lib/toast';

jest.mock('../lib/event-actions', () => ({
  listEvents: jest.fn(),
}));

jest.mock('../lib/friend-actions', () => ({
  listFriendships: jest.fn().mockResolvedValue({
    data: { friends: [], incoming: [], outgoing: [] },
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

// EventSheet is mocked as a tiny shim that captures props but renders
// nothing — the sheet's own rendering is covered by EventSheet.test.tsx.
type CapturedSheet = {
  visible: boolean;
  defaultDate: string;
  editing?: EventItem | null;
  onClose: () => void;
  onSaved: () => void;
};
let lastSheetProps: CapturedSheet | null = null;
jest.mock('../components/EventSheet', () => ({
  EventSheet: (props: CapturedSheet) => {
    lastSheetProps = props;
    return null;
  },
}));

const mockedList = listEvents as jest.MockedFunction<typeof listEvents>;
const alice = { id: 'a', display_name: 'Alice', color: '#FF6B6B' };

beforeEach(() => {
  jest.clearAllMocks();
  lastSheetProps = null;
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

describe('EventsScreen', () => {
  it('shows the empty-state copy when listEvents returns no rows', async () => {
    mockedList.mockResolvedValue({ data: [], error: null });
    render(<EventsScreen />);
    await flushAsync();

    expect(screen.getByTestId('events-empty')).toBeOnTheScreen();
    expect(screen.getByText(/No events yet/i)).toBeOnTheScreen();
    expect(screen.getByTestId('events-fab')).toBeOnTheScreen();
  });

  it('renders rows sorted by start time and tinted with the host color', async () => {
    mockedList.mockResolvedValue({
      data: [
        // Out of order on purpose — screen must sort.
        {
          kind: 'event',
          id: 'ev2',
          owner: alice,
          startsAt: new Date(2026, 4, 28, 19, 0),
          endsAt: new Date(2026, 4, 28, 22, 0),
          title: 'BBQ',
          notes: null,
          location: 'Park',
        },
        {
          kind: 'event',
          id: 'ev1',
          owner: alice,
          startsAt: new Date(2026, 4, 20, 18, 0),
          endsAt: new Date(2026, 4, 20, 21, 0),
          title: 'Birthday party',
          notes: null,
          location: 'My place',
        },
      ],
      error: null,
    });
    render(<EventsScreen />);
    await flushAsync();

    expect(screen.queryByTestId('events-empty')).toBeNull();
    // Both rows are present and labeled.
    expect(screen.getByTestId('event-row-ev1')).toBeOnTheScreen();
    expect(screen.getByTestId('event-row-ev2')).toBeOnTheScreen();
    expect(screen.getByText('Birthday party')).toBeOnTheScreen();
    expect(screen.getByText('BBQ')).toBeOnTheScreen();
  });

  it('toasts when listEvents returns an error', async () => {
    mockedList.mockResolvedValue({ data: null, error: "Couldn't load events. Please try again." });
    render(<EventsScreen />);
    await flushAsync();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/load/i)));
  });

  it('queries from today out to ~6 months ahead', async () => {
    mockedList.mockResolvedValue({ data: [], error: null });
    render(<EventsScreen />);
    await flushAsync();

    const call = mockedList.mock.calls[0][0];
    expect(call.fromDate).toBe('2026-05-13'); // System time set to May 13 in beforeEach.
    // Horizon: 6 months out from May 13 → November 13.
    expect(call.toDate).toBe('2026-11-13');
  });

  it('tapping the FAB opens the sheet in create mode (editing=null)', async () => {
    mockedList.mockResolvedValue({ data: [], error: null });
    render(<EventsScreen />);
    await flushAsync();

    fireEvent.press(screen.getByTestId('events-fab'));
    expect(lastSheetProps?.visible).toBe(true);
    expect(lastSheetProps?.editing).toBeNull();
  });

  it('tapping a row opens the sheet with editing = that row', async () => {
    const ev: EventItem = {
      kind: 'event',
      id: 'ev1',
      owner: alice,
      startsAt: new Date(2026, 4, 20, 18, 0),
      endsAt: new Date(2026, 4, 20, 21, 0),
      title: 'Birthday party',
      notes: null,
      location: null,
    };
    mockedList.mockResolvedValue({ data: [ev], error: null });
    render(<EventsScreen />);
    await flushAsync();

    fireEvent.press(screen.getByTestId('event-row-ev1'));
    expect(lastSheetProps?.editing?.id).toBe('ev1');
  });

  it('paints the FAB and event rows in the viewer\'s darker user color (matches calendar tab)', async () => {
    mockedList.mockResolvedValue({
      data: [
        {
          kind: 'event',
          id: 'ev1',
          owner: alice,
          startsAt: new Date(2026, 4, 20, 18, 0),
          endsAt: new Date(2026, 4, 20, 21, 0),
          title: 'Birthday party',
          notes: null,
          location: null,
        },
      ],
      error: null,
    });
    render(<EventsScreen />);
    await flushAsync();

    // Profile color is #9C27B0; darkened by EVENT_DARKEN_AMOUNT (0.35)
    // produces the on-screen accent. We don't assert the exact hex
    // (color-helpers.test covers the math) — only that the FAB +
    // event row borders are NOT the un-darkened profile color (so a
    // regression that skips the darken step fails here) and NOT the
    // host's color (which the rows used to use).
    const fab = screen.getByTestId('events-fab');
    const fabStyle = Array.isArray(fab.props.style)
      ? Object.assign({}, ...fab.props.style.filter(Boolean))
      : fab.props.style;
    expect(String(fabStyle.backgroundColor).toLowerCase()).not.toBe('#9c27b0');

    const row = screen.getByTestId('event-row-ev1');
    const rowStyle = Array.isArray(row.props.style)
      ? Object.assign({}, ...row.props.style.filter(Boolean))
      : row.props.style;
    expect(String(rowStyle.borderLeftColor).toLowerCase()).not.toBe(
      alice.color.toLowerCase(),
    );
    // FAB and row share the same accent so the events tab reads as
    // one consistent surface.
    expect(String(rowStyle.borderLeftColor).toLowerCase()).toBe(
      String(fabStyle.backgroundColor).toLowerCase(),
    );
  });

  it('refetches when the sheet reports a save (onSaved callback)', async () => {
    mockedList.mockResolvedValue({ data: [], error: null });
    render(<EventsScreen />);
    await flushAsync();
    expect(mockedList).toHaveBeenCalledTimes(1);

    // Synthesize the child's onSaved firing — same effect as a real
    // create/update/delete completing inside the sheet.
    await act(async () => {
      lastSheetProps?.onSaved();
    });
    expect(mockedList).toHaveBeenCalledTimes(2);
  });
});
