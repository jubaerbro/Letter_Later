// POST /functions/v1/revenuecat-webhook  (deploy with --no-verify-jwt)
// RevenueCat sends the Authorization header value you configure in its dashboard. The event
// itself is treated only as a hint: we re-fetch the subscriber from RevenueCat's API.
import { timingSafeEqual } from '../_shared/crypto.ts';
import { syncEntitlement, userIdsFromEvent } from '../_shared/services/entitlements.ts';
import { HttpError, json, log, requireEnv, serve, serviceClient, SupabaseDb } from '../_shared/supabase.ts';

serve(['POST'], async (req) => {
  if (!timingSafeEqual(req.headers.get('Authorization') ?? '', requireEnv('REVENUECAT_WEBHOOK_AUTH'))) {
    throw new HttpError(401, 'not_authenticated');
  }
  const payload = (await req.json().catch(() => ({}))) as { event?: Record<string, unknown> };
  const event = payload.event ?? {};
  const ids = userIdsFromEvent(event);
  const deps = { db: new SupabaseDb(serviceClient()), secretKey: requireEnv('REVENUECAT_SECRET_API_KEY'), now: () => new Date() };
  for (const id of ids) {
    const ent = await syncEntitlement(deps, id, typeof event.id === 'string' ? event.id : null);
    log('entitlement_synced', { user: id, premium: ent?.premium ?? false, type: event.type });
  }
  return json({ ok: true, users: ids.length });
});
