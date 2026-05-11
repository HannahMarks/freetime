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

describe('expandOccurrences (weekly + byDay)', () => {
  // Base is Mon May 11 2026 14:00 → 15:00. Tests vary byDay to pick
  // different weekdays inside each week.
  const baseStart = new Date(2026, 4, 11, 14, 0);
  const baseEnd = new Date(2026, 4, 11, 15, 0);

  it('returns one occurrence per selected weekday inside each week', () => {
    // Mon (1) + Wed (3) + Fri (5).
    const out = expandOccurrences({
      rule: { freq: 'weekly', byDay: [1, 3, 5] },
      baseStart,
      baseEnd,
      rangeStart: new Date(2026, 4, 11, 0, 0),
      rangeEnd: new Date(2026, 4, 18, 0, 0),
    });
    // May 11 (Mon), 13 (Wed), 15 (Fri).
    expect(out.map((o) => o.startsAt.getDate())).toEqual([11, 13, 15]);
    // All inherit the base's hour.
    for (const o of out) {
      expect(o.startsAt.getHours()).toBe(14);
      expect(o.startsAt.getMinutes()).toBe(0);
    }
  });

  it('returns occurrences in chronological order across multiple weeks', () => {
    const out = expandOccurrences({
      rule: { freq: 'weekly', byDay: [1, 5] }, // Mon + Fri
      baseStart,
      baseEnd,
      rangeStart: new Date(2026, 4, 11, 0, 0),
      rangeEnd: new Date(2026, 4, 25, 0, 0), // 2 weeks
    });
    // Expect: Mon 11, Fri 15, Mon 18, Fri 22.
    expect(out.map((o) => o.startsAt.getDate())).toEqual([11, 15, 18, 22]);
  });

  it('ignores days that come before the base date in week 0 (a Tue base with byDay=[Mon] should NOT include the Mon before)', () => {
    // Base is Tue. Selecting Mon means the first matching occurrence
    // is the FOLLOWING Monday, not the one that came before the base.
    const tueBase = new Date(2026, 4, 12, 14, 0); // Tue May 12 2026
    const out = expandOccurrences({
      rule: { freq: 'weekly', byDay: [1] }, // Mon
      baseStart: tueBase,
      baseEnd: new Date(2026, 4, 12, 15, 0),
      rangeStart: new Date(2026, 4, 11, 0, 0),
      rangeEnd: new Date(2026, 4, 25, 0, 0),
    });
    // Expect: Mon 18, Mon 25 (Mon 11 is BEFORE the base).
    expect(out.map((o) => o.startsAt.getDate())).toEqual([18]);
  });

  it('falls back to the base weekday when byDay is omitted (preserves v1 behavior)', () => {
    const out = expandOccurrences({
      rule: { freq: 'weekly' }, // no byDay
      baseStart,
      baseEnd,
      rangeStart: new Date(2026, 4, 11, 0, 0),
      rangeEnd: new Date(2026, 4, 25, 0, 0),
    });
    // Mondays only: 11, 18.
    expect(out.map((o) => o.startsAt.getDate())).toEqual([11, 18]);
  });

  it('falls back to the base weekday when byDay is an empty array', () => {
    const out = expandOccurrences({
      rule: { freq: 'weekly', byDay: [] },
      baseStart,
      baseEnd,
      rangeStart: new Date(2026, 4, 11, 0, 0),
      rangeEnd: new Date(2026, 4, 25, 0, 0),
    });
    expect(out.map((o) => o.startsAt.getDate())).toEqual([11, 18]);
  });
});

describe('expandOccurrences (until)', () => {
  const baseStart = new Date(2026, 4, 11, 14, 0); // Mon May 11
  const baseEnd = new Date(2026, 4, 11, 15, 0);

  it('caps weekly expansion at `until` (inclusive)', () => {
    // until = May 18 → expect occurrences on May 11 and May 18 only.
    const out = expandOccurrences({
      rule: { freq: 'weekly', until: '2026-05-18' },
      baseStart,
      baseEnd,
      rangeStart: new Date(2026, 4, 11, 0, 0),
      rangeEnd: new Date(2026, 6, 1, 0, 0),
    });
    expect(out.map((o) => o.startsAt.getDate())).toEqual([11, 18]);
  });

  it('treats `until` as an inclusive END-OF-DAY date', () => {
    // until = May 17. May 18 starts AFTER until's end-of-day, so it's
    // excluded. Only May 11 should be included.
    const out = expandOccurrences({
      rule: { freq: 'weekly', until: '2026-05-17' },
      baseStart,
      baseEnd,
      rangeStart: new Date(2026, 4, 11, 0, 0),
      rangeEnd: new Date(2026, 6, 1, 0, 0),
    });
    expect(out.map((o) => o.startsAt.getDate())).toEqual([11]);
  });

  it('combines with byDay', () => {
    const out = expandOccurrences({
      rule: { freq: 'weekly', byDay: [1, 3], until: '2026-05-25' },
      baseStart,
      baseEnd,
      rangeStart: new Date(2026, 4, 11, 0, 0),
      rangeEnd: new Date(2026, 6, 1, 0, 0),
    });
    // Mon May 11, Wed May 13, Mon May 18, Wed May 20, Mon May 25.
    expect(out.map((o) => o.startsAt.getDate())).toEqual([11, 13, 18, 20, 25]);
  });

  it('returns an empty array when until is before the base', () => {
    const out = expandOccurrences({
      rule: { freq: 'weekly', until: '2026-04-01' },
      baseStart,
      baseEnd,
      rangeStart: new Date(2026, 4, 11, 0, 0),
      rangeEnd: new Date(2026, 6, 1, 0, 0),
    });
    expect(out).toEqual([]);
  });
});

describe('expandOccurrences (skipKeys)', () => {
  // Mon May 11 2026 14:00 → 15:00 series. We pass a `skipKeys` set
  // containing the ISO timestamp of one occurrence; that occurrence
  // should be omitted from the output, all others preserved.
  const baseStart = new Date(2026, 4, 11, 14, 0);
  const baseEnd = new Date(2026, 4, 11, 15, 0);
  const rule: RecurrenceRule = { freq: 'weekly' };

  it('omits an occurrence whose ISO start matches a skipKey', () => {
    // Skip May 18.
    const may18 = new Date(2026, 4, 18, 14, 0);
    const out = expandOccurrences({
      rule,
      baseStart,
      baseEnd,
      rangeStart: new Date(2026, 4, 11, 0, 0),
      rangeEnd: new Date(2026, 5, 8, 0, 0),
      skipKeys: new Set([may18.toISOString()]),
    });
    expect(out.map((o) => o.startsAt.getDate())).toEqual([11, 25, 1]);
  });

  it('omits multiple skipped occurrences', () => {
    const out = expandOccurrences({
      rule,
      baseStart,
      baseEnd,
      rangeStart: new Date(2026, 4, 11, 0, 0),
      rangeEnd: new Date(2026, 5, 8, 0, 0),
      skipKeys: new Set([
        new Date(2026, 4, 11, 14, 0).toISOString(),
        new Date(2026, 4, 25, 14, 0).toISOString(),
      ]),
    });
    expect(out.map((o) => o.startsAt.getDate())).toEqual([18, 1]);
  });

  it('treats an empty / undefined skipKeys set as no skips (preserves v1/v2 behavior)', () => {
    const a = expandOccurrences({
      rule,
      baseStart,
      baseEnd,
      rangeStart: new Date(2026, 4, 11, 0, 0),
      rangeEnd: new Date(2026, 5, 8, 0, 0),
    });
    const b = expandOccurrences({
      rule,
      baseStart,
      baseEnd,
      rangeStart: new Date(2026, 4, 11, 0, 0),
      rangeEnd: new Date(2026, 5, 8, 0, 0),
      skipKeys: new Set(),
    });
    expect(a.map((o) => o.startsAt.getTime())).toEqual(b.map((o) => o.startsAt.getTime()));
  });

  it('skipKey lookup uses ISO string (not Date instance), so callers can match on row data', () => {
    // Construct two skip targets with the same wall-clock time but
    // built two different ways — they should both match by ISO.
    const may18a = new Date(2026, 4, 18, 14, 0);
    const may18b = new Date(may18a.toISOString()); // round-trip
    const out = expandOccurrences({
      rule,
      baseStart,
      baseEnd,
      rangeStart: new Date(2026, 4, 11, 0, 0),
      rangeEnd: new Date(2026, 4, 25, 0, 0),
      skipKeys: new Set([may18b.toISOString()]),
    });
    expect(out.map((o) => o.startsAt.getDate())).toEqual([11]);
  });
});

describe('isRecurrenceRule (extended shapes)', () => {
  it('accepts a rule with byDay', () => {
    expect(isRecurrenceRule({ freq: 'weekly', byDay: [1, 3] })).toBe(true);
  });

  it('accepts a rule with until', () => {
    expect(isRecurrenceRule({ freq: 'weekly', until: '2026-12-31' })).toBe(true);
  });

  it('accepts a rule with both byDay and until', () => {
    expect(
      isRecurrenceRule({ freq: 'weekly', byDay: [1, 3, 5], until: '2026-12-31' }),
    ).toBe(true);
  });
});
