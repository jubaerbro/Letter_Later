import { FunctionsHttpError } from '@supabase/supabase-js';
import { friendlyMessage, knownErrorCode } from '@shared/domain/messages.ts';
import type { NurtureKind } from '@shared/domain/growth.ts';
import type { RevealMode } from '@shared/domain/reveal.ts';
import { supabase } from './supabase';

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message?: string,
  ) {
    super(message ?? friendlyMessage(code));
  }
}

function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  const message = (error as { message?: string })?.message ?? '';
  if (/network|fetch|Failed to fetch|timeout/i.test(message)) return new ApiError('network');
  return new ApiError(knownErrorCode(message) ?? 'unknown');
}

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw toApiError(error);
  return data as T;
}

/** For functions returning {ok:false, error} instead of raising. */
async function rpcOk<T extends object = Record<string, never>>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const result = await rpc<{ ok: boolean; error?: string } & T>(fn, args);
  if (!result.ok) throw new ApiError(result.error ?? 'unknown');
  return result;
}

async function invoke<T>(name: string, body: unknown): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body: body as Record<string, unknown> });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const payload = (await error.context.json().catch(() => ({}))) as { error?: string };
      throw new ApiError(payload.error ?? 'unknown');
    }
    throw toApiError(error);
  }
  return data as T;
}

// ── Types ────────────────────────────────────────────────────────────────────

export type DisplayStatus = 'waiting' | 'arrived' | 'opened' | 'delivered' | 'delayed' | 'closed';

export interface MailboxItem {
  letter_id: string;
  direction: 'received' | 'sent' | 'self';
  counterpart_name: string | null;
  counterpart_handle: string | null;
  is_anonymous: boolean;
  subject: string | null;
  preview: string | null;
  deliver_at: string;
  sender_time_zone: string;
  created_at: string;
  display_status: DisplayStatus;
  accepted: boolean;
  invite_status: 'queued' | 'sending' | 'provider_accepted' | 'failed' | 'skipped' | null;
  my_tree_id: string | null;
  my_tree_style: string | null;
  my_tree_points: number | null;
  their_tree_style: string | null;
  their_tree_points: number | null;
  their_tree_exists: boolean;
  delivered_at: string | null;
  opened_at: string | null;
}

export interface Profile {
  id: string;
  handle: string;
  display_name: string | null;
  time_zone: string;
  notify_email: boolean;
  notify_push: boolean;
  accepts_letters_by_handle: boolean;
  hemisphere: 'north' | 'south';
  onboarded_at: string | null;
  handle_changed_at: string | null;
}

export interface NotificationItem {
  id: string;
  kind: string;
  title: string;
  body: string;
  letter_id: string | null;
  created_at: string;
  read_at: string | null;
}

export interface CreateLetterInput {
  idempotencyKey: string;
  recipient: string;
  subject: string;
  body: string;
  revealMode: RevealMode;
  showSubject: boolean;
  showPreview: boolean;
  preview: string;
  deliverAt: string;
  timeZone: string;
}

// ── Profile & onboarding ─────────────────────────────────────────────────────

export async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
  if (error) throw toApiError(error);
  return data as Profile | null;
}

export async function updateProfile(userId: string, patch: Partial<Pick<Profile, 'display_name' | 'time_zone' | 'notify_email' | 'notify_push' | 'accepts_letters_by_handle' | 'hemisphere'>>) {
  const { error } = await supabase.from('profiles').update(patch).eq('id', userId);
  if (error) throw toApiError(error);
}

export const completeOnboarding = (p: { displayName: string; timeZone: string; hemisphere: 'north' | 'south'; acceptTerms: boolean; confirmAge: boolean }) =>
  rpcOk('complete_onboarding', {
    p_display_name: p.displayName,
    p_time_zone: p.timeZone,
    p_hemisphere: p.hemisphere,
    p_accept_terms: p.acceptTerms,
    p_confirm_age: p.confirmAge,
  });

export const changeHandle = (handle: string) => rpcOk<{ handle: string }>('change_handle', { p_handle: handle });
export const attachMyLetters = () => rpc<number>('attach_my_letters');
export const resolveRecipient = (handle: string) =>
  rpcOk<{ handle: string; display_name: string; is_self: boolean }>('resolve_recipient', { p_handle: handle });

export async function hasPremium(userId: string): Promise<boolean> {
  const { data } = await supabase.from('entitlements').select('premium, expires_at').eq('user_id', userId).maybeSingle();
  if (!data?.premium) return false;
  return !data.expires_at || new Date(data.expires_at).getTime() > Date.now();
}

// ── Letters ──────────────────────────────────────────────────────────────────

export const fetchMailbox = () => rpc<MailboxItem[]>('mailbox');
export async function fetchLetter(id: string): Promise<MailboxItem | null> {
  const rows = await rpc<MailboxItem[]>('mailbox', { p_letter_id: id });
  return rows[0] ?? null;
}

export const createLetter = (input: CreateLetterInput) =>
  invoke<{ letterId: string; duplicate: boolean; invited: boolean; isSelf: boolean; invitationEmail: string | null }>('create-letter', input);

export const letterContent = (letterId: string, open: boolean) =>
  invoke<{ role: 'sender' | 'recipient'; subject: string; body: string; openedNow: boolean }>('letter-content', { letterId, open });

export const acceptLetter = (id: string) => rpcOk('accept_letter', { p_letter_id: id });
export const declineLetter = (id: string) => rpcOk('decline_letter', { p_letter_id: id });
export const hideSentLetter = (id: string) => rpc('hide_sent_letter', { p_letter_id: id });

export interface InvitationPreview {
  ok: true;
  expired: boolean;
  claimed: boolean;
  email_hint: string;
  sender_name: string | null;
  sender_handle: string | null;
  subject: string | null;
  preview: string | null;
  deliver_at: string;
  sender_time_zone: string;
  arrived: boolean;
}
export const invitationPreview = (token: string) => rpcOk<InvitationPreview>('invitation_preview', { p_token: token });
export const claimInvitation = (token: string) => rpcOk<{ letter_id: string }>('claim_invitation', { p_token: token });

// ── Trees ────────────────────────────────────────────────────────────────────

export const nurture = (treeId: string, kind: NurtureKind) =>
  rpcOk<{ added: number; already_today: boolean; points: number }>('nurture_tree', { p_tree_id: treeId, p_kind: kind });

export async function careToday(treeId: string): Promise<NurtureKind[]> {
  const rows = await rpc<{ kind: NurtureKind }[]>('tree_care_today', { p_tree_id: treeId });
  return rows.map((r) => r.kind);
}

export const treeStyles = () => rpc<{ style: string; unlocked: boolean; requirement: string }[]>('my_tree_styles');
export const setTreeStyle = (treeId: string, style: string) => rpcOk('set_tree_style', { p_tree_id: treeId, p_style: style });

// ── Safety ───────────────────────────────────────────────────────────────────

export const blockSender = (letterId: string) => rpcOk('block_sender_of_letter', { p_letter_id: letterId });
export const myBlocks = () => rpc<{ block_id: string; label: string; created_at: string }[]>('my_blocks');
export const unblock = (blockId: string) => rpc('unblock', { p_block_id: blockId });
export type ReportReason = 'harassment' | 'spam' | 'impersonation' | 'self_harm' | 'hate' | 'sexual' | 'other';
export const reportLetter = (letterId: string, reason: ReportReason, details: string) =>
  rpcOk('report_letter', { p_letter_id: letterId, p_reason: reason, p_details: details });

// ── Notifications ────────────────────────────────────────────────────────────

export async function fetchNotifications(): Promise<NotificationItem[]> {
  const { data, error } = await supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(100);
  if (error) throw toApiError(error);
  return (data ?? []) as NotificationItem[];
}

export async function markNotificationsRead(ids: string[]) {
  if (ids.length === 0) return;
  const { error } = await supabase.from('notifications').update({ read_at: new Date().toISOString() }).in('id', ids);
  if (error) throw toApiError(error);
}

export const registerPushToken = (token: string, platform: 'android' | 'ios' | 'web') =>
  rpc('register_push_token', { p_token: token, p_platform: platform });

export async function removePushToken(token: string) {
  await supabase.from('push_tokens').delete().eq('token', token);
}

// ── Account ──────────────────────────────────────────────────────────────────

export const deleteAccount = () => invoke<{ ok: boolean }>('delete-account', { confirm: 'DELETE' });
export const syncEntitlement = () => invoke<{ premium: boolean; expiresAt: string | null }>('sync-entitlement', {});
