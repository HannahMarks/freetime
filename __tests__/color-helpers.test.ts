import { darkenHexColor } from '../lib/color-helpers';

describe('darkenHexColor', () => {
  it('returns a darker hex for a given amount (0..1)', () => {
    // Pure mid-grey halved → quarter-grey
    expect(darkenHexColor('#808080', 0.5).toLowerCase()).toBe('#404040');
  });

  it('keeps a value at amount=0 unchanged (case-normalized)', () => {
    expect(darkenHexColor('#9C27B0', 0).toLowerCase()).toBe('#9c27b0');
  });

  it('returns black at amount=1', () => {
    expect(darkenHexColor('#9C27B0', 1).toLowerCase()).toBe('#000000');
  });

  it('clamps amounts above 1 to black', () => {
    expect(darkenHexColor('#9C27B0', 2).toLowerCase()).toBe('#000000');
  });

  it('clamps amounts below 0 to the original', () => {
    expect(darkenHexColor('#9C27B0', -1).toLowerCase()).toBe('#9c27b0');
  });

  it('handles lowercase input', () => {
    // #ff6b6b: r=255 → 128 = 0x80, g=107 → 54 = 0x36, b=107 → 54 = 0x36
    expect(darkenHexColor('#ff6b6b', 0.5).toLowerCase()).toBe('#803636');
  });

  it('handles the 3-digit shorthand by expanding it', () => {
    // #abc → #aabbcc → r=170, g=187, b=204; halved → 85, 94, 102 →
    // 0x55, 0x5e, 0x66
    expect(darkenHexColor('#abc', 0.5).toLowerCase()).toBe('#555e66');
  });

  it('returns the input when handed a malformed hex (degrade gracefully)', () => {
    // Should never throw — calendar code calls this with whatever the
    // profile color column contained, and a typoed hex shouldn't crash
    // the screen.
    expect(darkenHexColor('not-a-color', 0.3)).toBe('not-a-color');
  });

  it('produces a visibly darker variant of saturated colors used as accent', () => {
    // Sanity check on the calendar's main use case — events FAB outline
    // should be clearly darker than the user's profile color.
    const darker = darkenHexColor('#9C27B0', 0.3);
    expect(darker.toLowerCase()).not.toBe('#9c27b0');
    // Each channel should be lower than the input's channel.
    const r = parseInt(darker.slice(1, 3), 16);
    const g = parseInt(darker.slice(3, 5), 16);
    const b = parseInt(darker.slice(5, 7), 16);
    expect(r).toBeLessThan(0x9c);
    expect(g).toBeLessThan(0x27); // already low; 27 * 0.7 ≈ 1b
    expect(b).toBeLessThan(0xb0);
  });
});
