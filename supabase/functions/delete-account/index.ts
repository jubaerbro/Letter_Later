// POST /functions/v1/delete-account  { confirm: "DELETE" }  (authenticated)
// Google Play requires in-app account deletion. Erases the user's data per the policy in
// docs/SECURITY.md, then deletes the auth user. Subscriptions must be cancelled in Google
// Play by the user (the app links there); we also remove the RevenueCat customer record.
import { HttpError, json, log, requireUser, serve, serviceClient, SupabaseDb, env } from '../_shared/supabase.ts';

serve(['POST'], async (req) => {
  const user = await requireUser(req);
  const body = (await req.json().catch(() => ({}))) as { confirm?: string };
  if (body.confirm !== 'DELETE') throw new HttpError(400, 'confirmation_required');

  const db = new SupabaseDb(serviceClient());
  const summary = await db.rpc<{ letters_deleted: number; letters_detached: number }>('delete_user_data', { p_user_id: user.id });
  const { error } = await serviceClient().auth.admin.deleteUser(user.id);
  if (error) throw new Error(`auth delete failed: ${error.message}`);

  const rcKey = env('REVENUECAT_SECRET_API_KEY');
  if (rcKey) {
    await fetch(`https://api.revenuecat.com/v1/subscribers/${user.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${rcKey}` },
    }).catch(() => {});
  }
  log('account_deleted', { ...summary });
  return json({ ok: true, ...summary });
});
