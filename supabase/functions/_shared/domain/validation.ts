export const LIMITS = {
  subject: 120,
  body: 20_000,
  preview: 140,
  displayName: 40,
  email: 254,
} as const;

export type Recipient = { kind: 'email'; value: string } | { kind: 'handle'; value: string };

const EMAIL_RE = /^[^@\s<>()",;:]+@[^@\s<>()",;:]+\.[a-z]{2,}$/i;
const HANDLE_RE = /^[a-z0-9](?:[a-z0-9-]{1,22})[a-z0-9]$/;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  const e = normalizeEmail(email);
  return e.length <= LIMITS.email && EMAIL_RE.test(e);
}

export function normalizeHandle(handle: string): string {
  return handle.trim().replace(/^@+/, '').toLowerCase();
}

export function isValidHandle(handle: string): boolean {
  const h = normalizeHandle(handle);
  return HANDLE_RE.test(h) && !h.includes('--');
}

/** "@willow-fern-28" or "willow-fern-28" → handle; "a@b.co" → email. */
export function parseRecipient(input: string): Recipient | { error: 'empty' | 'invalid_email' | 'invalid_handle' } {
  const raw = input.trim();
  if (!raw) return { error: 'empty' };
  if (raw.includes('@') && !raw.startsWith('@')) {
    return isValidEmail(raw) ? { kind: 'email', value: normalizeEmail(raw) } : { error: 'invalid_email' };
  }
  return isValidHandle(raw) ? { kind: 'handle', value: normalizeHandle(raw) } : { error: 'invalid_handle' };
}

export interface LetterDraft {
  subject: string;
  body: string;
}

export function draftProblems(d: LetterDraft): Array<'body_empty' | 'body_too_long' | 'subject_too_long'> {
  const problems: Array<'body_empty' | 'body_too_long' | 'subject_too_long'> = [];
  if (!d.body.trim()) problems.push('body_empty');
  if (d.body.length > LIMITS.body) problems.push('body_too_long');
  if (d.subject.length > LIMITS.subject) problems.push('subject_too_long');
  return problems;
}

/** Strip control characters (except newlines/tabs) that have no place in a letter. */
export function cleanText(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}
