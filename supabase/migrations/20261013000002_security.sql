-- LaterLetter — integrity triggers, row-level security and grants.
--
-- Principle: clients get the smallest possible surface. Most reads and every privileged
-- write go through SECURITY DEFINER functions (next migration) that re-check authorization.

-- ---------------------------------------------------------------------------
-- Immutability of sent letters
-- ---------------------------------------------------------------------------
create or replace function public.guard_letter_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Content-defining and schedule-defining fields can never change, for any role.
  if new.deliver_at is distinct from old.deliver_at
     or new.created_at is distinct from old.created_at
     or new.reveal_mode is distinct from old.reveal_mode
     or new.show_subject is distinct from old.show_subject
     or new.show_preview is distinct from old.show_preview
     or new.envelope_sender_name is distinct from old.envelope_sender_name
     or new.envelope_sender_handle is distinct from old.envelope_sender_handle
     or new.envelope_subject is distinct from old.envelope_subject
     or new.envelope_preview is distinct from old.envelope_preview
     or new.sender_time_zone is distinct from old.sender_time_zone
     or new.idempotency_key is distinct from old.idempotency_key
  then
    raise exception 'letter_immutable' using errcode = 'P0001',
      detail = 'A sent letter''s schedule and envelope cannot be changed.';
  end if;

  -- Identities may only be detached (erasure), never re-pointed.
  if new.sender_id is not null and new.sender_id is distinct from old.sender_id then
    raise exception 'letter_immutable' using errcode = 'P0001', detail = 'sender cannot change';
  end if;
  if old.recipient_id is not null and new.recipient_id is not null
     and new.recipient_id <> old.recipient_id then
    raise exception 'letter_immutable' using errcode = 'P0001', detail = 'recipient cannot change';
  end if;
  if new.recipient_email is not null and new.recipient_email is distinct from old.recipient_email then
    raise exception 'letter_immutable' using errcode = 'P0001', detail = 'recipient email cannot change';
  end if;
  if new.recipient_label is distinct from old.recipient_label and new.recipient_label <> '(removed)' then
    raise exception 'letter_immutable' using errcode = 'P0001', detail = 'recipient label cannot change';
  end if;

  -- Status machine.
  if new.status is distinct from old.status then
    if not (
      (old.status = 'scheduled' and new.status in ('due', 'suppressed')) or
      (old.status = 'due'       and new.status in ('sending', 'suppressed')) or
      (old.status = 'sending'   and new.status in ('delivered', 'due', 'failed', 'suppressed')) or
      (old.status = 'failed'    and new.status in ('due', 'suppressed')) or
      (old.status = 'delivered' and new.status in ('opened'))
    ) then
      raise exception 'invalid_status_transition' using errcode = 'P0001',
        detail = format('%s -> %s', old.status, new.status);
    end if;
    new.status_changed_at := now();
  end if;

  if new.opened_at is not null and new.opened_at < new.deliver_at then
    raise exception 'opened_before_delivery' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger letters_guard
  before update on public.letters
  for each row execute function public.guard_letter_update();

create or replace function public.forbid_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '%_is_append_only', tg_table_name using errcode = 'P0001';
end;
$$;

create trigger letter_contents_immutable
  before update on public.letter_contents
  for each row execute function public.forbid_update();

create trigger delivery_events_append_only
  before update on public.delivery_events
  for each row execute function public.forbid_update();

create trigger nurture_events_append_only
  before update on public.nurture_events
  for each row execute function public.forbid_update();

-- ---------------------------------------------------------------------------
-- Display-name safety (impersonation)
-- ---------------------------------------------------------------------------
create or replace function public.is_reserved_name(p_name text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(lower(coalesce(p_name, '')), '[^a-z0-9]', '', 'g') in (
    'laterletter', 'laterletterteam', 'admin', 'administrator', 'support', 'moderator',
    'official', 'staff', 'system', 'security', 'help', 'team', 'root', 'postmaster', 'noreply'
  )
$$;

create or replace function public.is_valid_time_zone(p_tz text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_tz is not null and exists (select 1 from pg_catalog.pg_timezone_names where name = p_tz)
$$;

create or replace function public.guard_profile()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.display_name is not null then
    new.display_name := btrim(regexp_replace(new.display_name, '\s+', ' ', 'g'));
    if public.is_reserved_name(new.display_name) then
      raise exception 'display_name_reserved' using errcode = 'P0001';
    end if;
  end if;
  if not public.is_valid_time_zone(new.time_zone) then
    raise exception 'time_zone_invalid' using errcode = 'P0001';
  end if;
  if public.is_reserved_name(new.handle) then
    raise exception 'handle_reserved' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger profiles_guard
  before insert or update on public.profiles
  for each row execute function public.guard_profile();

-- ---------------------------------------------------------------------------
-- Row-level security: enabled everywhere, deny by default
-- ---------------------------------------------------------------------------
alter table public.app_config enable row level security;
alter table public.profiles enable row level security;
alter table public.letters enable row level security;
alter table public.letter_contents enable row level security;
alter table public.invitations enable row level security;
alter table public.trees enable row level security;
alter table public.nurture_events enable row level security;
alter table public.blocks enable row level security;
alter table public.reports enable row level security;
alter table public.email_suppressions enable row level security;
alter table public.rate_limit_hits enable row level security;
alter table public.outbox enable row level security;
alter table public.notifications enable row level security;
alter table public.push_tokens enable row level security;
alter table public.entitlements enable row level security;
alter table public.delivery_events enable row level security;
alter table public.erasure_log enable row level security;

-- Supabase grants broad default privileges to anon/authenticated; take them all back
-- and grant only what is needed.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

-- profiles: read and edit only your own row, and only safe columns.
grant select on public.profiles to authenticated;
grant update (display_name, time_zone, notify_email, notify_push, accepts_letters_by_handle, hemisphere)
  on public.profiles to authenticated;
create policy "own profile: read" on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy "own profile: update" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- notifications: read your own, mark them read.
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
create policy "own notifications: read" on public.notifications
  for select to authenticated using (user_id = (select auth.uid()));
create policy "own notifications: mark read" on public.notifications
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- entitlements: read your own (written only by the verified webhook).
grant select on public.entitlements to authenticated;
create policy "own entitlement: read" on public.entitlements
  for select to authenticated using (user_id = (select auth.uid()));

-- trees: read your own rows directly; the other participant's tree comes via mailbox().
grant select on public.trees to authenticated;
create policy "own trees: read" on public.trees
  for select to authenticated using (owner_id = (select auth.uid()));

-- push tokens: read your own; registration goes through register_push_token().
grant select, delete on public.push_tokens to authenticated;
create policy "own push tokens: read" on public.push_tokens
  for select to authenticated using (user_id = (select auth.uid()));
create policy "own push tokens: delete" on public.push_tokens
  for delete to authenticated using (user_id = (select auth.uid()));

-- letters, letter_contents, invitations, outbox, blocks, reports, audit, config,
-- suppressions, rate limits: no client grants and no policies → no direct access.
