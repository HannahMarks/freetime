import { render, screen } from '@testing-library/react-native';
import { DayTimeline } from '../components/DayTimeline';
import { CalendarItem } from '../lib/calendar-helpers';

const alice = { id: 'a', display_name: 'Alice', color: '#FF6B6B' };
const bob = { id: 'b', display_name: 'Bob', color: '#4ECDC4' };

describe('DayTimeline', () => {
  it('renders all 24 hour labels', () => {
    render(<DayTimeline items={[]} />);
    expect(screen.getByText('12 AM')).toBeOnTheScreen();
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
      },
    ];
    render(<DayTimeline items={items} />);
    expect(screen.getByTestId('day-block-bb1')).toBeOnTheScreen();
    expect(screen.getByText(/Alice · Yoga/)).toBeOnTheScreen();
  });

  it('positions a busy_block at the correct top + height for its start/end times', () => {
    // 3pm-5pm = 2hrs; HOUR_HEIGHT=48 → top=720, height=96.
    const items: CalendarItem[] = [
      {
        kind: 'busy_block',
        id: 'bb1',
        user: alice,
        startsAt: new Date(2026, 4, 13, 15, 0),
        endsAt: new Date(2026, 4, 13, 17, 0),
        title: null,
      },
    ];
    render(<DayTimeline items={items} />);
    const block = screen.getByTestId('day-block-bb1');
    expect(block).toHaveStyle({ top: 720, height: 96 });
  });

  it('handles half-hour offsets', () => {
    // 3:30pm-4:45pm = 1.25hrs; top = 15.5*48 = 744, height = 1.25*48 = 60.
    const items: CalendarItem[] = [
      {
        kind: 'busy_block',
        id: 'bb1',
        user: alice,
        startsAt: new Date(2026, 4, 13, 15, 30),
        endsAt: new Date(2026, 4, 13, 16, 45),
        title: null,
      },
    ];
    render(<DayTimeline items={items} />);
    expect(screen.getByTestId('day-block-bb1')).toHaveStyle({ top: 744, height: 60 });
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
      },
    ];
    render(<DayTimeline items={items} />);
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
      },
      {
        kind: 'busy_block',
        id: 'bb2',
        user: bob,
        startsAt: new Date(2026, 4, 13, 14, 0),
        endsAt: new Date(2026, 4, 13, 15, 0),
        title: 'Coffee',
      },
    ];
    render(<DayTimeline items={items} />);
    expect(screen.getByTestId('day-block-bb1')).toBeOnTheScreen();
    expect(screen.getByTestId('day-block-bb2')).toBeOnTheScreen();
    expect(screen.getByText(/Alice · Standup/)).toBeOnTheScreen();
    expect(screen.getByText(/Bob · Coffee/)).toBeOnTheScreen();
  });

  it('renders unavailable_days as an above-timeline banner, not as time blocks', () => {
    const items: CalendarItem[] = [
      { kind: 'unavailable_day', user: bob, date: '2026-05-13', title: 'Wedding' },
    ];
    render(<DayTimeline items={items} />);
    expect(screen.getByTestId('day-banner-b')).toBeOnTheScreen();
    expect(screen.getByText(/Bob · Wedding/)).toBeOnTheScreen();
  });

  it('uses default banner copy when an unavailable_day has no title', () => {
    const items: CalendarItem[] = [
      { kind: 'unavailable_day', user: alice, date: '2026-05-13', title: null },
    ];
    render(<DayTimeline items={items} />);
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
      },
    ];
    render(<DayTimeline items={items} />);
    expect(screen.queryByTestId('day-timeline-banner')).toBeNull();
  });

  it('clamps blocks that cross midnight to end-of-day rather than wrapping', () => {
    // 11pm to 1am-next-day → endHour <= startHour, should clamp to 24.
    const items: CalendarItem[] = [
      {
        kind: 'busy_block',
        id: 'bb1',
        user: alice,
        startsAt: new Date(2026, 4, 13, 23, 0),
        endsAt: new Date(2026, 4, 14, 1, 0),
        title: null,
      },
    ];
    render(<DayTimeline items={items} />);
    // top = 23*48 = 1104, height = (24-23)*48 = 48
    expect(screen.getByTestId('day-block-bb1')).toHaveStyle({ top: 1104, height: 48 });
  });
});
