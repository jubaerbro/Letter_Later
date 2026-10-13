-- Letter Later — durable scheduler.
--
-- pg_cron calls the deliver-due Edge Function every minute through pg_net. The function
-- reads due rows from the database, so letters scheduled years ahead need nothing more
-- than their row. Missed runs are harmless: the next run picks up everything overdue.
--
-- Secrets are read from Supabase Vault at call time, never stored in this migration:
--   select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
--   select vault.create_secret('<same value as WORKER_SECRET>', 'worker_secret');
-- (see docs/SETUP.md). Environments without pg_cron (e.g. plain Postgres used by the
-- test-suite) skip this migration with a notice.

do $outer$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron')
     or not exists (select 1 from pg_available_extensions where name = 'pg_net') then
    raise notice 'pg_cron/pg_net not available: scheduler not installed (expected in tests)';
    return;
  end if;

  create extension if not exists pg_cron;
  create extension if not exists pg_net;

  perform cron.unschedule(jobid) from cron.job where jobname in ('letter-later-deliver-due', 'letter-later-maintenance');

  perform cron.schedule(
    'letter-later-deliver-due',
    '* * * * *',
    $job$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/deliver-due',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'worker_secret')
        ),
        body := '{"source":"pg_cron"}'::jsonb,
        timeout_milliseconds := 55000
      );
    $job$
  );

  perform cron.schedule(
    'letter-later-maintenance',
    '17 3 * * *',
    $job$ select public.run_maintenance(); $job$
  );
end;
$outer$;
