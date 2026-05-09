import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import CalendarScreen from '../app/(app)/calendar';
import {
  deleteBusyBlock,
  deleteUnavailableDay,
} from '../lib/availability-actions';
import { listCalendarItems } from '../lib/calendar-actions';
import { toast } from '../lib/toast';

jest.mock('../lib/calendar-actions', () => ({
  listCalendarItems: jest.fn(),
}));

jest.mock('../lib/availability-actions', () => ({
  deleteBusyBlock: jest.fn(),
  deleteUnavailableDay: jest.fn(),
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

// Stub react-native-calendars and capture the most recent props so tests can
// read the markings + simulate day-press / month-change interactions.
let lastCalendarProps: {
  current?: string;
  markedDates?: Record<string, unknown>;
  onDayPress?: (d: { dateString: string }) => void;
  onMonthChange?: (d: { year: number; month: number }) => void;
} = {};

jest.mock('react-native-calendars', () => {
  return {
    Calendar: (props: typeof lastCalendarProps) => {
      lastCalendarProps = props;
      const React = require('react');
      const { View } = require('react-native');
      return React.createElement(View, { testID: 'calendar-grid' });
    },
  };
});

const mockedList = listCalendarItems as jest.MockedFunction<typeof listCalendarItems>;
const mockedDeleteBusy = deleteBusyBlock as jest.MockedFunction<typeof deleteBusyBlock>;
const mockedDeleteDay = deleteUnavailableDay as jest.MockedFunction<typeof deleteUnavailableDay>;

const me = { id: 'me-id', display_name: 'Me', color: '#888888' };

const alice = { id: 'a', display_name: 'Alice', color: '#FF6B6B' };
const bob = { id: 'b', display_name: 'Bob', color: '#4ECDC4' };

beforeEach(() => {
  jest.clearAllMocks();
  lastCalendarProps = {};
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

describe('CalendarScreen', () => {
  it('fetches the current month range on mount', async () => {
    mockedList.mockResolvedValue({ data: [], error: null });
    render(<CalendarScreen />);
    await flushAsync();

    expect(mockedList).toHaveBeenCalledWith({
      fromDate: '2026-05-01',
      toDate: '2026-06-01',
    });
  });

  it('passes the current month string to the Calendar grid', async () => {
    mockedList.mockResolvedValue({ data: [], error: null });
    render(<CalendarScreen />);
    await flushAsync();

    expect(lastCalendarProps.current).toBe('2026-05-01');
  });

  it("highlights today by default with selected: true", async () => {
    mockedList.mockResolvedValue({ data: [], error: null });
    render(<CalendarScreen />);
    await flushAsync();

    const todayMarking = (lastCalendarProps.markedDates as { [k: string]: { selected?: boolean } })[
      '2026-05-13'
    ];
    expect(todayMarking.selected).toBe(true);
  });

  it('renders the day label header for the selected day', async () => {
    mockedList.mockResolvedValue({ data: [], error: null });
    render(<CalendarScreen />);
    await flushAsync();

    expect(screen.getByText('Today')).toBeOnTheScreen();
  });

  it('renders the DayTimeline with the selected day items', async () => {
    mockedList.mockResolvedValue({
      data: [
        {
          kind: 'busy_block',
          id: 'bb1',
          user: alice,
          startsAt: new Date(2026, 4, 13, 12, 0),
          endsAt: new Date(2026, 4, 13, 13, 0),
          title: 'Lunch with Sarah',
        },
      ],
      error: null,
    });
    render(<CalendarScreen />);
    await flushAsync();

    expect(screen.getByTestId('day-block-bb1')).toBeOnTheScreen();
    expect(screen.getByText(/Alice · Lunch with Sarah/)).toBeOnTheScreen();
  });

  it('renders unavailable_day items as a banner above the timeline', async () => {
    mockedList.mockResolvedValue({
      data: [{ kind: 'unavailable_day', user: bob, date: '2026-05-13', title: 'Wedding' }],
      error: null,
    });
    render(<CalendarScreen />);
    await flushAsync();

    expect(screen.getByTestId('day-banner-b')).toBeOnTheScreen();
    expect(screen.getByText(/Bob · Wedding/)).toBeOnTheScreen();
  });

  it('emits a colored dot per friend with items on a day', async () => {
    mockedList.mockResolvedValue({
      data: [
        {
          kind: 'busy_block',
          id: 'bb1',
          user: alice,
          startsAt: new Date(2026, 4, 14, 9, 0),
          endsAt: new Date(2026, 4, 14, 10, 0),
          title: null,
        },
        { kind: 'unavailable_day', user: bob, date: '2026-05-14', title: null },
      ],
      error: null,
    });
    render(<CalendarScreen />);
    await flushAsync();

    const may14 = (lastCalendarProps.markedDates as { [k: string]: { dots?: { color: string }[] } })[
      '2026-05-14'
    ];
    expect(may14.dots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ color: '#FF6B6B' }),
        expect.objectContaining({ color: '#4ECDC4' }),
      ]),
    );
  });

  it("changes the selected day and re-renders the timeline when onDayPress fires", async () => {
    mockedList.mockResolvedValue({
      data: [
        {
          kind: 'busy_block',
          id: 'bb1',
          user: bob,
          startsAt: new Date(2026, 4, 15, 16, 0),
          endsAt: new Date(2026, 4, 15, 17, 0),
          title: 'Coffee',
        },
      ],
      error: null,
    });
    render(<CalendarScreen />);
    await flushAsync();

    // Today (May 13) selected initially → Bob's coffee on May 15 isn't visible.
    expect(screen.queryByTestId('day-block-bb1')).toBeNull();

    await act(async () => {
      lastCalendarProps.onDayPress?.({ dateString: '2026-05-15' });
    });

    expect(screen.getByTestId('day-block-bb1')).toBeOnTheScreen();
  });

  it('shows a multi-day busy_block on every day it spans', async () => {
    mockedList.mockResolvedValue({
      data: [
        {
          kind: 'busy_block',
          id: 'trip',
          user: alice,
          startsAt: new Date(2026, 4, 13, 18, 0),
          endsAt: new Date(2026, 4, 15, 9, 0),
          title: 'Hiking',
        },
      ],
      error: null,
    });
    render(<CalendarScreen />);
    await flushAsync();

    // Today (May 13) is a spanned day.
    expect(screen.getByTestId('day-block-trip')).toBeOnTheScreen();

    // Middle day.
    await act(async () => {
      lastCalendarProps.onDayPress?.({ dateString: '2026-05-14' });
    });
    expect(screen.getByTestId('day-block-trip')).toBeOnTheScreen();

    // End day.
    await act(async () => {
      lastCalendarProps.onDayPress?.({ dateString: '2026-05-15' });
    });
    expect(screen.getByTestId('day-block-trip')).toBeOnTheScreen();

    // Day after — block should be gone.
    await act(async () => {
      lastCalendarProps.onDayPress?.({ dateString: '2026-05-16' });
    });
    expect(screen.queryByTestId('day-block-trip')).toBeNull();
  });

  it('refetches when the user navigates to a new month', async () => {
    mockedList.mockResolvedValue({ data: [], error: null });
    render(<CalendarScreen />);
    await flushAsync();

    expect(mockedList).toHaveBeenCalledTimes(1);

    await act(async () => {
      lastCalendarProps.onMonthChange?.({ year: 2026, month: 6 });
    });
    await flushAsync();

    expect(mockedList).toHaveBeenLastCalledWith({
      fromDate: '2026-06-01',
      toDate: '2026-07-01',
    });
  });

  describe('month-grid collapse toggle', () => {
    it('renders the month grid by default', async () => {
      mockedList.mockResolvedValue({ data: [], error: null });
      render(<CalendarScreen />);
      await flushAsync();
      expect(screen.getByTestId('calendar-grid')).toBeOnTheScreen();
    });

    it("hides the month grid when the toggle is tapped, and updates the accessibility label", async () => {
      mockedList.mockResolvedValue({ data: [], error: null });
      render(<CalendarScreen />);
      await flushAsync();

      fireEvent.press(screen.getByTestId('toggle-month-grid'));

      expect(screen.queryByTestId('calendar-grid')).toBeNull();
      expect(screen.getByLabelText('Show month grid')).toBeOnTheScreen();
    });

    it("shows the month grid again on a second tap, and reverts the accessibility label", async () => {
      mockedList.mockResolvedValue({ data: [], error: null });
      render(<CalendarScreen />);
      await flushAsync();

      const toggle = screen.getByTestId('toggle-month-grid');
      fireEvent.press(toggle);
      fireEvent.press(toggle);

      expect(screen.getByTestId('calendar-grid')).toBeOnTheScreen();
      expect(screen.getByLabelText('Hide month grid')).toBeOnTheScreen();
    });

    it("preserves the selected day's items in the timeline while toggling visibility", async () => {
      mockedList.mockResolvedValue({
        data: [
          {
            kind: 'busy_block',
            id: 'bb1',
            user: alice,
            startsAt: new Date(2026, 4, 13, 12, 0),
            endsAt: new Date(2026, 4, 13, 13, 0),
            title: 'Lunch',
          },
        ],
        error: null,
      });
      render(<CalendarScreen />);
      await flushAsync();

      expect(screen.getByTestId('day-block-bb1')).toBeOnTheScreen();
      fireEvent.press(screen.getByTestId('toggle-month-grid'));
      expect(screen.getByTestId('day-block-bb1')).toBeOnTheScreen();
    });
  });

  describe('add + delete flows', () => {
    it('opens the add sheet when the FAB is pressed and dismisses on Close', async () => {
      mockedList.mockResolvedValue({ data: [], error: null });
      render(<CalendarScreen />);
      await flushAsync();

      expect(screen.queryByTestId('add-item-sheet')).toBeNull();

      fireEvent.press(screen.getByTestId('add-fab'));
      expect(screen.getByTestId('add-item-sheet')).toBeOnTheScreen();

      fireEvent.press(screen.getByLabelText('Close'));
      await waitFor(() => expect(screen.queryByTestId('add-item-sheet')).toBeNull());
    });

    it('renders the FAB with the user\'s profile color', async () => {
      mockedList.mockResolvedValue({ data: [], error: null });
      render(<CalendarScreen />);
      await flushAsync();

      const fab = screen.getByTestId('add-fab');
      // Profile color from the useAuth mock above.
      expect(fab).toHaveStyle({ backgroundColor: '#9C27B0' });
    });

    it("opens the edit sheet directly when the user taps their own item (no action sheet)", async () => {
      mockedList.mockResolvedValue({
        data: [
          {
            kind: 'busy_block',
            id: 'bb1',
            user: me,
            startsAt: new Date(2026, 4, 13, 9, 0),
            endsAt: new Date(2026, 4, 13, 10, 0),
            title: 'Standup',
          },
        ],
        error: null,
      });
      const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

      render(<CalendarScreen />);
      await flushAsync();

      fireEvent.press(screen.getByTestId('day-block-bb1'));

      // No Alert.alert action sheet — the sheet opens directly in edit mode.
      expect(alertSpy).not.toHaveBeenCalled();
      expect(screen.getByText('Edit')).toBeOnTheScreen();
      expect(screen.getByDisplayValue('Standup')).toBeOnTheScreen();

      alertSpy.mockRestore();
    });

    it("ignores taps on someone else's items (RLS-protected, but UI also gates)", async () => {
      mockedList.mockResolvedValue({
        data: [
          {
            kind: 'busy_block',
            id: 'bb1',
            user: alice,
            startsAt: new Date(2026, 4, 13, 9, 0),
            endsAt: new Date(2026, 4, 13, 10, 0),
            title: null,
          },
        ],
        error: null,
      });

      render(<CalendarScreen />);
      await flushAsync();

      fireEvent.press(screen.getByTestId('day-block-bb1'));

      // No sheet opens — the heading would be visible if it had.
      expect(screen.queryByTestId('add-item-sheet')).toBeNull();
      expect(mockedDeleteBusy).not.toHaveBeenCalled();
    });

    it("opens the edit sheet directly when the user taps their own unavailable_day banner", async () => {
      mockedList.mockResolvedValue({
        data: [{ kind: 'unavailable_day', user: me, date: '2026-05-13', title: 'PTO' }],
        error: null,
      });
      const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

      render(<CalendarScreen />);
      await flushAsync();

      fireEvent.press(screen.getByTestId('day-banner-me-id'));

      expect(alertSpy).not.toHaveBeenCalled();
      expect(screen.getByText('Edit')).toBeOnTheScreen();
      expect(screen.getByDisplayValue('PTO')).toBeOnTheScreen();

      alertSpy.mockRestore();
    });

    it('refetches the calendar when the sheet reports a delete', async () => {
      mockedList.mockResolvedValue({
        data: [
          {
            kind: 'busy_block',
            id: 'bb1',
            user: me,
            startsAt: new Date(2026, 4, 13, 9, 0),
            endsAt: new Date(2026, 4, 13, 10, 0),
            title: 'Standup',
          },
        ],
        error: null,
      });
      mockedDeleteBusy.mockResolvedValue({ error: null });
      const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
        // The Delete-confirm Alert: take the destructive branch.
        const destructive = (buttons ?? []).find((b) => b.style === 'destructive');
        destructive?.onPress?.();
      });

      render(<CalendarScreen />);
      await flushAsync();

      fireEvent.press(screen.getByTestId('day-block-bb1'));
      fireEvent.press(screen.getByLabelText('Delete'));

      await waitFor(() => expect(mockedDeleteBusy).toHaveBeenCalledWith('bb1'));
      // Initial mount fetch + post-delete refetch.
      await waitFor(() => expect(mockedList).toHaveBeenCalledTimes(2));

      alertSpy.mockRestore();
    });
  });

  it('shows an error toast when the fetch fails', async () => {
    mockedList.mockResolvedValue({
      data: null,
      error: "Couldn't load your schedule. Please try again.",
    });
    render(<CalendarScreen />);
    await flushAsync();

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Couldn't load your schedule. Please try again."),
    );
  });
});
