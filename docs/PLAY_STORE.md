# Google Play launch checklist

What is already built into the app is marked ✅. Items marked ☐ are things only you can do
in the Play Console or with your accounts.

## Identity & build

- ✅ Package name **`app.laterletter.mobile`** (confirmed). It can never change after the first upload.
- ✅ Target API level 36 (Expo SDK 57), min SDK 24, edge-to-edge.
- ✅ Release builds are minified and resource-shrunk (`expo-build-properties`).
- ✅ `eas.json` production profile builds an **Android App Bundle** with remote, auto-incremented `versionCode`.
- ☐ `npx eas-cli build --profile production --platform android`, then
  `npx eas-cli submit --platform android` (needs a Play service-account key) — the submit
  profile uploads to the **internal** track as a draft.
- ☐ Personal developer accounts created after Nov 2023 must run a **closed test with at least
  12 testers for 14 days** before production access. Plan for it.

## Store listing assets

- ✅ App icon 512×512: `assets/images/play-store-icon-512.png` (adaptive + themed icons are in the app).
- ✅ Feature graphic 1024×500: `store/feature-graphic.png`.
- ✅ 8 phone screenshots 1080×1920: `store/screenshots/` (rendered from the web build with sample
  data — ☐ swap in real-device captures when you can).
- ✅ Name, short and full description, release notes: `store/listing.md` (lengths tested against Play limits).

## Policy requirements

| Requirement | Status |
|---|---|
| Privacy policy URL | ✅ in-app at `/legal/privacy`; ☐ publish the web build and use `https://<WEB_BASE_URL>/legal/privacy`. ☐ Have the draft text reviewed for your jurisdiction. |
| Account deletion in app | ✅ You → Delete account (erases data as described in docs/SECURITY.md). |
| Account deletion web URL | ✅ `https://<WEB_BASE_URL>/account-deletion` (works signed out, with an email fallback). |
| User-generated content | ✅ Terms acceptance at onboarding, report a letter, block a sender, rate limits, reserved names. ☐ Someone must review reports (see SECURITY.md → Moderation). |
| Permissions | ✅ Only INTERNET, VIBRATE, POST_NOTIFICATIONS (asked in context, after the user opts in), MODIFY_AUDIO_SETTINGS, FOREGROUND_SERVICE(+_MEDIA_PLAYBACK). Microphone, storage, media, location and camera are explicitly blocked. |
| Foreground service declaration | ☐ Play Console → App content → Foreground service permissions: declare **media playback** (background ambient music with lock-screen controls) and attach a short screen recording. |
| Subscriptions | ✅ Google Play Billing via RevenueCat; price, renewal and cancellation terms on the paywall; restore purchases; link to Play subscription management; server-side verification. |
| Target audience | ☐ Declare 13+; don’t opt into the Families program (the app has an age confirmation). |
| Content rating | ☐ Complete the questionnaire: users interact/share content (letters); no ads. |
| App access for review | ✅ `npm run seed:reviewer` creates a password account with a letter ready to open and one growing (see DEPLOY.md step 9). ☐ Enter the credentials under App access. |
| Ads | ✅ None. Declare “no ads”. |

## Data safety form (matches what the code does)

| Data type | Collected | Shared | Purpose | Optional |
|---|---|---|---|---|
| Email address | Yes | No | Account management, app functionality | No |
| Name (display name) | Yes | No | App functionality | No |
| User IDs | Yes | No | Account management | No |
| Other in-app messages (letters) | Yes | No | App functionality | No |
| Purchase history | Yes (subscription status) | No | App functionality | Yes |
| Device or other IDs (push token) | Yes | No | App functionality (notifications) | Yes |
| App interactions (tree care) | Yes | No | App functionality | Yes |

- Encrypted in transit: **Yes** (HTTPS everywhere; letter contents are additionally encrypted at rest with AES-256-GCM).
- Users can request deletion: **Yes** (in app and via the web URL).
- Service providers (Supabase, email provider, Expo push, Google Play/RevenueCat) process data
  on your behalf; under Play’s definitions that is not “sharing”.
- No analytics or crash-reporting SDK is included. If you add one later, update this form.

## Before you press “Publish”

- ☐ `npm run check:env:server -- --production` passes (it enforces `EMAIL_PROVIDER=resend`, no test clock, no link logging), and `min_delivery_lead_seconds` is `3600`.
- ☐ Supabase on a paid plan with daily backups (consider PITR), SMTP configured, OTP template updated.
- ☐ `LETTER_ENCRYPTION_KEYS` backed up offline.
- ☐ `assetlinks.json` has the Play App Signing SHA-256 and is served from your domain.
- ☐ A support inbox exists for `EXPO_PUBLIC_SUPPORT_EMAIL`.
