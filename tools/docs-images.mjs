#!/usr/bin/env node
// Turns the live test screenshots into the before and after pictures in docs/.
//
//   node tools/live-test.mjs --shots .work/live
//   node tools/docs-images.mjs .work/live
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { ROOT } from './browser.mjs';

const src = path.resolve(process.argv[2] || path.join(ROOT, '.work', 'live'));
const docs = path.join(ROOT, 'docs');
fs.mkdirSync(docs, { recursive: true });

// name, crop of the 1920 x 1080 screenshots (x, y, w, h), width of each side in the picture
const PAIRS = [
  ['home', [0, 0, 1920, 1080], 1180],
  ['cnc', [430, 0, 1300, 1080], 900],
  ['cooking', [430, 0, 1300, 1080], 900],
  ['watch', [1360, 0, 560, 1080], 520],
];

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const [name, [x, y, w, h], side] of PAIRS) {
  const img = (tag) => 'data:image/png;base64,' + fs.readFileSync(path.join(src, `${name}-${tag}.png`)).toString('base64');
  const scale = side / w;
  const pane = (tag, label) => `
    <figure>
      <figcaption>${label}</figcaption>
      <div class="shot" style="width:${side}px;height:${Math.round(h * scale)}px">
        <img src="${img(tag)}" style="width:${Math.round(1920 * scale)}px;transform:translate(${-Math.round(x * scale)}px,${-Math.round(y * scale)}px)">
      </div>
    </figure>`;
  await page.setContent(`<!doctype html><style>
    body { margin: 0; background: #fff; font-family: Roboto, "Helvetica Neue", Arial, sans-serif; }
    main { display: inline-flex; gap: 28px; padding: 28px; }
    figure { margin: 0; }
    figcaption { font-size: 22px; font-weight: 600; letter-spacing: -0.01em; color: #0f0f0f; margin: 0 0 14px 2px; }
    .shot { overflow: hidden; border-radius: 14px; box-shadow: 0 0 0 1px rgba(0,0,0,.1), 0 10px 30px rgba(0,0,0,.08); }
    .shot img { display: block; transform-origin: 0 0; }
  </style><main>${pane('before', 'YouTube')}${pane('after', 'YouTube with YouBuild')}</main>`);
  await page.waitForFunction(() => [...document.images].every((i) => i.complete));
  const box = await page.locator('main').boundingBox();
  await page.setViewportSize({ width: Math.ceil(box.width), height: Math.ceil(box.height) });
  await page.locator('main').screenshot({ path: path.join(docs, `${name}.png`) });
  console.log('docs/' + name + '.png');
}
await browser.close();
