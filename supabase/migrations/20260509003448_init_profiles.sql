-- profiles table: 1:1 with auth.users, holds the bits we want everywhere
-- (display_name + per-user color for the shared calendar overlay).

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  color text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint profiles_display_name_not_blank check (length(trim(display_name)) > 0),
  constraint profiles_color_is_hex check (color ~ '^#[0-9A-Fa-f]{6}$')
);

-- Generic updated_at trigger function — reused by any table that wants it.
create or replace function public.tg_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row
  execute function public.tg_set_updated_at();

-- When auth.users gets a row (signup), auto-create the matching profile.
-- Reads display_name + color out of raw_user_meta_data when present, otherwise
-- falls back to the email local-part for the name and a deterministic color.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  fallback_palette text[] := array[
    '#FF6B6B', '#4ECDC4', '#FFE66D', '#A8E6CF',
    '#FF8CC8', '#95B8FF', '#FFAA5A', '#C7B8EA'
  ];
begin
  insert into public.profiles (id, display_name, color)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data->>'display_name'), ''),
      split_part(new.email, '@', 1)
    ),
    coalesce(
      case
        when new.raw_user_meta_data->>'color' ~ '^#[0-9A-Fa-f]{6}$'
          then new.raw_user_meta_data->>'color'
      end,
      fallback_palette[1 + (abs(hashtext(new.id::text)) % array_length(fallback_palette, 1))]
    )
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- RLS
alter table public.profiles enable row level security;

create policy "profiles are readable by any authenticated user"
  on public.profiles
  for select
  to authenticated
  using (true);

create policy "users can update their own profile"
  on public.profiles
  for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- No INSERT policy — profiles are only ever inserted by the security-definer
-- trigger above, which bypasses RLS. No DELETE policy — profile rows are
-- removed via the FK cascade when auth.users is deleted.
