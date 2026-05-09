-- Add `notes` (free-form longer text) and `location` (single-line) to
-- busy_blocks. unavailable_days gets `notes` only — a whole-day marker
-- ("don't try to plan with me on the 14th") doesn't have one specific
-- place and is awkward to label with one.
--
-- All three columns are nullable (notes/location are optional). The
-- not-blank checks mirror the existing `title_not_blank` constraints so
-- we never persist a row where the value is whitespace-only.

alter table public.busy_blocks
  add column notes text,
  add column location text;

alter table public.busy_blocks
  add constraint busy_blocks_notes_not_blank check (
    notes is null or length(trim(notes)) > 0
  ),
  add constraint busy_blocks_location_not_blank check (
    location is null or length(trim(location)) > 0
  );

alter table public.unavailable_days
  add column notes text;

alter table public.unavailable_days
  add constraint unavailable_days_notes_not_blank check (
    notes is null or length(trim(notes)) > 0
  );
