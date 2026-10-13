// GET /functions/v1/health?token=<HEALTH_CHECK_TOKEN>   (deploy with --no-verify-jwt)
// For uptime monitors: 200 when letters are flowing, 503 with a list of problems otherwise.
// Returns counts only. The token can also be sent as "Authorization: Bearer <token>".
import { timingSafeEqual } from '../_shared/crypto.ts';
import { HttpError, json, requireEnv, serve, serviceClient, SupabaseDb } from '../_shared/supabase.ts';

serve(['GET'], async (req) => {
  const expected = requireEnv('HEALTH_CHECK_TOKEN');
  const header = req.headers.get('Authorization') ?? '';
  const given = new URL(req.url).searchParams.get('token') ?? (header.startsWith('Bearer ') ? header.slice(7) : '');
  if (!timingSafeEqual(given, expected)) throw new HttpError(401, 'not_authenticated');

  const report = await new SupabaseDb(serviceClient()).rpc<{ healthy: boolean }>('ops_health', {});
  return json(report, report.healthy ? 200 : 503);
});
