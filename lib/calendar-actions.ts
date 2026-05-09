import { CalendarItem } from './calendar-helpers';
import { supabase } from './supabase';

type ProfileRow = {
  id: string;
  display_name: string;
  color: string;
};

type BusyBlockRow = {
  id: string;
  user_id: string;
  title: string | null;
  starts_at: string;
  ends_at: string;
  notes: string | null;
  location: string | null;
  user: ProfileRow | null;
};

type UnavailableDayRow = {
  user_id: string;
  date: string;
  title: string | null;
  notes: string | null;
  user: ProfileRow | null;
};

const BUSY_SELECT =
  'id, user_id, title, starts_at, ends_at, notes, location, user:profiles(id, display_name, color)';
const UNAVAIL_SELECT =
  'user_id, date, title, notes, user:profiles(id, display_name, color)';

function describeError(err: unknown): string {
  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.error('[calendar]', err);
  }
  return "Couldn't load your schedule. Please try again.";
}

/**
 * Fetch all calendar items (busy_blocks + unavailable_days) for self
 * and accepted friends that overlap `[fromDate, toDate)`.
 *
 * RLS filters the friend graph automatically — we get the union of own
 * rows and rows owned by users with an accepted friendship to the
 * caller, no client-side joining needed.
 *
 * Multi-day blocks: a block belongs to the window when it starts before
 * `toDate` AND ends after `fromDate`. This catches blocks that started
 * before `fromDate` but extend into the range.
 *
 * Date strings are YYYY-MM-DD and Postgres casts them to timestamptz
 * at UTC midnight when comparing against `busy_blocks.starts_at`. For
 * users in non-UTC zones this means the day-boundary cut-off can be
 * off by a few hours; acceptable for MVP, fix later by passing
 * timestamptz values that account for the user's zone.
 */
export async function listCalendarItems(args: {
  fromDate: string;
  toDate: string;
}): Promise<{ data: CalendarItem[] | null; error: string | null }> {
  const [busyResult, daysResult] = await Promise.all([
    supabase
      .from('busy_blocks')
      .select(BUSY_SELECT)
      .lt('starts_at', args.toDate)
      .gt('ends_at', args.fromDate),
    supabase
      .from('unavailable_days')
      .select(UNAVAIL_SELECT)
      .gte('date', args.fromDate)
      .lt('date', args.toDate),
  ]);

  if (busyResult.error) return { data: null, error: describeError(busyResult.error) };
  if (daysResult.error) return { data: null, error: describeError(daysResult.error) };

  const items: CalendarItem[] = [];

  for (const row of (busyResult.data ?? []) as unknown as BusyBlockRow[]) {
    if (!row.user) continue; // defensive — embedded join failed
    items.push({
      kind: 'busy_block',
      id: row.id,
      user: row.user,
      startsAt: new Date(row.starts_at),
      endsAt: new Date(row.ends_at),
      title: row.title,
      notes: row.notes,
      location: row.location,
    });
  }

  for (const row of (daysResult.data ?? []) as unknown as UnavailableDayRow[]) {
    if (!row.user) continue;
    items.push({
      kind: 'unavailable_day',
      user: row.user,
      date: row.date,
      title: row.title,
      notes: row.notes,
    });
  }

  return { data: items, error: null };
}
