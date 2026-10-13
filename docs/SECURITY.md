# Security, privacy & operations

## Trust boundaries

| Component | Holds | Never holds |
|---|---|---|
| App (Android/web) | User's session (AsyncStorage in the app sandbox), public anon key, RevenueCat **public** key | Service-role key, encryption keys, provider secrets |
| Postgres | Ciphertext, metadata, audit trail | Plaintext letters, encryption keys |
| Edge Functions | Service-role key, `LETTER_ENCRYPTION_KEYS`, email/RevenueCat/worker secrets | — |

CI-verified: the production bundles contain no server secret names (see the build check).

## Authorization

- RLS is enabled on **every** table; Supabase's default grants are revoked and only minimal
  grants are re-added (`20261013000002_security.sql`).
- Clients read letters only through `mailbox()`, which applies the sender's reveal choices and
  never returns sender ids (anonymous letters stay anonymous).
- Content is only decrypted in `letter-content`, after `letter_content_access()` confirms the
  caller is the sender, or the recipient **and** `deliver_at <= now()` **and** status is
  delivered/opened. All other cases return the same `not_found`.
- Worker/admin/erasure functions are `service_role` only. Tests assert each one is denied to
  clients.
- **Immutability:** a trigger rejects any change to a sent letter's schedule, envelope or
  recipient — for every role, including service role and superuser. Content rows are
  append-only; the audit log is append-only. Status changes must follow the state machine.

## Invitations & identity

- Tokens: 256-bit random, URL-safe; only their SHA-256 is stored. Lookups are rate-limited per
  IP; claims per user. Tokens expire after 30 days (a fresh one comes with the arrival email).
- Claiming requires the signed-in account's **verified** email to match the invited address.
- Letters to existing users attach by verified email only.
- Sending a letter never reveals whether an email address has an account (tested).
- Personal addresses are exact-match only (no search/directory), rate-limited, and users can
  turn off receiving by address.

## Abuse safeguards

Rate limits (configurable in `app_config`): letters/day per sender, letters/week to the same
recipient, new-email invitations/day, invitation emails per address/day (across all senders),
handle lookups, claims, reports. Reserved display names/handles prevent impersonating the
service. Invitation emails show the sender's verified address handle, never the letter, and
carry one-click opt-out (RFC 8058). Block = generic failure for the sender, suppression of
pending letters, and hiding of existing ones.

## Encryption keys

`LETTER_ENCRYPTION_KEYS="1:<base64 32 bytes>[,2:<…>]"`. New letters use the highest version.

- **Back it up offline.** Losing it makes every letter unreadable.
- **Rotate:** add a new version (`1:old,2:new`), redeploy secrets. Old letters stay readable.
  (Re-encrypting old rows is optional and would need a maintenance script.)
- Each ciphertext is bound to its letter (AES-GCM additional data), so rows can't be swapped.

## Logging

Functions log ids, template names, counts and outcomes only — never letter content, never full
email addresses (the mock email provider masks them). `delivery_events` contains no content.

## Data deletion policy

| Event | What happens |
|---|---|
| User deletes account | Undelivered letters they sent: cancelled and erased (with contents, trees, invitations). Delivered/opened letters they sent: kept for recipients, sender detached. Letters they received: identity removed; undelivered ones suppressed. Profile, trees, notifications, push tokens, blocks, entitlement removed; auth user deleted; RevenueCat customer deleted. An anonymous count goes to `erasure_log`. |
| Recipient hides/declines a letter | Hidden from their mailbox only (sender unaffected). |
| Everyone hides a delivered letter | Purged by the nightly maintenance job. |
| Erasure request from a non-user | `select public.erase_email_address('person@example.com');` — suppresses future emails, detaches the address from undelivered letters, deletes invitations and queued emails. |
| Opt-out link | Address added to `email_suppressions`; no further invitations. |

Backups: on Supabase paid plans daily backups are retained per plan; deleted data ages out of
backups within that window. State this in your privacy policy (the draft already does).

## Operations

```sql
-- Anything stuck or failing (no content):
select * from public.admin_delivery_issues order by due_at;

-- Retry a failed letter / email after fixing the cause:
select public.admin_retry_letter('<letter-id>');
select public.admin_retry_outbox('<outbox-id>');

-- Delivery history for one letter:
select event, actor, detail, created_at from public.delivery_events where letter_id = '<id>' order by id;

-- Scheduler health:
select * from cron.job_run_details order by start_time desc limit 20;
```

Suggested alerting: a scheduled query (or uptime check) that warns when
`admin_delivery_issues` is non-empty for more than 15 minutes, plus Supabase's Edge Function
error logs. Error monitoring for the app (e.g. Sentry) can be added later; if you do, scrub
request bodies and never attach letter content.

## Moderation

```sql
select r.id, r.reason, r.details, r.created_at, r.letter_id, r.reported_user_id
from public.reports r where r.status = 'open' order by r.created_at;
```

To read a reported letter: `node scripts/read-reported-letter.mjs <letter-id>` (refuses unless
the letter has an open report). Actions: `update reports set status='actioned'…`, suppress
pending letters from that sender, or delete the user via `delete_user_data()` + the auth
admin API. Users are told in the report screen that moderators may read a reported letter.
