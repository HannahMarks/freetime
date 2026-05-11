-- Per-occurrence override metadata for both exception tables. A `move`
-- exception can now carry title / notes / location values that apply
-- to JUST that occurrence, layered on top of the series's values.
--
-- e.g. user has "Yoga" every Monday at 14:00 with notes "Studio 5".
-- Drag Monday May 18 to 16:00 + edit-this-occurrence to change notes
-- to "Bring towel". That writes a single move exception:
-- (series=Y, original=2026-05-18T14:00, action=move, new_start=
--  2026-05-18T16:00, new_end=…, title=null (inherit), notes="Bring
--  towel" (override), location=null (inherit)).
-- listCalendarItems then emits May 18's occurrence with notes from
-- the exception while every other Monday still shows "Studio 5".
--
-- All new columns are nullable. Null = "inherit from the series row".
-- We deliberately do NOT tighten the action='skip' CHECK to forbid
-- non-null override values: the application layer always passes null
-- on skip, and a future PR may want to attach metadata to a skip
-- row (e.g. a deletion reason) without another schema migration.

alter table public.busy_block_exceptions
  add column title text,
  add column notes text,
  add column location text,
  add constraint busy_block_exceptions_title_not_blank check (
    title is null or length(trim(title)) > 0
  ),
  add constraint busy_block_exceptions_notes_not_blank check (
    notes is null or length(trim(notes)) > 0
  ),
  add constraint busy_block_exceptions_location_not_blank check (
    location is null or length(trim(location)) > 0
  );

alter table public.unavailable_day_exceptions
  add column title text,
  add column notes text,
  add constraint unavailable_day_exceptions_title_not_blank check (
    title is null or length(trim(title)) > 0
  ),
  add constraint unavailable_day_exceptions_notes_not_blank check (
    notes is null or length(trim(notes)) > 0
  );
