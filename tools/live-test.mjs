#!/usr/bin/env node
// Opens real youtube.com (logged out, fresh profile) and checks the home, a search for "cooking",
// a search for "CNC" and a watch page sidebar. Each page is read twice in the same tab: with
// YouBuild paused (plain YouTube) and with YouBuild on, so both see the same results.
//
//   node tools/live-test.mjs                  checks only
//   node tools/live-test.mjs --shots dir      also saves before and after screenshots
import fs from 'node:fs';
import path from 'node:path';
import { launch, passConsent, ROOT } from './browser.mjs';

const args = process.argv.slice(2);
const shots = args.includes('--shots') ? path.resolve(args[args.indexOf('--shots') + 1]) : null;
if (shots) fs.mkdirSync(shots, { recursive: true });
const WATCH = args.includes('--watch') ? args[args.indexOf('--watch') + 1] : null;

async function pickWatchVideo() {
  if (WATCH) return WATCH;
  // The newest long video from Mark Rober: a builder whose sidebar usually mixes in everything else.
  const r = await fetch('https://www.youtube.com/feeds/videos.xml?playlist_id=UULFY1kMZp36IQSyNx_9h4mpCg').catch(() => null);
  const id = r && r.ok ? ((await r.text()).match(/<yt:videoId>([^<]+)</) || [])[1] : null;
  return id || 'xQI3hrzjhVo';
}

const { context, close } = await launch({ window: true, width: 1920, height: 1167 });
const page = context.pages()[0] || await context.newPage();
const sw = context.serviceWorkers()[0];
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const setEnabled = (enabled) => sw.evaluate(async (on) => {
  const { settings = {} } = await chrome.storage.local.get('settings');
  await chrome.storage.local.set({ settings: { ...settings, enabled: on } });
}, enabled);

async function imagesReady(ms = 12000) {
  await page.waitForFunction(() => [...document.querySelectorAll('img')].filter((i) => {
    const r = i.getBoundingClientRect();
    return r.width > 60 && r.bottom > 0 && r.top < innerHeight && i.closest('#youbuild-home, ytd-thumbnail, yt-thumbnail-view-model, #related, ytd-search');
  }).every((i) => i.complete && (i.naturalWidth > 120 || i.dataset.fallback)), null, { timeout: ms }).catch(() => {});
}

async function read() {
  return page.evaluate(() => {
    const t = (e, s) => (e.querySelector(s) && e.querySelector(s).textContent || '').replace(/\s+/g, ' ').trim();
    const cards = (sel) => [...document.querySelectorAll(sel)].filter((e) => !e.parentElement.closest(sel)).map((e) => ({
      yb: e.dataset.yb || '',
      shown: e.offsetParent !== null,
      title: t(e, '#video-title, h3, [class*="LockupMetadataViewModelTitle"]') || t(e, '#channel-title'),
      channel: t(e, 'ytd-channel-name #text, #channel-name #text, [class*="ContentMetadataViewModelMetadataRow"]'),
      why: t(e, '.yb-why'),
    }));
    return {
      url: location.href,
      homeCards: document.querySelectorAll('#youbuild-home .ybh-card').length,
      homeChannels: new Set([...document.querySelectorAll('#youbuild-home .ybh-chan')].map((e) => e.textContent)).size,
      search: cards('ytd-search ytd-video-renderer, ytd-search ytd-channel-renderer'),
      shortsShelvesVisible: [...document.querySelectorAll('ytd-search grid-shelf-view-model, ytd-search ytd-reel-shelf-renderer')].filter((e) => e.offsetParent !== null).length,
      related: cards('#related yt-lockup-view-model, #related ytd-compact-video-renderer'),
      empty: !!document.getElementById('yb-empty'),
    };
  });
}

async function shot(name, tag) {
  if (!shots) return;
  await imagesReady();
  await page.mouse.move(1915, 1075);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(shots, `${name}-${tag}.png`) });
}

// Both pictures start at the first real result, below any sponsored shelf.
async function toFirstResult() {
  await page.evaluate(() => {
    const first = [...document.querySelectorAll('ytd-search ytd-video-renderer, ytd-search ytd-channel-renderer')]
      .find((e) => !e.closest('ytd-ad-slot-renderer') && e.offsetParent !== null);
    if (first) { first.scrollIntoView({ block: 'start' }); scrollBy(0, -110); }
  });
  await page.waitForTimeout(600);
}

const before = {};
const after = {};
const watchId = await pickWatchVideo();
try {
  await passConsent(page);
  // Home, paused and then on.
  await setEnabled(false);
  await page.goto('https://www.youtube.com/');
  await page.waitForTimeout(4000);
  before.home = await read();
  await shot('home', 'before');
  await setEnabled(true);
  await page.waitForFunction(() => document.querySelectorAll('#youbuild-home .ybh-card').length >= 24, null, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(6000);
  after.home = await read();
  await shot('home', 'after');

  for (const [name, q] of [['cooking', 'cooking'], ['cnc', 'CNC']]) {
    await setEnabled(false);
    await page.goto('https://www.youtube.com/results?search_query=' + encodeURIComponent(q));
    await page.waitForSelector('ytd-search ytd-video-renderer', { timeout: 20000 });
    await page.waitForTimeout(3500);
    before[name] = await read();
    await toFirstResult();
    await shot(name, 'before');
    await setEnabled(true);
    await page.waitForTimeout(2500);
    after[name] = await read();
    await page.evaluate(() => scrollTo(0, 0));
    await toFirstResult();
    await shot(name, 'after');
  }

  await setEnabled(false);
  await page.goto('https://www.youtube.com/watch?v=' + watchId);
  await page.waitForSelector('#related yt-lockup-view-model, #related ytd-compact-video-renderer', { timeout: 20000 });
  await page.waitForTimeout(5000);
  await page.evaluate(() => { const v = document.querySelector('video'); if (v) v.pause(); });
  before.watch = await read();
  await shot('watch', 'before');
  await setEnabled(true);
  await page.waitForTimeout(2500);
  after.watch = await read();
  await shot('watch', 'after');
} finally {
  await close();
}

const visible = (list) => list.filter((c) => c.yb !== 'hide');
const checks = [];
const check = (name, ok, detail) => checks.push({ name, ok: !!ok, detail });
check('home shows the YouBuild home', after.home.homeCards >= 24, `${after.home.homeCards} cards from ${after.home.homeChannels} channels`);
const cookingLeft = visible(after.cooking.search);
check('cooking leaves nothing, or only building videos', cookingLeft.length === 0 || cookingLeft.every((c) => !/cook|recipe|chef|food/i.test(c.title)), `${cookingLeft.length} of ${before.cooking.search.length} left: ${cookingLeft.map((c) => c.title).join(' | ')}`);
check('cooking says why it is empty', after.cooking.empty || cookingLeft.length > 0, after.cooking.empty ? 'empty state shown' : 'some building videos left');
const cncLeft = visible(after.cnc.search);
check('CNC keeps machining videos', cncLeft.length >= 4, `${cncLeft.length} of ${before.cnc.search.length} left`);
check('CNC drops the French film agency', !cncLeft.some((c) => /cin[eé]ma|colloque/i.test(c.title + ' ' + c.channel)), cncLeft.map((c) => c.title).slice(0, 6).join(' | '));
check('Shorts shelves are gone', after.cooking.shortsShelvesVisible === 0 && after.cnc.shortsShelvesVisible === 0, `${before.cnc.shortsShelvesVisible} before, ${after.cnc.shortsShelvesVisible} after`);
const relLeft = visible(after.watch.related);
check('watch sidebar keeps building videos', relLeft.length >= 3, `${relLeft.length} of ${before.watch.related.length} left`);
check('every visible card has a why chip', [...cncLeft, ...relLeft].every((c) => c.why), '');
check('no YouBuild errors on the page', !errors.filter((e) => /youbuild|yb-/i.test(e)).length, errors.join(' | '));

for (const c of checks) console.log(`${c.ok ? 'ok  ' : 'FAIL'} ${c.name}${c.detail ? ': ' + c.detail : ''}`);
fs.writeFileSync(path.join(shots || path.join(ROOT, '.work'), 'live-report.json'), JSON.stringify({ when: new Date().toISOString(), watchId, before, after, checks }, null, 1));
process.exit(checks.every((c) => c.ok) ? 0 : 1);
