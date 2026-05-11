import { summarizeEventRecurrence } from '../lib/event-helpers';

describe('summarizeEventRecurrence', () => {
  it('summarizes weekly recurrence using the base weekday', () => {
    // Monday 2026-05-11 → "Weekly on Monday"
    const out = summarizeEventRecurrence(
      { freq: 'weekly' },
      new Date(2026, 4, 11, 18, 0),
    );
    expect(out).toBe('Weekly on Monday');
  });

  it('summarizes monthly recurrence using the base day-of-month', () => {
    const out = summarizeEventRecurrence(
      { freq: 'monthly' },
      new Date(2026, 4, 15, 18, 0),
    );
    // Locale-flexible — at minimum should mention "Monthly" and the
    // 15th. Asserting the structure, not the exact strftime.
    expect(out).toMatch(/^Monthly on/);
    expect(out).toMatch(/15/);
  });

  it('summarizes yearly recurrence using the base month + day', () => {
    const out = summarizeEventRecurrence(
      { freq: 'yearly' },
      new Date(2026, 4, 15, 9, 0),
    );
    expect(out).toMatch(/^Yearly on/);
    expect(out).toMatch(/15/);
    // Should mention May (the base's month) somehow.
    expect(out.toLowerCase()).toMatch(/may/);
  });

  it('appends "until <date>" when an until clause is present', () => {
    const out = summarizeEventRecurrence(
      { freq: 'monthly', until: '2027-05-15' },
      new Date(2026, 4, 15, 18, 0),
    );
    expect(out).toMatch(/until/);
    expect(out).toMatch(/2027/);
  });

  it('omits the until tail when no until clause', () => {
    const out = summarizeEventRecurrence(
      { freq: 'yearly' },
      new Date(2026, 4, 15, 9, 0),
    );
    expect(out).not.toMatch(/until/i);
  });
});
