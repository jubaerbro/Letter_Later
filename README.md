# LaterLetter 🌱✉️

Write letters that open in the future. Every letter plants a seed; while it waits, a tree grows
for the sender and one for the recipient — and each can see the other's. Built for Google Play
(Android) with a companion web page for recipients who don't install the app.

- **App:** Expo SDK 57 · React Native 0.86 · TypeScript · expo-router · expo-audio · react-native-svg · Reanimated 4
- **Backend:** Supabase (Postgres + RLS, Auth with email codes, Edge Functions on Deno, pg_cron)
- **Email:** provider interface — Resend (real) or an explicit mock · **Push:** Expo · **Billing:** Google Play via RevenueCat

**Deploying:** **[docs/DEPLOY.md](docs/DEPLOY.md)** (runbook + go-live checklist) ·
[docs/PLAY_STORE.md](docs/PLAY_STORE.md) · [docs/SECURITY.md](docs/SECURITY.md) ·
[docs/SETUP.md](docs/SETUP.md) (development) · [docs/PLAN.md](docs/PLAN.md) (architecture)

## Commands

| Command | What it does |
|---|---|
| `npm run verify` | Typecheck, lint, all tests (unit + real Postgres, no Docker), Deno checks |
| `npm run secrets:generate` | Creates `supabase/functions/.env` with fresh random secrets (never overwrites) |
| `npm run check:env:server -- --production` / `check:env:app` | Validates configuration before deploying/building |
| `npm run deploy:backend` | Migrations, secrets, Edge Functions, Vault, smoke test — one command |
| `npm run build:web` | Web pages + `/.well-known/assetlinks.json` into `dist/` |
| `npm run seed:reviewer` | Google Play reviewer account with demo letters |
| `npm run android` / `npm run web` | Run locally (development build) |

GitHub Actions: **CI** (every push), **Deploy backend**, **Release Android** (EAS build + Play
submit), **OTA update** (EAS Update) — the last three run on demand.

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
  concurrent workers, idempotent completion, heartbeat + health endpoint, admin retry view.
- **Server vertical slice** (real service code + real Postgres): sign-up → letter to an
  unregistered email → invitation email → claim → sender notified → sealed letter → accelerated
  clock → delivered once → arrival email → opened; provider-outage retry; reviewer seeding.
- **App:** email-code sign-in (or password), onboarding, garden, mailbox with search, 5-step
  composer with DST-safe scheduling and reveal preview, irreversible confirmation, both trees
  per letter, optional daily care, styles and seasons, opening ceremony, ambient music
  (background + lock screen), notifications, claim page (app + web), report/block, settings,
  Plus paywall, account deletion (app + web), OTA updates.
- **Deployment:** secret generation, configuration checks that block unsafe production
  deploys/builds, one-command backend deploy, web hosting configs with generated App Links,
  CI/CD workflows, store listing text, feature graphic and screenshots.

### ⚠️ Needs your accounts (not verifiable from here)
- Nothing is deployed yet; no real Supabase, Resend, Expo push, Firebase, RevenueCat or Google
  Play calls have been made. The deploy/seed scripts were exercised in dry-run and against a
  local Postgres, not against a live Supabase project.
- No APK/AAB has been compiled on EAS or run on a device; the Android bundle, config plugins,
  `eas.json` (validated with EAS's own schema) and generated manifest were checked.
- Privacy policy and terms are accurate drafts — have them reviewed.

### Next step
Follow [docs/DEPLOY.md](docs/DEPLOY.md) from step 0.
