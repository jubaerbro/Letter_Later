// POST /functions/v1/deliver-due  (called every minute by pg_cron; deploy with --no-verify-jwt)
// Authorization: Bearer <WORKER_SECRET>. Body may contain {"now": ISO} only when
// ALLOW_TEST_CLOCK=true (never in production) to demonstrate delivery with an accelerated clock.
import { timingSafeEqual } from '../_shared/crypto.ts';
import { runDeliveryCycle } from '../_shared/services/delivery.ts';
import { env, HttpError, json, log, messagingDeps, requireEnv, serve } from '../_shared/supabase.ts';

serve(['POST'], async (req) => {
  const auth = req.headers.get('Authorization') ?? '';
  if (!timingSafeEqual(auth, `Bearer ${requireEnv('WORKER_SECRET')}`)) throw new HttpError(401, 'not_authenticated');

  const deps = await messagingDeps();
  const body = (await req.json().catch(() => ({}))) as { now?: string };
  if (body.now) {
    if (env('ALLOW_TEST_CLOCK') !== 'true') throw new HttpError(400, 'test_clock_disabled');
    const fixed = new Date(body.now);
    if (Number.isNaN(fixed.getTime())) throw new HttpError(400, 'invalid');
    deps.now = () => fixed;
  }

  const workerId = `edge-${crypto.randomUUID()}`;
  const summary = await runDeliveryCycle(deps, { workerId, timeBudgetMs: 45_000 });
  log('delivery_cycle', { workerId, ...summary, emailProvider: deps.email.name, mockEmail: deps.email.isMock });
  return json({ ...summary, emailProvider: deps.email.name, mockEmail: deps.email.isMock });
});
