# Letter Later — Architecture & Implementation Plan

Letters that arrive in the future, each one growing a tree while it waits.
Target: **Google Play (Android) first**, with a responsive web page for
recipients who do not install the app. iOS stays buildable but is not a launch target.

---

## 1. Architecture

```
┌──────────────────────────────┐        ┌───────────────────────────────────────────┐
│ Expo app (React Native, TS)  │        │ Supabase (hosted)                          │
│  • expo-router screens       │  JWT   │  Auth: email OTP (+ optional password)     │
│  • same code → web export    │───────▶│  Postgres: tables + RLS + SQL functions    │
│    (claim / open / delete)   │        │  Edge Functions (Deno):                    │
│  • expo-audio player         │        │    create-letter   claim-invitation        │
│  • RevenueCat (Play Billing) │        │    letter-content  deliver-due (worker)    │
└──────────────────────────────┘        │    revenuecat-webhook  delete-account      │
                                        │    email-optout                            │
                                        │  pg_cron (every minute) ─▶ deliver-due     │
                                        └───────────────┬───────────────────────────┘
                                                        │ EmailProvider interface
                                                        ▼
                                           Resend (real)  |  Console (mock, dev only)
```

Key principles

* **The database is the source of truth.** `letters.deliver_at` (UTC `timestamptz`) decides
  delivery. The worker is stateless; it can crash, run twice, or run late without
  breaking anything.
* **The phone never controls delivery.** A cron job inside Postgres triggers the worker every
  minute; letters scheduled years ahead are just rows waiting for `deliver_at <= now()`.
* **Content is encrypted at the application layer** (AES-256-GCM, key held only in Edge
  Function secrets, versioned for rotation). Database dashboards, backups and logs never
  contain plaintext letters. Only `letter-content` decrypts, after an authorization check.
* **Clients never write privileged state.** Users have no INSERT/UPDATE rights on letters,
  invitations, entitlements or audit tables. Writes go through `SECURITY DEFINER` SQL
  functions or Edge Functions using the service role.
* **Shared domain logic** (time zones, growth curve, reveal rules, validation) lives in
  `supabase/functions/_shared/domain/` with no runtime dependencies, imported by both the
  app (`@shared/*` alias) and Deno functions, and unit tested once.

## 2. Screens & navigation (expo-router, `src/app`)

| Route | Purpose |
|---|---|
| `(auth)/welcome` | Calm intro: a seed, a letter, a date |
| `(auth)/sign-in` | Email → 6-digit code (or password for review/demo accounts) |
| `onboarding` | Name, personal address (`@willow-fern-28`), time zone, terms + 13+ age confirmation |
| `(tabs)/index` — **Garden** | Home: waiting letters as trees with countdowns, arrived letters glowing, “Write a letter” |
| `(tabs)/mailbox` | Segments: Waiting · Arrived · Opened · Sent, with search |
| `(tabs)/music` | Ambient player: tracks, play/pause, seek, volume, own audio files |
| `(tabs)/settings` | Address, notifications, security, premium, blocked senders, data & privacy, delete account |
| `compose/index` → `compose/when` → `compose/reveal` → `compose/review` → `compose/planted` | Write → schedule → choose what is revealed → irreversible confirmation → “seed planted” |
| `letter/[id]` | Both trees (mine / theirs), countdown, nurture actions, envelope details, report/block |
| `letter/[id]/open` | Sealed-letter opening ceremony, then the letter |
| `claim` | Deep link / web: claim a mailbox from an invitation |
| `notifications` | In-app notifications (e.g. “Maya claimed your letter”) |
| `premium` | Paywall (Google Play Billing via RevenueCat) |
| `report` | Report a letter |
| `legal/*`, `account-deletion` | Privacy policy, terms, web account-deletion page (Play requirement) |

## 3. Database schema (see `supabase/migrations`)

| Table | Notes |
|---|---|
| `profiles` | 1:1 with `auth.users`; `handle` (unique, citext), `display_name`, `time_zone`, notification prefs, `accepts_letters_by_handle`. Own row only. |
| `letters` | Metadata: sender, recipient user (nullable until claimed), recipient email (normalized), reveal mode, envelope fields shown before opening, `deliver_at`, `status`, retry bookkeeping. **No direct client access for recipients** (sender identity must stay hidden for anonymous letters) — recipients use `mailbox()` RPC. |
| `letter_contents` | `ciphertext`, `iv`, `key_version`. No client access at all; read only via `letter-content` function. |
| `invitations` | `token_hash` (SHA-256 of 256-bit random token), email, expiry, claimed_by. |
| `trees` | One per (letter, participant). Style, nurture points. Both participants may read both trees of their shared letter (sender identity still hidden by RPC). |
| `nurture_events` | Append-only; unique per (tree, kind, local day) → gentle daily cap, no streaks. |
| `blocks`, `reports` | Block by letter (sender resolved server-side, never revealed). |
| `email_suppressions` | Addresses that opted out of invitation emails. |
| `email_outbox` | Durable email queue with `idempotency_key` unique, attempts, backoff, provider id. |
| `delivery_events` | Append-only audit trail (no content). |
| `notifications`, `push_tokens` | In-app + Expo push. |
| `entitlements` | Written only by the RevenueCat webhook after server-side verification. |

**Immutability:** a trigger rejects any UPDATE to `sender_id`, `recipient_email`,
`deliver_at`, reveal fields, or `letter_contents` — for every role, including service role.
The only escape hatch is deletion (account deletion / legal erasure), which is audited.

**Letter status machine**

```
scheduled ──(deliver_at ≤ now)──▶ due ──claim──▶ sending ──▶ delivered ──(recipient opens)──▶ opened
                                    ▲                │
                                    └──retry/backoff─┤──(max attempts)──▶ failed  (admin can retry)
                                                     └──(recipient blocked sender)──▶ suppressed
```
Email notifications are a *separate* state machine in `email_outbox`:
`queued → sending → provider_accepted | failed`. **`provider_accepted` means the email
provider accepted the message — not that it reached an inbox or was read.** The letter is
available in-app the moment it is `delivered`, regardless of email.

## 4. Delivery workflow & failure cases

1. `create-letter` (authenticated) validates input, rate limits, resolves recipient
   (handle → user; email → existing verified user or pending invitation), checks blocks and
   opt-outs, encrypts content, and calls `create_letter_record()` in one transaction
   (letter + content + sender tree + invitation + outbox row + audit). Client-supplied
   `idempotency_key` makes double-taps safe.
2. The invitation email is attempted **immediately**; if the provider fails, the outbox row
   stays queued and the worker retries with exponential backoff.
3. Recipient opens the link → signs in with that email (OTP proves ownership) →
   `claim-invitation` checks token hash, expiry and that the verified email matches → letters
   are attached, recipient tree created, sender notified (in-app + push + email).
4. Every minute `pg_cron` calls `deliver-due`. It calls `claim_due_letters(batch)` which uses
   `FOR UPDATE SKIP LOCKED` so concurrent workers never take the same letter, then
   `complete_letter_delivery()` (idempotent: only `sending → delivered`), then queues a
   “your letter has arrived” email/push with idempotency key `arrival:<letter_id>`.
5. Stale `sending` locks (worker crashed) are reclaimed after 5 minutes. Failures back off
   (1m, 5m, 25m … capped at 6h); after 8 attempts the letter is `failed` and visible in
   `admin_delivery_issues`.

Failure cases handled: provider outage, worker crash mid-batch, duplicate cron runs,
recipient never claims (letter still delivered; arrival email includes claim link), recipient
blocks sender (suppressed, sender sees “delivered” only if it actually was), invalid/DST-gap
local times (rejected/normalized in the composer with explicit messaging), account deletion
of either party, revoked subscription.

## 5. Highest-risk decisions

1. **Encryption key management** – losing `LETTER_ENCRYPTION_KEYS` loses every letter.
   Mitigation: versioned keys, documented backup procedure, decryption tests.
2. **Email deliverability** – Supabase's built-in SMTP is not for production. Custom SMTP
   (e.g. Resend) must be configured for auth codes, and a verified sending domain for
   invitations.
3. **Google Play review** – OTP-only login blocks reviewers, so password sign-in is kept for
   a demo account. UGC policy requires report + block + terms, which are built in.
4. **Scheduler reliability** – depends on `pg_cron` + `pg_net` being enabled on the hosted
   project; the worker is also safe to trigger manually or from an external cron.
5. **Subscriptions** – must use Google Play Billing; RevenueCat wraps it and entitlement is
   verified server-side (webhook + REST re-fetch), never trusted from the client.
6. **Anonymous letters vs. abuse** – identity is hidden from recipients but retained server
   side so reports and blocks still work.

## 6. Files

```
app.config.ts, eas.json, .env.example
src/app/**                 screens (routes only)
src/components/**          design system + feature components (Tree, Countdown, Envelope…)
src/lib/**                 supabase client, api wrappers, auth/session, audio, purchases, notifications
src/theme/**               tokens: color, type, spacing, motion
supabase/config.toml
supabase/migrations/*.sql
supabase/functions/_shared/domain/*.ts   pure logic (shared with app)
supabase/functions/_shared/*.ts          crypto, email provider, http helpers
supabase/functions/<name>/index.ts       thin Deno handlers
tests/unit/**, tests/db/**               vitest (db tests run real Postgres, no Docker)
scripts/generate-audio.mjs               synthesizes our own royalty-free ambient tracks
docs/SETUP.md, docs/PLAY_STORE.md, docs/SECURITY.md
```

## 7. Decisions assumed (change before first Play upload)

* App name **Letter Later**, Android package **`app.letterlater.mobile`** (set via
  `ANDROID_PACKAGE`; *cannot change after the first upload*).
* Email provider **Resend** behind `EmailProvider`; mock console provider in development.
* Subscriptions through **RevenueCat** (entitlement id `premium`).
* Minimum age **13** (not designed for Play's Families program).
* Web pages served from the Expo web export on your domain (`WEB_BASE_URL`).

Credentials you must supply (never committed): Supabase project URL/keys, Resend API key +
verified domain, RevenueCat keys + webhook secret, Expo/EAS account, FCM (google-services.json)
for push, Play Console account.
