-- LaterLetter — operational health.
--
-- Every delivery tick records a heartbeat. ops_health() combines it with backlog and failure
-- counts so an external uptime monitor can alert when letters stop flowing — whether the
-- cause is pg_cron, the Edge Function, the email provider or the database itself.
-- Returns counts only: no ids, emails or content.

create table public.worker_heartbeats (
  worker text primary key,
  last_run_at timestamptz not null,
  last_summary jsonb not null default '{}'::jsonb
);
alter table public.worker_heartbeats enable row level security;
revoke all on public.worker_heartbeats from anon, authenticated;

create or replace function public.record_worker_heartbeat(p_summary jsonb, p_now timestamptz default now())
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.worker_heartbeats (worker, last_run_at, last_summary)
  values ('deliver-due', coalesce(p_now, now()), coalesce(p_summary, '{}'::jsonb))
  on conflict (worker) do update set last_run_at = excluded.last_run_at, last_summary = excluded.last_summary;
$$;

create or replace function public.ops_health(p_now timestamptz default now())
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_last_run timestamptz;
  v_overdue integer;
  v_oldest_minutes integer;
  v_failed integer;
  v_stuck integer;
  v_outbox_failed integer;
  v_outbox_backlog integer;
  v_problems text[] := '{}';
begin
  select last_run_at into v_last_run from public.worker_heartbeats where worker = 'deliver-due';

  select count(*), coalesce(max(extract(epoch from (p_now - deliver_at)) / 60), 0)::int
    into v_overdue, v_oldest_minutes
  from public.letters
  where status in ('scheduled', 'due') and deliver_at < p_now - interval '10 minutes';

  select count(*) into v_failed from public.letters where status = 'failed';
  select count(*) into v_stuck from public.letters where status = 'sending' and locked_at < p_now - interval '10 minutes';
  select count(*) into v_outbox_failed from public.outbox where status = 'failed' and created_at > p_now - interval '24 hours';
  select count(*) into v_outbox_backlog from public.outbox where status = 'queued' and next_attempt_at < p_now - interval '15 minutes';

  if v_last_run is null then
    v_problems := array_append(v_problems, 'scheduler_never_ran');
  elsif v_last_run < p_now - interval '5 minutes' then
    v_problems := array_append(v_problems, 'scheduler_stalled');
  end if;
  if v_overdue > 0 then v_problems := array_append(v_problems, 'letters_overdue'); end if;
  if v_failed > 0 then v_problems := array_append(v_problems, 'letters_failed'); end if;
  if v_stuck > 0 then v_problems := array_append(v_problems, 'letters_stuck'); end if;
  if v_outbox_failed > 0 then v_problems := array_append(v_problems, 'emails_failed'); end if;
  if v_outbox_backlog > 0 then v_problems := array_append(v_problems, 'emails_backlogged'); end if;

  return jsonb_build_object(
    'healthy', cardinality(v_problems) = 0,
    'problems', to_jsonb(v_problems),
    'last_scheduler_run', v_last_run,
    'letters_overdue', v_overdue,
    'oldest_overdue_minutes', v_oldest_minutes,
    'letters_failed', v_failed,
    'letters_stuck', v_stuck,
    'emails_failed_24h', v_outbox_failed,
    'emails_backlogged', v_outbox_backlog,
    'checked_at', p_now
  );
end;
$$;

revoke execute on function public.record_worker_heartbeat(jsonb, timestamptz) from public, anon, authenticated;
revoke execute on function public.ops_health(timestamptz) from public, anon, authenticated;
grant execute on function public.record_worker_heartbeat(jsonb, timestamptz) to service_role;
grant execute on function public.ops_health(timestamptz) to service_role;
