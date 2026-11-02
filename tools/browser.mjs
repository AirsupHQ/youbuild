// Shared by the demo, the live test and the film: a fresh Chromium profile with YouBuild loaded.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// headless: true runs Chromium's new headless mode, which can load extensions.
export async function launch({ extension = true, headless = true, width = 1920, height = 1080, window = false, extraArgs = [], scale = 1 } = {}) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'youbuild-profile-'));
  const args = ['--no-first-run', '--no-default-browser-check', '--disable-sync', '--hide-crash-restore-bubble', '--lang=en-US'];
  if (extension) args.push(`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`);
  if (window) args.push(`--window-size=${width},${height}`, '--window-position=0,0');
  args.push(...extraArgs);
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless,
    args,
    ignoreDefaultArgs: ['--enable-automation'],
    viewport: window ? null : { width, height },
    deviceScaleFactor: window ? undefined : scale,
    locale: 'en-US',
    colorScheme: 'light',
  });
  let extensionId = null;
  if (extension) {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 20000 });
    extensionId = new URL(worker.url()).host;
  }
  const close = async () => {
    await context.close().catch(() => {});
    fs.rmSync(profile, { recursive: true, force: true });
  };
  return { context, extensionId, profile, close };
}

// The EU cookie question: answer "Reject all", the way a person would.
export async function passConsent(page) {
  await page.goto('https://www.youtube.com/', { waitUntil: 'domcontentloaded' });
  const reject = page.locator('button[aria-label*="Reject"], form[action*="consent"] button:has-text("Reject all")').first();
  try {
    await reject.waitFor({ timeout: 6000 });
    await reject.click();
    await page.waitForLoadState('domcontentloaded');
  } catch { /* no consent wall in this country */ }
}
