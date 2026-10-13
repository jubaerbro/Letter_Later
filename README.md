# Letter Later 🌱✉️

Write letters that open in the future. Every letter plants a seed; while it waits, a tree grows
for the sender and one for the recipient — and each can see the other's. Built for Google Play
(Android) with a companion web page for recipients who don't install the app.

- **App:** Expo SDK 57 · React Native 0.86 · TypeScript · expo-router · expo-audio · react-native-svg · Reanimated 4
- **Backend:** Supabase (Postgres + RLS, Auth with email codes, Edge Functions on Deno, pg_cron)
- **Email:** provider interface — Resend (real) or an explicit mock · **Push:** Expo · **Billing:** Google Play via RevenueCat

Start here: **[docs/SETUP.md](docs/SETUP.md)** · [docs/PLAY_STORE.md](docs/PLAY_STORE.md) ·
[docs/SECURITY.md](docs/SECURITY.md) · [docs/PLAN.md](docs/PLAN.md) (architecture)

## How delivery works

`letters.deliver_at` (UTC) is the only source of truth. `pg_cron` calls the `deliver-due`
Edge Function every minute; it marks due letters, claims them with `FOR UPDATE SKIP LOCKED`,
delivers each exactly once, and queues arrival emails/pushes in a durable outbox with
idempotency keys and exponential backoff. Phones are never involved, so letters arrive even
if the sender's phone is off or the app is uninstalled — and a letter scheduled 30 years out
is just a row waiting for its time.

## Repository map

```
src/app/                 screens (expo-router)          src/components/  design system, Tree, Countdown, Envelope…
src/lib/                 Supabase client, API, session, audio, purchases, notifications
src/theme/               colour/type/spacing tokens (WCAG AA verified by tests)
supabase/migrations/     schema, RLS, triggers, SQL functions, scheduler
supabase/functions/      Edge Functions + _shared/ (domain logic shared with the app, crypto, email, worker)
tests/unit, tests/db     Vitest — unit + real-Postgres integration tests (no Docker)
scripts/                 audio & icon generators, moderation tool
```

## Status

### ✅ Works and is tested
- **Schema & security:** RLS on every table, minimal grants, immutable sent letters (even for
  service role), append-only audit trail, status state machine, rate limits, reserved names,
  no account enumeration, encrypted letter contents (AES-256-GCM, versioned keys).
- **Delivery:** due → sending → delivered/suppressed/failed with retries, stale-lock recovery,
  concurrent workers, idempotent completion, admin retry and diagnosis view.
- **Server vertical slice** (real service code + real Postgres): sign-up → letter to an
  unregistered email → invitation email (mock provider) → recipient verifies email and claims
  → sender notified → sealed letter + countdown → accelerated clock → delivered once → arrival
  email → opened; plus provider-outage retry.
- **App:** sign-in with email code (or password), onboarding with personal address, garden,
  mailbox with search, 5-step composer with DST-safe scheduling and reveal preview,
  irreversible confirmation, both trees per letter with optional daily care, tree styles &
  seasons, opening ceremony, ambient music player (background + lock screen), notifications,
  claim page (app + web), report/block, settings, Plus paywall, account deletion (in app + web).

Verification run for this version: `tsc` clean · `expo lint` clean · **204 tests passing**
(77 unit, 127 database/integration) · all 7 Edge Functions type-check under Deno ·
`expo export` builds the Android (Hermes) and web bundles · `expo prebuild` manifest checked
(minimal permissions, App Links) · web build screenshot-reviewed at phone size in light/dark
with mocked API responses.

### ⚠️ Not verified here (needs your accounts/devices)
- Nothing has been deployed: no real Supabase project, email, push or RevenueCat calls were made.
- No native APK was compiled or run on a device (that needs EAS Build); the native bundle,
  config plugins and manifest were verified.
- Google Play purchases, push delivery and real email deliverability need your credentials.
- The privacy policy and terms are accurate drafts of what the code does — have them reviewed.

### Next steps
1. Follow docs/SETUP.md to create the Supabase project, deploy, and make a development build.
2. Walk through the flow on a phone with `EMAIL_PROVIDER=mock`, then with Resend.
3. Work through docs/PLAY_STORE.md (closed testing track first).
