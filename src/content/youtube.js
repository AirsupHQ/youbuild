// YouBuild on youtube.com: hides every video that is not about building things, says why each
// remaining video is shown, and replaces the home page with the best new videos from the builder list.
// It only changes what this browser shows. Ads are never touched.
(() => {
  'use strict';
  if (window.top !== window) return;
  const YB = globalThis.YouBuild;
  const api = globalThis.browser || globalThis.chrome;
  const root = document.documentElement;

  const ITEMS = [
    'ytd-rich-item-renderer', 'ytd-video-renderer', 'ytd-compact-video-renderer', 'ytd-grid-video-renderer',
    'ytd-playlist-renderer', 'ytd-radio-renderer', 'ytd-compact-playlist-renderer', 'ytd-compact-radio-renderer',
    'ytd-movie-renderer', 'ytd-channel-renderer', 'yt-lockup-view-model', 'ytm-shorts-lockup-view-model-v2',
    'ytm-shorts-lockup-view-model', 'ytd-reel-item-renderer',
  ].join(',');
  const SHELVES = 'ytd-reel-shelf-renderer, ytd-rich-shelf-renderer, grid-shelf-view-model, ytd-shelf-renderer, ytd-horizontal-card-list-renderer';
  const ADS = 'ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer, ytd-promoted-sparkles-web-renderer, ytd-display-ad-renderer, ytd-promoted-video-renderer, ytd-search-pyv-renderer, ytd-banner-promo-renderer, ad-badge-view-model, feed-ad-metadata-view-model';
  const THUMB = 'ytd-thumbnail, yt-thumbnail-view-model, [class*="ContentImage"], ytd-playlist-thumbnail, .shortsLockupViewModelHostThumbnailContainer, #avatar-section, #avatar';
  // On YouTube's own cards the chip sits in the text column: on the thumbnail, hovering it would
  // start YouTube's inline preview and cover it.
  const META = '#channel-info, [class*="LockupMetadataViewModelTextContainer"], .yt-lockup-metadata-view-model__text-container, [class*="shortsLockupViewModelHostOutsideMetadata"], ytd-channel-renderer #info, #metadata';
  const HOME_PAGE = 48;
  const FEED_TTL = 3 * 3600 * 1000;
  const SUGGESTIONS = ['CNC machining', 'how it\'s made', 'rocket engine', 'PCB design', 'factory tour', 'teardown', 'welding', 'robot arm'];

  const state = {
    settings: YB.withDefaults(),
    list: { channels: [], blocked: [] },
    index: YB.buildIndex(null, null),
    loaded: false,
    gen: 1,
    peek: false,
    llm: new Map(),
    llmAsked: new Set(),
    llmKeySet: false,
    home: { cat: 'all', sort: 'top', limit: HOME_PAGE, feeds: null, loading: false },
  };

  // ---------- DOM helper. No innerHTML anywhere: YouTube enforces Trusted Types. ----------
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
    for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) el.append(kid.nodeType ? kid : String(kid));
    return el;
  }
  const text = (el) => (el && el.textContent ? el.textContent.replace(/\s+/g, ' ').trim() : '');

  // ---------- settings ----------
  async function load() {
    const got = await api.storage.local.get(['settings', 'llmKeySet']);
    state.settings = YB.withDefaults(got.settings);
    state.llmKeySet = !!got.llmKeySet;
    // The list ships inside the extension. Reading it here does not wait for the service worker,
    // which can take seconds to wake up on a busy machine.
    try {
      const r = await fetch(api.runtime.getURL('data/channels.json'));
      if (r.ok) state.list = await r.json();
    } catch (e) {
      try {
        const r = await api.runtime.sendMessage({ type: 'yb:list' });
        if (r && r.list) state.list = r.list;
      } catch (e2) { /* the next navigation retries */ }
    }
    state.index = YB.buildIndex(state.list, state.settings);
    state.loaded = true;
    state.gen++;
    applyClasses();
    schedule(0);
  }

  api.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.settings || changes.llmKeySet) {
      if (changes.settings) state.settings = YB.withDefaults(changes.settings.newValue);
      if (changes.llmKeySet) state.llmKeySet = !!changes.llmKeySet.newValue;
      state.index = YB.buildIndex(state.list, state.settings);
      state.gen++;
      applyClasses();
      if (location.pathname === '/') renderHome(true);
      schedule(0);
    }
  });

  function applyClasses() {
    const s = state.settings;
    const on = state.loaded && s.enabled;
    root.classList.toggle('yb-on', on);
    root.classList.toggle('yb-no-shorts', on && s.hideShorts);
    root.classList.toggle('yb-no-comments', on && s.hideComments);
    root.classList.toggle('yb-chips', on && s.showChips);
    root.classList.toggle('yb-peek', on && state.peek);
    // yb-home hides YouTube's feed, so only renderHome sets it, once the YouBuild home is in place.
    if (!on || location.pathname !== '/') root.classList.remove('yb-home');
    if (!on) {
      const empty = document.getElementById('yb-empty');
      if (empty) empty.remove();
      root.classList.remove('yb-stop-more');
    }
    updatePill();
  }

  async function saveSettings(patch) {
    state.settings = YB.withDefaults({ ...state.settings, ...patch });
    await api.storage.local.set({ settings: state.settings });
  }

  function ctx() {
    return {
      settings: state.settings,
      index: state.index,
      llm: (id) => state.llm.get(id),
      llmReady: (id) => state.llmKeySet && !state.llmAsked.has(id),
    };
  }

  function pageType() {
    const p = location.pathname;
    if (p === '/') return 'home';
    if (p === '/results') return 'search';
    if (p === '/watch') return 'watch';
    if (p.startsWith('/shorts/')) return 'shorts';
    if (/^\/(@|channel\/|c\/|user\/)/.test(p)) return 'channel';
    if (p === '/playlist' || /^\/feed\/(history|library|playlists|you)/.test(p)) return 'own';
    return 'feed';
  }

  // ---------- reading a video card ----------
  function readItem(el) {
    const link = el.querySelector('a[href*="/watch?v="], a[href*="/shorts/"]') || (el.matches('a') ? el : null);
    const href = link ? link.getAttribute('href') || '' : '';
    const v = { id: '', title: '', channelName: '', channelHandle: '', channelId: '', description: '', seconds: 0, isShort: false, isLive: false };
    let m = href.match(/[?&]v=([\w-]{11})/);
    if (m) v.id = m[1];
    m = href.match(/\/shorts\/([\w-]{11})/);
    if (m) { v.id = m[1]; v.isShort = true; }
    if (el.matches('ytm-shorts-lockup-view-model, ytm-shorts-lockup-view-model-v2, ytd-reel-item-renderer')) v.isShort = true;

    const chLink = el.querySelector('a[href^="/@"], a[href^="/channel/UC"], a[href^="/c/"], a[href^="/user/"]');
    if (chLink) {
      const ch = chLink.getAttribute('href');
      if (ch.startsWith('/@')) v.channelHandle = decodeURIComponent(ch.slice(1).split(/[/?]/)[0]);
      const cm = ch.match(/^\/channel\/(UC[\w-]{22})/);
      if (cm) v.channelId = cm[1];
    }

    if (el.matches('ytd-channel-renderer')) {
      v.channelName = text(el.querySelector('#channel-title #text, #channel-title, #text'));
      v.title = v.channelName;
      v.description = text(el.querySelector('#description'));
      v.isChannel = true;
      return v;
    }

    const titleEl = el.querySelector('#video-title, h3[title], [class*="LockupMetadataViewModelTitle"], .yt-lockup-metadata-view-model__title, [class*="shortsLockupViewModelHostMetadataTitle"], [class*="shortsLockupViewModelHostOutsideMetadataTitle"], #title');
    v.title = (titleEl && (titleEl.getAttribute('title') || text(titleEl))) || (link && (link.getAttribute('title') || '')) || '';

    v.channelName = text(el.querySelector('ytd-channel-name #text, #channel-name #text, #byline-container #text'));
    if (!v.channelName && chLink) v.channelName = text(chLink);
    if (!v.channelName) {
      const row = el.querySelector('[class*="ContentMetadataViewModelMetadataRow"], .yt-content-metadata-view-model__metadata-row');
      if (row) v.channelName = text(row.querySelector('a, span') || row);
    }
    if (!v.channelName) {
      const av = el.querySelector('[aria-label^="Go to channel "]');
      if (av) v.channelName = av.getAttribute('aria-label').replace(/^Go to channel /, '');
    }

    v.description = text(el.querySelector('.metadata-snippet-text, #description-text, .metadata-snippet-container'));

    for (const b of el.querySelectorAll('ytd-thumbnail-overlay-time-status-renderer, badge-shape, [class*="BadgeShapeText"], .yt-badge-shape__text')) {
      const t = text(b);
      const s = YB.seconds(t);
      if (s) { v.seconds = s; break; }
      if (/^live$/i.test(t)) v.isLive = true;
    }
    return v;
  }

  // ---------- the "why is this shown" chip ----------
  function chip(d) {
    const shown = d.show;
    const c = h('span', { class: 'yb-why' + (shown ? '' : ' is-hidden'), 'data-src': shown ? d.source : 'hidden', onclick: (e) => { e.preventDefault(); e.stopPropagation(); } },
      h('i'), shown ? YB.label(d.category) : 'Hidden');
    c.ybTip = { title: shown ? 'Why is this shown' : 'Why is this hidden', lines: shown ? d.why || [] : [d.hiddenBecause || 'Not about building things'] };
    return c;
  }

  function mark(el, d) {
    el.dataset.yb = d.show ? 'show' : 'hide';
    const old = el.querySelector(':scope .yb-why');
    if (old) old.remove();
    const c = chip(d);
    const meta = el.querySelector(META);
    if (meta) { c.classList.add('is-inline'); meta.append(c); return; }
    const host = el.querySelector(THUMB) || el;
    host.classList.add('yb-host');
    host.append(c);
  }

  // One tooltip for every chip, fixed to the window, so no card can clip it.
  function showTip(c) {
    let t = document.getElementById('yb-tipbox');
    if (!t) { t = h('div', { id: 'yb-tipbox', role: 'tooltip' }); document.body.append(t); }
    const tip = c.ybTip || { title: '', lines: [] };
    t.replaceChildren(h('b', { text: tip.title }), ...tip.lines.map((l) => h('span', { text: l })));
    t.style.visibility = 'hidden';
    t.style.display = 'block';
    const r = c.getBoundingClientRect();
    const w = t.offsetWidth;
    const th = t.offsetHeight;
    const left = Math.max(8, Math.min(r.left, innerWidth - w - 8));
    const top = r.bottom + 8 + th < innerHeight ? r.bottom + 8 : r.top - th - 8;
    t.style.left = Math.round(left) + 'px';
    t.style.top = Math.round(top) + 'px';
    t.style.visibility = 'visible';
  }
  function hideTip() { const t = document.getElementById('yb-tipbox'); if (t) t.style.display = 'none'; }
  document.addEventListener('mouseover', (e) => { const c = e.target.closest && e.target.closest('.yb-why'); if (c) showTip(c); }, true);
  document.addEventListener('mouseout', (e) => {
    const c = e.target.closest && e.target.closest('.yb-why');
    if (c && !(e.relatedTarget && c.contains(e.relatedTarget))) hideTip();
  }, true);
  window.addEventListener('scroll', hideTip, { passive: true });

  // ---------- scanning ----------
  let scheduled = 0;
  let lastScan = 0;
  function schedule(delay = 80) {
    if (scheduled) return;
    const wait = Math.max(delay, 120 - (Date.now() - lastScan));
    scheduled = setTimeout(() => { scheduled = 0; lastScan = Date.now(); try { scan(); } catch (e) { console.warn('[YouBuild]', e); } }, Math.max(0, wait));
  }

  function activePage() {
    return document.querySelector('ytd-page-manager > :not([hidden])') || document;
  }

  function scan() {
    if (!state.loaded) return;
    ensurePill();
    if (!state.settings.enabled) return;
    const type = pageType();
    if (type === 'shorts' && state.settings.hideShorts) {
      const id = location.pathname.split('/')[2];
      if (id) { location.replace('/watch?v=' + id); return; }
    }
    if (type === 'home') renderHome(false);
    cleanGuide();
    if (type === 'channel' || type === 'own') { updatePill(); return; }

    const c = ctx();
    for (const el of document.querySelectorAll(ITEMS)) {
      if (el.parentElement && el.parentElement.closest(ITEMS)) continue;
      if (el.closest('#youbuild-home, ytd-playlist-panel-renderer')) continue;
      if (el.matches(ADS) || el.querySelector(ADS)) { el.dataset.yb = 'ad'; continue; }
      const v = readItem(el);
      if (!v.id && !v.isChannel && !v.title) continue;
      const key = [state.gen, state.peek ? 1 : 0, v.id, v.title, v.channelName].join('|');
      // Same video and the chip still there (YouTube sometimes re-renders a card's text).
      if (el.dataset.ybKey === key && el.querySelector('.yb-why')) continue;
      const d = YB.decide(v, c);
      mark(el, d);
      el.dataset.ybKey = key;
      if (d.pending) askClaude(v);
      if (v.isShort && !d.show) hideCell(el);
    }
    shelves();
    shortsChips();
    searchState(type);
    if (type === 'watch') watchGuards();
    updatePill();
  }

  // A Short sits in its own grid cell; hide the cell so the shelf does not keep a hole.
  function hideCell(el) {
    const cell = el.parentElement;
    if (cell && cell.children.length === 1 && cell.tagName === 'DIV' && !cell.id) cell.dataset.yb = 'hide';
  }

  function shelves() {
    for (const sh of document.querySelectorAll(SHELVES)) {
      if (sh.closest('#youbuild-home')) continue;
      const shorts = sh.matches('ytd-reel-shelf-renderer, [is-shorts]') || !!sh.querySelector('ytm-shorts-lockup-view-model, ytm-shorts-lockup-view-model-v2, ytd-reel-item-renderer');
      if (shorts && state.settings.hideShorts) { sh.dataset.yb = 'hide'; continue; }
      const items = [...sh.querySelectorAll('[data-yb="show"], [data-yb="hide"]')].filter((x) => x.matches(ITEMS));
      if (!items.length) continue;
      sh.dataset.yb = items.some((x) => x.dataset.yb === 'show') ? 'show' : 'hide';
    }
  }

  function shortsChips() {
    if (!state.settings.hideShorts) return;
    for (const c of document.querySelectorAll('yt-chip-cloud-chip-renderer, chip-view-model, yt-chip-view-model')) {
      if (text(c) === 'Shorts') c.dataset.yb = 'hide';
    }
  }

  // The Explore block of the left menu (Music, Movies & TV, Gaming, Sports...) is not about building.
  function cleanGuide() {
    for (const sec of document.querySelectorAll('ytd-guide-section-renderer')) {
      if (sec.dataset.ybGuide) continue;
      const hrefs = [...sec.querySelectorAll('a[href]')].map((a) => a.getAttribute('href'));
      if (!hrefs.length) continue;
      sec.dataset.ybGuide = '1';
      if (hrefs.some((x) => /^\/(feed\/(storefront|trending|explore)|gaming|podcasts|channel\/UC-9-kyTW8ZkZNDHQJ6FgpwQ)/.test(x))) sec.dataset.yb = 'hide';
    }
  }

  // ---------- search: say so when nothing is left ----------
  function searchState(type) {
    const old = document.getElementById('yb-empty');
    if (type !== 'search') { if (old) old.remove(); root.classList.remove('yb-stop-more'); return; }
    const page = document.querySelector('ytd-search') || document;
    const items = [...page.querySelectorAll('[data-yb="show"], [data-yb="hide"]')].filter((x) => x.matches(ITEMS) && !x.closest('ytd-guide-renderer'));
    const shown = items.filter((x) => x.dataset.yb === 'show').length;
    const hidden = items.length - shown;
    const q = new URLSearchParams(location.search).get('search_query') || '';
    if (shown === 0 && hidden >= 6) {
      root.classList.add('yb-stop-more');
      if (old && old.dataset.q === q && old.dataset.n === String(hidden)) return;
      const box = h('div', { id: 'yb-empty', 'data-q': q, 'data-n': String(hidden) },
        h('h2', { text: 'Nothing here is about building things.' }),
        h('p', { text: `YouBuild hid ${hidden} results for "${q}". Try one of these instead.` }),
        h('div', { class: 'yb-suggest' }, SUGGESTIONS.map((s) => h('a', { href: '/results?search_query=' + encodeURIComponent(s), text: s }))),
        h('button', { class: 'yb-peek-btn', text: 'Show what was hidden', onclick: () => setPeek(true) }));
      const list = page.querySelector('ytd-section-list-renderer');
      if (old) old.replaceWith(box);
      else if (list) list.before(box);
    } else {
      root.classList.remove('yb-stop-more');
      if (old) old.remove();
    }
  }

  // ---------- watch page: autoplay and the end screen ----------
  function watchGuards() {
    const video = document.querySelector('#movie_player video');
    if (!video || video.dataset.ybGuard) return;
    video.dataset.ybGuard = '1';
    video.addEventListener('ended', () => endScreen(0));
  }

  function endScreen(n) {
    if (!state.settings.enabled || pageType() !== 'watch') return;
    const c = ctx();
    const overlay = document.querySelector('.ytp-autonav-endscreen-countdown-overlay');
    const title = text(document.querySelector('.ytp-autonav-endscreen-upnext-title'));
    const author = text(document.querySelector('.ytp-autonav-endscreen-upnext-author'));
    if (overlay && title && getComputedStyle(overlay).display !== 'none') {
      const d = YB.decide({ id: '', title, channelName: author.split('•')[0].trim() }, c);
      const cancel = document.querySelector('.ytp-autonav-endscreen-upnext-cancel-button');
      if (!d.show && cancel && !overlay.dataset.ybStopped) {
        overlay.dataset.ybStopped = '1';
        cancel.click();
        toast('YouBuild stopped autoplay: "' + title + '" is not about building things.');
      }
    }
    for (const a of document.querySelectorAll('.ytp-videowall-still')) {
      const t = text(a.querySelector('.ytp-videowall-still-info-title'));
      const by = text(a.querySelector('.ytp-videowall-still-info-author')).split('•')[0].trim();
      if (t) a.dataset.yb = YB.decide({ id: '', title: t, channelName: by }, c).show ? 'show' : 'hide';
    }
    if (n < 15) setTimeout(() => endScreen(n + 1), 400);
  }

  function toast(msg) {
    const old = document.getElementById('yb-toast');
    if (old) old.remove();
    const t = h('div', { id: 'yb-toast', text: msg });
    document.body.append(t);
    setTimeout(() => t.remove(), 6000);
  }

  // ---------- Claude (only when the user turned it on) ----------
  const claudeQueue = new Map();
  let claudeTimer = 0;
  function askClaude(v) {
    if (state.llmAsked.has(v.id) || claudeQueue.has(v.id)) return;
    claudeQueue.set(v.id, { id: v.id, title: v.title, channelName: v.channelName, description: v.description });
    clearTimeout(claudeTimer);
    claudeTimer = setTimeout(flushClaude, 600);
  }
  async function flushClaude() {
    const items = [...claudeQueue.values()].slice(0, 50);
    for (const it of items) { claudeQueue.delete(it.id); state.llmAsked.add(it.id); }
    if (!items.length) return;
    try {
      const r = await api.runtime.sendMessage({ type: 'yb:classify', items });
      for (const [id, verdict] of Object.entries((r && r.results) || {})) state.llm.set(id, verdict);
    } catch (e) { /* no answer: those videos stay hidden as "not sure" */ }
    state.gen++;
    schedule(0);
    if (claudeQueue.size) claudeTimer = setTimeout(flushClaude, 600);
  }

  // ---------- the YouBuild pill in the top bar ----------
  function ensurePill() {
    if (document.getElementById('yb-pill')) return;
    const start = document.querySelector('ytd-masthead #start');
    if (!start) return;
    const count = h('span', { class: 'yb-count' });
    const pill = h('button', { id: 'yb-pill', type: 'button', title: 'YouBuild', onclick: (e) => { e.stopPropagation(); togglePanel(); } },
      h('span', { class: 'yb-dot' }), h('span', { class: 'yb-word', text: 'YouBuild' }), count);
    start.append(pill);
    document.addEventListener('click', (e) => {
      const panel = document.getElementById('yb-panel');
      if (panel && !panel.contains(e.target)) panel.remove();
    });
    updatePill();
  }

  function hiddenOnPage() {
    const page = activePage();
    return [...page.querySelectorAll('[data-yb="hide"]')].filter((x) => x.matches(ITEMS)).length;
  }

  function updatePill() {
    const pill = document.getElementById('yb-pill');
    if (!pill) return;
    const on = state.settings.enabled;
    pill.classList.toggle('is-off', !on);
    const n = on ? hiddenOnPage() : 0;
    const c = pill.querySelector('.yb-count');
    const label = n ? String(n) : '';
    if (c.textContent !== label) { c.textContent = label; c.title = n ? n + ' hidden on this page' : ''; }
    const panel = document.getElementById('yb-panel');
    const sig = [on, state.peek, n].join('|');
    if (panel && panel.dataset.sig !== sig) fillPanel(panel);
  }

  function togglePanel() {
    const old = document.getElementById('yb-panel');
    if (old) { old.remove(); return; }
    const panel = h('div', { id: 'yb-panel', onclick: (e) => e.stopPropagation() });
    fillPanel(panel);
    document.body.append(panel);
  }

  function row(label, on, onChange) {
    return h('label', { class: 'yb-row' }, h('span', { text: label }),
      h('input', { type: 'checkbox', class: 'yb-switch', checked: on, onchange: (e) => onChange(e.target.checked) }));
  }

  function fillPanel(panel) {
    const pill = document.getElementById('yb-pill');
    if (pill) {
      const r = pill.getBoundingClientRect();
      panel.style.left = Math.round(r.left) + 'px';
      panel.style.top = Math.round(r.bottom + 8) + 'px';
    }
    const n = state.settings.enabled ? hiddenOnPage() : 0;
    panel.dataset.sig = [state.settings.enabled, state.peek, n].join('|');
    panel.replaceChildren(
      row('YouBuild', state.settings.enabled, (v) => saveSettings({ enabled: v })),
      row('Show what was hidden', state.peek, (v) => setPeek(v)),
      h('div', { class: 'yb-note', text: state.settings.enabled ? (n === 1 ? '1 video hidden on this page' : n + ' videos hidden on this page') : 'Paused. YouTube looks like YouTube.' }),
      h('button', { class: 'yb-settings', type: 'button', text: 'Settings', onclick: () => api.runtime.sendMessage({ type: 'yb:open-settings' }) }));
  }

  function setPeek(on) {
    state.peek = on;
    state.gen++;
    applyClasses();
    schedule(0);
  }

  // ---------- the YouBuild home ----------
  function staleChannels(channels) {
    const feeds = state.home.feeds || {};
    const now = Date.now();
    return channels.filter((c) => c.id && (!feeds[c.id] || now - feeds[c.id].t > FEED_TTL));
  }

  async function loadFeeds(channels) {
    if (state.home.loading) return;
    state.home.loading = true;
    if (!state.home.feeds) {
      const store = await api.storage.local.get('feeds');
      state.home.feeds = store.feeds || {};
      renderHome(true);
    }
    const feeds = state.home.feeds;
    const stale = staleChannels(channels);
    let next = 0;
    let since = 0;
    const one = async () => {
      while (next < stale.length) {
        const c = stale[next++];
        try {
          let r = await fetch(location.origin + '/feeds/videos.xml?playlist_id=UULF' + c.id.slice(2), { credentials: 'omit' });
          let f = r.ok ? YB.parseFeed(await r.text()) : { entries: [] };
          if (!f.entries.length) {
            r = await fetch(location.origin + '/feeds/videos.xml?channel_id=' + c.id, { credentials: 'omit' });
            f = r.ok ? YB.parseFeed(await r.text()) : { entries: [] };
          }
          feeds[c.id] = {
            t: Date.now(),
            items: f.entries.filter((e) => !e.link.includes('/shorts/')).slice(0, 15).map((e) => ({
              id: e.id, title: e.title, published: e.published, views: e.views,
              description: c.mode === 'topic' ? e.description.slice(0, 300) : '',
            })),
          };
        } catch (e) {
          // Try again in ten minutes, keep what we had.
          feeds[c.id] = { t: Date.now() - FEED_TTL + 600000, items: (feeds[c.id] && feeds[c.id].items) || [] };
        }
        if (++since >= 12) { since = 0; renderHome(true); }
      }
    };
    await Promise.all(Array.from({ length: 6 }, one));
    state.home.loading = false;
    if (stale.length) {
      await api.storage.local.set({ feeds });
      renderHome(true);
    }
  }

  function homeItems() {
    const feeds = state.home.feeds || {};
    const channels = [...state.list.channels, ...state.settings.userChannels.filter((c) => c.id)];
    const c = ctx();
    const out = [];
    for (const ch of channels) {
      const f = feeds[ch.id];
      if (!f) continue;
      for (const it of f.items) {
        const v = { id: it.id, title: it.title, channelName: ch.name, channelId: ch.id, channelHandle: ch.handle, description: it.description, seconds: 0 };
        const d = YB.decide(v, c);
        if (!d.show) continue;
        out.push({ ...it, channel: ch, d });
      }
    }
    // Top: views, losing a factor of ten every four days, so a strong new video beats an old hit
    // and a stream with four views does not lead the page. New: newest first.
    const now = Date.now();
    const rank = (it) => Math.log10((it.views || 0) + 100) - (now - Date.parse(it.published)) / 864e5 / 4;
    if (state.home.sort === 'new') out.sort((a, b) => (b.published > a.published ? 1 : -1));
    else { for (const it of out) it.rank = rank(it); out.sort((a, b) => b.rank - a.rank); }
    // At most two videos per channel up front, so the first rows are not one channel's week.
    const first = [];
    const rest = [];
    const per = new Map();
    for (const it of out) {
      const n = per.get(it.channel.id) || 0;
      (n < 2 ? first : rest).push(it);
      per.set(it.channel.id, n + 1);
    }
    return first.concat(rest);
  }

  // Cards are kept by video, so a refresh moves them instead of reloading every thumbnail.
  const cards = new Map();
  const noHq720 = new Set();
  const SHARP = window.devicePixelRatio > 1.25;
  function card(it, n) {
    const key = [it.id, it.d.category, it.d.source].join('|');
    const kept = cards.get(it.id);
    if (kept && kept.key === key) return kept.el;
    // hqdefault (480 px) is plenty on a normal screen. Retina screens get hq720 (1280 px); when a
    // video has none, YouTube answers with a 120 px gray placeholder instead of an error, so check
    // the size and fall back to hqdefault.
    const big = SHARP && !noHq720.has(it.id);
    const thumb = h('img', { src: `https://i.ytimg.com/vi/${it.id}/${big ? 'hq720' : 'hqdefault'}.jpg`, alt: '', decoding: 'async', loading: n >= 12 ? 'lazy' : null });
    const fallback = () => { if (!thumb.dataset.fallback) { thumb.dataset.fallback = '1'; noHq720.add(it.id); thumb.src = `https://i.ytimg.com/vi/${it.id}/hqdefault.jpg`; } };
    thumb.addEventListener('error', fallback);
    thumb.addEventListener('load', () => { if (thumb.naturalWidth <= 120) fallback(); });
    const el = h('a', { class: 'ybh-card', href: '/watch?v=' + it.id },
      h('div', { class: 'ybh-thumb yb-host' }, thumb, chip(it.d)),
      h('div', { class: 'ybh-meta' },
        h('div', { class: 'ybh-title', title: it.title, text: it.title }),
        h('div', { class: 'ybh-chan', text: it.channel.name }),
        h('div', { class: 'ybh-stats', text: [YB.views(it.views), YB.timeAgo(it.published)].filter(Boolean).join(' · ') })));
    cards.set(it.id, { key, el });
    return el;
  }

  function renderHome(force) {
    const browse = document.querySelector('ytd-browse[page-subtype="home"]');
    const primary = browse && (browse.querySelector('ytd-two-column-browse-results-renderer #primary') || browse.querySelector('#primary'));
    let home = document.getElementById('youbuild-home');
    const on = state.loaded && state.settings.enabled && pageType() === 'home';
    if (!on || !primary) {
      // Without a place for the YouBuild home, leave YouTube's own home alone.
      root.classList.remove('yb-home');
      if (home && !state.settings.enabled) home.remove();
      return;
    }
    root.classList.add('yb-home');
    if (home && home.parentElement !== primary) { home.remove(); home = null; }
    if (home && !force) return;
    const channels = [...state.list.channels, ...state.settings.userChannels.filter((c) => c.id)];
    if (!state.home.loading && (!state.home.feeds || staleChannels(channels).length)) loadFeeds(channels);
    const cats = YB.CATEGORIES.filter((c) => state.settings.categories[c.id] !== false);
    if (state.home.cat !== 'all' && !cats.some((c) => c.id === state.home.cat)) state.home.cat = 'all';
    const all = homeItems();
    const items = state.home.cat === 'all' ? all : all.filter((it) => it.d.category === state.home.cat);
    const fresh = h('div', { id: 'youbuild-home' },
      h('div', { class: 'ybh-head' },
        h('h1', { text: 'Only people who build things.' }),
        h('p', { text: `The best new videos from ${channels.length} builder channels. Nothing else.` })),
      h('div', { class: 'ybh-bar' },
        h('div', { class: 'ybh-chips' },
          [{ id: 'all', label: 'All' }, ...cats].map((c) => h('button', {
            type: 'button', class: 'ybh-chip' + (state.home.cat === c.id ? ' is-on' : ''), 'data-cat': c.id, text: c.label,
            onclick: () => { state.home.cat = c.id; state.home.limit = HOME_PAGE; renderHome(true); },
          }))),
        h('div', { class: 'ybh-sort' }, [['top', 'Top'], ['new', 'Newest']].map(([id, label]) => h('button', {
          type: 'button', class: state.home.sort === id ? 'is-on' : '', 'data-sort': id, text: label,
          onclick: () => { state.home.sort = id; state.home.limit = HOME_PAGE; renderHome(true); },
        })))),
      items.length
        ? h('div', { class: 'ybh-grid' }, items.slice(0, state.home.limit).map((it, n) => card(it, n)))
        : h('div', { class: 'ybh-grid is-loading' }, Array.from({ length: 12 }, () => h('div', { class: 'ybh-skel' }, h('div'), h('span'), h('span')))),
      items.length > state.home.limit
        ? h('div', { class: 'ybh-more' }, h('button', { type: 'button', text: 'Show more', onclick: () => { state.home.limit += HOME_PAGE; renderHome(true); } }))
        : null);
    if (home) home.replaceWith(fresh);
    else primary.append(fresh);
  }

  // ---------- the popup asks which channel this tab is on ----------
  api.runtime.onMessage.addListener((msg, sender, reply) => {
    if (!msg || msg.type !== 'yb:current-channel') return false;
    const owner = document.querySelector('ytd-watch-metadata #owner, #owner');
    const a = (pageType() === 'watch' && owner && owner.querySelector('a[href^="/@"], a[href^="/channel/"]')) || null;
    let handle = '';
    let name = '';
    if (a) {
      handle = a.getAttribute('href').slice(1).split(/[/?]/)[0];
      name = text(owner.querySelector('ytd-channel-name #text, #channel-name #text, #channel-name'));
    } else if (pageType() === 'channel') {
      handle = decodeURIComponent(location.pathname.slice(1).split('/')[0]);
      if (handle.startsWith('channel')) handle = location.pathname.split('/')[2] || '';
      name = text(document.querySelector('yt-page-header-view-model h1, #channel-name #text, ytd-channel-name #text'));
    }
    reply({ handle, name, page: pageType() });
    return false;
  });

  // ---------- start ----------
  // Changes inside the player (the clock ticks) and in our own elements do not need a scan.
  const QUIET = '#movie_player, #yb-pill, #yb-panel, #yb-toast, #yb-tipbox, #youbuild-home, .yb-why';
  new MutationObserver((records) => {
    for (const r of records) {
      const t = r.target;
      if (!t.closest || !t.closest(QUIET)) { schedule(); return; }
    }
  }).observe(root, { childList: true, subtree: true });
  window.addEventListener('yt-navigate-finish', () => {
    state.home.limit = HOME_PAGE;
    applyClasses();
    if (location.pathname === '/') renderHome(true);
    schedule(0);
  });
  setInterval(() => { if (!document.hidden) schedule(); }, 1500);
  load();
})();
