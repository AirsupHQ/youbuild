#!/usr/bin/env node
// Checks every channel on the list against YouTube: it exists, its name and handle, its latest
// long videos and how many of them the classifier calls building things.
//
//   node tools/verify-channels.mjs                      check data/channels.json (feeds only, fast)
//   node tools/verify-channels.mjs --add list.txt       resolve new "@handle | name | cats | mode" lines
//   node tools/verify-channels.mjs --write              also write the checked list back
//   node tools/verify-channels.mjs --report out.json    save the full report
//
// It only reads public pages and the public uploads feed (youtube.com/feeds/videos.xml).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../src/lib/filter.js';

const YB = globalThis.YouBuild;
const here = path.dirname(fileURLToPath(import.meta.url));
const LIST = path.join(here, '..', 'data', 'channels.json');
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const has = (name) => args.includes(name);

const HEADERS = {
  'accept-language': 'en-US,en;q=0.9',
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36',
  // The "reject all" answer to YouTube's cookie question in the EU, so pages load without the consent wall.
  cookie: 'SOCS=CAI',
};

async function get(url, tries = 3, hops = 0) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: HEADERS, redirect: 'manual', signal: AbortSignal.timeout(25000) });
      if (r.status === 404) return { status: 404, text: '' };
      if (r.status >= 300 && r.status < 400) {
        // Follow YouTube's own redirects (handle case, old /c/ links), never the consent page.
        const to = new URL(r.headers.get('location') || '', url);
        if (to.hostname === 'www.youtube.com' && hops < 3) return get(to.href, tries, hops + 1);
        throw new Error('redirect to ' + to.href);
      }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return { status: r.status, text: await r.text() };
    } catch (e) {
      if (i === tries - 1) return { status: 0, error: e.message, text: '' };
      await new Promise((res) => setTimeout(res, 1500 * (i + 1)));
    }
  }
}

const decode = (s) => String(s || '')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

export function parseFeed(xml) {
  const author = decode((xml.match(/<author>\s*<name>([^<]*)<\/name>/) || [])[1]);
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => {
    const e = m[1];
    return {
      id: (e.match(/<yt:videoId>([^<]+)</) || [])[1],
      title: decode((e.match(/<title>([^<]*)<\/title>/) || [])[1]),
      link: (e.match(/<link rel="alternate" href="([^"]+)"/) || [])[1] || '',
      published: (e.match(/<published>([^<]+)</) || [])[1],
      description: decode((e.match(/<media:description>([\s\S]*?)<\/media:description>/) || [])[1]).slice(0, 600),
      views: Number((e.match(/<media:statistics views="(\d+)"/) || [])[1] || 0),
    };
  });
  return { author, entries };
}

async function resolveHandle(handle) {
  const r = await get('https://www.youtube.com/' + handle);
  if (r.status === 404) return { error: 'no such handle' };
  if (!r.text) return { error: r.error || 'empty page' };
  const t = r.text;
  const id = (t.match(/<meta itemprop="identifier" content="(UC[\w-]{22})"/) || t.match(/"externalId":"(UC[\w-]{22})"/) || [])[1];
  if (!id) return { error: 'no channel id on the page' };
  const title = decode((t.match(/<meta property="og:title" content="([^"]*)"/) || [])[1]);
  const description = decode((t.match(/<meta property="og:description" content="([^"]*)"/) || [])[1]);
  const vanity = (t.match(/"vanityChannelUrl":"https?:\/\/www\.youtube\.com\/(@[^"]+)"/) || [])[1] || handle;
  let subs = '';
  for (const m of t.matchAll(/"content":"[^"]*?@([\w.\-]+)[^"]*?([\d.,]+[KMB]?) subscribers/g)) {
    if ('@' + m[1].toLowerCase() === vanity.toLowerCase()) { subs = m[2]; break; }
  }
  return { id, title, description, handle: decodeURIComponent(vanity), subs };
}

async function feed(id) {
  // UULF is the uploads playlist without Shorts and live streams.
  let r = await get('https://www.youtube.com/feeds/videos.xml?playlist_id=UULF' + id.slice(2));
  let f = r.text ? parseFeed(r.text) : null;
  if (!f || !f.entries.length) {
    r = await get('https://www.youtube.com/feeds/videos.xml?channel_id=' + id);
    f = r.text ? parseFeed(r.text) : null;
  }
  if (!f) return { error: r.error || 'no feed (HTTP ' + r.status + ')' };
  return f;
}

function fit(entries, name) {
  const long = entries.filter((e) => !e.link.includes('/shorts/'));
  const rows = long.map((e) => ({ title: e.title, verdict: YB.classify({ title: e.title, description: e.description }).verdict }));
  const yes = rows.filter((r) => r.verdict === 'yes').length;
  const no = rows.filter((r) => r.verdict === 'no').length;
  return { n: rows.length, yes, no, share: rows.length ? Math.round((yes / rows.length) * 100) / 100 : null, rows };
}

function readCandidates(file) {
  const out = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const l = line.trim();
    if (!l || l.startsWith('#')) continue;
    const blocked = l.startsWith('!');
    const [handle, name, cats, mode] = l.replace(/^!/, '').split('|').map((x) => x.trim());
    out.push(blocked
      ? { handle, name, blocked: true, reason: mode || 'blocked' }
      : { handle, name, categories: cats.split(',').map((c) => c.trim()).filter(Boolean), mode: mode || 'all' });
  }
  return out;
}

async function pool(items, n, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
      await new Promise((res) => setTimeout(res, 250));
    }
  }));
  return results;
}

const list = JSON.parse(fs.readFileSync(LIST, 'utf8'));
const addFile = opt('--add');
const work = addFile ? readCandidates(addFile) : [
  ...list.channels.map((c) => ({ ...c })),
  ...(list.blocked || []).map((c) => ({ ...c, blocked: true })),
];
const known = new Set(list.channels.map((c) => c.id));
const bad = [];
for (const c of work) {
  for (const cat of c.categories || []) if (!YB.CATEGORY_IDS.includes(cat)) bad.push(`${c.handle}: unknown category ${cat}`);
}
if (bad.length) { console.error(bad.join('\n')); process.exit(1); }

let done = 0;
const report = await pool(work, 3, async (c) => {
  const row = { ...c };
  if (!row.id || addFile) {
    const r = await resolveHandle(row.handle);
    if (r.error) { row.error = r.error; }
    else Object.assign(row, { id: r.id, foundName: r.title, handle: r.handle, subs: r.subs, about: r.description.slice(0, 200) });
  }
  if (row.id && !row.blocked) {
    const f = await feed(row.id);
    if (f.error) row.error = f.error;
    else {
      row.foundName = row.foundName || f.author;
      row.latest = f.entries[0] ? f.entries[0].published.slice(0, 10) : null;
      row.fit = fit(f.entries, row.name);
    }
  }
  done++;
  if (done % 20 === 0) process.stderr.write(`${done}/${work.length}\n`);
  return row;
});

const ok = report.filter((r) => !r.error);
const failed = report.filter((r) => r.error);
console.log(`checked ${report.length}, ok ${ok.length}, failed ${failed.length}`);
for (const r of failed) console.log(`FAILED ${r.handle} (${r.name}): ${r.error}`);
const low = ok.filter((r) => !r.blocked && r.mode !== 'topic' && r.fit && r.fit.share !== null && r.fit.share < 0.35);
for (const r of low) console.log(`LOW FIT ${r.handle} (${r.name}) ${r.fit.yes}/${r.fit.n}: ${r.fit.rows.slice(0, 4).map((x) => x.title).join(' | ')}`);
const stale = ok.filter((r) => r.latest && r.latest < new Date(Date.now() - 2 * 365 * 864e5).toISOString().slice(0, 10));
for (const r of stale) console.log(`QUIET since ${r.latest}: ${r.handle} (${r.name})`);
const dupes = new Map();
for (const r of ok) { if (dupes.has(r.id)) console.log(`DUPLICATE ${r.handle} and ${dupes.get(r.id)}`); dupes.set(r.id, r.handle); }

if (opt('--report')) fs.writeFileSync(opt('--report'), JSON.stringify(report, null, 1));

if (has('--write')) {
  // The name is the one YouTube shows today (the sidebar only has names to go by); a different
  // name from the input list is kept as an alias.
  const clean = (r) => {
    const name = (r.foundName || r.name).trim();
    const o = { id: r.id, handle: r.handle, name, categories: r.categories };
    const aliases = new Set(r.aliases || []);
    if (r.name && YB.normName(r.name) !== YB.normName(name)) aliases.add(r.name.trim());
    if (aliases.size) o.aliases = [...aliases];
    if (r.mode === 'topic') o.mode = 'topic';
    return o;
  };
  const channels = new Map(list.channels.map((c) => [c.id, c]));
  const blocked = new Map((list.blocked || []).map((c) => [c.id, c]));
  for (const r of ok) {
    if (r.blocked) blocked.set(r.id, { id: r.id, handle: r.handle, name: (r.foundName || r.name).trim(), reason: r.reason });
    else channels.set(r.id, clean(r));
  }
  if (!addFile) for (const r of failed) if (!r.blocked && known.has(r.id)) console.log(`kept ${r.handle} although the check failed, look at it by hand`);
  const today = new Date().toISOString().slice(0, 10);
  const out = {
    version: today.replace(/-/g, '.'),
    updated: today,
    note: list.note,
    channels: [...channels.values()].sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' })),
    blocked: [...blocked.values()].sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' })),
  };
  fs.writeFileSync(LIST, JSON.stringify(out, null, 2) + '\n');
  console.log(`wrote ${out.channels.length} channels and ${out.blocked.length} blocked to data/channels.json`);
}
