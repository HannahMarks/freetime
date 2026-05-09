import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import CalendarScreen from '../app/(app)/calendar';
import { listCalendarItems } from '../lib/calendar-actions';
import { toast } from '../lib/toast';

jest.mock('../lib/calendar-actions', () => ({
  listCalendarItems: jest.fn(),
}));

jest.mock('../lib/toast', () => ({
  toast: { error: jest.fn(), success: jest.fn() },
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
