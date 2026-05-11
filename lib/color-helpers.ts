// Color math helpers — pure, no React, no native deps. Used by the
// calendar's event accent rendering and the FAB multi-action component
// so the events sub-FAB outline + the event dots on the calendar grid
// stay in lockstep (a single source of truth for "the user's color but
// darker").

/** Expand "#abc" → "#aabbcc" and return null for anything else. */
function normalizeHex(input: string): string | null {
  const m3 = /^#([0-9a-fA-F]{3})$/.exec(input);
  if (m3) {
    const [r, g, b] = m3[1].split('');
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  const m6 = /^#([0-9a-fA-F]{6})$/.exec(input);
  if (m6) return `#${m6[1]}`;
  return null;
}

/**
 * Darken a hex color by `amount` (0..1). 0 = unchanged, 1 = black.
 * Out-of-range amounts clamp. Malformed input returns the input
 * unchanged — never throws, so the calendar can't crash on a typoed
 * profile color column.
 *
 * Implementation: linear blend toward black per channel. We don't
 * convert through HSL — the goal is "noticeably darker" not
 * "perceptually identical hue", and the linear blend is simpler /
 * cheaper and gives the desired visual.
 */
export function darkenHexColor(hex: string, amount: number): string {
  const normalized = normalizeHex(hex);
  if (!normalized) return hex;
  if (amount <= 0) return normalized;
  const clamped = amount >= 1 ? 1 : amount;
  const factor = 1 - clamped;
  const r = parseInt(normalized.slice(1, 3), 16);
  const g = parseInt(normalized.slice(3, 5), 16);
  const b = parseInt(normalized.slice(5, 7), 16);
  const dr = Math.round(r * factor);
  const dg = Math.round(g * factor);
  const db = Math.round(b * factor);
  const hh = (n: number) => n.toString(16).padStart(2, '0');
  return `#${hh(dr)}${hh(dg)}${hh(db)}`;
}
