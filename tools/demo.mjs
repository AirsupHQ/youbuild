#!/usr/bin/env node
// Opens a clean browser for recording a YouBuild demo: Playwright's own Chromium (not your Chrome),
// a brand new temporary profile with no other extensions, bookmarks or accounts, YouBuild loaded,
// a 1920 x 1080 window and youtube.com on screen. Close the window when you are done; the profile
// is deleted.
//
//   npm run demo
//   npm run demo -- --size 1280x720 --url https://www.youtube.com/results?search_query=cnc
import { launch, passConsent } from './browser.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const [width, height] = opt('--size', '1920x1080').split('x').map(Number);
const url = opt('--url', 'https://www.youtube.com/');
const headless = process.env.YOUBUILD_HEADLESS === '1';

const { context, close } = await launch({ headless, window: !headless, width, height });
let closing = false;
const done = async () => { if (closing) return; closing = true; await close(); process.exit(0); };
process.on('SIGINT', done);
process.on('SIGTERM', done);
context.on('close', done);

const page = context.pages()[0] || await context.newPage();
// YouTube asks about cookies in Europe. The demo answers "Reject all" so the question is not in your video.
await passConsent(page);
if (url !== 'https://www.youtube.com/') await page.goto(url);
console.log(`YouBuild demo browser is open (${width} x ${height}). Close the window to finish.`);
if (headless) { await page.waitForTimeout(8000); await page.screenshot({ path: process.env.YOUBUILD_SHOT || 'demo-check.png' }); await done(); }
