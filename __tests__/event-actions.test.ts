import {
  createEvent,
  deleteEvent,
  inviteFriends,
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

/** Builder that returns itself on every chained method, then resolves
 * to `resolved` when awaited. `single` and `then` need to be the
 * actual terminal — `single` is what `.insert(...).select().single()`
 * awaits, so it gets a non-builder `then` underneath. */
function chainable(resolved: unknown) {
  const builder: Record<string, jest.Mock> = {};
  const terminal = Promise.resolve(resolved);
  for (const name of [
    'select',
    'insert',
    'update',
    'upsert',
    'delete',
    'eq',
    'lt',
    'gt',
    'gte',
  ]) {
    builder[name] = jest.fn().mockReturnValue(builder);
  }
  // `.single()` is awaited directly; it returns a value-bearing
  // thenable rather than chaining further.
  builder.single = jest.fn().mockReturnValue({
    then: (onFulfilled: unknown) =>
      terminal.then(onFulfilled as (v: unknown) => unknown),
  });
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
    it('inserts with the live user id, ISO timestamps, and trimmed metadata; returns the inserted id', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'me-id' } } });
      const builder = chainable({ data: { id: 'ev-new' }, error: null });
      mockSupabase.from.mockReturnValue(builder);

      const startsAt = new Date(2026, 4, 20, 18, 0);
      const endsAt = new Date(2026, 4, 20, 21, 0);
      const { id, error } = await createEvent({
        startsAt,
        endsAt,
        title: 'Birthday party',
        notes: 'Bring drinks',
        location: 'My place',
      });

      expect(error).toBeNull();
      expect(id).toBe('ev-new');
      expect(mockSupabase.from).toHaveBeenCalledWith('events');
      expect(builder.insert).toHaveBeenCalledWith({
        owner_id: 'me-id',
        title: 'Birthday party',
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        notes: 'Bring drinks',
        location: 'My place',
      });
      // `.select('id').single()` is the new shape so the caller can
      // chain an inviteFriends call without re-fetching.
      expect(builder.select).toHaveBeenCalledWith('id');
      expect(builder.single).toHaveBeenCalled();
    });

    it('persists null metadata when fields are not provided', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'me-id' } } });
      const builder = chainable({ data: { id: 'ev-new' }, error: null });
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

    it('returns "not signed in" with id=null when no session is present', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } });
      const { id, error } = await createEvent({
        startsAt: new Date(),
        endsAt: new Date(),
        title: null,
        notes: null,
        location: null,
      });
      expect(error).toMatch(/not signed in/i);
      expect(id).toBeNull();
      expect(mockSupabase.from).not.toHaveBeenCalled();
    });

    it('returns a friendly error with id=null on DB failure', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'me-id' } } });
      mockSupabase.from.mockReturnValue(chainable({ data: null, error: { message: 'boom' } }));
      const { id, error } = await createEvent({
        startsAt: new Date(),
        endsAt: new Date(),
        title: null,
        notes: null,
        location: null,
      });
      expect(error).toMatch(/couldn't (?:add|create)/i);
      expect(id).toBeNull();
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
    it('queries events overlapping the requested window and shapes them into EventItem[] with attendees', async () => {
      const bob = { id: 'b', display_name: 'Bob', color: '#4ECDC4' };
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
            // H4: embedded event_invites join, populates EventItem.attendees.
            invites: [
              { status: 'pending', invitee: bob },
              { status: 'accepted', invitee: { id: 'c', display_name: 'Cara', color: '#FFE66D' } },
            ],
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
      // busy_blocks (.lt('starts_at', toDate) AND .gt('ends_at', fromDate)).
      expect(builder.lt).toHaveBeenCalledWith('starts_at', '2026-05-27');
      expect(builder.gt).toHaveBeenCalledWith('ends_at', '2026-05-13');
      // Select clause joins the owner profile AND the event_invites
      // child rows (with each invitee's profile).
      expect(builder.select).toHaveBeenCalledWith(expect.stringMatching(/owner.*profiles/));
      expect(builder.select).toHaveBeenCalledWith(expect.stringMatching(/invites.*event_invites/));

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
      // Attendees populated from the embedded `invites` array.
      expect(item?.attendees).toHaveLength(2);
      expect(item?.attendees?.[0]).toEqual({ invitee: bob, status: 'pending' });
      expect(item?.attendees?.[1].status).toBe('accepted');
    });

    it('falls back to an empty attendees array when the event has no invites', async () => {
      const builder = chainable({
        data: [
          {
            id: 'ev1',
            owner_id: alice.id,
            title: 'Solo event',
            starts_at: '2026-05-20T01:00:00.000Z',
            ends_at: '2026-05-20T04:00:00.000Z',
            notes: null,
            location: null,
            owner: alice,
            invites: [],
          },
        ],
        error: null,
      });
      mockSupabase.from.mockReturnValue(builder);

      const { data } = await listEvents({
        fromDate: '2026-05-13',
        toDate: '2026-05-27',
      });
      expect(data?.[0].attendees).toEqual([]);
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

  describe('inviteFriends', () => {
    it('upserts one event_invites row per invitee with ignoreDuplicates so re-clicks are idempotent', async () => {
      const builder = chainable({ error: null });
      mockSupabase.from.mockReturnValue(builder);

      const { error } = await inviteFriends({
        eventId: 'ev1',
        inviteeIds: ['friend-a', 'friend-b', 'friend-c'],
      });

      expect(error).toBeNull();
      expect(mockSupabase.from).toHaveBeenCalledWith('event_invites');
      expect(builder.upsert).toHaveBeenCalledWith(
        [
          { event_id: 'ev1', invitee_id: 'friend-a' },
          { event_id: 'ev1', invitee_id: 'friend-b' },
          { event_id: 'ev1', invitee_id: 'friend-c' },
        ],
        { onConflict: 'event_id,invitee_id', ignoreDuplicates: true },
      );
    });

    it('no-ops (no DB call) when the invitee list is empty', async () => {
      const { error } = await inviteFriends({ eventId: 'ev1', inviteeIds: [] });
      expect(error).toBeNull();
      expect(mockSupabase.from).not.toHaveBeenCalled();
    });

    it('returns a friendly error on DB failure', async () => {
      mockSupabase.from.mockReturnValue(chainable({ error: { message: 'boom' } }));
      const { error } = await inviteFriends({
        eventId: 'ev1',
        inviteeIds: ['friend-a'],
      });
      expect(error).toMatch(/couldn't send invites/i);
    });
  });
});
