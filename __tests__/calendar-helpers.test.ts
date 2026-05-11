import {
  buildAgenda,
  BusyBlockItem,
  CalendarItem,
  combineDateAndTime,
  computeEventMarkings,
  computeMarkings,
  formatDayLabel,
  formatTimeRange,
  isoDate,
  itemsOnDate,
  monthRange,
  nextNDays,
  parseTime,
  shiftBlockByMinutes,
  shiftDate,
  snapMinutes,
} from '../lib/calendar-helpers';
import type { EventItem } from '../lib/event-helpers';

const alice = { id: 'a', display_name: 'Alice', color: '#FF6B6B' };
const bob = { id: 'b', display_name: 'Bob', color: '#4ECDC4' };

describe('isoDate', () => {
  it('formats a Date as YYYY-MM-DD using local components', () => {
    expect(isoDate(new Date(2026, 4, 13))).toBe('2026-05-13');
    expect(isoDate(new Date(2026, 0, 1))).toBe('2026-01-01');
    expect(isoDate(new Date(2026, 11, 31))).toBe('2026-12-31');
  });

  it('zero-pads single-digit months and days', () => {
    expect(isoDate(new Date(2026, 2, 5))).toBe('2026-03-05');
  });
});

describe('nextNDays', () => {
  it('returns N consecutive dates starting from `from`', () => {
    const out = nextNDays(7, new Date(2026, 4, 13));
    expect(out).toEqual([
      '2026-05-13',
      '2026-05-14',
      '2026-05-15',
      '2026-05-16',
      '2026-05-17',
      '2026-05-18',
      '2026-05-19',
    ]);
  });

  it('rolls over month boundaries', () => {
    const out = nextNDays(3, new Date(2026, 4, 30));
    expect(out).toEqual(['2026-05-30', '2026-05-31', '2026-06-01']);
  });

  it('returns an empty array when N=0', () => {
    expect(nextNDays(0, new Date(2026, 4, 13))).toEqual([]);
  });
});

describe('formatDayLabel', () => {
  const today = new Date(2026, 4, 13); // Wed May 13

  it("returns 'Today' for today's date", () => {
    expect(formatDayLabel('2026-05-13', today)).toBe('Today');
  });

  it("returns 'Tomorrow' for tomorrow's date", () => {
    expect(formatDayLabel('2026-05-14', today)).toBe('Tomorrow');
  });

  it('returns a weekday/month/day label for any other date', () => {
    const label = formatDayLabel('2026-05-20', today);
    // Locale-dependent exact format — assert it contains the day number and weekday hint
    expect(label).toMatch(/20/);
  });
});

describe('formatTimeRange', () => {
  it('joins start and end times with an en-dash', () => {
    const out = formatTimeRange(
      new Date(2026, 4, 13, 12, 0),
      new Date(2026, 4, 13, 13, 30),
    );
    // Locale-dependent — assert the structure (X – Y) and that both numbers appear
    expect(out).toMatch(/^.+–.+$/);
    expect(out).toMatch(/12/);
    expect(out).toMatch(/1:30|13:30/);
  });
});

describe('parseTime', () => {
  it('parses 24-hour HH:MM', () => {
    expect(parseTime('14:30')).toEqual({ hour: 14, minute: 30 });
    expect(parseTime('09:00')).toEqual({ hour: 9, minute: 0 });
    expect(parseTime('00:00')).toEqual({ hour: 0, minute: 0 });
    expect(parseTime('23:59')).toEqual({ hour: 23, minute: 59 });
  });

  it('parses single-digit hour with no leading zero', () => {
    expect(parseTime('9:00')).toEqual({ hour: 9, minute: 0 });
    expect(parseTime('9')).toEqual({ hour: 9, minute: 0 });
  });

  it('parses 12-hour with AM/PM (case-insensitive, optional space)', () => {
    expect(parseTime('9:00 AM')).toEqual({ hour: 9, minute: 0 });
    expect(parseTime('9:00 PM')).toEqual({ hour: 21, minute: 0 });
    expect(parseTime('9:00am')).toEqual({ hour: 9, minute: 0 });
    expect(parseTime('9 PM')).toEqual({ hour: 21, minute: 0 });
    expect(parseTime('12:00 AM')).toEqual({ hour: 0, minute: 0 });
    expect(parseTime('12:00 PM')).toEqual({ hour: 12, minute: 0 });
  });

  it('returns null for malformed inputs', () => {
    expect(parseTime('')).toBeNull();
    expect(parseTime('xyz')).toBeNull();
    expect(parseTime('25:00')).toBeNull();
    expect(parseTime('9:60')).toBeNull();
    expect(parseTime('13 PM')).toBeNull(); // 12-hour can't be 13
    expect(parseTime('0 PM')).toBeNull();
    expect(parseTime('9:00 XX')).toBeNull();
  });
});

describe('combineDateAndTime', () => {
  it('combines a YYYY-MM-DD date and hour/minute into a local-zone Date', () => {
    const out = combineDateAndTime('2026-05-13', { hour: 14, minute: 30 });
    expect(out.getFullYear()).toBe(2026);
    expect(out.getMonth()).toBe(4); // May = 4
    expect(out.getDate()).toBe(13);
    expect(out.getHours()).toBe(14);
    expect(out.getMinutes()).toBe(30);
  });
});

describe('monthRange', () => {
  it('returns the first of the given month and the first of the next month', () => {
    expect(monthRange(2026, 4)).toEqual({
      fromDate: '2026-05-01',
      toDate: '2026-06-01',
    });
  });

  it('rolls year on December → January', () => {
    expect(monthRange(2026, 11)).toEqual({
      fromDate: '2026-12-01',
      toDate: '2027-01-01',
    });
  });
});

describe('computeMarkings', () => {
  it('produces one dot per friend with items on a day', () => {
    const items: CalendarItem[] = [
      {
        kind: 'busy_block',
        id: '1',
        user: alice,
        startsAt: new Date(2026, 4, 13, 9, 0),
        endsAt: new Date(2026, 4, 13, 10, 0),
        title: null,
        notes: null,

        location: null,
      },
      { kind: 'unavailable_day', user: bob, date: '2026-05-13', title: null , notes: null },
    ];
    const out = computeMarkings(items);
    expect(out['2026-05-13'].dots).toEqual([
      { key: 'a', color: '#FF6B6B' },
      { key: 'b', color: '#4ECDC4' },
    ]);
  });

  it('dedupes dots when the same user has multiple items on a day', () => {
    const items: CalendarItem[] = [
      {
        kind: 'busy_block',
        id: '1',
        user: alice,
        startsAt: new Date(2026, 4, 13, 9, 0),
        endsAt: new Date(2026, 4, 13, 10, 0),
        title: null,
        notes: null,

        location: null,
      },
      {
        kind: 'busy_block',
        id: '2',
        user: alice,
        startsAt: new Date(2026, 4, 13, 14, 0),
        endsAt: new Date(2026, 4, 13, 15, 0),
        title: null,
        notes: null,

        location: null,
      },
    ];
    const out = computeMarkings(items);
    expect(out['2026-05-13'].dots).toHaveLength(1);
    expect(out['2026-05-13'].dots[0].key).toBe('a');
  });

  it('returns an empty object when given no items', () => {
    expect(computeMarkings([])).toEqual({});
  });

  it('produces a dot on every day a multi-day busy_block spans', () => {
    const items: CalendarItem[] = [
      {
        kind: 'busy_block',
        id: 'trip',
        user: alice,
        startsAt: new Date(2026, 4, 13, 18, 0),
        endsAt: new Date(2026, 4, 15, 9, 0),
        title: 'Hiking trip',
        notes: null,

        location: null,
      },
    ];
    const out = computeMarkings(items);
    expect(out['2026-05-13'].dots).toEqual([{ key: 'a', color: '#FF6B6B' }]);
    expect(out['2026-05-14'].dots).toEqual([{ key: 'a', color: '#FF6B6B' }]);
    expect(out['2026-05-15'].dots).toEqual([{ key: 'a', color: '#FF6B6B' }]);
  });

  it('does not mark the next day when a block ends exactly at midnight', () => {
    const items: CalendarItem[] = [
      {
        kind: 'busy_block',
        id: 'overnight',
        user: alice,
        startsAt: new Date(2026, 4, 13, 22, 0),
        endsAt: new Date(2026, 4, 14, 0, 0),
        title: null,
        notes: null,

        location: null,
      },
    ];
    const out = computeMarkings(items);
    expect(out['2026-05-13']?.dots).toEqual([{ key: 'a', color: '#FF6B6B' }]);
    expect(out['2026-05-14']).toBeUndefined();
  });
});

describe('computeEventMarkings', () => {
  function eventOn(date: Date, endDate: Date = date): EventItem {
    return {
      kind: 'event',
      id: `e-${date.getTime()}`,
      owner: alice,
      startsAt: date,
      endsAt: endDate,
      title: 'Birthday',
      notes: null,
      location: null,
    };
  }

  it("paints one dot per day in the viewer's darker color", () => {
    const events: EventItem[] = [
      eventOn(new Date(2026, 4, 13, 18, 0), new Date(2026, 4, 13, 21, 0)),
    ];
    // amount=0.5 of #808080 → #404040 (verified in color-helpers.test).
    const out = computeEventMarkings(events, '#808080', 0.5);
    expect(out['2026-05-13'].dots).toEqual([
      { key: 'events', color: '#404040' },
    ]);
  });

  it('dedupes the events dot when multiple events fall on the same day', () => {
    const events: EventItem[] = [
      eventOn(new Date(2026, 4, 13, 9, 0), new Date(2026, 4, 13, 10, 0)),
      eventOn(new Date(2026, 4, 13, 18, 0), new Date(2026, 4, 13, 20, 0)),
    ];
    const out = computeEventMarkings(events, '#808080', 0.5);
    expect(out['2026-05-13'].dots).toHaveLength(1);
  });

  it('spans the dot across every day a multi-day event touches', () => {
    const events: EventItem[] = [
      eventOn(new Date(2026, 4, 13, 18, 0), new Date(2026, 4, 15, 9, 0)),
    ];
    const out = computeEventMarkings(events, '#808080', 0.5);
    expect(out['2026-05-13'].dots).toEqual([{ key: 'events', color: '#404040' }]);
    expect(out['2026-05-14'].dots).toEqual([{ key: 'events', color: '#404040' }]);
    expect(out['2026-05-15'].dots).toEqual([{ key: 'events', color: '#404040' }]);
  });

  it('does NOT mark the next day when an event ends exactly at midnight', () => {
    // Mirrors the busy_block midnight cutoff in computeMarkings, so the
    // two helpers behave consistently on edge-of-day cases.
    const events: EventItem[] = [
      eventOn(new Date(2026, 4, 13, 22, 0), new Date(2026, 4, 14, 0, 0)),
    ];
    const out = computeEventMarkings(events, '#808080', 0.5);
    expect(out['2026-05-13']?.dots).toEqual([{ key: 'events', color: '#404040' }]);
    expect(out['2026-05-14']).toBeUndefined();
  });

  it('returns an empty object when given no events', () => {
    expect(computeEventMarkings([], '#808080', 0.5)).toEqual({});
  });

  it('handles a missing viewer color by falling back gracefully', () => {
    const events: EventItem[] = [eventOn(new Date(2026, 4, 13, 18, 0))];
    // Should NOT crash. Falls back to a non-empty color so dots still
    // render — the screen passes `profile?.color` which can be
    // undefined before auth resolves.
    expect(() => computeEventMarkings(events, undefined, 0.5)).not.toThrow();
  });
});

describe('itemsOnDate', () => {
  it('returns busy_blocks whose start falls on the date', () => {
    const items: CalendarItem[] = [
      {
        kind: 'busy_block',
        id: 'on',
        user: alice,
        startsAt: new Date(2026, 4, 13, 12, 0),
        endsAt: new Date(2026, 4, 13, 13, 0),
        title: null,
        notes: null,

        location: null,
      },
      {
        kind: 'busy_block',
        id: 'off',
        user: alice,
        startsAt: new Date(2026, 4, 14, 12, 0),
        endsAt: new Date(2026, 4, 14, 13, 0),
        title: null,
        notes: null,

        location: null,
      },
    ];
    const out = itemsOnDate(items, '2026-05-13');
    expect(out).toHaveLength(1);
    expect((out[0] as { id: string }).id).toBe('on');
  });

  it('returns unavailable_day rows that match the date', () => {
    const items: CalendarItem[] = [
      { kind: 'unavailable_day', user: alice, date: '2026-05-13', title: 'PTO' , notes: null },
      { kind: 'unavailable_day', user: bob, date: '2026-05-14', title: null , notes: null },
    ];
    expect(itemsOnDate(items, '2026-05-13')).toHaveLength(1);
  });

  it('returns multi-day busy_blocks on every spanned day', () => {
    const items: CalendarItem[] = [
      {
        kind: 'busy_block',
        id: 'trip',
        user: alice,
        startsAt: new Date(2026, 4, 13, 18, 0),
        endsAt: new Date(2026, 4, 15, 9, 0),
        title: 'Hiking',
        notes: null,

        location: null,
      },
    ];
    expect(itemsOnDate(items, '2026-05-12')).toHaveLength(0);
    expect(itemsOnDate(items, '2026-05-13')).toHaveLength(1);
    expect(itemsOnDate(items, '2026-05-14')).toHaveLength(1);
    expect(itemsOnDate(items, '2026-05-15')).toHaveLength(1);
    expect(itemsOnDate(items, '2026-05-16')).toHaveLength(0);
  });

  it('excludes a day where a block ends exactly at midnight', () => {
    const items: CalendarItem[] = [
      {
        kind: 'busy_block',
        id: 'late',
        user: alice,
        startsAt: new Date(2026, 4, 13, 22, 0),
        endsAt: new Date(2026, 4, 14, 0, 0),
        title: null,
        notes: null,

        location: null,
      },
    ];
    expect(itemsOnDate(items, '2026-05-13')).toHaveLength(1);
    expect(itemsOnDate(items, '2026-05-14')).toHaveLength(0);
  });
});

describe('buildAgenda', () => {
  const today = new Date(2026, 4, 13);
  const dateKeys = ['2026-05-13', '2026-05-14', '2026-05-15'];

  it('groups items into the right days and preserves all dates as sections', () => {
    const items: CalendarItem[] = [
      {
        kind: 'busy_block',
        id: '1',
        user: alice,
        startsAt: new Date(2026, 4, 13, 12, 0),
        endsAt: new Date(2026, 4, 13, 13, 0),
        title: 'Lunch',
        notes: null,

        location: null,
      },
      { kind: 'unavailable_day', user: bob, date: '2026-05-15', title: 'Wedding' , notes: null },
    ];
    const agenda = buildAgenda(items, dateKeys, today);
    expect(agenda).toHaveLength(3);
    expect(agenda[0].items).toHaveLength(1);
    expect(agenda[0].items[0].user).toEqual(alice);
    expect(agenda[1].items).toHaveLength(0);
    expect(agenda[2].items).toHaveLength(1);
    expect(agenda[2].items[0].user).toEqual(bob);
  });

  it('drops items outside the requested date window', () => {
    const items: CalendarItem[] = [
      { kind: 'unavailable_day', user: alice, date: '2026-12-25', title: null , notes: null },
    ];
    const agenda = buildAgenda(items, dateKeys, today);
    expect(agenda.flatMap((a) => a.items)).toHaveLength(0);
  });

  it('sorts unavailable_day before busy_blocks within a day', () => {
    const items: CalendarItem[] = [
      {
        kind: 'busy_block',
        id: '1',
        user: alice,
        startsAt: new Date(2026, 4, 13, 9, 0),
        endsAt: new Date(2026, 4, 13, 10, 0),
        title: 'Standup',
        notes: null,

        location: null,
      },
      { kind: 'unavailable_day', user: bob, date: '2026-05-13', title: 'PTO' , notes: null },
    ];
    const agenda = buildAgenda(items, dateKeys, today);
    expect(agenda[0].items[0].kind).toBe('unavailable_day');
    expect(agenda[0].items[1].kind).toBe('busy_block');
  });

  it('sorts multiple busy_blocks by start time', () => {
    const items: CalendarItem[] = [
      {
        kind: 'busy_block',
        id: 'late',
        user: alice,
        startsAt: new Date(2026, 4, 13, 16, 0),
        endsAt: new Date(2026, 4, 13, 17, 0),
        title: 'Late',
        notes: null,

        location: null,
      },
      {
        kind: 'busy_block',
        id: 'early',
        user: alice,
        startsAt: new Date(2026, 4, 13, 9, 0),
        endsAt: new Date(2026, 4, 13, 10, 0),
        title: 'Early',
        notes: null,

        location: null,
      },
    ];
    const agenda = buildAgenda(items, dateKeys, today);
    expect((agenda[0].items[0] as { id: string }).id).toBe('early');
    expect((agenda[0].items[1] as { id: string }).id).toBe('late');
  });
});

describe('shiftDate', () => {
  it('returns the next day for a positive offset', () => {
    expect(shiftDate('2026-05-13', 1)).toBe('2026-05-14');
  });

  it('returns the previous day for a negative offset', () => {
    expect(shiftDate('2026-05-13', -1)).toBe('2026-05-12');
  });

  it('rolls over month boundaries', () => {
    expect(shiftDate('2026-05-31', 1)).toBe('2026-06-01');
    expect(shiftDate('2026-05-01', -1)).toBe('2026-04-30');
  });

  it('rolls over year boundaries', () => {
    expect(shiftDate('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftDate('2027-01-01', -1)).toBe('2026-12-31');
  });

  it('returns the same date for zero offset', () => {
    expect(shiftDate('2026-05-13', 0)).toBe('2026-05-13');
  });
});

describe('snapMinutes', () => {
  it('snaps to the nearest multiple of `snap`', () => {
    expect(snapMinutes(0, 15)).toBe(0);
    expect(snapMinutes(7, 15)).toBe(0);
    expect(snapMinutes(8, 15)).toBe(15);
    expect(snapMinutes(22, 15)).toBe(15);
    expect(snapMinutes(23, 15)).toBe(30);
    expect(snapMinutes(60, 15)).toBe(60);
  });

  it('handles negative minutes (drag up = past)', () => {
    expect(snapMinutes(-7, 15)).toBe(-0); // -0 is fine
    expect(snapMinutes(-8, 15)).toBe(-15);
    expect(snapMinutes(-23, 15)).toBe(-30);
  });

  it('snaps to other intervals', () => {
    expect(snapMinutes(13, 30)).toBe(0);
    expect(snapMinutes(15, 30)).toBe(30);
    expect(snapMinutes(45, 30)).toBe(60);
  });
});

describe('shiftBlockByMinutes', () => {
  const block: BusyBlockItem = {
    kind: 'busy_block',
    id: 'bb1',
    user: alice,
    startsAt: new Date(2026, 4, 13, 12, 0),
    endsAt: new Date(2026, 4, 13, 13, 30),
    title: 'Lunch',
    notes: null,
    location: null,
  };

  it('shifts both endpoints by the same amount, preserving duration', () => {
    const out = shiftBlockByMinutes(block, 30);
    expect(out.startsAt).toEqual(new Date(2026, 4, 13, 12, 30));
    expect(out.endsAt).toEqual(new Date(2026, 4, 13, 14, 0));
    // Duration unchanged.
    expect(out.endsAt.getTime() - out.startsAt.getTime()).toBe(
      block.endsAt.getTime() - block.startsAt.getTime(),
    );
  });

  it('handles negative deltas (drag earlier)', () => {
    const out = shiftBlockByMinutes(block, -90);
    expect(out.startsAt).toEqual(new Date(2026, 4, 13, 10, 30));
    expect(out.endsAt).toEqual(new Date(2026, 4, 13, 12, 0));
  });

  it('returns the original endpoints (as new Dates) when delta is 0', () => {
    const out = shiftBlockByMinutes(block, 0);
    expect(out.startsAt.getTime()).toBe(block.startsAt.getTime());
    expect(out.endsAt.getTime()).toBe(block.endsAt.getTime());
  });

  it('crosses day boundaries cleanly for multi-day shifts', () => {
    // Shift a 5pm block by 9 hours → next day 2am.
    const evening: BusyBlockItem = {
      ...block,
      startsAt: new Date(2026, 4, 13, 17, 0),
      endsAt: new Date(2026, 4, 13, 18, 0),
    };
    const out = shiftBlockByMinutes(evening, 9 * 60);
    expect(out.startsAt).toEqual(new Date(2026, 4, 14, 2, 0));
    expect(out.endsAt).toEqual(new Date(2026, 4, 14, 3, 0));
  });
});
