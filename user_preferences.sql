create table if not exists public.user_preferences (
    user_id uuid primary key references auth.users(id) on delete cascade,
    preferred_year smallint not null check (preferred_year between 1 and 5),
    preferred_trimester smallint not null check (preferred_trimester between 1 and 3),
    created_at timestamptz not null default timezone('utc'::text, now()),
    updated_at timestamptz not null default timezone('utc'::text, now())
);

create or replace function public.touch_user_preferences_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = timezone('utc'::text, now());
    return new;
end;
$$;

drop trigger if exists touch_user_preferences_updated_at on public.user_preferences;
create trigger touch_user_preferences_updated_at
before update on public.user_preferences
for each row
execute function public.touch_user_preferences_updated_at();

alter table public.user_preferences enable row level security;

drop policy if exists "Users can view their own board preference" on public.user_preferences;
create policy "Users can view their own board preference"
on public.user_preferences for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert their own board preference" on public.user_preferences;
create policy "Users can insert their own board preference"
on public.user_preferences for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own board preference" on public.user_preferences;
create policy "Users can update their own board preference"
on public.user_preferences for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
