#!/usr/bin/env node
/**
 * Renders the app icon set from SVG with Chromium (via Playwright).
 *   PLAYWRIGHT_CHROMIUM=/path/to/chromium node scripts/generate-icons.mjs
 * Requires the `playwright` package to be resolvable (npx -p playwright works).
 */
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const OUT = join(process.cwd(), 'assets', 'images');
mkdirSync(OUT, { recursive: true });

const sprout = (fill1, fill2, stem) => `
  <path d="M512 360 C 508 300, 520 250, 512 200" stroke="${stem}" stroke-width="22" stroke-linecap="round" fill="none"/>
  <ellipse cx="452" cy="214" rx="66" ry="34" fill="${fill1}" transform="rotate(-28 452 214)"/>
  <ellipse cx="574" cy="190" rx="72" ry="36" fill="${fill2}" transform="rotate(24 574 190)"/>`;

const envelope = (paper, line, seal, sealText) => `
  <rect x="262" y="360" width="500" height="340" rx="40" fill="${paper}" stroke="${line}" stroke-width="10"/>
  <path d="M272 690 L512 520 L752 690" fill="none" stroke="${line}" stroke-width="10" stroke-linejoin="round"/>
  <path d="M270 372 L512 556 L754 372" fill="${paper}" stroke="${line}" stroke-width="10" stroke-linejoin="round"/>
  <circle cx="512" cy="556" r="56" fill="${seal}"/>
  <circle cx="512" cy="556" r="40" fill="none" stroke="${sealText}" stroke-opacity="0.45" stroke-width="5"/>
  <path d="M512 530 C 498 548, 498 566, 512 582 C 526 566, 526 548, 512 530 Z" fill="${sealText}" opacity="0.9"/>`;

const background = `
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#FBEBD8"/><stop offset="0.6" stop-color="#F5DCCB"/><stop offset="1" stop-color="#EBD9E6"/>
  </linearGradient></defs>
  <rect width="1024" height="1024" fill="url(#bg)"/>
  <circle cx="512" cy="470" r="330" fill="#FFFFFF" opacity="0.35"/>`;

const art = (scale = 1) => `<g transform="translate(512 470) scale(${scale}) translate(-512 -470)">
  ${sprout('#7FA86A', '#A6C98D', '#6E9C5C')}
  ${envelope('#FFF8EC', '#C9A97E', '#B4483D', '#FFE9D6')}
</g>`;

const mono = (scale = 1, color = '#FFFFFF') => `<g transform="translate(512 470) scale(${scale}) translate(-512 -470)">
  ${sprout(color, color, color)}
  <rect x="262" y="360" width="500" height="340" rx="40" fill="${color}"/>
  <path d="M290 392 L512 556 L734 392" fill="none" stroke="#000" stroke-width="22" stroke-linejoin="round" opacity="1"/>
  <circle cx="512" cy="556" r="52" fill="#000"/>
</g>`;

const svg = (size, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">${body}</svg>`;

// Monochrome icons are alpha masks: punch the details out instead of drawing black.
const maskMono = (scale) => `<defs><mask id="m">${mono(scale, '#FFFFFF').replace(/#000/g, '#000000')}</mask></defs>
  <rect width="1024" height="1024" fill="#FFFFFF" mask="url(#m)"/>`;

const jobs = [
  { file: 'icon.png', size: 1024, body: background + art(1.08) },
  { file: 'play-store-icon-512.png', size: 512, body: background + art(1.08) },
  { file: 'android-icon-background.png', size: 1024, body: background },
  // Adaptive icon foreground: keep the art inside the central safe zone (~66%).
  { file: 'android-icon-foreground.png', size: 1024, body: art(0.78), transparent: true },
  { file: 'android-icon-monochrome.png', size: 1024, body: maskMono(0.78), transparent: true },
  { file: 'splash-icon.png', size: 512, body: art(1.15), transparent: true },
  { file: 'notification-icon.png', size: 96, body: maskMono(1.25), transparent: true },
  { file: 'favicon.png', size: 64, body: background + art(1.15) },
];

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined });
const page = await browser.newPage();
for (const job of jobs) {
  await page.setViewportSize({ width: job.size, height: job.size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg(job.size, job.body)}</body></html>`);
  await page.screenshot({ path: join(OUT, job.file), omitBackground: !!job.transparent, clip: { x: 0, y: 0, width: job.size, height: job.size } });
  console.log(`  ✓ ${job.file}`);
}
await browser.close();
