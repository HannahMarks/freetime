-- Per-occurrence overrides for recurring `busy_blocks`. A row in this
-- table modifies a SINGLE occurrence of a series without affecting the
-- others — either skipping it entirely (`action = 'skip'`) or moving it
-- to a different time (`action = 'move'`).
--
-- v1 of this table only surfaces 'skip' in the client (the three-dots
-- popover gains "Delete this occurrence" alongside "Delete entire
-- series"). 'move' is supported in the schema so a future PR can wire
-- drag-to-reschedule on a recurring occurrence to write a move
-- exception without another schema migration.
--
-- Composite PK: `(series_id, original_start)`. `original_start` is the
-- timestamp the parent series's `expandOccurrences` would emit for that
-- occurrence — the client looks up exceptions by exact match against
-- the generated occurrence start.
--
-- ON DELETE CASCADE on the series FK: deleting the parent
-- busy_block (delete-entire-series) removes all its exceptions
-- automatically.

create table public.busy_block_exceptions (
  series_id uuid not null
    references public.busy_blocks(id) on delete cascade,
  original_start timestamptz not null,
  action text not null check (action in ('skip', 'move')),
  -- Required when action='move'; must both be null for action='skip'.
  new_start timestamptz,
  new_end timestamptz,
  created_at timestamptz not null default now(),
  primary key (series_id, original_start),
  -- Self-consistency: skip rows have no new_*, move rows have both.
  constraint busy_block_exceptions_action_consistent check (
    (action = 'skip' and new_start is null and new_end is null)
    or (action = 'move' and new_start is not null and new_end is not null and new_end > new_start)
  )
);

-- Index for the listCalendarItems query: load all exceptions for a
-- given series in one go.
create index busy_block_exceptions_series_idx
  on public.busy_block_exceptions (series_id);

alter table public.busy_block_exceptions enable row level security;

-- Visibility mirrors the parent series — own exceptions and accepted
-- friends' exceptions are visible. Looking up the parent series's
-- owner via a sub-select keeps the policy compact (and avoids
-- duplicating the RLS conditions in every row of this table).
create policy "users see exceptions on their own + friends' busy_blocks"
  on public.busy_block_exceptions
  for select
  to authenticated
  using (
    exists (
      select 1 from public.busy_blocks bb
      where bb.id = series_id
        and (bb.user_id = auth.uid() or public.is_friend_of(bb.user_id))
    )
  );

create policy "users can INSERT exceptions only on their own busy_blocks"
  on public.busy_block_exceptions
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.busy_blocks bb
      where bb.id = series_id and bb.user_id = auth.uid()
    )
  );

create policy "users can UPDATE exceptions only on their own busy_blocks"
  on public.busy_block_exceptions
  for update
  to authenticated
  using (
    exists (
      select 1 from public.busy_blocks bb
      where bb.id = series_id and bb.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.busy_blocks bb
      where bb.id = series_id and bb.user_id = auth.uid()
    )
  );

create policy "users can DELETE exceptions only on their own busy_blocks"
  on public.busy_block_exceptions
  for delete
  to authenticated
  using (
    exists (
      select 1 from public.busy_blocks bb
      where bb.id = series_id and bb.user_id = auth.uid()
    )
  );
