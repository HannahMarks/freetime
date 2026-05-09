// Pure helpers for the calendar agenda view.
// No React, no Supabase — just date math and shape transforms so they're
// trivially testable.

export type FriendProfile = {
  id: string;
  display_name: string;
  color: string;
};

export type BusyBlockItem = {
  kind: 'busy_block';
  id: string;
  user: FriendProfile;
  startsAt: Date;
  endsAt: Date;
  title: string | null;
  notes: string | null;
  location: string | null;
};

export type UnavailableDayItem = {
  kind: 'unavailable_day';
  user: FriendProfile;
  date: string; // YYYY-MM-DD
  title: string | null;
  notes: string | null;
};

export type CalendarItem = BusyBlockItem | UnavailableDayItem;

export type DayAgenda = {
  date: string;   // YYYY-MM-DD
  label: string;  // "Today" | "Tomorrow" | "Wed, May 13"
  items: CalendarItem[];
};

/** Local-timezone YYYY-MM-DD for a Date. */
export function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * `[fromDate, toDate)` covering a calendar month — fromDate is the 1st,
 * toDate is the 1st of the *next* month (exclusive). Months are 0-indexed
 * to match `Date#getMonth()`.
 */
export function monthRange(year: number, monthIndex: number): {
  fromDate: string;
  toDate: string;
} {
  return {
    fromDate: isoDate(new Date(year, monthIndex, 1)),
    toDate: isoDate(new Date(year, monthIndex + 1, 1)),
  };
}

/** A single marking dot for the calendar grid. */
export type Dot = { key: string; color: string };
export type DateMarkings = Record<string, { dots: Dot[] }>;

/**
 * Local YYYY-MM-DD strings for every calendar day a busy_block touches.
 * A block ending exactly at midnight (00:00:00.000) does *not* claim the
 * next day — the next day is free.
 */
function spannedDates(startsAt: Date, endsAt: Date): string[] {
  const startDay = new Date(startsAt.getFullYear(), startsAt.getMonth(), startsAt.getDate());
  const endDay = new Date(endsAt.getFullYear(), endsAt.getMonth(), endsAt.getDate());
  const endIsMidnight =
    endsAt.getHours() === 0 &&
    endsAt.getMinutes() === 0 &&
    endsAt.getSeconds() === 0 &&
    endsAt.getMilliseconds() === 0;
  const lastDay = endIsMidnight
    ? new Date(endDay.getFullYear(), endDay.getMonth(), endDay.getDate() - 1)
    : endDay;
  if (lastDay < startDay) return [isoDate(startDay)];

  const out: string[] = [];
  const cursor = new Date(startDay);
  while (cursor <= lastDay) {
    out.push(isoDate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

/**
 * Build per-date marking dots for the month grid. Each dot is keyed by the
 * owning user's id so the same friend never produces two dots on the same
 * day even if they have multiple busy_blocks that day. Multi-day blocks
 * mark every day they span.
 */
export function computeMarkings(items: CalendarItem[]): DateMarkings {
  const result: DateMarkings = {};
  const addDot = (dateKey: string, item: CalendarItem) => {
    if (!result[dateKey]) result[dateKey] = { dots: [] };
    if (!result[dateKey].dots.some((d) => d.key === item.user.id)) {
      result[dateKey].dots.push({ key: item.user.id, color: item.user.color });
    }
  };
  for (const item of items) {
    if (item.kind === 'busy_block') {
      for (const dateKey of spannedDates(item.startsAt, item.endsAt)) addDot(dateKey, item);
    } else {
      addDot(item.date, item);
    }
  }
  return result;
}

/** Items that touch a single calendar day. Multi-day busy_blocks match
 * every day they span. */
export function itemsOnDate(items: CalendarItem[], date: string): CalendarItem[] {
  return items.filter((item) => {
    if (item.kind === 'unavailable_day') return item.date === date;
    return spannedDates(item.startsAt, item.endsAt).includes(date);
  });
}

/** N consecutive YYYY-MM-DD strings starting from `from` (default today). */
export function nextNDays(n: number, from: Date = new Date()): string[] {
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    out.push(isoDate(d));
  }
  return out;
}

/** Section-header label for an agenda day. */
export function formatDayLabel(date: string, today: Date = new Date()): string {
  const todayIso = isoDate(today);
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  const tomorrowIso = isoDate(tomorrow);
  if (date === todayIso) return 'Today';
  if (date === tomorrowIso) return 'Tomorrow';
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Parse a user-entered time string into hour + minute (24h).
 * Accepts: "9:00", "09:00", "9:00 AM", "9 AM", "9pm", "14:30".
 * Returns null on anything malformed.
 */
export function parseTime(input: string): { hour: number; minute: number } | null {
  const m = input.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!m) return null;
  let hour = parseInt(m[1], 10);
  const minute = m[2] ? parseInt(m[2], 10) : 0;
  const ampm = m[3]?.toUpperCase();
  if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
  if (ampm) {
    if (hour < 1 || hour > 12) return null;
    if (ampm === 'PM' && hour < 12) hour += 12;
    if (ampm === 'AM' && hour === 12) hour = 0;
  } else {
    if (hour < 0 || hour > 23) return null;
  }
  if (minute < 0 || minute > 59) return null;
  return { hour, minute };
}

/** Combine a YYYY-MM-DD date with hour+minute into a local-zone Date. */
export function combineDateAndTime(
  dateStr: string,
  time: { hour: number; minute: number },
): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d, time.hour, time.minute, 0, 0);
}

/** "12:00 PM – 1:00 PM" style range, locale-aware. */
export function formatTimeRange(startsAt: Date, endsAt: Date): string {
  const fmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${fmt.format(startsAt)} – ${fmt.format(endsAt)}`;
}

/** Round `minutes` to the nearest multiple of `snap`. Used to lock dragged
 * blocks to 15-minute increments. */
export function snapMinutes(minutes: number, snap: number): number {
  return Math.round(minutes / snap) * snap;
}

/** Shift both endpoints of a busy_block by the same minute delta. Duration
 * is preserved; the block can cross day boundaries. Used by the
 * drag-to-reschedule gesture. */
export function shiftBlockByMinutes(
  item: BusyBlockItem,
  deltaMinutes: number,
): { startsAt: Date; endsAt: Date } {
  const ms = deltaMinutes * 60_000;
  return {
    startsAt: new Date(item.startsAt.getTime() + ms),
    endsAt: new Date(item.endsAt.getTime() + ms),
  };
}

/**
 * Bucket calendar items into per-day agendas for a fixed list of dates.
 * Items outside `dateKeys` are dropped. Within a day, unavailable_day rows
 * sort first (they're the headline state), then busy_blocks by start time.
 */
export function buildAgenda(
  items: CalendarItem[],
  dateKeys: string[],
  today: Date = new Date(),
): DayAgenda[] {
  const byDate = new Map<string, CalendarItem[]>();
  for (const key of dateKeys) byDate.set(key, []);

  for (const item of items) {
    const key = item.kind === 'busy_block' ? isoDate(item.startsAt) : item.date;
    const bucket = byDate.get(key);
    if (bucket) bucket.push(item);
  }

  return dateKeys.map((date) => {
    const dayItems = byDate.get(date)!;
    dayItems.sort((a, b) => {
      if (a.kind === 'unavailable_day' && b.kind !== 'unavailable_day') return -1;
      if (a.kind !== 'unavailable_day' && b.kind === 'unavailable_day') return 1;
      if (a.kind === 'busy_block' && b.kind === 'busy_block') {
        return a.startsAt.getTime() - b.startsAt.getTime();
      }
      return 0;
    });
    return { date, label: formatDayLabel(date, today), items: dayItems };
  });
}
