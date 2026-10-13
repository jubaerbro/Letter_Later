// POST /functions/v1/sync-entitlement  (authenticated)
// Called by the app right after a purchase/restore so premium applies without waiting for
// the webhook. Verification still happens server-side against RevenueCat.
import { syncEntitlement } from '../_shared/services/entitlements.ts';
import { json, requireEnv, requireUser, serve, serviceClient, SupabaseDb } from '../_shared/supabase.ts';

serve(['POST'], async (req) => {
  const user = await requireUser(req);
  const ent = await syncEntitlement(
    { db: new SupabaseDb(serviceClient()), secretKey: requireEnv('REVENUECAT_SECRET_API_KEY'), now: () => new Date() },
    user.id,
    null,
  );
  return json({ premium: ent?.premium ?? false, expiresAt: ent?.expiresAt?.toISOString() ?? null });
});
