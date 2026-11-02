// Reads YouTube's public uploads feed (youtube.com/feeds/videos.xml) without a DOM parser,
// plus the small text helpers the YouBuild home needs. Plain script, like filter.js.
(function (root) {
  'use strict';

  const decode = (s) => String(s || '')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');

  function parseFeed(xml) {
    const text = String(xml || '');
    const author = decode((text.match(/<author>\s*<name>([^<]*)<\/name>/) || [])[1]);
    const entries = [...text.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => {
      const e = m[1];
      return {
        id: (e.match(/<yt:videoId>([^<]+)</) || [])[1],
        title: decode((e.match(/<title>([^<]*)<\/title>/) || [])[1]),
        link: (e.match(/<link rel="alternate" href="([^"]+)"/) || [])[1] || '',
        published: (e.match(/<published>([^<]+)</) || [])[1] || '',
        description: decode((e.match(/<media:description>([\s\S]*?)<\/media:description>/) || [])[1]).slice(0, 600),
        views: Number((e.match(/<media:statistics views="(\d+)"/) || [])[1] || 0),
      };
    }).filter((e) => e.id);
    return { author, entries };
  }

  function timeAgo(iso, now = Date.now()) {
    const t = Date.parse(iso);
    if (!t) return '';
    const s = Math.max(0, (now - t) / 1000);
    const units = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
    for (const [name, size] of units) {
      const n = Math.floor(s / size);
      if (n >= 1) return n + ' ' + name + (n > 1 ? 's' : '') + ' ago';
    }
    return 'just now';
  }

  function views(n) {
    if (!n) return '';
    if (n >= 1e9) return (n / 1e9).toFixed(n >= 1e10 ? 0 : 1).replace(/\.0$/, '') + 'B views';
    if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M views';
    if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'K views';
    return n + ' views';
  }

  // "12:34" or "1:02:03" to seconds, 0 when it is not a duration.
  function seconds(text) {
    const m = String(text || '').trim().match(/^(\d{1,2}:)?(\d{1,2}):(\d{2})$/);
    if (!m) return 0;
    return (m[1] ? parseInt(m[1], 10) * 3600 : 0) + parseInt(m[2], 10) * 60 + parseInt(m[3], 10);
  }

  root.YouBuild = Object.assign(root.YouBuild || {}, { parseFeed, timeAgo, views, seconds });
})(typeof globalThis !== 'undefined' ? globalThis : this);
