import {
  createEvent,
  deleteEvent,
  listEvents,
  updateEvent,
} from '../lib/event-actions';
import { supabase } from '../lib/supabase';

jest.mock('../lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
    auth: { getUser: jest.fn() },
  },
}));

const mockSupabase = supabase as unknown as {
  from: jest.Mock;
  auth: { getUser: jest.Mock };
};

function chainable(resolved: unknown) {
  const builder: Record<string, jest.Mock> = {};
  const terminal = Promise.resolve(resolved);
  for (const name of ['select', 'insert', 'update', 'delete', 'eq', 'lt', 'gt', 'gte']) {
    builder[name] = jest.fn().mockReturnValue(builder);
  }
  (builder as { then: unknown }).then = (onFulfilled: unknown, onRejected: unknown) =>
    terminal.then(onFulfilled as (v: unknown) => unknown, onRejected as (r: unknown) => unknown);
  return builder;
}

const alice = { id: 'a', display_name: 'Alice', color: '#FF6B6B' };

describe('event-actions', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  describe('createEvent', () => {
    it('inserts with the live user id, ISO timestamps, and trimmed metadata', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'me-id' } } });
      const builder = chainable({ error: null });
      mockSupabase.from.mockReturnValue(builder);

      const startsAt = new Date(2026, 4, 20, 18, 0);
      const endsAt = new Date(2026, 4, 20, 21, 0);
      const { error } = await createEvent({
        startsAt,
        endsAt,
        title: 'Birthday party',
        notes: 'Bring drinks',
        location: 'My place',
      });

      expect(error).toBeNull();
      expect(mockSupabase.from).toHaveBeenCalledWith('events');
      expect(builder.insert).toHaveBeenCalledWith({
        owner_id: 'me-id',
        title: 'Birthday party',
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        notes: 'Bring drinks',
        location: 'My place',
      });
    });

    it('persists null metadata when fields are not provided', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'me-id' } } });
      const builder = chainable({ error: null });
      mockSupabase.from.mockReturnValue(builder);

      await createEvent({
        startsAt: new Date(),
        endsAt: new Date(),
        title: null,
        notes: null,
        location: null,
      });

      expect(builder.insert).toHaveBeenCalledWith(
        expect.objectContaining({ title: null, notes: null, location: null }),
      );
    });

    it('returns "not signed in" when no session is present', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } });
      const { error } = await createEvent({
        startsAt: new Date(),
        endsAt: new Date(),
        title: null,
        notes: null,
        location: null,
      });
      expect(error).toMatch(/not signed in/i);
      expect(mockSupabase.from).not.toHaveBeenCalled();
    });

    it('returns a friendly error on DB failure', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'me-id' } } });
      mockSupabase.from.mockReturnValue(chainable({ error: { message: 'boom' } }));
      const { error } = await createEvent({
        startsAt: new Date(),
        endsAt: new Date(),
        title: null,
        notes: null,
        location: null,
      });
      expect(error).toMatch(/couldn't (?:add|create)/i);
    });
  });

  describe('updateEvent', () => {
    it('updates by id with ISO timestamps + trimmed metadata', async () => {
      const builder = chainable({ error: null });
      mockSupabase.from.mockReturnValue(builder);

      const startsAt = new Date(2026, 4, 20, 18, 0);
      const endsAt = new Date(2026, 4, 20, 22, 0);
      const { error } = await updateEvent({
        id: 'ev1',
        startsAt,
        endsAt,
        title: 'Birthday party (extended)',
        notes: null,
        location: 'My place',
      });

      expect(error).toBeNull();
      expect(mockSupabase.from).toHaveBeenCalledWith('events');
      expect(builder.update).toHaveBeenCalledWith({
        title: 'Birthday party (extended)',
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        notes: null,
        location: 'My place',
      });
      expect(builder.eq).toHaveBeenCalledWith('id', 'ev1');
    });

    it('returns a friendly error on DB failure', async () => {
      mockSupabase.from.mockReturnValue(chainable({ error: { message: 'boom' } }));
      const { error } = await updateEvent({
        id: 'ev1',
        startsAt: new Date(),
        endsAt: new Date(),
        title: null,
        notes: null,
        location: null,
      });
      expect(error).toMatch(/couldn't update/i);
    });
  });

  describe('deleteEvent', () => {
    it('deletes by id', async () => {
      const builder = chainable({ error: null });
      mockSupabase.from.mockReturnValue(builder);

      const { error } = await deleteEvent('ev1');
      expect(error).toBeNull();
      expect(mockSupabase.from).toHaveBeenCalledWith('events');
      expect(builder.delete).toHaveBeenCalled();
      expect(builder.eq).toHaveBeenCalledWith('id', 'ev1');
    });
  });

  describe('listEvents', () => {
    it('queries events overlapping the requested window and shapes them into EventItem[]', async () => {
      const builder = chainable({
        data: [
          {
            id: 'ev1',
            owner_id: alice.id,
            title: 'Birthday party',
            starts_at: '2026-05-20T01:00:00.000Z',
            ends_at: '2026-05-20T04:00:00.000Z',
            notes: 'Bring drinks',
            location: 'My place',
            owner: alice,
          },
        ],
        error: null,
      });
      mockSupabase.from.mockReturnValue(builder);

      const { data, error } = await listEvents({
        fromDate: '2026-05-13',
        toDate: '2026-05-27',
      });

      expect(error).toBeNull();
      expect(mockSupabase.from).toHaveBeenCalledWith('events');
      // Overlap window — same pattern as listCalendarItems for
      // busy_blocks (.lt('starts_at', toDate) AND
      // .gt('ends_at', fromDate)).
      expect(builder.lt).toHaveBeenCalledWith('starts_at', '2026-05-27');
      expect(builder.gt).toHaveBeenCalledWith('ends_at', '2026-05-13');
      // Joins the owner profile so the UI can render avatars / names
      // without a separate fetch.
      expect(builder.select).toHaveBeenCalledWith(expect.stringMatching(/owner.*profiles/));

      expect(data).toHaveLength(1);
      const item = data?.[0];
      expect(item).toMatchObject({
        kind: 'event',
        id: 'ev1',
        owner: alice,
        title: 'Birthday party',
        notes: 'Bring drinks',
        location: 'My place',
      });
      expect(item?.startsAt).toBeInstanceOf(Date);
      expect(item?.endsAt).toBeInstanceOf(Date);
    });

    it('returns a friendly error on DB failure', async () => {
      mockSupabase.from.mockReturnValue(chainable({ data: null, error: { message: 'boom' } }));
      const { data, error } = await listEvents({
        fromDate: '2026-05-13',
        toDate: '2026-05-27',
      });
      expect(data).toBeNull();
      expect(error).toMatch(/couldn't load/i);
    });

    it('skips rows whose embedded owner join is null (defensive)', async () => {
      const builder = chainable({
        data: [
          {
            id: 'ev1',
            owner_id: 'orphan',
            title: 'Mystery',
            starts_at: '2026-05-20T01:00:00.000Z',
            ends_at: '2026-05-20T04:00:00.000Z',
            owner: null,
          },
        ],
        error: null,
      });
      mockSupabase.from.mockReturnValue(builder);

      const { data, error } = await listEvents({
        fromDate: '2026-05-13',
        toDate: '2026-05-27',
      });
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });
  });
});
