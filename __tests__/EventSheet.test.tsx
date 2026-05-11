import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { EventSheet } from '../components/EventSheet';
import { createEvent, deleteEvent, updateEvent } from '../lib/event-actions';
import type { EventItem } from '../lib/event-helpers';
import { toast } from '../lib/toast';

jest.mock('../lib/event-actions', () => ({
  createEvent: jest.fn(),
  updateEvent: jest.fn(),
  deleteEvent: jest.fn(),
  inviteFriends: jest.fn(),
}));

jest.mock('../lib/toast', () => ({
  toast: { error: jest.fn(), success: jest.fn() },
}));

// Mock DatePicker + TimePicker so tests can introspect the current value
// each was rendered with and synthesize onChange.
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

const mockedCreate = createEvent as jest.MockedFunction<typeof createEvent>;
const mockedUpdate = updateEvent as jest.MockedFunction<typeof updateEvent>;
const mockedDelete = deleteEvent as jest.MockedFunction<typeof deleteEvent>;

const me = { id: 'me-id', display_name: 'Me', color: '#888888' };

beforeEach(() => {
  jest.clearAllMocks();
  capturedPickers.length = 0;
  capturedDatePickers.length = 0;
});

const baseProps = {
  visible: true,
  defaultDate: '2026-05-13',
  onClose: jest.fn(),
  onSaved: jest.fn(),
};

function pickersByTestID() {
  const map: Record<string, Captured> = {};
  for (const p of capturedPickers) if (p.testID) map[p.testID] = p;
  return map;
}
function datePickersByTestID() {
  const map: Record<string, Captured> = {};
  for (const p of capturedDatePickers) if (p.testID) map[p.testID] = p;
  return map;
}

const existingEvent: EventItem = {
  kind: 'event',
  id: 'ev1',
  owner: me,
  startsAt: new Date(2026, 4, 20, 18, 0),
  endsAt: new Date(2026, 4, 20, 21, 0),
  title: 'Birthday party',
  notes: 'Bring drinks',
  location: 'My place',
};

describe('EventSheet', () => {
  it("doesn't render anything when visible is false", () => {
    render(<EventSheet {...baseProps} visible={false} />);
    expect(screen.queryByTestId('event-sheet')).toBeNull();
  });

  describe('create mode', () => {
    it('shows the "Plan an event" heading and default 6pm–9pm times on the default date', () => {
      render(<EventSheet {...baseProps} />);
      expect(screen.getByText('Plan an event')).toBeOnTheScreen();
      const times = pickersByTestID();
      expect(times['time-picker-start']?.value?.getHours()).toBe(18);
      expect(times['time-picker-end']?.value?.getHours()).toBe(21);
      expect(times['time-picker-start']?.value?.getDate()).toBe(13);
    });

    it('calls createEvent with the form values on Save', async () => {
      mockedCreate.mockResolvedValue({ id: 'ev-new', error: null });
      render(<EventSheet {...baseProps} />);
      fireEvent.changeText(screen.getByPlaceholderText('Title (optional)'), 'Birthday party');
      fireEvent.changeText(screen.getByTestId('input-location'), 'My place');
      fireEvent.changeText(screen.getByTestId('input-notes'), 'Bring drinks');
      fireEvent.press(screen.getByLabelText('Save'));

      await waitFor(() => expect(mockedCreate).toHaveBeenCalled());
      const call = mockedCreate.mock.calls[0][0];
      expect(call.title).toBe('Birthday party');
      expect(call.location).toBe('My place');
      expect(call.notes).toBe('Bring drinks');
      expect(call.startsAt.getHours()).toBe(18);
      expect(call.endsAt.getHours()).toBe(21);
    });

    it('toasts and does NOT call createEvent when end time is not after start time', async () => {
      render(<EventSheet {...baseProps} />);
      await act(async () => {
        const times = pickersByTestID();
        times['time-picker-end'].onChange?.(new Date(2026, 4, 13, 18, 0)); // == start
      });
      fireEvent.press(screen.getByLabelText('Save'));
      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/end time must be after/i)),
      );
      expect(mockedCreate).not.toHaveBeenCalled();
    });

    it('toasts and stays open on a DB error', async () => {
      mockedCreate.mockResolvedValue({ id: null, error: "Couldn't create event. Please try again." });
      const onSaved = jest.fn();
      const onClose = jest.fn();
      render(<EventSheet {...baseProps} onSaved={onSaved} onClose={onClose} />);
      fireEvent.press(screen.getByLabelText('Save'));
      await waitFor(() => expect(toast.error).toHaveBeenCalled());
      expect(onSaved).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe('view + edit mode', () => {
    it('opens in view mode for an existing event — title as heading, no Save button', () => {
      render(<EventSheet {...baseProps} editing={existingEvent} />);
      expect(screen.getByText('Birthday party')).toBeOnTheScreen();
      expect(screen.queryByLabelText('Save')).toBeNull();
      // View-mode body rows.
      expect(screen.getByTestId('view-date').props.children).toMatch(/2026/);
      expect(screen.getByTestId('view-location').props.children).toBe('My place');
      expect(screen.getByTestId('view-notes').props.children).toBe('Bring drinks');
    });

    it('shows pencil + trash icons in view mode; pencil enters edit mode', () => {
      render(<EventSheet {...baseProps} editing={existingEvent} />);
      expect(screen.getByTestId('event-sheet-edit')).toBeOnTheScreen();
      expect(screen.getByTestId('event-sheet-delete')).toBeOnTheScreen();

      fireEvent.press(screen.getByTestId('event-sheet-edit'));
      // Now in edit mode — heading flips and Save appears.
      expect(screen.getByText('Edit event')).toBeOnTheScreen();
      expect(screen.getByLabelText('Save')).toBeOnTheScreen();
    });

    it('pre-fills the form with the existing event values when entering edit mode', () => {
      render(<EventSheet {...baseProps} editing={existingEvent} />);
      fireEvent.press(screen.getByTestId('event-sheet-edit'));
      expect(screen.getByDisplayValue('Birthday party')).toBeOnTheScreen();
      expect(screen.getByDisplayValue('Bring drinks')).toBeOnTheScreen();
      expect(screen.getByDisplayValue('My place')).toBeOnTheScreen();
      const times = pickersByTestID();
      expect(times['time-picker-start']?.value?.getHours()).toBe(18);
      expect(times['time-picker-end']?.value?.getHours()).toBe(21);
    });

    it('calls updateEvent with the edited values on Save', async () => {
      mockedUpdate.mockResolvedValue({ error: null });
      const onSaved = jest.fn();
      const onClose = jest.fn();
      render(<EventSheet {...baseProps} editing={existingEvent} onSaved={onSaved} onClose={onClose} />);
      fireEvent.press(screen.getByTestId('event-sheet-edit'));
      fireEvent.changeText(screen.getByDisplayValue('Birthday party'), 'Birthday party (rescheduled)');
      fireEvent.press(screen.getByLabelText('Save'));

      await waitFor(() => expect(mockedUpdate).toHaveBeenCalled());
      const call = mockedUpdate.mock.calls[0][0];
      expect(call.id).toBe('ev1');
      expect(call.title).toBe('Birthday party (rescheduled)');
      expect(mockedCreate).not.toHaveBeenCalled();
      await waitFor(() => expect(onSaved).toHaveBeenCalled());
      await waitFor(() => expect(onClose).toHaveBeenCalled());
    });

    it('trash → Alert.alert → destructive → calls deleteEvent', async () => {
      mockedDelete.mockResolvedValue({ error: null });
      const onSaved = jest.fn();
      const onClose = jest.fn();
      const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
        const destructive = (buttons ?? []).find((b) => b.style === 'destructive');
        destructive?.onPress?.();
      });

      render(<EventSheet {...baseProps} editing={existingEvent} onSaved={onSaved} onClose={onClose} />);
      fireEvent.press(screen.getByTestId('event-sheet-delete'));

      expect(alertSpy).toHaveBeenCalled();
      await waitFor(() => expect(mockedDelete).toHaveBeenCalledWith('ev1'));
      await waitFor(() => expect(onSaved).toHaveBeenCalled());
      await waitFor(() => expect(onClose).toHaveBeenCalled());

      alertSpy.mockRestore();
    });

    it('Alert "Cancel" does NOT call deleteEvent', async () => {
      const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
        const cancel = (buttons ?? []).find((b) => b.style === 'cancel');
        cancel?.onPress?.();
      });
      render(<EventSheet {...baseProps} editing={existingEvent} />);
      fireEvent.press(screen.getByTestId('event-sheet-delete'));
      await act(async () => {
        await Promise.resolve();
      });
      expect(mockedDelete).not.toHaveBeenCalled();
      alertSpy.mockRestore();
    });
  });

  describe('view mode: optional fields hidden when empty', () => {
    it('omits the location row when location is null', () => {
      render(<EventSheet {...baseProps} editing={{ ...existingEvent, location: null }} />);
      expect(screen.queryByTestId('view-location')).toBeNull();
    });

    it('omits the notes row when notes is null', () => {
      render(<EventSheet {...baseProps} editing={{ ...existingEvent, notes: null }} />);
      expect(screen.queryByTestId('view-notes')).toBeNull();
    });
  });

  it('renders both date pickers initialized to the start/end of the editing event', () => {
    render(<EventSheet {...baseProps} editing={existingEvent} />);
    // Enter edit mode so the pickers mount.
    fireEvent.press(screen.getByTestId('event-sheet-edit'));
    const dates = datePickersByTestID();
    expect(dates['date-picker-start']?.value?.getDate()).toBe(20);
    expect(dates['date-picker-end']?.value?.getDate()).toBe(20);
    expect(dates['date-picker-start']?.value?.getMonth()).toBe(4); // May
  });

  describe('invite picker (create mode)', () => {
    const alice = { id: 'a', display_name: 'Alice', color: '#FF6B6B' };
    const bob = { id: 'b', display_name: 'Bob', color: '#4ECDC4' };

    it('renders one chip per accepted friend in create mode', () => {
      render(<EventSheet {...baseProps} friends={[alice, bob]} />);
      expect(screen.getByTestId('invite-picker')).toBeOnTheScreen();
      expect(screen.getByTestId('invite-chip-a')).toBeOnTheScreen();
      expect(screen.getByTestId('invite-chip-b')).toBeOnTheScreen();
      // Chip starts unchecked.
      expect(screen.getByTestId('invite-chip-a').props.accessibilityState.checked).toBe(false);
    });

    it('shows the empty-state copy when the user has no accepted friends', () => {
      render(<EventSheet {...baseProps} friends={[]} />);
      expect(screen.getByText(/No friends to invite yet/i)).toBeOnTheScreen();
    });

    it('does NOT render the picker in edit mode (defer to event-detail in H5)', () => {
      render(<EventSheet {...baseProps} editing={existingEvent} friends={[alice]} />);
      fireEvent.press(screen.getByTestId('event-sheet-edit'));
      expect(screen.queryByTestId('invite-picker')).toBeNull();
    });

    it('tapping a chip toggles its selected state', () => {
      render(<EventSheet {...baseProps} friends={[alice]} />);
      const chip = screen.getByTestId('invite-chip-a');
      expect(chip.props.accessibilityState.checked).toBe(false);
      fireEvent.press(chip);
      expect(screen.getByTestId('invite-chip-a').props.accessibilityState.checked).toBe(true);
      // Toggle off again.
      fireEvent.press(screen.getByTestId('invite-chip-a'));
      expect(screen.getByTestId('invite-chip-a').props.accessibilityState.checked).toBe(false);
    });

    it('on Save: createEvent → inviteFriends with the selected ids', async () => {
      const mockedInvite = jest.requireMock('../lib/event-actions').inviteFriends as jest.Mock;
      mockedCreate.mockResolvedValue({ id: 'ev-new', error: null });
      mockedInvite.mockResolvedValue({ error: null });

      render(<EventSheet {...baseProps} friends={[alice, bob]} />);
      fireEvent.press(screen.getByTestId('invite-chip-a'));
      fireEvent.press(screen.getByTestId('invite-chip-b'));
      fireEvent.press(screen.getByLabelText('Save'));

      await waitFor(() => expect(mockedCreate).toHaveBeenCalled());
      await waitFor(() => expect(mockedInvite).toHaveBeenCalled());
      // inviteFriends gets called with the new event id + the
      // selected friend ids in insertion order.
      const inviteCall = mockedInvite.mock.calls[0][0];
      expect(inviteCall.eventId).toBe('ev-new');
      expect(inviteCall.inviteeIds.sort()).toEqual(['a', 'b']);
    });

    it('skips the inviteFriends call when no one is selected', async () => {
      const mockedInvite = jest.requireMock('../lib/event-actions').inviteFriends as jest.Mock;
      mockedInvite.mockClear();
      mockedCreate.mockResolvedValue({ id: 'ev-new', error: null });

      render(<EventSheet {...baseProps} friends={[alice]} />);
      fireEvent.press(screen.getByLabelText('Save'));

      await waitFor(() => expect(mockedCreate).toHaveBeenCalled());
      // No invites picked → no inviteFriends call.
      expect(mockedInvite).not.toHaveBeenCalled();
    });

    it('toasts on invite failure but still closes the sheet (event was created)', async () => {
      const mockedInvite = jest.requireMock('../lib/event-actions').inviteFriends as jest.Mock;
      mockedCreate.mockResolvedValue({ id: 'ev-new', error: null });
      mockedInvite.mockResolvedValue({ error: "Couldn't send invites. Please try again." });
      const onClose = jest.fn();
      const onSaved = jest.fn();

      render(<EventSheet {...baseProps} friends={[alice]} onClose={onClose} onSaved={onSaved} />);
      fireEvent.press(screen.getByTestId('invite-chip-a'));
      fireEvent.press(screen.getByLabelText('Save'));

      await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/send invites/i)));
      // Event creation succeeded — sheet still closes + parent
      // refetches so the new event shows up.
      await waitFor(() => expect(onSaved).toHaveBeenCalled());
      await waitFor(() => expect(onClose).toHaveBeenCalled());
    });
  });

  describe('attendees in view mode', () => {
    const bob = { id: 'b', display_name: 'Bob', color: '#4ECDC4' };
    const cara = { id: 'c', display_name: 'Cara', color: '#FFE66D' };

    it('renders the Invited row with names + non-pending status suffixes', () => {
      const editingWithInvites: EventItem = {
        ...existingEvent,
        attendees: [
          { invitee: bob, status: 'accepted' },
          { invitee: cara, status: 'pending' },
        ],
      };
      render(<EventSheet {...baseProps} editing={editingWithInvites} />);
      const text = screen.getByTestId('view-attendees').props.children as string;
      // Accepted → suffix shown; pending → bare name (default state).
      expect(text).toMatch(/Bob \(accepted\)/);
      expect(text).toMatch(/Cara/);
      expect(text).not.toMatch(/Cara \(/); // pending = no suffix
    });

    it('omits the Invited row when attendees is empty or missing', () => {
      const { rerender } = render(
        <EventSheet {...baseProps} editing={{ ...existingEvent, attendees: [] }} />,
      );
      expect(screen.queryByTestId('view-attendees')).toBeNull();
      // attendees missing entirely.
      const { attendees: _drop, ...withoutAttendees } = existingEvent;
      rerender(<EventSheet {...baseProps} editing={withoutAttendees} />);
      expect(screen.queryByTestId('view-attendees')).toBeNull();
    });
  });
});
