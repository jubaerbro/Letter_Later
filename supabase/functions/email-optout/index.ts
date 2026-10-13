// GET/POST /functions/v1/email-optout?t=<signed>  (deploy with --no-verify-jwt)
// GET shows a confirmation page; POST (including RFC 8058 one-click from mail clients)
// adds the address to email_suppressions so no further invitations are sent.
import { verifySignedValue } from '../_shared/crypto.ts';
import { requireEnv, serve, serviceClient, SupabaseDb, log } from '../_shared/supabase.ts';

function page(title: string, message: string, form = '') {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title></head>
<body style="margin:0;background:#f6f1e7;font-family:Georgia,serif;color:#2f3b2c;display:flex;min-height:100vh;align-items:center;justify-content:center">
<main style="max-width:420px;margin:24px;background:#fffdf8;border-radius:20px;padding:32px;border:1px solid #ece4d3">
<p style="font-size:28px;margin:0">🌿</p><h1 style="font-weight:normal">${title}</h1><p style="line-height:1.6">${message}</p>${form}
</main></body></html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } },
  );
}

serve(['GET', 'POST'], async (req) => {
  const url = new URL(req.url);
  const token = url.searchParams.get('t') ?? '';
  const value = await verifySignedValue(requireEnv('EMAIL_OPTOUT_SECRET'), token);
  if (!value || !value.startsWith('optout:')) {
    return page('Link not recognised', 'This link is incomplete or has been changed. Nothing was updated.');
  }
  const email = value.slice('optout:'.length);

  if (req.method === 'GET') {
    return page(
      'Stop invitation emails?',
      'We will stop sending Letter Later invitations to this address. If someone writes to you later, you will not be emailed about it.',
      `<form method="post"><button style="background:#5b7a52;color:#fff;border:0;border-radius:999px;padding:12px 22px;font-size:15px">Stop emails</button></form>`,
    );
  }
  await new SupabaseDb(serviceClient()).rpc('suppress_email', { p_email: email });
  log('email_opt_out', {});
  return page('Done', 'You will not receive further invitation emails from Letter Later. Take care.');
});
