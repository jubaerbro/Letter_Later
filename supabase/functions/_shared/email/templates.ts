/**
 * Email templates. By design they never receive letter content: not the body, not the
 * subject, not the preview — only who it is from (when revealed) and when it opens.
 */
import { formatInZone, timeZoneLabel } from '../domain/time.ts';

export type EmailTemplate = 'invitation' | 'letter_waiting' | 'letter_arrived' | 'letter_accepted';

export interface EmailContext {
  senderName: string | null; // null when the sender chose to stay anonymous
  senderHandle: string | null;
  recipientName: string | null;
  deliverAt: Date;
  timeZone: string;
}

export interface TemplateLinks {
  actionUrl: string;
  optOutUrl?: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Keeps sender-chosen names from turning emails into something else. */
function safeName(name: string | null): string | null {
  if (!name) return null;
  return name.replace(/[\r\n\t]/g, ' ').replace(/https?:\/\/\S+/gi, '').trim().slice(0, 40) || null;
}

function when(ctx: EmailContext) {
  const date = formatInZone(ctx.deliverAt, ctx.timeZone, { dateStyle: 'full', timeStyle: 'short' }, 'en-GB');
  return `${date} (${timeZoneLabel(ctx.timeZone, ctx.deliverAt, 'en-GB')})`;
}

function layout(title: string, paragraphs: string[], button: { label: string; url: string }, footer: string[]): string {
  const ps = paragraphs
    .map((p) => `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#3b3a36">${p}</p>`)
    .join('');
  const fs = footer.map((p) => `<p style="margin:0 0 8px;font-size:12px;line-height:1.5;color:#8a867c">${p}</p>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;background:#f6f1e7;font-family:Georgia,'Times New Roman',serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f1e7;padding:32px 12px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fffdf8;border-radius:20px;padding:36px 32px;border:1px solid #ece4d3">
<tr><td>
<p style="margin:0 0 4px;font-size:28px">🌱</p>
<h1 style="margin:0 0 20px;font-size:24px;font-weight:normal;color:#2f3b2c">${title}</h1>
${ps}
<p style="margin:28px 0"><a href="${escapeHtml(button.url)}" style="background:#5b7a52;color:#ffffff;text-decoration:none;padding:14px 26px;border-radius:999px;font-family:Helvetica,Arial,sans-serif;font-size:15px;display:inline-block">${escapeHtml(button.label)}</a></p>
${fs}
</td></tr></table>
<p style="font-size:12px;color:#a59f91;font-family:Helvetica,Arial,sans-serif">Letter Later · letters that arrive when the time is right</p>
</td></tr></table></body></html>`;
}

export function renderEmail(template: EmailTemplate, ctx: EmailContext, links: TemplateLinks): RenderedEmail {
  const sender = safeName(ctx.senderName);
  const from = sender ? escapeHtml(sender) : 'Someone';
  const fromText = sender ?? 'Someone';
  const date = when(ctx);
  const security =
    'We will never ask for your password by email. The letter itself is sealed and is not included in this message.';

  switch (template) {
    case 'invitation': {
      const subject = sender ? `${sender} planted a letter for you` : 'A letter is waiting for you';
      const ignore = 'Don’t know the sender or not interested? You can simply ignore this email.';
      const optOut = links.optOutUrl ? `Never want these invitations? <a href="${escapeHtml(links.optOutUrl)}" style="color:#8a867c">Stop invitation emails</a>.` : '';
      return {
        subject,
        html: layout(
          'A letter is growing for you',
          [
            `${from} wrote you a letter on Letter Later. It is sealed until <strong>${escapeHtml(date)}</strong>.`,
            'Claim your free mailbox to watch its tree grow while you wait. You can open the letter in the app or on the web when the day comes.',
          ],
          { label: 'Claim your letter', url: links.actionUrl },
          [ignore, optOut, security].filter(Boolean),
        ),
        text: [
          subject,
          '',
          `${fromText} wrote you a letter on Letter Later. It is sealed until ${date}.`,
          'Claim your free mailbox to watch its tree grow while you wait:',
          links.actionUrl,
          '',
          ignore,
          links.optOutUrl ? `Stop invitation emails: ${links.optOutUrl}` : '',
          security,
        ].join('\n'),
      };
    }
    case 'letter_waiting': {
      const subject = sender ? `${sender} planted a letter for you` : 'A new letter seed has arrived';
      return {
        subject,
        html: layout(
          'A new seed has arrived',
          [`${from} planted a letter for you. It opens on <strong>${escapeHtml(date)}</strong>.`, 'Accept it in your mailbox to grow a tree together.'],
          { label: 'Open your mailbox', url: links.actionUrl },
          [security],
        ),
        text: `${subject}\n\n${fromText} planted a letter for you. It opens on ${date}.\nAccept it in your mailbox: ${links.actionUrl}\n\n${security}`,
      };
    }
    case 'letter_arrived': {
      const subject = 'Your letter has arrived ✉️';
      const extra = links.optOutUrl ? [`<a href="${escapeHtml(links.optOutUrl)}" style="color:#8a867c">Stop emails from Letter Later</a>`] : [];
      return {
        subject,
        html: layout(
          'The day has come',
          [`The letter ${sender ? `from ${from}` : 'that was waiting for you'} is ready to open.`],
          { label: 'Open your letter', url: links.actionUrl },
          [security, ...extra],
        ),
        text: `${subject}\n\nThe letter ${sender ? `from ${fromText}` : 'that was waiting for you'} is ready to open:\n${links.actionUrl}\n\n${security}${links.optOutUrl ? `\nStop emails: ${links.optOutUrl}` : ''}`,
      };
    }
    case 'letter_accepted': {
      const who = safeName(ctx.recipientName);
      const subject = `${who ?? 'Your recipient'} accepted your letter 🌱`;
      return {
        subject,
        html: layout(
          'Your letter was accepted',
          [`${who ? escapeHtml(who) : 'Your recipient'} is now growing a tree for your letter too. It opens on <strong>${escapeHtml(date)}</strong>.`],
          { label: 'See both trees', url: links.actionUrl },
          ['Your letter stays sealed until then. Nobody can read it early — not even us.'],
        ),
        text: `${subject}\n\n${who ?? 'Your recipient'} is now growing a tree for your letter too. It opens on ${date}.\n${links.actionUrl}`,
      };
    }
  }
}
