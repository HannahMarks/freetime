// Pure helpers + types for events (Phase 2). No React, no Supabase —
// just shape definitions so they're trivially testable and importable
// from anywhere. Network-touching action code lives in
// `event-actions.ts`.

import type { FriendProfile } from './calendar-helpers';

/** v3 of the events shape (H4): rsvp/status enum mirrors the
 * `event_invite_status` Postgres enum from migration #60. */
export type EventInviteStatus = 'pending' | 'accepted' | 'declined' | 'maybe';

/** One attendee row attached to an `EventItem.attendees` list — the
 * invitee's profile + their current RSVP. The host themselves are NOT
 * surfaced as an attendee (they implicitly attend their own event;
 * the no-self-invite trigger on `event_invites` prevents the DB from
 * holding such a row anyway). */
export type EventAttendee = {
  invitee: FriendProfile;
  status: EventInviteStatus;
};

/**
 * An event — a host-organized gathering with a time, a place, an
 * optional title/notes, and (since H4) an optional list of invited
 * friends with RSVPs.
 *
 * Mirrors `BusyBlockItem`'s shape for the host-side fields. `owner`
 * is the host's profile (joined in via the `event-actions.ts` query),
 * not an arbitrary user.
 *
 * `attendees` is optional in the type so existing test fixtures and
 * any code path that doesn't need RSVPs can omit it. Production
 * builders (`listEvents`) always populate it (empty array when there
 * are no invites yet).
 */
export type EventItem = {
  kind: 'event';
  id: string;
  owner: FriendProfile;
  startsAt: Date;
  endsAt: Date;
  title: string | null;
  notes: string | null;
  location: string | null;
  attendees?: EventAttendee[];
};
