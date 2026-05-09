import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AddItemSheet } from '../components/AddItemSheet';
import { createBusyBlock, createUnavailableDay } from '../lib/availability-actions';
import { toast } from '../lib/toast';

jest.mock('../lib/availability-actions', () => ({
  createBusyBlock: jest.fn(),
  createUnavailableDay: jest.fn(),
}));

jest.mock('../lib/toast', () => ({
  toast: { error: jest.fn(), success: jest.fn() },
}));

const mockedCreateBusy = createBusyBlock as jest.MockedFunction<typeof createBusyBlock>;
const mockedCreateUnavail = createUnavailableDay as jest.MockedFunction<typeof createUnavailableDay>;

beforeEach(() => {
  jest.clearAllMocks();
});

const baseProps = {
  visible: true,
  selectedDate: '2026-05-13',
  onClose: jest.fn(),
  onSaved: jest.fn(),
};

describe('AddItemSheet', () => {
  it("doesn't render anything when visible is false", () => {
    render(<AddItemSheet {...baseProps} visible={false} />);
    expect(screen.queryByTestId('add-item-sheet')).toBeNull();
  });

  it('defaults to busy-time mode and shows time inputs', () => {
    render(<AddItemSheet {...baseProps} />);
    expect(screen.getByPlaceholderText('Lunch with Sarah')).toBeOnTheScreen();
    expect(screen.getByPlaceholderText('9:00 AM')).toBeOnTheScreen();
    expect(screen.getByPlaceholderText('10:00 AM')).toBeOnTheScreen();
  });

  it('hides time inputs when switched to unavailable-day mode', () => {
    render(<AddItemSheet {...baseProps} />);
    fireEvent.press(screen.getByTestId('kind-unavailable'));
    expect(screen.queryByPlaceholderText('9:00 AM')).toBeNull();
    expect(screen.getByPlaceholderText('Family wedding')).toBeOnTheScreen();
  });

  it('saves a busy_block with parsed times and the title', async () => {
    mockedCreateBusy.mockResolvedValue({ error: null });
    const onClose = jest.fn();
    const onSaved = jest.fn();
    render(
      <AddItemSheet {...baseProps} onClose={onClose} onSaved={onSaved} />,
    );
    fireEvent.changeText(screen.getByPlaceholderText('Lunch with Sarah'), 'Lunch');
    fireEvent.changeText(screen.getByPlaceholderText('9:00 AM'), '12:00 PM');
    fireEvent.changeText(screen.getByPlaceholderText('10:00 AM'), '1:00 PM');
    fireEvent.press(screen.getByLabelText('Save'));

    await waitFor(() => expect(mockedCreateBusy).toHaveBeenCalledTimes(1));
    const call = mockedCreateBusy.mock.calls[0][0];
    expect(call.title).toBe('Lunch');
    expect(call.startsAt.getHours()).toBe(12);
    expect(call.startsAt.getMinutes()).toBe(0);
    expect(call.endsAt.getHours()).toBe(13);
    expect(call.endsAt.getMinutes()).toBe(0);
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('saves with title=null when title is blank', async () => {
    mockedCreateBusy.mockResolvedValue({ error: null });
    render(<AddItemSheet {...baseProps} />);
    fireEvent.changeText(screen.getByPlaceholderText('9:00 AM'), '9');
    fireEvent.changeText(screen.getByPlaceholderText('10:00 AM'), '10');
    fireEvent.press(screen.getByLabelText('Save'));
    await waitFor(() => expect(mockedCreateBusy).toHaveBeenCalled());
    expect(mockedCreateBusy.mock.calls[0][0].title).toBeNull();
  });

  it('toasts and does not save when times are unparseable', async () => {
    render(<AddItemSheet {...baseProps} />);
    fireEvent.changeText(screen.getByPlaceholderText('9:00 AM'), 'not a time');
    fireEvent.changeText(screen.getByPlaceholderText('10:00 AM'), 'also not');
    fireEvent.press(screen.getByLabelText('Save'));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/9:00 AM/)));
    expect(mockedCreateBusy).not.toHaveBeenCalled();
  });

  it('toasts and does not save when end is not after start', async () => {
    render(<AddItemSheet {...baseProps} />);
    fireEvent.changeText(screen.getByPlaceholderText('9:00 AM'), '5:00 PM');
    fireEvent.changeText(screen.getByPlaceholderText('10:00 AM'), '5:00 PM');
    fireEvent.press(screen.getByLabelText('Save'));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/end time must be after/i)));
    expect(mockedCreateBusy).not.toHaveBeenCalled();
  });

  it('toasts and stays open when the action returns an error', async () => {
    mockedCreateBusy.mockResolvedValue({ error: 'Server is grumpy' });
    const onSaved = jest.fn();
    const onClose = jest.fn();
    render(<AddItemSheet {...baseProps} onSaved={onSaved} onClose={onClose} />);
    fireEvent.changeText(screen.getByPlaceholderText('9:00 AM'), '9');
    fireEvent.changeText(screen.getByPlaceholderText('10:00 AM'), '10');
    fireEvent.press(screen.getByLabelText('Save'));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Server is grumpy'));
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
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
