import { listCalendarItems } from '../lib/calendar-actions';
import { supabase } from '../lib/supabase';

jest.mock('../lib/supabase', () => ({
  supabase: { from: jest.fn() },
}));

const mockSupabase = supabase as unknown as { from: jest.Mock };

function chainable(resolved: unknown) {
  const builder: Record<string, jest.Mock> = {};
  const terminal = Promise.resolve(resolved);
  for (const name of ['select', 'gte', 'gt', 'lt']) {
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
    // Overlap query: a block belongs to the window when it starts before
    // window-end AND ends after window-start. This catches multi-day blocks
    // that began before fromDate but extend into the range.
    expect(busyBuilder.lt).toHaveBeenCalledWith('starts_at', '2026-05-20');
    expect(busyBuilder.gt).toHaveBeenCalledWith('ends_at', '2026-05-13');
    expect(daysBuilder.gte).toHaveBeenCalledWith('date', '2026-05-13');
    expect(daysBuilder.lt).toHaveBeenCalledWith('date', '2026-05-20');

    // The select clauses must request notes + location so they're available
    // client-side without a second round-trip.
    expect(busyBuilder.select).toHaveBeenCalledWith(expect.stringMatching(/notes/));
    expect(busyBuilder.select).toHaveBeenCalledWith(expect.stringMatching(/location/));
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
});
