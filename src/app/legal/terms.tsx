import { LegalPage } from '@/components/LegalPage';
import { config } from '@/lib/config';

// Draft terms. Have them reviewed before publishing (see docs/PLAY_STORE.md).
export default function Terms() {
  return (
    <LegalPage
      title="Terms of Use"
      updated="13 October 2026"
      sections={[
        { heading: 'Welcome', body: ['Letter Later lets you write letters that open on a date you choose. By using it you agree to these terms.'] },
        {
          heading: 'Be kind',
          body: [
            'Don’t use Letter Later to harass, threaten, bully, impersonate or spam anyone, or to send hateful, sexual, violent or illegal content. Anonymous letters are anonymous to the recipient, not to us.',
            'We may remove letters, stop deliveries, and suspend accounts that break these rules. Recipients can report letters and block senders at any time.',
          ],
        },
        {
          heading: 'Letters can’t be changed once sent',
          body: [
            'After you seal a letter, you can’t edit, reschedule or cancel it. We deliver it in the app at the time you chose. Email notices depend on email providers and may be delayed or filtered; we can’t guarantee they are received or read.',
            'If you delete your account, letters that haven’t arrived yet are cancelled.',
          ],
        },
        {
          heading: 'Letter Later Plus',
          body: [
            'Plus is a subscription billed by Google Play. It renews automatically until you cancel in Google Play. Plus changes only how trees look and which styles you can use — never when letters open.',
          ],
        },
        { heading: 'Your content', body: ['You own what you write. You give us permission to store and deliver it for you. You’re responsible for having the right to share what you send, including music files you add to your own device.'] },
        { heading: 'Age', body: ['You must be at least 13 years old to use Letter Later.'] },
        { heading: 'Changes and contact', body: [`We’ll tell you about important changes in the app. Contact: ${config.supportEmail}`] },
      ]}
    />
  );
}
