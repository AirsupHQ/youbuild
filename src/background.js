// YouBuild service worker: hands the built-in channel list to the pages and, only when the user
// turned it on and gave a key, asks Claude about videos the local classifier is unsure about.
import { classifyBatch, Anthropic, BATCH, MODEL } from './background/claude.js';

const api = globalThis.browser || globalThis.chrome;
const CLAUDE_ORIGIN = 'https://api.anthropic.com/*';
const CACHE_MAX = 4000;

let listPromise = null;
function builtInList() {
  if (!listPromise) listPromise = fetch(api.runtime.getURL('data/channels.json')).then((r) => r.json());
  return listPromise;
}

let queue = Promise.resolve();
let pausedUntil = 0;

async function status(patch) {
  const { llmStatus = {} } = await api.storage.local.get('llmStatus');
  const next = { ...llmStatus, ...patch, at: Date.now() };
  await api.storage.local.set({ llmStatus: next });
  return next;
}

async function classify(items) {
  const { settings = {}, llmKey = '', llmCache = {} } = await api.storage.local.get(['settings', 'llmKey', 'llmCache']);
  const out = {};
  const todo = [];
  for (const it of items) {
    if (!it || !it.id) continue;
    const hit = llmCache[it.id];
    if (hit) out[it.id] = { building: hit.b, category: hit.c, reason: hit.r };
    else if (!todo.some((t) => t.id === it.id)) todo.push(it);
  }
  if (!todo.length) return { results: out };
  if (!settings.llm || !settings.llm.enabled || !llmKey) return { results: out, skipped: 'off' };
  if (!(await api.permissions.contains({ origins: [CLAUDE_ORIGIN] }))) {
    await status({ ok: false, error: 'no-permission' });
    return { results: out, skipped: 'no-permission' };
  }
  if (Date.now() < pausedUntil) return { results: out, skipped: 'paused' };

  const fresh = {};
  for (let i = 0; i < todo.length; i += BATCH) {
    const chunk = todo.slice(i, i + BATCH);
    try {
      const { results, usage } = await classifyBatch(chunk, { apiKey: llmKey, model: settings.llm.model || MODEL });
      Object.assign(fresh, results);
      const { llmStatus = {} } = await api.storage.local.get('llmStatus');
      await status({
        ok: true,
        error: null,
        videos: (llmStatus.videos || 0) + Object.keys(results).length,
        inputTokens: (llmStatus.inputTokens || 0) + ((usage && usage.input_tokens) || 0),
        outputTokens: (llmStatus.outputTokens || 0) + ((usage && usage.output_tokens) || 0),
      });
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
        await status({ ok: false, error: 'bad-key' });
      } else if (e instanceof Anthropic.RateLimitError) {
        pausedUntil = Date.now() + 60000;
        await status({ ok: false, error: 'rate-limit' });
      } else if (e instanceof Anthropic.APIError) {
        pausedUntil = Date.now() + 15000;
        await status({ ok: false, error: 'api', message: String(e.message || '').slice(0, 160) });
      } else {
        pausedUntil = Date.now() + 15000;
        await status({ ok: false, error: 'network', message: String(e && e.message || e).slice(0, 160) });
      }
      break;
    }
  }
  if (Object.keys(fresh).length) {
    const now = Date.now();
    const { llmCache: latest = {} } = await api.storage.local.get('llmCache');
    for (const [id, r] of Object.entries(fresh)) {
      latest[id] = { b: r.building, c: r.category, r: r.reason, t: now };
      out[id] = r;
    }
    const ids = Object.keys(latest);
    if (ids.length > CACHE_MAX) {
      ids.sort((a, b) => latest[a].t - latest[b].t);
      for (const id of ids.slice(0, ids.length - CACHE_MAX)) delete latest[id];
    }
    await api.storage.local.set({ llmCache: latest });
  }
  return { results: out };
}

async function testKey(apiKey) {
  try {
    const { results } = await classifyBatch([
      { id: 't1', title: 'Machining a turbine blade on a 5 axis mill', channelName: 'Test' },
      { id: 't2', title: 'My morning skincare routine', channelName: 'Test' },
    ], { apiKey });
    const ok = results.t1 && results.t1.building === true && results.t2 && results.t2.building === false;
    await status({ ok: true, error: null });
    return { ok: true, sane: !!ok };
  } catch (e) {
    const error = e instanceof Anthropic.AuthenticationError ? 'bad-key' : e instanceof Anthropic.RateLimitError ? 'rate-limit' : 'api';
    await status({ ok: false, error, message: String(e && e.message || e).slice(0, 160) });
    return { ok: false, error, message: String(e && e.message || e).slice(0, 160) };
  }
}

api.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || typeof msg.type !== 'string') return false;
  if (msg.type === 'yb:list') {
    builtInList().then((list) => reply({ list })).catch((e) => reply({ error: String(e) }));
    return true;
  }
  if (msg.type === 'yb:classify') {
    queue = queue.then(() => classify(Array.isArray(msg.items) ? msg.items.slice(0, 100) : []))
      .then((r) => reply(r), (e) => reply({ results: {}, error: String(e) }));
    return true;
  }
  if (msg.type === 'yb:test-key') {
    testKey(String(msg.key || '')).then(reply);
    return true;
  }
  if (msg.type === 'yb:open-settings') {
    api.runtime.openOptionsPage();
    return false;
  }
  return false;
});
