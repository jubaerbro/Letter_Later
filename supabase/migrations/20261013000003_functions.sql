-- LaterLetter — application functions.
--
-- Conventions
--  * SECURITY DEFINER + empty search_path; every object is schema-qualified.
--  * Functions callable by clients identify the caller with auth.uid() and never trust ids
--    supplied by the client for authorization.
--  * Worker/admin functions are granted to service_role only and accept p_now so tests can
--    run against an accelerated clock. Client-callable functions always use now().
--  * Client-facing functions that need to keep a rate-limit hit return {ok:false,...}
--    instead of raising, because raising would roll the hit back.

-- ---------------------------------------------------------------------------
-- Small helpers
-- ---------------------------------------------------------------------------
create or replace function public.log_event(p_letter_id uuid, p_event text, p_actor text, p_detail jsonb default '{}'::jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.delivery_events (letter_id, event, actor, detail)
  values (p_letter_id, p_event, p_actor, coalesce(p_detail, '{}'::jsonb));
$$;

create or replace function public.hit_rate_limit(p_bucket text, p_key text, p_max integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits integer;
begin
  insert into public.rate_limit_hits (bucket, key, window_start, hits)
  values (p_bucket, p_key, v_window, 1)
  on conflict (bucket, key, window_start) do update set hits = public.rate_limit_hits.hits + 1
  returning hits into v_hits;
  return v_hits <= p_max;
end;
$$;

create or replace function public.request_ip()
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(
    split_part(nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for', ',', 1),
    'unknown'
  )
$$;

create or replace function public.mask_email(p_email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_email is null or position('@' in p_email) = 0 then null
    else left(split_part(p_email, '@', 1), 1) || '•••@' || split_part(p_email, '@', 2)
  end
$$;

create or replace function public.normalize_email(p_email text)
returns extensions.citext
language sql
immutable
set search_path = ''
as $$
  select lower(btrim(p_email))::extensions.citext
$$;

create or replace function public.is_valid_email(p_email text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_email is not null
     and char_length(p_email) <= 254
     and p_email ~ '^[^@\s<>()",;:]+@[^@\s<>()",;:]+\.[a-z]{2,}$'
$$;

create or replace function public.verified_email(p_user_id uuid)
returns extensions.citext
language sql
stable
security definer
set search_path = ''
as $$
  select public.normalize_email(u.email)
  from auth.users u
  where u.id = p_user_id and u.email_confirmed_at is not null
$$;

create or replace function public.has_premium(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.entitlements e
    where e.user_id = p_user_id and e.premium
      and (e.expires_at is null or e.expires_at > now())
  )
$$;

create or replace function public.is_blocked(p_blocker uuid, p_blocked uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_blocker is not null and p_blocked is not null and exists (
    select 1 from public.blocks b where b.blocker_id = p_blocker and b.blocked_user_id = p_blocked
  )
$$;

-- Queue an email or push. Applies preferences, opt-outs and push-token availability, so
-- callers do not need to. Idempotent on p_key.
create or replace function public.enqueue_message(
  p_channel public.outbox_channel,
  p_template text,
  p_to_email text,
  p_to_user_id uuid,
  p_letter_id uuid,
  p_params jsonb,
  p_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.outbox_status := 'queued';
  v_error text;
  v_id uuid;
  v_profile public.profiles;
begin
  if p_to_user_id is not null then
    select * into v_profile from public.profiles where id = p_to_user_id;
  end if;

  if p_channel = 'push' then
    if p_to_user_id is null then
      return null;
    end if;
    if not coalesce(v_profile.notify_push, false)
       or not exists (select 1 from public.push_tokens t where t.user_id = p_to_user_id) then
      return null; -- nothing to send; in-app notification still exists
    end if;
  else
    if p_to_user_id is not null and p_template <> 'invitation' and not coalesce(v_profile.notify_email, true) then
      v_status := 'skipped'; v_error := 'preference_off';
    elsif p_to_email is not null and exists (
      select 1 from public.email_suppressions s where s.email = public.normalize_email(p_to_email)
    ) then
      v_status := 'skipped'; v_error := 'address_opted_out';
    end if;
  end if;

  insert into public.outbox (channel, template, to_email, to_user_id, letter_id, params, idempotency_key, status, last_error)
  values (p_channel, p_template, public.normalize_email(p_to_email), p_to_user_id, p_letter_id,
          coalesce(p_params, '{}'::jsonb), p_key, v_status, v_error)
  on conflict (idempotency_key) do nothing
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.notify_user(
  p_user_id uuid, p_kind text, p_title text, p_body text, p_letter_id uuid, p_key text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null then
    return;
  end if;
  insert into public.notifications (user_id, kind, title, body, letter_id)
  values (p_user_id, p_kind, p_title, p_body, p_letter_id);
  perform public.enqueue_message('push', p_kind, null, p_user_id, p_letter_id,
    jsonb_build_object('title', p_title, 'body', p_body, 'letter_id', p_letter_id), 'push:' || p_key);
end;
$$;

-- ---------------------------------------------------------------------------
-- Profiles: generated personal address on sign-up
-- ---------------------------------------------------------------------------
create or replace function public.generate_handle()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_first text[] := array['willow','maple','cedar','birch','fern','moss','river','meadow','amber','clover',
                          'hazel','juniper','linden','sage','aspen','rowan','ivy','olive','pine','wren',
                          'robin','lark','dawn','dusk','misty','sunny','quiet','gentle','golden','silver'];
  v_second text[] := array['leaf','brook','grove','petal','acorn','breeze','cloud','field','glade','harbor',
                           'hollow','lantern','meadow','orchard','pebble','ridge','seed','shore','sprout','star',
                           'stone','trail','valley','vale','wood','bloom','branch','canyon','garden','spring'];
  v_handle text;
begin
  for i in 1..50 loop
    v_handle := v_first[1 + floor(random() * array_length(v_first, 1))::int] || '-' ||
                v_second[1 + floor(random() * array_length(v_second, 1))::int] || '-' ||
                (10 + floor(random() * 90)::int)::text;
    if not exists (select 1 from public.profiles where handle = v_handle::extensions.citext) then
      return v_handle;
    end if;
  end loop;
  return 'friend-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, handle) values (new.id, public.generate_handle())
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.complete_onboarding(
  p_display_name text, p_time_zone text, p_hemisphere text, p_accept_terms boolean, p_confirm_age boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  if not coalesce(p_accept_terms, false) then return jsonb_build_object('ok', false, 'error', 'terms_required'); end if;
  if not coalesce(p_confirm_age, false) then return jsonb_build_object('ok', false, 'error', 'age_required'); end if;
  if p_display_name is null or char_length(btrim(p_display_name)) not between 1 and 40 then
    return jsonb_build_object('ok', false, 'error', 'display_name_invalid');
  end if;
  if public.is_reserved_name(p_display_name) then
    return jsonb_build_object('ok', false, 'error', 'display_name_reserved');
  end if;
  if not public.is_valid_time_zone(p_time_zone) then
    return jsonb_build_object('ok', false, 'error', 'time_zone_invalid');
  end if;

  update public.profiles set
    display_name = p_display_name,
    time_zone = p_time_zone,
    hemisphere = case when p_hemisphere = 'south' then 'south' else 'north' end,
    terms_accepted_at = coalesce(terms_accepted_at, now()),
    age_confirmed_at = coalesce(age_confirmed_at, now()),
    onboarded_at = coalesce(onboarded_at, now())
  where id = v_uid;

  perform public.attach_letters_for_user(v_uid);
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.change_handle(p_handle text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_handle text := lower(btrim(p_handle));
  v_changed timestamptz;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  if v_handle !~ '^[a-z0-9](?:[a-z0-9-]{1,22})[a-z0-9]$' or v_handle like '%--%' then
    return jsonb_build_object('ok', false, 'error', 'handle_invalid');
  end if;
  if public.is_reserved_name(v_handle) then
    return jsonb_build_object('ok', false, 'error', 'handle_reserved');
  end if;
  select handle_changed_at into v_changed from public.profiles where id = v_uid;
  if v_changed is not null and v_changed > now() - interval '30 days' then
    return jsonb_build_object('ok', false, 'error', 'handle_cooldown',
      'available_at', v_changed + interval '30 days');
  end if;
  if exists (select 1 from public.profiles where handle = v_handle::extensions.citext and id <> v_uid) then
    return jsonb_build_object('ok', false, 'error', 'handle_taken');
  end if;
  update public.profiles set handle = v_handle, handle_changed_at = now() where id = v_uid;
  return jsonb_build_object('ok', true, 'handle', v_handle);
end;
$$;

-- Exact-match lookup only. There is no search or directory.
create or replace function public.resolve_recipient(p_handle text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  if not public.hit_rate_limit('resolve_recipient', v_uid::text, 30, 3600) then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;
  select * into v_profile from public.profiles
  where handle = lower(btrim(ltrim(p_handle, '@')))::extensions.citext
    and accepts_letters_by_handle and onboarded_at is not null;
  if v_profile.id is null or public.is_blocked(v_profile.id, v_uid) then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  return jsonb_build_object('ok', true, 'handle', v_profile.handle::text, 'display_name', v_profile.display_name,
                            'is_self', v_profile.id = v_uid);
end;
$$;

-- ---------------------------------------------------------------------------
-- Letter creation (called by the create-letter Edge Function with the service role,
-- after it authenticated the user and encrypted the content).
-- ---------------------------------------------------------------------------
create or replace function public.create_letter_record(
  p_sender_id uuid,
  p_idempotency_key text,
  p_recipient_kind text,         -- 'handle' | 'email'
  p_recipient_value text,
  p_reveal_mode public.reveal_mode,
  p_show_subject boolean,
  p_show_preview boolean,
  p_envelope_subject text,
  p_envelope_preview text,
  p_sender_time_zone text,
  p_deliver_at timestamptz,
  p_ciphertext text,
  p_iv text,
  p_key_version integer,
  p_invite_token_hash text,
  p_invite_token_enc text,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sender public.profiles;
  v_existing uuid;
  v_recipient_id uuid;
  v_recipient_email extensions.citext;
  v_label text;
  v_show_subject boolean;
  v_show_preview boolean;
  v_letter_id uuid;
  v_is_self boolean := false;
  v_invited boolean := false;
  v_invite_status text;
  v_recent integer;
begin
  -- Idempotency: a retried request returns the letter that was already created.
  select id into v_existing from public.letters
  where sender_id = p_sender_id and idempotency_key = p_idempotency_key;
  if v_existing is not null then
    return jsonb_build_object('ok', true, 'letter_id', v_existing, 'duplicate', true);
  end if;

  select * into v_sender from public.profiles where id = p_sender_id;
  if v_sender.id is null or v_sender.onboarded_at is null or public.verified_email(p_sender_id) is null then
    raise exception 'sender_not_ready' using errcode = 'P0001';
  end if;

  if not public.is_valid_time_zone(p_sender_time_zone) then
    raise exception 'time_zone_invalid' using errcode = 'P0001';
  end if;

  -- Schedule validation (the Edge Function validates too; this is the authority).
  if p_deliver_at < p_now + make_interval(secs => public.config_int('min_delivery_lead_seconds')) then
    raise exception 'deliver_at_too_soon' using errcode = 'P0001';
  end if;
  if p_deliver_at > p_now + make_interval(years => public.config_int('max_delivery_years')) then
    raise exception 'deliver_at_too_far' using errcode = 'P0001';
  end if;

  -- Recipient resolution.
  if p_recipient_kind = 'handle' then
    select id into v_recipient_id from public.profiles
    where handle = lower(btrim(ltrim(p_recipient_value, '@')))::extensions.citext
      and accepts_letters_by_handle and onboarded_at is not null;
    if v_recipient_id is null then
      raise exception 'recipient_not_found' using errcode = 'P0001';
    end if;
    v_label := '@' || lower(btrim(ltrim(p_recipient_value, '@')));
  elsif p_recipient_kind = 'email' then
    v_recipient_email := public.normalize_email(p_recipient_value);
    if not public.is_valid_email(v_recipient_email::text) then
      raise exception 'recipient_email_invalid' using errcode = 'P0001';
    end if;
    select u.id into v_recipient_id from auth.users u
    where public.normalize_email(u.email) = v_recipient_email and u.email_confirmed_at is not null
    limit 1;
    v_label := v_recipient_email::text;
  else
    raise exception 'recipient_kind_invalid' using errcode = 'P0001';
  end if;

  v_is_self := v_recipient_id = p_sender_id;

  if public.is_blocked(v_recipient_id, p_sender_id) then
    -- Deliberately generic: do not reveal that the recipient blocked the sender.
    raise exception 'recipient_unavailable' using errcode = 'P0001';
  end if;

  -- Anti-abuse rate limits.
  select count(*) into v_recent from public.letters
  where sender_id = p_sender_id and created_at > p_now - interval '24 hours';
  if v_recent >= public.config_int('max_letters_per_day') then
    raise exception 'rate_limited_daily' using errcode = 'P0001';
  end if;

  if not v_is_self then
    select count(*) into v_recent from public.letters
    where sender_id = p_sender_id and created_at > p_now - interval '7 days'
      and ((v_recipient_id is not null and recipient_id = v_recipient_id)
        or (v_recipient_email is not null and recipient_email = v_recipient_email));
    if v_recent >= public.config_int('max_letters_same_recipient_per_week') then
      raise exception 'rate_limited_recipient' using errcode = 'P0001';
    end if;
  end if;

  if v_recipient_id is null then
    select count(distinct recipient_email) into v_recent from public.letters
    where sender_id = p_sender_id and recipient_id is null and created_at > p_now - interval '24 hours'
      and recipient_email <> v_recipient_email;
    if v_recent >= public.config_int('max_new_invites_per_day') then
      raise exception 'rate_limited_invites' using errcode = 'P0001';
    end if;
    if p_invite_token_hash is null or p_invite_token_enc is null then
      raise exception 'invite_token_required' using errcode = 'P0001';
    end if;
  end if;

  -- Reveal rules.
  v_show_subject := case p_reveal_mode
    when 'name_subject_date' then true when 'anonymous' then coalesce(p_show_subject, false) else false end;
  v_show_preview := case p_reveal_mode
    when 'name_and_preview' then true when 'anonymous' then coalesce(p_show_preview, false) else false end;
  if v_show_subject and nullif(btrim(p_envelope_subject), '') is null then
    raise exception 'envelope_subject_required' using errcode = 'P0001';
  end if;
  if v_show_preview and nullif(btrim(p_envelope_preview), '') is null then
    raise exception 'envelope_preview_required' using errcode = 'P0001';
  end if;

  insert into public.letters (
    sender_id, recipient_id, recipient_email, recipient_label, reveal_mode, show_subject, show_preview,
    envelope_sender_name, envelope_sender_handle, envelope_subject, envelope_preview,
    sender_time_zone, deliver_at, created_at, idempotency_key, accepted_at, status_changed_at
  ) values (
    p_sender_id, v_recipient_id, v_recipient_email, v_label, p_reveal_mode, v_show_subject, v_show_preview,
    case when p_reveal_mode = 'anonymous' then null else v_sender.display_name end,
    case when p_reveal_mode = 'anonymous' then null else v_sender.handle::text end,
    case when v_show_subject then btrim(p_envelope_subject) end,
    case when v_show_preview then btrim(p_envelope_preview) end,
    p_sender_time_zone, p_deliver_at, p_now, p_idempotency_key,
    case when v_is_self then p_now end, p_now
  ) returning id into v_letter_id;

  insert into public.letter_contents (letter_id, ciphertext, iv, key_version)
  values (v_letter_id, p_ciphertext, p_iv, p_key_version);

  insert into public.trees (letter_id, owner_id, role, created_at) values (v_letter_id, p_sender_id, 'sender', p_now);

  perform public.log_event(v_letter_id, 'created', 'sender',
    jsonb_build_object('reveal_mode', p_reveal_mode, 'deliver_at', p_deliver_at,
                       'recipient_registered', v_recipient_id is not null));

  if v_recipient_id is null then
    -- Unregistered recipient: create invitation and queue the email right away.
    insert into public.invitations (letter_id, email, token_hash, purpose, created_at, expires_at)
    values (v_letter_id, v_recipient_email, p_invite_token_hash, 'invite', p_now,
            p_now + make_interval(days => public.config_int('invitation_ttl_days')));
    v_invited := true;

    select count(*) into v_recent from public.outbox o
    where o.template = 'invitation' and o.to_email = v_recipient_email
      and o.created_at > p_now - interval '24 hours' and o.status <> 'skipped';

    perform public.enqueue_message('email', 'invitation', v_recipient_email::text, null, v_letter_id,
      jsonb_build_object('token_enc', p_invite_token_enc), 'invitation:' || v_letter_id);

    if v_recent >= public.config_int('max_invite_emails_per_address_per_day') then
      update public.outbox set status = 'skipped', last_error = 'address_daily_limit'
      where idempotency_key = 'invitation:' || v_letter_id;
    end if;

    select status::text into v_invite_status from public.outbox where idempotency_key = 'invitation:' || v_letter_id;
    perform public.log_event(v_letter_id, 'invitation_' || v_invite_status, 'system');
  elsif not v_is_self then
    -- Registered recipient: in-app notification, push and email right away.
    perform public.notify_user(v_recipient_id, 'letter_waiting', 'A new seed has arrived',
      'Someone planted a letter for you. Accept it to start growing your tree.', v_letter_id,
      'waiting:' || v_letter_id);
    perform public.enqueue_message('email', 'letter_waiting', null, v_recipient_id, v_letter_id,
      '{}'::jsonb, 'waiting-email:' || v_letter_id);
    perform public.log_event(v_letter_id, 'recipient_notified', 'system');
  end if;

  return jsonb_build_object('ok', true, 'letter_id', v_letter_id, 'duplicate', false,
                            'invited', v_invited, 'is_self', v_is_self);
end;
$$;

-- ---------------------------------------------------------------------------
-- Recipients: attach by verified email, accept, claim invitation, preview
-- ---------------------------------------------------------------------------
create or replace function public.attach_letters_for_user(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email extensions.citext := public.verified_email(p_user_id);
  v_count integer := 0;
  r record;
begin
  if v_email is null then
    return 0;
  end if;
  for r in
    select id, sender_id from public.letters
    where recipient_id is null and recipient_email = v_email and status <> 'suppressed'
    for update
  loop
    if public.is_blocked(p_user_id, r.sender_id) then
      continue;
    end if;
    update public.letters set recipient_id = p_user_id,
      accepted_at = case when sender_id = p_user_id then now() else accepted_at end
    where id = r.id;
    perform public.log_event(r.id, 'recipient_attached', 'system');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.attach_my_letters()
returns integer
language sql
security definer
set search_path = ''
as $$
  select public.attach_letters_for_user(auth.uid())
$$;

create or replace function public.accept_letter_internal(p_user_id uuid, p_letter_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_letter public.letters;
  v_name text;
begin
  select * into v_letter from public.letters where id = p_letter_id for update;
  if v_letter.id is null or v_letter.recipient_id is distinct from p_user_id or v_letter.status = 'suppressed' then
    return false;
  end if;
  if v_letter.accepted_at is not null then
    return true;
  end if;

  update public.letters set accepted_at = now(), recipient_hidden_at = null where id = p_letter_id;
  insert into public.trees (letter_id, owner_id, role) values (p_letter_id, p_user_id, 'recipient')
  on conflict do nothing;
  perform public.log_event(p_letter_id, 'accepted', 'recipient');

  if v_letter.sender_id is not null and v_letter.sender_id <> p_user_id then
    select display_name into v_name from public.profiles where id = p_user_id;
    perform public.notify_user(v_letter.sender_id, 'letter_accepted', 'Your letter was accepted 🌱',
      coalesce(v_name, 'Your recipient') || ' is now growing a tree for your letter too.',
      p_letter_id, 'accepted:' || p_letter_id);
    perform public.enqueue_message('email', 'letter_accepted', null, v_letter.sender_id, p_letter_id,
      jsonb_build_object('recipient_name', v_name), 'accepted-email:' || p_letter_id);
  end if;
  return true;
end;
$$;

create or replace function public.accept_letter(p_letter_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  if public.accept_letter_internal(auth.uid(), p_letter_id) then
    return jsonb_build_object('ok', true);
  end if;
  return jsonb_build_object('ok', false, 'error', 'not_found');
end;
$$;

create or replace function public.decline_letter(p_letter_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.letters set recipient_hidden_at = now()
  where id = p_letter_id and recipient_id = auth.uid() and recipient_id is distinct from sender_id;
  get diagnostics v_count = row_count;
  if v_count = 0 then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  perform public.log_event(p_letter_id, 'recipient_hid_letter', 'recipient');
  return jsonb_build_object('ok', true);
end;
$$;

-- Public teaser for the claim page. Bearer token = 256 random bits; also rate limited per IP.
create or replace function public.invitation_preview(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.invitations;
  v_letter public.letters;
begin
  if not public.hit_rate_limit('invitation_preview', public.request_ip(), 30, 600) then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;
  select * into v_inv from public.invitations
  where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');
  if v_inv.id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;
  select * into v_letter from public.letters where id = v_inv.letter_id;
  if v_letter.id is null or v_letter.status = 'suppressed' then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;
  return jsonb_build_object(
    'ok', true,
    'expired', v_inv.expires_at < now() and v_inv.claimed_at is null,
    'claimed', v_inv.claimed_at is not null,
    'email_hint', public.mask_email(v_inv.email::text),
    'sender_name', v_letter.envelope_sender_name,
    'sender_handle', v_letter.envelope_sender_handle,
    'subject', v_letter.envelope_subject,
    'preview', v_letter.envelope_preview,
    'deliver_at', v_letter.deliver_at,
    'sender_time_zone', v_letter.sender_time_zone,
    'arrived', v_letter.status in ('delivered', 'opened') and v_letter.deliver_at <= now()
  );
end;
$$;

create or replace function public.claim_invitation(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_inv public.invitations;
  v_email extensions.citext;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  if not public.hit_rate_limit('claim_invitation', v_uid::text, 20, 3600) then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  select * into v_inv from public.invitations
  where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
  for update;
  if v_inv.id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;
  if v_inv.claimed_at is not null and v_inv.claimed_by is distinct from v_uid then
    return jsonb_build_object('ok', false, 'error', 'already_claimed');
  end if;
  if v_inv.claimed_at is null and v_inv.expires_at < now() then
    return jsonb_build_object('ok', false, 'error', 'expired', 'email_hint', public.mask_email(v_inv.email::text));
  end if;

  -- Ownership: the signed-in account must have verified this exact email address.
  v_email := public.verified_email(v_uid);
  if v_email is null or v_email <> v_inv.email then
    return jsonb_build_object('ok', false, 'error', 'email_mismatch', 'email_hint', public.mask_email(v_inv.email::text));
  end if;

  perform public.attach_letters_for_user(v_uid);
  if not public.accept_letter_internal(v_uid, v_inv.letter_id) then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;
  update public.invitations set claimed_at = coalesce(claimed_at, now()), claimed_by = v_uid where id = v_inv.id;
  perform public.log_event(v_inv.letter_id, 'invitation_claimed', 'recipient');
  return jsonb_build_object('ok', true, 'letter_id', v_inv.letter_id);
end;
$$;

-- Status of the "a letter is waiting for you" email, whether the recipient already had an
-- account (letter_waiting) or not (invitation). Senders see the same thing either way, so
-- sending a letter can never be used to discover whether an email address has an account.
create or replace function public.recipient_email_status(p_letter_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select status::text from public.outbox
  where idempotency_key in ('invitation:' || p_letter_id, 'waiting-email:' || p_letter_id)
  order by created_at
  limit 1
$$;

-- ---------------------------------------------------------------------------
-- Mailbox: the only way clients read letter metadata. Applies reveal rules.
-- ---------------------------------------------------------------------------
create or replace function public.mailbox(p_letter_id uuid default null)
returns table (
  letter_id uuid,
  direction text,            -- 'received' | 'sent' | 'self'
  counterpart_name text,     -- null when anonymous
  counterpart_handle text,
  is_anonymous boolean,
  subject text,              -- envelope subject (only if revealed before opening)
  preview text,
  deliver_at timestamptz,
  sender_time_zone text,
  created_at timestamptz,
  display_status text,       -- waiting | arrived | opened | delivered | delayed | closed
  accepted boolean,
  invite_status text,        -- sender only: email status of the invitation
  my_tree_id uuid,
  my_tree_style text,
  my_tree_points integer,
  their_tree_style text,
  their_tree_points integer,
  their_tree_exists boolean,
  delivered_at timestamptz,
  opened_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (select auth.uid() as id)
  -- Received (including letters to yourself)
  select
    l.id,
    case when l.sender_id = me.id then 'self' else 'received' end,
    l.envelope_sender_name,
    l.envelope_sender_handle,
    l.reveal_mode = 'anonymous',
    l.envelope_subject,
    l.envelope_preview,
    l.deliver_at,
    l.sender_time_zone,
    l.created_at,
    case
      when l.status in ('delivered') and l.deliver_at <= now() then 'arrived'
      when l.status = 'opened' then 'opened'
      else 'waiting'
    end,
    l.accepted_at is not null,
    null::text,
    mine.id, mine.style, mine.points,
    theirs.style, theirs.points, theirs.id is not null,
    l.delivered_at, l.opened_at
  from public.letters l
  cross join me
  left join public.trees mine on mine.letter_id = l.id and mine.owner_id = me.id
  left join public.trees theirs on theirs.letter_id = l.id and theirs.owner_id <> me.id
  where l.recipient_id = me.id
    and l.recipient_hidden_at is null
    and l.status <> 'suppressed'
    and (l.sender_id is distinct from me.id or l.sender_hidden_at is null)
    and (p_letter_id is null or l.id = p_letter_id)
  union all
  -- Sent to others
  select
    l.id,
    'sent',
    coalesce(rp.display_name, l.recipient_label),
    rp.handle::text,
    false,
    l.envelope_subject,
    l.envelope_preview,
    l.deliver_at,
    l.sender_time_zone,
    l.created_at,
    case
      when l.status = 'opened' then 'opened'
      when l.status = 'delivered' then 'delivered'
      when l.status = 'failed' then 'delayed'
      when l.status = 'suppressed' then 'closed'
      else 'waiting'
    end,
    l.accepted_at is not null,
    public.recipient_email_status(l.id),
    mine.id, mine.style, mine.points,
    theirs.style, theirs.points, theirs.id is not null,
    l.delivered_at, l.opened_at
  from public.letters l
  cross join me
  left join public.profiles rp on rp.id = l.recipient_id and l.accepted_at is not null
  left join public.trees mine on mine.letter_id = l.id and mine.owner_id = me.id
  left join public.trees theirs on theirs.letter_id = l.id and theirs.owner_id <> me.id
  where l.sender_id = me.id
    and l.recipient_id is distinct from me.id
    and l.sender_hidden_at is null
    and (p_letter_id is null or l.id = p_letter_id)
$$;

create or replace function public.hide_sent_letter(p_letter_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  -- Hiding is only for the sender's own list; it never cancels or changes delivery.
  update public.letters set sender_hidden_at = now()
  where id = p_letter_id and sender_id = auth.uid() and status in ('delivered', 'opened', 'suppressed');
  get diagnostics v_count = row_count;
  return jsonb_build_object('ok', v_count > 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- Letter content access (used by the letter-content Edge Function, service role)
-- ---------------------------------------------------------------------------
create or replace function public.letter_content_access(p_user_id uuid, p_letter_id uuid, p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_letter public.letters;
  v_content public.letter_contents;
  v_role text;
begin
  select * into v_letter from public.letters where id = p_letter_id;
  if v_letter.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_letter.recipient_id = p_user_id and v_letter.recipient_hidden_at is null
     and v_letter.status in ('delivered', 'opened') and v_letter.deliver_at <= p_now then
    v_role := 'recipient';
  elsif v_letter.sender_id = p_user_id and v_letter.sender_hidden_at is null then
    v_role := 'sender';
  end if;

  if v_role is null then
    -- Same response whether it does not exist, is sealed, or belongs to someone else.
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select * into v_content from public.letter_contents where letter_id = p_letter_id;
  return jsonb_build_object(
    'ok', true, 'role', v_role,
    'ciphertext', v_content.ciphertext, 'iv', v_content.iv, 'key_version', v_content.key_version,
    'idempotency_key', v_letter.idempotency_key,
    'first_open', v_role = 'recipient' and v_letter.status = 'delivered'
  );
end;
$$;


create or replace function public.mark_letter_opened(p_user_id uuid, p_letter_id uuid, p_now timestamptz default now())
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_letter public.letters;
begin
  select * into v_letter from public.letters where id = p_letter_id for update;
  if v_letter.id is null or v_letter.recipient_id is distinct from p_user_id
     or v_letter.status <> 'delivered' or v_letter.deliver_at > p_now then
    return false;
  end if;
  update public.letters set status = 'opened', opened_at = p_now where id = p_letter_id;
  perform public.log_event(p_letter_id, 'opened', 'recipient');
  if v_letter.sender_id is not null and v_letter.sender_id <> p_user_id then
    perform public.notify_user(v_letter.sender_id, 'letter_opened', 'Your letter was opened 💌',
      'The wait is over — your words have been read.', p_letter_id, 'opened:' || p_letter_id);
  end if;
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Trees: nurturing and styles. Nothing here touches letters.deliver_at.
-- ---------------------------------------------------------------------------
create or replace function public.tree_styles_for(p_user_id uuid)
returns table (style text, unlocked boolean, requirement text)
language sql
stable
security definer
set search_path = ''
as $$
  with stats as (
    select
      (select count(*) from public.nurture_events n where n.user_id = p_user_id) as nurtures,
      (select count(*) from public.letters l
        where (l.recipient_id = p_user_id or l.sender_id = p_user_id) and l.status = 'opened') as opened,
      (select count(*) from public.letters l where l.sender_id = p_user_id) as sent,
      public.has_premium(p_user_id) as premium
  )
  select s.style, s.unlocked, s.requirement from stats, lateral (values
    ('oak', true, 'Always yours'),
    ('cherry', true, 'Always yours'),
    ('willow', stats.premium or stats.nurtures >= 10, 'Care for trees 10 times'),
    ('maple', stats.premium or stats.opened >= 1, 'Open or have a letter opened'),
    ('birch', stats.premium or stats.sent >= 3, 'Plant 3 letters'),
    ('lantern', stats.premium, 'LaterLetter Plus'),
    ('starlight', stats.premium, 'LaterLetter Plus')
  ) as s(style, unlocked, requirement)
$$;

create or replace function public.my_tree_styles()
returns table (style text, unlocked boolean, requirement text)
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.tree_styles_for(auth.uid())
$$;

create or replace function public.set_tree_style(p_tree_id uuid, p_style text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not exists (select 1 from public.trees where id = p_tree_id and owner_id = v_uid) then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if not exists (select 1 from public.tree_styles_for(v_uid) s where s.style = p_style and s.unlocked) then
    return jsonb_build_object('ok', false, 'error', 'style_locked');
  end if;
  update public.trees set style = p_style where id = p_tree_id;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.nurture_tree(p_tree_id uuid, p_kind public.nurture_kind)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_tree public.trees;
  v_status public.letter_status;
  v_tz text;
  v_day date;
  v_points integer;
  v_inserted integer;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  select * into v_tree from public.trees where id = p_tree_id and owner_id = v_uid for update;
  if v_tree.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  select status into v_status from public.letters where id = v_tree.letter_id;
  if v_status in ('delivered', 'opened', 'suppressed') then
    return jsonb_build_object('ok', false, 'error', 'already_bloomed', 'points', v_tree.points);
  end if;

  select time_zone into v_tz from public.profiles where id = v_uid;
  begin
    v_day := (now() at time zone coalesce(v_tz, 'UTC'))::date;
  exception when others then
    v_day := (now() at time zone 'UTC')::date;
  end;

  v_points := case p_kind when 'moment' then 2 else 1 end;
  if public.has_premium(v_uid) then
    v_points := v_points * 2;
  end if;

  insert into public.nurture_events (tree_id, user_id, kind, local_day, points)
  values (p_tree_id, v_uid, p_kind, v_day, v_points)
  on conflict (tree_id, kind, local_day) do nothing;
  get diagnostics v_inserted = row_count;

  if v_inserted = 0 then
    -- Gentle daily rhythm; no streaks, no penalties.
    return jsonb_build_object('ok', true, 'added', 0, 'already_today', true, 'points', v_tree.points);
  end if;

  update public.trees set points = points + v_points, last_nurtured_at = now()
  where id = p_tree_id returning points into v_points;
  return jsonb_build_object('ok', true, 'added', v_points - v_tree.points, 'already_today', false, 'points', v_points);
end;
$$;

create or replace function public.tree_care_today(p_tree_id uuid)
returns table (kind public.nurture_kind)
language sql
stable
security definer
set search_path = ''
as $$
  select n.kind from public.nurture_events n
  join public.trees t on t.id = n.tree_id and t.owner_id = auth.uid()
  join public.profiles p on p.id = auth.uid()
  where n.tree_id = p_tree_id and n.local_day = (now() at time zone p.time_zone)::date
$$;

-- ---------------------------------------------------------------------------
-- Safety: block, unblock, report
-- ---------------------------------------------------------------------------
create or replace function public.block_sender_of_letter(p_letter_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_letter public.letters;
  r record;
begin
  select * into v_letter from public.letters where id = p_letter_id and recipient_id = v_uid;
  if v_letter.id is null or v_letter.sender_id is null or v_letter.sender_id = v_uid then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  insert into public.blocks (blocker_id, blocked_user_id, label)
  values (v_uid, v_letter.sender_id,
          case when v_letter.reveal_mode = 'anonymous'
               then 'Anonymous sender (letter from ' || to_char(v_letter.created_at, 'Mon YYYY') || ')'
               else v_letter.envelope_sender_name end)
  on conflict (blocker_id, blocked_user_id) do nothing;

  for r in
    select id, status from public.letters
    where sender_id = v_letter.sender_id and recipient_id = v_uid
    for update
  loop
    if r.status in ('scheduled', 'due', 'failed') then
      update public.letters set status = 'suppressed', suppressed_reason = 'recipient_blocked' where id = r.id;
      perform public.log_event(r.id, 'suppressed', 'recipient', '{"reason":"recipient_blocked"}');
    end if;
    update public.letters set recipient_hidden_at = coalesce(recipient_hidden_at, now()) where id = r.id;
  end loop;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.my_blocks()
returns table (block_id uuid, label text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select b.id, b.label, b.created_at from public.blocks b
  where b.blocker_id = auth.uid() order by b.created_at desc
$$;

create or replace function public.unblock(p_block_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from public.blocks where id = p_block_id and blocker_id = auth.uid();
  get diagnostics v_count = row_count;
  return jsonb_build_object('ok', v_count > 0);
end;
$$;

create or replace function public.report_letter(p_letter_id uuid, p_reason public.report_reason, p_details text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_letter public.letters;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  if not public.hit_rate_limit('report', v_uid::text, 10, 86400) then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;
  select * into v_letter from public.letters
  where id = p_letter_id and (recipient_id = v_uid or sender_id = v_uid);
  if v_letter.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  insert into public.reports (reporter_id, letter_id, reported_user_id, reason, details)
  values (v_uid, p_letter_id,
          case when v_letter.recipient_id = v_uid then v_letter.sender_id else v_letter.recipient_id end,
          p_reason, nullif(btrim(left(p_details, 1000)), ''));
  perform public.log_event(p_letter_id, 'reported', 'participant', jsonb_build_object('reason', p_reason));
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Push tokens
-- ---------------------------------------------------------------------------
create or replace function public.register_push_token(p_token text, p_platform text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  if p_token is null or char_length(p_token) > 255 or p_platform not in ('android', 'ios', 'web') then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;
  -- A device token belongs to whoever is signed in on that device now.
  insert into public.push_tokens (token, user_id, platform, updated_at)
  values (p_token, auth.uid(), p_platform, now())
  on conflict (token) do update set user_id = excluded.user_id, platform = excluded.platform, updated_at = now();
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Delivery worker primitives (service role only)
-- ---------------------------------------------------------------------------
create or replace function public.retry_backoff(p_attempts integer)
returns interval
language sql
immutable
set search_path = ''
as $$
  -- 1m, 5m, 25m, ~2h, then capped at 6h
  select least(make_interval(secs => 60 * power(5, greatest(p_attempts - 1, 0))), interval '6 hours')
$$;

create or replace function public.mark_due_letters(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
  r record;
begin
  for r in
    select id from public.letters
    where status = 'scheduled' and deliver_at <= p_now
    order by deliver_at
    limit 1000
    for update skip locked
  loop
    update public.letters set status = 'due' where id = r.id;
    perform public.log_event(r.id, 'due', 'worker');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.claim_due_letters(p_worker text, p_limit integer default 50, p_now timestamptz default now())
returns table (letter_id uuid, attempts integer)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with candidates as (
    select l.id from public.letters l
    where (l.status = 'due' and l.deliver_at <= p_now and (l.next_attempt_at is null or l.next_attempt_at <= p_now))
       or (l.status = 'sending' and l.locked_at < p_now - interval '5 minutes')
    order by l.deliver_at
    limit p_limit
    for update skip locked
  )
  -- A stale 'sending' row (worker died) is simply re-locked by this worker.
  update public.letters l
  set status = 'sending', locked_at = p_now, locked_by = p_worker, attempts = l.attempts + 1
  from candidates c
  where l.id = c.id
  returning l.id, l.attempts;
end;
$$;

create or replace function public.complete_letter_delivery(
  p_letter_id uuid, p_worker text, p_arrival_token_hash text, p_arrival_token_enc text, p_now timestamptz default now()
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_letter public.letters;
  v_reason text;
begin
  select * into v_letter from public.letters where id = p_letter_id for update;
  if v_letter.id is null or v_letter.status <> 'sending' or v_letter.locked_by is distinct from p_worker then
    return 'noop'; -- another worker owns it or it is already done: never deliver twice
  end if;

  if v_letter.recipient_id is null and v_letter.recipient_email is null then
    v_reason := 'no_recipient';
  elsif public.is_blocked(v_letter.recipient_id, v_letter.sender_id) then
    v_reason := 'recipient_blocked';
  end if;

  if v_reason is not null then
    update public.letters set status = 'suppressed', suppressed_reason = v_reason, locked_at = null, locked_by = null
    where id = p_letter_id;
    perform public.log_event(p_letter_id, 'suppressed', 'worker', jsonb_build_object('reason', v_reason));
    return 'suppressed';
  end if;

  update public.letters
  set status = 'delivered', delivered_at = p_now, locked_at = null, locked_by = null, last_error = null
  where id = p_letter_id;
  perform public.log_event(p_letter_id, 'delivered', 'worker', jsonb_build_object('attempts', v_letter.attempts));

  if v_letter.recipient_id is not null then
    perform public.notify_user(v_letter.recipient_id, 'letter_arrived', 'A letter has arrived ✉️',
      'The day has come. Your sealed letter is ready to open.', p_letter_id, 'arrived:' || p_letter_id);
    perform public.enqueue_message('email', 'letter_arrived', null, v_letter.recipient_id, p_letter_id,
      '{}'::jsonb, 'arrival-email:' || p_letter_id);
  else
    -- Not yet claimed: a fresh claim link goes with the arrival email.
    if p_arrival_token_hash is not null then
      insert into public.invitations (letter_id, email, token_hash, purpose, created_at, expires_at)
      values (p_letter_id, v_letter.recipient_email, p_arrival_token_hash, 'arrival', p_now,
              p_now + make_interval(days => public.config_int('invitation_ttl_days')))
      on conflict (token_hash) do nothing;
    end if;
    perform public.enqueue_message('email', 'letter_arrived', v_letter.recipient_email::text, null, p_letter_id,
      jsonb_build_object('token_enc', p_arrival_token_enc), 'arrival-email:' || p_letter_id);
  end if;

  if v_letter.sender_id is not null and v_letter.sender_id is distinct from v_letter.recipient_id then
    perform public.notify_user(v_letter.sender_id, 'letter_delivered', 'Your letter has arrived',
      'The letter you planted reached its day.', p_letter_id, 'delivered:' || p_letter_id);
  end if;
  return 'delivered';
end;
$$;

create or replace function public.fail_letter_delivery(p_letter_id uuid, p_worker text, p_error text, p_now timestamptz default now())
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_letter public.letters;
begin
  select * into v_letter from public.letters where id = p_letter_id for update;
  if v_letter.id is null or v_letter.status <> 'sending' or v_letter.locked_by is distinct from p_worker then
    return 'noop';
  end if;
  if v_letter.attempts >= public.config_int('max_delivery_attempts') then
    update public.letters set status = 'failed', last_error = left(p_error, 500), locked_at = null, locked_by = null
    where id = p_letter_id;
    perform public.log_event(p_letter_id, 'failed', 'worker', jsonb_build_object('attempts', v_letter.attempts));
    return 'failed';
  end if;
  update public.letters
  set status = 'due', last_error = left(p_error, 500), locked_at = null, locked_by = null,
      next_attempt_at = p_now + public.retry_backoff(v_letter.attempts)
  where id = p_letter_id;
  perform public.log_event(p_letter_id, 'retry_scheduled', 'worker',
    jsonb_build_object('attempts', v_letter.attempts, 'next_attempt_at', p_now + public.retry_backoff(v_letter.attempts)));
  return 'retry';
end;
$$;

create or replace function public.claim_outbox(
  p_worker text, p_limit integer default 50, p_now timestamptz default now(), p_letter_id uuid default null
)
returns table (
  id uuid, channel public.outbox_channel, template text, to_email text, to_user_id uuid, letter_id uuid,
  params jsonb, attempts integer, push_tokens text[]
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  p_now := coalesce(p_now, now()); -- null = use the database clock (immediate sends)
  return query
  with candidates as (
    select o.id from public.outbox o
    where ((o.status = 'queued' and o.next_attempt_at <= p_now)
        or (o.status = 'sending' and o.locked_at < p_now - interval '5 minutes'))
      and (p_letter_id is null or o.letter_id = p_letter_id)
    order by o.next_attempt_at
    limit p_limit
    for update skip locked
  ), claimed as (
    update public.outbox o
    set status = 'sending', locked_at = p_now, locked_by = p_worker, attempts = o.attempts + 1
    from candidates c where o.id = c.id
    returning o.*
  )
  select c.id, c.channel, c.template,
         coalesce(c.to_email::text, public.verified_email(c.to_user_id)::text),
         c.to_user_id, c.letter_id, c.params, c.attempts,
         case when c.channel = 'push'
              then array(select t.token from public.push_tokens t where t.user_id = c.to_user_id)
              else null end
  from claimed c;
end;
$$;

create or replace function public.complete_outbox(p_id uuid, p_worker text, p_provider_message_id text, p_now timestamptz default now())
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.outbox;
begin
  update public.outbox
  set status = 'provider_accepted', provider_message_id = left(p_provider_message_id, 200), sent_at = coalesce(p_now, now()),
      locked_at = null, locked_by = null, last_error = null
  where id = p_id and status = 'sending' and locked_by = p_worker
  returning * into v_row;
  if v_row.id is null then return 'noop'; end if;
  if v_row.letter_id is not null and v_row.channel = 'email' then
    perform public.log_event(v_row.letter_id, v_row.template || '_email_provider_accepted', 'worker');
  end if;
  return 'provider_accepted';
end;
$$;

create or replace function public.fail_outbox(p_id uuid, p_worker text, p_error text, p_permanent boolean, p_now timestamptz default now())
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.outbox;
begin
  select * into v_row from public.outbox where id = p_id for update;
  if v_row.id is null or v_row.status <> 'sending' or v_row.locked_by is distinct from p_worker then
    return 'noop';
  end if;
  if p_permanent or v_row.attempts >= public.config_int('max_delivery_attempts') then
    update public.outbox set status = 'failed', last_error = left(p_error, 500), locked_at = null, locked_by = null
    where id = p_id;
    if v_row.letter_id is not null then
      perform public.log_event(v_row.letter_id, v_row.template || '_' || v_row.channel || '_failed', 'worker',
        jsonb_build_object('attempts', v_row.attempts));
    end if;
    return 'failed';
  end if;
  update public.outbox
  set status = 'queued', last_error = left(p_error, 500), locked_at = null, locked_by = null,
      next_attempt_at = coalesce(p_now, now()) + public.retry_backoff(v_row.attempts)
  where id = p_id;
  return 'retry';
end;
$$;

create or replace function public.skip_outbox(p_id uuid, p_worker text, p_reason text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.outbox set status = 'skipped', last_error = left(p_reason, 200), locked_at = null, locked_by = null
  where id = p_id and status = 'sending' and locked_by = p_worker;
$$;

create or replace function public.remove_push_tokens(p_tokens text[])
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.push_tokens where token = any (p_tokens);
$$;

create or replace function public.run_maintenance(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rate integer;
  v_purged integer;
begin
  delete from public.rate_limit_hits where window_start < p_now - interval '2 days';
  get diagnostics v_rate = row_count;
  -- Letters hidden by every remaining participant are deleted for good.
  delete from public.letters l
  where l.status in ('delivered', 'opened', 'suppressed')
    and (l.sender_id is null or l.sender_hidden_at is not null)
    and (l.recipient_id is null and l.recipient_email is null or l.recipient_hidden_at is not null);
  get diagnostics v_purged = row_count;
  if v_purged > 0 then
    insert into public.erasure_log (kind, letters_deleted) values ('hidden_by_all_participants', v_purged);
  end if;
  return jsonb_build_object('rate_limit_rows', v_rate, 'letters_purged', v_purged);
end;
$$;

-- ---------------------------------------------------------------------------
-- Subscriptions (service role; called by the verified RevenueCat webhook)
-- ---------------------------------------------------------------------------
create or replace function public.upsert_entitlement(
  p_user_id uuid, p_premium boolean, p_product_id text, p_store text, p_expires_at timestamptz, p_event_id text
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.entitlements (user_id, premium, product_id, store, expires_at, last_event_id, updated_at)
  values (p_user_id, p_premium, p_product_id, p_store, p_expires_at, p_event_id, now())
  on conflict (user_id) do update set
    premium = excluded.premium, product_id = excluded.product_id, store = excluded.store,
    expires_at = excluded.expires_at, last_event_id = excluded.last_event_id, updated_at = now();
$$;

-- ---------------------------------------------------------------------------
-- Account deletion & legal erasure (service role)
-- ---------------------------------------------------------------------------
create or replace function public.delete_user_data(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
  v_detached integer;
  v_detached_received integer;
begin
  -- 1. Letters this user sent that have not been delivered yet are cancelled and erased.
  delete from public.letters
  where sender_id = p_user_id and status in ('scheduled', 'due', 'sending', 'failed', 'suppressed');
  get diagnostics v_deleted = row_count;

  -- 2. Letters already delivered belong to their recipients now; detach the sender.
  update public.letters set sender_id = null
  where sender_id = p_user_id and status in ('delivered', 'opened');
  get diagnostics v_detached = row_count;

  -- 3. Letters this user received: remove their identity. Undelivered ones will not be
  --    delivered; the sender keeps their own copy until they hide it.
  update public.letters set status = 'suppressed', suppressed_reason = 'recipient_deleted_account'
  where recipient_id = p_user_id and status in ('scheduled', 'due', 'failed');
  update public.letters
  set recipient_id = null, recipient_email = null, recipient_label = '(removed)',
      recipient_hidden_at = coalesce(recipient_hidden_at, now())
  where recipient_id = p_user_id;
  get diagnostics v_detached_received = row_count;

  update public.reports set reporter_id = null where reporter_id = p_user_id;
  update public.reports set reported_user_id = null where reported_user_id = p_user_id;
  update public.invitations set claimed_by = null where claimed_by = p_user_id;
  delete from public.trees where owner_id = p_user_id;
  delete from public.blocks where blocker_id = p_user_id or blocked_user_id = p_user_id;
  delete from public.notifications where user_id = p_user_id;
  delete from public.push_tokens where user_id = p_user_id;
  delete from public.outbox where to_user_id = p_user_id;
  delete from public.entitlements where user_id = p_user_id;
  delete from public.profiles where id = p_user_id;

  insert into public.erasure_log (kind, letters_deleted, letters_detached)
  values ('account_deletion', v_deleted, v_detached + v_detached_received);

  return jsonb_build_object('letters_deleted', v_deleted, 'letters_detached', v_detached + v_detached_received);
end;
$$;

-- Erasure request from someone without an account (e.g. via support or the opt-out page).
create or replace function public.erase_email_address(p_email text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email extensions.citext := public.normalize_email(p_email);
  v_count integer;
begin
  insert into public.email_suppressions (email, reason) values (v_email, 'erasure_request')
  on conflict (email) do update set reason = 'erasure_request';
  update public.letters set status = 'suppressed', suppressed_reason = 'recipient_erasure_request'
  where recipient_email = v_email and recipient_id is null and status in ('scheduled', 'due', 'failed');
  update public.letters set recipient_email = null, recipient_label = '(removed)'
  where recipient_email = v_email and recipient_id is null;
  get diagnostics v_count = row_count;
  delete from public.invitations where email = v_email;
  delete from public.outbox where to_email = v_email and status in ('queued', 'failed', 'skipped');
  insert into public.erasure_log (kind, letters_detached) values ('email_erasure', v_count);
  return jsonb_build_object('letters_detached', v_count);
end;
$$;

create or replace function public.suppress_email(p_email text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.email_suppressions (email) values (public.normalize_email(p_email))
  on conflict (email) do nothing;
$$;

-- ---------------------------------------------------------------------------
-- Operations: diagnose and retry failed deliveries (service role / SQL editor)
-- ---------------------------------------------------------------------------
create or replace view public.admin_delivery_issues
with (security_invoker = true) as
  select 'letter'::text as kind, l.id, l.status::text as status, l.attempts, l.last_error,
         l.deliver_at as due_at, l.next_attempt_at, l.locked_at, l.locked_by
  from public.letters l
  where l.status = 'failed'
     or (l.status = 'sending' and l.locked_at < now() - interval '5 minutes')
     or (l.status in ('scheduled', 'due') and l.deliver_at < now() - interval '15 minutes')
  union all
  select 'outbox:' || o.channel || ':' || o.template, o.id, o.status::text, o.attempts, o.last_error,
         o.created_at, o.next_attempt_at, o.locked_at, o.locked_by
  from public.outbox o
  where o.status = 'failed' or (o.status = 'queued' and o.attempts > 0);

revoke all on public.admin_delivery_issues from anon, authenticated;

create or replace function public.admin_retry_letter(p_letter_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.letters set status = 'due', attempts = 0, next_attempt_at = null, last_error = null
  where id = p_letter_id and status = 'failed';
  if not found then return 'noop'; end if;
  perform public.log_event(p_letter_id, 'admin_retry', 'admin');
  return 'requeued';
end;
$$;

create or replace function public.admin_retry_outbox(p_id uuid)
returns text
language sql
security definer
set search_path = ''
as $$
  update public.outbox set status = 'queued', attempts = 0, next_attempt_at = now(), last_error = null
  where id = p_id and status = 'failed'
  returning 'requeued';
$$;

-- ---------------------------------------------------------------------------
-- Grants: clients may execute only the functions meant for them.
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function public.complete_onboarding(text, text, text, boolean, boolean) to authenticated;
grant execute on function public.change_handle(text) to authenticated;
grant execute on function public.resolve_recipient(text) to authenticated;
grant execute on function public.attach_my_letters() to authenticated;
grant execute on function public.accept_letter(uuid) to authenticated;
grant execute on function public.decline_letter(uuid) to authenticated;
grant execute on function public.claim_invitation(text) to authenticated;
grant execute on function public.invitation_preview(text) to anon, authenticated;
grant execute on function public.mailbox(uuid) to authenticated;
grant execute on function public.hide_sent_letter(uuid) to authenticated;
grant execute on function public.my_tree_styles() to authenticated;
grant execute on function public.set_tree_style(uuid, text) to authenticated;
grant execute on function public.nurture_tree(uuid, public.nurture_kind) to authenticated;
grant execute on function public.tree_care_today(uuid) to authenticated;
grant execute on function public.block_sender_of_letter(uuid) to authenticated;
grant execute on function public.my_blocks() to authenticated;
grant execute on function public.unblock(uuid) to authenticated;
grant execute on function public.report_letter(uuid, public.report_reason, text) to authenticated;
grant execute on function public.register_push_token(text, text) to authenticated;
-- Pure helpers used by the profile trigger when users edit their own profile.
grant execute on function public.is_reserved_name(text) to authenticated;
grant execute on function public.is_valid_time_zone(text) to authenticated;

-- RLS policies call auth.uid(); trigger and helper functions run as definer.
-- Everything else (create_letter_record, worker, admin, erasure) is service_role only:
grant execute on all functions in schema public to service_role;
