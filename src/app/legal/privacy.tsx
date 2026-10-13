import { LegalPage } from '@/components/LegalPage';
import { config } from '@/lib/config';

// Draft describing what the app actually does. Have it reviewed for your jurisdiction
// (see docs/PLAY_STORE.md) and publish the same text at <WEB_BASE_URL>/legal/privacy.
export default function Privacy() {
  return (
    <LegalPage
      title="Privacy Policy"
      updated="13 October 2026"
      sections={[
        {
          heading: 'The short version',
          body: [
            'Your letters are encrypted before they are stored and are only readable by you (the sender) and, from the opening date, by the recipient. We don’t sell data, show ads, or use your letters for analytics.',
          ],
        },
        {
          heading: 'What we collect',
          body: [
            'Account: your email address, display name, personal address (handle), time zone and settings.',
            'Letters: content (encrypted), the recipient’s email or address, the opening date, what you chose to reveal before opening, and delivery status.',
            'Trees: care actions (water, sunlight, quiet moment), points and chosen styles.',
            'Safety: blocks and reports you make, and an audit log of scheduling and delivery events (without letter content).',
            'Devices: a push notification token if you turn notifications on. Music files you add stay on your device and are never uploaded.',
            'Purchases: if you subscribe, Google Play and RevenueCat process the purchase; we receive whether your subscription is active, never your payment details.',
          ],
        },
        {
          heading: 'People you write to',
          body: [
            'When you write to an email address that has no account, we email that person once to say a letter is waiting (with your name unless you chose to be anonymous, and the opening date — never the letter itself). They can stop all invitation emails with one click.',
          ],
        },
        {
          heading: 'How we use it',
          body: [
            'To deliver letters on time, show your mailbox and trees, send the notifications you asked for, keep the service safe (rate limits, blocking, reports), and provide Plus if you subscribe.',
            'If a letter is reported, our safety team may read that letter to review the report.',
          ],
        },
        {
          heading: 'Who processes data for us',
          body: [
            'Supabase (database, authentication, servers), our email provider (to send sign-in codes and letter emails), Expo (push notifications), Google Play and RevenueCat (subscriptions). They process data only to provide these services.',
          ],
        },
        {
          heading: 'Keeping and deleting data',
          body: [
            'You can delete your account at any time in the app (You → Delete account) or at /account-deletion on our website. Deleting cancels and erases letters you sent that haven’t arrived yet. Letters that already arrived remain with their recipients without your account attached. Backups are overwritten within our provider’s backup window.',
            `People without an account can ask us to erase their email address and any letters waiting for it: ${config.supportEmail}.`,
          ],
        },
        {
          heading: 'Children',
          body: ['Letter Later is for people aged 13 and over. If you believe a child under 13 has an account, contact us and we will delete it.'],
        },
        {
          heading: 'Contact',
          body: [`Questions or requests: ${config.supportEmail}`],
        },
      ]}
    />
  );
}
