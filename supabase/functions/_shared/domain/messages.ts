/** Calm, human messages for every error code the backend can return. */
const MESSAGES: Record<string, string> = {
  // schedule
  deliver_at_too_soon: 'Please choose a time a little further ahead.',
  deliver_at_too_far: 'Letters can travel up to 50 years. Please pick an earlier date.',
  invalid_wall_time: 'That date doesn’t exist on the calendar. Please pick another.',
  time_zone_invalid: 'We couldn’t recognise that time zone.',
  // recipients
  recipient_not_found: 'We couldn’t find anyone with that address. Check the spelling, or use their email instead.',
  recipient_email_invalid: 'That email address doesn’t look quite right.',
  recipient_unavailable: 'This letter can’t be sent to that person.',
  invalid_handle: 'Personal addresses use letters, numbers and dashes.',
  invalid_email: 'That email address doesn’t look quite right.',
  empty: 'Who is this letter for?',
  // limits
  rate_limited: 'Let’s take a short pause. Please try again in a little while.',
  rate_limited_daily: 'You’ve planted a lot of letters today. Please come back tomorrow.',
  rate_limited_recipient: 'You’ve sent several letters to this person this week. Let them grow for a while.',
  rate_limited_invites: 'You’ve invited many new people today. Please try again tomorrow.',
  // content
  body_empty: 'Your letter is still empty.',
  body_too_long: 'Your letter is a little too long.',
  subject_too_long: 'The subject is a little too long.',
  subject_required: 'Add a subject, since you chose to show it.',
  preview_required: 'Write a short note, since you chose to show one.',
  envelope_subject_required: 'Add a subject, since you chose to show it.',
  envelope_preview_required: 'Write a short note, since you chose to show one.',
  // account
  sender_not_ready: 'Please finish setting up your account first.',
  not_authenticated: 'Please sign in again.',
  terms_required: 'Please accept the terms to continue.',
  age_required: 'Please confirm you are at least 13 years old.',
  display_name_invalid: 'Please enter a name between 1 and 40 characters.',
  display_name_reserved: 'That name is reserved. Please choose another.',
  handle_invalid: 'Use 3–24 lowercase letters, numbers or single dashes.',
  handle_reserved: 'That address is reserved. Please choose another.',
  handle_taken: 'That address is already someone’s home.',
  handle_cooldown: 'You can change your address once every 30 days.',
  // claiming
  invalid: 'This link isn’t valid. It may have been copied incompletely.',
  expired: 'This invitation link has expired, but your letter is safe. Sign in with the invited email to find it.',
  already_claimed: 'This letter has already been claimed by another account.',
  email_mismatch: 'This letter was sent to a different email address. Sign in with that address to claim it.',
  not_found: 'We couldn’t find that letter.',
  style_locked: 'That tree style isn’t unlocked yet.',
  already_bloomed: 'This tree is already in full bloom.',
  // generic
  network: 'We couldn’t reach the garden. Check your connection and try again.',
  unknown: 'Something went wrong. Please try again.',
};

export function friendlyMessage(code: string | null | undefined): string {
  if (!code) return MESSAGES.unknown;
  return MESSAGES[code] ?? MESSAGES.unknown;
}

export function knownErrorCode(text: string | null | undefined): string | null {
  if (!text) return null;
  // Longest codes first so 'invalid_email' wins over 'invalid'.
  const match = Object.keys(MESSAGES)
    .sort((a, b) => b.length - a.length)
    .find((code) => text.includes(code));
  return match ?? null;
}
