import { describe, expect, it } from 'vitest';
import { nurtureBoost, seasonFor, stageFor, timeProgress, visualGrowth } from '@shared/domain/growth';
import { friendlyMessage, knownErrorCode } from '@shared/domain/messages';
import { describeReveal, envelopeFor, revealFlags, revealProblems } from '@shared/domain/reveal';
import { cleanText, draftProblems, isValidEmail, parseRecipient } from '@shared/domain/validation';

describe('tree growth is cosmetic and separate from the countdown', () => {
  const plantedAt = new Date('2026-01-01T00:00:00Z');
  const deliverAt = new Date('2036-01-01T00:00:00Z');

  it('grows with time alone', () => {
    const half = new Date('2031-01-01T00:00:00Z');
    expect(timeProgress(plantedAt, deliverAt, half)).toBeCloseTo(0.5, 2);
    expect(stageFor(visualGrowth({ plantedAt, deliverAt, now: half, points: 0, arrived: false }), false)).toBe('sapling');
  });

  it('nurturing helps a far-away letter look lively, with diminishing returns', () => {
    const now = new Date('2026-02-01T00:00:00Z');
    const none = visualGrowth({ plantedAt, deliverAt, now, points: 0, arrived: false });
    const some = visualGrowth({ plantedAt, deliverAt, now, points: 30, arrived: false });
    const lots = visualGrowth({ plantedAt, deliverAt, now, points: 3000, arrived: false });
    expect(stageFor(none, false)).toBe('seed');
    expect(some).toBeGreaterThan(none);
    expect(stageFor(some, false)).toBe('sprout');
    const month = visualGrowth({ plantedAt, deliverAt, now, points: 120, arrived: false }); // ~a month of daily care
    expect(stageFor(month, false)).toBe('sapling');
    expect(lots).toBeLessThan(0.4); // saturates: care cannot fast-forward to "mature"
    expect(nurtureBoost(-5)).toBe(0);
  });

  it('never blooms before the letter actually arrives, however much care', () => {
    const almost = new Date('2035-12-31T23:59:00Z');
    const g = visualGrowth({ plantedAt, deliverAt, now: almost, points: 1e6, arrived: false });
    expect(g).toBeLessThan(1);
    expect(stageFor(g, false)).toBe('mature');
    expect(stageFor(visualGrowth({ plantedAt, deliverAt, now: almost, points: 0, arrived: true }), true)).toBe('bloom');
  });

  it('never shrinks when care stops (no punishment for missed days)', () => {
    const t1 = new Date('2027-01-01T00:00:00Z');
    const t2 = new Date('2027-06-01T00:00:00Z');
    expect(visualGrowth({ plantedAt, deliverAt, now: t2, points: 10, arrived: false })).toBeGreaterThanOrEqual(
      visualGrowth({ plantedAt, deliverAt, now: t1, points: 10, arrived: false }),
    );
  });

  it('seasons follow the hemisphere', () => {
    expect(seasonFor(new Date(2030, 6, 1), 'north')).toBe('summer');
    expect(seasonFor(new Date(2030, 6, 1), 'south')).toBe('winter');
    expect(seasonFor(new Date(2030, 9, 1), 'north')).toBe('autumn');
  });
});

describe('reveal rules', () => {
  const base = { senderName: 'Maya', senderHandle: 'maple-brook-12', subject: 'Graduation', preview: 'Proud of you' };

  it('name and date only', () => {
    expect(envelopeFor({ ...base, choice: { mode: 'name_and_date' } })).toEqual({ from: 'Maya', fromHandle: 'maple-brook-12', subject: null, preview: null });
  });
  it('name, subject and date', () => {
    expect(envelopeFor({ ...base, choice: { mode: 'name_subject_date' } }).subject).toBe('Graduation');
  });
  it('name and preview', () => {
    expect(envelopeFor({ ...base, choice: { mode: 'name_and_preview' } })).toMatchObject({ subject: null, preview: 'Proud of you' });
  });
  it('anonymous shows only explicitly selected fields', () => {
    expect(envelopeFor({ ...base, choice: { mode: 'anonymous' } })).toEqual({ from: null, fromHandle: null, subject: null, preview: null });
    expect(envelopeFor({ ...base, choice: { mode: 'anonymous', showSubject: true } })).toEqual({ from: null, fromHandle: null, subject: 'Graduation', preview: null });
    expect(revealFlags({ mode: 'name_and_date', showSubject: true, showPreview: true })).toEqual({ showSender: true, showSubject: false, showPreview: false });
  });
  it('explains clearly what is and is not revealed', () => {
    const d = describeReveal({ ...base, choice: { mode: 'anonymous', showPreview: true } });
    expect(d.visible).toContain('The date it opens');
    expect(d.visible.some((v) => v.includes('Proud of you'))).toBe(true);
    expect(d.hidden).toContain('Your name');
    expect(d.hidden).toContain('The subject');
  });
  it('requires the revealed fields to be filled', () => {
    expect(revealProblems({ ...base, subject: ' ', choice: { mode: 'name_subject_date' } })).toEqual(['subject_required']);
    expect(revealProblems({ ...base, preview: '', choice: { mode: 'anonymous', showPreview: true } })).toEqual(['preview_required']);
  });
});

describe('recipient parsing and validation', () => {
  it('parses emails and personal addresses', () => {
    expect(parseRecipient('  Friend@Example.COM ')).toEqual({ kind: 'email', value: 'friend@example.com' });
    expect(parseRecipient('@Willow-Fern-28')).toEqual({ kind: 'handle', value: 'willow-fern-28' });
    expect(parseRecipient('willow-fern-28')).toEqual({ kind: 'handle', value: 'willow-fern-28' });
    expect(parseRecipient('')).toEqual({ error: 'empty' });
    expect(parseRecipient('not an email@')).toEqual({ error: 'invalid_email' });
    expect(parseRecipient('@a')).toEqual({ error: 'invalid_handle' });
    expect(isValidEmail('a@b.c')).toBe(false);
  });
  it('validates drafts', () => {
    expect(draftProblems({ subject: '', body: '   ' })).toEqual(['body_empty']);
    expect(draftProblems({ subject: 'x'.repeat(121), body: 'hi' })).toEqual(['subject_too_long']);
  });
  it('strips control characters but keeps newlines', () => {
    expect(cleanText('Dear you,\n\u0007Hello\u0000')).toBe('Dear you,\nHello');
  });
});

describe('messages', () => {
  it('maps backend codes to calm messages, preferring the most specific code', () => {
    expect(knownErrorCode('ERROR: recipient_email_invalid')).toBe('recipient_email_invalid');
    expect(friendlyMessage('deliver_at_too_soon')).toMatch(/further ahead/);
    expect(friendlyMessage('???')).toBe(friendlyMessage('unknown'));
  });
});
