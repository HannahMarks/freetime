# CLAUDE.md

Guidance for Claude when working on the freetime app. Keep this short — every line is loaded into every conversation.

## Testing — TDD only

Use red-green-refactor:

1. **Red.** Write the failing test first. Run it, confirm it fails for the right reason.
2. **Green.** Write the minimum code to make it pass.
3. **Refactor.** Tidy up with the test still green.

Don't write production code without a failing test that requires it. If a feature's behavior is hard to test, that's a design signal — restructure so it's testable.

Tooling target (set up in an early PR): `jest-expo` for unit tests, `@testing-library/react-native` for components, MSW or hand-rolled fakes for Supabase calls (don't hit a real DB in unit tests).

## Error handling — surface, don't swallow

Anywhere a Supabase call, network request, or file upload can fail (auth, friend ops, availability writes, photo uploads, anything async with `await`):

1. Catch the error.
2. Log enough to debug (console.error in dev, error reporting later).
3. Show the user a **toast** with a plain-English message. Never show raw error strings or stack traces in the UI.
4. Leave the UI in a recoverable state — the user should be able to retry.

Validate at boundaries (user input, Supabase responses, file inputs). Don't validate trusted internal data — trust the type system.

When introducing the first toast, pick one library and stick with it (likely `burnt` or `react-native-toast-message`). Wire it into a single `useToast()` hook so swapping is cheap later.

## Cost — hobby tier only

This is a hobby project. **Every third-party service, library, or hosted dep suggested must work on the free / hobby tier.** When recommending one, lead with the tier limits.

Known constraints (verify before relying):
- **Supabase free tier:** 500 MB Postgres, 1 GB file storage, 50 K MAUs, 5 GB egress/mo, 2 active projects, projects pause after 1 week of inactivity.
- **EAS free tier:** 30 priority builds/mo across iOS+Android; EAS Update is generous and unlikely to be a constraint at this scale.
- **GitHub Actions free tier (public repo):** unlimited minutes; cap CI cost at zero by keeping runs fast and not adding paid runners.

Design data model and asset storage to comfortably fit under those limits — e.g., compress photo uploads aggressively, cap video length, don't store anything we can recompute. Avoid services that paywall basic features (auth, basic queries, basic storage).

If a feature genuinely needs a paid tier, flag it explicitly and propose a free alternative or a deferred-until-it-matters approach.
