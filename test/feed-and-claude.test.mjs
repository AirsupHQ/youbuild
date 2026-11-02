import test from 'node:test';
import assert from 'node:assert/strict';
import '../src/lib/feed.js';
import { classifyBatch, MODEL, SCHEMA } from '../src/background/claude.js';

const YB = globalThis.YouBuild;

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
 <title>Applied Science</title>
 <author><name>Applied Science</name><uri>https://www.youtube.com/channel/UCivA7_KLKWo43tFcCkFvydw</uri></author>
 <entry>
  <yt:videoId>abcdefghijk</yt:videoId>
  <title>Making a vacuum tube &amp; testing it</title>
  <link rel="alternate" href="https://www.youtube.com/watch?v=abcdefghijk"/>
  <published>2026-10-28T15:00:00+00:00</published>
  <media:group><media:description>Glass, &quot;getters&quot; and a pump.</media:description>
  <media:community><media:statistics views="123456"/></media:community></media:group>
 </entry>
 <entry>
  <yt:videoId>shortshort1</yt:videoId>
  <title>A short</title>
  <link rel="alternate" href="https://www.youtube.com/shorts/shortshort1"/>
  <published>2026-10-27T15:00:00+00:00</published>
  <media:group><media:community><media:statistics views="9"/></media:community></media:group>
 </entry>
</feed>`;

test('reads the uploads feed', () => {
  const f = YB.parseFeed(FEED);
  assert.equal(f.author, 'Applied Science');
  assert.equal(f.entries.length, 2);
  assert.equal(f.entries[0].title, 'Making a vacuum tube & testing it');
  assert.equal(f.entries[0].description, 'Glass, "getters" and a pump.');
  assert.equal(f.entries[0].views, 123456);
  assert.ok(f.entries[1].link.includes('/shorts/'));
});

test('formats views, ages and durations', () => {
  assert.equal(YB.views(1234), '1.2K views');
  assert.equal(YB.views(12500000), '13M views');
  assert.equal(YB.timeAgo('2026-11-01T00:00:00Z', Date.parse('2026-11-02T00:00:00Z')), '1 day ago');
  assert.equal(YB.seconds('12:34'), 754);
  assert.equal(YB.seconds('1:02:03'), 3723);
  assert.equal(YB.seconds('LIVE'), 0);
});

test('asks Claude Haiku once per batch with a JSON schema and reads the answer', async () => {
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url: String(url), headers: new Headers(init.headers), body: JSON.parse(init.body) });
    const body = {
      id: 'msg_test', type: 'message', role: 'assistant', model: MODEL, stop_reason: 'end_turn', stop_sequence: null,
      usage: { input_tokens: 900, output_tokens: 120 },
      content: [
        { type: 'thinking', thinking: '', signature: 'x' },
        { type: 'text', text: JSON.stringify({ results: [
          { id: 'v1', building: true, category: 'machining', reason: 'machining a part on a lathe' },
          { id: 'v2', building: false, category: 'none', reason: 'a cooking video' },
          { id: 'zz', building: true, category: 'maker', reason: 'not asked for' },
        ] }) },
      ],
    };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json', 'request-id': 'req_test' } });
  };
  const { results, usage } = await classifyBatch([
    { id: 'v1', title: 'Turning a brass knob', channelName: 'Shop' },
    { id: 'v2', title: 'Pasta night', channelName: 'Kitchen' },
  ], { apiKey: 'sk-ant-test', fetch: fakeFetch });

  assert.equal(calls.length, 1);
  const c = calls[0];
  assert.equal(c.url, 'https://api.anthropic.com/v1/messages');
  // SDK 1.x sends the API key as a bearer token.
  assert.equal(c.headers.get('authorization'), 'Bearer sk-ant-test');
  assert.equal(c.headers.get('anthropic-dangerous-direct-browser-access'), 'true');
  assert.equal(c.body.model, 'claude-haiku-5-5');
  assert.equal(c.body.output_config.format.type, 'json_schema');
  assert.deepEqual(c.body.output_config.format.schema, SCHEMA);
  assert.equal(JSON.parse(c.body.messages[0].content).videos.length, 2);
  assert.deepEqual(results.v1, { building: true, category: 'machining', reason: 'machining a part on a lathe' });
  assert.deepEqual(results.v2, { building: false, category: null, reason: 'a cooking video' });
  assert.equal(results.zz, undefined);
  assert.equal(usage.input_tokens, 900);
});
