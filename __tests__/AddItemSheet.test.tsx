import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { AddItemSheet } from '../components/AddItemSheet';
import {
  createBusyBlock,
  createUnavailableDay,
  deleteBusyBlock,
  deleteUnavailableDay,
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
  deleteBusyBlock: jest.fn(),
  deleteUnavailableDay: jest.fn(),
}));

jest.mock('../lib/toast', () => ({
  toast: { error: jest.fn(), success: jest.fn() },
}));

// Mock TimePicker + DatePicker so tests can introspect the value each was
// rendered with and synthesize an onChange call (simulating the user
// picking a time / date).
type Captured = { testID?: string; value?: Date; onChange?: (d: Date) => void };
const capturedPickers: Captured[] = [];
const capturedDatePickers: Captured[] = [];

jest.mock('../components/TimePicker', () => ({
  TimePicker: (props: Captured) => {
    capturedPickers.push(props);
    return null;
  },
}));

jest.mock('../components/DatePicker', () => ({
  DatePicker: (props: Captured) => {
    capturedDatePickers.push(props);
    return null;
  },
}));

const mockedCreateBusy = createBusyBlock as jest.MockedFunction<typeof createBusyBlock>;
const mockedCreateUnavail = createUnavailableDay as jest.MockedFunction<typeof createUnavailableDay>;
const mockedUpdateBusy = updateBusyBlock as jest.MockedFunction<typeof updateBusyBlock>;
const mockedUpdateUnavail = updateUnavailableDay as jest.MockedFunction<typeof updateUnavailableDay>;
const mockedDeleteBusy = deleteBusyBlock as jest.MockedFunction<typeof deleteBusyBlock>;
const mockedDeleteUnavail = deleteUnavailableDay as jest.MockedFunction<typeof deleteUnavailableDay>;

const me = { id: 'me-id', display_name: 'Me', color: '#888888' };

beforeEach(() => {
  jest.clearAllMocks();
  capturedPickers.length = 0;
  capturedDatePickers.length = 0;
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

function datePickersByTestID() {
  const map: Record<string, Captured> = {};
  for (const p of capturedDatePickers) {
    if (p.testID) map[p.testID] = p;
  }
  return map;
}

describe('AddItemSheet', () => {
  it("doesn't render anything when visible is false", () => {
    render(<AddItemSheet {...baseProps} visible={false} />);
    expect(screen.queryByTestId('add-item-sheet')).toBeNull();
  });

  it('closes without saving when the Close button is pressed', async () => {
    const onClose = jest.fn();
    const onSaved = jest.fn();
    render(<AddItemSheet {...baseProps} onClose={onClose} onSaved={onSaved} />);
    fireEvent.press(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(mockedCreateBusy).not.toHaveBeenCalled();
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
    capturedDatePickers.length = 0;
    fireEvent.press(screen.getByTestId('kind-unavailable'));
    expect(capturedPickers).toHaveLength(0);
    expect(capturedDatePickers).toHaveLength(0);
    expect(screen.getByPlaceholderText('Family wedding')).toBeOnTheScreen();
  });

  it('renders start + end DatePickers initialized to the selectedDate', () => {
    render(<AddItemSheet {...baseProps} />);
    const dates = datePickersByTestID();
    expect(dates['date-picker-start']?.value?.getFullYear()).toBe(2026);
    expect(dates['date-picker-start']?.value?.getMonth()).toBe(4);
    expect(dates['date-picker-start']?.value?.getDate()).toBe(13);
    expect(dates['date-picker-end']?.value?.getDate()).toBe(13);
  });

  it('saves a multi-day busy_block when the end date is moved to a later day', async () => {
    mockedCreateBusy.mockResolvedValue({ error: null });
    render(<AddItemSheet {...baseProps} />);
    fireEvent.changeText(screen.getByPlaceholderText('Lunch with Sarah'), 'Hiking trip');

    await act(async () => {
      const times = pickersByTestID();
      const dates = datePickersByTestID();
      times['time-picker-start'].onChange?.(new Date(2026, 4, 13, 18, 0));
      dates['date-picker-end'].onChange?.(new Date(2026, 4, 15));
      times['time-picker-end'].onChange?.(new Date(2026, 4, 15, 9, 0));
    });

    fireEvent.press(screen.getByLabelText('Save'));

    await waitFor(() => expect(mockedCreateBusy).toHaveBeenCalledTimes(1));
    const call = mockedCreateBusy.mock.calls[0][0];
    expect(call.title).toBe('Hiking trip');
    expect(call.startsAt.getDate()).toBe(13);
    expect(call.startsAt.getHours()).toBe(18);
    expect(call.endsAt.getDate()).toBe(15);
    expect(call.endsAt.getHours()).toBe(9);
  });

  it('preserves the picked time when the start date is changed', async () => {
    // User picks times first, then bumps both dates to a future day — the
    // hours/minutes must survive the date pick.
    mockedCreateBusy.mockResolvedValue({ error: null });
    render(<AddItemSheet {...baseProps} />);

    await act(async () => {
      const times = pickersByTestID();
      times['time-picker-start'].onChange?.(new Date(2026, 4, 13, 14, 30));
      times['time-picker-end'].onChange?.(new Date(2026, 4, 13, 16, 0));
    });
    await act(async () => {
      const dates = datePickersByTestID();
      dates['date-picker-start'].onChange?.(new Date(2026, 4, 16));
      dates['date-picker-end'].onChange?.(new Date(2026, 4, 16));
    });

    fireEvent.press(screen.getByLabelText('Save'));
    await waitFor(() => expect(mockedCreateBusy).toHaveBeenCalled());
    const call = mockedCreateBusy.mock.calls[0][0];
    expect(call.startsAt.getDate()).toBe(16);
    expect(call.startsAt.getHours()).toBe(14);
    expect(call.startsAt.getMinutes()).toBe(30);
    expect(call.endsAt.getDate()).toBe(16);
    expect(call.endsAt.getHours()).toBe(16);
  });

  it('toasts and does not save when end is before start across days', async () => {
    render(<AddItemSheet {...baseProps} />);
    await act(async () => {
      const dates = datePickersByTestID();
      dates['date-picker-end'].onChange?.(new Date(2026, 4, 12)); // earlier than start day
    });
    fireEvent.press(screen.getByLabelText('Save'));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/end time must be after/i)),
    );
    expect(mockedCreateBusy).not.toHaveBeenCalled();
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

    it('pre-fills both date pickers from a multi-day busy_block being edited', () => {
      const editingTrip: CalendarItem = {
        kind: 'busy_block',
        id: 'trip',
        user: me,
        startsAt: new Date(2026, 4, 13, 18, 0),
        endsAt: new Date(2026, 4, 15, 9, 0),
        title: 'Hiking',
      };
      render(<AddItemSheet {...baseProps} editing={editingTrip} />);
      const dates = datePickersByTestID();
      expect(dates['date-picker-start']?.value?.getDate()).toBe(13);
      expect(dates['date-picker-end']?.value?.getDate()).toBe(15);
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

    it('renders a Delete button only in edit mode', () => {
      const { rerender } = render(<AddItemSheet {...baseProps} />);
      expect(screen.queryByLabelText('Delete')).toBeNull();
      rerender(<AddItemSheet {...baseProps} editing={editingBusy} />);
      expect(screen.getByLabelText('Delete')).toBeOnTheScreen();
    });

    it('confirms-then-deletes a busy_block via the Delete button', async () => {
      mockedDeleteBusy.mockResolvedValue({ error: null });
      const onSaved = jest.fn();
      const onClose = jest.fn();
      const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
        const destructive = (buttons ?? []).find((b) => b.style === 'destructive');
        destructive?.onPress?.();
      });

      render(
        <AddItemSheet {...baseProps} editing={editingBusy} onSaved={onSaved} onClose={onClose} />,
      );
      fireEvent.press(screen.getByLabelText('Delete'));

      // Alert was raised for confirmation.
      expect(alertSpy).toHaveBeenCalled();
      await waitFor(() => expect(mockedDeleteBusy).toHaveBeenCalledWith('bb1'));
      // Sheet closes after delete completes.
      await waitFor(() => expect(onSaved).toHaveBeenCalled());
      await waitFor(() => expect(onClose).toHaveBeenCalled());

      alertSpy.mockRestore();
    });

    it('confirms-then-deletes an unavailable_day via the Delete button', async () => {
      mockedDeleteUnavail.mockResolvedValue({ error: null });
      const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
        const destructive = (buttons ?? []).find((b) => b.style === 'destructive');
        destructive?.onPress?.();
      });

      render(<AddItemSheet {...baseProps} editing={editingDay} />);
      fireEvent.press(screen.getByLabelText('Delete'));

      await waitFor(() =>
        expect(mockedDeleteUnavail).toHaveBeenCalledWith({
          userId: 'me-id',
          date: '2026-05-13',
        }),
      );

      alertSpy.mockRestore();
    });

    it("does not delete when the Alert's Cancel button is chosen", async () => {
      const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
        const cancelBtn = (buttons ?? []).find((b) => b.style === 'cancel');
        cancelBtn?.onPress?.();
      });

      render(<AddItemSheet {...baseProps} editing={editingBusy} />);
      fireEvent.press(screen.getByLabelText('Delete'));

      // Brief flush — confirm we don't sneak a delete in.
      await act(async () => {
        await Promise.resolve();
      });
      expect(mockedDeleteBusy).not.toHaveBeenCalled();

      alertSpy.mockRestore();
    });

    it('toasts and stays open when the delete action fails', async () => {
      mockedDeleteBusy.mockResolvedValue({ error: 'Server is grumpy' });
      const onSaved = jest.fn();
      const onClose = jest.fn();
      const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
        const destructive = (buttons ?? []).find((b) => b.style === 'destructive');
        destructive?.onPress?.();
      });

      render(
        <AddItemSheet {...baseProps} editing={editingBusy} onSaved={onSaved} onClose={onClose} />,
      );
      fireEvent.press(screen.getByLabelText('Delete'));

      await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Server is grumpy'));
      expect(onSaved).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();

      alertSpy.mockRestore();
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
