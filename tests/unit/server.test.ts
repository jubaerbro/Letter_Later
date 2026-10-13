import { describe, expect, it } from 'vitest';
import { loadKeyRing, newToken, open, seal, sha256Hex, signValue, timingSafeEqual, toBase64, verifySignedValue } from '@shared/crypto';
import { MockEmailProvider, ResendProvider } from '@shared/email/provider';
import { escapeHtml, renderEmail } from '@shared/email/templates';
import { parseCreateLetter, RequestError } from '@shared/services/letters';

const key = (b: number) => toBase64(new Uint8Array(32).fill(b));

describe('letter encryption', () => {
  it('round-trips and uses the newest key version', async () => {
    const ring = await loadKeyRing(`1:${key(1)},2:${key(2)}`);
    const sealed = await seal(ring, 'Dear future you', 'aad');
    expect(sealed.keyVersion).toBe(2);
    expect(sealed.ciphertext).not.toContain('Dear');
    expect(await open(ring, sealed, 'aad')).toBe('Dear future you');
  });

  it('old letters stay readable after key rotation', async () => {
    const old = await loadKeyRing(`1:${key(1)}`);
    const sealed = await seal(old, 'from 2026', 'aad');
    const rotated = await loadKeyRing(`1:${key(1)},2:${key(2)}`);
    expect(await open(rotated, sealed, 'aad')).toBe('from 2026');
  });

  it('detects tampering and context swaps', async () => {
    const ring = await loadKeyRing(`1:${key(7)}`);
    const sealed = await seal(ring, 'secret', 'letter-a');
    await expect(open(ring, sealed, 'letter-b')).rejects.toThrow();
    const flipped = { ...sealed, ciphertext: toBase64(new Uint8Array(atob(sealed.ciphertext).length).fill(9)) };
    await expect(open(ring, flipped, 'letter-a')).rejects.toThrow();
  });

  it('rejects malformed key configuration', async () => {
    await expect(loadKeyRing(undefined)).rejects.toThrow(/not configured/);
    await expect(loadKeyRing('1:short')).rejects.toThrow(/32 random bytes/);
  });
});

describe('tokens and signatures', () => {
  it('invitation tokens are 256-bit, URL-safe, and stored only as SHA-256', async () => {
    const t = await newToken();
    expect(t.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(t.hash).toBe(await sha256Hex(t.token));
    const t2 = await newToken();
    expect(t2.token).not.toBe(t.token);
  });

  it('signed opt-out values verify and reject tampering', async () => {
    const signed = await signValue('secret', 'optout:a@b.co');
    expect(await verifySignedValue('secret', signed)).toBe('optout:a@b.co');
    expect(await verifySignedValue('other', signed)).toBeNull();
    expect(await verifySignedValue('secret', signed.replace(/^./, 'x'))).toBeNull();
    expect(await verifySignedValue('secret', 'garbage')).toBeNull();
  });

  it('constant-time comparison', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('email templates never contain letter content', () => {
  const ctx = { senderName: 'Maya', senderHandle: 'maple', recipientName: 'Jun', deliverAt: new Date('2031-06-01T08:00:00Z'), timeZone: 'Europe/London' };
  const links = { actionUrl: 'https://letterlater.app/claim?token=abc', optOutUrl: 'https://x.supabase.co/functions/v1/email-optout?t=1' };

  it('invitation includes sender, date, claim and opt-out links', () => {
    const e = renderEmail('invitation', ctx, links);
    expect(e.subject).toBe('Maya planted a letter for you');
    expect(e.text).toContain('Sunday, 1 June 2031');
    expect(e.text).toContain('09:00');
    expect(e.text).toContain('BST');
    expect(e.text).toContain(links.actionUrl);
    expect(e.text).toContain(links.optOutUrl);
    expect(e.html).toContain('Claim your letter');
  });

  it('anonymous senders stay anonymous', () => {
    const e = renderEmail('invitation', { ...ctx, senderName: null, senderHandle: null }, links);
    expect(e.subject).toBe('A letter is waiting for you');
    expect(e.html).not.toContain('Maya');
  });

  it('escapes hostile sender names and strips links from them', () => {
    const e = renderEmail('invitation', { ...ctx, senderName: '<img src=x> http://evil.example' }, links);
    expect(e.html).not.toContain('<img src=x>');
    expect(e.html).toContain('&lt;img src=x&gt;');
    expect(e.text).not.toContain('evil.example');
    expect(escapeHtml(`"'&`)).toBe('&quot;&#39;&amp;');
  });

  it('templates are rendered without access to letter content', () => {
    for (const t of ['invitation', 'letter_waiting', 'letter_arrived', 'letter_accepted'] as const) {
      const e = renderEmail(t, ctx, links);
      expect(e.subject.length).toBeGreaterThan(5);
      expect(e.html).toContain('sealed');
    }
  });
});

describe('email providers', () => {
  it('Resend: sends with an idempotency key and classifies failures', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fake = (status: number, body: unknown) =>
      (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return new Response(JSON.stringify(body), { status });
      }) as unknown as typeof fetch;

    const ok = await new ResendProvider('re_test', 'Letter Later <hello@letterlater.app>', fake(200, { id: 'em_1' })).send({
      to: 'a@b.co', subject: 's', html: 'h', text: 't', idempotencyKey: 'outbox-1',
    });
    expect(ok).toEqual({ ok: true, id: 'em_1' });
    expect((calls[0].init.headers as Record<string, string>)['Idempotency-Key']).toBe('outbox-1');
    expect(JSON.parse(calls[0].init.body as string).to).toEqual(['a@b.co']);

    const bad = await new ResendProvider('k', 'f', fake(422, { message: 'invalid' })).send({ to: 'x', subject: '', html: '', text: '', idempotencyKey: 'k' });
    expect(bad).toMatchObject({ ok: false, permanent: true });
    const busy = await new ResendProvider('k', 'f', fake(503, {})).send({ to: 'x', subject: '', html: '', text: '', idempotencyKey: 'k' });
    expect(busy).toMatchObject({ ok: false, permanent: false });
    const limited = await new ResendProvider('k', 'f', fake(429, {})).send({ to: 'x', subject: '', html: '', text: '', idempotencyKey: 'k' });
    expect(limited).toMatchObject({ ok: false, permanent: false });
  });

  it('Mock provider is explicit and deduplicates by idempotency key', async () => {
    const mock = new MockEmailProvider();
    expect(mock.isMock).toBe(true);
    const msg = { to: 'a@b.co', subject: 's', html: 'h', text: 't', idempotencyKey: 'same' };
    await mock.send(msg);
    await mock.send(msg);
    expect(mock.sent).toHaveLength(1);
  });
});

describe('create-letter request parsing', () => {
  const valid = {
    idempotencyKey: 'abcdef123456', recipient: 'a@b.co', subject: 'Hi', body: 'Hello', revealMode: 'name_and_date',
    deliverAt: '2030-01-01T00:00:00Z', timeZone: 'UTC',
  };
  it('accepts a valid request', () => {
    expect(parseCreateLetter(valid).revealMode).toBe('name_and_date');
  });
  it('rejects bad input with specific codes', () => {
    const code = (b: object) => {
      try {
        parseCreateLetter(b);
        return null;
      } catch (e) {
        return (e as RequestError).code;
      }
    };
    expect(code({ ...valid, revealMode: 'everything' })).toBe('revealMode_invalid');
    expect(code({ ...valid, body: '' })).toBe('body_required');
    expect(code({ ...valid, body: 'x'.repeat(20_001) })).toBe('body_invalid');
    expect(code({ ...valid, idempotencyKey: 'bad key!' })).toBe('idempotencyKey_invalid');
    expect(code(null as unknown as object)).toBe('revealMode_invalid');
  });
});
