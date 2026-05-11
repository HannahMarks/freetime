import type { RecurrenceRule } from './recurrence';
import { supabase } from './supabase';

export type ActionResult = { error: string | null };

function describeError(prefix: string, err: unknown): string {
  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.error(`[availability] ${prefix}:`, err);
  }
  return `${prefix}. Please try again.`;
}

/**
 * Insert a busy_block owned by the calling user. RLS ensures `user_id`
 * must match `auth.uid()`, so we read the user from the live session
 * instead of trusting a caller-supplied id.
 */
export async function createBusyBlock(args: {
  startsAt: Date;
  endsAt: Date;
  title: string | null;
  notes: string | null;
  location: string | null;
  /** Optional. When set, the block is the FIRST occurrence of a
   * repeating series; later occurrences are expanded client-side by
   * `expandOccurrences`. Defaults to a one-off (null). */
  recurrenceRule?: RecurrenceRule | null;
}): Promise<ActionResult> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Not signed in.' };

  const { error } = await supabase.from('busy_blocks').insert({
    user_id: user.id,
    title: args.title,
    starts_at: args.startsAt.toISOString(),
    ends_at: args.endsAt.toISOString(),
    notes: args.notes,
    location: args.location,
    // Always include the column explicitly — `undefined` would let the
    // DB keep an existing value on PATCH-style upserts; explicit null
    // matches the "this is a one-off" semantics.
    recurrence_rule: args.recurrenceRule ?? null,
  });

  if (error) return { error: describeError("Couldn't add activity", error) };
  return { error: null };
}

export async function createUnavailableDay(args: {
  date: string; // YYYY-MM-DD
  title: string | null;
  notes: string | null;
  /** Optional. When set, the row is the FIRST occurrence of a repeating
   * series; later occurrences are expanded client-side by
   * `expandOccurrences`. Defaults to a one-off (null). */
  recurrenceRule?: RecurrenceRule | null;
}): Promise<ActionResult> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Not signed in.' };

  const { error } = await supabase.from('unavailable_days').insert({
    user_id: user.id,
    date: args.date,
    title: args.title,
    notes: args.notes,
    recurrence_rule: args.recurrenceRule ?? null,
  });

  if (error) {
    if ((error as { code?: string }).code === '23505') {
      return { error: "You've already marked that day unavailable." };
    }
    return { error: describeError("Couldn't mark day unavailable", error) };
  }
  return { error: null };
}

export async function updateBusyBlock(args: {
  id: string;
  startsAt: Date;
  endsAt: Date;
  title: string | null;
  notes: string | null;
  location: string | null;
  /** Optional. When set, replaces the existing rule (turns a one-off
   * into a series, or vice versa, or rewrites the rule). When omitted,
   * the column is set to null — i.e. "save without recurrence". */
  recurrenceRule?: RecurrenceRule | null;
}): Promise<ActionResult> {
  const { error } = await supabase
    .from('busy_blocks')
    .update({
      title: args.title,
      starts_at: args.startsAt.toISOString(),
      ends_at: args.endsAt.toISOString(),
      notes: args.notes,
      location: args.location,
      recurrence_rule: args.recurrenceRule ?? null,
    })
    .eq('id', args.id);

  if (error) return { error: describeError("Couldn't update activity", error) };
  return { error: null };
}

export async function updateUnavailableDay(args: {
  userId: string;
  date: string;
  title: string | null;
  notes: string | null;
  /** Optional. When set, replaces the existing rule. When omitted, the
   * column is set to null — i.e. "save without recurrence" (matches
   * the toggle-off-in-edit-mode UX). */
  recurrenceRule?: RecurrenceRule | null;
}): Promise<ActionResult> {
  const { error } = await supabase
    .from('unavailable_days')
    .update({
      title: args.title,
      notes: args.notes,
      recurrence_rule: args.recurrenceRule ?? null,
    })
    .eq('user_id', args.userId)
    .eq('date', args.date);

  if (error) return { error: describeError("Couldn't update day marker", error) };
  return { error: null };
}

export async function deleteBusyBlock(id: string): Promise<ActionResult> {
  const { error } = await supabase.from('busy_blocks').delete().eq('id', id);
  if (error) return { error: describeError("Couldn't delete activity", error) };
  return { error: null };
}

/**
 * Insert (or replace) a `move` exception for a single occurrence of a
 * recurring busy_block series. The series row stays put — only this
 * one occurrence's start / end is rewritten.
 *
 * `originalStart` MUST be the PRE-move timestamp `expandOccurrences`
 * emits for this slot, NOT the currently-displayed (moved) time. For
 * an occurrence that has already been moved once, callers should pass
 * `CalendarItem.originalStart` rather than `startsAt` — otherwise the
 * upsert plants a new exception rooted at the moved time, orphaning
 * the original one and letting the natural occurrence re-appear.
 *
 * Idempotent on the composite PK — re-moving the same occurrence
 * overwrites the existing exception's new_start / new_end.
 */
export async function moveBusyBlockOccurrence(args: {
  seriesId: string;
  originalStart: Date;
  newStart: Date;
  newEnd: Date;
}): Promise<ActionResult> {
  const { error } = await supabase
    .from('busy_block_exceptions')
    .upsert(
      {
        series_id: args.seriesId,
        original_start: args.originalStart.toISOString(),
        action: 'move',
        new_start: args.newStart.toISOString(),
        new_end: args.newEnd.toISOString(),
      },
      { onConflict: 'series_id,original_start' },
    );

  if (error) return { error: describeError("Couldn't move this occurrence", error) };
  return { error: null };
}

/**
 * Insert a `skip` exception for a single occurrence of a recurring
 * busy_block series. The series row stays put — only this one
 * occurrence is hidden from `listCalendarItems`.
 *
 * `originalStart` MUST exactly match the timestamp the parent series's
 * `expandOccurrences` would emit for that occurrence — the
 * client-side filter compares ISO strings. The CalendarItem's
 * `startsAt` (the value displayed on the timeline) is exactly this
 * value, so callers can pass it through.
 *
 * Idempotent on conflict — the unique PK is
 * (series_id, original_start), so re-inserting the same skip is a
 * no-op (we upsert rather than ignoring the conflict so an existing
 * 'move' exception on the same occurrence gets converted to 'skip').
 */
export async function skipBusyBlockOccurrence(args: {
  seriesId: string;
  originalStart: Date;
}): Promise<ActionResult> {
  const { error } = await supabase
    .from('busy_block_exceptions')
    .upsert(
      {
        series_id: args.seriesId,
        original_start: args.originalStart.toISOString(),
        action: 'skip',
        // Explicit null on new_start / new_end — the table's CHECK
        // constraint requires both to be null when action='skip'. If
        // we left them undefined, an upsert from an existing 'move'
        // row would carry the old new_* values and trip the check.
        new_start: null,
        new_end: null,
      },
      { onConflict: 'series_id,original_start' },
    );

  if (error) return { error: describeError("Couldn't skip this occurrence", error) };
  return { error: null };
}

/**
 * Insert a `skip` exception for a single occurrence of a recurring
 * unavailable_day series. The series row stays put — only this one
 * occurrence's date is hidden from `listCalendarItems`.
 *
 * `seriesUserId` + `seriesDate` identify the parent row (the
 * unavailable_days composite PK). `originalDate` is the per-occurrence
 * YYYY-MM-DD that `expandOccurrences` would have emitted for this
 * slot — i.e. the CalendarItem's `date` when it was an unmoved
 * occurrence (or `originalDate` if a move was later applied).
 *
 * Idempotent on the (series_user_id, series_date, original_date)
 * composite PK. Explicit-null new_date so an upsert from an existing
 * 'move' exception on the same occurrence cleanly converts to 'skip'
 * (the table's CHECK requires new_date IS NULL on a skip row).
 */
export async function skipUnavailableDayOccurrence(args: {
  seriesUserId: string;
  seriesDate: string; // YYYY-MM-DD
  originalDate: string; // YYYY-MM-DD
}): Promise<ActionResult> {
  const { error } = await supabase
    .from('unavailable_day_exceptions')
    .upsert(
      {
        series_user_id: args.seriesUserId,
        series_date: args.seriesDate,
        original_date: args.originalDate,
        action: 'skip',
        new_date: null,
      },
      { onConflict: 'series_user_id,series_date,original_date' },
    );

  if (error) return { error: describeError("Couldn't skip this day", error) };
  return { error: null };
}

export async function deleteUnavailableDay(args: {
  userId: string;
  date: string;
}): Promise<ActionResult> {
  const { error } = await supabase
    .from('unavailable_days')
    .delete()
    .eq('user_id', args.userId)
    .eq('date', args.date);
  if (error) return { error: describeError("Couldn't delete day marker", error) };
  return { error: null };
}
