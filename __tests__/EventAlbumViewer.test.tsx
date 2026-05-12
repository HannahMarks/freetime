import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { EventAlbumViewer } from '../components/EventAlbumViewer';
import { deleteEventMedia, signEventMediaUrls } from '../lib/event-media-actions';
import type { EventMediaItem } from '../lib/event-media-actions';

jest.mock('../lib/event-media-actions', () => ({
  signEventMediaUrls: jest.fn(),
  deleteEventMedia: jest.fn(),
}));

jest.mock('../lib/toast', () => ({
  toast: { error: jest.fn(), success: jest.fn() },
}));

const mockedSign = signEventMediaUrls as jest.MockedFunction<typeof signEventMediaUrls>;
const mockedDelete = deleteEventMedia as jest.MockedFunction<typeof deleteEventMedia>;

const alice = { id: 'alice', display_name: 'Alice', color: '#FF6B6B' };
const bob = { id: 'bob', display_name: 'Bob', color: '#4ECDC4' };

function mediaItem(over: Partial<EventMediaItem> = {}): EventMediaItem {
  return {
    id: over.id ?? 'm1',
    eventId: 'ev1',
    uploader: alice,
    storagePath: 'ev1/alice/a.jpg',
    mediaKind: 'photo',
    durationSeconds: null,
    createdAt: new Date('2026-05-20T10:00:00.000Z'),
    ...over,
  };
}

const baseProps = {
  visible: true,
  items: [mediaItem()],
  initialIndex: 0,
  currentUserId: 'alice',
  isHost: false,
  onClose: jest.fn(),
  onDeleted: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  mockedSign.mockResolvedValue({
    data: new Map([['ev1/alice/a.jpg', 'https://signed/a']]),
    error: null,
  });
  mockedDelete.mockResolvedValue({ error: null });
});

describe('EventAlbumViewer', () => {
  it("doesn't render anything when visible=false", () => {
    render(<EventAlbumViewer {...baseProps} visible={false} />);
    expect(screen.queryByTestId('album-viewer')).toBeNull();
  });

  it('opens on the requested item, signs URLs, and renders the photo', async () => {
    render(<EventAlbumViewer {...baseProps} />);
    expect(screen.getByTestId('album-viewer')).toBeOnTheScreen();
    await waitFor(() =>
      expect(mockedSign).toHaveBeenCalledWith({ paths: ['ev1/alice/a.jpg'] }),
    );
    await waitFor(() => {
      const img = screen.getByTestId('album-photo-m1');
      expect(img.props.source.uri).toBe('https://signed/a');
    });
  });

  it('shows "x of N" position in the header', async () => {
    const items = [
      mediaItem({ id: 'm1', storagePath: 'p/a.jpg' }),
      mediaItem({ id: 'm2', storagePath: 'p/b.jpg' }),
      mediaItem({ id: 'm3', storagePath: 'p/c.jpg' }),
    ];
    mockedSign.mockResolvedValue({
      data: new Map([
        ['p/a.jpg', 'https://signed/a'],
        ['p/b.jpg', 'https://signed/b'],
        ['p/c.jpg', 'https://signed/c'],
      ]),
      error: null,
    });
    render(<EventAlbumViewer {...baseProps} items={items} initialIndex={1} />);
    await waitFor(() =>
      expect(screen.getByTestId('album-position').props.children).toBe('2 of 3'),
    );
  });

  it('Next / Prev buttons step through the album', async () => {
    const items = [
      mediaItem({ id: 'm1', storagePath: 'p/a.jpg' }),
      mediaItem({ id: 'm2', storagePath: 'p/b.jpg' }),
    ];
    mockedSign.mockResolvedValue({
      data: new Map([
        ['p/a.jpg', 'https://signed/a'],
        ['p/b.jpg', 'https://signed/b'],
      ]),
      error: null,
    });
    render(<EventAlbumViewer {...baseProps} items={items} initialIndex={0} />);
    await waitFor(() =>
      expect(screen.getByTestId('album-position').props.children).toBe('1 of 2'),
    );
    fireEvent.press(screen.getByTestId('album-next'));
    expect(screen.getByTestId('album-position').props.children).toBe('2 of 2');
    fireEvent.press(screen.getByTestId('album-prev'));
    expect(screen.getByTestId('album-position').props.children).toBe('1 of 2');
  });

  it('Prev at the first item is disabled (no wrap-around)', async () => {
    render(<EventAlbumViewer {...baseProps} />);
    await waitFor(() => screen.getByTestId('album-viewer'));
    expect(screen.getByTestId('album-prev').props.accessibilityState?.disabled).toBe(true);
  });

  it('Next at the last item is disabled (no wrap-around)', async () => {
    const items = [
      mediaItem({ id: 'm1', storagePath: 'p/a.jpg' }),
      mediaItem({ id: 'm2', storagePath: 'p/b.jpg' }),
    ];
    mockedSign.mockResolvedValue({
      data: new Map([
        ['p/a.jpg', 'https://signed/a'],
        ['p/b.jpg', 'https://signed/b'],
      ]),
      error: null,
    });
    render(<EventAlbumViewer {...baseProps} items={items} initialIndex={1} />);
    await waitFor(() => screen.getByTestId('album-viewer'));
    expect(screen.getByTestId('album-next').props.accessibilityState?.disabled).toBe(true);
  });

  it('Close button fires onClose', async () => {
    const onClose = jest.fn();
    render(<EventAlbumViewer {...baseProps} onClose={onClose} />);
    await waitFor(() => screen.getByTestId('album-viewer'));
    fireEvent.press(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  describe('delete affordance', () => {
    it('shows the trash icon when the viewer owns the current photo', async () => {
      render(
        <EventAlbumViewer {...baseProps} currentUserId="alice" isHost={false} />,
      );
      await waitFor(() => screen.getByTestId('album-viewer'));
      expect(screen.getByTestId('album-delete')).toBeOnTheScreen();
    });

    it('shows the trash icon when the viewer is the event host (moderation)', async () => {
      render(
        <EventAlbumViewer
          {...baseProps}
          currentUserId="someone-else"
          isHost={true}
        />,
      );
      await waitFor(() => screen.getByTestId('album-viewer'));
      expect(screen.getByTestId('album-delete')).toBeOnTheScreen();
    });

    it('hides the trash icon for a non-owner non-host viewer', async () => {
      render(
        <EventAlbumViewer
          {...baseProps}
          items={[mediaItem({ uploader: bob, storagePath: 'ev1/bob/a.jpg' })]}
          currentUserId="alice"
          isHost={false}
        />,
      );
      await waitFor(() => screen.getByTestId('album-viewer'));
      expect(screen.queryByTestId('album-delete')).toBeNull();
    });

    it('tap trash → Alert → destructive → calls deleteEventMedia + onDeleted', async () => {
      const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, btns) => {
        // Find the destructive button and fire it.
        const destructive = btns?.find((b) => b.style === 'destructive');
        destructive?.onPress?.();
      });
      const onDeleted = jest.fn();
      render(
        <EventAlbumViewer
          {...baseProps}
          currentUserId="alice"
          onDeleted={onDeleted}
        />,
      );
      await waitFor(() => screen.getByTestId('album-viewer'));
      fireEvent.press(screen.getByTestId('album-delete'));
      await waitFor(() =>
        expect(mockedDelete).toHaveBeenCalledWith({
          id: 'm1',
          storagePath: 'ev1/alice/a.jpg',
        }),
      );
      expect(onDeleted).toHaveBeenCalledWith('m1');
      alertSpy.mockRestore();
    });

    it('Alert "Cancel" does NOT call deleteEventMedia', async () => {
      const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, btns) => {
        const cancel = btns?.find((b) => b.style === 'cancel');
        cancel?.onPress?.();
      });
      render(<EventAlbumViewer {...baseProps} currentUserId="alice" />);
      await waitFor(() => screen.getByTestId('album-viewer'));
      fireEvent.press(screen.getByTestId('album-delete'));
      expect(mockedDelete).not.toHaveBeenCalled();
      alertSpy.mockRestore();
    });
  });
});
