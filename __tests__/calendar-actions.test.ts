import { listCalendarItems } from '../lib/calendar-actions';
import { supabase } from '../lib/supabase';

jest.mock('../lib/supabase', () => ({
  supabase: { from: jest.fn() },
}));

const mockSupabase = supabase as unknown as { from: jest.Mock };

function chainable(resolved: unknown) {
  const builder: Record<string, jest.Mock> = {};
  const terminal = Promise.resolve(resolved);
  for (const name of ['select', 'gte', 'gt', 'lt', 'or', 'in']) {
    builder[name] = jest.fn().mockReturnValue(builder);
  }
  (builder as { then: unknown }).then = (onFulfilled: unknown, onRejected: unknown) =>
    terminal.then(onFulfilled as (v: unknown) => unknown, onRejected as (r: unknown) => unknown);
  (builder as { catch: unknown }).catch = (onRejected: unknown) =>
    terminal.catch(onRejected as (r: unknown) => unknown);
  (builder as { finally: unknown }).finally = (onFinally: unknown) =>
    terminal.finally(onFinally as () => void);
  return builder;
}

const alice = { id: 'a', display_name: 'Alice', color: '#FF6B6B' };
const bob = { id: 'b', display_name: 'Bob', color: '#4ECDC4' };

describe('listCalendarItems', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('queries both tables with the date window and returns merged items including notes + location', async () => {
    const busyBuilder = chainable({
      data: [
        {
          id: 'bb1',
          user_id: alice.id,
          title: 'Lunch',
          starts_at: '2026-05-13T12:00:00Z',
          ends_at: '2026-05-13T13:00:00Z',
          notes: 'Bring deck',
          location: 'Cafe Borrone',
          user: alice,
        },
      ],
      error: null,
    });
    const daysBuilder = chainable({
      data: [
        {
          user_id: bob.id,
          date: '2026-05-15',
          title: 'Wedding',
          notes: 'Black tie, downtown',
          user: bob,
        },
      ],
      error: null,
    });

    mockSupabase.from
      .mockImplementationOnce(() => busyBuilder)
      .mockImplementationOnce(() => daysBuilder);

    const { data, error } = await listCalendarItems({
      fromDate: '2026-05-13',
      toDate: '2026-05-20',
    });

    expect(error).toBeNull();
    expect(mockSupabase.from).toHaveBeenNthCalledWith(1, 'busy_blocks');
    expect(mockSupabase.from).toHaveBeenNthCalledWith(2, 'unavailable_days');
    // Combined predicate: `starts_at < toDate` (always required — no
    // future-only series) AND (`ends_at > fromDate` OR row is recurring).
    // The OR's recurring branch lets us pull series whose first
    // occurrence is in the past so they can be expanded forward into
    // the window.
    expect(busyBuilder.lt).toHaveBeenCalledWith('starts_at', '2026-05-20');
    expect(busyBuilder.or).toHaveBeenCalledWith(
      expect.stringMatching(/ends_at\.gt\.2026-05-13.*recurrence_rule\.not\.is\.null/),
    );
    // Same OR-with-recurring-bypass shape as the busy_blocks query so
    // recurring unavailable_days whose base date is before the window
    // are still pulled and expanded forward.
    expect(daysBuilder.lt).toHaveBeenCalledWith('date', '2026-05-20');
    expect(daysBuilder.or).toHaveBeenCalledWith(
      expect.stringMatching(/date\.gte\.2026-05-13.*recurrence_rule\.not\.is\.null/),
    );

    // The select clauses must request notes + location so they're available
    // client-side without a second round-trip. recurrence_rule is in there
    // too so the client can expand series without an extra query.
    expect(busyBuilder.select).toHaveBeenCalledWith(expect.stringMatching(/notes/));
    expect(busyBuilder.select).toHaveBeenCalledWith(expect.stringMatching(/location/));
    expect(busyBuilder.select).toHaveBeenCalledWith(expect.stringMatching(/recurrence_rule/));
    expect(daysBuilder.select).toHaveBeenCalledWith(expect.stringMatching(/notes/));

    expect(data).toHaveLength(2);
    const busy = data!.find((i) => i.kind === 'busy_block');
    const day = data!.find((i) => i.kind === 'unavailable_day');
    expect(busy).toMatchObject({
      kind: 'busy_block',
      id: 'bb1',
      user: alice,
      title: 'Lunch',
      notes: 'Bring deck',
      location: 'Cafe Borrone',
    });
    if (busy?.kind === 'busy_block') {
      expect(busy.startsAt).toBeInstanceOf(Date);
      expect(busy.endsAt).toBeInstanceOf(Date);
    }
    expect(day).toMatchObject({
      kind: 'unavailable_day',
      user: bob,
      date: '2026-05-15',
      title: 'Wedding',
      notes: 'Black tie, downtown',
    });
  });

  it('returns a friendly error if the busy_blocks query fails', async () => {
    mockSupabase.from
      .mockImplementationOnce(() => chainable({ data: null, error: { message: 'boom' } }))
      .mockImplementationOnce(() => chainable({ data: [], error: null }));

    const result = await listCalendarItems({ fromDate: '2026-05-13', toDate: '2026-05-20' });
    expect(result.data).toBeNull();
    expect(result.error).toMatch(/couldn't load/i);
  });

  it('returns a friendly error if the unavailable_days query fails', async () => {
    mockSupabase.from
      .mockImplementationOnce(() => chainable({ data: [], error: null }))
      .mockImplementationOnce(() => chainable({ data: null, error: { message: 'boom' } }));

    const result = await listCalendarItems({ fromDate: '2026-05-13', toDate: '2026-05-20' });
    expect(result.data).toBeNull();
    expect(result.error).toMatch(/couldn't load/i);
  });

  it('skips rows whose embedded profile join is null (defensive)', async () => {
    mockSupabase.from
      .mockImplementationOnce(() =>
        chainable({
          data: [
            {
              id: 'bb1',
              user_id: 'orphan',
              title: 'Mystery',
              starts_at: '2026-05-13T12:00:00Z',
              ends_at: '2026-05-13T13:00:00Z',
              user: null,
            },
          ],
          error: null,
        }),
      )
      .mockImplementationOnce(() => chainable({ data: [], error: null }));

    const { data, error } = await listCalendarItems({
      fromDate: '2026-05-13',
      toDate: '2026-05-20',
    });
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('returns an empty list when both tables are empty', async () => {
    mockSupabase.from
      .mockImplementationOnce(() => chainable({ data: [], error: null }))
      .mockImplementationOnce(() => chainable({ data: [], error: null }));

    const { data, error } = await listCalendarItems({
      fromDate: '2026-05-13',
      toDate: '2026-05-20',
    });
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  describe('recurring busy_blocks', () => {
    it('expands a weekly recurring series into one item per occurrence in the window', async () => {
      // Base: Mon May 11 2026 14:00 → 15:00. Window: May 11 → June 1 (3 weeks).
      // Expect 3 occurrences: May 11, May 18, May 25.
      mockSupabase.from
        .mockImplementationOnce(() =>
          chainable({
            data: [
              {
                id: 'series1',
                user_id: alice.id,
                title: 'Yoga',
                starts_at: '2026-05-11T21:00:00Z', // 14:00 PDT
                ends_at: '2026-05-11T22:00:00Z',
                notes: null,
                location: null,
                recurrence_rule: { freq: 'weekly' },
                user: alice,
              },
            ],
            error: null,
          }),
        )
        .mockImplementationOnce(() => chainable({ data: [], error: null }))
        // 3rd mock for the busy_block_exceptions query (added in v4
        // for per-occurrence skip overrides). Empty = no skips applied.
        .mockImplementationOnce(() => chainable({ data: [], error: null }));

      const { data, error } = await listCalendarItems({
        fromDate: '2026-05-11',
        toDate: '2026-06-01',
      });

      expect(error).toBeNull();
      expect(data).toHaveLength(3);
      const dates = (data ?? []).map((i) => (i.kind === 'busy_block' ? i.startsAt.getDate() : -1));
      expect(dates).toEqual([11, 18, 25]);
      // Every expanded occurrence carries the original recurrence rule
      // and the original DB id (DayTimeline keys by id + startsAt for
      // React uniqueness across siblings).
      for (const item of data ?? []) {
        if (item.kind !== 'busy_block') continue;
        expect(item.id).toBe('series1');
        expect(item.recurrenceRule).toEqual({ freq: 'weekly' });
        expect(item.title).toBe('Yoga');
      }
    });

    it('also expands series whose base falls before the window (only in-window occurrences are returned)', async () => {
      // Base: Mon Jan 5 2026 14:00. Window: May 11 → June 1.
      // Expect just the May 2026 Mondays in range: May 11, 18, 25.
      mockSupabase.from
        .mockImplementationOnce(() =>
          chainable({
            data: [
              {
                id: 'series1',
                user_id: alice.id,
                title: 'Standup',
                starts_at: '2026-01-05T22:00:00Z', // 14:00 PST (before DST)
                ends_at: '2026-01-05T23:00:00Z',
                notes: null,
                location: null,
                recurrence_rule: { freq: 'weekly' },
                user: alice,
              },
            ],
            error: null,
          }),
        )
        .mockImplementationOnce(() => chainable({ data: [], error: null }))
        .mockImplementationOnce(() => chainable({ data: [], error: null }));

      const { data, error } = await listCalendarItems({
        fromDate: '2026-05-11',
        toDate: '2026-06-01',
      });

      expect(error).toBeNull();
      expect(data).toHaveLength(3);
      const dates = (data ?? []).map((i) => (i.kind === 'busy_block' ? i.startsAt.getDate() : -1));
      expect(dates.sort((a, b) => a - b)).toEqual([11, 18, 25]);
    });

    it('returns recurrenceRule: null on non-recurring busy_blocks', async () => {
      mockSupabase.from
        .mockImplementationOnce(() =>
          chainable({
            data: [
              {
                id: 'oneoff',
                user_id: alice.id,
                title: 'Lunch',
                starts_at: '2026-05-13T19:00:00Z',
                ends_at: '2026-05-13T20:00:00Z',
                notes: null,
                location: null,
                recurrence_rule: null,
                user: alice,
              },
            ],
            error: null,
          }),
        )
        .mockImplementationOnce(() => chainable({ data: [], error: null }));

      const { data } = await listCalendarItems({
        fromDate: '2026-05-13',
        toDate: '2026-05-14',
      });

      expect(data).toHaveLength(1);
      const item = data?.[0];
      if (item?.kind !== 'busy_block') throw new Error('expected busy_block');
      expect(item.recurrenceRule).toBeNull();
    });

    it('does not include occurrences outside the requested window', async () => {
      // Base: Mon May 11 2026 14:00. Window: May 18 → May 25 only (one week).
      // Expect just the May 18 occurrence — May 11 is before window-start,
      // May 25 is at window-end (exclusive).
      mockSupabase.from
        .mockImplementationOnce(() =>
          chainable({
            data: [
              {
                id: 'series1',
                user_id: alice.id,
                title: 'Yoga',
                starts_at: '2026-05-11T21:00:00Z',
                ends_at: '2026-05-11T22:00:00Z',
                notes: null,
                location: null,
                recurrence_rule: { freq: 'weekly' },
                user: alice,
              },
            ],
            error: null,
          }),
        )
        .mockImplementationOnce(() => chainable({ data: [], error: null }))
        .mockImplementationOnce(() => chainable({ data: [], error: null }));

      const { data } = await listCalendarItems({
        fromDate: '2026-05-18',
        toDate: '2026-05-25',
      });

      expect(data).toHaveLength(1);
      const item = data?.[0];
      if (item?.kind !== 'busy_block') throw new Error('expected busy_block');
      expect(item.startsAt.getDate()).toBe(18);
    });
  });

  describe('per-occurrence exceptions', () => {
    it('queries busy_block_exceptions and skips occurrences whose original_start matches a "skip" exception', async () => {
      // Series: Mon May 11 2026 14:00 weekly. Window: 3 weeks (May 11 →
      // June 1) → expects May 11, 18, 25. Exception skips May 18.
      // Result: only May 11 and May 25.
      const exceptionsBuilder = chainable({
        data: [
          {
            series_id: 'series1',
            original_start: '2026-05-18T21:00:00.000Z',
            action: 'skip',
          },
        ],
        error: null,
      });
      mockSupabase.from
        .mockImplementationOnce(() =>
          chainable({
            data: [
              {
                id: 'series1',
                user_id: alice.id,
                title: 'Yoga',
                starts_at: '2026-05-11T21:00:00.000Z',
                ends_at: '2026-05-11T22:00:00.000Z',
                notes: null,
                location: null,
                recurrence_rule: { freq: 'weekly' },
                user: alice,
              },
            ],
            error: null,
          }),
        )
        .mockImplementationOnce(() => chainable({ data: [], error: null }))
        .mockImplementationOnce(() => exceptionsBuilder);

      const { data, error } = await listCalendarItems({
        fromDate: '2026-05-11',
        toDate: '2026-06-01',
      });

      expect(error).toBeNull();
      expect(mockSupabase.from).toHaveBeenNthCalledWith(3, 'busy_block_exceptions');
      // The exceptions query loads exceptions for the SERIES we just
      // saw — uses .in('series_id', [...]) to scope.
      expect(exceptionsBuilder.in).toHaveBeenCalledWith('series_id', ['series1']);

      const dates = (data ?? [])
        .filter((i) => i.kind === 'busy_block')
        .map((i) => (i.kind === 'busy_block' ? i.startsAt.getDate() : -1));
      expect(dates).toEqual([11, 25]);
    });

    it('does not query busy_block_exceptions when there are no recurring series in the result', async () => {
      // No recurring series → no need to query the exceptions table.
      mockSupabase.from
        .mockImplementationOnce(() =>
          chainable({
            data: [
              {
                id: 'oneoff',
                user_id: alice.id,
                title: 'Lunch',
                starts_at: '2026-05-13T19:00:00.000Z',
                ends_at: '2026-05-13T20:00:00.000Z',
                notes: null,
                location: null,
                recurrence_rule: null,
                user: alice,
              },
            ],
            error: null,
          }),
        )
        .mockImplementationOnce(() => chainable({ data: [], error: null }));

      await listCalendarItems({ fromDate: '2026-05-13', toDate: '2026-05-14' });

      // Only 2 .from() calls — busy_blocks, unavailable_days. The
      // exceptions table is never hit.
      expect(mockSupabase.from).toHaveBeenCalledTimes(2);
    });

    it('does not crash when the exceptions query fails — falls back to unfiltered occurrences', async () => {
      // We DON'T fail the whole listCalendarItems call if exceptions
      // can't be loaded. Showing all occurrences (with the deleted
      // one mistakenly visible) is preferable to showing nothing.
      mockSupabase.from
        .mockImplementationOnce(() =>
          chainable({
            data: [
              {
                id: 'series1',
                user_id: alice.id,
                title: 'Yoga',
                starts_at: '2026-05-11T21:00:00.000Z',
                ends_at: '2026-05-11T22:00:00.000Z',
                notes: null,
                location: null,
                recurrence_rule: { freq: 'weekly' },
                user: alice,
              },
            ],
            error: null,
          }),
        )
        .mockImplementationOnce(() => chainable({ data: [], error: null }))
        .mockImplementationOnce(() =>
          chainable({ data: null, error: { message: 'exceptions table boom' } }),
        );

      const { data, error } = await listCalendarItems({
        fromDate: '2026-05-11',
        toDate: '2026-06-01',
      });

      // Calendar still renders — error swallowed.
      expect(error).toBeNull();
      const dates = (data ?? [])
        .filter((i) => i.kind === 'busy_block')
        .map((i) => (i.kind === 'busy_block' ? i.startsAt.getDate() : -1));
      // All 3 occurrences shown — no exception applied.
      expect(dates).toEqual([11, 18, 25]);
    });

    it('applies a "move" exception — moved occurrence appears at the new time, carries originalStart', async () => {
      // Series: Mon May 11 2026 14:00 weekly. Move May 18 to May 18 at
      // 16:00 (a 2-hour shift). Window covers May 11 → May 25.
      mockSupabase.from
        .mockImplementationOnce(() =>
          chainable({
            data: [
              {
                id: 'series1',
                user_id: alice.id,
                title: 'Yoga',
                starts_at: '2026-05-11T21:00:00.000Z', // 14:00 PDT
                ends_at: '2026-05-11T22:00:00.000Z',
                notes: null,
                location: null,
                recurrence_rule: { freq: 'weekly' },
                user: alice,
              },
            ],
            error: null,
          }),
        )
        .mockImplementationOnce(() => chainable({ data: [], error: null }))
        .mockImplementationOnce(() =>
          chainable({
            data: [
              {
                series_id: 'series1',
                original_start: '2026-05-18T21:00:00.000Z',
                action: 'move',
                new_start: '2026-05-18T23:00:00.000Z', // 16:00 PDT
                new_end: '2026-05-19T00:30:00.000Z',
              },
            ],
            error: null,
          }),
        );

      const { data, error } = await listCalendarItems({
        fromDate: '2026-05-11',
        toDate: '2026-05-25',
      });

      expect(error).toBeNull();
      const busy = (data ?? []).filter((i) => i.kind === 'busy_block');
      expect(busy).toHaveLength(2);
      // First occurrence: May 11 at original time, no originalStart.
      if (busy[0].kind !== 'busy_block') throw new Error();
      expect(busy[0].startsAt.toISOString()).toBe('2026-05-11T21:00:00.000Z');
      expect(busy[0].originalStart).toBeUndefined();
      // Moved occurrence: displayed at the NEW time, originalStart
      // carries the pre-move start so the UI can find the exception
      // row for further edits.
      if (busy[1].kind !== 'busy_block') throw new Error();
      expect(busy[1].startsAt.toISOString()).toBe('2026-05-18T23:00:00.000Z');
      expect(busy[1].endsAt.toISOString()).toBe('2026-05-19T00:30:00.000Z');
      expect(busy[1].originalStart?.toISOString()).toBe('2026-05-18T21:00:00.000Z');
    });
  });

  describe('recurring unavailable_days', () => {
    it('expands a weekly recurring unavailable_day into one item per occurrence date', async () => {
      // Base date Mon May 11 2026; window May 11 → June 1 (3 weeks).
      // Expect 3 occurrences on May 11, 18, 25.
      mockSupabase.from
        .mockImplementationOnce(() => chainable({ data: [], error: null }))
        .mockImplementationOnce(() =>
          chainable({
            data: [
              {
                user_id: alice.id,
                date: '2026-05-11',
                title: 'PTO',
                notes: null,
                recurrence_rule: { freq: 'weekly' },
                user: alice,
              },
            ],
            error: null,
          }),
        );

      const { data, error } = await listCalendarItems({
        fromDate: '2026-05-11',
        toDate: '2026-06-01',
      });

      expect(error).toBeNull();
      expect(data).toHaveLength(3);
      const dates = (data ?? [])
        .filter((i): i is Extract<typeof i, { kind: 'unavailable_day' }> =>
          i.kind === 'unavailable_day',
        )
        .map((i) => i.date)
        .sort();
      expect(dates).toEqual(['2026-05-11', '2026-05-18', '2026-05-25']);
      // Every occurrence carries the rule + the series's base date so
      // tap-to-edit can find the underlying row.
      for (const item of data ?? []) {
        if (item.kind !== 'unavailable_day') continue;
        expect(item.recurrenceRule).toEqual({ freq: 'weekly' });
        expect(item.title).toBe('PTO');
        expect(item.seriesDate).toBe('2026-05-11');
      }
    });

    it('also expands series whose base date is BEFORE the window', async () => {
      // Base Mon Jan 5 2026, window May 11 → June 1. Expect just the
      // May Mondays in range: 11, 18, 25.
      mockSupabase.from
        .mockImplementationOnce(() => chainable({ data: [], error: null }))
        .mockImplementationOnce(() =>
          chainable({
            data: [
              {
                user_id: alice.id,
                date: '2026-01-05',
                title: 'No-meeting day',
                notes: null,
                recurrence_rule: { freq: 'weekly' },
                user: alice,
              },
            ],
            error: null,
          }),
        );

      const { data } = await listCalendarItems({
        fromDate: '2026-05-11',
        toDate: '2026-06-01',
      });

      const dates = (data ?? [])
        .filter((i) => i.kind === 'unavailable_day')
        .map((i) => i.date)
        .sort();
      expect(dates).toEqual(['2026-05-11', '2026-05-18', '2026-05-25']);
    });

    it('returns recurrenceRule = null on non-recurring unavailable_days (and seriesDate = date)', async () => {
      mockSupabase.from
        .mockImplementationOnce(() => chainable({ data: [], error: null }))
        .mockImplementationOnce(() =>
          chainable({
            data: [
              {
                user_id: alice.id,
                date: '2026-05-13',
                title: 'PTO',
                notes: null,
                recurrence_rule: null,
                user: alice,
              },
            ],
            error: null,
          }),
        );

      const { data } = await listCalendarItems({
        fromDate: '2026-05-13',
        toDate: '2026-05-14',
      });

      expect(data).toHaveLength(1);
      const item = data?.[0];
      if (item?.kind !== 'unavailable_day') throw new Error('expected unavailable_day');
      expect(item.recurrenceRule).toBeNull();
      expect(item.seriesDate).toBe('2026-05-13');
    });

    it('honors byDay + until on unavailable_days', async () => {
      // Series base Mon May 11, byDay=[Mon,Wed], until May 25.
      // Window May 11 → June 1. Expect May 11 (Mon), 13 (Wed), 18 (Mon),
      // 20 (Wed), 25 (Mon). May 27 (Wed) is past `until`.
      mockSupabase.from
        .mockImplementationOnce(() => chainable({ data: [], error: null }))
        .mockImplementationOnce(() =>
          chainable({
            data: [
              {
                user_id: alice.id,
                date: '2026-05-11',
                title: 'No-meeting',
                notes: null,
                recurrence_rule: { freq: 'weekly', byDay: [1, 3], until: '2026-05-25' },
                user: alice,
              },
            ],
            error: null,
          }),
        );

      const { data } = await listCalendarItems({
        fromDate: '2026-05-11',
        toDate: '2026-06-01',
      });

      const dates = (data ?? [])
        .filter((i) => i.kind === 'unavailable_day')
        .map((i) => i.date)
        .sort();
      expect(dates).toEqual([
        '2026-05-11',
        '2026-05-13',
        '2026-05-18',
        '2026-05-20',
        '2026-05-25',
      ]);
    });

    it('uses the OR predicate to fetch series whose base date is before the window', async () => {
      const dayBuilder = chainable({ data: [], error: null });
      mockSupabase.from
        .mockImplementationOnce(() => chainable({ data: [], error: null }))
        .mockImplementationOnce(() => dayBuilder);

      await listCalendarItems({ fromDate: '2026-05-13', toDate: '2026-05-20' });

      // Includes recurrence_rule in the select — needed for client-side
      // expansion without a second round-trip.
      expect(dayBuilder.select).toHaveBeenCalledWith(expect.stringMatching(/recurrence_rule/));
      // The OR predicate broadens the date filter so recurring rows whose
      // base date is BEFORE the window are still pulled.
      expect(dayBuilder.or).toHaveBeenCalledWith(
        expect.stringMatching(/date\.gte\.2026-05-13.*recurrence_rule\.not\.is\.null/),
      );
      // The hard `date < toDate` cap stays — no need to fetch
      // future-only series.
      expect(dayBuilder.lt).toHaveBeenCalledWith('date', '2026-05-20');
    });
  });
});
