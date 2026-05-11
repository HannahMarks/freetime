import {
  createEvent,
  deleteEvent,
  inviteFriends,
  listEvents,
  respondToInvite,
  uninviteFriends,
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
    'in',
    'lt',
    'gt',
    'gte',
    'or',
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
        // Default = one-off (no recurrence). Mirror's the busy_blocks
        // pattern: the column is always written, defaulting to null,
        // so an existing series can be cleared on update.
        recurrence_rule: null,
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

    it('persists a monthly recurrenceRule when provided', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'me-id' } } });
      const builder = chainable({ data: { id: 'ev-rec' }, error: null });
      mockSupabase.from.mockReturnValue(builder);

      await createEvent({
        startsAt: new Date(2026, 4, 15, 18, 0),
        endsAt: new Date(2026, 4, 15, 20, 0),
        title: 'Monthly book club',
        notes: null,
        location: null,
        recurrenceRule: { freq: 'monthly' },
      });

      expect(builder.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          recurrence_rule: { freq: 'monthly' },
        }),
      );
    });

    it('persists a yearly recurrenceRule with an until cap', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'me-id' } } });
      const builder = chainable({ data: { id: 'ev-rec' }, error: null });
      mockSupabase.from.mockReturnValue(builder);

      await createEvent({
        startsAt: new Date(2026, 4, 15, 9, 0),
        endsAt: new Date(2026, 4, 15, 10, 0),
        title: 'Birthday',
        notes: null,
        location: null,
        recurrenceRule: { freq: 'yearly', until: '2030-12-31' },
      });

      expect(builder.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          recurrence_rule: { freq: 'yearly', until: '2030-12-31' },
        }),
      );
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
        // Default-null mirrors createEvent — calling updateEvent without
        // a recurrenceRule clears any existing recurrence rule on the
        // row (intentional: edit mode that doesn't expose recurrence
        // shouldn't accidentally preserve a stale one).
        recurrence_rule: null,
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

    it('persists a recurrenceRule on update', async () => {
      const builder = chainable({ error: null });
      mockSupabase.from.mockReturnValue(builder);

      await updateEvent({
        id: 'ev1',
        startsAt: new Date(2026, 4, 15, 18, 0),
        endsAt: new Date(2026, 4, 15, 20, 0),
        title: 'Monthly book club',
        notes: null,
        location: null,
        recurrenceRule: { freq: 'monthly' },
      });

      expect(builder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          recurrence_rule: { freq: 'monthly' },
        }),
      );
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
      // busy_blocks: starts_at < toDate AND (ends_at > fromDate OR
      // recurrence_rule is non-null). The OR branch lets us pull
      // recurring series whose first occurrence is in the past so
      // we can expand current-window occurrences client-side.
      expect(builder.lt).toHaveBeenCalledWith('starts_at', '2026-05-27');
      expect(builder.or).toHaveBeenCalledWith(
        'ends_at.gt.2026-05-13,recurrence_rule.not.is.null',
      );
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

    it('expands a monthly recurring event into one item per occurrence in the window', async () => {
      const builder = chainable({
        data: [
          {
            id: 'ev-monthly',
            owner_id: alice.id,
            title: 'Book club',
            starts_at: new Date(2026, 4, 15, 18, 0).toISOString(),
            ends_at: new Date(2026, 4, 15, 20, 0).toISOString(),
            notes: null,
            location: null,
            recurrence_rule: { freq: 'monthly' },
            owner: alice,
            invites: [],
          },
        ],
        error: null,
      });
      mockSupabase.from.mockReturnValue(builder);

      const { data, error } = await listEvents({
        fromDate: '2026-05-01',
        toDate: '2026-08-01',
      });
      expect(error).toBeNull();
      // May 15, Jun 15, Jul 15 — three monthly occurrences.
      expect(data).toHaveLength(3);
      expect(data?.map((d) => d.startsAt.getMonth())).toEqual([4, 5, 6]);
      // Every occurrence carries the same series id + the rule.
      for (const item of data ?? []) {
        expect(item.id).toBe('ev-monthly');
        expect(item.recurrenceRule).toEqual({ freq: 'monthly' });
      }
    });

    it('expands a yearly recurring event preserving month + day across years', async () => {
      const builder = chainable({
        data: [
          {
            id: 'ev-birthday',
            owner_id: alice.id,
            title: 'Birthday',
            starts_at: new Date(2026, 4, 15, 18, 0).toISOString(),
            ends_at: new Date(2026, 4, 15, 21, 0).toISOString(),
            notes: null,
            location: null,
            recurrence_rule: { freq: 'yearly' },
            owner: alice,
            invites: [],
          },
        ],
        error: null,
      });
      mockSupabase.from.mockReturnValue(builder);

      const { data } = await listEvents({
        fromDate: '2026-01-01',
        toDate: '2029-01-01',
      });
      expect(data).toHaveLength(3);
      expect(data?.map((d) => d.startsAt.getFullYear())).toEqual([2026, 2027, 2028]);
      // Same month-day on every occurrence.
      for (const item of data ?? []) {
        expect(item.startsAt.getMonth()).toBe(4);
        expect(item.startsAt.getDate()).toBe(15);
      }
    });

    it('returns recurrenceRule: null on one-off events', async () => {
      const builder = chainable({
        data: [
          {
            id: 'ev-oneoff',
            owner_id: alice.id,
            title: 'Party',
            starts_at: new Date(2026, 4, 20, 18, 0).toISOString(),
            ends_at: new Date(2026, 4, 20, 22, 0).toISOString(),
            notes: null,
            location: null,
            recurrence_rule: null,
            owner: alice,
            invites: [],
          },
        ],
        error: null,
      });
      mockSupabase.from.mockReturnValue(builder);

      const { data } = await listEvents({
        fromDate: '2026-05-01',
        toDate: '2026-06-01',
      });
      expect(data).toHaveLength(1);
      expect(data?.[0].recurrenceRule).toBeNull();
    });
  });

  describe('respondToInvite', () => {
    it('updates event_invites for the live user with the requested status', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'me-id' } } });
      const builder = chainable({ error: null });
      mockSupabase.from.mockReturnValue(builder);

      const { error } = await respondToInvite({ eventId: 'ev1', status: 'accepted' });

      expect(error).toBeNull();
      expect(mockSupabase.from).toHaveBeenCalledWith('event_invites');
      expect(builder.update).toHaveBeenCalledWith({ status: 'accepted' });
      expect(builder.eq).toHaveBeenNthCalledWith(1, 'event_id', 'ev1');
      expect(builder.eq).toHaveBeenNthCalledWith(2, 'invitee_id', 'me-id');
    });

    it('returns "not signed in" when there\'s no session', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } });
      const { error } = await respondToInvite({ eventId: 'ev1', status: 'accepted' });
      expect(error).toMatch(/not signed in/i);
      expect(mockSupabase.from).not.toHaveBeenCalled();
    });

    it('returns a friendly error on DB failure', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'me-id' } } });
      mockSupabase.from.mockReturnValue(chainable({ error: { message: 'boom' } }));
      const { error } = await respondToInvite({ eventId: 'ev1', status: 'declined' });
      expect(error).toMatch(/couldn't update your rsvp/i);
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

  describe('uninviteFriends', () => {
    it('deletes event_invites rows for the given event + invitee ids', async () => {
      const builder = chainable({ error: null });
      mockSupabase.from.mockReturnValue(builder);

      const { error } = await uninviteFriends({
        eventId: 'ev1',
        inviteeIds: ['friend-a', 'friend-b'],
      });

      expect(error).toBeNull();
      expect(mockSupabase.from).toHaveBeenCalledWith('event_invites');
      expect(builder.delete).toHaveBeenCalled();
      expect(builder.eq).toHaveBeenCalledWith('event_id', 'ev1');
      expect(builder.in).toHaveBeenCalledWith('invitee_id', ['friend-a', 'friend-b']);
    });

    it('no-ops when the id list is empty', async () => {
      const { error } = await uninviteFriends({ eventId: 'ev1', inviteeIds: [] });
      expect(error).toBeNull();
      expect(mockSupabase.from).not.toHaveBeenCalled();
    });

    it('returns a friendly error on DB failure', async () => {
      mockSupabase.from.mockReturnValue(chainable({ error: { message: 'boom' } }));
      const { error } = await uninviteFriends({
        eventId: 'ev1',
        inviteeIds: ['friend-a'],
      });
      expect(error).toMatch(/couldn't remove invites/i);
    });
  });
});
