// Action layer for the `events` + `event_invites` tables — mirrors
// the shape of `availability-actions.ts` (create / update / delete
// + a listing query). RLS enforces ownership; this file just trusts
// the policy + reads `auth.uid()` for the live session.

import type { EventAttendee, EventInviteStatus, EventItem } from './event-helpers';
import { supabase } from './supabase';

export type ActionResult = { error: string | null };

type ProfileRow = {
  id: string;
  display_name: string;
  color: string;
};

type InviteRow = {
  invitee: ProfileRow | null;
  status: EventInviteStatus;
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
  /** PostgREST's array shape for the `invites:event_invites(...)`
   * embedded join. Each row is one (invitee, status) entry. */
  invites: InviteRow[] | null;
};

/** Select clause for `events` rows including the owner profile join
 * AND the embedded `event_invites` array with each invitee's
 * profile. The `invites:event_invites(...)` syntax PostgREST-joins
 * the child table; RLS on `event_invites` ensures the caller only
 * sees rows they're allowed to (host sees all invites on own events;
 * invitee sees their own row). */
const EVENT_SELECT =
  'id, owner_id, title, starts_at, ends_at, notes, location, ' +
  'owner:profiles!events_owner_id_fkey(id, display_name, color), ' +
  'invites:event_invites(status, invitee:profiles(id, display_name, color))';

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
/** v2 (H4): return shape now carries the inserted `id` so the UI can
 * chain a follow-up `inviteFriends` call without re-fetching the
 * events list. `error` semantics unchanged. */
export type CreateEventResult = { id: string | null; error: string | null };

export async function createEvent(args: {
  startsAt: Date;
  endsAt: Date;
  title: string | null;
  notes: string | null;
  location: string | null;
}): Promise<CreateEventResult> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { id: null, error: 'Not signed in.' };

  // `.select('id').single()` instructs PostgREST to return the
  // inserted row's id so the caller can plumb it into the invites
  // step. Otherwise insert returns no body and we'd have to re-fetch.
  const { data, error } = await supabase
    .from('events')
    .insert({
      owner_id: user.id,
      title: args.title,
      starts_at: args.startsAt.toISOString(),
      ends_at: args.endsAt.toISOString(),
      notes: args.notes,
      location: args.location,
    })
    .select('id')
    .single();

  if (error) return { id: null, error: describeError("Couldn't create event", error) };
  return { id: (data as { id: string }).id, error: null };
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
    // Build the attendees array from the embedded invites join. Rows
    // whose invitee profile is null (race against a profile delete)
    // are dropped defensively rather than surfacing as undefined.
    const attendees: EventAttendee[] = [];
    for (const inv of row.invites ?? []) {
      if (!inv.invitee) continue;
      attendees.push({ invitee: inv.invitee, status: inv.status });
    }
    items.push({
      kind: 'event',
      id: row.id,
      owner: row.owner,
      startsAt: new Date(row.starts_at),
      endsAt: new Date(row.ends_at),
      title: row.title,
      notes: row.notes,
      location: row.location,
      attendees,
    });
  }
  return { data: items, error: null };
}

/**
 * Insert one `event_invites` row per id in `inviteeIds` for the given
 * event. The host (caller) is enforced by RLS — the policy only lets
 * `INSERT` succeed if `auth.uid()` owns the parent event. Status
 * defaults to `'pending'` (also enforced by the RLS WITH CHECK).
 *
 * Idempotent semantics: duplicate `(event_id, invitee_id)` pairs are
 * silently dropped by Supabase's `ignoreDuplicates` upsert mode, so
 * re-clicking Save after a partial network failure won't tally
 * "already invited" errors. Self-invite trigger violations still
 * surface as errors (the host UI prevents this from being a normal
 * code path, but we don't want to silently swallow them).
 */
/**
 * Set the calling user's RSVP status on an event they're invited to.
 * RLS enforces `invitee_id = auth.uid()` on UPDATE, so the action
 * can't be used to change someone else's RSVP — but we still do an
 * explicit `.eq('invitee_id', user.id)` so the row-targeting is
 * visible at the call site too.
 *
 * Returns a friendly error string on failure (network blip, RLS
 * mismatch from a stale session, etc).
 */
export async function respondToInvite(args: {
  eventId: string;
  status: EventInviteStatus;
}): Promise<ActionResult> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Not signed in.' };

  const { error } = await supabase
    .from('event_invites')
    .update({ status: args.status })
    .eq('event_id', args.eventId)
    .eq('invitee_id', user.id);

  if (error) return { error: describeError("Couldn't update your RSVP", error) };
  return { error: null };
}

export async function inviteFriends(args: {
  eventId: string;
  inviteeIds: string[];
}): Promise<ActionResult> {
  if (args.inviteeIds.length === 0) return { error: null };
  const rows = args.inviteeIds.map((invitee_id) => ({
    event_id: args.eventId,
    invitee_id,
  }));
  const { error } = await supabase.from('event_invites').upsert(rows, {
    onConflict: 'event_id,invitee_id',
    ignoreDuplicates: true,
  });
  if (error) return { error: describeError("Couldn't send invites", error) };
  return { error: null };
}

/**
 * Delete invites for the given event by invitee ids. Counterpart to
 * `inviteFriends` — used when the host removes someone from an
 * existing event in edit mode. RLS enforces "host of the event OR
 * invitee removing themselves" on DELETE; the host path is what
 * this action targets.
 *
 * No-ops when the id list is empty (skips the round-trip).
 */
export async function uninviteFriends(args: {
  eventId: string;
  inviteeIds: string[];
}): Promise<ActionResult> {
  if (args.inviteeIds.length === 0) return { error: null };
  const { error } = await supabase
    .from('event_invites')
    .delete()
    .eq('event_id', args.eventId)
    .in('invitee_id', args.inviteeIds);
  if (error) return { error: describeError("Couldn't remove invites", error) };
  return { error: null };
}
