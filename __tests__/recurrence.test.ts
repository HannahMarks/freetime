import { expandOccurrences, isRecurrenceRule, RecurrenceRule } from '../lib/recurrence';

describe('isRecurrenceRule', () => {
  it('returns true for { freq: "weekly" }', () => {
    expect(isRecurrenceRule({ freq: 'weekly' })).toBe(true);
  });

  it('returns false for null / undefined / non-objects', () => {
    expect(isRecurrenceRule(null)).toBe(false);
    expect(isRecurrenceRule(undefined)).toBe(false);
    expect(isRecurrenceRule('weekly')).toBe(false);
    expect(isRecurrenceRule(7)).toBe(false);
  });

  it('returns false for objects without a recognized freq', () => {
    expect(isRecurrenceRule({})).toBe(false);
    expect(isRecurrenceRule({ freq: 'daily' })).toBe(false);
    expect(isRecurrenceRule({ freq: 'WEEKLY' })).toBe(false); // case-sensitive
  });
});

describe('expandOccurrences (weekly)', () => {
  // Anchor everything to a fixed Monday so the math is easy to read.
  // Monday 2026-05-11 14:00 → 15:00.
  const baseStart = new Date(2026, 4, 11, 14, 0);
  const baseEnd = new Date(2026, 4, 11, 15, 0);
  const rule: RecurrenceRule = { freq: 'weekly' };

  it('returns the base occurrence when the range is exactly that one week', () => {
    const out = expandOccurrences({
      rule,
      baseStart,
      baseEnd,
      rangeStart: new Date(2026, 4, 11, 0, 0),
      rangeEnd: new Date(2026, 4, 18, 0, 0),
    });
    expect(out).toHaveLength(1);
    expect(out[0].startsAt).toEqual(baseStart);
    expect(out[0].endsAt).toEqual(baseEnd);
  });

  it('returns four occurrences over a four-week range starting on the base date', () => {
    const out = expandOccurrences({
      rule,
      baseStart,
      baseEnd,
      rangeStart: new Date(2026, 4, 11, 0, 0),
      rangeEnd: new Date(2026, 5, 8, 0, 0), // 4 weeks later
    });
    expect(out).toHaveLength(4);
    // Mondays: May 11, May 18, May 25, June 1.
    expect(out.map((o) => o.startsAt.getDate())).toEqual([11, 18, 25, 1]);
    // Same hour/minute on every occurrence.
    for (const o of out) {
      expect(o.startsAt.getHours()).toBe(14);
      expect(o.endsAt.getHours()).toBe(15);
    }
  });

  it('preserves the duration on every occurrence (multi-hour blocks)', () => {
    // 14:00 to 16:30 — 2.5h
    const out = expandOccurrences({
      rule,
      baseStart: new Date(2026, 4, 11, 14, 0),
      baseEnd: new Date(2026, 4, 11, 16, 30),
      rangeStart: new Date(2026, 4, 11, 0, 0),
      rangeEnd: new Date(2026, 5, 1, 0, 0),
    });
    for (const o of out) {
      expect(o.endsAt.getTime() - o.startsAt.getTime()).toBe(150 * 60_000);
    }
  });

  it('skips ahead efficiently when the base is far in the past', () => {
    // Base in Jan 2025 — but range is May 2026. Should return ONLY May 2026
    // occurrences, not waste effort iterating 18 months of weeks (and the
    // helper should bound the result, not crash).
    const farPastBase = new Date(2025, 0, 6, 14, 0); // Mon Jan 6 2025
    const farPastEnd = new Date(2025, 0, 6, 15, 0);
    const out = expandOccurrences({
      rule,
      baseStart: farPastBase,
      baseEnd: farPastEnd,
      rangeStart: new Date(2026, 4, 1, 0, 0),
      rangeEnd: new Date(2026, 5, 1, 0, 0),
    });
    // May 2026 Mondays: 4, 11, 18, 25.
    expect(out.map((o) => o.startsAt.getDate())).toEqual([4, 11, 18, 25]);
    // All Mondays + 14:00.
    for (const o of out) {
      expect(o.startsAt.getDay()).toBe(1);
      expect(o.startsAt.getHours()).toBe(14);
    }
  });

  it('returns an empty array when the base is after the range', () => {
    const out = expandOccurrences({
      rule,
      baseStart: new Date(2027, 0, 1, 14, 0),
      baseEnd: new Date(2027, 0, 1, 15, 0),
      rangeStart: new Date(2026, 4, 1, 0, 0),
      rangeEnd: new Date(2026, 5, 1, 0, 0),
    });
    expect(out).toEqual([]);
  });

  it('includes an occurrence whose START is before the range as long as its END is inside the range', () => {
    // Base spans across midnight: Sunday 23:00 → Monday 01:00 — useful for
    // "Sunday late-night gaming sessions" type entries. Check that the
    // occurrence is included when querying just the Monday.
    const out = expandOccurrences({
      rule,
      baseStart: new Date(2026, 4, 10, 23, 0), // Sun May 10 23:00
      baseEnd: new Date(2026, 4, 11, 1, 0),    // Mon May 11 01:00
      rangeStart: new Date(2026, 4, 11, 0, 0),
      rangeEnd: new Date(2026, 4, 12, 0, 0),
    });
    expect(out).toHaveLength(1);
    expect(out[0].startsAt.getDate()).toBe(10);
    expect(out[0].endsAt.getDate()).toBe(11);
  });

  it('returns an empty array for an unsupported frequency without throwing', () => {
    const out = expandOccurrences({
      // @ts-expect-error testing unsupported freq survives gracefully
      rule: { freq: 'monthly' },
      baseStart,
      baseEnd,
      rangeStart: new Date(2026, 4, 11, 0, 0),
      rangeEnd: new Date(2026, 5, 11, 0, 0),
    });
    expect(out).toEqual([]);
  });
});
