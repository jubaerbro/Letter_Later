// POST /functions/v1/create-letter  (authenticated)
// Validates, encrypts and stores a letter, then sends the invitation email immediately.
import { createLetter, parseCreateLetter } from '../_shared/services/letters.ts';
import { json, messagingDeps, requireUser, serve } from '../_shared/supabase.ts';

serve(['POST'], async (req) => {
  const user = await requireUser(req);
  const body = parseCreateLetter(await req.json().catch(() => null));
  const result = await createLetter(await messagingDeps(), user.id, body);
  return json(result, result.duplicate ? 200 : 201);
});
