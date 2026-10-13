#!/usr/bin/env node
/**
 * Moderation tool: decrypts ONE letter, and only if it has an open report.
 * Run on a trusted machine; never log or store the output.
 *
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… LETTER_ENCRYPTION_KEYS=… \
 *     node scripts/read-reported-letter.mjs <letter-id>
 */
const [, , letterId] = process.argv;
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, LETTER_ENCRYPTION_KEYS } = process.env;
if (!letterId || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !LETTER_ENCRYPTION_KEYS) {
  console.error('Usage: SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… LETTER_ENCRYPTION_KEYS=… node scripts/read-reported-letter.mjs <letter-id>');
  process.exit(1);
}
if (!/^[0-9a-f-]{36}$/i.test(letterId)) {
  console.error('Not a letter id.');
  process.exit(1);
}

const rest = async (path) => {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
};

const reports = await rest(`reports?letter_id=eq.${letterId}&status=in.(open,reviewing)&select=id,reason,created_at`);
if (reports.length === 0) {
  console.error('Refusing: this letter has no open report.');
  process.exit(2);
}
const [letter] = await rest(`letters?id=eq.${letterId}&select=idempotency_key,reveal_mode,created_at,deliver_at,status`);
const [content] = await rest(`letter_contents?letter_id=eq.${letterId}&select=ciphertext,iv,key_version`);
if (!letter || !content) {
  console.error('Letter not found (it may have been deleted).');
  process.exit(3);
}

const keyB64 = LETTER_ENCRYPTION_KEYS.split(',').map((e) => e.trim().split(':')).find(([v]) => Number(v) === content.key_version)?.[1];
if (!keyB64) throw new Error(`Missing key version ${content.key_version}`);
const key = await crypto.subtle.importKey('raw', Buffer.from(keyB64, 'base64'), 'AES-GCM', false, ['decrypt']);
const plaintext = await crypto.subtle.decrypt(
  { name: 'AES-GCM', iv: Buffer.from(content.iv, 'base64'), additionalData: new TextEncoder().encode(`letter-content:v1:${letter.idempotency_key}`) },
  key,
  Buffer.from(content.ciphertext, 'base64'),
);
console.log(JSON.stringify({ reports, letter: { reveal_mode: letter.reveal_mode, created_at: letter.created_at, deliver_at: letter.deliver_at, status: letter.status }, content: JSON.parse(new TextDecoder().decode(plaintext)) }, null, 2));
