/**
 * Server-side subscription verification. We never trust the app's claim of being premium:
 * entitlement state is fetched from RevenueCat's REST API (which validates the Google Play
 * purchase token with Google) using a secret key that exists only on the server.
 */
import type { Db } from './db.ts';

export const ENTITLEMENT_ID = 'premium';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RevenueCatSubscriber {
  subscriber?: {
    entitlements?: Record<string, { expires_date: string | null; product_identifier?: string }>;
    subscriptions?: Record<string, { store?: string }>;
  };
}

export function isAppUserId(id: unknown): id is string {
  return typeof id === 'string' && UUID.test(id);
}

export function entitlementFrom(body: RevenueCatSubscriber, now: Date) {
  const ent = body.subscriber?.entitlements?.[ENTITLEMENT_ID];
  if (!ent) return { premium: false, productId: null, store: null, expiresAt: null as Date | null };
  const expiresAt = ent.expires_date ? new Date(ent.expires_date) : null;
  const productId = ent.product_identifier ?? null;
  const store = productId ? (body.subscriber?.subscriptions?.[productId]?.store ?? null) : null;
  return { premium: expiresAt === null || expiresAt.getTime() > now.getTime(), productId, store, expiresAt };
}

export async function syncEntitlement(
  deps: { db: Db; secretKey: string; fetchImpl?: typeof fetch; now: () => Date },
  userId: string,
  eventId: string | null,
) {
  if (!isAppUserId(userId)) return null;
  const res = await (deps.fetchImpl ?? fetch)(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`, {
    headers: { Authorization: `Bearer ${deps.secretKey}`, 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`revenuecat ${res.status}`);
  const ent = entitlementFrom((await res.json()) as RevenueCatSubscriber, deps.now());
  await deps.db.rpc('upsert_entitlement', {
    p_user_id: userId,
    p_premium: ent.premium,
    p_product_id: ent.productId,
    p_store: ent.store,
    p_expires_at: ent.expiresAt?.toISOString() ?? null,
    p_event_id: eventId,
  });
  return ent;
}

/** All user ids a webhook event refers to (covers TRANSFER and aliases). */
export function userIdsFromEvent(event: Record<string, unknown>): string[] {
  const ids = new Set<string>();
  const add = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(add);
    else if (isAppUserId(v)) ids.add(v.toLowerCase());
  };
  add(event.app_user_id);
  add(event.original_app_user_id);
  add(event.aliases);
  add(event.transferred_from);
  add(event.transferred_to);
  return [...ids];
}
