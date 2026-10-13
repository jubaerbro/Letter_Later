/**
 * What a recipient can see before opening a letter. Used by the composer's confirmation
 * screen ("preview as recipient") and mirrored by create_letter_record() in SQL.
 */

export type RevealMode = 'name_and_date' | 'name_subject_date' | 'name_and_preview' | 'anonymous';

export interface RevealChoice {
  mode: RevealMode;
  /** Only meaningful for anonymous letters. */
  showSubject?: boolean;
  showPreview?: boolean;
}

export interface RevealFlags {
  showSender: boolean;
  showSubject: boolean;
  showPreview: boolean;
}

export const REVEAL_OPTIONS: Array<{ mode: RevealMode; title: string; description: string }> = [
  { mode: 'name_and_date', title: 'My name and the date', description: 'They know who it’s from and when it opens.' },
  { mode: 'name_subject_date', title: 'My name, the subject and the date', description: 'A little hint of what’s inside.' },
  { mode: 'name_and_preview', title: 'My name and a short note', description: 'Write a few words they can read while they wait.' },
  { mode: 'anonymous', title: 'Keep it a mystery', description: 'Your name stays hidden. Choose exactly what else they see.' },
];

export function revealFlags(choice: RevealChoice): RevealFlags {
  switch (choice.mode) {
    case 'name_and_date':
      return { showSender: true, showSubject: false, showPreview: false };
    case 'name_subject_date':
      return { showSender: true, showSubject: true, showPreview: false };
    case 'name_and_preview':
      return { showSender: true, showSubject: false, showPreview: true };
    case 'anonymous':
      return { showSender: false, showSubject: !!choice.showSubject, showPreview: !!choice.showPreview };
  }
}

export interface EnvelopeInput {
  choice: RevealChoice;
  senderName: string;
  senderHandle?: string | null;
  subject?: string | null;
  preview?: string | null;
}

export interface Envelope {
  from: string | null;
  fromHandle: string | null;
  subject: string | null;
  preview: string | null;
}

/** Exactly what the recipient will see before the opening date. */
export function envelopeFor(input: EnvelopeInput): Envelope {
  const f = revealFlags(input.choice);
  return {
    from: f.showSender ? input.senderName : null,
    fromHandle: f.showSender ? (input.senderHandle ?? null) : null,
    subject: f.showSubject ? (input.subject?.trim() || null) : null,
    preview: f.showPreview ? (input.preview?.trim() || null) : null,
  };
}

/** Plain-language lists for the confirmation screen. */
export function describeReveal(input: EnvelopeInput): { visible: string[]; hidden: string[] } {
  const f = revealFlags(input.choice);
  const visible: string[] = ['The date it opens'];
  const hidden: string[] = ['Your letter itself (until the opening date)'];
  (f.showSender ? visible : hidden).push(f.showSender ? `Your name (${input.senderName})` : 'Your name');
  if (f.showSubject) visible.push(`The subject: “${input.subject?.trim() ?? ''}”`);
  else hidden.push('The subject');
  if (f.showPreview) visible.push(`Your note: “${input.preview?.trim() ?? ''}”`);
  return { visible, hidden };
}

export function revealProblems(input: EnvelopeInput): Array<'subject_required' | 'preview_required'> {
  const f = revealFlags(input.choice);
  const problems: Array<'subject_required' | 'preview_required'> = [];
  if (f.showSubject && !input.subject?.trim()) problems.push('subject_required');
  if (f.showPreview && !input.preview?.trim()) problems.push('preview_required');
  return problems;
}
