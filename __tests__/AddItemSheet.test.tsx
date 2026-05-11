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
  skipBusyBlockOccurrence: jest.fn(),
  skipUnavailableDayOccurrence: jest.fn(),
  moveBusyBlockOccurrence: jest.fn(),
  editUnavailableDayOccurrence: jest.fn(),
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

/** Shared helper: open the sheet on an existing item (view mode), then tap
 * the pencil to enter edit mode. Used by every edit-mode test below. */
function enterEditMode() {
  fireEvent.press(screen.getByTestId('event-edit'));
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
    expect(screen.getByPlaceholderText('Title (optional)')).toBeOnTheScreen();

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
    expect(screen.getByPlaceholderText('Title (optional)')).toBeOnTheScreen();
  });

  it('renders Location and Notes inputs in busy mode', () => {
    render(<AddItemSheet {...baseProps} />);
    expect(screen.getByTestId('input-location')).toBeOnTheScreen();
    expect(screen.getByTestId('input-notes')).toBeOnTheScreen();
  });

  it('renders only Notes (no Location) in unavailable-day mode', () => {
    render(<AddItemSheet {...baseProps} />);
    fireEvent.press(screen.getByTestId('kind-unavailable'));
    expect(screen.getByTestId('input-notes')).toBeOnTheScreen();
    expect(screen.queryByTestId('input-location')).toBeNull();
  });

  it('saves a busy_block with the entered location and notes', async () => {
    mockedCreateBusy.mockResolvedValue({ error: null });
    render(<AddItemSheet {...baseProps} />);
    fireEvent.changeText(screen.getByPlaceholderText('Title (optional)'), 'Lunch');
    fireEvent.changeText(screen.getByTestId('input-location'), 'Cafe Borrone');
    fireEvent.changeText(screen.getByTestId('input-notes'), 'Bring the deck');
    fireEvent.press(screen.getByLabelText('Save'));

    await waitFor(() => expect(mockedCreateBusy).toHaveBeenCalled());
    const call = mockedCreateBusy.mock.calls[0][0];
    expect(call.title).toBe('Lunch');
    expect(call.location).toBe('Cafe Borrone');
    expect(call.notes).toBe('Bring the deck');
  });

  it('saves location + notes as null when those inputs are blank', async () => {
    mockedCreateBusy.mockResolvedValue({ error: null });
    render(<AddItemSheet {...baseProps} />);
    fireEvent.press(screen.getByLabelText('Save'));
    await waitFor(() => expect(mockedCreateBusy).toHaveBeenCalled());
    const call = mockedCreateBusy.mock.calls[0][0];
    expect(call.location).toBeNull();
    expect(call.notes).toBeNull();
  });

  it('saves an unavailable_day with notes', async () => {
    mockedCreateUnavail.mockResolvedValue({ error: null });
    render(<AddItemSheet {...baseProps} />);
    fireEvent.press(screen.getByTestId('kind-unavailable'));
    fireEvent.changeText(screen.getByPlaceholderText('Title (optional)'), 'PTO');
    fireEvent.changeText(screen.getByTestId('input-notes'), 'Out of state');
    fireEvent.press(screen.getByLabelText('Save'));

    await waitFor(() =>
      expect(mockedCreateUnavail).toHaveBeenCalledWith({
        date: '2026-05-13',
        title: 'PTO',
        notes: 'Out of state',
        recurrenceRule: null,
      }),
    );
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
    fireEvent.changeText(screen.getByPlaceholderText('Title (optional)'), 'Hiking trip');

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

    fireEvent.changeText(screen.getByPlaceholderText('Title (optional)'), 'Lunch');

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

  describe('view + edit mode', () => {
    const editingBusy: CalendarItem = {
      kind: 'busy_block',
      id: 'bb1',
      user: me,
      startsAt: new Date(2026, 4, 13, 14, 0),
      endsAt: new Date(2026, 4, 13, 15, 30),
      title: 'Yoga',
      notes: 'Hot vinyasa',
      location: 'Studio 5',
    };
    const editingDay: CalendarItem = {
      kind: 'unavailable_day',
      user: me,
      date: '2026-05-13',
      title: 'PTO',
      notes: 'Hawaii through Sunday',
    };

    describe('view mode (default when opened on an existing item)', () => {
      it('shows the event title as the heading', () => {
        render(<AddItemSheet {...baseProps} editing={editingBusy} />);
        expect(screen.getByText('Yoga')).toBeOnTheScreen();
        // Not the Edit heading.
        expect(screen.queryByText('Edit')).toBeNull();
      });

      it('shows no fallback heading when the item has no title (the date / time lines below carry the meaning)', () => {
        const untitledBusy: CalendarItem = { ...editingBusy, title: null };
        const untitledDay: CalendarItem = { ...editingDay, title: null };
        const { rerender } = render(<AddItemSheet {...baseProps} editing={untitledBusy} />);
        // No "Busy time" / "Unavailable day" sentinel string in the heading.
        expect(screen.queryByText('Busy time')).toBeNull();
        expect(screen.queryByText('Unavailable day')).toBeNull();
        rerender(<AddItemSheet {...baseProps} editing={untitledDay} />);
        expect(screen.queryByText('Busy time')).toBeNull();
        expect(screen.queryByText('Unavailable day')).toBeNull();
        // The view-mode body still renders the date + time so the user
        // can still tell what this event is.
        expect(screen.getByTestId('view-date')).toBeOnTheScreen();
        expect(screen.getByTestId('view-time')).toBeOnTheScreen();
      });

      it('renders the date, time range, location, and notes as read-only text', () => {
        render(<AddItemSheet {...baseProps} editing={editingBusy} />);
        // Date is locale-formatted; just check the year is present.
        expect(screen.getByTestId('view-date').props.children).toMatch(/2026/);
        expect(screen.getByTestId('view-time').props.children).toMatch(/14|2:00/i);
        expect(screen.getByTestId('view-location').props.children).toBe('Studio 5');
        expect(screen.getByTestId('view-notes').props.children).toBe('Hot vinyasa');
      });

      it('shows "All day" instead of a time range for an unavailable_day', () => {
        render(<AddItemSheet {...baseProps} editing={editingDay} />);
        expect(screen.getByTestId('view-time').props.children).toBe('All day');
        expect(screen.getByTestId('view-notes').props.children).toBe('Hawaii through Sunday');
      });

      it('omits the location row when there is no location', () => {
        const noLoc: CalendarItem = { ...editingBusy, location: null };
        render(<AddItemSheet {...baseProps} editing={noLoc} />);
        expect(screen.queryByTestId('view-location')).toBeNull();
      });

      it('omits the notes row when there are no notes', () => {
        const noNotes: CalendarItem = { ...editingBusy, notes: null };
        render(<AddItemSheet {...baseProps} editing={noNotes} />);
        expect(screen.queryByTestId('view-notes')).toBeNull();
      });

      it('does not render the Save button (view mode is read-only)', () => {
        render(<AddItemSheet {...baseProps} editing={editingBusy} />);
        expect(screen.queryByLabelText('Save')).toBeNull();
      });

      it('does not render the form inputs (no pickers, no TextInputs)', () => {
        render(<AddItemSheet {...baseProps} editing={editingBusy} />);
        expect(pickersByTestID()['time-picker-start']).toBeUndefined();
        expect(screen.queryByTestId('input-location')).toBeNull();
        expect(screen.queryByTestId('input-notes')).toBeNull();
      });

      it('renders the pencil edit button', () => {
        render(<AddItemSheet {...baseProps} editing={editingBusy} />);
        expect(screen.getByTestId('event-edit')).toBeOnTheScreen();
      });

      it('does NOT render the pencil button in create mode', () => {
        render(<AddItemSheet {...baseProps} />);
        expect(screen.queryByTestId('event-edit')).toBeNull();
      });
    });

    describe('pencil → edit mode', () => {
      it('switches to the edit form when the pencil is tapped', () => {
        render(<AddItemSheet {...baseProps} editing={editingBusy} />);
        // Initially: pencil shown, no Save button.
        expect(screen.getByTestId('event-edit')).toBeOnTheScreen();
        expect(screen.queryByLabelText('Save')).toBeNull();

        enterEditMode();

        // Now: Edit heading + Save button visible.
        expect(screen.getByText('Edit')).toBeOnTheScreen();
        expect(screen.getByLabelText('Save')).toBeOnTheScreen();
        // The pencil button is hidden in edit mode (only ⋯ remains).
        expect(screen.queryByTestId('event-edit')).toBeNull();
      });

      it("renders 'Edit' as the heading and hides the kind toggle in edit mode", () => {
        render(<AddItemSheet {...baseProps} editing={editingBusy} />);
        enterEditMode();
        expect(screen.getByText('Edit')).toBeOnTheScreen();
        expect(screen.queryByTestId('kind-busy')).toBeNull();
        expect(screen.queryByTestId('kind-unavailable')).toBeNull();
      });

      it('pre-fills the title and time pickers from the busy_block being edited', () => {
        render(<AddItemSheet {...baseProps} editing={editingBusy} />);
        enterEditMode();
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
          notes: null,
          location: null,
        };
        render(<AddItemSheet {...baseProps} editing={editingTrip} />);
        enterEditMode();
        const dates = datePickersByTestID();
        expect(dates['date-picker-start']?.value?.getDate()).toBe(13);
        expect(dates['date-picker-end']?.value?.getDate()).toBe(15);
      });

      it('pre-fills location and notes from the busy_block being edited', () => {
        render(<AddItemSheet {...baseProps} editing={editingBusy} />);
        enterEditMode();
        expect(screen.getByDisplayValue('Hot vinyasa')).toBeOnTheScreen();
        expect(screen.getByDisplayValue('Studio 5')).toBeOnTheScreen();
      });

      it('pre-fills notes from the unavailable_day being edited', () => {
        render(<AddItemSheet {...baseProps} editing={editingDay} />);
        enterEditMode();
        expect(screen.getByDisplayValue('Hawaii through Sunday')).toBeOnTheScreen();
      });

      it('calls updateBusyBlock with the new values when saving an edited busy_block', async () => {
        mockedUpdateBusy.mockResolvedValue({ error: null });
        const onSaved = jest.fn();
        const onClose = jest.fn();
        render(
          <AddItemSheet {...baseProps} editing={editingBusy} onSaved={onSaved} onClose={onClose} />,
        );
        enterEditMode();

        // User edits the title and pushes start later by an hour, and bumps
        // the location text.
        fireEvent.changeText(screen.getByDisplayValue('Yoga'), 'Yoga (rescheduled)');
        fireEvent.changeText(screen.getByDisplayValue('Studio 5'), 'Studio 6');
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
        expect(call.location).toBe('Studio 6');
        expect(call.notes).toBe('Hot vinyasa');

        expect(mockedCreateBusy).not.toHaveBeenCalled();
        await waitFor(() => expect(onSaved).toHaveBeenCalled());
        await waitFor(() => expect(onClose).toHaveBeenCalled());
      });

      it('pre-fills the title for an unavailable_day in edit mode', () => {
        render(<AddItemSheet {...baseProps} editing={editingDay} />);
        enterEditMode();
        expect(screen.getByDisplayValue('PTO')).toBeOnTheScreen();
        // Unavailable mode → no time pickers.
        expect(pickersByTestID()['time-picker-start']).toBeUndefined();
      });

      it('calls updateUnavailableDay with userId + date + edited notes when saving', async () => {
        mockedUpdateUnavail.mockResolvedValue({ error: null });
        render(<AddItemSheet {...baseProps} editing={editingDay} />);
        enterEditMode();
        fireEvent.changeText(screen.getByDisplayValue('PTO'), 'Sick day');
        fireEvent.changeText(
          screen.getByDisplayValue('Hawaii through Sunday'),
          'Quick weekend trip',
        );
        fireEvent.press(screen.getByLabelText('Save'));

        await waitFor(() =>
          expect(mockedUpdateUnavail).toHaveBeenCalledWith({
            userId: 'me-id',
            date: '2026-05-13',
            title: 'Sick day',
            notes: 'Quick weekend trip',
            recurrenceRule: null,
          }),
        );
      });
    });

    describe('three-dots popover menu', () => {
      it('renders the three-dot more-actions button only when editing', () => {
        const { rerender } = render(<AddItemSheet {...baseProps} />);
        expect(screen.queryByTestId('event-more-actions')).toBeNull();
        rerender(<AddItemSheet {...baseProps} editing={editingBusy} />);
        expect(screen.getByTestId('event-more-actions')).toBeOnTheScreen();
      });

      it('does NOT use Alert.alert — opens an in-sheet popover instead', () => {
        const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
        render(<AddItemSheet {...baseProps} editing={editingBusy} />);
        fireEvent.press(screen.getByTestId('event-more-actions'));
        expect(alertSpy).not.toHaveBeenCalled();
        // Popover items appear inline.
        expect(screen.getByTestId('event-menu')).toBeOnTheScreen();
        expect(screen.getByTestId('event-menu-copy')).toBeOnTheScreen();
        expect(screen.getByTestId('event-menu-delete')).toBeOnTheScreen();
        alertSpy.mockRestore();
      });

      it('toggles the menu closed when the three-dots button is tapped a second time', () => {
        render(<AddItemSheet {...baseProps} editing={editingBusy} />);
        fireEvent.press(screen.getByTestId('event-more-actions'));
        expect(screen.getByTestId('event-menu')).toBeOnTheScreen();
        fireEvent.press(screen.getByTestId('event-more-actions'));
        expect(screen.queryByTestId('event-menu')).toBeNull();
      });

      it('closes the menu when the scrim outside the popover is tapped', () => {
        render(<AddItemSheet {...baseProps} editing={editingBusy} />);
        fireEvent.press(screen.getByTestId('event-more-actions'));
        expect(screen.getByTestId('event-menu')).toBeOnTheScreen();
        fireEvent.press(screen.getByTestId('event-menu-scrim'));
        expect(screen.queryByTestId('event-menu')).toBeNull();
      });

      it('the menu offers Copy + Delete for a busy_block', () => {
        render(<AddItemSheet {...baseProps} editing={editingBusy} />);
        fireEvent.press(screen.getByTestId('event-more-actions'));
        expect(screen.getByTestId('event-menu-copy')).toBeOnTheScreen();
        expect(screen.getByTestId('event-menu-delete')).toBeOnTheScreen();
      });

      it('the menu omits Copy for an unavailable_day (PK collision)', () => {
        render(<AddItemSheet {...baseProps} editing={editingDay} />);
        fireEvent.press(screen.getByTestId('event-more-actions'));
        expect(screen.queryByTestId('event-menu-copy')).toBeNull();
        expect(screen.getByTestId('event-menu-delete')).toBeOnTheScreen();
      });

      it('"Copy event" creates a new busy_block with the same fields', async () => {
        mockedCreateBusy.mockResolvedValue({ error: null });
        const onSaved = jest.fn();
        const onClose = jest.fn();
        render(
          <AddItemSheet {...baseProps} editing={editingBusy} onSaved={onSaved} onClose={onClose} />,
        );
        fireEvent.press(screen.getByTestId('event-more-actions'));
        fireEvent.press(screen.getByTestId('event-menu-copy'));

        await waitFor(() => expect(mockedCreateBusy).toHaveBeenCalledTimes(1));
        const call = mockedCreateBusy.mock.calls[0][0];
        expect(call.title).toBe('Yoga');
        expect(call.notes).toBe('Hot vinyasa');
        expect(call.location).toBe('Studio 5');
        expect(call.startsAt).toEqual(
          editingBusy.kind === 'busy_block' ? editingBusy.startsAt : new Date(),
        );
        await waitFor(() => expect(onSaved).toHaveBeenCalled());
        await waitFor(() => expect(onClose).toHaveBeenCalled());
      });

      it('"Delete event" prompts for confirmation, then deletes the busy_block', async () => {
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
        fireEvent.press(screen.getByTestId('event-more-actions'));
        fireEvent.press(screen.getByTestId('event-menu-delete'));

        // Alert was raised for confirmation.
        expect(alertSpy).toHaveBeenCalled();
        await waitFor(() => expect(mockedDeleteBusy).toHaveBeenCalledWith('bb1'));
        await waitFor(() => expect(onSaved).toHaveBeenCalled());
        await waitFor(() => expect(onClose).toHaveBeenCalled());

        alertSpy.mockRestore();
      });

      it('"Delete event" deletes an unavailable_day after confirmation', async () => {
        mockedDeleteUnavail.mockResolvedValue({ error: null });
        const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
          const destructive = (buttons ?? []).find((b) => b.style === 'destructive');
          destructive?.onPress?.();
        });

        render(<AddItemSheet {...baseProps} editing={editingDay} />);
        fireEvent.press(screen.getByTestId('event-more-actions'));
        fireEvent.press(screen.getByTestId('event-menu-delete'));

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
        fireEvent.press(screen.getByTestId('event-more-actions'));
        fireEvent.press(screen.getByTestId('event-menu-delete'));

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
        fireEvent.press(screen.getByTestId('event-more-actions'));
        fireEvent.press(screen.getByTestId('event-menu-delete'));

        await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Server is grumpy'));
        expect(onSaved).not.toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();

        alertSpy.mockRestore();
      });
    });

    describe('per-occurrence skip (recurring busy_blocks)', () => {
      const recurringBusy: CalendarItem = {
        kind: 'busy_block',
        id: 'series1',
        user: me,
        startsAt: new Date(2026, 4, 18, 14, 0),
        endsAt: new Date(2026, 4, 18, 15, 0),
        title: 'Yoga',
        notes: null,
        location: null,
        recurrenceRule: { freq: 'weekly' },
      };

      it('the popover shows BOTH "Delete this occurrence" and "Delete entire series" for a recurring busy_block', () => {
        render(<AddItemSheet {...baseProps} editing={recurringBusy} />);
        fireEvent.press(screen.getByTestId('event-more-actions'));
        expect(screen.getByTestId('event-menu-skip')).toBeOnTheScreen();
        expect(screen.getByTestId('event-menu-delete')).toBeOnTheScreen();
        // Delete-series item label flips for recurring items so the
        // user understands which one's about to fire.
        expect(screen.getByText('Delete entire series')).toBeOnTheScreen();
        expect(screen.queryByText('Delete event')).toBeNull();
      });

      it('the popover shows ONLY "Delete event" (no skip) for a one-off busy_block', () => {
        const oneOff: CalendarItem = { ...recurringBusy, recurrenceRule: null };
        render(<AddItemSheet {...baseProps} editing={oneOff} />);
        fireEvent.press(screen.getByTestId('event-more-actions'));
        expect(screen.queryByTestId('event-menu-skip')).toBeNull();
        expect(screen.getByText('Delete event')).toBeOnTheScreen();
      });

      it('"Delete this occurrence" calls skipBusyBlockOccurrence with the series id + occurrence start', async () => {
        const mockedSkip = jest.requireMock('../lib/availability-actions')
          .skipBusyBlockOccurrence as jest.Mock;
        mockedSkip.mockResolvedValue({ error: null });
        const onSaved = jest.fn();
        const onClose = jest.fn();
        const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
          const destructive = (buttons ?? []).find((b) => b.style === 'destructive');
          destructive?.onPress?.();
        });

        render(
          <AddItemSheet
            {...baseProps}
            editing={recurringBusy}
            onSaved={onSaved}
            onClose={onClose}
          />,
        );
        fireEvent.press(screen.getByTestId('event-more-actions'));
        fireEvent.press(screen.getByTestId('event-menu-skip'));

        await waitFor(() =>
          expect(mockedSkip).toHaveBeenCalledWith({
            seriesId: 'series1',
            originalStart: recurringBusy.kind === 'busy_block' ? recurringBusy.startsAt : new Date(),
          }),
        );
        await waitFor(() => expect(onSaved).toHaveBeenCalled());
        await waitFor(() => expect(onClose).toHaveBeenCalled());

        alertSpy.mockRestore();
      });
    });

    describe('per-occurrence skip (recurring unavailable_days)', () => {
      const recurringDay: CalendarItem = {
        kind: 'unavailable_day',
        user: me,
        date: '2026-05-18', // occurrence date
        seriesDate: '2026-05-11', // series start (PK)
        title: 'Mondays off',
        notes: null,
        recurrenceRule: { freq: 'weekly' },
      };

      it('shows BOTH "Delete this occurrence" and "Delete entire series" for a recurring unavailable_day', () => {
        render(<AddItemSheet {...baseProps} editing={recurringDay} />);
        fireEvent.press(screen.getByTestId('event-more-actions'));
        expect(screen.getByTestId('event-menu-skip')).toBeOnTheScreen();
        expect(screen.getByTestId('event-menu-delete')).toBeOnTheScreen();
        expect(screen.getByText('Delete entire series')).toBeOnTheScreen();
        expect(screen.queryByText('Delete event')).toBeNull();
      });

      it('shows ONLY "Delete event" (no skip) for a one-off unavailable_day', () => {
        const oneOff: CalendarItem = {
          kind: 'unavailable_day',
          user: me,
          date: '2026-05-13',
          title: 'PTO',
          notes: null,
          recurrenceRule: null,
          seriesDate: '2026-05-13',
        };
        render(<AddItemSheet {...baseProps} editing={oneOff} />);
        fireEvent.press(screen.getByTestId('event-more-actions'));
        expect(screen.queryByTestId('event-menu-skip')).toBeNull();
        expect(screen.getByText('Delete event')).toBeOnTheScreen();
      });

      it('"Delete this occurrence" calls skipUnavailableDayOccurrence with seriesUserId + seriesDate + originalDate', async () => {
        const mockedSkipDay = jest.requireMock('../lib/availability-actions')
          .skipUnavailableDayOccurrence as jest.Mock;
        mockedSkipDay.mockResolvedValue({ error: null });
        const onSaved = jest.fn();
        const onClose = jest.fn();
        const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
          const destructive = (buttons ?? []).find((b) => b.style === 'destructive');
          destructive?.onPress?.();
        });

        render(
          <AddItemSheet
            {...baseProps}
            editing={recurringDay}
            onSaved={onSaved}
            onClose={onClose}
          />,
        );
        fireEvent.press(screen.getByTestId('event-more-actions'));
        fireEvent.press(screen.getByTestId('event-menu-skip'));

        await waitFor(() =>
          expect(mockedSkipDay).toHaveBeenCalledWith({
            seriesUserId: 'me-id',
            seriesDate: '2026-05-11',
            originalDate: '2026-05-18',
          }),
        );
        await waitFor(() => expect(onSaved).toHaveBeenCalled());
        await waitFor(() => expect(onClose).toHaveBeenCalled());

        alertSpy.mockRestore();
      });
    });

    describe('date-change for a recurring unavailable_day occurrence', () => {
      const recurringDay: CalendarItem = {
        kind: 'unavailable_day',
        user: me,
        date: '2026-05-18',
        seriesDate: '2026-05-11',
        title: 'Mondays off',
        notes: null,
        recurrenceRule: { freq: 'weekly' },
      };

      it('renders an occurrence-date picker in the edit form (recurring unavailable_day only)', () => {
        render(<AddItemSheet {...baseProps} editing={recurringDay} />);
        fireEvent.press(screen.getByTestId('event-edit'));
        const picker = datePickersByTestID()['occurrence-date-picker'];
        expect(picker).toBeDefined();
        // Pre-filled with the occurrence date, not the series start.
        expect(picker.value?.getFullYear()).toBe(2026);
        expect(picker.value?.getMonth()).toBe(4); // May
        expect(picker.value?.getDate()).toBe(18);
      });

      it('does NOT render the picker for a one-off unavailable_day or a recurring busy_block', () => {
        const oneOff: CalendarItem = {
          kind: 'unavailable_day',
          user: me,
          date: '2026-05-13',
          title: 'PTO',
          notes: null,
          recurrenceRule: null,
          seriesDate: '2026-05-13',
        };
        const recurringBusy: CalendarItem = {
          kind: 'busy_block',
          id: 'series1',
          user: me,
          startsAt: new Date(2026, 4, 18, 14, 0),
          endsAt: new Date(2026, 4, 18, 15, 0),
          title: 'Yoga',
          notes: null,
          location: null,
          recurrenceRule: { freq: 'weekly' },
        };
        const { rerender } = render(<AddItemSheet {...baseProps} editing={oneOff} />);
        fireEvent.press(screen.getByTestId('event-edit'));
        expect(datePickersByTestID()['occurrence-date-picker']).toBeUndefined();
        rerender(<AddItemSheet {...baseProps} editing={recurringBusy} />);
        fireEvent.press(screen.getByTestId('event-edit'));
        expect(datePickersByTestID()['occurrence-date-picker']).toBeUndefined();
      });

      it('saving with "This event only" passes the new date through to editUnavailableDayOccurrence', async () => {
        const mockedEdit = jest.requireMock('../lib/availability-actions')
          .editUnavailableDayOccurrence as jest.Mock;
        mockedEdit.mockResolvedValue({ error: null });
        const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
          const thisOneBtn = (buttons ?? []).find((b) => b.text === 'This event only');
          thisOneBtn?.onPress?.();
        });

        render(<AddItemSheet {...baseProps} editing={recurringDay} />);
        fireEvent.press(screen.getByTestId('event-edit'));
        // User picks a new date — Mon May 18 → Tue May 19.
        await act(async () => {
          const picker = datePickersByTestID()['occurrence-date-picker'];
          picker.onChange?.(new Date(2026, 4, 19));
        });
        fireEvent.press(screen.getByLabelText('Save'));

        await waitFor(() => expect(mockedEdit).toHaveBeenCalled());
        const call = mockedEdit.mock.calls[0][0];
        expect(call.seriesUserId).toBe('me-id');
        expect(call.seriesDate).toBe('2026-05-11');
        expect(call.originalDate).toBe('2026-05-18');
        expect(call.newDate).toBe('2026-05-19');

        alertSpy.mockRestore();
      });

      it('saving without changing the date omits newDate from the action call (override-only exception)', async () => {
        const mockedEdit = jest.requireMock('../lib/availability-actions')
          .editUnavailableDayOccurrence as jest.Mock;
        mockedEdit.mockClear();
        mockedEdit.mockResolvedValue({ error: null });
        const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
          const thisOneBtn = (buttons ?? []).find((b) => b.text === 'This event only');
          thisOneBtn?.onPress?.();
        });

        render(<AddItemSheet {...baseProps} editing={recurringDay} />);
        fireEvent.press(screen.getByTestId('event-edit'));
        // Don't touch the picker — just change the title.
        fireEvent.changeText(screen.getByDisplayValue('Mondays off'), 'Mondays off!!');
        fireEvent.press(screen.getByLabelText('Save'));

        await waitFor(() => expect(mockedEdit).toHaveBeenCalled());
        const call = mockedEdit.mock.calls[0][0];
        // newDate is `undefined` in the call args — the action layer
        // then defaults it to originalDate (an override-only
        // exception, not a true move).
        expect(call.newDate).toBeUndefined();
        expect(call.title).toBe('Mondays off!!');

        alertSpy.mockRestore();
      });
    });
  });

  describe('weekly recurrence', () => {
    it('passes recurrenceRule with byDay auto-seeded to the base weekday when the toggle is on at create-time', async () => {
      mockedCreateBusy.mockResolvedValue({ error: null });
      render(<AddItemSheet {...baseProps} />);

      // Toggle on, then save — busy mode (default), default times.
      // selectedDate '2026-05-13' is a Wednesday → getDay() === 3, so
      // toggling on should auto-pre-select the Wed chip and the saved
      // rule carries `byDay: [3]`. (Auto-seeding makes the chip row
      // not look empty; without it the user would think nothing was
      // selected even though the helper falls back to the base weekday.)
      fireEvent.press(screen.getByTestId('repeat-weekly-toggle'));
      fireEvent.press(screen.getByLabelText('Save'));

      await waitFor(() => expect(mockedCreateBusy).toHaveBeenCalled());
      const call = mockedCreateBusy.mock.calls[0][0];
      expect(call.recurrenceRule).toEqual({ freq: 'weekly', byDay: [3] });
    });

    it('omits recurrenceRule when the toggle is off (default)', async () => {
      mockedCreateBusy.mockResolvedValue({ error: null });
      render(<AddItemSheet {...baseProps} />);
      fireEvent.press(screen.getByLabelText('Save'));

      await waitFor(() => expect(mockedCreateBusy).toHaveBeenCalled());
      const call = mockedCreateBusy.mock.calls[0][0];
      // Either undefined or null is fine — the action defaults to null.
      expect(call.recurrenceRule ?? null).toBeNull();
    });

    it('shows the recurrence toggle in unavailable-day mode (v3 added recurring unavailable_days)', () => {
      render(<AddItemSheet {...baseProps} />);
      fireEvent.press(screen.getByTestId('kind-unavailable'));
      expect(screen.getByTestId('repeat-weekly-toggle')).toBeOnTheScreen();
    });

    it('saves a recurring unavailable_day with the rule', async () => {
      mockedCreateUnavail.mockResolvedValue({ error: null });
      render(<AddItemSheet {...baseProps} />);
      fireEvent.press(screen.getByTestId('kind-unavailable'));
      fireEvent.changeText(screen.getByPlaceholderText('Title (optional)'), 'No-meetings');
      // Toggle recurrence on (auto-seeds Wed since selectedDate is a Wed)
      // and add Friday.
      fireEvent.press(screen.getByTestId('repeat-weekly-toggle'));
      fireEvent.press(screen.getByTestId('byday-5'));
      fireEvent.press(screen.getByLabelText('Save'));

      await waitFor(() => expect(mockedCreateUnavail).toHaveBeenCalled());
      const call = mockedCreateUnavail.mock.calls[0][0];
      expect(call.recurrenceRule).toEqual({ freq: 'weekly', byDay: [3, 5] });
    });

    it('view mode shows the recurrence line with the base weekday when byDay is omitted', () => {
      const editing: CalendarItem = {
        kind: 'busy_block',
        id: 'series1',
        user: me,
        startsAt: new Date(2026, 4, 11, 14, 0), // Mon May 11
        endsAt: new Date(2026, 4, 11, 15, 0),
        title: 'Yoga',
        notes: null,
        location: null,
        recurrenceRule: { freq: 'weekly' },
      };
      render(<AddItemSheet {...baseProps} editing={editing} />);
      // Base is a Monday → summary should call out Monday.
      expect(screen.getByTestId('view-recurrence').props.children).toMatch(
        /Weekly on Monday/i,
      );
    });

    it('view mode lists multiple selected weekdays from byDay', () => {
      const editing: CalendarItem = {
        kind: 'busy_block',
        id: 'series1',
        user: me,
        startsAt: new Date(2026, 4, 11, 14, 0),
        endsAt: new Date(2026, 4, 11, 15, 0),
        title: 'Standup',
        notes: null,
        location: null,
        recurrenceRule: { freq: 'weekly', byDay: [1, 3, 5] }, // Mon Wed Fri
      };
      render(<AddItemSheet {...baseProps} editing={editing} />);
      const text = screen.getByTestId('view-recurrence').props.children as string;
      expect(text).toMatch(/Mon/);
      expect(text).toMatch(/Wed/);
      expect(text).toMatch(/Fri/);
    });

    it('view mode appends the until-date when set', () => {
      const editing: CalendarItem = {
        kind: 'busy_block',
        id: 'series1',
        user: me,
        startsAt: new Date(2026, 4, 11, 14, 0),
        endsAt: new Date(2026, 4, 11, 15, 0),
        title: 'Yoga',
        notes: null,
        location: null,
        recurrenceRule: { freq: 'weekly', until: '2026-12-31' },
      };
      render(<AddItemSheet {...baseProps} editing={editing} />);
      const text = screen.getByTestId('view-recurrence').props.children as string;
      expect(text).toMatch(/until/i);
      expect(text).toMatch(/Dec 31, 2026/);
    });

    it('view mode does NOT show a recurrence line for a one-off item', () => {
      const editing: CalendarItem = {
        kind: 'busy_block',
        id: 'oneoff',
        user: me,
        startsAt: new Date(2026, 4, 11, 14, 0),
        endsAt: new Date(2026, 4, 11, 15, 0),
        title: 'Lunch',
        notes: null,
        location: null,
        recurrenceRule: null,
      };
      render(<AddItemSheet {...baseProps} editing={editing} />);
      expect(screen.queryByTestId('view-recurrence')).toBeNull();
    });

    it('edit form pre-fills the toggle from the existing item, and updateBusyBlock is called with the rule when user picks "Entire series"', async () => {
      mockedUpdateBusy.mockResolvedValue({ error: null });
      const editing: CalendarItem = {
        kind: 'busy_block',
        id: 'series1',
        user: me,
        startsAt: new Date(2026, 4, 11, 14, 0),
        endsAt: new Date(2026, 4, 11, 15, 0),
        title: 'Yoga',
        notes: null,
        location: null,
        recurrenceRule: { freq: 'weekly' },
      };
      // v7: saving a recurring occurrence shows a "this one or entire
      // series" Alert. Mock Alert to pick "Entire series" so the
      // existing updateBusyBlock path fires.
      const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
        const seriesBtn = (buttons ?? []).find((b) => b.text === 'Entire series');
        seriesBtn?.onPress?.();
      });
      render(<AddItemSheet {...baseProps} editing={editing} />);
      // Tap pencil to enter edit mode.
      fireEvent.press(screen.getByTestId('event-edit'));
      // The toggle should already be on. Tap Save without touching it.
      fireEvent.press(screen.getByLabelText('Save'));

      await waitFor(() => expect(mockedUpdateBusy).toHaveBeenCalled());
      expect(mockedUpdateBusy.mock.calls[0][0].recurrenceRule).toEqual({ freq: 'weekly' });

      alertSpy.mockRestore();
    });

    it('toggling off the day-of-base chip and on a different day passes byDay in the saved rule', async () => {
      // Default `selectedDate` = '2026-05-13' (Wed). Toggling Repeat
      // on auto-seeds byDay = [3] (Wed). Tap Mon (1) to add it, then
      // Wed (3) to remove it → byDay = [1] (Mon only).
      mockedCreateBusy.mockResolvedValue({ error: null });
      render(<AddItemSheet {...baseProps} />);
      fireEvent.press(screen.getByTestId('repeat-weekly-toggle'));
      fireEvent.press(screen.getByTestId('byday-1')); // add Mon
      fireEvent.press(screen.getByTestId('byday-3')); // remove Wed
      fireEvent.press(screen.getByLabelText('Save'));

      await waitFor(() => expect(mockedCreateBusy).toHaveBeenCalled());
      expect(mockedCreateBusy.mock.calls[0][0].recurrenceRule).toEqual({
        freq: 'weekly',
        byDay: [1],
      });
    });

    it('saving with the until-toggle on includes `until` in the rule', async () => {
      mockedCreateBusy.mockResolvedValue({ error: null });
      render(<AddItemSheet {...baseProps} />);
      fireEvent.press(screen.getByTestId('repeat-weekly-toggle'));
      // Toggle on the until row (defaults to ~1 month after start).
      fireEvent.press(screen.getByTestId('until-toggle'));
      fireEvent.press(screen.getByLabelText('Save'));

      await waitFor(() => expect(mockedCreateBusy).toHaveBeenCalled());
      const rule = mockedCreateBusy.mock.calls[0][0].recurrenceRule;
      expect(rule).toMatchObject({ freq: 'weekly' });
      // Default until = start + 1 month. Start defaults to 2026-05-13
      // 09:00; so until should be 2026-06-13.
      expect(rule?.until).toBe('2026-06-13');
    });

    it('day-of-week chips and until-toggle are hidden when "Repeat weekly" is OFF', () => {
      render(<AddItemSheet {...baseProps} />);
      expect(screen.queryByTestId('byday-chips')).toBeNull();
      expect(screen.queryByTestId('until-toggle')).toBeNull();
    });

    it('edit mode pre-fills byDay chips and the until-date from the editing item', () => {
      const editing: CalendarItem = {
        kind: 'busy_block',
        id: 'series1',
        user: me,
        startsAt: new Date(2026, 4, 11, 14, 0),
        endsAt: new Date(2026, 4, 11, 15, 0),
        title: 'Yoga',
        notes: null,
        location: null,
        recurrenceRule: { freq: 'weekly', byDay: [1, 3], until: '2026-12-31' },
      };
      render(<AddItemSheet {...baseProps} editing={editing} />);
      fireEvent.press(screen.getByTestId('event-edit'));
      // The chips are accessible — checked state on Mon (1) + Wed (3).
      expect(screen.getByTestId('byday-1').props.accessibilityState.checked).toBe(true);
      expect(screen.getByTestId('byday-3').props.accessibilityState.checked).toBe(true);
      expect(screen.getByTestId('byday-2').props.accessibilityState.checked).toBe(false);
      // Until-toggle is on; until-picker is rendered.
      expect(screen.getByTestId('until-toggle').props.accessibilityState.checked).toBe(true);
    });

    it('toggling off in edit mode saves the row with recurrenceRule = null (turns the series back into a one-off)', async () => {
      mockedUpdateBusy.mockResolvedValue({ error: null });
      const editing: CalendarItem = {
        kind: 'busy_block',
        id: 'series1',
        user: me,
        startsAt: new Date(2026, 4, 11, 14, 0),
        endsAt: new Date(2026, 4, 11, 15, 0),
        title: 'Yoga',
        notes: null,
        location: null,
        recurrenceRule: { freq: 'weekly' },
      };
      // While the toggle is still ON when Save is tapped, the v7
      // Alert appears (the recurring decision is based on
      // `editing.recurrenceRule`, not the form's current toggle
      // state). Pick "Entire series" so the updateBusyBlock path fires.
      const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
        const seriesBtn = (buttons ?? []).find((b) => b.text === 'Entire series');
        seriesBtn?.onPress?.();
      });
      render(<AddItemSheet {...baseProps} editing={editing} />);
      fireEvent.press(screen.getByTestId('event-edit'));
      fireEvent.press(screen.getByTestId('repeat-weekly-toggle'));
      fireEvent.press(screen.getByLabelText('Save'));

      await waitFor(() => expect(mockedUpdateBusy).toHaveBeenCalled());
      expect(mockedUpdateBusy.mock.calls[0][0].recurrenceRule).toBeNull();

      alertSpy.mockRestore();
    });

    it('saving a recurring occurrence and picking "This event only" writes a move exception with override metadata', async () => {
      const mockedMove = jest.requireMock('../lib/availability-actions')
        .moveBusyBlockOccurrence as jest.Mock;
      mockedMove.mockResolvedValue({ error: null });
      const editing: CalendarItem = {
        kind: 'busy_block',
        id: 'series1',
        user: me,
        startsAt: new Date(2026, 4, 18, 14, 0),
        endsAt: new Date(2026, 4, 18, 15, 0),
        title: 'Yoga',
        notes: null,
        location: null,
        recurrenceRule: { freq: 'weekly' },
      };
      const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
        const thisOneBtn = (buttons ?? []).find((b) => b.text === 'This event only');
        thisOneBtn?.onPress?.();
      });

      render(<AddItemSheet {...baseProps} editing={editing} />);
      fireEvent.press(screen.getByTestId('event-edit'));
      // Override the title — keep times the same. The save should
      // write a move exception with new_start = old_start +
      // title override.
      fireEvent.changeText(screen.getByDisplayValue('Yoga'), 'Yoga (special)');
      fireEvent.press(screen.getByLabelText('Save'));

      await waitFor(() => expect(mockedMove).toHaveBeenCalled());
      const call = mockedMove.mock.calls[0][0];
      expect(call.seriesId).toBe('series1');
      expect(call.title).toBe('Yoga (special)');

      alertSpy.mockRestore();
    });

    it('saving a recurring occurrence and picking "Cancel" does NOT call any save action', async () => {
      const mockedMove = jest.requireMock('../lib/availability-actions')
        .moveBusyBlockOccurrence as jest.Mock;
      mockedMove.mockClear();
      mockedUpdateBusy.mockClear();
      const editing: CalendarItem = {
        kind: 'busy_block',
        id: 'series1',
        user: me,
        startsAt: new Date(2026, 4, 18, 14, 0),
        endsAt: new Date(2026, 4, 18, 15, 0),
        title: 'Yoga',
        notes: null,
        location: null,
        recurrenceRule: { freq: 'weekly' },
      };
      const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
        const cancelBtn = (buttons ?? []).find((b) => b.style === 'cancel');
        cancelBtn?.onPress?.();
      });

      render(<AddItemSheet {...baseProps} editing={editing} />);
      fireEvent.press(screen.getByTestId('event-edit'));
      fireEvent.press(screen.getByLabelText('Save'));

      // Brief flush so any in-flight async work would surface.
      await act(async () => {
        await Promise.resolve();
      });
      expect(mockedMove).not.toHaveBeenCalled();
      expect(mockedUpdateBusy).not.toHaveBeenCalled();

      alertSpy.mockRestore();
    });
  });

  it('saves an unavailable_day with the selectedDate and title (notes null when blank)', async () => {
    mockedCreateUnavail.mockResolvedValue({ error: null });
    const onSaved = jest.fn();
    const onClose = jest.fn();
    render(<AddItemSheet {...baseProps} onSaved={onSaved} onClose={onClose} />);
    fireEvent.press(screen.getByTestId('kind-unavailable'));
    fireEvent.changeText(screen.getByPlaceholderText('Title (optional)'), 'Sick');
    fireEvent.press(screen.getByLabelText('Save'));

    await waitFor(() =>
      expect(mockedCreateUnavail).toHaveBeenCalledWith({
        date: '2026-05-13',
        title: 'Sick',
        notes: null,
        recurrenceRule: null,
      }),
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
