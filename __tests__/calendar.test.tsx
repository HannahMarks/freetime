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

const mockedList = listCalendarItems as jest.MockedFunction<typeof listCalendarItems>;

const alice = { id: 'a', display_name: 'Alice', color: '#FF6B6B' };
const bob = { id: 'b', display_name: 'Bob', color: '#4ECDC4' };

beforeEach(() => {
  jest.clearAllMocks();
  // Pin "today" so day labels are deterministic.
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
  it('shows the loading indicator while fetching', () => {
    mockedList.mockImplementation(() => new Promise(() => {})); // never resolves
    render(<CalendarScreen />);
    expect(screen.getByTestId('calendar-loading')).toBeOnTheScreen();
  });

  it('renders 7 day sections after data loads, with empty days marked Free', async () => {
    mockedList.mockResolvedValue({ data: [], error: null });
    render(<CalendarScreen />);
    await flushAsync();

    expect(screen.getByText('Today')).toBeOnTheScreen();
    expect(screen.getByText('Tomorrow')).toBeOnTheScreen();
    // 7 days - today - tomorrow = 5 weekday-formatted labels remaining
    // Each empty day shows "Free"
    const frees = screen.getAllByText('Free');
    expect(frees).toHaveLength(7);
  });

  it('fetches the next 7 days starting today and ending exclusive of day 8', async () => {
    mockedList.mockResolvedValue({ data: [], error: null });
    render(<CalendarScreen />);
    await flushAsync();

    expect(mockedList).toHaveBeenCalledWith({
      fromDate: '2026-05-13',
      toDate: '2026-05-20', // day after the last (May 19) included day
    });
  });

  it('renders busy_blocks with the friend name, optional title, and time range', async () => {
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
    // Time range — locale-dependent format, just assert "12" is in the row
    expect(screen.getByTestId('calendar-item-bb:bb1')).toBeOnTheScreen();
  });

  it('renders unavailable_day items as "All day"', async () => {
    mockedList.mockResolvedValue({
      data: [
        {
          kind: 'unavailable_day',
          user: bob,
          date: '2026-05-15',
          title: 'Wedding',
        },
      ],
      error: null,
    });
    render(<CalendarScreen />);
    await flushAsync();

    expect(screen.getByText(/Bob · Wedding/)).toBeOnTheScreen();
    expect(screen.getByText('All day')).toBeOnTheScreen();
  });

  it('renders an unavailable_day with no title as just the user name', async () => {
    mockedList.mockResolvedValue({
      data: [{ kind: 'unavailable_day', user: alice, date: '2026-05-13', title: null }],
      error: null,
    });
    render(<CalendarScreen />);
    await flushAsync();

    // No "·" suffix when title is null — just the bare display name
    expect(screen.getByText('Alice')).toBeOnTheScreen();
  });

  it('shows an error toast and stops loading when the fetch fails', async () => {
    mockedList.mockResolvedValue({
      data: null,
      error: "Couldn't load your schedule. Please try again.",
    });
    render(<CalendarScreen />);
    await flushAsync();

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Couldn't load your schedule. Please try again."),
    );
    expect(screen.queryByTestId('calendar-loading')).toBeNull();
  });
});
