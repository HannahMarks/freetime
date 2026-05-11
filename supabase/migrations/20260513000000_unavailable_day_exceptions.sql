-- Per-occurrence overrides for recurring `unavailable_days`. Parallel
-- shape to `busy_block_exceptions` (#51 / #54) — a row in this table
-- modifies a SINGLE occurrence of an unavailable_day series without
-- affecting the others, either skipping it entirely (`action = 'skip'`)
-- or moving it to a different date (`action = 'move'`).
--
-- v6 client only surfaces 'skip' (popover gains "Delete this occurrence"
-- alongside "Delete entire series"). 'move' is in the schema so a
-- future PR can support drag-to-move-day-off without another migration.
--
-- Composite PK: `(series_user_id, series_date, original_date)`.
-- `original_date` is the date `expandOccurrences` would emit for that
-- occurrence — the client looks up exceptions by exact match against
-- the generated occurrence date.
--
-- Composite FK to `unavailable_days(user_id, date)` ON DELETE CASCADE:
-- deleting the parent series row removes all its exceptions
-- automatically (same as busy_block_exceptions does for busy_blocks).
--
-- A `date` column (NOT `timestamptz`) for `original_date` and `new_date`
-- because unavailable_days are floating whole-day markers. The client
-- compares against `isoDate(occurrence.startsAt)` from the helper's
-- date-only expansion.

create table public.unavailable_day_exceptions (
  series_user_id uuid not null,
  series_date date not null,
  original_date date not null,
  action text not null check (action in ('skip', 'move')),
  -- Required when action='move'; must be null for action='skip'.
  new_date date,
  created_at timestamptz not null default now(),
  primary key (series_user_id, series_date, original_date),
  foreign key (series_user_id, series_date)
    references public.unavailable_days(user_id, date) on delete cascade,
  -- Self-consistency: skip rows have null new_date, move rows have non-null new_date.
  constraint unavailable_day_exceptions_action_consistent check (
    (action = 'skip' and new_date is null)
    or (action = 'move' and new_date is not null)
  )
);

-- Index for the listCalendarItems query: load all exceptions for a
-- given series in one go via `IN (series_id_list)`.
create index unavailable_day_exceptions_series_idx
  on public.unavailable_day_exceptions (series_user_id, series_date);

alter table public.unavailable_day_exceptions enable row level security;

-- Visibility mirrors the parent series — own exceptions and accepted
-- friends' exceptions are visible. Looking up the parent series's
-- owner via the FK column directly is fine since `series_user_id` IS
-- the owner.
create policy "users see exceptions on their own + friends' unavailable_days"
  on public.unavailable_day_exceptions
  for select
  to authenticated
  using (series_user_id = auth.uid() or public.is_friend_of(series_user_id));

create policy "users can INSERT exceptions only on their own unavailable_days"
  on public.unavailable_day_exceptions
  for insert
  to authenticated
  with check (series_user_id = auth.uid());

create policy "users can UPDATE exceptions only on their own unavailable_days"
  on public.unavailable_day_exceptions
  for update
  to authenticated
  using (series_user_id = auth.uid())
  with check (series_user_id = auth.uid());

create policy "users can DELETE exceptions only on their own unavailable_days"
  on public.unavailable_day_exceptions
  for delete
  to authenticated
  using (series_user_id = auth.uid());
