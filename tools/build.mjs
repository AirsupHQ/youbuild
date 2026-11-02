#!/usr/bin/env node
// Packs the extension into dist/: youbuild-vX.Y.Z.zip for Chrome, Edge, Brave and Arc
// (unzip it, then Load unpacked) and youbuild-vX.Y.Z-firefox.zip for Firefox.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const version = manifest.version;
const dist = path.join(ROOT, 'dist');
const FILES = ['manifest.json', 'LICENSE', 'icons', 'src', 'data/channels.json'];

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

function stage(name, edit) {
  const dir = path.join(dist, name);
  for (const f of FILES) {
    const from = path.join(ROOT, f);
    const to = path.join(dir, f);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.cpSync(from, to, { recursive: true });
  }
  if (edit) {
    const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    edit(m);
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(m, null, 2) + '\n');
  }
  return dir;
}

function zip(dir, file, { flat = false } = {}) {
  const out = path.join(dist, file);
  // Chrome: one folder inside the zip, so unzipping gives the folder to pick in Load unpacked.
  // Firefox: files at the root, the way addons.mozilla.org and about:debugging expect them.
  if (flat) execFileSync('zip', ['-r', '-X', '-q', out, '.'], { cwd: dir });
  else execFileSync('zip', ['-r', '-X', '-q', out, path.basename(dir)], { cwd: path.dirname(dir) });
  return out;
}

const chrome = stage(`youbuild-v${version}`);
const firefox = stage(`youbuild-v${version}-firefox`, (m) => {
  m.background = { scripts: ['src/background.js'], type: 'module' };
  m.browser_specific_settings = {
    gecko: { id: 'youbuild@airsup.ai', strict_min_version: '140.0', data_collection_permissions: { required: ['none'] } },
    gecko_android: { strict_min_version: '142.0' },
  };
});

const files = [zip(chrome, `youbuild-v${version}.zip`), zip(firefox, `youbuild-v${version}-firefox.zip`, { flat: true })];
for (const f of files) console.log(path.relative(ROOT, f), (fs.statSync(f).size / 1024).toFixed(0) + ' KB');
