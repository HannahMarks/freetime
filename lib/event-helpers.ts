// Pure helpers + types for events (Phase 2). No React, no Supabase —
// just shape definitions so they're trivially testable and importable
// from anywhere. Network-touching action code lives in
// `event-actions.ts`.

import type { FriendProfile } from './calendar-helpers';
import type { RecurrenceRule } from './recurrence';

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
  /** Non-null when this row is one occurrence of a repeating series.
   * The same rule is carried on every expanded occurrence — only
   * `startsAt` / `endsAt` differ. Optional in the type so existing
   * fixtures don't all need updating; production builders
   * (`listEvents`) always set it explicitly to `null` for one-offs. */
  recurrenceRule?: RecurrenceRule | null;
};

const WEEKDAY_FULL = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

/** Parse a YYYY-MM-DD into a local-midnight Date for formatting. */
function parseIsoDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/**
 * Human-readable summary of a recurrence rule, anchored on the
 * series's base start. Used in EventSheet view-mode to tell the user
 * "this is part of a yearly series" without making them parse JSON.
 *
 * Examples:
 *   - { freq: 'weekly' } + Monday base → "Weekly on Monday"
 *   - { freq: 'monthly' } + May 15 → "Monthly on the 15th"
 *   - { freq: 'yearly' } + May 15 → "Yearly on May 15"
 *   - { freq: 'monthly', until: '2027-05-15' } → "Monthly on the 15th until May 15, 2027"
 *
 * Pure (no React) so it's trivial to unit-test. Locale-aware via
 * `Intl.DateTimeFormat` — month names follow the device locale.
 */
export function summarizeEventRecurrence(
  rule: RecurrenceRule,
  baseStart: Date,
): string {
  let head: string;
  if (rule.freq === 'weekly') {
    head = `Weekly on ${WEEKDAY_FULL[baseStart.getDay()]}`;
  } else if (rule.freq === 'monthly') {
    head = `Monthly on the ${ordinal(baseStart.getDate())}`;
  } else {
    // yearly — include month name + day
    const monthDay = new Intl.DateTimeFormat(undefined, {
      month: 'long',
      day: 'numeric',
    }).format(baseStart);
    head = `Yearly on ${monthDay}`;
  }

  if (rule.until) {
    const untilDate = parseIsoDate(rule.until);
    const formatted = new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(untilDate);
    return `${head} until ${formatted}`;
  }
  return head;
}

/** "1st", "2nd", "3rd", "4th", … */
function ordinal(n: number): string {
  const j = n % 10;
  const k = n % 100;
  if (j === 1 && k !== 11) return `${n}st`;
  if (j === 2 && k !== 12) return `${n}nd`;
  if (j === 3 && k !== 13) return `${n}rd`;
  return `${n}th`;
}
