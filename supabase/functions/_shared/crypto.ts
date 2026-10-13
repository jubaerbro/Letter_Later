/**
 * Server-side cryptography (Web Crypto only, so it runs in Deno and Node 22).
 *
 * Letter contents are encrypted with AES-256-GCM before they reach the database. Keys live
 * only in Edge Function secrets as LETTER_ENCRYPTION_KEYS="1:<base64 32 bytes>,2:<...>".
 * New letters use the highest version; old versions stay so old letters remain readable.
 * Losing these keys means losing every letter — see docs/SECURITY.md for backup guidance.
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  return fromBase64(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
}

export interface KeyRing {
  current: number;
  keys: Map<number, CryptoKey>;
}

export async function loadKeyRing(spec: string | undefined): Promise<KeyRing> {
  if (!spec) throw new Error('LETTER_ENCRYPTION_KEYS is not configured');
  const keys = new Map<number, CryptoKey>();
  for (const entry of spec.split(',').map((e) => e.trim()).filter(Boolean)) {
    const [v, material] = entry.split(':');
    const version = Number(v);
    let raw: Uint8Array;
    try {
      raw = fromBase64(material ?? '');
    } catch {
      raw = new Uint8Array();
    }
    if (!Number.isInteger(version) || version < 1 || raw.length !== 32) {
      throw new Error('LETTER_ENCRYPTION_KEYS entries must look like "1:<base64 of 32 random bytes>"');
    }
    keys.set(version, await crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']));
  }
  if (keys.size === 0) throw new Error('LETTER_ENCRYPTION_KEYS is empty');
  return { current: Math.max(...keys.keys()), keys };
}

export interface Sealed {
  ciphertext: string;
  iv: string;
  keyVersion: number;
}

/** `aad` binds the ciphertext to its context (e.g. the sender id) so blobs cannot be swapped. */
export async function seal(ring: KeyRing, plaintext: string, aad: string): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = ring.keys.get(ring.current)!;
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource, additionalData: enc.encode(aad) as BufferSource },
    key,
    enc.encode(plaintext) as BufferSource,
  );
  return { ciphertext: toBase64(new Uint8Array(ct)), iv: toBase64(iv), keyVersion: ring.current };
}

export async function open(ring: KeyRing, sealed: Sealed, aad: string): Promise<string> {
  const key = ring.keys.get(sealed.keyVersion);
  if (!key) throw new Error(`missing encryption key version ${sealed.keyVersion}`);
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(sealed.iv) as BufferSource, additionalData: enc.encode(aad) as BufferSource },
    key,
    fromBase64(sealed.ciphertext) as BufferSource,
  );
  return dec.decode(pt);
}

/** 256-bit random token, URL-safe (43 chars), plus its SHA-256 hex digest for storage. */
export async function newToken(): Promise<{ token: string; hash: string }> {
  const token = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  return { token, hash: await sha256Hex(token) };
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(text) as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hmacKey(secret: string) {
  return crypto.subtle.importKey('raw', enc.encode(secret) as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

/** Signed, self-contained token for one-click email opt-out links. */
export async function signValue(secret: string, value: string): Promise<string> {
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(value) as BufferSource);
  return `${toBase64Url(enc.encode(value))}.${toBase64Url(new Uint8Array(sig))}`;
}

export async function verifySignedValue(secret: string, token: string): Promise<string | null> {
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  try {
    const value = dec.decode(fromBase64Url(payload));
    const ok = await crypto.subtle.verify(
      'HMAC',
      await hmacKey(secret),
      fromBase64Url(sig) as BufferSource,
      enc.encode(value) as BufferSource,
    );
    return ok ? value : null;
  } catch {
    return null;
  }
}

/** Constant-time comparison for shared secrets (worker, webhook). */
export function timingSafeEqual(a: string, b: string): boolean {
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < Math.max(ab.length, bb.length); i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}
