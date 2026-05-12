import { fireEvent, render, screen } from '@testing-library/react-native';
import { DayTimeline } from '../components/DayTimeline';
import { CalendarItem } from '../lib/calendar-helpers';
import type { EventItem } from '../lib/event-helpers';

const alice = { id: 'a', display_name: 'Alice', color: '#FF6B6B' };
const bob = { id: 'b', display_name: 'Bob', color: '#4ECDC4' };

const DAY = '2026-05-13';

describe('DayTimeline', () => {
  it('renders 23 hour labels (skips the 12 AM at the very top)', () => {
    render(<DayTimeline date={DAY} items={[]} />);
    // 12 AM is intentionally suppressed — see comment in DayTimeline.
    expect(screen.queryByText('12 AM')).toBeNull();
    expect(screen.getByText('1 AM')).toBeOnTheScreen();
    expect(screen.getByText('11 AM')).toBeOnTheScreen();
    expect(screen.getByText('12 PM')).toBeOnTheScreen();
    expect(screen.getByText('3 PM')).toBeOnTheScreen();
    expect(screen.getByText('11 PM')).toBeOnTheScreen();
  });

  it('renders a busy_block with the user name + title and time range', () => {
    const items: CalendarItem[] = [
      {
        kind: 'busy_block',
        id: 'bb1',
        user: alice,
        startsAt: new Date(2026, 4, 13, 15, 0),
        endsAt: new Date(2026, 4, 13, 17, 0),
        title: 'Yoga',
        notes: null,

        location: null,
      },
    ];
    render(<DayTimeline date={DAY} items={items} />);
    expect(screen.getByTestId('day-block-bb1')).toBeOnTheScreen();
    expect(screen.getByText(/Alice · Yoga/)).toBeOnTheScreen();
  });

  it('positions a busy_block at the correct top + height for its start/end times', () => {
    // 3pm-5pm = 2hrs; HOUR_HEIGHT=32 → top=15*32=480, height=2*32=64.
    const items: CalendarItem[] = [
      {
        kind: 'busy_block',
        id: 'bb1',
        user: alice,
        startsAt: new Date(2026, 4, 13, 15, 0),
        endsAt: new Date(2026, 4, 13, 17, 0),
        title: null,
        notes: null,

        location: null,
      },
    ];
    render(<DayTimeline date={DAY} items={items} />);
    const block = screen.getByTestId('day-block-bb1');
    expect(block).toHaveStyle({ top: 480, height: 64 });
  });

  it('handles half-hour offsets', () => {
    // 3:30pm-4:45pm = 1.25hrs; top = 15.5*32 = 496, height = 1.25*32 = 40.
    const items: CalendarItem[] = [
      {
        kind: 'busy_block',
        id: 'bb1',
        user: alice,
        startsAt: new Date(2026, 4, 13, 15, 30),
        endsAt: new Date(2026, 4, 13, 16, 45),
        title: null,
        notes: null,

        location: null,
      },
    ];
    render(<DayTimeline date={DAY} items={items} />);
    expect(screen.getByTestId('day-block-bb1')).toHaveStyle({ top: 496, height: 40 });
  });

  it('uses the user color for the block (border-left + translucent fill)', () => {
    const items: CalendarItem[] = [
      {
        kind: 'busy_block',
        id: 'bb1',
        user: alice,
        startsAt: new Date(2026, 4, 13, 15, 0),
        endsAt: new Date(2026, 4, 13, 17, 0),
        title: null,
        notes: null,

        location: null,
      },
    ];
    render(<DayTimeline date={DAY} items={items} />);
    const block = screen.getByTestId('day-block-bb1');
    // 0.35 alpha = 0x59
    expect(block).toHaveStyle({ borderLeftColor: '#FF6B6B', backgroundColor: '#FF6B6B59' });
  });

  it('renders multiple busy_blocks at different times', () => {
    const items: CalendarItem[] = [
      {
        kind: 'busy_block',
        id: 'bb1',
        user: alice,
        startsAt: new Date(2026, 4, 13, 9, 0),
        endsAt: new Date(2026, 4, 13, 10, 0),
        title: 'Standup',
        notes: null,

        location: null,
      },
      {
        kind: 'busy_block',
        id: 'bb2',
        user: bob,
        startsAt: new Date(2026, 4, 13, 14, 0),
        endsAt: new Date(2026, 4, 13, 15, 0),
        title: 'Coffee',
        notes: null,

        location: null,
      },
    ];
    render(<DayTimeline date={DAY} items={items} />);
    expect(screen.getByTestId('day-block-bb1')).toBeOnTheScreen();
    expect(screen.getByTestId('day-block-bb2')).toBeOnTheScreen();
    expect(screen.getByText(/Alice · Standup/)).toBeOnTheScreen();
    expect(screen.getByText(/Bob · Coffee/)).toBeOnTheScreen();
  });

  it('renders unavailable_days as an above-timeline banner, not as time blocks', () => {
    const items: CalendarItem[] = [
      { kind: 'unavailable_day', user: bob, date: '2026-05-13', title: 'Wedding' , notes: null },
    ];
    render(<DayTimeline date={DAY} items={items} />);
    expect(screen.getByTestId('day-banner-b')).toBeOnTheScreen();
    expect(screen.getByText(/Bob · Wedding/)).toBeOnTheScreen();
  });

  it('uses default banner copy when an unavailable_day has no title', () => {
    const items: CalendarItem[] = [
      { kind: 'unavailable_day', user: alice, date: '2026-05-13', title: null , notes: null },
    ];
    render(<DayTimeline date={DAY} items={items} />);
    expect(screen.getByText(/Alice · Unavailable all day/)).toBeOnTheScreen();
  });

  it('omits the banner area entirely when no unavailable_day items are present', () => {
    const items: CalendarItem[] = [
      {
        kind: 'busy_block',
        id: 'bb1',
        user: alice,
        startsAt: new Date(2026, 4, 13, 9, 0),
        endsAt: new Date(2026, 4, 13, 10, 0),
        title: null,
        notes: null,

        location: null,
      },
    ];
    render(<DayTimeline date={DAY} items={items} />);
    expect(screen.queryByTestId('day-timeline-banner')).toBeNull();
  });

  describe('multi-day blocks', () => {
    const trip: CalendarItem = {
      kind: 'busy_block',
      id: 'trip',
      user: alice,
      // Wed May 13 18:00 → Fri May 15 09:00
      startsAt: new Date(2026, 4, 13, 18, 0),
      endsAt: new Date(2026, 4, 15, 9, 0),
      title: 'Hiking',
      notes: null,
      location: null,
    };

    it('clips a multi-day block to 18:00 → end-of-day on the start day', () => {
      // visibleStart=18:00, visibleEnd=24:00 → top=18*32=576, height=6*32=192.
      render(<DayTimeline date="2026-05-13" items={[trip]} />);
      expect(screen.getByTestId('day-block-trip')).toHaveStyle({ top: 576, height: 192 });
    });

    it('renders a fully-spanned middle day as 0:00 → 24:00', () => {
      // visibleStart=00:00, visibleEnd=24:00 → top=0, height=24*32=768.
      render(<DayTimeline date="2026-05-14" items={[trip]} />);
      expect(screen.getByTestId('day-block-trip')).toHaveStyle({ top: 0, height: 768 });
    });

    it('clips to 0:00 → 09:00 on the end day', () => {
      // visibleStart=00:00, visibleEnd=09:00 → top=0, height=9*32=288.
      render(<DayTimeline date="2026-05-15" items={[trip]} />);
      expect(screen.getByTestId('day-block-trip')).toHaveStyle({ top: 0, height: 288 });
    });

    it('does not render the block on a date outside its range', () => {
      render(<DayTimeline date="2026-05-12" items={[trip]} />);
      expect(screen.queryByTestId('day-block-trip')).toBeNull();
    });

    it('does not render the block on the day after a midnight-exact end', () => {
      const latenight: CalendarItem = {
        kind: 'busy_block',
        id: 'late',
        user: alice,
        startsAt: new Date(2026, 4, 13, 22, 0),
        endsAt: new Date(2026, 4, 14, 0, 0),
        title: null,

        notes: null,

        location: null,
      };
      render(<DayTimeline date="2026-05-14" items={[latenight]} />);
      expect(screen.queryByTestId('day-block-late')).toBeNull();
    });

    it('renders the early portion of an overnight block on the start day', () => {
      // 11pm to 1am-next-day, displayed on start day → 23:00 → 24:00.
      // top = 23*32 = 736, height = 1*32 = 32.
      const overnight: CalendarItem = {
        kind: 'busy_block',
        id: 'on1',
        user: alice,
        startsAt: new Date(2026, 4, 13, 23, 0),
        endsAt: new Date(2026, 4, 14, 1, 0),
        title: null,

        notes: null,

        location: null,
      };
      render(<DayTimeline date="2026-05-13" items={[overnight]} />);
      expect(screen.getByTestId('day-block-on1')).toHaveStyle({ top: 736, height: 32 });
    });

    it('renders the tail portion of an overnight block on the end day', () => {
      // Same overnight block, displayed on May 14 → 0:00 → 1:00.
      // top = 0, height = 1*32 = 32.
      const overnight: CalendarItem = {
        kind: 'busy_block',
        id: 'on1',
        user: alice,
        startsAt: new Date(2026, 4, 13, 23, 0),
        endsAt: new Date(2026, 4, 14, 1, 0),
        title: null,

        notes: null,

        location: null,
      };
      render(<DayTimeline date="2026-05-14" items={[overnight]} />);
      expect(screen.getByTestId('day-block-on1')).toHaveStyle({ top: 0, height: 32 });
    });
  });

  describe('events overlay (H5c)', () => {
    /** Pre-darkened event color — DayTimeline doesn't compute the
     * darken itself; calendar.tsx passes the same value it uses for
     * the month-grid dot, so the timeline block and the dot match. */
    const EVENT_COLOR = '#6c1b78'; // ≈ darken('#9C27B0', 0.35)

    function eventAt(start: Date, end: Date, title = 'Birthday'): EventItem {
      return {
        kind: 'event',
        id: `ev-${start.getTime()}`,
        owner: alice,
        startsAt: start,
        endsAt: end,
        title,
        notes: null,
        location: null,
      };
    }

    it('renders an event as a block at its time range', () => {
      const event = eventAt(
        new Date(2026, 4, 13, 18, 0),
        new Date(2026, 4, 13, 21, 0),
      );
      render(
        <DayTimeline
          date={DAY}
          items={[]}
          events={[event]}
          eventColor={EVENT_COLOR}
        />,
      );
      const block = screen.getByTestId(`day-event-${event.id}`);
      // 6pm = hour 18, height 3 hrs * 32 = 96, top = 18*32 = 576
      expect(block).toHaveStyle({ top: 576, height: 96 });
    });

    it('paints the event block in the supplied (darkened) color', () => {
      const event = eventAt(
        new Date(2026, 4, 13, 18, 0),
        new Date(2026, 4, 13, 21, 0),
      );
      render(
        <DayTimeline
          date={DAY}
          items={[]}
          events={[event]}
          eventColor={EVENT_COLOR}
        />,
      );
      const block = screen.getByTestId(`day-event-${event.id}`);
      // Border + translucent fill in the event color so the FAB
      // outline + month dot + timeline block all share one hue.
      expect(block).toHaveStyle({ borderLeftColor: EVENT_COLOR });
    });

    it('shows the host name and title in the event block', () => {
      const event = eventAt(
        new Date(2026, 4, 13, 18, 0),
        new Date(2026, 4, 13, 21, 0),
        'Birthday',
      );
      render(
        <DayTimeline
          date={DAY}
          items={[]}
          events={[event]}
          eventColor={EVENT_COLOR}
        />,
      );
      // Format mirrors busy_block label: "Owner · Title".
      expect(screen.getByText(/Alice · Birthday/)).toBeOnTheScreen();
    });

    it('falls back to "Untitled event" when the event has no title', () => {
      const event = eventAt(
        new Date(2026, 4, 13, 12, 0),
        new Date(2026, 4, 13, 13, 0),
      );
      event.title = null;
      render(
        <DayTimeline
          date={DAY}
          items={[]}
          events={[event]}
          eventColor={EVENT_COLOR}
        />,
      );
      expect(screen.getByText(/Alice · Untitled event/)).toBeOnTheScreen();
    });

    it('fires onEventPress when an event block is tapped', () => {
      const onEventPress = jest.fn();
      const event = eventAt(
        new Date(2026, 4, 13, 18, 0),
        new Date(2026, 4, 13, 21, 0),
      );
      render(
        <DayTimeline
          date={DAY}
          items={[]}
          events={[event]}
          eventColor={EVENT_COLOR}
          onEventPress={onEventPress}
        />,
      );
      fireEvent.press(screen.getByTestId(`day-event-${event.id}`));
      expect(onEventPress).toHaveBeenCalledTimes(1);
      expect(onEventPress).toHaveBeenCalledWith(event);
    });

    it("does not render an event whose interval doesn't intersect the day", () => {
      // Event is on May 14 entirely; timeline rendering May 13 should
      // ignore it.
      const event = eventAt(
        new Date(2026, 4, 14, 18, 0),
        new Date(2026, 4, 14, 21, 0),
      );
      render(
        <DayTimeline
          date={DAY}
          items={[]}
          events={[event]}
          eventColor={EVENT_COLOR}
        />,
      );
      expect(screen.queryByTestId(`day-event-${event.id}`)).toBeNull();
    });

    it('clips a multi-day event to the visible day window', () => {
      // Starts May 12 at 22:00, ends May 13 at 10:00 — on May 13 it
      // should render from 0:00 to 10:00 (top=0, height=10*32=320).
      const event = eventAt(
        new Date(2026, 4, 12, 22, 0),
        new Date(2026, 4, 13, 10, 0),
      );
      render(
        <DayTimeline
          date={DAY}
          items={[]}
          events={[event]}
          eventColor={EVENT_COLOR}
        />,
      );
      const block = screen.getByTestId(`day-event-${event.id}`);
      expect(block).toHaveStyle({ top: 0, height: 320 });
    });

    it('renders multiple events on the same day', () => {
      const morning = eventAt(
        new Date(2026, 4, 13, 10, 0),
        new Date(2026, 4, 13, 11, 0),
        'Brunch',
      );
      const evening = eventAt(
        new Date(2026, 4, 13, 19, 0),
        new Date(2026, 4, 13, 22, 0),
        'Concert',
      );
      render(
        <DayTimeline
          date={DAY}
          items={[]}
          events={[morning, evening]}
          eventColor={EVENT_COLOR}
        />,
      );
      expect(screen.getByText(/Alice · Brunch/)).toBeOnTheScreen();
      expect(screen.getByText(/Alice · Concert/)).toBeOnTheScreen();
    });
  });
});
