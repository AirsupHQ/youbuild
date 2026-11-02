import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import '../src/lib/filter.js';

const YB = globalThis.YouBuild;
const list = JSON.parse(fs.readFileSync(new URL('../data/channels.json', import.meta.url), 'utf8'));
const verdict = (title, channelName = '', description = '') => YB.classify({ title, channelName, description }).verdict;

// Real titles from YouTube search results (November 2026).
const BUILDING = [
  ['CNC machining - What is it and How Does it Work? (Must Know Basics)', 'Protolabs'],
  ['Have you ever seen 3D Printing like this?', 'TITANS of CNC MACHINING'],
  ['Explication simple : l’usinage CNC', 'Machines Outils'],
  ['How It’s Made: Aircraft Engines, Titanium & Cement', 'Captain Factory'],
  ['How It\'s Made: Sardines, Baguettes, Pasta, Jam', 'Captain Discovery'],
  ['Inside a Chinese CNC Factory', 'Strange Parts'],
  ['Factory Tour in China - How PCB Is Made', 'Robert Feranec'],
  ['Building a Rocket Engine that Lifts Beer Kegs', 'Project KegRocket'],
  ['Aluminum TIG Welding 1F&2F Corner', 'weldingtipsandtricks'],
  ['5 Reasons to Learn PCB Design Today [GIVEAWAY!]', 'LeftyMaker'],
  ['I Built A Bladeless Turbine For Silent Flight', 'Plasma Channel'],
  ['Engine Rebuild: 1KD-FTV Toyota Diesel Overhaul', 'BTD Garage'],
  ['How Honda Cars Are Made in Japan | Full Factory Tour from Steel to Shipping', 'Automotive garage'],
  ['Inside Japan’s Giant Excavator Factory', 'BuildWitt'],
  ['Biggest Mysteries in Physics: Antimatter, Dark Energy & ToE', 'Lex Fridman'],
  ['Tesla Technoking and SpaceX Chief Engineer Elon Musk | Full Interview', 'On with Kara Swisher'],
  ['Turning vs Milling Explained: The One Difference That Changes Everything', 'Chip Atlas'],
  ['Woodturning. These just don’t stop selling.', 'Glenn & Liza Woodturning'],
  ['Every Physics Law Explained in 11 Minutes', 'The Analyst'],
  ['Machinist Reacts to the Most Precise Lathe', 'Some Shop'],
  ["Starship's Second Flight Test", 'SpaceX'],
  ['Rocket Lab - The Sea God Surveys Launch', 'Rocket Lab'],
  ['Huracán & Aventador: The Last Dance for the V10 and V12!', 'Turbo'],
];

const NOT_BUILDING = [
  ['Colloque 80 ans du CNC - 28 octobre 2026', 'CNC Centre national du cinéma et de l\'image animée'],
  ['Les Oscars, un enjeu de rayonnement du modèle français', 'CNC Centre national du cinéma et de l\'image animée'],
  ['10 Recipes To Cook This October | Jamie Oliver', 'Jamie Oliver'],
  ['Ultimate chocolate moist cake #shorts #cooking #recipe', 'Chocolate Cacao'],
  ['Mutton Biryani Recipe Cooking in Village', 'Village Cooking Channel'],
  ['Satisfying Slime ASMR | Relaxing Slime Videos Compilation', 'Talisa Tossell'],
  ['Genius Life Hacks That Work Extremely Well #shorts #viral #diy', 'AMAZEO'],
  ['15 diy room decor ideas *aesthetic*', 'Leyla Tavas'],
  ['Spotify Founder: How A 23 Year Old Introvert Built A $31 Billion Business!', 'The Diary Of A CEO'],
  ['Gymshark CEO: How I Built A $1.5 Billion Business At 19!', 'The Diary Of A CEO'],
  ['Kimi Antonelli Is The F1 World Champion!', 'FORMULA 1'],
  ['Race Highlights | 2026 Mexico City Grand Prix', 'FORMULA 1'],
  ['Minecraft Hardcore: building a mega base', 'Some Gamer'],
  ['Teardown Added Multiplayer...', 'SMii7Y'],
  ['Jet Engine Airplane White Noise | Calming Flight Sounds for Sleep', 'Relaxing White Noise'],
  ['DHH: Future of Programming, AI, Agentic Engineering, Vibe Coding & Linux', 'Lex Fridman'],
  ['Taiwan: The Most Epic Night Market Experience w/ Jensen Huang', 'Lex Fridman'],
  ['Trending - Dei V (Official Video)', 'Dei V'],
  ['Europe in CHAOS: Riots spread from France to Germany, Portugal', 'Fox News'],
  ['Can I Catch 100 Fish in 24 Hours?', 'ADUB'],
  ['The POWER PLANT Discharge was Hiding an AWESOME Fish!!!', '618 Fishing'],
  ['2027 Audi Q9 Review: The Biggest, Craziest Audi Luxury SUV Ever', 'Doug DeMuro'],
  ['Coupe de France slash x Rocket League - Day 1', 'slash'],
  ['Oklahoma City Thunder vs Houston Rockets Full Game Highlights', 'GAMETIME HIGHLIGHTS'],
  ['Deadly plane crash caught on camera in Florida', 'WUSA9'],
  ['Airplane Classic Scenes', 'Dunderphonic 8-Bit'],
  ['BL3ANAA - SASY X ROCKET X VIBEY | PROD BY ASKARR', 'BL3ANAA'],
  ['Rocket ft. Vibey - Night Drive (Official Music Video)', 'Rocket'],
];

test('building videos pass the topic check', () => {
  const misses = BUILDING.filter(([t, c]) => verdict(t, c) !== 'yes');
  assert.deepEqual(misses, []);
});

test('everything else does not', () => {
  const leaks = NOT_BUILDING.filter(([t, c]) => verdict(t, c) === 'yes');
  assert.deepEqual(leaks, []);
});

test('CNC alone is not enough, CNC with a building word is', () => {
  assert.notEqual(verdict('CNC Vétérans - Finale'), 'yes');
  assert.equal(verdict('CNC router build for aluminum'), 'yes');
});

test('phrases count once, not once per word', () => {
  const terms = YB.classify({ title: 'Touring a power plant' }).matched.map((m) => m.term);
  assert.ok(terms.includes('power plant'));
  assert.ok(!terms.includes('power') && !terms.includes('plant'), terms.join(', '));
});

test('plurals and accents match', () => {
  assert.equal(YB.classify({ title: 'Robots building rockets' }).category !== null, true);
  assert.equal(verdict('Fabrication d’une fusée'), 'yes');
});

test('categories come out right', () => {
  assert.equal(YB.classify({ title: 'Designing a PCB in KiCad, the full workflow' }).category, 'electronics');
  assert.equal(YB.classify({ title: 'Starship static fire and booster catch' }).category, 'aerospace');
  assert.equal(YB.classify({ title: 'Small modular reactor explained: how nuclear fission makes power' }).category, 'energy');
  assert.equal(YB.classify({ title: 'Jim Keller interview: how chips get designed', channelName: 'Lex Fridman' }).category, 'interviews');
});

const settings = YB.withDefaults();
const index = YB.buildIndex(list, settings);
const ctx = { settings, index };

test('a channel on the list is shown whatever the title says', () => {
  const d = YB.decide({ id: 'x', title: 'I Solved Every Board Game', channelName: 'Mark Rober' }, ctx);
  assert.equal(d.show, true);
  assert.equal(d.source, 'list');
  assert.match(d.why[0], /Mark Rober is on the builder list/);
});

test('topic channels only show their building videos', () => {
  assert.equal(YB.decide({ id: 'a', title: 'Gary Gallagher: American Civil War, Slavery, Lincoln', channelName: 'Lex Fridman' }, ctx).show, false);
  assert.equal(YB.decide({ id: 'b', title: 'Jeff Bezos: Amazon and Blue Origin', channelName: 'Lex Fridman' }, ctx).show, true);
});

test('blocked content farms stay hidden even with building words', () => {
  const d = YB.decide({ id: 'c', title: 'DIY woodworking hacks for your workshop', channelName: '5-Minute Crafts' }, ctx);
  assert.equal(d.show, false);
});

test('allowlist only hides everything else', () => {
  const strict = { settings: YB.withDefaults({ strictness: 'allowlist' }), index };
  assert.equal(YB.decide({ id: 'd', title: 'CNC machining a turbine blade', channelName: 'Random Shop' }, strict).show, false);
  assert.equal(YB.decide({ id: 'e', title: 'Anything', channelName: 'Applied Science' }, strict).show, true);
});

test('user channels, blocks, categories, Shorts and minimum length', () => {
  const s = YB.withDefaults({
    userChannels: [{ id: 'UC0000000000000000000001', name: 'My Shop', categories: ['machining'] }],
    blockedChannels: [{ name: 'Mark Rober' }],
    categories: { aerospace: false },
    minMinutes: 5,
  });
  const c = { settings: s, index: YB.buildIndex(list, s) };
  assert.equal(YB.decide({ id: 'f', title: 'Vlog day', channelName: 'My Shop' }, c).source, 'yours');
  assert.equal(YB.decide({ id: 'g', title: 'Building a robot', channelName: 'Mark Rober' }, c).show, false);
  assert.equal(YB.decide({ id: 'h', title: 'Starship launch', channelName: 'Scott Manley' }, c).show, false);
  assert.equal(YB.decide({ id: 'i', title: 'Welding a frame', channelName: 'Applied Science', isShort: true }, c).show, false);
  assert.equal(YB.decide({ id: 'j', title: 'Welding a frame', channelName: 'Applied Science', seconds: 120 }, c).show, false);
  assert.equal(YB.decide({ id: 'k', title: 'Welding a frame', channelName: 'Applied Science', seconds: 900 }, c).show, true);
});

test('unsure videos wait for Claude only when it is on', () => {
  const v = { id: 'l', title: 'The table that captures a split second', channelName: 'Unknown' };
  assert.equal(YB.decide(v, ctx).pending, undefined);
  const on = { settings: YB.withDefaults({ llm: { enabled: true } }), index, llmReady: () => true, llm: () => undefined };
  const r = YB.classify(v);
  if (r.verdict === 'unsure') assert.equal(YB.decide(v, on).pending, true);
  const answered = { ...on, llm: () => ({ building: true, category: 'maker', reason: 'woodworking build' }) };
  if (r.verdict === 'unsure') assert.equal(YB.decide(v, answered).source, 'claude');
});

test('the channel list is well formed', () => {
  assert.ok(list.channels.length >= 150, 'at least 150 channels');
  const ids = new Set();
  for (const c of list.channels) {
    assert.match(c.id, /^UC[\w-]{22}$/, c.name);
    assert.ok(!ids.has(c.id), 'duplicate ' + c.name);
    ids.add(c.id);
    assert.match(c.handle, /^@/, c.name);
    assert.ok(c.name && c.name.trim() === c.name, c.id);
    assert.ok(Array.isArray(c.categories) && c.categories.length, c.name);
    for (const k of c.categories) assert.ok(YB.CATEGORY_IDS.includes(k), c.name + ': ' + k);
    if (c.mode) assert.equal(c.mode, 'topic', c.name);
  }
  for (const b of list.blocked) assert.match(b.id, /^UC[\w-]{22}$/, b.name);
  for (const cat of YB.CATEGORY_IDS) assert.ok(list.channels.some((c) => c.categories.includes(cat)), 'no channel in ' + cat);
});
