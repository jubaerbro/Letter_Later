// POST /functions/v1/letter-content  { letterId, open?: boolean }  (authenticated)
// The only place a letter is decrypted. Recipients get content only on/after the
// scheduled time; `open: true` records the opening ceremony (first time only).
import { loadKeyRing } from '../_shared/crypto.ts';
import { readLetterContent } from '../_shared/services/letters.ts';
import { env, HttpError, json, requireUser, serve, serviceClient, SupabaseDb } from '../_shared/supabase.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

serve(['POST'], async (req) => {
  const user = await requireUser(req);
  const body = (await req.json().catch(() => ({}))) as { letterId?: string; open?: boolean };
  if (!body.letterId || !UUID.test(body.letterId)) throw new HttpError(400, 'not_found');
  const content = await readLetterContent(
    { db: new SupabaseDb(serviceClient()), ring: await loadKeyRing(env('LETTER_ENCRYPTION_KEYS')), now: () => new Date() },
    user.id,
    body.letterId,
    body.open === true,
  );
  return new Response(JSON.stringify(content), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    },
  });
});
