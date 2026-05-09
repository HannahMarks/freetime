import { act, render, screen, waitFor } from '@testing-library/react-native';
import CalendarScreen from '../app/(app)/calendar';
import { listCalendarItems } from '../lib/calendar-actions';
import { toast } from '../lib/toast';

jest.mock('../lib/calendar-actions', () => ({
  listCalendarItems: jest.fn(),
}));

jest.mock('../lib/toast', () => ({
  toast: { error: jest.fn(), success: jest.fn() },
}));

// Stub out react-native-calendars and capture the most recent props so tests
// can read the markings + simulate day-press / month-change interactions.
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

    // Today is May 13, 2026 → range is [2026-05-01, 2026-06-01).
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

  it("shows 'Free' under the day panel when the selected day has no items", async () => {
    mockedList.mockResolvedValue({ data: [], error: null });
    render(<CalendarScreen />);
    await flushAsync();

    expect(screen.getByText('Today')).toBeOnTheScreen();
    expect(screen.getByText('Free')).toBeOnTheScreen();
  });

  it('shows the selected day items in the panel below the grid', async () => {
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

    expect(screen.getByText(/Alice · Lunch with Sarah/)).toBeOnTheScreen();
    expect(screen.getByTestId('calendar-item-bb:bb1')).toBeOnTheScreen();
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

  it("changes the selected day when the grid's onDayPress fires", async () => {
    mockedList.mockResolvedValue({
      data: [
        { kind: 'unavailable_day', user: bob, date: '2026-05-15', title: 'Wedding' },
      ],
      error: null,
    });
    render(<CalendarScreen />);
    await flushAsync();

    // Initially selecting today (May 13) — Bob's wedding on May 15 isn't in panel yet.
    expect(screen.queryByText(/Bob · Wedding/)).toBeNull();

    await act(async () => {
      lastCalendarProps.onDayPress?.({ dateString: '2026-05-15' });
    });

    expect(screen.getByText(/Bob · Wedding/)).toBeOnTheScreen();
  });

  it('refetches when the user navigates to a new month', async () => {
    mockedList.mockResolvedValue({ data: [], error: null });
    render(<CalendarScreen />);
    await flushAsync();

    expect(mockedList).toHaveBeenCalledTimes(1);

    // react-native-calendars delivers month numbers 1-indexed (June = 6).
    await act(async () => {
      lastCalendarProps.onMonthChange?.({ year: 2026, month: 6 });
    });
    await flushAsync();

    expect(mockedList).toHaveBeenLastCalledWith({
      fromDate: '2026-06-01',
      toDate: '2026-07-01',
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
