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
};

export type UnavailableDayItem = {
  kind: 'unavailable_day';
  user: FriendProfile;
  date: string; // YYYY-MM-DD
  title: string | null;
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

/** "12:00 PM – 1:00 PM" style range, locale-aware. */
export function formatTimeRange(startsAt: Date, endsAt: Date): string {
  const fmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${fmt.format(startsAt)} – ${fmt.format(endsAt)}`;
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
