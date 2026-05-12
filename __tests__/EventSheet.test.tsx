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
  uninviteFriends: jest.fn(),
  respondToInvite: jest.fn(),
}));

// Phase 3 P2a: EventSheet now imports event-media-actions for the
// Album section. Default both to no-op resolved values; specific
// tests override per-test as needed.
jest.mock('../lib/event-media-actions', () => ({
  listEventMedia: jest.fn().mockResolvedValue({ data: [], error: null }),
  uploadEventPhoto: jest.fn().mockResolvedValue({ error: null }),
}));

// expo-image-picker: stub permission + picker functions; tests
// override per-case (granted vs denied; selected uri vs canceled).
jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
  launchImageLibraryAsync: jest.fn().mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file:///tmp/picked.jpg' }],
  }),
  MediaTypeOptions: { Images: 'Images' },
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

    it('renders the picker in edit mode (H5b) with existing invitees pre-selected', () => {
      const editingWithInvites: EventItem = {
        ...existingEvent,
        attendees: [{ invitee: alice, status: 'pending' }],
      };
      render(<EventSheet {...baseProps} editing={editingWithInvites} friends={[alice]} />);
      fireEvent.press(screen.getByTestId('event-sheet-edit'));
      // Picker is visible in edit mode now.
      expect(screen.getByTestId('invite-picker')).toBeOnTheScreen();
      // Alice was already invited → her chip starts pre-selected.
      expect(screen.getByTestId('invite-chip-a').props.accessibilityState.checked).toBe(true);
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

  describe('edit-mode invite diff (H5b)', () => {
    const alice = { id: 'a', display_name: 'Alice', color: '#FF6B6B' };
    const bob = { id: 'b', display_name: 'Bob', color: '#4ECDC4' };
    const cara = { id: 'c', display_name: 'Cara', color: '#FFE66D' };

    function eventWith(attendees: { invitee: typeof alice; status: 'pending' }[]): EventItem {
      return { ...existingEvent, attendees };
    }

    it('saving with no chip changes does NOT call invite or uninvite (no diff)', async () => {
      const mockedInvite = jest.requireMock('../lib/event-actions').inviteFriends as jest.Mock;
      const mockedUninvite = jest.requireMock('../lib/event-actions').uninviteFriends as jest.Mock;
      mockedInvite.mockClear();
      mockedUninvite.mockClear();
      mockedUpdate.mockResolvedValue({ error: null });

      render(
        <EventSheet
          {...baseProps}
          editing={eventWith([{ invitee: alice, status: 'pending' }])}
          friends={[alice, bob]}
        />,
      );
      fireEvent.press(screen.getByTestId('event-sheet-edit'));
      // Don't touch any chips — Alice stays selected, Bob stays unselected.
      fireEvent.press(screen.getByLabelText('Save'));

      await waitFor(() => expect(mockedUpdate).toHaveBeenCalled());
      // Diff is empty → no invite or uninvite call.
      expect(mockedInvite).not.toHaveBeenCalled();
      expect(mockedUninvite).not.toHaveBeenCalled();
    });

    it('selecting a previously-unselected chip calls inviteFriends with that id only', async () => {
      const mockedInvite = jest.requireMock('../lib/event-actions').inviteFriends as jest.Mock;
      const mockedUninvite = jest.requireMock('../lib/event-actions').uninviteFriends as jest.Mock;
      mockedInvite.mockClear();
      mockedUninvite.mockClear();
      mockedInvite.mockResolvedValue({ error: null });
      mockedUpdate.mockResolvedValue({ error: null });

      render(
        <EventSheet
          {...baseProps}
          editing={eventWith([{ invitee: alice, status: 'pending' }])}
          friends={[alice, bob]}
        />,
      );
      fireEvent.press(screen.getByTestId('event-sheet-edit'));
      // Add Bob.
      fireEvent.press(screen.getByTestId('invite-chip-b'));
      fireEvent.press(screen.getByLabelText('Save'));

      await waitFor(() =>
        expect(mockedInvite).toHaveBeenCalledWith({ eventId: 'ev1', inviteeIds: ['b'] }),
      );
      expect(mockedUninvite).not.toHaveBeenCalled();
    });

    it('deselecting a previously-selected chip calls uninviteFriends with that id only', async () => {
      const mockedInvite = jest.requireMock('../lib/event-actions').inviteFriends as jest.Mock;
      const mockedUninvite = jest.requireMock('../lib/event-actions').uninviteFriends as jest.Mock;
      mockedInvite.mockClear();
      mockedUninvite.mockClear();
      mockedUninvite.mockResolvedValue({ error: null });
      mockedUpdate.mockResolvedValue({ error: null });

      render(
        <EventSheet
          {...baseProps}
          editing={eventWith([
            { invitee: alice, status: 'pending' },
            { invitee: bob, status: 'pending' },
          ])}
          friends={[alice, bob]}
        />,
      );
      fireEvent.press(screen.getByTestId('event-sheet-edit'));
      // Uninvite Alice.
      fireEvent.press(screen.getByTestId('invite-chip-a'));
      fireEvent.press(screen.getByLabelText('Save'));

      await waitFor(() =>
        expect(mockedUninvite).toHaveBeenCalledWith({ eventId: 'ev1', inviteeIds: ['a'] }),
      );
      expect(mockedInvite).not.toHaveBeenCalled();
    });

    it('combining add + remove fires both invite and uninvite in the same save', async () => {
      const mockedInvite = jest.requireMock('../lib/event-actions').inviteFriends as jest.Mock;
      const mockedUninvite = jest.requireMock('../lib/event-actions').uninviteFriends as jest.Mock;
      mockedInvite.mockClear();
      mockedUninvite.mockClear();
      mockedInvite.mockResolvedValue({ error: null });
      mockedUninvite.mockResolvedValue({ error: null });
      mockedUpdate.mockResolvedValue({ error: null });

      render(
        <EventSheet
          {...baseProps}
          editing={eventWith([{ invitee: alice, status: 'pending' }])}
          friends={[alice, bob, cara]}
        />,
      );
      fireEvent.press(screen.getByTestId('event-sheet-edit'));
      fireEvent.press(screen.getByTestId('invite-chip-a')); // remove Alice
      fireEvent.press(screen.getByTestId('invite-chip-c')); // add Cara
      fireEvent.press(screen.getByLabelText('Save'));

      await waitFor(() => expect(mockedInvite).toHaveBeenCalled());
      await waitFor(() => expect(mockedUninvite).toHaveBeenCalled());
      expect(mockedInvite).toHaveBeenCalledWith({ eventId: 'ev1', inviteeIds: ['c'] });
      expect(mockedUninvite).toHaveBeenCalledWith({ eventId: 'ev1', inviteeIds: ['a'] });
    });
  });

  describe('invitee RSVP (H5a)', () => {
    const alice = { id: 'a', display_name: 'Alice', color: '#FF6B6B' };
    const meProfile = { id: 'me-id', display_name: 'Me', color: '#9C27B0' };
    // An event ALICE is hosting and I'M invited to — i.e., I'm an
    // invitee, not the host. The attendees list includes my row so
    // the sheet can pre-fill my current RSVP.
    const eventImInvitedTo: EventItem = {
      kind: 'event',
      id: 'ev-invited',
      owner: alice,
      startsAt: new Date(2026, 4, 20, 18, 0),
      endsAt: new Date(2026, 4, 20, 21, 0),
      title: "Alice's party",
      notes: null,
      location: null,
      attendees: [{ invitee: meProfile, status: 'pending' }],
    };

    it('renders Accept / Decline / Maybe pills when I am NOT the host', () => {
      render(<EventSheet {...baseProps} editing={eventImInvitedTo} currentUserId="me-id" />);
      expect(screen.getByTestId('rsvp-pills')).toBeOnTheScreen();
      expect(screen.getByTestId('rsvp-accepted')).toBeOnTheScreen();
      expect(screen.getByTestId('rsvp-declined')).toBeOnTheScreen();
      expect(screen.getByTestId('rsvp-maybe')).toBeOnTheScreen();
    });

    it('hides pencil + trash icons when I am NOT the host', () => {
      render(<EventSheet {...baseProps} editing={eventImInvitedTo} currentUserId="me-id" />);
      expect(screen.queryByTestId('event-sheet-edit')).toBeNull();
      expect(screen.queryByTestId('event-sheet-delete')).toBeNull();
    });

    it('shows pencil + trash AND hides RSVP pills when I AM the host', () => {
      const myEvent: EventItem = { ...eventImInvitedTo, owner: meProfile };
      render(<EventSheet {...baseProps} editing={myEvent} currentUserId="me-id" />);
      expect(screen.getByTestId('event-sheet-edit')).toBeOnTheScreen();
      expect(screen.getByTestId('event-sheet-delete')).toBeOnTheScreen();
      expect(screen.queryByTestId('rsvp-pills')).toBeNull();
    });

    it('hides RSVP pills when I am NOT the host AND I am NOT in the attendees list (someone else\'s event a friend can see)', () => {
      const friendsEvent: EventItem = { ...eventImInvitedTo, attendees: [] };
      render(<EventSheet {...baseProps} editing={friendsEvent} currentUserId="me-id" />);
      expect(screen.queryByTestId('rsvp-pills')).toBeNull();
    });

    it('marks the currently-selected RSVP pill via accessibilityState', () => {
      const editing: EventItem = {
        ...eventImInvitedTo,
        attendees: [{ invitee: meProfile, status: 'accepted' }],
      };
      render(<EventSheet {...baseProps} editing={editing} currentUserId="me-id" />);
      expect(screen.getByTestId('rsvp-accepted').props.accessibilityState.selected).toBe(true);
      expect(screen.getByTestId('rsvp-declined').props.accessibilityState.selected).toBe(false);
      expect(screen.getByTestId('rsvp-maybe').props.accessibilityState.selected).toBe(false);
    });

    it('tapping a pill calls respondToInvite with the new status and closes the sheet', async () => {
      const mockedRespond = jest.requireMock('../lib/event-actions').respondToInvite as jest.Mock;
      mockedRespond.mockResolvedValue({ error: null });
      const onSaved = jest.fn();
      const onClose = jest.fn();

      render(
        <EventSheet
          {...baseProps}
          editing={eventImInvitedTo}
          currentUserId="me-id"
          onSaved={onSaved}
          onClose={onClose}
        />,
      );
      fireEvent.press(screen.getByTestId('rsvp-accepted'));

      await waitFor(() =>
        expect(mockedRespond).toHaveBeenCalledWith({
          eventId: 'ev-invited',
          status: 'accepted',
        }),
      );
      await waitFor(() => expect(onSaved).toHaveBeenCalled());
      await waitFor(() => expect(onClose).toHaveBeenCalled());
    });

    it('toasts and stays open on respondToInvite error', async () => {
      const mockedRespond = jest.requireMock('../lib/event-actions').respondToInvite as jest.Mock;
      mockedRespond.mockResolvedValue({ error: "Couldn't update your RSVP. Please try again." });
      const onSaved = jest.fn();
      const onClose = jest.fn();

      render(
        <EventSheet
          {...baseProps}
          editing={eventImInvitedTo}
          currentUserId="me-id"
          onSaved={onSaved}
          onClose={onClose}
        />,
      );
      fireEvent.press(screen.getByTestId('rsvp-declined'));

      await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/rsvp/i)));
      expect(onSaved).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
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

  describe('recurrence — monthly + yearly (events)', () => {
    it('hides the recurrence section by default and shows it on toggle', () => {
      render(<EventSheet {...baseProps} />);
      const toggle = screen.getByTestId('event-repeat-toggle');
      expect(toggle).toBeOnTheScreen();
      // Frequency picker is hidden when the Repeat toggle is off — the
      // section collapses to just the toggle row.
      expect(screen.queryByTestId('event-freq-weekly')).toBeNull();
      fireEvent.press(toggle);
      expect(screen.getByTestId('event-freq-weekly')).toBeOnTheScreen();
      expect(screen.getByTestId('event-freq-monthly')).toBeOnTheScreen();
      expect(screen.getByTestId('event-freq-yearly')).toBeOnTheScreen();
    });

    it('defaults to weekly when the Repeat toggle is first turned on', async () => {
      mockedCreate.mockResolvedValue({ id: 'ev-rec', error: null });
      render(<EventSheet {...baseProps} />);
      fireEvent.press(screen.getByTestId('event-repeat-toggle'));
      fireEvent.press(screen.getByLabelText('Save'));
      await waitFor(() => expect(mockedCreate).toHaveBeenCalled());
      const call = mockedCreate.mock.calls[0][0];
      expect(call.recurrenceRule).toEqual({ freq: 'weekly' });
    });

    it('saves a monthly recurrenceRule when the Monthly chip is tapped', async () => {
      mockedCreate.mockResolvedValue({ id: 'ev-rec', error: null });
      render(<EventSheet {...baseProps} />);
      fireEvent.press(screen.getByTestId('event-repeat-toggle'));
      fireEvent.press(screen.getByTestId('event-freq-monthly'));
      fireEvent.press(screen.getByLabelText('Save'));
      await waitFor(() => expect(mockedCreate).toHaveBeenCalled());
      const call = mockedCreate.mock.calls[0][0];
      expect(call.recurrenceRule).toEqual({ freq: 'monthly' });
    });

    it('saves a yearly recurrenceRule when the Yearly chip is tapped', async () => {
      mockedCreate.mockResolvedValue({ id: 'ev-rec', error: null });
      render(<EventSheet {...baseProps} />);
      fireEvent.press(screen.getByTestId('event-repeat-toggle'));
      fireEvent.press(screen.getByTestId('event-freq-yearly'));
      fireEvent.press(screen.getByLabelText('Save'));
      await waitFor(() => expect(mockedCreate).toHaveBeenCalled());
      const call = mockedCreate.mock.calls[0][0];
      expect(call.recurrenceRule).toEqual({ freq: 'yearly' });
    });

    it('saves null recurrenceRule when the Repeat toggle is off', async () => {
      mockedCreate.mockResolvedValue({ id: 'ev-new', error: null });
      render(<EventSheet {...baseProps} />);
      fireEvent.press(screen.getByLabelText('Save'));
      await waitFor(() => expect(mockedCreate).toHaveBeenCalled());
      const call = mockedCreate.mock.calls[0][0];
      expect(call.recurrenceRule).toBeNull();
    });

    it('persists an until clause when the Ends-on-a-date sub-toggle is on', async () => {
      mockedCreate.mockResolvedValue({ id: 'ev-rec', error: null });
      render(<EventSheet {...baseProps} />);
      fireEvent.press(screen.getByTestId('event-repeat-toggle'));
      fireEvent.press(screen.getByTestId('event-freq-monthly'));
      fireEvent.press(screen.getByTestId('event-until-toggle'));
      // The DatePicker is the only one with testID `event-until-picker`.
      // It auto-seeds an until value when the toggle flips on — saving
      // immediately should produce a non-null until.
      fireEvent.press(screen.getByLabelText('Save'));
      await waitFor(() => expect(mockedCreate).toHaveBeenCalled());
      const call = mockedCreate.mock.calls[0][0];
      expect(call.recurrenceRule?.freq).toBe('monthly');
      expect(typeof call.recurrenceRule?.until).toBe('string');
      expect(call.recurrenceRule?.until).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('pre-fills the form with a monthly rule when editing a recurring event', () => {
      const monthlyEvent: EventItem = {
        ...existingEvent,
        recurrenceRule: { freq: 'monthly' },
      };
      render(<EventSheet {...baseProps} editing={monthlyEvent} />);
      // View mode summary row should mention "Monthly".
      const summary = screen.getByTestId('view-recurrence').props.children as string;
      expect(summary).toMatch(/^Monthly/);
      // Entering edit mode → toggle is already on; freq chip "monthly"
      // is selected.
      fireEvent.press(screen.getByLabelText('Edit'));
      const monthlyChip = screen.getByTestId('event-freq-monthly');
      expect(monthlyChip.props.accessibilityState?.checked).toBe(true);
    });

    it('view-mode summary line is hidden for one-off events', () => {
      render(<EventSheet {...baseProps} editing={existingEvent} />);
      expect(screen.queryByTestId('view-recurrence')).toBeNull();
    });

    it('updates an existing event with a new recurrenceRule on save', async () => {
      mockedUpdate.mockResolvedValue({ error: null });
      const oneOff: EventItem = {
        ...existingEvent,
        recurrenceRule: null,
      };
      render(<EventSheet {...baseProps} editing={oneOff} />);
      fireEvent.press(screen.getByLabelText('Edit'));
      fireEvent.press(screen.getByTestId('event-repeat-toggle'));
      fireEvent.press(screen.getByTestId('event-freq-yearly'));
      fireEvent.press(screen.getByLabelText('Save'));
      await waitFor(() => expect(mockedUpdate).toHaveBeenCalled());
      const call = mockedUpdate.mock.calls[0][0];
      expect(call.recurrenceRule).toEqual({ freq: 'yearly' });
    });
  });

  describe('album section (Phase 3 P2a)', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const eventMediaActions = require('../lib/event-media-actions');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ImagePicker = require('expo-image-picker');

    const bob = { id: 'bob', display_name: 'Bob', color: '#4ECDC4' };

    /** Existing event hosted by Me (the "host" path). */
    const hostedEvent: EventItem = {
      ...existingEvent,
      owner: me,
    };

    /** Existing event hosted by Bob; I'm an attendee with status. */
    function eventInvitedAs(status: 'accepted' | 'pending' | 'declined' | 'maybe'): EventItem {
      return {
        ...existingEvent,
        owner: bob,
        attendees: [{ invitee: me, status }],
      };
    }

    beforeEach(() => {
      // Reset album-action mocks per-test so each describe block
      // starts from a clean slate (the default in beforeEach sets
      // empty list / no error; tests override as needed).
      eventMediaActions.listEventMedia.mockResolvedValue({ data: [], error: null });
      eventMediaActions.uploadEventPhoto.mockResolvedValue({ error: null });
      ImagePicker.requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: true });
      ImagePicker.launchImageLibraryAsync.mockResolvedValue({
        canceled: false,
        assets: [{ uri: 'file:///tmp/picked.jpg' }],
      });
    });

    it('shows the Album section to the host (with empty-state copy + Add photo button)', async () => {
      render(<EventSheet {...baseProps} editing={hostedEvent} currentUserId={me.id} />);
      await waitFor(() =>
        expect(eventMediaActions.listEventMedia).toHaveBeenCalledWith({
          eventId: hostedEvent.id,
        }),
      );
      expect(screen.getByTestId('album-section')).toBeOnTheScreen();
      expect(screen.getByTestId('album-count').props.children).toBe('No photos yet');
      expect(screen.getByTestId('album-add-photo')).toBeOnTheScreen();
    });

    it('shows the Album section to an accepted invitee', async () => {
      render(
        <EventSheet
          {...baseProps}
          editing={eventInvitedAs('accepted')}
          currentUserId={me.id}
        />,
      );
      await waitFor(() => expect(eventMediaActions.listEventMedia).toHaveBeenCalled());
      expect(screen.getByTestId('album-section')).toBeOnTheScreen();
      expect(screen.getByTestId('album-add-photo')).toBeOnTheScreen();
    });

    it('hides the Album section from a pending invitee', () => {
      render(
        <EventSheet
          {...baseProps}
          editing={eventInvitedAs('pending')}
          currentUserId={me.id}
        />,
      );
      expect(screen.queryByTestId('album-section')).toBeNull();
      // Also doesn't even fetch the album — pending invitees can't
      // see media anyway, so the request would just return [] and
      // burn a round-trip.
      expect(eventMediaActions.listEventMedia).toHaveBeenCalled(); // it IS fetched; RLS returns empty
    });

    it('hides the Album section from a declined invitee', () => {
      render(
        <EventSheet
          {...baseProps}
          editing={eventInvitedAs('declined')}
          currentUserId={me.id}
        />,
      );
      expect(screen.queryByTestId('album-section')).toBeNull();
    });

    it('hides the Album section in CREATE mode (no event id yet)', () => {
      render(<EventSheet {...baseProps} currentUserId={me.id} />);
      expect(screen.queryByTestId('album-section')).toBeNull();
      expect(eventMediaActions.listEventMedia).not.toHaveBeenCalled();
    });

    it('renders a photo count when there are media items', async () => {
      eventMediaActions.listEventMedia.mockResolvedValue({
        data: [
          {
            id: 'm1',
            eventId: hostedEvent.id,
            uploader: me,
            storagePath: 'x/y/a.jpg',
            mediaKind: 'photo',
            durationSeconds: null,
            createdAt: new Date(),
          },
          {
            id: 'm2',
            eventId: hostedEvent.id,
            uploader: me,
            storagePath: 'x/y/b.jpg',
            mediaKind: 'photo',
            durationSeconds: null,
            createdAt: new Date(),
          },
        ],
        error: null,
      });
      render(<EventSheet {...baseProps} editing={hostedEvent} currentUserId={me.id} />);
      await waitFor(() =>
        expect(screen.getByTestId('album-count').props.children).toBe('2 photos'),
      );
    });

    it('pluralizes 1 photo correctly', async () => {
      eventMediaActions.listEventMedia.mockResolvedValue({
        data: [
          {
            id: 'm1',
            eventId: hostedEvent.id,
            uploader: me,
            storagePath: 'x/y/a.jpg',
            mediaKind: 'photo',
            durationSeconds: null,
            createdAt: new Date(),
          },
        ],
        error: null,
      });
      render(<EventSheet {...baseProps} editing={hostedEvent} currentUserId={me.id} />);
      await waitFor(() =>
        expect(screen.getByTestId('album-count').props.children).toBe('1 photo'),
      );
    });

    it('Add photo: picker → uploadEventPhoto → refetch on success', async () => {
      render(<EventSheet {...baseProps} editing={hostedEvent} currentUserId={me.id} />);
      await waitFor(() => expect(eventMediaActions.listEventMedia).toHaveBeenCalledTimes(1));
      fireEvent.press(screen.getByTestId('album-add-photo'));
      await waitFor(() =>
        expect(eventMediaActions.uploadEventPhoto).toHaveBeenCalledWith({
          eventId: hostedEvent.id,
          uri: 'file:///tmp/picked.jpg',
        }),
      );
      // After a successful upload the album refetches to surface the
      // new photo — calls fired twice now (mount + post-upload).
      await waitFor(() => expect(eventMediaActions.listEventMedia).toHaveBeenCalledTimes(2));
    });

    it('Add photo: bails out when media-library permission is denied', async () => {
      ImagePicker.requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: false });
      render(<EventSheet {...baseProps} editing={hostedEvent} currentUserId={me.id} />);
      await waitFor(() => expect(eventMediaActions.listEventMedia).toHaveBeenCalled());
      fireEvent.press(screen.getByTestId('album-add-photo'));
      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith(
          expect.stringMatching(/photo library access/i),
        ),
      );
      expect(ImagePicker.launchImageLibraryAsync).not.toHaveBeenCalled();
      expect(eventMediaActions.uploadEventPhoto).not.toHaveBeenCalled();
    });

    it('Add photo: no-op when the user cancels the picker', async () => {
      ImagePicker.launchImageLibraryAsync.mockResolvedValue({ canceled: true, assets: [] });
      render(<EventSheet {...baseProps} editing={hostedEvent} currentUserId={me.id} />);
      await waitFor(() => expect(eventMediaActions.listEventMedia).toHaveBeenCalled());
      fireEvent.press(screen.getByTestId('album-add-photo'));
      // Let the promise chain in handleAddPhoto resolve.
      await act(async () => {
        await Promise.resolve();
      });
      expect(eventMediaActions.uploadEventPhoto).not.toHaveBeenCalled();
      expect(toast.error).not.toHaveBeenCalled();
    });

    it('Add photo: toasts the action error and does NOT refetch on failure', async () => {
      eventMediaActions.uploadEventPhoto.mockResolvedValue({
        error: "Couldn't upload the photo. Please try again.",
      });
      render(<EventSheet {...baseProps} editing={hostedEvent} currentUserId={me.id} />);
      await waitFor(() => expect(eventMediaActions.listEventMedia).toHaveBeenCalledTimes(1));
      fireEvent.press(screen.getByTestId('album-add-photo'));
      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith(
          expect.stringMatching(/couldn't upload/i),
        ),
      );
      // Mount-time fetch only — no refetch after the failed upload.
      expect(eventMediaActions.listEventMedia).toHaveBeenCalledTimes(1);
    });
  });
});
