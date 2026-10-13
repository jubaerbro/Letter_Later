-- Letter Later — core schema
-- All timestamps are timestamptz (stored as UTC). The sender's IANA time zone is kept
-- alongside deliver_at only for display; deliver_at is the single source of truth.

create extension if not exists citext with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.letter_status as enum (
  'scheduled',   -- waiting for deliver_at
  'due',         -- deliver_at has passed; waiting for (or retrying) the worker
  'sending',     -- claimed by a worker
  'delivered',   -- available to the recipient in-app
  'failed',      -- exhausted retries; needs operator attention
  'opened',      -- recipient opened it
  'suppressed'   -- will not be delivered (recipient blocked sender, recipient erased, ...)
);

create type public.reveal_mode as enum (
  'name_and_date',
  'name_subject_date',
  'name_and_preview',
  'anonymous'
);

create type public.outbox_status as enum (
  'queued',
  'sending',
  'provider_accepted', -- provider accepted the message; NOT proof of inbox delivery or reading
  'failed',
  'skipped'            -- intentionally not sent (opt-out, rate limit, preferences)
);

create type public.outbox_channel as enum ('email', 'push');

create type public.nurture_kind as enum ('water', 'sunlight', 'moment');

create type public.report_reason as enum (
  'harassment', 'spam', 'impersonation', 'self_harm', 'hate', 'sexual', 'other'
);

-- ---------------------------------------------------------------------------
-- Runtime configuration (non-secret)
-- ---------------------------------------------------------------------------
create table public.app_config (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

insert into public.app_config (key, value) values
  ('min_delivery_lead_seconds', '3600'),     -- set to 60 in development for a short test schedule
  ('max_delivery_years', '50'),
  ('max_delivery_attempts', '8'),
  ('max_letters_per_day', '20'),
  ('max_new_invites_per_day', '10'),
  ('max_letters_same_recipient_per_week', '5'),
  ('max_invite_emails_per_address_per_day', '3'),
  ('invitation_ttl_days', '30');

create or replace function public.config_int(p_key text)
returns integer
language sql
stable
set search_path = ''
as $$
  select (value #>> '{}')::integer from public.app_config where key = p_key
$$;

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  handle extensions.citext not null unique,
  display_name text,
  time_zone text not null default 'UTC',
  notify_email boolean not null default true,
  notify_push boolean not null default true,
  accepts_letters_by_handle boolean not null default true,
  hemisphere text not null default 'north' check (hemisphere in ('north', 'south')),
  terms_accepted_at timestamptz,
  age_confirmed_at timestamptz,
  onboarded_at timestamptz,
  handle_changed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint handle_format check (handle ~ '^[a-z0-9](?:[a-z0-9-]{1,22})[a-z0-9]$'),
  constraint display_name_length check (display_name is null or char_length(btrim(display_name)) between 1 and 40),
  constraint time_zone_length check (char_length(time_zone) between 1 and 64)
);

-- ---------------------------------------------------------------------------
-- Letters (metadata) and contents (ciphertext only)
-- ---------------------------------------------------------------------------
create table public.letters (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid references auth.users (id) on delete set null,
  recipient_id uuid references auth.users (id) on delete set null,
  recipient_email extensions.citext,          -- normalized; used to match verified identities
  recipient_label text not null,              -- what the sender typed (shown to sender only)
  reveal_mode public.reveal_mode not null,
  show_subject boolean not null default false,
  show_preview boolean not null default false,
  envelope_sender_name text,                  -- snapshot; null when anonymous
  envelope_sender_handle text,                -- snapshot; null when anonymous
  envelope_subject text,                      -- only when show_subject
  envelope_preview text,                      -- only when show_preview
  sender_time_zone text not null,
  deliver_at timestamptz not null,
  created_at timestamptz not null default now(),
  idempotency_key text not null,
  accepted_at timestamptz,                    -- recipient accepted/claimed the letter
  status public.letter_status not null default 'scheduled',
  status_changed_at timestamptz not null default now(),
  delivered_at timestamptz,
  opened_at timestamptz,
  attempts integer not null default 0,
  next_attempt_at timestamptz,
  locked_at timestamptz,
  locked_by text,
  last_error text,
  suppressed_reason text,
  sender_hidden_at timestamptz,
  recipient_hidden_at timestamptz,
  constraint deliver_after_creation check (deliver_at > created_at),
  constraint reveal_consistency check (
    (reveal_mode = 'name_and_date'      and not show_subject and not show_preview) or
    (reveal_mode = 'name_subject_date'  and show_subject and not show_preview) or
    (reveal_mode = 'name_and_preview'   and not show_subject and show_preview) or
    (reveal_mode = 'anonymous')
  ),
  constraint envelope_name_matches_mode check (
    (reveal_mode = 'anonymous' and envelope_sender_name is null and envelope_sender_handle is null)
    or (reveal_mode <> 'anonymous' and envelope_sender_name is not null)
  ),
  constraint envelope_subject_only_if_shown check (show_subject = (envelope_subject is not null)),
  constraint envelope_preview_only_if_shown check (show_preview = (envelope_preview is not null)),
  constraint envelope_subject_length check (envelope_subject is null or char_length(envelope_subject) <= 120),
  constraint envelope_preview_length check (envelope_preview is null or char_length(envelope_preview) <= 140),
  constraint recipient_label_length check (char_length(recipient_label) <= 320),
  constraint idempotency_key_length check (char_length(idempotency_key) between 8 and 80),
  unique (sender_id, idempotency_key)
);

create index letters_due_idx on public.letters (deliver_at)
  where status in ('scheduled', 'due');
create index letters_sending_idx on public.letters (locked_at) where status = 'sending';
create index letters_recipient_idx on public.letters (recipient_id);
create index letters_sender_idx on public.letters (sender_id, created_at desc);
create index letters_pending_email_idx on public.letters (recipient_email) where recipient_id is null;

create table public.letter_contents (
  letter_id uuid primary key references public.letters (id) on delete cascade,
  ciphertext text not null check (char_length(ciphertext) <= 120000), -- base64 AES-256-GCM of JSON {subject, body}
  iv text not null,           -- base64 96-bit nonce
  key_version integer not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Invitations (token is never stored, only its SHA-256)
-- ---------------------------------------------------------------------------
create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  letter_id uuid not null references public.letters (id) on delete cascade,
  email extensions.citext not null,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  purpose text not null default 'invite' check (purpose in ('invite', 'arrival')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  claimed_at timestamptz,
  claimed_by uuid references auth.users (id) on delete set null
);
create index invitations_email_idx on public.invitations (email, created_at desc);

-- ---------------------------------------------------------------------------
-- Trees (one per participant per letter) and nurture events
-- ---------------------------------------------------------------------------
create table public.trees (
  id uuid primary key default gen_random_uuid(),
  letter_id uuid not null references public.letters (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('sender', 'recipient')),
  style text not null default 'oak',
  points integer not null default 0 check (points >= 0),
  created_at timestamptz not null default now(),
  last_nurtured_at timestamptz,
  unique (letter_id, owner_id),
  unique (letter_id, role)
);

create table public.nurture_events (
  id bigint generated always as identity primary key,
  tree_id uuid not null references public.trees (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind public.nurture_kind not null,
  local_day date not null,
  points integer not null check (points between 1 and 5),
  created_at timestamptz not null default now(),
  unique (tree_id, kind, local_day)
);

-- ---------------------------------------------------------------------------
-- Safety: blocks, reports, email suppressions, rate limits
-- ---------------------------------------------------------------------------
create table public.blocks (
  id uuid primary key default gen_random_uuid(),
  blocker_id uuid not null references auth.users (id) on delete cascade,
  blocked_user_id uuid not null references auth.users (id) on delete cascade,
  label text not null,                 -- what the blocker saw (e.g. "Anonymous sender")
  created_at timestamptz not null default now(),
  unique (blocker_id, blocked_user_id),
  check (blocker_id <> blocked_user_id)
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references auth.users (id) on delete set null,
  letter_id uuid references public.letters (id) on delete set null,
  reported_user_id uuid references auth.users (id) on delete set null,
  reason public.report_reason not null,
  details text check (details is null or char_length(details) <= 1000),
  status text not null default 'open' check (status in ('open', 'reviewing', 'actioned', 'dismissed')),
  created_at timestamptz not null default now()
);

create table public.email_suppressions (
  email extensions.citext primary key,
  reason text not null default 'opt_out',
  created_at timestamptz not null default now()
);

create table public.rate_limit_hits (
  bucket text not null,
  key text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (bucket, key, window_start)
);

-- ---------------------------------------------------------------------------
-- Outbox (email + push), notifications, push tokens
-- ---------------------------------------------------------------------------
create table public.outbox (
  id uuid primary key default gen_random_uuid(),
  channel public.outbox_channel not null,
  template text not null,
  to_email extensions.citext,
  to_user_id uuid references auth.users (id) on delete cascade,
  letter_id uuid references public.letters (id) on delete cascade,
  params jsonb not null default '{}'::jsonb,   -- never contains letter content
  idempotency_key text not null unique,
  status public.outbox_status not null default 'queued',
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  provider_message_id text,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  check (to_email is not null or to_user_id is not null)
);
create index outbox_ready_idx on public.outbox (next_attempt_at) where status = 'queued';

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null,
  letter_id uuid references public.letters (id) on delete cascade,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

create table public.push_tokens (
  token text primary key check (char_length(token) <= 255),
  user_id uuid not null references auth.users (id) on delete cascade,
  platform text not null check (platform in ('android', 'ios', 'web')),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Subscriptions (written only by the verified webhook)
-- ---------------------------------------------------------------------------
create table public.entitlements (
  user_id uuid primary key references auth.users (id) on delete cascade,
  premium boolean not null default false,
  product_id text,
  store text,
  expires_at timestamptz,
  last_event_id text,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Audit trail (append-only, no letter content)
-- ---------------------------------------------------------------------------
create table public.delivery_events (
  id bigint generated always as identity primary key,
  letter_id uuid references public.letters (id) on delete cascade,
  event text not null,
  actor text not null default 'system',
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index delivery_events_letter_idx on public.delivery_events (letter_id, id);

-- Deletions are recorded without personal data so erasure itself is auditable.
create table public.erasure_log (
  id bigint generated always as identity primary key,
  kind text not null,
  letters_deleted integer not null default 0,
  letters_detached integer not null default 0,
  created_at timestamptz not null default now()
);
