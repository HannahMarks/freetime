import {
  createBusyBlock,
  createUnavailableDay,
  deleteBusyBlock,
  deleteUnavailableDay,
  updateBusyBlock,
  updateUnavailableDay,
} from '../lib/availability-actions';
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
  for (const name of ['select', 'insert', 'update', 'delete', 'eq']) {
    builder[name] = jest.fn().mockReturnValue(builder);
  }
  (builder as { then: unknown }).then = (onFulfilled: unknown, onRejected: unknown) =>
    terminal.then(onFulfilled as (v: unknown) => unknown, onRejected as (r: unknown) => unknown);
  return builder;
}

describe('availability-actions', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  describe('createBusyBlock', () => {
    it('inserts with the live user id, ISO timestamp values, notes, and location', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'me-id' } } });
      const builder = chainable({ error: null });
      mockSupabase.from.mockReturnValue(builder);

      const startsAt = new Date(2026, 4, 13, 12, 0);
      const endsAt = new Date(2026, 4, 13, 13, 0);
      const { error } = await createBusyBlock({
        startsAt,
        endsAt,
        title: 'Lunch',
        notes: 'Finalize Q3 plan',
        location: 'Cafe Borrone',
      });

      expect(error).toBeNull();
      expect(mockSupabase.from).toHaveBeenCalledWith('busy_blocks');
      expect(builder.insert).toHaveBeenCalledWith({
        user_id: 'me-id',
        title: 'Lunch',
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        notes: 'Finalize Q3 plan',
        location: 'Cafe Borrone',
        recurrence_rule: null,
      });
    });

    it('persists null notes + location when not provided', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'me-id' } } });
      const builder = chainable({ error: null });
      mockSupabase.from.mockReturnValue(builder);

      const startsAt = new Date();
      const endsAt = new Date();
      await createBusyBlock({ startsAt, endsAt, title: null, notes: null, location: null });

      expect(builder.insert).toHaveBeenCalledWith(
        expect.objectContaining({ notes: null, location: null }),
      );
    });

    it('persists recurrence_rule when provided', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'me-id' } } });
      const builder = chainable({ error: null });
      mockSupabase.from.mockReturnValue(builder);

      await createBusyBlock({
        startsAt: new Date(2026, 4, 11, 14, 0),
        endsAt: new Date(2026, 4, 11, 15, 0),
        title: 'Yoga',
        notes: null,
        location: null,
        recurrenceRule: { freq: 'weekly' },
      });

      expect(builder.insert).toHaveBeenCalledWith(
        expect.objectContaining({ recurrence_rule: { freq: 'weekly' } }),
      );
    });

    it('persists recurrence_rule as null when omitted (one-off block)', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'me-id' } } });
      const builder = chainable({ error: null });
      mockSupabase.from.mockReturnValue(builder);

      await createBusyBlock({
        startsAt: new Date(2026, 4, 11, 14, 0),
        endsAt: new Date(2026, 4, 11, 15, 0),
        title: null,
        notes: null,
        location: null,
      });

      expect(builder.insert).toHaveBeenCalledWith(
        expect.objectContaining({ recurrence_rule: null }),
      );
    });

    it('returns "not signed in" when no session is present', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } });
      const { error } = await createBusyBlock({
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
      const { error } = await createBusyBlock({
        startsAt: new Date(),
        endsAt: new Date(),
        title: null,
        notes: null,
        location: null,
      });
      expect(error).toMatch(/couldn't add/i);
    });
  });

  describe('createUnavailableDay', () => {
    it('inserts the row with user id, date, title, and notes', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'me-id' } } });
      const builder = chainable({ error: null });
      mockSupabase.from.mockReturnValue(builder);

      const { error } = await createUnavailableDay({
        date: '2026-05-13',
        title: 'PTO',
        notes: 'Out of state for the long weekend',
      });

      expect(error).toBeNull();
      expect(mockSupabase.from).toHaveBeenCalledWith('unavailable_days');
      expect(builder.insert).toHaveBeenCalledWith({
        user_id: 'me-id',
        date: '2026-05-13',
        title: 'PTO',
        notes: 'Out of state for the long weekend',
        recurrence_rule: null,
      });
    });

    it('persists null notes when not provided', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'me-id' } } });
      const builder = chainable({ error: null });
      mockSupabase.from.mockReturnValue(builder);

      await createUnavailableDay({ date: '2026-05-13', title: null, notes: null });

      expect(builder.insert).toHaveBeenCalledWith(expect.objectContaining({ notes: null }));
    });

    it('translates duplicate-pair (23505) to a friendly message', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'me-id' } } });
      mockSupabase.from.mockReturnValue(
        chainable({ error: { code: '23505', message: 'unique violation' } }),
      );
      const { error } = await createUnavailableDay({
        date: '2026-05-13',
        title: null,
        notes: null,
      });
      expect(error).toMatch(/already marked/i);
    });

    it('returns "not signed in" when no session', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } });
      const { error } = await createUnavailableDay({
        date: '2026-05-13',
        title: null,
        notes: null,
      });
      expect(error).toMatch(/not signed in/i);
    });
  });

  describe('updateBusyBlock', () => {
    it('updates title, ISO timestamps, notes, and location by id', async () => {
      const builder = chainable({ error: null });
      mockSupabase.from.mockReturnValue(builder);

      const startsAt = new Date(2026, 4, 13, 12, 0);
      const endsAt = new Date(2026, 4, 13, 13, 0);
      const { error } = await updateBusyBlock({
        id: 'bb1',
        startsAt,
        endsAt,
        title: 'Renamed lunch',
        notes: 'Bring the sales deck',
        location: 'Conference Room B',
      });

      expect(error).toBeNull();
      expect(mockSupabase.from).toHaveBeenCalledWith('busy_blocks');
      expect(builder.update).toHaveBeenCalledWith({
        title: 'Renamed lunch',
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        notes: 'Bring the sales deck',
        location: 'Conference Room B',
        recurrence_rule: null,
      });
      expect(builder.eq).toHaveBeenCalledWith('id', 'bb1');
    });

    it('writes recurrence_rule when provided (turns a one-off into a series, or vice versa)', async () => {
      const builder = chainable({ error: null });
      mockSupabase.from.mockReturnValue(builder);

      await updateBusyBlock({
        id: 'bb1',
        startsAt: new Date(2026, 4, 11, 14, 0),
        endsAt: new Date(2026, 4, 11, 15, 0),
        title: 'Yoga',
        notes: null,
        location: null,
        recurrenceRule: { freq: 'weekly' },
      });

      expect(builder.update).toHaveBeenCalledWith(
        expect.objectContaining({ recurrence_rule: { freq: 'weekly' } }),
      );
    });

    it('translates DB errors', async () => {
      mockSupabase.from.mockReturnValue(chainable({ error: { message: 'boom' } }));
      const { error } = await updateBusyBlock({
        id: 'bb1',
        startsAt: new Date(),
        endsAt: new Date(),
        title: null,
        notes: null,
        location: null,
      });
      expect(error).toMatch(/couldn't update activity/i);
    });
  });

  describe('updateUnavailableDay', () => {
    it('updates the title and notes for a (user_id, date) pair', async () => {
      const builder = chainable({ error: null });
      mockSupabase.from.mockReturnValue(builder);

      const { error } = await updateUnavailableDay({
        userId: 'me-id',
        date: '2026-05-13',
        title: 'Renamed PTO',
        notes: 'Hawaii through Sunday',
      });

      expect(error).toBeNull();
      expect(mockSupabase.from).toHaveBeenCalledWith('unavailable_days');
      expect(builder.update).toHaveBeenCalledWith({
        title: 'Renamed PTO',
        notes: 'Hawaii through Sunday',
        recurrence_rule: null,
      });
      expect(builder.eq).toHaveBeenNthCalledWith(1, 'user_id', 'me-id');
      expect(builder.eq).toHaveBeenNthCalledWith(2, 'date', '2026-05-13');
    });

    it('writes recurrence_rule when provided (turns a one-off into a series, or rewrites the rule)', async () => {
      const builder = chainable({ error: null });
      mockSupabase.from.mockReturnValue(builder);

      await updateUnavailableDay({
        userId: 'me-id',
        date: '2026-05-13',
        title: null,
        notes: null,
        recurrenceRule: { freq: 'weekly', byDay: [3] },
      });

      expect(builder.update).toHaveBeenCalledWith(
        expect.objectContaining({ recurrence_rule: { freq: 'weekly', byDay: [3] } }),
      );
    });
  });

  describe('createUnavailableDay (recurrence)', () => {
    it('persists recurrence_rule when provided', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'me-id' } } });
      const builder = chainable({ error: null });
      mockSupabase.from.mockReturnValue(builder);

      await createUnavailableDay({
        date: '2026-05-13',
        title: null,
        notes: null,
        recurrenceRule: { freq: 'weekly', byDay: [3] },
      });

      expect(builder.insert).toHaveBeenCalledWith(
        expect.objectContaining({ recurrence_rule: { freq: 'weekly', byDay: [3] } }),
      );
    });

    it('persists recurrence_rule = null when omitted', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'me-id' } } });
      const builder = chainable({ error: null });
      mockSupabase.from.mockReturnValue(builder);

      await createUnavailableDay({ date: '2026-05-13', title: null, notes: null });

      expect(builder.insert).toHaveBeenCalledWith(
        expect.objectContaining({ recurrence_rule: null }),
      );
    });
  });

  describe('deleteBusyBlock', () => {
    it('deletes by id', async () => {
      const builder = chainable({ error: null });
      mockSupabase.from.mockReturnValue(builder);

      const { error } = await deleteBusyBlock('bb1');
      expect(error).toBeNull();
      expect(mockSupabase.from).toHaveBeenCalledWith('busy_blocks');
      expect(builder.delete).toHaveBeenCalled();
      expect(builder.eq).toHaveBeenCalledWith('id', 'bb1');
    });

    it('translates DB errors', async () => {
      mockSupabase.from.mockReturnValue(chainable({ error: { message: 'boom' } }));
      const { error } = await deleteBusyBlock('bb1');
      expect(error).toMatch(/couldn't delete activity/i);
    });
  });

  describe('deleteUnavailableDay', () => {
    it('deletes by composite (user_id, date)', async () => {
      const builder = chainable({ error: null });
      mockSupabase.from.mockReturnValue(builder);

      const { error } = await deleteUnavailableDay({ userId: 'me-id', date: '2026-05-13' });
      expect(error).toBeNull();
      expect(mockSupabase.from).toHaveBeenCalledWith('unavailable_days');
      expect(builder.delete).toHaveBeenCalled();
      expect(builder.eq).toHaveBeenNthCalledWith(1, 'user_id', 'me-id');
      expect(builder.eq).toHaveBeenNthCalledWith(2, 'date', '2026-05-13');
    });
  });
});
