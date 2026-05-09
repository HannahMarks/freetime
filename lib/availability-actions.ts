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
  });

  if (error) return { error: describeError("Couldn't add activity", error) };
  return { error: null };
}

export async function createUnavailableDay(args: {
  date: string; // YYYY-MM-DD
  title: string | null;
  notes: string | null;
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
}): Promise<ActionResult> {
  const { error } = await supabase
    .from('busy_blocks')
    .update({
      title: args.title,
      starts_at: args.startsAt.toISOString(),
      ends_at: args.endsAt.toISOString(),
      notes: args.notes,
      location: args.location,
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
}): Promise<ActionResult> {
  const { error } = await supabase
    .from('unavailable_days')
    .update({ title: args.title, notes: args.notes })
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
