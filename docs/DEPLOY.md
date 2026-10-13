# Deploying LaterLetter

A step-by-step runbook from empty accounts to a live Google Play app. Every command runs on
your own computer (Node 22.18+); nothing needs Docker. Steps marked 🔒 involve secrets: keep
them in a password manager, never in git.

## 0. Accounts

| Service | What for | Cost (as of writing) |
|---|---|---|
| A domain (e.g. `laterletter.app`) | Web pages, App Links, email sender | ~$10–20/yr |
| [Supabase](https://supabase.com) | Database, auth, functions, scheduler | Pro plan recommended for daily backups |
| [Resend](https://resend.com) | Invitation and sign-in emails | Free tier to start |
| [Expo / EAS](https://expo.dev) | Cloud builds, store submission, OTA updates | Free tier to start |
| [Google Play Console](https://play.google.com/console) | Publishing | $25 one-time |
| [Firebase](https://console.firebase.google.com) | Push delivery on Android (FCM) | Free |
| [RevenueCat](https://www.revenuecat.com) | Subscriptions (Google Play Billing) | Free tier to start |
| Netlify, Cloudflare Pages or Vercel | Hosting the web pages | Free tier |

## 1. Email domain (Resend)

1. Add a sending subdomain such as `mail.laterletter.app` in Resend and create the DNS records
   it shows (SPF, DKIM; add a DMARC record too). Wait until it says *Verified*.
2. Create an API key 🔒 (starts with `re_`).

## 2. Backend (Supabase)

```bash
npm install
npm run secrets:generate -- --web https://laterletter.app     # writes supabase/functions/.env 🔒
```

Open `supabase/functions/.env` and fill in `RESEND_API_KEY`, and `REVENUECAT_SECRET_API_KEY`
once you've done step 8. **Back up `LETTER_ENCRYPTION_KEYS` now** 🔒: without it no letter can
ever be decrypted again.

```bash
npm run check:env:server -- --production        # must print "OK" (warnings are fine for now)

export SUPABASE_ACCESS_TOKEN=…   # 🔒 dashboard → Account → Access tokens
export SUPABASE_PROJECT_REF=…    # Project settings → General → Reference ID
export SUPABASE_DB_PASSWORD=…    # 🔒 the database password chosen at project creation
npm run deploy:backend
```

The deploy script applies the migrations, uploads the secrets, deploys all Edge Functions,
stores the scheduler's secrets in Vault, and finishes with a smoke test (an authenticated
scheduler tick plus a health check). Re-running it is safe.

Then, once, in the Supabase dashboard:

- **Authentication → Emails → SMTP settings**: host `smtp.resend.com`, port `465`, user
  `resend`, password = your Resend API key, sender `LaterLetter <hello@mail.laterletter.app>`.
- **Authentication → Emails → Templates → Magic Link**: the body must show the code, e.g.
  `<h2>Your LaterLetter code</h2><p style="font-size:28px;letter-spacing:6px"><strong>{{ .Token }}</strong></p><p>It expires in 15 minutes. If you didn't ask for it, you can ignore this email.</p>`
- **Authentication → URL configuration**: Site URL `https://laterletter.app`; redirect URLs
  `https://laterletter.app/**` and `laterletter://**`.
- **Database → Backups**: confirm daily backups (Pro plan); consider Point-in-Time Recovery.

## 3. Monitoring

Point any uptime monitor (Better Stack, UptimeRobot, Cronitor…) at

```
https://<project-ref>.supabase.co/functions/v1/health?token=<HEALTH_CHECK_TOKEN>
```

every 5 minutes. It returns **200** while letters flow and **503** with a list of problems
(`scheduler_stalled`, `letters_overdue`, `emails_failed`, …) otherwise. It returns counts
only, never ids, emails or content. To investigate, use the SQL in docs/SECURITY.md → Operations.

For app crashes, Google Play Console → Android vitals reports crashes and ANRs automatically.

## 4. Expo / EAS project

```bash
npx eas-cli@latest login
npx eas-cli@latest init          # prints the project id → use it as EAS_PROJECT_ID below
```

Set the app's **public** configuration for production builds (these values ship inside the
app, so they must not be secrets; the build fails if they are missing or if a secret key is
used by mistake):

```bash
for kv in \
  "EXPO_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co" \
  "EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon / publishable key>" \
  "EXPO_PUBLIC_WEB_BASE_URL=https://laterletter.app" \
  "EXPO_PUBLIC_SUPPORT_EMAIL=support@laterletter.app" \
  "EXPO_PUBLIC_REVENUECAT_ANDROID_KEY=goog_…" \
  "EAS_PROJECT_ID=<id from eas init>"; do
  npx eas-cli@latest env:create --environment production --visibility plaintext --name "${kv%%=*}" --value "${kv#*=}"
done
```

Repeat with `--environment preview` / `development` for those profiles (they can point to a
separate staging Supabase project).

## 5. Push notifications (Firebase)

1. Firebase console → add an Android app with package **`app.laterletter.mobile`** → download
   `google-services.json`.
2. `npx eas-cli@latest env:create --environment production --type file --visibility secret --name GOOGLE_SERVICES_JSON --value ./google-services.json`
3. Firebase → Project settings → Service accounts → generate a key 🔒, then
   `npx eas-cli@latest credentials` → Android → production → *Google Service Account Key for
   push notifications (FCM V1)* → upload it.

## 6. First build and first upload

```bash
npx eas-cli@latest build --platform android --profile production
```

EAS creates and stores the upload keystore for you. Before building, the
`eas-build-pre-install` hook runs `scripts/check-env.mjs` and stops a production build that
is missing configuration.

In Play Console: **Create app** → name *LaterLetter*, app, free → complete the *App content*
section (privacy policy URL, ads: none, app access → step 9's reviewer account, content rating,
target audience 13+, data safety per docs/PLAY_STORE.md, foreground service: media playback).
Google requires the **first** bundle of a new app to be uploaded by hand: Testing → Internal
testing → Create release → upload the `.aab` from the EAS build page.

Afterwards, create a Play service account with release permissions 🔒 and run
`npx eas-cli@latest submit --platform android` (or use the *Release Android* GitHub workflow);
later releases go up automatically to the internal track as drafts.

## 7. Web pages and App Links

1. Play Console → Test and release → App integrity → copy the **App signing key SHA-256**.
2. Connect the repository to Netlify, Cloudflare Pages or Vercel (configs are included:
   `netlify.toml`, `public/_redirects` + `_headers`, `vercel.json`). Build command
   `npm run build:web`, output `dist`. Environment variables: the same `EXPO_PUBLIC_*` values
   as step 4, plus `ANDROID_CERT_SHA256=<fingerprint>` (comma-separate several).
3. Add your custom domain with HTTPS. Check that these load:
   `https://laterletter.app/.well-known/assetlinks.json`, `/legal/privacy`, `/legal/terms`,
   `/account-deletion`.
4. On a phone with the app installed, a `https://laterletter.app/claim?...` link should open the app.

## 8. Subscriptions

1. Play Console → Monetize → Subscriptions: create `plus_monthly` and `plus_yearly`
   (subscriptions can only be created after the first bundle is uploaded).
2. RevenueCat: new project → Android app `app.laterletter.mobile` → upload a Play service
   account key → entitlement **`premium`** containing both products → default offering with
   monthly and annual packages.
3. Copy the public SDK key (`goog_…`) into the EAS variable from step 4, and the **secret** key
   🔒 into `REVENUECAT_SECRET_API_KEY` in `supabase/functions/.env`.
4. RevenueCat → Integrations → Webhooks: URL
   `https://<project-ref>.supabase.co/functions/v1/revenuecat-webhook`, Authorization header =
   `REVENUECAT_WEBHOOK_AUTH` from your `.env`.
5. `npm run deploy:backend -- --skip-migrations` to upload the new secret.

## 9. Account for Google's reviewers

```bash
SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=… SUPABASE_ANON_KEY=… \
LETTER_ENCRYPTION_KEYS=… WORKER_SECRET=… \
REVIEWER_EMAIL=review@laterletter.app REVIEWER_PASSWORD='<long password>' \
npm run seed:reviewer
```

This creates a password account (reviewers can't receive sign-in codes) with one letter
ready to open and one still growing. Enter the same credentials under Play Console → App
content → App access.

## 10. Testing tracks → production

1. Internal testing: install from the Play link on your own phones and walk through the full
   flow (sign up, write to a second email, claim, wait for delivery, open, report/block,
   delete account).
2. **Closed testing with ≥ 12 testers for 14 continuous days.** Personal developer accounts
   created after November 2023 need this before production access.
3. Apply for production access and roll out (staged rollout recommended: 10% → 50% → 100%).

## Ongoing releases

| Change | How |
|---|---|
| JavaScript/UI only | GitHub → Actions → **OTA update** (or `npx eas-cli@latest update --channel production --environment production --message "…"`). Reaches installed apps on next launch. |
| Native change, new dependency, or app version bump | Bump `version` in `app.config.ts`, then **Release Android** workflow (`versionCode` increments automatically). |
| Database or Edge Functions | Add a new migration file (never edit applied ones), then **Deploy backend** workflow or `npm run deploy:backend`. |

GitHub repository secrets used by the workflows: `EXPO_TOKEN`, `SUPABASE_ACCESS_TOKEN`,
`SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`, `FUNCTIONS_ENV` (the full contents of
`supabase/functions/.env`). Put them in a GitHub *environment* named `production` and require
approval for it.

## Go-live checklist

- [ ] `npm run verify` passes; CI is green.
- [ ] `npm run check:env:server -- --production` shows no errors; `APP_ENV=production`, `EMAIL_PROVIDER=resend`.
- [ ] `select value from app_config where key = 'min_delivery_lead_seconds'` returns `3600`.
- [ ] Health endpoint returns 200 and an uptime monitor is watching it.
- [ ] Encryption key backed up offline; database backups enabled.
- [ ] Sign-in code email arrives from your domain within a minute (check spam folders too).
- [ ] An invitation email arrives, its link opens the app, and claiming works.
- [ ] `assetlinks.json` is served with your app-signing fingerprint.
- [ ] Privacy policy and terms reviewed, and live on the web.
- [ ] Support inbox is monitored; someone is responsible for reviewing reports (SECURITY.md → Moderation).
- [ ] Reviewer account seeded and entered in Play Console.
