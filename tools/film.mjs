#!/usr/bin/env node
// Records the YouBuild film: a fresh browser with YouBuild on real youtube.com, 1920 x 1080,
// a drawn cursor, page loads cut out. Writes film.mp4 (30 fps, silent) and film.gif.
//
//   node tools/film.mjs --out .work/film
//   node tools/film.mjs --out .work/film --assemble     rebuild film.mp4 from the saved frames
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { launch, passConsent, ROOT } from './browser.mjs';

const args = process.argv.slice(2);
const OUT = path.resolve(args.includes('--out') ? args[args.indexOf('--out') + 1] : path.join(ROOT, '.work', 'film'));
const FRAMES = path.join(OUT, 'frames');
// Every output frame shows the newest captured frame at its time. (Feeding the captured frames to
// ffmpeg with their own durations stretches the film: its image reader holds each one >= 1/25 s.)
function assemble(dir, list) {
  const seq = path.join(dir, 'seq');
  fs.rmSync(seq, { recursive: true, force: true });
  fs.mkdirSync(seq, { recursive: true });
  const total = list.reduce((a, e) => a + e.d, 0);
  const count = Math.round(total * 30);
  let i = 0;
  let edge = list[0].d;
  for (let k = 0; k < count; k++) {
    const t = (k + 0.5) / 30;
    while (t > edge && i < list.length - 1) { i++; edge += list[i].d; }
    fs.linkSync(list[i].file, path.join(seq, String(k).padStart(5, '0') + '.jpg'));
  }
  const mp4 = path.join(dir, 'film.mp4');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '30', '-i', path.join(seq, '%05d.jpg'),
    '-vf', 'format=yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-movflags', '+faststart', '-an', mp4]);
  const gif = path.join(dir, 'film.gif');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', mp4, '-vf',
    'fps=12,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=160:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle', gif]);
  console.log(`${(count / 30).toFixed(2)} s, ${count} frames`);
  console.log(mp4);
  console.log(gif);
}

if (args.includes('--assemble')) {
  const list = fs.readFileSync(path.join(OUT, 'frames.txt'), 'utf8').split('\n').reduce((acc, line) => {
    const f = line.match(/^file '(.+)'$/);
    const d = line.match(/^duration ([\d.]+)$/);
    if (f) acc.push({ file: f[1], d: 0 });
    if (d && acc.length) acc[acc.length - 1].d = Number(d[1]);
    return acc;
  }, []).filter((e) => e.d > 0);
  assemble(OUT, list);
  process.exit(0);
}

fs.rmSync(FRAMES, { recursive: true, force: true });
fs.mkdirSync(FRAMES, { recursive: true });

// A cursor the viewer can follow. Headless browsers draw none. Built with DOM calls because
// youtube.com enforces Trusted Types.
const CURSOR = `(() => {
  if (window.top !== window) return;
  const NS = 'http://www.w3.org/2000/svg';
  let cur = null;
  const make = () => {
    if (cur && cur.isConnected) return cur;
    cur = document.createElement('div');
    cur.id = 'film-cursor';
    cur.style.cssText = 'position:fixed;left:0;top:0;width:30px;height:30px;z-index:2147483647;pointer-events:none;transform:translate(-200px,-200px)';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', '30'); svg.setAttribute('height', '30');
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', 'M3 2 L3 19 L7.6 14.8 L10.6 21.6 L13.6 20.3 L10.7 13.6 L17 13.6 Z');
    p.setAttribute('fill', '#0f0f0f'); p.setAttribute('stroke', '#ffffff'); p.setAttribute('stroke-width', '1.4'); p.setAttribute('stroke-linejoin', 'round');
    svg.append(p); cur.append(svg);
    (document.body || document.documentElement).append(cur);
    return cur;
  };
  addEventListener('mousemove', (e) => { make().style.transform = 'translate(' + (e.clientX - 3) + 'px,' + (e.clientY - 2) + 'px)'; }, true);
  addEventListener('mousedown', (e) => {
    const r = document.createElement('div');
    r.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;left:' + (e.clientX - 18) + 'px;top:' + (e.clientY - 18) + 'px;width:36px;height:36px;border-radius:50%;background:rgba(61,220,132,.35);transform:scale(.4);transition:transform .35s ease-out, opacity .35s ease-out';
    (document.body || document.documentElement).append(r);
    requestAnimationFrame(() => { r.style.transform = 'scale(1.4)'; r.style.opacity = '0'; });
    setTimeout(() => r.remove(), 450);
  }, true);
})();`;

// Software rendering: no GPU job, so no stalled GPU frames (the solid magenta kind).
const { context, close } = await launch({ window: true, width: 1920, height: 1167, extraArgs: ['--disable-gpu', '--force-color-profile=srgb'] });
await context.addInitScript(CURSOR);
const page = context.pages()[0] || await context.newPage();
const sw = context.serviceWorkers()[0];
const setSettings = (patch) => sw.evaluate(async (p) => {
  const { settings = {} } = await chrome.storage.local.get('settings');
  await chrome.storage.local.set({ settings: { ...settings, ...p } });
}, patch);

let mouse = { x: 1500, y: 700 };
const T0 = Date.now();
const mark = (name) => console.log(((Date.now() - T0) / 1000).toFixed(1).padStart(6), name);
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
// Moves on the clock, so a move takes ms however slow each mouse event is to deliver.
async function moveTo(x, y, ms = 700) {
  const from = { ...mouse };
  const t0 = Date.now();
  for (;;) {
    const k = Math.min(1, (Date.now() - t0) / ms);
    const e = ease(k);
    await page.mouse.move(from.x + (x - from.x) * e, from.y + (y - from.y) * e);
    if (k >= 1) break;
    await page.waitForTimeout(6);
  }
  mouse = { x, y };
}
async function center(selector) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error('not on screen: ' + selector);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
async function clickOn(selector, ms = 700) {
  const c = await center(selector);
  await moveTo(c.x, c.y, ms);
  await page.waitForTimeout(120);
  await page.mouse.down();
  await page.waitForTimeout(70);
  await page.mouse.up();
}
const hold = (ms) => page.waitForTimeout(ms);
// Waits for the thumbnails on screen to finish loading (or failing), at most 3.5 s.
async function imagesReady() {
  const t0 = Date.now();
  await page.waitForFunction(() => [...document.querySelectorAll('#youbuild-home img, ytd-search ytd-thumbnail img, ytd-search yt-image img')].filter((i) => {
    const r = i.getBoundingClientRect();
    return r.bottom > 0 && r.top < innerHeight && r.width > 40;
  }).every((i) => i.complete && (i.naturalWidth > 120 || i.dataset.fallback)), null, { timeout: 3500 }).catch(() => {});
  // Loaded is not painted: on a busy machine decoding lags, so wait for that too.
  await page.evaluate(() => Promise.race([
    Promise.all([...document.querySelectorAll('#youbuild-home img, ytd-search ytd-thumbnail img')].filter((i) => {
      const r = i.getBoundingClientRect();
      return r.bottom > 0 && r.top < innerHeight;
    }).map((i) => i.decode().catch(() => {}))),
    new Promise((res) => setTimeout(res, 2500)),
  ]));
  await page.waitForTimeout(120);
  if (Date.now() - t0 > 1500) mark('images took ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
}

// ---------- screencast ----------
const cdp = await context.newCDPSession(page);
const frames = [];
const spans = [];
let live = null;
cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
  cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  if (!live) return;
  const file = path.join(FRAMES, String(frames.length).padStart(5, '0') + '.jpg');
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
  frames.push({ t: metadata.timestamp, file });
});
const rec = () => { live = { start: Date.now() / 1000 }; };
const cut = () => { if (live) { spans.push({ start: live.start, end: Date.now() / 1000 }); live = null; } };

// ---------- set up off camera ----------
await passConsent(page);
await page.waitForFunction(() => document.querySelectorAll('#youbuild-home .ybh-card').length >= 40, null, { timeout: 60000 });
await page.waitForTimeout(9000); // every builder feed fetched and cached
// Load the thumbnails the film shows, so nothing loads on camera.
for (const cat of ['aerospace', 'machining', 'all']) {
  await page.click(`#youbuild-home .ybh-chip[data-cat="${cat}"]`);
  await page.waitForTimeout(400);
  for (const y of [0, 700, 1400, 0]) { await page.evaluate((y) => scrollTo(0, y), y); await page.waitForTimeout(500); await imagesReady(); }
}
await setSettings({ enabled: false });
await page.goto('https://www.youtube.com/results?search_query=rocket');
await page.waitForSelector('ytd-search ytd-video-renderer', { timeout: 20000 });
await page.waitForTimeout(3000);
// Start at the first real result, below any sponsored shelf (YouBuild leaves ads alone).
await page.evaluate(() => {
  const first = [...document.querySelectorAll('ytd-search ytd-video-renderer')].find((e) => !e.closest('ytd-ad-slot-renderer'));
  if (first) { first.scrollIntoView({ block: 'start' }); scrollBy(0, -96); }
});
await page.waitForTimeout(800);
await imagesReady();
await page.mouse.move(mouse.x, mouse.y);
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
await hold(300);

// ---------- 1. YouTube as it is, then YouBuild on ----------
rec(); mark('rec 1');
await hold(1600);
await clickOn('#yb-pill', 800);
await hold(400);
await clickOn('#yb-panel .yb-row:first-child .yb-switch', 500);
await hold(1700);
console.log('on screen after the switch:', (await page.evaluate(() => [...document.querySelectorAll('ytd-search ytd-video-renderer')]
  .filter((e) => e.offsetParent !== null && e.getBoundingClientRect().top < innerHeight && e.getBoundingClientRect().bottom > 0)
  .map((e) => (e.querySelector('#video-title') || {}).textContent.trim().slice(0, 60) + ' [' + ((e.querySelector('.yb-why') || {}).textContent || 'ad') + ']'))).join(' | '));
await page.mouse.click(1850, 640); // close the panel: empty margin right of the results
await hold(150);
await moveTo(mouse.x, mouse.y, 10);
const chip = 'ytd-search [data-yb="show"] .yb-why';
await moveTo((await center(chip)).x, (await center(chip)).y, 700);
await hold(1700);

// ---------- 2. Cooking ----------
await clickOn('ytd-masthead input[name="search_query"], ytd-masthead #search input', 750);
await page.keyboard.press('ControlOrMeta+A');
await page.keyboard.press('Backspace');
await page.keyboard.type('cooking', { delay: 85 });
await hold(250);
await page.keyboard.press('Enter');
cut(); mark('cut 1');
await page.waitForSelector('#yb-empty', { timeout: 20000 });
await page.waitForTimeout(400);
rec(); mark('rec 2');
await moveTo(1100, 470, 600);
await hold(2400);

// ---------- 3. Home ----------
await clickOn('ytd-masthead ytd-topbar-logo-renderer a', 800);
cut(); mark('cut 2');
await page.waitForSelector('#youbuild-home .ybh-card', { timeout: 20000 });
await page.waitForTimeout(600);
await imagesReady();
rec(); mark('rec 3');
await moveTo(1200, 650, 450);
await hold(1400);
await clickOn('#youbuild-home .ybh-chip[data-cat="aerospace"]', 750);
await imagesReady();
await hold(1400);
await clickOn('#youbuild-home .ybh-chip[data-cat="machining"]', 650);
await imagesReady();
await hold(1400);
await clickOn('#youbuild-home .ybh-chip[data-cat="all"]', 700);
await imagesReady();
await moveTo(1500, 760, 500);
await hold(1700);
cut(); mark('cut 3');

await cdp.send('Page.stopScreencast').catch(() => {});
await close();

// ---------- assemble: keep only the recorded spans, resample to exactly 30 fps ----------
const entries = [];
for (const s of spans) {
  const inSpan = frames.filter((f) => f.t >= s.start - 0.05 && f.t <= s.end);
  // The frame on screen when the span starts may be older than the span.
  const before = frames.filter((f) => f.t < s.start).pop();
  const seq = before ? [{ ...before, t: s.start }, ...inSpan] : inSpan;
  for (let i = 0; i < seq.length; i++) {
    const end = i + 1 < seq.length ? seq[i + 1].t : s.end;
    const d = end - Math.max(seq[i].t, s.start);
    if (d > 0) entries.push({ file: seq[i].file, d });
  }
}
fs.writeFileSync(path.join(OUT, 'frames.txt'), entries.map((e) => `file '${e.file}'\nduration ${e.d.toFixed(4)}`).join('\n') + '\n');
assemble(OUT, entries);
console.log(`film ${(entries.reduce((a, e) => a + e.d, 0)).toFixed(1)} s from ${frames.length} frames in ${spans.length} takes`);
