-- Law School Board schema snapshot
-- Matches the live Supabase project as of 2026-04-24

create extension if not exists "uuid-ossp";
create schema if not exists private;

create table if not exists public.config (
  key text primary key,
  value text not null,
  description text
);

create table if not exists public.admins (
  email text primary key,
  grantedby text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  role text not null default 'admin',
  grant_source text not null default 'granted_admin',
  granted_by_email text,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  constraint admins_role_check check (role in ('super_admin', 'admin')),
  constraint admins_grant_source_check check (grant_source in ('system_password', 'granted_admin')),
  constraint admins_email_lowercase_check check (email = lower(email)),
  constraint admins_granted_by_email_lowercase_check check (granted_by_email is null or granted_by_email = lower(granted_by_email))
);

create table if not exists public.courses (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  code text,
  professor text,
  year integer,
  trimester integer,
  iselective boolean default false,
  classroom text,
  weeklyschedule text,
  totalsessions integer default 40,
  currentsession integer default 0,
  status text default 'active',
  outline text,
  lastupdated timestamp with time zone default timezone('utc'::text, now()),
  updatedby text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  section text,
  topic text
);

create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  preferred_year smallint not null check (preferred_year between 1 and 5),
  preferred_trimester smallint not null check (preferred_trimester between 1 and 3),
  preferred_view text not null default 'live' check (preferred_view in ('live', 'archive', 'registry')),
  default_live_only boolean not null default false,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.user_preferences
  add column if not exists preferred_view text not null default 'live';

alter table public.user_preferences
  add column if not exists default_live_only boolean not null default false;

alter table public.user_preferences
  drop constraint if exists user_preferences_preferred_view_check;

alter table public.user_preferences
  add constraint user_preferences_preferred_view_check
  check (preferred_view in ('live', 'archive', 'registry'));

create table if not exists public.course_suggestions (
  id uuid primary key default extensions.gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  suggested_by uuid not null references auth.users(id) on delete cascade,
  suggested_by_email text not null,
  payload jsonb not null,
  status text not null default 'pending',
  review_note text,
  reviewed_by_email text,
  reviewed_at timestamp with time zone,
  applied_at timestamp with time zone,
  submitted_at timestamp with time zone default timezone('utc'::text, now()) not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  constraint course_suggestions_status_check check (status in ('pending', 'approved', 'rejected')),
  constraint course_suggestions_email_lowercase_check check (suggested_by_email = lower(suggested_by_email)),
  constraint course_suggestions_reviewed_by_lowercase_check check (reviewed_by_email is null or reviewed_by_email = lower(reviewed_by_email))
);

create table if not exists public.support_requests (
  id uuid primary key default extensions.gen_random_uuid(),
  requested_by uuid not null references auth.users(id) on delete cascade,
  requested_by_email text not null,
  category text not null default 'other',
  subject text not null,
  message text not null,
  status text not null default 'open',
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  constraint support_requests_category_check check (category in ('board', 'course', 'admin', 'account', 'other')),
  constraint support_requests_status_check check (status in ('open', 'resolved')),
  constraint support_requests_email_lowercase_check check (requested_by_email = lower(requested_by_email))
);

create index if not exists support_requests_requested_by_created_idx
  on public.support_requests (requested_by, created_at desc);

create index if not exists course_suggestions_course_status_idx
  on public.course_suggestions (course_id, status, submitted_at desc);

create index if not exists course_suggestions_suggested_by_idx
  on public.course_suggestions (suggested_by, submitted_at desc);

create or replace function private.current_user_email()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select lower(coalesce(auth.email(), ''))
$$;

create or replace function private.is_nls_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.current_user_email() <> '' and private.current_user_email() like '%@nls.ac.in'
$$;

create or replace function private.admin_role_rank(role_name text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case lower(coalesce(role_name, ''))
    when 'super_admin' then 20
    when 'admin' then 10
    else 0
  end
$$;

create or replace function private.current_admin_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select a.role
  from public.admins a
  where a.email = private.current_user_email()
  limit 1
$$;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.admin_role_rank(private.current_admin_role()) > 0
$$;

create or replace function private.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.admin_role_rank(private.current_admin_role()) >= 20
$$;

create or replace function private.require_nls_user()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  requester_email text := private.current_user_email();
begin
  if requester_email = '' or requester_email not like '%@nls.ac.in' then
    raise exception 'Only @nls.ac.in accounts are allowed.' using errcode = '42501';
  end if;

  return requester_email;
end;
$$;

create or replace function private.require_admin()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  requester_email text := private.require_nls_user();
begin
  if not private.is_admin() then
    raise exception 'Admin access is required.' using errcode = '42501';
  end if;

  return requester_email;
end;
$$;

create or replace function private.require_super_admin()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  requester_email text := private.require_admin();
begin
  if not private.is_super_admin() then
    raise exception 'Super admin access is required.' using errcode = '42501';
  end if;

  return requester_email;
end;
$$;

create or replace function public.touch_user_preferences_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = timezone('utc'::text, now());
  return new;
end;
$$;

create or replace function public.touch_support_requests_updated_at()
returns trigger
language plpgsql
set search_path = ''
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

drop trigger if exists touch_support_requests_updated_at on public.support_requests;
create trigger touch_support_requests_updated_at
before update on public.support_requests
for each row
execute function public.touch_support_requests_updated_at();

create or replace function private.schedule_text_to_jsonb(schedule_text text)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
begin
  if schedule_text is null or btrim(schedule_text) = '' then
    return '{}'::jsonb;
  end if;

  begin
    return schedule_text::jsonb;
  exception when others then
    return '{}'::jsonb;
  end;
end;
$$;

create or replace function private.normalize_schedule_payload(schedule_payload jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    (
      select jsonb_object_agg(day_key, day_value)
      from (
        select key as day_key, nullif(btrim(value), '') as day_value
        from jsonb_each_text(
          case
            when jsonb_typeof(coalesce(schedule_payload, '{}'::jsonb)) = 'object' then coalesce(schedule_payload, '{}'::jsonb)
            else '{}'::jsonb
          end
        )
        where key in ('1', '2', '3', '4', '5', '6')
      ) days
      where day_value is not null
    ),
    '{}'::jsonb
  )
$$;

create or replace function private.schedule_jsonb_to_text(schedule_payload jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when jsonb_typeof(coalesce(schedule_payload, '{}'::jsonb)) = 'object'
      and coalesce(schedule_payload, '{}'::jsonb) <> '{}'::jsonb
    then schedule_payload::text
    else null
  end
$$;

create or replace function private.apply_course_payload(
  target_course_id uuid,
  suggestion_payload jsonb,
  actor_email text
)
returns public.courses
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated_course public.courses%rowtype;
begin
  update public.courses
  set name = case
        when suggestion_payload ? 'name' then suggestion_payload->>'name'
        else name
      end,
      section = case
        when suggestion_payload ? 'section' then nullif(btrim(suggestion_payload->>'section'), '')
        else section
      end,
      professor = case
        when suggestion_payload ? 'professor' then suggestion_payload->>'professor'
        else professor
      end,
      currentsession = case
        when suggestion_payload ? 'currentsession' then greatest((suggestion_payload->>'currentsession')::integer, 0)
        else currentsession
      end,
      totalsessions = case
        when suggestion_payload ? 'totalsessions' then greatest((suggestion_payload->>'totalsessions')::integer, 1)
        else totalsessions
      end,
      topic = case
        when suggestion_payload ? 'topic' then nullif(btrim(suggestion_payload->>'topic'), '')
        else topic
      end,
      weeklyschedule = case
        when suggestion_payload ? 'weeklyschedule' then private.schedule_jsonb_to_text(private.normalize_schedule_payload(suggestion_payload->'weeklyschedule'))
        else weeklyschedule
      end,
      updatedby = actor_email,
      lastupdated = timezone('utc'::text, now())
  where id = target_course_id
  returning * into updated_course;

  if not found then
    raise exception 'Course not found.';
  end if;

  return updated_course;
end;
$$;

create or replace function public.submit_course_suggestion(
  target_course_id uuid,
  raw_payload jsonb
)
returns public.course_suggestions
language plpgsql
security definer
set search_path = ''
as $$
declare
  requester_email text := private.require_nls_user();
  course_row public.courses%rowtype;
  normalized_payload jsonb := '{}'::jsonb;
  proposed_text text;
  proposed_int integer;
  proposed_schedule jsonb;
  current_schedule jsonb;
  inserted_row public.course_suggestions%rowtype;
begin
  if raw_payload is null or jsonb_typeof(raw_payload) <> 'object' then
    raise exception 'Please submit a valid course suggestion.';
  end if;

  select * into course_row
  from public.courses
  where id = target_course_id;

  if not found then
    raise exception 'Course not found.';
  end if;

  if raw_payload ? 'name' then
    proposed_text := nullif(btrim(raw_payload->>'name'), '');
    if proposed_text is not null and proposed_text is distinct from course_row.name then
      normalized_payload := normalized_payload || jsonb_build_object('name', proposed_text);
    end if;
  end if;

  if raw_payload ? 'section' then
    proposed_text := nullif(btrim(raw_payload->>'section'), '');
    if proposed_text is distinct from nullif(btrim(coalesce(course_row.section, '')), '') then
      normalized_payload := normalized_payload || jsonb_build_object('section', proposed_text);
    end if;
  end if;

  if raw_payload ? 'professor' then
    proposed_text := nullif(btrim(raw_payload->>'professor'), '');
    if proposed_text is not null and proposed_text is distinct from nullif(btrim(coalesce(course_row.professor, '')), '') then
      normalized_payload := normalized_payload || jsonb_build_object('professor', proposed_text);
    end if;
  end if;

  if raw_payload ? 'currentsession' then
    proposed_int := greatest((raw_payload->>'currentsession')::integer, 0);
    if proposed_int is distinct from coalesce(course_row.currentsession, 0) then
      normalized_payload := normalized_payload || jsonb_build_object('currentsession', proposed_int);
    end if;
  end if;

  if raw_payload ? 'totalsessions' then
    proposed_int := greatest((raw_payload->>'totalsessions')::integer, 1);
    if proposed_int is distinct from coalesce(course_row.totalsessions, 0) then
      normalized_payload := normalized_payload || jsonb_build_object('totalsessions', proposed_int);
    end if;
  end if;

  if raw_payload ? 'topic' then
    proposed_text := nullif(btrim(raw_payload->>'topic'), '');
    if proposed_text is distinct from nullif(btrim(coalesce(course_row.topic, '')), '') then
      normalized_payload := normalized_payload || jsonb_build_object('topic', proposed_text);
    end if;
  end if;

  if raw_payload ? 'weeklyschedule' then
    proposed_schedule := private.normalize_schedule_payload(raw_payload->'weeklyschedule');
    current_schedule := private.normalize_schedule_payload(private.schedule_text_to_jsonb(course_row.weeklyschedule));
    if proposed_schedule is distinct from current_schedule then
      normalized_payload := normalized_payload || jsonb_build_object('weeklyschedule', proposed_schedule);
    end if;
  end if;

  if normalized_payload = '{}'::jsonb then
    raise exception 'No changes were detected in your suggestion.';
  end if;

  insert into public.course_suggestions (
    course_id,
    suggested_by,
    suggested_by_email,
    payload,
    status
  )
  values (
    target_course_id,
    auth.uid(),
    requester_email,
    normalized_payload,
    'pending'
  )
  returning * into inserted_row;

  return inserted_row;
end;
$$;

create or replace function public.approve_course_suggestion(
  target_suggestion_id uuid,
  review_message text default null
)
returns public.courses
language plpgsql
security definer
set search_path = ''
as $$
declare
  reviewer_email text := private.require_admin();
  suggestion_row public.course_suggestions%rowtype;
  updated_course public.courses%rowtype;
begin
  select * into suggestion_row
  from public.course_suggestions
  where id = target_suggestion_id
  for update;

  if not found then
    raise exception 'Suggestion not found.';
  end if;

  if suggestion_row.status <> 'pending' then
    raise exception 'This suggestion has already been reviewed.';
  end if;

  updated_course := private.apply_course_payload(
    suggestion_row.course_id,
    suggestion_row.payload,
    reviewer_email
  );

  update public.course_suggestions
  set status = 'approved',
      review_note = nullif(btrim(review_message), ''),
      reviewed_by_email = reviewer_email,
      reviewed_at = timezone('utc'::text, now()),
      applied_at = timezone('utc'::text, now())
  where id = target_suggestion_id;

  return updated_course;
end;
$$;

create or replace function public.reject_course_suggestion(
  target_suggestion_id uuid,
  review_message text default null
)
returns public.course_suggestions
language plpgsql
security definer
set search_path = ''
as $$
declare
  reviewer_email text := private.require_admin();
  updated_suggestion public.course_suggestions%rowtype;
begin
  update public.course_suggestions
  set status = 'rejected',
      review_note = nullif(btrim(review_message), ''),
      reviewed_by_email = reviewer_email,
      reviewed_at = timezone('utc'::text, now())
  where id = target_suggestion_id
    and status = 'pending'
  returning * into updated_suggestion;

  if not found then
    raise exception 'Suggestion not found or already reviewed.';
  end if;

  return updated_suggestion;
end;
$$;

create or replace function public.verify_admin_password(password_attempt text)
returns public.admins
language plpgsql
security definer
set search_path = ''
as $$
declare
  requester_email text := private.require_nls_user();
  stored_hash text;
  admin_row public.admins%rowtype;
begin
  select value into stored_hash
  from public.config
  where key = 'admin_password_hash';

  if stored_hash is null then
    raise exception 'Admin password is not configured.';
  end if;

  if extensions.crypt(password_attempt, stored_hash) <> stored_hash then
    raise exception 'Invalid admin password.' using errcode = '22023';
  end if;

  insert into public.admins (
    email,
    grantedby,
    role,
    grant_source,
    granted_by_email,
    updated_at
  )
  values (
    requester_email,
    'system_password',
    'super_admin',
    'system_password',
    null,
    timezone('utc'::text, now())
  )
  on conflict (email) do update
    set grantedby = 'system_password',
        role = 'super_admin',
        grant_source = 'system_password',
        granted_by_email = null,
        updated_at = timezone('utc'::text, now())
  returning * into admin_row;

  return admin_row;
end;
$$;

create or replace function public.grant_admin_access(target_email text)
returns public.admins
language plpgsql
security definer
set search_path = ''
as $$
declare
  requester_email text := private.require_super_admin();
  normalized_target_email text := lower(btrim(coalesce(target_email, '')));
  admin_row public.admins%rowtype;
begin
  if normalized_target_email = '' or normalized_target_email not like '%@nls.ac.in' then
    raise exception 'Please enter a valid @nls.ac.in email address.';
  end if;

  insert into public.admins (
    email,
    grantedby,
    role,
    grant_source,
    granted_by_email,
    updated_at
  )
  values (
    normalized_target_email,
    requester_email,
    'admin',
    'granted_admin',
    requester_email,
    timezone('utc'::text, now())
  )
  on conflict (email) do update
    set grantedby = excluded.grantedby,
        role = 'admin',
        grant_source = 'granted_admin',
        granted_by_email = excluded.granted_by_email,
        updated_at = timezone('utc'::text, now())
  returning * into admin_row;

  return admin_row;
end;
$$;

create or replace function public.revoke_admin_access(target_email text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  requester_email text := private.require_super_admin();
  normalized_target_email text := lower(btrim(coalesce(target_email, '')));
  deleted_count integer;
begin
  if normalized_target_email = '' then
    raise exception 'Please choose an admin to revoke.';
  end if;

  if normalized_target_email = requester_email then
    raise exception 'You cannot revoke your own super admin access from this panel.';
  end if;

  delete from public.admins
  where email = normalized_target_email
    and grant_source = 'granted_admin';

  get diagnostics deleted_count = row_count;

  if deleted_count = 0 then
    raise exception 'Only granted admins can be revoked from this panel.';
  end if;

  return true;
end;
$$;

alter table public.config enable row level security;
alter table public.admins enable row level security;
alter table public.courses enable row level security;
alter table public.user_preferences enable row level security;
alter table public.course_suggestions enable row level security;
alter table public.support_requests enable row level security;

drop policy if exists "Users can view their admin role" on public.admins;
create policy "Users can view their admin role"
  on public.admins for select
  to authenticated
  using (
    (select private.is_nls_user())
    and (
      (select private.is_super_admin())
      or email = (select private.current_user_email())
    )
  );

drop policy if exists "NLS users can view courses" on public.courses;
drop policy if exists "Admins can insert courses" on public.courses;
drop policy if exists "Admins can update courses" on public.courses;
drop policy if exists "Admins can delete courses" on public.courses;

create policy "NLS users can view courses"
  on public.courses for select
  to authenticated
  using ((select private.is_nls_user()));

create policy "Admins can insert courses"
  on public.courses for insert
  to authenticated
  with check ((select private.is_admin()));

create policy "Admins can update courses"
  on public.courses for update
  to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

create policy "Admins can delete courses"
  on public.courses for delete
  to authenticated
  using ((select private.is_admin()));

drop policy if exists "Users can view their own board preference" on public.user_preferences;
drop policy if exists "Users can insert their own board preference" on public.user_preferences;
drop policy if exists "Users can update their own board preference" on public.user_preferences;

create policy "Users can view their own board preference"
  on public.user_preferences for select
  to authenticated
  using ((select private.is_nls_user()) and (select auth.uid()) = user_id);

create policy "Users can insert their own board preference"
  on public.user_preferences for insert
  to authenticated
  with check ((select private.is_nls_user()) and (select auth.uid()) = user_id);

create policy "Users can update their own board preference"
  on public.user_preferences for update
  to authenticated
  using ((select private.is_nls_user()) and (select auth.uid()) = user_id)
  with check ((select private.is_nls_user()) and (select auth.uid()) = user_id);

drop policy if exists "Users can view relevant course suggestions" on public.course_suggestions;
create policy "Users can view relevant course suggestions"
  on public.course_suggestions for select
  to authenticated
  using (
    (select private.is_nls_user())
    and (
      suggested_by = (select auth.uid())
      or (select private.is_admin())
    )
  );

drop policy if exists "Users can view their own support requests" on public.support_requests;
drop policy if exists "Users can submit their own support requests" on public.support_requests;
drop policy if exists "Admins can review support requests" on public.support_requests;
drop policy if exists "Admins can update support requests" on public.support_requests;

create policy "Users can view their own support requests"
  on public.support_requests for select
  to authenticated
  using (
    (select private.is_nls_user())
    and (
      requested_by = (select auth.uid())
      or (select private.is_admin())
    )
  );

create policy "Users can submit their own support requests"
  on public.support_requests for insert
  to authenticated
  with check (
    (select private.is_nls_user())
    and requested_by = (select auth.uid())
    and requested_by_email = (select private.current_user_email())
  );

create policy "Admins can update support requests"
  on public.support_requests for update
  to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

revoke all on function public.submit_course_suggestion(uuid, jsonb) from public, anon;
revoke all on function public.approve_course_suggestion(uuid, text) from public, anon;
revoke all on function public.reject_course_suggestion(uuid, text) from public, anon;
revoke all on function public.verify_admin_password(text) from public, anon;
revoke all on function public.grant_admin_access(text) from public, anon;
revoke all on function public.revoke_admin_access(text) from public, anon;

grant execute on function public.submit_course_suggestion(uuid, jsonb) to authenticated;
grant execute on function public.approve_course_suggestion(uuid, text) to authenticated;
grant execute on function public.reject_course_suggestion(uuid, text) to authenticated;
grant execute on function public.verify_admin_password(text) to authenticated;
grant execute on function public.grant_admin_access(text) to authenticated;
grant execute on function public.revoke_admin_access(text) to authenticated;

begin;
  drop publication if exists supabase_realtime;
  create publication supabase_realtime;
commit;

alter publication supabase_realtime add table public.courses;
