// YouBuild settings, used both as the toolbar popup and as the full settings page.
(async () => {
  'use strict';
  const YB = globalThis.YouBuild;
  const api = globalThis.browser || globalThis.chrome;
  const $ = (id) => document.getElementById(id);
  const CLAUDE = { origins: ['https://api.anthropic.com/*'] };
  if (new URLSearchParams(location.search).get('page')) document.body.classList.add('page');

  let settings = YB.withDefaults((await api.storage.local.get('settings')).settings);
  const { list } = await api.runtime.sendMessage({ type: 'yb:list' }).catch(() => ({ list: { channels: [], blocked: [] } }));

  async function save(patch) {
    settings = YB.withDefaults({ ...settings, ...patch });
    await api.storage.local.set({ settings });
    render();
  }

  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'text') n.textContent = v;
      else if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : String(v));
    }
    for (const kid of kids.flat()) if (kid !== null && kid !== undefined) n.append(kid.nodeType ? kid : String(kid));
    return n;
  }

  function catSelect(value, onChange) {
    return el('select', { 'aria-label': 'Category', onchange: (e) => onChange(e.target.value) },
      YB.CATEGORIES.map((c) => el('option', { value: c.id, text: c.label, selected: c.id === value })));
  }

  // ---------- render ----------
  function render() {
    $('enabled').checked = settings.enabled;
    for (const b of document.querySelectorAll('[data-strict]')) {
      const on = b.dataset.strict === settings.strictness;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    }
    const n = list.channels.length;
    $('strict-help').textContent = settings.strictness === 'allowlist'
      ? `Only the ${n} channels on the builder list and the ones you add.`
      : `The ${n} channels on the builder list and yours, plus other videos the topic check calls building things.`;
    $('cats').replaceChildren(...YB.CATEGORIES.map((c) => el('button', {
      type: 'button', class: settings.categories[c.id] !== false ? 'on' : '', title: c.long, text: c.label,
      onclick: () => save({ categories: { ...settings.categories, [c.id]: settings.categories[c.id] === false } }),
    })));
    $('hideShorts').checked = settings.hideShorts;
    $('hideComments').checked = settings.hideComments;
    $('showChips').checked = settings.showChips;
    $('minMinutes').value = String(settings.minMinutes || 0);

    $('mine').replaceChildren(...settings.userChannels.map((c, i) => el('li', {},
      el('span', { class: 'name', title: c.handle || c.id }, c.name, c.handle ? el('small', { text: c.handle }) : null),
      catSelect((c.categories || [])[0] || 'maker', (v) => {
        const next = settings.userChannels.slice();
        next[i] = { ...c, categories: [v] };
        save({ userChannels: next });
      }),
      el('button', { class: 'x', title: 'Remove', text: '×', onclick: () => save({ userChannels: settings.userChannels.filter((_, j) => j !== i) }) }))));
    $('blocked-label').hidden = !settings.blockedChannels.length;
    $('blocked').replaceChildren(...settings.blockedChannels.map((c, i) => el('li', {},
      el('span', { class: 'name', title: c.handle || c.id }, c.name, c.handle ? el('small', { text: c.handle }) : null),
      el('button', { class: 'x', title: 'Unblock', text: '×', onclick: () => save({ blockedChannels: settings.blockedChannels.filter((_, j) => j !== i) }) }))));

    $('llm').checked = !!settings.llm.enabled;
    $('llm-box').hidden = !settings.llm.enabled;
    $('list-info').textContent = `Builder list ${list.version || ''} · ${n} channels`;
  }

  // ---------- channel lookups ----------
  function parseInput(raw) {
    const s = String(raw || '').trim();
    let m = s.match(/(UC[\w-]{22})/);
    if (m) return { id: m[1] };
    m = s.match(/@([\w.\-]+)/);
    if (m) return { handle: '@' + m[1] };
    m = s.match(/youtube\.com\/(c|user)\/([\w.\-]+)/);
    if (m) return { path: '/' + m[1] + '/' + m[2] };
    if (/^[\w.\-]{3,}$/.test(s)) return { handle: '@' + s };
    return null;
  }

  async function resolve(input) {
    const q = parseInput(input);
    if (!q) throw new Error('That does not look like a channel. Paste a link or an @handle.');
    if (q.id) {
      const r = await fetch('https://www.youtube.com/feeds/videos.xml?channel_id=' + q.id, { credentials: 'include' });
      if (!r.ok) throw new Error('YouTube does not know that channel.');
      const name = ((await r.text()).match(/<author>\s*<name>([^<]*)<\/name>/) || [])[1] || q.id;
      return { id: q.id, name: decodeXml(name) };
    }
    const r = await fetch('https://www.youtube.com/' + (q.handle || q.path).replace(/^\//, ''), { credentials: 'include' });
    if (r.status === 404) throw new Error('YouTube does not know that channel.');
    const t = await r.text();
    const id = (t.match(/<meta itemprop="identifier" content="(UC[\w-]{22})"/) || t.match(/"externalId":"(UC[\w-]{22})"/) || [])[1];
    if (!id) throw new Error('Could not read that channel page. Open it once on YouTube and try again.');
    const name = decodeXml((t.match(/<meta property="og:title" content="([^"]*)"/) || [])[1] || q.handle || id);
    const handle = (t.match(/"vanityChannelUrl":"https?:\/\/www\.youtube\.com\/(@[^"]+)"/) || [])[1] || q.handle || '';
    return { id, name, handle: handle ? decodeURIComponent(handle) : '' };
  }
  const decodeXml = (s) => String(s).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

  function msg(id, text, bad) { $(id).textContent = text || ''; $(id).classList.toggle('bad', !!bad); }

  async function addChannel(input, category, block) {
    msg('add-msg', 'Looking it up...');
    try {
      const ch = await resolve(input);
      const key = (c) => c.id || c.handle;
      if (block) {
        if (settings.blockedChannels.some((c) => key(c) === key(ch))) return msg('add-msg', ch.name + ' is already blocked.');
        await save({
          blockedChannels: [...settings.blockedChannels, { id: ch.id, handle: ch.handle, name: ch.name }],
          userChannels: settings.userChannels.filter((c) => key(c) !== key(ch)),
        });
        return msg('add-msg', 'Blocked ' + ch.name + '.');
      }
      if (settings.userChannels.some((c) => key(c) === key(ch))) return msg('add-msg', ch.name + ' is already on your list.');
      const onList = list.channels.find((c) => c.id === ch.id);
      await save({
        userChannels: [...settings.userChannels, { id: ch.id, handle: ch.handle, name: ch.name, categories: [category] }],
        blockedChannels: settings.blockedChannels.filter((c) => key(c) !== key(ch)),
      });
      $('add-input').value = '';
      msg('add-msg', onList ? `Added ${ch.name}. It was on the builder list already, now it is yours too.` : `Added ${ch.name}. All its videos show up now.`);
    } catch (e) {
      msg('add-msg', e.message || String(e), true);
    }
  }

  // ---------- events ----------
  $('enabled').addEventListener('change', (e) => save({ enabled: e.target.checked }));
  for (const b of document.querySelectorAll('[data-strict]')) b.addEventListener('click', () => save({ strictness: b.dataset.strict }));
  for (const id of ['hideShorts', 'hideComments', 'showChips']) $(id).addEventListener('change', (e) => save({ [id]: e.target.checked }));
  $('minMinutes').addEventListener('change', (e) => save({ minMinutes: Number(e.target.value) }));
  $('add-cat').replaceChildren(...YB.CATEGORIES.map((c) => el('option', { value: c.id, text: c.label, selected: c.id === 'maker' })));
  $('add-btn').addEventListener('click', () => addChannel($('add-input').value, $('add-cat').value));
  $('add-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') addChannel($('add-input').value, $('add-cat').value); });

  // The channel in the current tab, when it is a YouTube channel or watch page.
  let tabChannel = null;
  try {
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    if (tab && /^https:\/\/www\.youtube\.com\//.test(tab.url || '')) {
      const r = await api.tabs.sendMessage(tab.id, { type: 'yb:current-channel' });
      if (r && r.handle) {
        tabChannel = r;
        $('add-tab').disabled = false;
        $('block-tab').disabled = false;
        $('add-tab').textContent = 'Add ' + (r.name || r.handle);
      }
    }
  } catch (e) { /* not on YouTube */ }
  $('add-tab').addEventListener('click', () => tabChannel && addChannel(tabChannel.handle, $('add-cat').value));
  $('block-tab').addEventListener('click', () => tabChannel && addChannel(tabChannel.handle, null, true));

  $('export').addEventListener('click', () => {
    const data = { youbuild: 1, exported: new Date().toISOString(), channels: settings.userChannels, blocked: settings.blockedChannels };
    const a = el('a', { href: URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })), download: 'youbuild-channels.json' });
    document.body.append(a);
    a.click();
    a.remove();
  });
  $('import').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      const clean = (c) => ({ id: /^UC[\w-]{22}$/.test(c.id || '') ? c.id : undefined, handle: YB.normHandle(c.handle) || undefined, name: String(c.name || c.handle || c.id || '').slice(0, 100), categories: (c.categories || []).filter((x) => YB.CATEGORY_IDS.includes(x)).slice(0, 3) });
      const merge = (a, b) => { const seen = new Set(a.map((c) => c.id || c.handle)); return a.concat(b.filter((c) => (c.id || c.handle) && !seen.has(c.id || c.handle))); };
      const ch = (data.channels || []).map(clean).map((c) => ({ ...c, categories: c.categories.length ? c.categories : ['maker'] }));
      const bl = (data.blocked || []).map(clean);
      await save({ userChannels: merge(settings.userChannels, ch), blockedChannels: merge(settings.blockedChannels, bl) });
      msg('add-msg', `Imported ${ch.length} channels and ${bl.length} blocks.`);
    } catch (err) {
      msg('add-msg', 'That file is not a YouBuild export.', true);
    }
    e.target.value = '';
  });

  // ---------- Claude ----------
  async function llmStatus() {
    const { llmStatus: s = {}, llmKeySet } = await api.storage.local.get(['llmStatus', 'llmKeySet']);
    if (!settings.llm.enabled) return;
    if (!llmKeySet) return msg('llm-msg', 'Add your key to turn it on.');
    if (s.error === 'bad-key') return msg('llm-msg', 'Claude did not accept this key.', true);
    if (s.error === 'no-permission') return msg('llm-msg', 'YouBuild is not allowed to reach api.anthropic.com yet. Turn the switch off and on.', true);
    if (s.error === 'rate-limit') return msg('llm-msg', 'Claude asked YouBuild to slow down. It tries again in a minute.', true);
    if (s.error) return msg('llm-msg', 'Claude could not answer: ' + (s.message || s.error), true);
    const cost = ((s.inputTokens || 0) * 0.1 + (s.outputTokens || 0) * 0.5) / 1e6;
    msg('llm-msg', s.videos ? `Claude checked ${s.videos} videos so far, about $${cost.toFixed(cost < 0.01 ? 4 : 2)}.` : 'Ready. Claude only sees videos the local check is unsure about.');
  }
  $('llm').addEventListener('change', async (e) => {
    if (e.target.checked) {
      const ok = await api.permissions.request(CLAUDE).catch(() => false);
      if (!ok) { e.target.checked = false; return msg('llm-msg', 'YouBuild needs your OK to reach api.anthropic.com.', true); }
    }
    await save({ llm: { ...settings.llm, enabled: e.target.checked } });
    llmStatus();
  });
  $('key-save').addEventListener('click', async () => {
    const key = $('key').value.trim();
    if (!key) {
      await api.storage.local.remove('llmKey');
      await api.storage.local.set({ llmKeySet: false });
      return msg('llm-msg', 'Key removed.');
    }
    // request() resolves at once when the permission is already granted.
    const ok = await api.permissions.request(CLAUDE).catch(() => false);
    if (!ok) return msg('llm-msg', 'YouBuild needs your OK to reach api.anthropic.com.', true);
    msg('llm-msg', 'Checking the key with Claude...');
    const r = await api.runtime.sendMessage({ type: 'yb:test-key', key });
    if (!r || !r.ok) return msg('llm-msg', r && r.error === 'bad-key' ? 'Claude did not accept this key.' : 'Claude could not answer: ' + ((r && r.message) || 'unknown error'), true);
    await api.storage.local.set({ llmKey: key, llmKeySet: true });
    $('key').value = '';
    $('key').placeholder = 'Key saved in this browser';
    msg('llm-msg', 'Key works. Unclear videos now get a second look from Claude.');
  });
  const { llmKeySet } = await api.storage.local.get('llmKeySet');
  if (llmKeySet) $('key').placeholder = 'Key saved in this browser';

  render();
  llmStatus();
})();
