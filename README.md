# freetime

A shared social calendar between friends. See your friends' availability at a glance, plan events around it, share photos from those events, and post moments to a feed your friends can react to.

## What it is

- **Shared calendar** — your friends' availability is overlaid on yours, color-coded per friend.
- **Busy-time model** — add named activities ("Lunch with Sarah" 12–1pm) or mark a whole day as not free (also with an optional label, e.g. "Family wedding"). Default state is free; friends can plan with you unless an activity or unavailable-day says otherwise.
- **Events + invites** — create, invite, RSVP. The event surfaces who can make it from each friend's calendar.
- **Per-event photo albums** — only attendees see and contribute.
- **Social feed** — post photos and short videos from events; friends like and comment.

This is a hobby project. Every third-party service used is on its free / hobby tier.

## Stack

- **Frontend:** Expo SDK 54 / React Native, TypeScript, [Expo Router](https://docs.expo.dev/router/) (file-based routing).
- **Backend:** [Supabase](https://supabase.com) — Postgres + Auth + Realtime + Storage.
- **CI:** GitHub Actions — EAS Update on every PR/main push, pgTAP database tests on `supabase/**` changes, jest unit tests on every PR.
- **Testing:** [`jest-expo`](https://docs.expo.dev/develop/unit-testing/) + [`@testing-library/react-native`](https://callstack.github.io/react-native-testing-library/) for component tests, [pgTAP](https://pgtap.org/) for database tests.
- **Distribution:** EAS Update for OTA JS bundles, EAS Build for native binaries (manual).

## Local development

### Prerequisites

- Node.js 20+ (developed on Node 24).
- Docker Desktop — only required for the local database stack (`npm run db:*`). The app itself runs without it.
- A Supabase project (free tier).

### Setup

```bash
# Install deps. --legacy-peer-deps is required while Expo SDK 54 has a
# transitive react-dom@19.2.6 vs react@19.1.0 peer mismatch.
npm install --legacy-peer-deps

# Copy the env template and fill in values from your Supabase project.
cp .env.example .env.local
# Edit .env.local with the Project URL + anon key from
# https://supabase.com/dashboard/project/<your-ref>/settings/api

# Run the app
npm run web        # or `ios` / `android`
```

### Supabase setup (one-time)

1. Create a project at https://supabase.com/dashboard.
2. Paste the **Project URL** and **anon (publishable) key** into `.env.local`.
3. **Disable email confirmation** for now: `Authentication → Sign In / Up → Email → Confirm email = off`. This lets users sign in immediately after signup. Flip it back on later if/when the project gets real users.
4. Link the local CLI to your remote project:
   ```bash
   npx supabase link --project-ref <your-project-ref>
   ```
5. Apply migrations to your remote DB:
   ```bash
   npm run db:push
   ```

### Pulling a PR that adds a migration

If the PR you just pulled added or modified anything under `supabase/migrations/`, **apply migrations to your remote DB before reloading the app:**

```bash
npm run db:push
```

The CLI shows a confirmation prompt and only applies migrations the linked project hasn't seen yet — safe to run on every pull.

If you skip this, the app will hit a `42703 column does not exist` (or `PGRST205 table not found`) error the moment a query touches the new schema. The error surfaces as either a broken calendar or a `console.error` in the dev console depending on how defensively the calling code handles it.

A quick way to know whether the latest pull touched migrations:

```bash
git diff HEAD~1 HEAD --name-only -- supabase/migrations
```

If anything prints, run `npm run db:push`.

### Unit tests

```bash
npm test          # runs the jest suite once
npm run test:watch  # re-runs on file changes
```

CI runs the jest suite on every PR.

### Database tests (requires Docker)

```bash
npm run db:start   # boots local Postgres + GoTrue + PostgREST in Docker
npm run db:test    # runs pgTAP suite — should print "Result: PASS"
npm run db:reset   # wipe and reapply all migrations
npm run db:diff    # generate a new migration from local schema changes
npm run db:stop    # stop and clean up
```

CI runs the same pgTAP suite on every PR that touches `supabase/**`.

## Distribution

- **EAS Update** publishes JS-only OTA updates automatically:
  - Push to `main` → publishes to the `production` EAS Update branch.
  - PR opened/synced → publishes to the `preview` EAS Update branch.
- **EAS Build** for native binaries — currently manual. Run `npx eas-cli build --profile preview` (or `production`) when native deps change.

Required GitHub secret: `EXPO_TOKEN` (generate at https://expo.dev/settings/access-tokens).

## Roadmap

Status: ✅ shipped · 🚧 in progress · ⏳ planned

### Phase 1 — auth + friends + shared calendar (MVP)

- ✅ Initial Expo TypeScript scaffold ([#1](https://github.com/HannahMarks/freetime/pull/1))
- ✅ EAS Update GitHub Actions workflow ([#2](https://github.com/HannahMarks/freetime/pull/2))
- ✅ Foundation — Expo Router, Supabase client, auth-gated nav skeleton ([#3](https://github.com/HannahMarks/freetime/pull/3))
- ✅ CLAUDE.md guidance ([#4](https://github.com/HannahMarks/freetime/pull/4))
- ✅ Schema for profiles + friendships, with pgTAP test harness ([#5](https://github.com/HannahMarks/freetime/pull/5))
- ✅ Unit test infrastructure — jest-expo + @testing-library/react-native, CI workflow ([#7](https://github.com/HannahMarks/freetime/pull/7))
- ✅ Auth flow — email sign up / sign in / sign out, profile creation with display name + hex color picker ([#8](https://github.com/HannahMarks/freetime/pull/8))
- ✅ Friends — list, search by name, send / accept / decline / cancel / remove ([#9](https://github.com/HannahMarks/freetime/pull/9))
- ✅ Schema for `busy_blocks` (named time-ranged activities) + `unavailable_days` (whole-day floating-date markers) + `is_friend_of()` RLS helper ([#11](https://github.com/HannahMarks/freetime/pull/11))
- ✅ Calendar view — month grid with friend-colored dots + per-day 24-hour timeline + collapsible month grid ([#17](https://github.com/HannahMarks/freetime/pull/17), [#18](https://github.com/HannahMarks/freetime/pull/18))
- ✅ Availability editing — FAB-launched add sheet, scroll-wheel time pickers, tap-to-edit / tap-to-delete on your own items, FAB tinted with profile color ([#19](https://github.com/HannahMarks/freetime/pull/19), [#20](https://github.com/HannahMarks/freetime/pull/20), [#21](https://github.com/HannahMarks/freetime/pull/21))
- ✅ Multi-day busy_blocks — date pickers in the add sheet, per-day timeline clipping, overlap query so cross-month blocks still appear ([#22](https://github.com/HannahMarks/freetime/pull/22))
- ✅ Tap-to-view + pencil-to-edit + full-page sheet — tapping your own item opens the sheet in view mode (read-only details); a pencil button switches to the edit form, and a three-dots popover offers Copy / Delete ([#23](https://github.com/HannahMarks/freetime/pull/23))
- ✅ Notes + location — `notes` + `location` columns on `busy_blocks`, `notes` on `unavailable_days`; multi-line Notes input + single-line Location input in the sheet ([#24](https://github.com/HannahMarks/freetime/pull/24))
- ✅ Drag-to-reschedule — long-press a busy_block on the day timeline and pan to a new time; release commits via `updateBusyBlock`, snapping to 15-min increments and preserving duration ([#25](https://github.com/HannahMarks/freetime/pull/25))
- 🚧 Swipe-to-dismiss month grid — drag the month grid upward past a threshold to hide it; chevron still toggles it back (#26)
- 🚧 Recurring availability (v1 — v8) — `recurrence_rule` JSONB on both `busy_blocks` and `unavailable_days`, with `expandOccurrences()` walking each series at +7d intervals (DST-safe via `setDate`); `listCalendarItems` returns one CalendarItem per occurrence in the requested window. Rule shape: `{freq:'weekly', byDay?: number[], until?: 'YYYY-MM-DD'}`. AddItemSheet (busy + unavailable modes) has a "Repeat weekly" toggle, 7 day-of-week chips that auto-seed the base's weekday, and an "Ends on a date" sub-toggle. View mode summarises as "Weekly on Mon, Wed, Fri until Dec 31, 2026". v4–v6 add per-occurrence skip exceptions via `busy_block_exceptions` and `unavailable_day_exceptions` tables (action='skip'|'move'); the three-dots popover splits into "Delete this occurrence" + "Delete entire series" for recurring items. v5 adds drag-to-move-just-this-one for busy_blocks via `move` exceptions; `CalendarItem.originalStart` carries the pre-move timestamp. v7 adds **edit-just-this-one**: exception tables carry override metadata columns (title/notes/location), and editing a recurring occurrence prompts via Alert ("Save changes to → This event only / Entire series / Cancel"). v8 surfaces a DatePicker in the unavailable_day edit form when editing a recurring occurrence, so the user can move just-this-one to a different date through the sheet (writes a `move` exception with `new_date` set); date picker is hidden for one-offs and for busy_blocks (which use their own time-picker date controls)

### Phase 2 — events + invites

- 🚧 Events foundation (H1) — `events` table + RLS (visibility = owner + accepted friends, owner-only mutations) + `EventItem` type + `createEvent` / `listEvents` / `updateEvent` / `deleteEvent` actions. No UI yet — that ships in H2. Visibility extends to "or invited" once `event_invites` lands in H3
- 🚧 Create event flow (H2) — Events tab with a chronological list of upcoming events (out to 6 months) + a profile-color FAB that opens an `EventSheet` (create / view / pencil-to-edit / trash-to-delete; same animation + swipe-down posture as `AddItemSheet`, no recurrence or kind-toggle). Tab icon is a manual-drawn 4-point spark
- 🚧 `event_invites` schema (H3) — composite PK `(event_id, invitee_id)`, `event_invite_status` enum (pending/accepted/declined/maybe), RLS (host can insert + see-all-on-their-event, invitee can update own status, either party can delete). `events.SELECT` policy extended to include rows the user is invited to. Trigger blocks self-invites
- 🚧 Invite picker on the create flow (H4) — `EventSheet` create mode renders a chip-row of accepted friends (multi-select, friend-color border + selection tint); on Save, `createEvent` returns the new id and the sheet chains `inviteFriends({eventId, inviteeIds})`. `listEvents` joins `event_invites` + invitee profiles so each `EventItem.attendees` is populated. View mode renders an "Invited" row listing names + non-pending status suffixes. Edit-mode add/remove deferred to H5
- ✅ Invitee RSVP (H5a) — `respondToInvite({eventId, status})` action. `EventSheet` accepts `currentUserId` and routes the view: host (owner === current user) sees pencil + trash; invitee (not host, has an attendee row) sees three pills — Going / Can't go / Maybe — with the current RSVP filled. Tap a pill → action call → close + parent refetch ([#62](https://github.com/HannahMarks/freetime/pull/62))
- ✅ Host add/remove invitees on existing events (H5b) — invite picker now renders in EDIT mode too. Sheet seeds the selected-chip set from `editing.attendees` on open, then diffs against that snapshot at save time: newly-checked → `inviteFriends`, newly-unchecked → new `uninviteFriends` action (deletes by `(event_id, invitee_id IN [...])`) ([#63](https://github.com/HannahMarks/freetime/pull/63))
- ✅ Calendar-tab events entry point (H5c-pre) — calendar FAB becomes a multi-action stack: tap the primary (user-color) FAB → two smaller outlined sub-FABs appear above it (Busy + Event). Busy opens the existing `AddItemSheet`; Event opens the `EventSheet` in create mode. The Event sub-FAB outline + the event-day dots on the month grid both render in `darkenHexColor(profile.color, 0.35)` — same hex via a shared helper so the FAB and the on-calendar accent are guaranteed to match. New `FabMultiAction` component, `darkenHexColor` helper, `computeEventMarkings` + `mergeMarkings` calendar helpers. Day-timeline event rendering deferred to H5c ([#64](https://github.com/HannahMarks/freetime/pull/64))
- ✅ Monthly + yearly event recurrence — `RecurrenceRule.freq` widens to `'weekly' \| 'monthly' \| 'yearly'`. `expandOccurrences` gains monthly + yearly branches that walk +1 month / +1 year preserving wall-clock + day-of-month (with month-end clamping for Jan 31 → Feb, Feb 29 → Feb 28 in non-leap years). New `events.recurrence_rule` JSONB column (mirrors busy_blocks) + pgTAP. `createEvent` / `updateEvent` thread `recurrenceRule` through; `listEvents` expands recurring rows into one EventItem per occurrence. EventSheet form gains a Repeats toggle, Weekly/Monthly/Yearly chip-row, and an Ends-on-a-date sub-toggle with a date picker. View-mode shows a "Repeats" line summarising the rule (e.g. "Monthly on the 15th until May 15, 2027"). busy_blocks + unavailable_days stay weekly-only at the schema level for now ([#65](https://github.com/HannahMarks/freetime/pull/65))
- ✅ Re-point `events.owner_id` FK from `auth.users` → `profiles` so PostgREST can satisfy the `owner:profiles!events_owner_id_fkey(...)` embed (cascade chain preserved via `auth.users → profiles → events`) ([#66](https://github.com/HannahMarks/freetime/pull/66))
- ✅ Break RLS recursion between `events.SELECT` and `event_invites.*` policies via two SECURITY DEFINER helpers (`is_owner_of_event`, `is_invited_to`) — parallel to `is_friend_of`. Bug was latent since H3 (#60), masked by the FK bug, surfaced once the embed could run ([#67](https://github.com/HannahMarks/freetime/pull/67))
- 🚧 Accepted-events overlay on the day timeline (H5c) — `DayTimeline` gains `events?: EventItem[]` + `eventColor: string` props and renders each event as an inline time block in the same darker user color used by the FAB outline + month-grid dot. Multi-day events clip to the day window like busy_blocks; tapping a block opens the `EventSheet` in view mode (host gets pencil + trash; invitee gets RSVP pills). `SwipeableDayCarousel` threads `events` / `eventColor` / `onEventPress` through to each pane; calendar tab wires `editingEvent` state so create-mode (FAB) and view-mode (tap) flows share the same sheet

### Phase 3 — per-event photo albums

- ⏳ Schema: `event_media` + Supabase Storage bucket policies (attendees only)
- ⏳ Upload UI (image + short video) and album viewer

### Phase 4 — social feed + reactions

- ⏳ Schema: `posts`, `comments`, `likes`
- ⏳ Feed query + UI
- ⏳ Comment + like interactions; notifications for the post author

## Project conventions

See [CLAUDE.md](./CLAUDE.md) for the working rules: TDD red-green discipline, errors surface as toasts, hobby-tier-only third-party deps, and the README is kept current on every PR.

