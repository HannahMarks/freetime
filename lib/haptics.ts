import * as Haptics from 'expo-haptics';

/**
 * Light "selection" haptic — the iOS scrubber-tick feel. Use it when a
 * value snaps to a new position the user might want to feel (e.g. drag
 * a busy_block over each 15-minute slot during reschedule).
 *
 * Wrapped in a tiny module so callers don't have to know the underlying
 * library, and so tests can mock it cheaply.
 */
export function tickSnap(): void {
  // Fire-and-forget. Failures (e.g. hardware doesn't support it) are
  // harmless — better to skip a tick than to surface anything to the user.
  void Haptics.selectionAsync().catch(() => {});
}
