#!/usr/bin/env node
// Renders icons/icon.svg to the PNG sizes the manifest asks for.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'icons');
const svg = fs.readFileSync(path.join(dir, 'icon.svg'), 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage();
for (const size of [16, 32, 48, 128]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  await page.screenshot({ path: path.join(dir, `icon-${size}.png`), omitBackground: true });
}
await browser.close();
console.log('icons written');
