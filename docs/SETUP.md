# Development setup (no Docker)

> Going to production? Follow **[DEPLOY.md](DEPLOY.md)** — it automates most of this page
> (`npm run secrets:generate`, `npm run deploy:backend`) and covers Google Play.

Everything runs against a **hosted Supabase project**; the Supabase CLI talks to it directly.
You need Node 22+, a Supabase account, an Expo account, and an Android phone (or emulator).

## 0. Install

```bash
npm install
npm run verify        # typecheck, lint, all tests (starts a throwaway Postgres via npm, no Docker), Deno checks
```

## 1. Create the backend

1. Create a project at <https://supabase.com/dashboard> (pick a region near your users).
   Note the **project ref** (`https://<ref>.supabase.co`).
2. Link and push the schema:

   ```bash
   npx supabase login
   npx supabase link --project-ref <ref>
   npx supabase db push            # applies supabase/migrations/* (also enables pg_cron + pg_net)
   ```

3. Give the scheduler its two secrets (SQL editor in the dashboard). Generate a long random
   `WORKER_SECRET` first, e.g. `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`:

   ```sql
   select vault.create_secret('https://<ref>.supabase.co', 'project_url');
   select vault.create_secret('<WORKER_SECRET>', 'worker_secret');
   ```

   `pg_cron` now calls `deliver-due` every minute. Check with `select * from cron.job;`.

## 2. Sign-in emails (Auth settings)

1. **Authentication → Emails → SMTP**: configure a real SMTP sender (Supabase's built-in
   sender is heavily rate limited and only for testing). With Resend: host `smtp.resend.com`,
   port `465`, user `resend`, password = your Resend API key, sender on your verified domain.
2. **Authentication → Emails → Templates → Magic link**: include the 6-digit code, e.g.
   `<p>Your LaterLetter code is <strong>{{ .Token }}</strong></p>`. The app signs in with
   codes, not links.
3. **Authentication → URL configuration**: Site URL = your `WEB_BASE_URL`; add
   `laterletter://` and your web URL to redirect URLs.

## 3. Edge Functions

```bash
cp .env.example supabase/functions/.env     # keep only the "Edge Function secrets" part
# fill in real values (never commit this file — it is git-ignored)
node -e "console.log('1:'+require('crypto').randomBytes(32).toString('base64'))"   # LETTER_ENCRYPTION_KEYS
npx supabase secrets set --env-file supabase/functions/.env
npx supabase functions deploy --use-api     # server-side bundling, no Docker
```

`supabase/config.toml` already marks `deliver-due`, `revenuecat-webhook` and `email-optout`
as `verify_jwt = false` (they authenticate with their own secrets).

> **Back up `LETTER_ENCRYPTION_KEYS` in a password manager now.** Without it, stored letters
> cannot be decrypted. See docs/SECURITY.md for rotation.

### Mock vs real email

| `EMAIL_PROVIDER` | Behaviour |
|---|---|
| `mock` (default) | **Sends nothing.** Logs a masked line (`[MOCK EMAIL — not sent]`) in the function logs. With `MOCK_EMAIL_LOG_LINKS=true` it also logs claim links so you can test claiming — use only in a private dev project. |
| `resend` | Real email via the Resend API (`RESEND_API_KEY`, `EMAIL_FROM` on a verified domain). |

A successful send only means the provider **accepted** the email (`provider_accepted`), not
that it reached an inbox or was read. The app says exactly that.

`PUSH_PROVIDER=mock` similarly disables real push sends.

## 4. Run the app on your phone

The app uses native modules (audio, notifications, Google Play Billing), so use a
**development build** rather than Expo Go:

```bash
cp .env.example .env.local      # fill EXPO_PUBLIC_SUPABASE_URL / _ANON_KEY / _WEB_BASE_URL
npx eas-cli login
npx eas-cli init                # creates the EAS project; put its id in EAS_PROJECT_ID
npx eas-cli build --profile development --platform android   # install the APK it produces
npx expo start --dev-client
```

Web (claim/open/delete pages, and the whole app in a browser): `npm run web`.

## 5. Try the full flow quickly (development project only)

1. Make scheduling fast: `update app_config set value = '60' where key = 'min_delivery_lead_seconds';`
2. Sign up in the app, write a letter to an email you control, schedule it ~2 minutes ahead.
3. With `EMAIL_PROVIDER=resend` you get the invitation; with `mock` + `MOCK_EMAIL_LOG_LINKS=true`
   copy the claim link from **Edge Functions → create-letter → Logs**.
4. Open the link, sign in with that email (6-digit code), claim. The sender gets a notification.
5. Wait for the time (cron runs each minute) or trigger a tick yourself:

   ```bash
   curl -X POST https://<ref>.supabase.co/functions/v1/deliver-due \
     -H "Authorization: Bearer <WORKER_SECRET>"
   ```

   For an accelerated clock, set `ALLOW_TEST_CLOCK=true` (dev only) and send
   `-d '{"now":"2030-01-01T00:00:00Z"}'`. Recipient access still checks the real database time,
   so the letter opens in the app only once its real time has passed.
6. Put `min_delivery_lead_seconds` back to `3600` before real users arrive.

## 6. Web pages & Android App Links

```bash
npx expo export --platform web      # outputs dist/
```

Host `dist/` on any static host (Netlify, Vercel, Cloudflare Pages) **with an SPA fallback**
(rewrite all paths to `/index.html`). Then edit `public/.well-known/assetlinks.json` with your
package name and the **SHA-256 of the Play App Signing key** (Play Console → Setup → App
signing) so invitation links open the app directly.

## 7. Subscriptions (RevenueCat + Google Play Billing)

1. Play Console: create subscription products (e.g. `plus_monthly`, `plus_yearly`).
2. RevenueCat: create a project and Android app, upload a Play service-account key, create
   entitlement **`premium`**, attach both products, and make a default offering with monthly
   and annual packages.
3. App: put the public SDK key (starts with `goog_`) in `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY`.
4. Server: put the **secret** key in `REVENUECAT_SECRET_API_KEY`; in RevenueCat → Integrations
   → Webhooks set URL `https://<ref>.supabase.co/functions/v1/revenuecat-webhook` and an
   Authorization header value equal to `REVENUECAT_WEBHOOK_AUTH`.

Premium is never trusted from the device: the server re-fetches the subscriber from
RevenueCat before writing `entitlements`.

## 8. Push notifications

`npx eas-cli credentials` → Android → upload an FCM V1 service-account key. Provide
`google-services.json` to EAS as a file environment variable named `GOOGLE_SERVICES_JSON`.

## Tests

| Command | What it runs |
|---|---|
| `npm test` | Unit tests (time zones/DST, growth, reveal rules, crypto, email templates, providers, entitlements, colour contrast) |
| `npm run test:db` | Real Postgres 17 (downloaded via npm by `embedded-postgres`, **no Docker**) with a Supabase shim; RLS, immutability, delivery, retries, concurrency, invitations, trees, safety, deletion, and the server-side vertical slice |
| `npm run check:functions` | Deno type-check of every Edge Function |
| `npm run verify` | All of the above plus typecheck and lint |
