// Pure helpers + types for events (Phase 2). No React, no Supabase —
// just shape definitions so they're trivially testable and importable
// from anywhere. Network-touching action code lives in
// `event-actions.ts`.

import type { FriendProfile } from './calendar-helpers';

/**
 * An event — a host-organized gathering with a time, a place, an
 * optional title/notes, and (in a follow-up PR) a list of invited
 * friends with RSVPs.
 *
 * Mirrors `BusyBlockItem`'s shape for the host-side fields. `owner`
 * is the host's profile (joined in via the `event-actions.ts` query),
 * not an arbitrary user.
 *
 * The `attendees` field is intentionally absent in this initial
 * Phase-2 PR — it'll be added when `event_invites` lands. Until then,
 * an EventItem is just "host's plan for a future activity I might
 * invite people to."
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
};
