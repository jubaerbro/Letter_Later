// Store screenshots from the production web build (`npm run build:web` with the demo
// EXPO_PUBLIC_SUPABASE_URL below) using SAMPLE data served by request interception.
//   EXPO_PUBLIC_SUPABASE_URL=https://demo-project.supabase.co EXPO_PUBLIC_SUPABASE_ANON_KEY=demo-anon-key-for-screenshots-only npx expo export --platform web
//   PLAYWRIGHT_CHROMIUM=/path/to/chromium npx -p playwright node scripts/store-screenshots.cjs
// Replace them with real device captures when you can.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const DIST = path.join(__dirname, '..', 'dist');
const OUT = process.argv[2] || path.join(__dirname, '..', 'store', 'screenshots');
fs.mkdirSync(OUT, { recursive: true });

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  let file = path.join(DIST, url);
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
  const ext = path.extname(file);
  const type = { '.js': 'application/javascript', '.html': 'text/html', '.png': 'image/png', '.ttf': 'font/ttf', '.json': 'application/json', '.m4a': 'audio/mp4', '.ico': 'image/x-icon' }[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type });
  fs.createReadStream(file).pipe(res);
});

const day = 86400000;
const now = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const USER = { id: '11111111-1111-4111-8111-111111111111', email: 'maya@example.com', aud: 'authenticated', role: 'authenticated', created_at: iso(now - 90 * day), app_metadata: {}, user_metadata: {} };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const JWT = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER.id, role: 'authenticated', exp: Math.floor(now / 1000) + 3600, email: USER.email, aud: 'authenticated' })}.sig`;
const SESSION = { access_token: JWT, refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(now / 1000) + 3600, user: USER };
const PROFILE = { id: USER.id, handle: 'maple-brook-12', display_name: 'Maya', time_zone: 'Europe/London', notify_email: true, notify_push: true, accepts_letters_by_handle: true, hemisphere: 'north', onboarded_at: iso(now - 80 * day), handle_changed_at: null };

const item = (o) => ({
  letter_id: o.id, direction: 'sent', counterpart_name: null, counterpart_handle: null, is_anonymous: false, subject: null, preview: null,
  deliver_at: iso(now + 30 * day), sender_time_zone: 'Europe/London', created_at: iso(now - 30 * day), display_status: 'waiting', accepted: true,
  invite_status: null, my_tree_id: `t-${o.id}`, my_tree_style: 'oak', my_tree_points: 0, their_tree_style: null, their_tree_points: null,
  their_tree_exists: false, delivered_at: null, opened_at: null, ...o,
});
const MAILBOX = [
  item({ id: 'aaaaaaaa-0000-4000-8000-000000000001', direction: 'received', counterpart_name: 'Jun', counterpart_handle: 'river-glade-41', display_status: 'arrived', deliver_at: iso(now - 3600e3), created_at: iso(now - 400 * day), my_tree_style: 'cherry', my_tree_points: 40, their_tree_exists: true, their_tree_style: 'maple', their_tree_points: 30 }),
  item({ id: 'aaaaaaaa-0000-4000-8000-000000000002', direction: 'received', counterpart_name: 'Grandma Rose', subject: 'For your 30th birthday', created_at: iso(now - 200 * day), deliver_at: iso(now + 600 * day), my_tree_style: 'oak', my_tree_points: 24, their_tree_exists: true, their_tree_style: 'willow', their_tree_points: 50 }),
  item({ id: 'aaaaaaaa-0000-4000-8000-000000000003', direction: 'sent', counterpart_name: 'Jun', created_at: iso(now - 300 * day), deliver_at: iso(now + 40 * day), my_tree_style: 'maple', my_tree_points: 60, their_tree_exists: true, their_tree_style: 'birch', their_tree_points: 20, invite_status: 'provider_accepted' }),
  item({ id: 'aaaaaaaa-0000-4000-8000-000000000004', direction: 'self', counterpart_name: 'Maya', created_at: iso(now - 10 * day), deliver_at: iso(now + 3 * 365 * day), my_tree_style: 'starlight', my_tree_points: 4 }),
  item({ id: 'aaaaaaaa-0000-4000-8000-000000000005', direction: 'received', is_anonymous: true, accepted: false, my_tree_id: null, my_tree_style: null, my_tree_points: null, preview: 'Don’t peek… but I think you’ll smile.', created_at: iso(now - 2 * day), deliver_at: iso(now + 120 * day) }),
  item({ id: 'aaaaaaaa-0000-4000-8000-000000000006', direction: 'sent', counterpart_name: 'sam@example.com', accepted: false, created_at: iso(now - 1 * day), deliver_at: iso(now + 5 * 365 * day), my_tree_style: 'lantern', my_tree_points: 2, invite_status: 'provider_accepted' }),
  item({ id: 'aaaaaaaa-0000-4000-8000-000000000007', direction: 'received', counterpart_name: 'Leo', display_status: 'opened', deliver_at: iso(now - 20 * day), created_at: iso(now - 100 * day), my_tree_style: 'oak', my_tree_points: 10 }),
];

async function mock(page, { signedIn }) {
  await page.route('https://demo-project.supabase.co/**', async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const p = u.pathname;
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } });
    if (req.method() === 'OPTIONS') return json({});
    if (p === '/auth/v1/user') return json(USER);
    if (p.startsWith('/auth/v1/')) return json({});
    if (p === '/rest/v1/profiles') return json(PROFILE);
    if (p === '/rest/v1/entitlements') return json(null);
    if (p === '/rest/v1/notifications') return json([{ id: 'n1', kind: 'letter_accepted', title: 'Your letter was accepted 🌱', body: 'Jun is now growing a tree for your letter too.', letter_id: MAILBOX[2].letter_id, created_at: iso(now - 3600e3), read_at: null }]);
    if (p === '/rest/v1/rpc/mailbox') {
      const body = req.postDataJSON() || {};
      return json(body.p_letter_id ? MAILBOX.filter((m) => m.letter_id === body.p_letter_id) : MAILBOX);
    }
    if (p === '/rest/v1/rpc/attach_my_letters') return json(0);
    if (p === '/rest/v1/rpc/tree_care_today') return json([{ kind: 'water' }]);
    if (p === '/rest/v1/rpc/my_tree_styles') return json([
      { style: 'oak', unlocked: true, requirement: 'Always yours' }, { style: 'cherry', unlocked: true, requirement: 'Always yours' },
      { style: 'willow', unlocked: true, requirement: 'Care for trees 10 times' }, { style: 'maple', unlocked: false, requirement: 'Open or have a letter opened' },
      { style: 'birch', unlocked: false, requirement: 'Plant 3 letters' }, { style: 'lantern', unlocked: false, requirement: 'LaterLetter Plus' }, { style: 'starlight', unlocked: false, requirement: 'LaterLetter Plus' },
    ]);
    if (p === '/rest/v1/rpc/invitation_preview') return json({ ok: true, expired: false, claimed: false, email_hint: 'j•••@example.com', sender_name: 'Maya', sender_handle: 'maple-brook-12', subject: null, preview: 'A little something for your first day.', deliver_at: iso(now + 75 * day), sender_time_zone: 'Europe/London', arrived: false });
    if (p === '/functions/v1/letter-content') return json({ role: 'recipient', subject: 'On the day you finally move', body: 'Dear Maya,\n\nIf you are reading this, the boxes are packed and the new keys are in your pocket. I wanted to tell you, a whole year early, how proud I am of the brave, quiet way you go after things.\n\nWater the plants. Call your mum. Leave the window open on the first night.\n\nWith all my love,', openedNow: true });
    return json([]);
  });
  if (signedIn) {
    await page.addInitScript((s) => localStorage.setItem('sb-demo-project-auth-token', JSON.stringify(s)), SESSION);
  }
}

(async () => {
  await new Promise((r) => server.listen(8089, r));
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined });
  const shots = [
    { name: '1-garden', url: '/', signedIn: true },
    { name: '2-trees', url: `/letter/${MAILBOX[2].letter_id}`, signedIn: true },
    { name: '3-sealed', url: `/letter/${MAILBOX[0].letter_id}/open`, signedIn: true },
    { name: '5-write', url: '/compose', signedIn: true },
    { name: '6-invitation', url: '/claim?token=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', signedIn: false },
    { name: '7-night', url: `/letter/${MAILBOX[1].letter_id}`, signedIn: true, dark: true },
    { name: '8-music', url: '/music', signedIn: true },
  ];
  const errors = [];
  for (const s of shots) {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 3, colorScheme: s.dark ? 'dark' : 'light', reducedMotion: 'no-preference' });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${s.name}: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`${s.name} console: ${m.text().slice(0, 200)}`); });
    await mock(page, s);
    await page.goto(`http://localhost:8089${s.url}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(OUT, `${s.name}.png`) });
    if (s.name === '3-sealed') {
      await page.getByText('Open it', { exact: true }).click();
      await page.waitForTimeout(2500);
      await page.screenshot({ path: path.join(OUT, '4-opened.png') });
    }
    await ctx.close();
  }
  await browser.close();
  server.close();
  console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'no page errors');
})();
