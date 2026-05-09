import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AddItemSheet } from '../components/AddItemSheet';
import {
  createBusyBlock,
  createUnavailableDay,
  updateBusyBlock,
  updateUnavailableDay,
} from '../lib/availability-actions';
import { CalendarItem } from '../lib/calendar-helpers';
import { toast } from '../lib/toast';

jest.mock('../lib/availability-actions', () => ({
  createBusyBlock: jest.fn(),
  createUnavailableDay: jest.fn(),
  updateBusyBlock: jest.fn(),
  updateUnavailableDay: jest.fn(),
}));

jest.mock('../lib/toast', () => ({
  toast: { error: jest.fn(), success: jest.fn() },
}));

// Mock TimePicker so tests can introspect the value it was rendered with
// and synthesize an onChange call (simulating the user picking a time).
type Captured = { testID?: string; value?: Date; onChange?: (d: Date) => void };
const capturedPickers: Captured[] = [];

jest.mock('../components/TimePicker', () => ({
  TimePicker: (props: Captured) => {
    capturedPickers.push(props);
    return null;
  },
}));

const mockedCreateBusy = createBusyBlock as jest.MockedFunction<typeof createBusyBlock>;
const mockedCreateUnavail = createUnavailableDay as jest.MockedFunction<typeof createUnavailableDay>;
const mockedUpdateBusy = updateBusyBlock as jest.MockedFunction<typeof updateBusyBlock>;
const mockedUpdateUnavail = updateUnavailableDay as jest.MockedFunction<typeof updateUnavailableDay>;

const me = { id: 'me-id', display_name: 'Me', color: '#888888' };

beforeEach(() => {
  jest.clearAllMocks();
  capturedPickers.length = 0;
});

const baseProps = {
  visible: true,
  selectedDate: '2026-05-13',
  onClose: jest.fn(),
  onSaved: jest.fn(),
};

function pickersByTestID() {
  // Pickers can be re-rendered multiple times — find the latest one per testID.
  const map: Record<string, Captured> = {};
  for (const p of capturedPickers) {
    if (p.testID) map[p.testID] = p;
  }
  return map;
}

describe('AddItemSheet', () => {
  it("doesn't render anything when visible is false", () => {
    render(<AddItemSheet {...baseProps} visible={false} />);
    expect(screen.queryByTestId('add-item-sheet')).toBeNull();
  });

  it('defaults to busy-time mode and renders start + end TimePickers initialized to 9:00–10:00 on the selected day', () => {
    render(<AddItemSheet {...baseProps} />);
    expect(screen.getByPlaceholderText('Lunch with Sarah')).toBeOnTheScreen();

    const pickers = pickersByTestID();
    const start = pickers['time-picker-start'];
    const end = pickers['time-picker-end'];
    expect(start?.value?.getHours()).toBe(9);
    expect(start?.value?.getMinutes()).toBe(0);
    expect(start?.value?.getDate()).toBe(13);
    expect(start?.value?.getMonth()).toBe(4); // May
    expect(end?.value?.getHours()).toBe(10);
    expect(end?.value?.getMinutes()).toBe(0);
  });

  it('hides time pickers when switched to unavailable-day mode', () => {
    render(<AddItemSheet {...baseProps} />);
    capturedPickers.length = 0;
    fireEvent.press(screen.getByTestId('kind-unavailable'));
    expect(capturedPickers).toHaveLength(0);
    expect(screen.getByPlaceholderText('Family wedding')).toBeOnTheScreen();
  });

  it('saves a busy_block with the picker-selected times and the title', async () => {
    mockedCreateBusy.mockResolvedValue({ error: null });
    const onClose = jest.fn();
    const onSaved = jest.fn();
    render(<AddItemSheet {...baseProps} onClose={onClose} onSaved={onSaved} />);

    fireEvent.changeText(screen.getByPlaceholderText('Lunch with Sarah'), 'Lunch');

    // Simulate the user scrolling each picker to a new time. Wrap in act
    // so the resulting state updates flush before we tap Save.
    await act(async () => {
      const pickers = pickersByTestID();
      pickers['time-picker-start'].onChange?.(new Date(2026, 4, 13, 12, 0));
      pickers['time-picker-end'].onChange?.(new Date(2026, 4, 13, 13, 30));
    });

    fireEvent.press(screen.getByLabelText('Save'));

    await waitFor(() => expect(mockedCreateBusy).toHaveBeenCalledTimes(1));
    const call = mockedCreateBusy.mock.calls[0][0];
    expect(call.title).toBe('Lunch');
    expect(call.startsAt.getHours()).toBe(12);
    expect(call.startsAt.getMinutes()).toBe(0);
    expect(call.endsAt.getHours()).toBe(13);
    expect(call.endsAt.getMinutes()).toBe(30);
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('saves with title=null when title is left blank', async () => {
    mockedCreateBusy.mockResolvedValue({ error: null });
    render(<AddItemSheet {...baseProps} />);
    fireEvent.press(screen.getByLabelText('Save'));
    await waitFor(() => expect(mockedCreateBusy).toHaveBeenCalled());
    expect(mockedCreateBusy.mock.calls[0][0].title).toBeNull();
  });

  it('saves with the default 9:00–10:00 times when the user does not change the pickers', async () => {
    mockedCreateBusy.mockResolvedValue({ error: null });
    render(<AddItemSheet {...baseProps} />);
    fireEvent.press(screen.getByLabelText('Save'));
    await waitFor(() => expect(mockedCreateBusy).toHaveBeenCalled());
    const call = mockedCreateBusy.mock.calls[0][0];
    expect(call.startsAt.getHours()).toBe(9);
    expect(call.endsAt.getHours()).toBe(10);
  });

  it('toasts and does not save when end is not after start', async () => {
    render(<AddItemSheet {...baseProps} />);
    await act(async () => {
      const pickers = pickersByTestID();
      pickers['time-picker-start'].onChange?.(new Date(2026, 4, 13, 17, 0));
      pickers['time-picker-end'].onChange?.(new Date(2026, 4, 13, 17, 0));
    });
    fireEvent.press(screen.getByLabelText('Save'));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/end time must be after/i)),
    );
    expect(mockedCreateBusy).not.toHaveBeenCalled();
  });

  it('toasts and stays open when the action returns an error', async () => {
    mockedCreateBusy.mockResolvedValue({ error: 'Server is grumpy' });
    const onSaved = jest.fn();
    const onClose = jest.fn();
    render(<AddItemSheet {...baseProps} onSaved={onSaved} onClose={onClose} />);
    fireEvent.press(screen.getByLabelText('Save'));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Server is grumpy'));
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  describe('edit mode', () => {
    const editingBusy: CalendarItem = {
      kind: 'busy_block',
      id: 'bb1',
      user: me,
      startsAt: new Date(2026, 4, 13, 14, 0),
      endsAt: new Date(2026, 4, 13, 15, 30),
      title: 'Yoga',
    };
    const editingDay: CalendarItem = {
      kind: 'unavailable_day',
      user: me,
      date: '2026-05-13',
      title: 'PTO',
    };

    it("renders 'Edit' as the heading and hides the kind toggle", () => {
      render(<AddItemSheet {...baseProps} editing={editingBusy} />);
      expect(screen.getByText('Edit')).toBeOnTheScreen();
      expect(screen.queryByTestId('kind-busy')).toBeNull();
      expect(screen.queryByTestId('kind-unavailable')).toBeNull();
    });

    it('pre-fills the title and time pickers from the busy_block being edited', () => {
      render(<AddItemSheet {...baseProps} editing={editingBusy} />);
      expect(screen.getByDisplayValue('Yoga')).toBeOnTheScreen();
      const pickers = pickersByTestID();
      expect(pickers['time-picker-start']?.value?.getHours()).toBe(14);
      expect(pickers['time-picker-end']?.value?.getMinutes()).toBe(30);
    });

    it('calls updateBusyBlock with the new values when saving an edited busy_block', async () => {
      mockedUpdateBusy.mockResolvedValue({ error: null });
      const onSaved = jest.fn();
      const onClose = jest.fn();
      render(
        <AddItemSheet {...baseProps} editing={editingBusy} onSaved={onSaved} onClose={onClose} />,
      );

      // User edits the title and pushes start later by an hour.
      fireEvent.changeText(screen.getByDisplayValue('Yoga'), 'Yoga (rescheduled)');
      await act(async () => {
        const pickers = pickersByTestID();
        pickers['time-picker-start'].onChange?.(new Date(2026, 4, 13, 15, 0));
        pickers['time-picker-end'].onChange?.(new Date(2026, 4, 13, 16, 0));
      });
      fireEvent.press(screen.getByLabelText('Save'));

      await waitFor(() => expect(mockedUpdateBusy).toHaveBeenCalledTimes(1));
      const call = mockedUpdateBusy.mock.calls[0][0];
      expect(call.id).toBe('bb1');
      expect(call.title).toBe('Yoga (rescheduled)');
      expect(call.startsAt.getHours()).toBe(15);
      expect(call.endsAt.getHours()).toBe(16);

      // create-path was not called.
      expect(mockedCreateBusy).not.toHaveBeenCalled();
      await waitFor(() => expect(onSaved).toHaveBeenCalled());
      await waitFor(() => expect(onClose).toHaveBeenCalled());
    });

    it('pre-fills the title for an unavailable_day in edit mode', () => {
      render(<AddItemSheet {...baseProps} editing={editingDay} />);
      expect(screen.getByDisplayValue('PTO')).toBeOnTheScreen();
      // Unavailable mode → no time pickers.
      expect(pickersByTestID()['time-picker-start']).toBeUndefined();
    });

    it('calls updateUnavailableDay with userId + date when saving an edited day marker', async () => {
      mockedUpdateUnavail.mockResolvedValue({ error: null });
      render(<AddItemSheet {...baseProps} editing={editingDay} />);
      fireEvent.changeText(screen.getByDisplayValue('PTO'), 'Sick day');
      fireEvent.press(screen.getByLabelText('Save'));

      await waitFor(() =>
        expect(mockedUpdateUnavail).toHaveBeenCalledWith({
          userId: 'me-id',
          date: '2026-05-13',
          title: 'Sick day',
        }),
      );
    });
  });

  it('saves an unavailable_day with the selectedDate and title', async () => {
    mockedCreateUnavail.mockResolvedValue({ error: null });
    const onSaved = jest.fn();
    const onClose = jest.fn();
    render(<AddItemSheet {...baseProps} onSaved={onSaved} onClose={onClose} />);
    fireEvent.press(screen.getByTestId('kind-unavailable'));
    fireEvent.changeText(screen.getByPlaceholderText('Family wedding'), 'Sick');
    fireEvent.press(screen.getByLabelText('Save'));

    await waitFor(() =>
      expect(mockedCreateUnavail).toHaveBeenCalledWith({
        date: '2026-05-13',
        title: 'Sick',
      }),
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
