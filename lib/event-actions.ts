// Action layer for the `events` table — mirrors the shape of
// `availability-actions.ts` (createBusyBlock / updateBusyBlock /
// deleteBusyBlock + a listing query). RLS enforces ownership; this
// file just trusts the policy + reads `auth.uid()` for the live
// session.

import type { EventItem } from './event-helpers';
import { supabase } from './supabase';

export type ActionResult = { error: string | null };

type ProfileRow = {
  id: string;
  display_name: string;
  color: string;
};

type EventRow = {
  id: string;
  owner_id: string;
  title: string | null;
  starts_at: string;
  ends_at: string;
  notes: string | null;
  location: string | null;
  owner: ProfileRow | null;
};

/** Select clause for `events` rows including the owner profile join.
 * Mirrors `BUSY_SELECT` in `calendar-actions.ts` so the UI can render
 * the host's avatar/name without a follow-up fetch. */
const EVENT_SELECT =
  'id, owner_id, title, starts_at, ends_at, notes, location, owner:profiles(id, display_name, color)';

function describeError(prefix: string, err: unknown): string {
  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.error(`[events] ${prefix}:`, err);
  }
  return `${prefix}. Please try again.`;
}

/**
 * Insert an event owned by the calling user. RLS pins `owner_id =
 * auth.uid()` so we read the user from the live session instead of
 * trusting a caller-supplied id (same pattern as `createBusyBlock`).
 */
export async function createEvent(args: {
  startsAt: Date;
  endsAt: Date;
  title: string | null;
  notes: string | null;
  location: string | null;
}): Promise<ActionResult> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Not signed in.' };

  const { error } = await supabase.from('events').insert({
    owner_id: user.id,
    title: args.title,
    starts_at: args.startsAt.toISOString(),
    ends_at: args.endsAt.toISOString(),
    notes: args.notes,
    location: args.location,
  });

  if (error) return { error: describeError("Couldn't create event", error) };
  return { error: null };
}

export async function updateEvent(args: {
  id: string;
  startsAt: Date;
  endsAt: Date;
  title: string | null;
  notes: string | null;
  location: string | null;
}): Promise<ActionResult> {
  const { error } = await supabase
    .from('events')
    .update({
      title: args.title,
      starts_at: args.startsAt.toISOString(),
      ends_at: args.endsAt.toISOString(),
      notes: args.notes,
      location: args.location,
    })
    .eq('id', args.id);

  if (error) return { error: describeError("Couldn't update event", error) };
  return { error: null };
}

export async function deleteEvent(id: string): Promise<ActionResult> {
  const { error } = await supabase.from('events').delete().eq('id', id);
  if (error) return { error: describeError("Couldn't delete event", error) };
  return { error: null };
}

/**
 * Fetch events visible to the caller (own + accepted-friends', per
 * RLS) overlapping `[fromDate, toDate)`. Same overlap predicate as
 * `listCalendarItems` for busy_blocks (`starts_at < toDate AND
 * ends_at > fromDate`) so multi-day events show up on each spanned
 * day.
 *
 * Returns one `EventItem` per row. Rows whose embedded owner profile
 * is null are dropped defensively (shouldn't happen given the FK,
 * but the SELECT-via-RLS layer could theoretically race a profile
 * delete).
 */
export async function listEvents(args: {
  fromDate: string;
  toDate: string;
}): Promise<{ data: EventItem[] | null; error: string | null }> {
  const result = await supabase
    .from('events')
    .select(EVENT_SELECT)
    .lt('starts_at', args.toDate)
    .gt('ends_at', args.fromDate);

  if (result.error) return { data: null, error: describeError("Couldn't load events", result.error) };

  const items: EventItem[] = [];
  for (const row of (result.data ?? []) as unknown as EventRow[]) {
    if (!row.owner) continue;
    items.push({
      kind: 'event',
      id: row.id,
      owner: row.owner,
      startsAt: new Date(row.starts_at),
      endsAt: new Date(row.ends_at),
      title: row.title,
      notes: row.notes,
      location: row.location,
    });
  }
  return { data: items, error: null };
}
