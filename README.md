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
- 🚧 Schema for `busy_blocks` (named time-ranged activities) + `unavailable_days` (whole-day floating-date markers) + `is_friend_of()` RLS helper
- ✅ Calendar view — read-only 30-day agenda of your busy time + friends' (colored by friend) ([#15](https://github.com/HannahMarks/freetime/pull/15))
- ⏳ Availability editing — add / edit / delete your own time blocks

### Phase 2 — events + invites

- ⏳ Schema: `events`, `event_invites`
- ⏳ Create event flow + invite picker
- ⏳ RSVP UI; surfaces who can make it from each invited friend's availability

### Phase 3 — per-event photo albums

- ⏳ Schema: `event_media` + Supabase Storage bucket policies (attendees only)
- ⏳ Upload UI (image + short video) and album viewer

### Phase 4 — social feed + reactions

- ⏳ Schema: `posts`, `comments`, `likes`
- ⏳ Feed query + UI
- ⏳ Comment + like interactions; notifications for the post author

## Project conventions

See [CLAUDE.md](./CLAUDE.md) for the working rules: TDD red-green discipline, errors surface as toasts, hobby-tier-only third-party deps, and the README is kept current on every PR.

