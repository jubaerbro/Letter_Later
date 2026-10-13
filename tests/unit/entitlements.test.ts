import { describe, expect, it } from 'vitest';
import type { Db } from '@shared/services/db';
import { entitlementFrom, isAppUserId, syncEntitlement, userIdsFromEvent } from '@shared/services/entitlements';

const UID = '11111111-1111-4111-8111-111111111111';
const now = new Date('2026-10-13T10:00:00Z');

describe('subscription verification', () => {
  it('active when the premium entitlement has not expired (or never expires)', () => {
    expect(entitlementFrom({ subscriber: { entitlements: { premium: { expires_date: '2026-11-13T10:00:00Z', product_identifier: 'plus_monthly' } }, subscriptions: { plus_monthly: { store: 'play_store' } } } }, now)).toMatchObject({
      premium: true,
      productId: 'plus_monthly',
      store: 'play_store',
    });
    expect(entitlementFrom({ subscriber: { entitlements: { premium: { expires_date: null } } } }, now).premium).toBe(true);
  });

  it('inactive when expired or absent', () => {
    expect(entitlementFrom({ subscriber: { entitlements: { premium: { expires_date: '2026-10-01T00:00:00Z' } } } }, now).premium).toBe(false);
    expect(entitlementFrom({ subscriber: { entitlements: {} } }, now).premium).toBe(false);
    expect(entitlementFrom({}, now).premium).toBe(false);
  });

  it('only accepts our own user ids (never RevenueCat anonymous ids)', () => {
    expect(isAppUserId(UID)).toBe(true);
    expect(isAppUserId('$RCAnonymousID:abc')).toBe(false);
    expect(userIdsFromEvent({ app_user_id: UID, aliases: ['$RCAnonymousID:x', UID], transferred_to: ['22222222-2222-4222-8222-222222222222'] })).toEqual([
      UID,
      '22222222-2222-4222-8222-222222222222',
    ]);
  });

  it('re-fetches from RevenueCat with the secret key and stores the verified result', async () => {
    const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
    const db = { rpc: async (fn: string, args: Record<string, unknown>) => void calls.push({ fn, args }) } as unknown as Db;
    let authHeader = '';
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      authHeader = (init.headers as Record<string, string>).Authorization;
      return new Response(JSON.stringify({ subscriber: { entitlements: { premium: { expires_date: '2027-01-01T00:00:00Z', product_identifier: 'plus_yearly' } } } }));
    }) as unknown as typeof fetch;
    const ent = await syncEntitlement({ db, secretKey: 'sk_test', fetchImpl, now: () => now }, UID, 'evt_1');
    expect(ent?.premium).toBe(true);
    expect(authHeader).toBe('Bearer sk_test');
    expect(calls[0]).toMatchObject({ fn: 'upsert_entitlement', args: { p_user_id: UID, p_premium: true, p_event_id: 'evt_1' } });
  });

  it('fails loudly (so the webhook is retried) when RevenueCat is unavailable', async () => {
    const db = { rpc: async () => undefined } as unknown as Db;
    const fetchImpl = (async () => new Response('down', { status: 503 })) as unknown as typeof fetch;
    await expect(syncEntitlement({ db, secretKey: 'k', fetchImpl, now: () => now }, UID, null)).rejects.toThrow('revenuecat 503');
  });
});
