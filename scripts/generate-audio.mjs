#!/usr/bin/env node
/**
 * Synthesizes LaterLetter's ambient music and sound effects from scratch, so every sound in
 * the app is original and free of third-party licensing. Output: assets/audio/*.m4a (AAC).
 * Requires ffmpeg on PATH. Deterministic: same seed → same files.
 *
 *   node scripts/generate-audio.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SR = 44100;
const OUT = join(process.cwd(), 'assets', 'audio');
const TMP = mkdtempSync(join(tmpdir(), 'll-audio-'));
mkdirSync(OUT, { recursive: true });

let seed = 20261013;
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const TAU = Math.PI * 2;
const midi = (n) => 440 * 2 ** ((n - 69) / 12);

function buffer(seconds) {
  return new Float32Array(Math.round(seconds * SR));
}

/** Additive soft tone: fundamental + gentle harmonics, with attack/release envelope. */
function addTone(buf, start, dur, freq, amp, { attack = 0.02, release = 0.5, harmonics = [1, 0.3, 0.1], decay = 0, vibrato = 0 } = {}) {
  const s0 = Math.floor(start * SR);
  const n = Math.floor((dur + release) * SR);
  const phase = harmonics.map(() => rand() * TAU);
  for (let i = 0; i < n && s0 + i < buf.length; i++) {
    const t = i / SR;
    let env = t < attack ? t / attack : t < dur ? 1 : Math.max(0, 1 - (t - dur) / release);
    if (decay) env *= Math.exp(-t * decay);
    const vib = vibrato ? 1 + 0.003 * Math.sin(TAU * vibrato * t) : 1;
    let v = 0;
    harmonics.forEach((h, k) => {
      v += h * Math.sin(TAU * freq * (k + 1) * vib * t + phase[k]);
    });
    buf[s0 + i] += v * env * amp;
  }
}

function lowpass(buf, cutoff) {
  const rc = 1 / (TAU * cutoff);
  const a = 1 / SR / (rc + 1 / SR);
  let y = 0;
  for (let i = 0; i < buf.length; i++) {
    y += a * (buf[i] - y);
    buf[i] = y;
  }
}

function noise(seconds, color = 'pink') {
  const b = buffer(seconds);
  let b0 = 0, b1 = 0, b2 = 0, brown = 0;
  for (let i = 0; i < b.length; i++) {
    const w = rand() * 2 - 1;
    if (color === 'brown') {
      brown = (brown + 0.02 * w) / 1.02;
      b[i] = brown * 3.5;
    } else {
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      b[i] = (b0 + b1 + b2 + w * 0.1848) * 0.11;
    }
  }
  return b;
}

function mixInto(dst, src, gain = 1, offset = 0) {
  for (let i = 0; i < src.length && i + offset < dst.length; i++) dst[i + offset] += src[i] * gain;
}

/** Crossfade the tail into the head so the track loops without a seam. */
function makeLoop(buf, fadeSeconds) {
  const f = Math.floor(fadeSeconds * SR);
  const out = buf.slice(0, buf.length - f);
  for (let i = 0; i < f; i++) {
    const t = i / f;
    out[i] = out[i] * Math.sin((t * Math.PI) / 2) + buf[buf.length - f + i] * Math.cos((t * Math.PI) / 2);
  }
  return out;
}

function normalize(buf, peak = 0.8) {
  let max = 0;
  for (const v of buf) max = Math.max(max, Math.abs(v));
  const g = max > 0 ? peak / max : 1;
  for (let i = 0; i < buf.length; i++) buf[i] = Math.tanh(buf[i] * g * 1.1) / Math.tanh(1.1);
  return buf;
}

function fadeEdges(buf, inS = 0.01, outS = 0.05) {
  const a = Math.floor(inS * SR), b = Math.floor(outS * SR);
  for (let i = 0; i < a; i++) buf[i] *= i / a;
  for (let i = 0; i < b; i++) buf[buf.length - 1 - i] *= i / b;
  return buf;
}

function writeWav(path, buf) {
  const data = Buffer.alloc(buf.length * 2);
  for (let i = 0; i < buf.length; i++) data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(buf[i] * 32767))), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(SR, 24);
  h.writeUInt32LE(SR * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  writeFileSync(path, Buffer.concat([h, data]));
}

function encode(name, buf, bitrate = '80k') {
  const wav = join(TMP, `${name}.wav`);
  writeWav(wav, buf);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wav, '-c:a', 'aac', '-b:a', bitrate, '-ac', '1', '-movflags', '+faststart', join(OUT, `${name}.m4a`)]);
  console.log(`  ✓ ${name}.m4a (${(buf.length / SR).toFixed(1)}s)`);
}

// ── Ambient tracks ───────────────────────────────────────────────────────────

function morningDew() {
  const len = 124, b = buffer(len);
  const chords = [[60, 64, 67, 71], [57, 60, 64, 67], [53, 57, 60, 64], [55, 59, 62, 67]]; // Cmaj7 Am7 Fmaj7 G
  for (let t = 0, k = 0; t < len; t += 10, k++) {
    for (const n of chords[k % 4]) addTone(b, t, 10, midi(n - 12), 0.05, { attack: 3, release: 4, harmonics: [1, 0.25, 0.08], vibrato: 0.2 });
    addTone(b, t, 10, midi(chords[k % 4][0] - 24), 0.06, { attack: 3, release: 4, harmonics: [1, 0.1] });
  }
  const pent = [72, 74, 76, 79, 81, 84];
  for (let t = 2; t < len - 3; t += 1.6 + rand() * 3) addTone(b, t, 0.05, midi(pent[Math.floor(rand() * pent.length)]), 0.07, { attack: 0.005, release: 2.5, decay: 1.2, harmonics: [1, 0.4, 0.15, 0.05] });
  lowpass(b, 3500);
  mixInto(b, noise(len), 0.01);
  return normalize(makeLoop(b, 4), 0.7);
}

function rainOnLeaves() {
  const len = 124, b = noise(len);
  lowpass(b, 1800);
  for (let i = 0; i < b.length; i++) b[i] *= 0.55;
  for (let t = 0; t < len; t += 0.03 + rand() * 0.12) {
    addTone(b, t, 0.002, 1500 + rand() * 2500, 0.03 * rand(), { attack: 0.001, release: 0.04, decay: 60, harmonics: [1] });
  }
  for (let t = 0; t < len; t += 16) for (const n of [45, 52, 57]) addTone(b, t, 16, midi(n), 0.035, { attack: 5, release: 5, harmonics: [1, 0.2] });
  return normalize(makeLoop(b, 4), 0.65);
}

function starlitOrchard() {
  const len = 124, b = buffer(len);
  const scale = [62, 64, 66, 69, 71, 74, 76, 78, 81]; // D major pentatonic-ish
  const beat = 60 / 72;
  const pattern = [0, 2, 4, 2, 5, 4, 2, 1, 0, 3, 5, 7, 6, 4, 3, 1];
  for (let i = 0, t = 0; t < len - 2; i++, t += beat / 2) {
    if (rand() < 0.18) continue;
    addTone(b, t, 0.04, midi(scale[pattern[i % pattern.length]]), 0.06, { attack: 0.003, release: 1.8, decay: 2.2, harmonics: [1, 0.5, 0.2, 0.08] });
  }
  for (let t = 0; t < len; t += 12) for (const n of [50, 57, 62]) addTone(b, t, 12, midi(n), 0.03, { attack: 4, release: 4, harmonics: [1, 0.15], vibrato: 0.15 });
  lowpass(b, 5000);
  return normalize(makeLoop(b, 4), 0.7);
}

function hearth() {
  const len = 124, b = noise(len, 'brown');
  for (let i = 0; i < b.length; i++) b[i] *= 0.5;
  for (let t = 0; t < len; t += 0.4 + rand() * 1.8) {
    const pops = 1 + Math.floor(rand() * 3);
    for (let p = 0; p < pops; p++) addTone(b, t + p * 0.02, 0.001, 900 + rand() * 1800, 0.05 * rand(), { attack: 0.0005, release: 0.02, decay: 120, harmonics: [1, 0.5] });
  }
  for (let t = 0; t < len; t += 20) for (const n of [41, 48, 57, 60]) addTone(b, t, 20, midi(n), 0.03, { attack: 6, release: 6, harmonics: [1, 0.3, 0.1], vibrato: 0.1 });
  lowpass(b, 2500);
  return normalize(makeLoop(b, 4), 0.65);
}

// ── Sound effects ────────────────────────────────────────────────────────────

function water() {
  const b = buffer(1.2);
  [0, 0.18, 0.31].forEach((t, i) => {
    const s0 = Math.floor(t * SR);
    for (let j = 0; j < 0.25 * SR; j++) {
      const tt = j / SR;
      const f = 1400 - 900 * Math.min(1, tt / 0.08) - i * 120;
      b[s0 + j] += Math.sin(TAU * f * tt) * Math.exp(-tt * 18) * 0.5;
    }
  });
  return fadeEdges(normalize(b, 0.6));
}

function sunlight() {
  const b = buffer(1.8);
  [1568, 2093, 2637, 3136].forEach((f, i) => addTone(b, i * 0.09, 0.05, f, 0.15, { attack: 0.004, release: 1.3, decay: 2.5, harmonics: [1, 0.2] }));
  return fadeEdges(normalize(b, 0.5));
}

function breathe() {
  const b = buffer(2.4);
  for (const n of [60, 67, 72]) addTone(b, 0, 1.2, midi(n), 0.2, { attack: 1.0, release: 1.1, harmonics: [1, 0.2] });
  return fadeEdges(normalize(b, 0.45));
}

function sealBreak() {
  const b = buffer(1.2);
  const n = noise(0.25);
  for (let i = 0; i < n.length; i++) n[i] *= Math.exp(-(i / SR) * 25);
  mixInto(b, n, 1.2);
  addTone(b, 0, 0.05, 110, 0.5, { attack: 0.002, release: 0.3, decay: 10, harmonics: [1, 0.3] });
  [0.25, 0.4, 0.55].forEach((t, i) => addTone(b, t, 0.04, midi(72 + i * 4), 0.15, { attack: 0.003, release: 0.6, decay: 4, harmonics: [1, 0.3] }));
  return fadeEdges(normalize(b, 0.6));
}

function bloom() {
  const b = buffer(2.6);
  [60, 64, 67, 72, 76].forEach((n, i) => addTone(b, i * 0.14, 0.06, midi(n), 0.14, { attack: 0.004, release: 1.6, decay: 1.4, harmonics: [1, 0.35, 0.1] }));
  return fadeEdges(normalize(b, 0.55));
}

console.log('Generating ambient tracks…');
encode('morning-dew', morningDew());
encode('rain-on-leaves', rainOnLeaves());
encode('starlit-orchard', starlitOrchard());
encode('hearth-and-hush', hearth());
console.log('Generating sound effects…');
encode('sfx-water', water(), '64k');
encode('sfx-sunlight', sunlight(), '64k');
encode('sfx-breathe', breathe(), '64k');
encode('sfx-seal', sealBreak(), '64k');
encode('sfx-bloom', bloom(), '64k');
rmSync(TMP, { recursive: true, force: true });
console.log('Done.');
