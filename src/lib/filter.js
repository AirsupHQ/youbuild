// YouBuild filter: categories, the local topic classifier and the show or hide decision.
// Plain script with no imports or exports, so the same file runs as a content script,
// in the popup, in the service worker (as a side effect import) and in Node tests.
(function (root) {
  'use strict';

  const CATEGORIES = [
    { id: 'explainers', label: 'Explainers', long: 'Engineering and physics explainers' },
    { id: 'manufacturing', label: 'Manufacturing', long: 'Manufacturing and factory tours' },
    { id: 'machining', label: 'Machining', long: 'Machining, fabrication and welding' },
    { id: 'electronics', label: 'Electronics', long: 'Electronics and PCB' },
    { id: 'robotics', label: 'Robotics', long: 'Robotics' },
    { id: 'aerospace', label: 'Aerospace', long: 'Aerospace and rockets' },
    { id: 'energy', label: 'Energy', long: 'Energy' },
    { id: 'cars', label: 'Cars', long: 'Cars and engines' },
    { id: 'cad', label: 'CAD', long: 'CAD and simulation' },
    { id: 'interviews', label: 'Interviews', long: 'Founder and engineer interviews and talks' },
    { id: 'teardowns', label: 'Teardowns', long: 'Teardowns' },
    { id: 'maker', label: 'Maker builds', long: 'Maker builds' },
  ];
  const CATEGORY_IDS = CATEGORIES.map((c) => c.id);
  const CATEGORY_BY_ID = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));

  // Terms per category and weight. 3 = clearly about building things, 2 = usually, 1 = a hint.
  // Suffixes: "?" = ambiguous on its own (CNC is also France's film agency), it only counts in
  // full next to another building term. "~" = generic (build, project): it adds to the score but
  // is never enough evidence alone. Matching is on whole words after lower casing and stripping
  // accents, and plurals of single words match too.
  const TERMS = {
    explainers: {
      3: 'physics|physicist|engineering|engineer|thermodynamics|aerodynamics|fluid dynamics|fluid mechanics|structural engineering|civil engineering|mechanical engineering|electrical engineering|materials science|metallurgy|how it works|how does it work|how do they work|how they work|how does a|how do touchscreens work|wind tunnel|high speed camera|slow motion camera|heat transfer|heat exchanger|tribology|engineering marvel|megaproject|megastructure|ingenieur|ingenieria|ingenierie|physique|fisica|physik',
      2: 'experiment|infrastructure|construction|constructed|bridge|dam|tunnel|concrete|skyscraper|hydraulic|hydraulics|pneumatic|vacuum chamber|pressure vessel|laser|optics|lens?|telescope|microscope|electromagnet|magnetism|friction|gyroscope|centrifugal|kinematics|mechanism|gear|gears|bearing|pump|valve|compressor|cryogenic|superconductor|plasma|quantum|relativity|entropy|resonance|vibration|acoustics|viscosity|buoyancy|aerodynamic|downforce|lightning|particle accelerator|sound waves|magnet|torque',
      1: 'science~|scientist~|explained~|explainer~|energy~|force~|motion~|heat~|pressure~|why~|mathematician~|actually work~|how do~|work~',
    },
    manufacturing: {
      4: 'how its made|how it s made',
      3: 'factory|manufacturing|manufacture|manufactured|manufacturer|mass production|production line|assembly line|injection molding|injection moulding|die casting|sand casting|investment casting|forging|stamping|extrusion|foundry|steel mill|rolling mill|smelting|smelter|semiconductor|wafer|lithography|euv|chip fab|fab tour|factory tour|plant tour|gigafactory|supply chain|production process|industrial process|shipyard|refinery|lean manufacturing|usine|fabrica|fabrik|fabricacion',
      2: 'industrial|automation|automated|mass produced|mold|mould|molding|moulding|casting|sheet metal|press brake|conveyor|tsmc|asml|foxconn|shenzhen|assembly~|production~|quality control|plant~|mill~|logistics~|warehouse~|industry~',
      1: 'made~|process~|inside~|how are~|how is~',
    },
    machining: {
      3: 'cnc?|machining|machinist|lathe|milling|milling machine|mill turn|bridgeport|end mill|endmill|welding|welder|welded|weld|tig?|mig?|stick welding|fabrication|fabricator|metalworking|metalwork|metal working|blacksmith|blacksmithing|bladesmith|knife making|forge|anvil|surface grinder|cylindrical grinder|edm?|wire edm|knurling|boring bar|face mill|fly cutter|dividing head|rotary table|dial indicator|micrometer|tool and die|toolmaker|machine shop|plasma cutter|plasma cutting|oxy acetylene|brazing|metal lathe|haas|mazak|dmg mori|okuma|hurco|5 axis|five axis|4 axis|toolpath|g code|gcode|feeds and speeds|hand scraping|machinist reacts|welder reacts|molten metal|metal casting|usinage|fraiseuse|soudure|tournage|frasen|schweissen|drehbank|soldadura|torno|fresadora|mecanizado',
      2: 'precision|tolerance|micron|tenths|steel|aluminum|aluminium|titanium|brass|bronze|copper|molten|stainless steel|carbide|overhaul|overhauled|drill press|bandsaw|band saw|grinder|grinding|threading|tapping|restoration|restore|restored|rebuild|rebuilding|tooling|jig|fixture|vise|collet|spindle|gear cutting|hobbing|broaching|honing|lapping|heat treat|heat treating|hardening|quench|knife|scraping',
      1: 'metal~|tool~|workshop~|garage~|shop~|repair~|machine~',
    },
    electronics: {
      3: 'electronics|electronic|pcb|circuit board|printed circuit|electronic circuit|circuit design|soldering|solder|oscilloscope|multimeter|transistor|mosfet|op amp|opamp|capacitor|resistor|inductor|diode|microcontroller|arduino|raspberry pi|esp32|esp8266|stm32|fpga|kicad|altium|schematic|breadboard|smd?|smt?|reflow|pick and place|bench power supply|logic analyzer|spectrum analyzer|signal generator|ham radio|software defined radio|sdr?|radio transmitter|radio receiver|antenna|amplifier|vacuum tube|tesla coil|high voltage|flyback|buck converter|boost converter|voltage regulator|battery management|integrated circuit|chip design|asic|risc v|6502|z80|retro computer|homebrew computer|cpu design|logic gates|ttl|555 timer|vintage computer|apollo guidance computer|electronique|elektronik|electronica',
      2: 'touchscreen|transistors|voltage|volts|amps|watts|electrical|electricity|circuit?|circuits?|charger|sensor|motor driver|led|chip|chips|cpu|firmware|embedded|iot|wireless|signal|frequency|wiring|relay|transformer|lithium|18650|oled|lcd|e ink|inverter|power supply',
      1: 'electric~|computer~|power~|device~|radio~|battery~',
    },
    robotics: {
      3: 'robot|robotic|robotics|humanoid|robot arm|robotic arm|robot dog|robot hand|quadruped|biped|exoskeleton|actuator|servo|stepper motor|brushless motor|bldc|inverse kinematics|gripper|end effector|cobot|ros2|lidar|boston dynamics|unitree|optimus|animatronic|animatronics|self balancing|balancing robot|drone|quadcopter|fpv drone|self driving|robotaxi|waymo|roboter|robotique|robotica',
      2: 'automation|autonomy|autonomous|motor|gearbox|harmonic drive|cycloidal|planetary gearbox|sensor fusion|computer vision|mecha|pid controller',
      1: 'control~|controller~|ai~',
    },
    aerospace: {
      3: 'rocket|rocket engine|spacex|starship|super heavy|falcon 9|falcon heavy|raptor engine|merlin engine|nasa|esa?|jaxa|isro|blue origin|new glenn|new shepard|rocket lab|ula?|vulcan centaur|ariane|soyuz|sls?|artemis|apollo|saturn v|space shuttle|iss?|international space station|spacecraft|satellite|starlink|orbit|orbital|launch pad|launchpad|static fire|booster|hot staging|propulsion|thrust|nozzle|combustion chamber|turbopump|liquid fuel|solid rocket|jet engine|turbofan|turbojet|turboprop|ramjet|scramjet|hypersonic|supersonic|aircraft|airplane|aeroplane|airliner|fighter jet|helicopter|aviation|aerospace|aeronautics|airfoil|aerofoil|f 35|f 22|sr 71|b 2 bomber|concorde|boeing|airbus|lockheed|skunk works|mars rover|lunar lander|moon landing|james webb|hubble|space telescope|space station|cubesat|model rocket|rc plane|glider|fusee|cohete|rakete',
      2: 'launch|landing|spaceflight|flight|plane|jet|pilot|cockpit|wing|mars|lunar|telescope|drone|space~|moon~|flying~',
      1: 'sky~|air~|fly~',
    },
    energy: {
      3: 'nuclear|reactor|fusion reactor|fusion energy|fission|tokamak|stellarator|thorium|uranium|small modular reactor|solar power|solar panel|photovoltaic|wind turbine|wind farm|solar farm|hydroelectric|hydropower|geothermal|power plant|power station|power grid|electrical grid|grid scale|battery storage|energy storage|pumped hydro|hydrogen|electrolyzer|electrolysis|fuel cell|heat pump|substation|transmission line|power line|hvdc|gas turbine|steam turbine|coal plant|oil refinery|oil rig|offshore wind|lithium ion|solid state battery|sodium ion|battery cell|battery pack|gigawatt|megawatt|kilowatt|off grid|solar generator|powerwall|ev charging|energie|energia',
      2: 'turbine|generator|carbon capture|solar|battery|batteries|grid~|electricity~|energy~|power~|oil~|gas~|coal~|wind~',
      1: 'climate~',
    },
    cars: {
      3: 'v8|v6|v10|v12|inline 6|flat 6|boxer engine|rotary engine|wankel|two stroke|2 stroke|four stroke|diesel engine|piston|crankshaft|camshaft|cylinder head|turbocharger|supercharger|intercooler|manual transmission|differential|limited slip|suspension|drivetrain|powertrain|horsepower|dyno|engine rebuild|engine build|engine teardown|engine swap|ls swap|carburetor|carburettor|fuel injection|electric motor|power unit|ground effect|restomod|moteur',
      2: 'engine|transmission|gearbox|turbo|brake|chassis|electric car|electric vehicle|ev?|cybertruck|rivian|tesla|mechanic|motorcycle engine|race car|aero|diffuser|exhaust|torque',
      1: 'car~|vehicle~|truck~|motorcycle~|motorbike~|porsche~|ferrari~|lamborghini~|mclaren~|toyota~|honda~|bmw~|ford~|f1~|formula 1~|motorsport~|motor~|drive~|driving~',
    },
    cad: {
      3: 'cad?|fusion 360|autodesk fusion|solidworks|onshape|freecad|autodesk inventor|catia|siemens nx|creo|rhino 3d|grasshopper|shapr3d|openscad|ansys|abaqus|comsol|openfoam|cfd|fea|finite element|computational fluid dynamics|topology optimization|generative design|gd t|geometric dimensioning|technical drawing|engineering drawing|drafting|parametric|mechanical design|product design|design for manufacturing|dfm|simulation|matlab|simulink|design review',
      2: '3d model|3d modeling|3d modelling|stress analysis|prototype|prototyping|simulated|modeling~|modelling~|sketch~|assembly~',
      1: 'design~|designed~|designing~',
    },
    interviews: {
      2: 'elon musk|gwynne shotwell|palmer luckey|jensen huang|lisa su|jim keller|george hotz|tony fadell|james dyson|john carmack|peter beck|tom mueller|burt rutan|dean kamen|sandy munro|chief engineer|lead engineer|hardware startup|hard tech|deep tech|oral history|founder~|founders~|cofounder~|co founder~|ceo~|cto~|startup~|y combinator~|keynote~|lecture~|fireside chat~',
      1: 'interview~|interviewed~|podcast~|conversation~|talk~|panel~|q a~|ama~|episode~',
    },
    teardowns: {
      3: 'teardown|tear down|torn down|tearing down|disassembly|disassemble|disassembled|take apart|taking apart|taken apart|whats inside|what is inside|inside of a|cut in half|cutting in half|cut open|cutaway|cross section|x ray|ct scan|reverse engineering|reverse engineered|failure analysis|why it failed',
      2: 'repair|repairing|restoration|internals|broken~|fixing~',
      1: 'inside~|fix~|fixed~',
    },
    maker: {
      3: 'diy?|homemade|home made|handmade|hand made|build log|3d print|3d printed|3d printer|3d printing|resin printer|laser cutter|laser cut|laser engraver|woodworking|woodworker|woodwork|woodworks|woodturning|wood lathe|joinery|wood joint|carpentry|carpenter|cnc router|maker|makerspace|invention|inventor|contraption|rube goldberg|prototype|prototyping|i machined|i welded|i 3d printed|impression 3d|3d druck|impresion 3d',
      2: 'i built~|i made~|we built~|we made~|i designed~|how to make~|how i made~|how we made~|engineered|mechanism|lego technic|cardboard~|knife~|jig',
      1: 'build~|building~|built~|making~|make~|made~|project~|custom~|upgrade~|wood~|plastic~|lego~|kit~|tool~|machine~',
    },
  };

  // Words that point away from building things. Weight is subtracted from the score.
  // Food words go soft inside a factory or build video ("How It's Made: pasta" is still a factory).
  const NEGATIVE = {
    5: 'recipe|cooking|cook|cooked|chef|mukbang|food review|taste test|makeup|skincare|hairstyle|nail art|grwm|get ready with me|prank|reaction|react|reacting|celebrity|kardashian|gossip|horoscope|astrology|tarot|music video|official video|official audio|lyric video|lyrics|karaoke|kpop|k pop|gameplay|lets play|walkthrough|speedrun|minecraft|fortnite|roblox|gta|call of duty|valorant|league of legends|pubg|apex legends|among us|pokemon|zelda|mario|cocomelon|nursery rhyme|baby shark|asmr|life hack|life hacks|lifehack|room decor|recette|cuisine|receta|rezept|clip officiel|get rich|make money online|rocket league|houston rockets|game highlights|caught on camera|prod by|type beat|diss track|official music|music clip',
    4: 'fashion|outfit|haul|try on|vlog|dating|relationship|girlfriend|boyfriend|song|album|remix|dance|dancing|rap|rapper|playlist|lofi|lo fi|gaming|gamer|game review|esports|twitch|football|soccer|nba|nfl|mlb|ufc|mma|boxing|wrestling|wwe|cricket|premier league|champions league|world cup|fifa|workout|fitness|gym|bodybuilding|diet|weight loss|yoga|meditation|sleep music|rain sounds|white noise|horror|scary|creepy|paranormal|true crime|murder|anime|manga|movie|film review|trailer|teaser|netflix|tiktok|meme|funny|comedy|comedy sketch|try not to laugh|crypto|bitcoin|ethereum|nft|forex|day trading|passive income|side hustle|dropshipping|election|elections|trump|biden|democrat|republican|iphone review|phone review|smartphone review|best phones|slime|the sims|animal crossing|travel vlog|trip report|first class|business class|cinema|cinematographique|colloque|watchalong|race highlights|multiplayer|vibe coding|crafts|craft ideas|paper craft|decor|aesthetic|should you buy',
    3: 'review|reviewed|test drive|highlights|millionaire|billionaire|hotel|festival|grammy|night market|hacks|riots|protest|protesters|fishing|catfish|carp|programming|coding|javascript|web development|leetcode|money|wealth|income|grand prix|sleep|sleeping|calming|relaxing|relaxation|ambience|study music|focus music|hours of|motor show|auto show|car show|killed|scenes|plane spotting|planespotting|freestyle|instrumental|marvel|guardians of the galaxy|raccoon',
    2: 'unboxing|craft|stock market|stocks|politics|political|news|breaking news|real estate|kids|toys|cat|puppy|kitten|pets|hunting|travel|bbq|wedding|baby|game|simulator|game engine|unreal engine|search engine|apple event|airpods|shorts|champion|business|brand|empire|investing|investor|fish|qualifying',
    1: 'feat|ft|compilation|giveaway|software|linux|python|camping|race|driver|drivers|music',
  };
  const FOOD = 'food|eating|eat|pizza|burger|pasta|steak|cake|dessert|cookies|sourdough|cocktail|bread|coffee|wine|beer|drink|kitchen|chicken|beef|pork|lamb|mutton|curry|biryani|snack|snacks|breakfast|dinner|lunch|chocolate|ice cream|cheese|candy|sweet|fries|nuggets|tea|juice|soda|restaurant';
  NEGATIVE[3] += '|' + FOOD;
  const FOOD_SET = new Set(FOOD.split('|'));

  // Channel name hints: a channel called "Odd Machinist" is probably about machining.
  const CHANNEL_WEIGHT = 0.67;
  const DESCRIPTION_WEIGHT = 0.5;
  const DESCRIPTION_NEGATIVE_WEIGHT = 0.3;
  const SHOW_AT = 3;
  const HIDE_AT = 1;

  function norm(s) {
    return (' ' + String(s || '').toLowerCase()
      .replace(/ß/g, 'ss')
      .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[’`´]/g, "'")
      .replace(/'s\b/g, 's')
      .replace(/[^a-z0-9]+/g, ' ') + ' ').replace(/\s+/g, ' ');
  }

  // Plural to singular for matching. Words ending in -ics and a few others are not plurals.
  const KEEP = new Set(['news', 'mars', 'lens', 'series', 'species', 'means', 'shorts', 'gas', 'bus', 'chaos', 'canvas', 'atlas', 'chassis', 'aws', 'ios', 'cms', 'bms', 'abs', 'gps', 'nas', 'sls', 'iss', 'ups', 'yes', 'this', 'his', 'its', 'was', 'has', 'does', 'is', 'us', 'plus', 'less', 'class', 'glass', 'brass', 'press', 'process', 'wireless', 'stainless', 'business', 'carcass', 'tennis', 'axis', 'analysis', 'diagnosis', 'thesis', 'basis', 'christmas', 'texas', 'kansas', 'paris', 'vegas', 'tesla', 'jesus', 'always', 'perhaps', 'whereas', 'across', 'versus', 'various', 'famous', 'serious', 'previous', 'nervous', 'dangerous']);
  function singular(w) {
    if (w.length < 4 || KEEP.has(w) || w.endsWith('ics') || w.endsWith('ss') || w.endsWith('us') || w.endsWith('is')) return w;
    if (w.endsWith('ies')) return w.slice(0, -3) + 'y';
    if (/(ches|shes|xes)$/.test(w)) return w.slice(0, -2);
    if (w.endsWith('s') && !w.endsWith('os')) return w.slice(0, -1);
    return w;
  }
  function singularPhrase(p) { return p.split(' ').map(singular).join(' '); }

  // key (singular form) -> { term, pos: [{ cat, w }], neg, ambiguous, soft, food }
  const INDEX = new Map();
  function addTerm(raw, fn) {
    let t = raw.trim();
    if (!t) return;
    let ambiguous = false;
    let soft = false;
    while (/[?~]$/.test(t)) { if (t.endsWith('?')) ambiguous = true; else soft = true; t = t.slice(0, -1); }
    const shown = norm(t).trim();
    if (!shown) return;
    const key = singularPhrase(shown);
    let e = INDEX.get(key);
    if (!e) { e = { term: shown, key, words: key.split(' '), pos: [], neg: 0, ambiguous: false, soft: true, food: false }; INDEX.set(key, e); }
    if (ambiguous) e.ambiguous = true;
    fn(e, soft);
  }
  for (const cat of Object.keys(TERMS)) {
    for (const w of Object.keys(TERMS[cat])) {
      for (const t of TERMS[cat][w].split('|')) {
        addTerm(t, (e, soft) => {
          if (!soft) e.soft = false;
          const prev = e.pos.find((p) => p.cat === cat);
          if (prev) prev.w = Math.max(prev.w, Number(w));
          else e.pos.push({ cat, w: Number(w) });
        });
      }
    }
  }
  for (const e of INDEX.values()) if (!e.pos.length) e.soft = false;
  for (const w of Object.keys(NEGATIVE)) {
    for (const t of NEGATIVE[w].split('|')) {
      addTerm(t, (e) => {
        e.neg = Math.max(e.neg, Number(w));
        if (FOOD_SET.has(t.trim())) e.food = true;
      });
    }
  }
  for (const e of INDEX.values()) if (e.food && e.neg < 3) e.neg = 3;
  const SINGLE = new Map();
  const PHRASES = [];
  for (const e of INDEX.values()) (e.words.length > 1 ? PHRASES.push(e) : SINGLE.set(e.key, e));

  const FORMAT_WORDS = new Set(['interview', 'interviewed', 'podcast', 'conversation', 'keynote', 'lecture', 'fireside chat', 'panel', 'talk', 'q a', 'ama', 'episode', 'oral history']);

  // Finds every term in one piece of text. A word that is part of a longer matched phrase
  // only counts as that phrase ("power plant" is one hit, not also "power" and "plant").
  function scan(text) {
    const raw = norm(text).trim();
    const hits = [];
    if (!raw) return hits;
    const words = raw.split(' ').map(singular);
    const sing = ' ' + words.join(' ') + ' ';
    const covered = new Set();
    const phraseHits = [];
    for (const e of PHRASES) {
      const needle = ' ' + e.key + ' ';
      let at = sing.indexOf(needle);
      if (at < 0) continue;
      phraseHits.push(e);
      while (at >= 0) {
        const startWord = sing.slice(0, at + 1).trim() ? sing.slice(0, at + 1).trim().split(' ').length : 0;
        for (let i = 0; i < e.words.length; i++) covered.add(startWord + i);
        at = sing.indexOf(needle, at + 1);
      }
    }
    // Drop phrases that sit inside a longer matched phrase.
    for (const e of phraseHits) {
      if (!phraseHits.some((o) => o !== e && o.words.length > e.words.length && (' ' + o.key + ' ').includes(' ' + e.key + ' '))) hits.push(e);
    }
    const seen = new Set();
    words.forEach((w, i) => {
      if (covered.has(i) || seen.has(w)) return;
      const e = SINGLE.get(w);
      if (e) { seen.add(w); hits.push(e); }
    });
    return hits;
  }

  // Scores a video from its title, channel name and description.
  // Returns { score, verdict: 'yes' | 'no' | 'unsure', category, catScore, matched, negative, format }.
  function classify(video) {
    const parts = [
      { text: video.title, pw: 1, nw: 1 },
      { text: video.channelName, pw: CHANNEL_WEIGHT, nw: CHANNEL_WEIGHT },
      { text: video.description, pw: DESCRIPTION_WEIGHT, nw: DESCRIPTION_NEGATIVE_WEIGHT },
    ];
    const pos = new Map(); // key -> { e, w }
    const neg = new Map();
    for (const p of parts) {
      if (!p.text) continue;
      for (const e of scan(p.text)) {
        if (e.pos.length) {
          const prev = pos.get(e.key);
          if (!prev || prev.w < p.pw) pos.set(e.key, { e, w: p.pw });
        }
        if (e.neg) {
          const prev = neg.get(e.key);
          if (!prev || prev.w < p.nw) neg.set(e.key, { e, w: p.nw });
        }
      }
    }
    const clear = [...pos.values()].filter((h) => !h.e.ambiguous && !h.e.soft).length;
    const catScore = {};
    let score = 0;
    let hard = 0;
    const matched = [];
    for (const { e, w } of pos.values()) {
      let best = 0;
      for (const p of e.pos) {
        let v = p.w;
        if (e.ambiguous && clear === 0) v = Math.min(v, 1);
        v *= w;
        catScore[p.cat] = (catScore[p.cat] || 0) + v;
        best = Math.max(best, v);
        if (!e.soft && p.cat !== 'interviews' && !(e.ambiguous && clear === 0)) hard = Math.max(hard, v);
      }
      score += best;
      matched.push({ term: e.term, w: Math.round(best * 100) / 100 });
    }
    // Food words go soft when the video is clearly about something built (a factory, a rocket).
    const factory = hard >= 3 || (catScore.manufacturing || 0) >= 3;
    const negative = [];
    for (const { e, w } of neg.values()) {
      // A negative word inside a matched building phrase does not count ("machinist reacts").
      if (e.pos.length) continue;
      if ([...pos.values()].some((h) => h.e.words.length > e.words.length && (' ' + h.e.key + ' ').includes(' ' + e.key + ' '))) continue;
      const v = e.neg * w * (e.food && factory ? 0.25 : 1);
      score -= v;
      negative.push({ term: e.term, w: Math.round(v * 100) / 100 });
    }
    matched.sort((a, b) => b.w - a.w);
    negative.sort((a, b) => b.w - a.w);
    const format = [...pos.values()].some((h) => FORMAT_WORDS.has(h.e.key));
    let category = null;
    let bestScore = 0;
    for (const id of CATEGORY_IDS) {
      if (id === 'interviews') continue;
      const s = catScore[id] || 0;
      if (s > bestScore) { bestScore = s; category = id; }
    }
    if (format && score >= SHOW_AT) category = 'interviews';
    else if (!category && catScore.interviews) category = 'interviews';
    let verdict = 'unsure';
    if ((score >= SHOW_AT && hard >= 2) || (score >= SHOW_AT - 0.5 && hard >= 3)) verdict = 'yes';
    else if (score <= HIDE_AT) verdict = 'no';
    return { score: Math.round(score * 100) / 100, verdict, category, catScore, matched, negative, format, hard };
  }

  // ---------- channels ----------

  function normHandle(h) {
    if (!h) return '';
    h = String(h).trim();
    const m = h.match(/@([\w.\-]+)/);
    return m ? '@' + m[1].toLowerCase() : '';
  }
  // "Smarter Every Day", "SmarterEveryDay" and "smartereveryday" are the same channel.
  function normName(n) {
    return String(n || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '');
  }

  // Builds lookups for the built-in list plus the user's own channels and blocks.
  function buildIndex(list, settings) {
    const byId = new Map();
    const byHandle = new Map();
    const byName = new Map();
    const put = (ch, kind) => {
      const entry = { ...ch, kind };
      if (ch.id) byId.set(ch.id, entry);
      if (ch.handle) byHandle.set(normHandle(ch.handle), entry);
      if (ch.name) byName.set(normName(ch.name), entry);
      for (const alias of ch.aliases || []) byName.set(normName(alias), entry);
    };
    for (const ch of (list && list.channels) || []) put(ch, 'list');
    for (const ch of (list && list.blocked) || []) put(ch, 'listBlocked');
    for (const ch of (settings && settings.userChannels) || []) put(ch, 'yours');
    for (const ch of (settings && settings.blockedChannels) || []) put(ch, 'blocked');
    return { byId, byHandle, byName };
  }

  function findChannel(index, video) {
    if (!index) return null;
    if (video.channelId && index.byId.has(video.channelId)) return index.byId.get(video.channelId);
    const h = normHandle(video.channelHandle);
    if (h && index.byHandle.has(h)) return index.byHandle.get(h);
    const n = normName(video.channelName);
    if (n && index.byName.has(n)) return index.byName.get(n);
    return null;
  }

  // ---------- settings ----------

  const DEFAULT_SETTINGS = {
    enabled: true,
    strictness: 'classifier', // 'allowlist' | 'classifier'
    categories: Object.fromEntries(CATEGORY_IDS.map((id) => [id, true])),
    hideShorts: true,
    hideComments: false,
    minMinutes: 0,
    showChips: true,
    userChannels: [],
    blockedChannels: [],
    llm: { enabled: false, model: 'claude-haiku-5-5' },
  };

  function withDefaults(s) {
    const out = { ...DEFAULT_SETTINGS, ...(s || {}) };
    out.categories = { ...DEFAULT_SETTINGS.categories, ...((s && s.categories) || {}) };
    out.llm = { ...DEFAULT_SETTINGS.llm, ...((s && s.llm) || {}) };
    out.userChannels = Array.isArray(out.userChannels) ? out.userChannels : [];
    out.blockedChannels = Array.isArray(out.blockedChannels) ? out.blockedChannels : [];
    return out;
  }

  // ---------- the decision ----------

  function label(cat) { return (CATEGORY_BY_ID[cat] && CATEGORY_BY_ID[cat].label) || 'Building'; }

  function pickCategory(channel, result) {
    const cats = (channel && channel.categories) || [];
    if (!cats.length) return result.category || null;
    if (result.category && cats.includes(result.category) && result.score >= 2) return result.category;
    let best = cats[0];
    let bestScore = -1;
    for (const c of cats) {
      const s = result.catScore[c] || 0;
      if (s > bestScore) { bestScore = s; best = c; }
    }
    return bestScore > 0 ? best : cats[0];
  }

  // video: { id, title, channelName, channelId, channelHandle, description, seconds, isShort, isLive }
  // ctx: { settings, index, llm: (id) => cached Claude verdict or undefined }
  // Returns { show, pending, source, category, why: [lines], hiddenBecause }.
  function decide(video, ctx) {
    const settings = ctx.settings;
    const result = classify(video);
    const channel = findChannel(ctx.index, video);
    const name = video.channelName || (channel && channel.name) || 'This channel';
    let d;
    if (channel && channel.kind === 'blocked') d = { show: false, source: 'blocked', hiddenBecause: 'You blocked ' + name };
    else if (channel && channel.kind === 'listBlocked') d = { show: false, source: 'blocked', hiddenBecause: name + ' is on the blocklist' };
    else if (channel && channel.kind === 'yours') {
      d = { show: true, source: 'yours', category: pickCategory(channel, result), why: ['You added ' + name] };
    } else if (channel && channel.kind === 'list') {
      if (channel.mode === 'topic' && result.verdict !== 'yes') {
        d = { show: false, source: 'list', hiddenBecause: name + ' is on the list for its building videos, this one looks off topic' };
      } else {
        d = { show: true, source: 'list', category: pickCategory(channel, result), why: [name + ' is on the builder list'] };
      }
    } else if (settings.strictness === 'allowlist') {
      d = { show: false, source: 'allowlist', hiddenBecause: 'Not on the builder list' };
    } else if (result.verdict === 'yes') {
      d = { show: true, source: 'classifier', category: result.category, why: ['Matched ' + result.matched.slice(0, 4).map((m) => m.term).join(', ')] };
    } else {
      const llm = ctx.llm ? ctx.llm(video.id) : undefined;
      if (llm && llm.building === true) {
        d = { show: true, source: 'claude', category: CATEGORY_BY_ID[llm.category] ? llm.category : result.category, why: ['Claude: ' + (llm.reason || 'about building things')] };
      } else if (llm && llm.building === false) {
        d = { show: false, source: 'claude', hiddenBecause: 'Claude: ' + (llm.reason || 'not about building things') };
      } else if (result.verdict === 'unsure' && settings.llm && settings.llm.enabled && video.id && (typeof ctx.llmReady === 'function' ? ctx.llmReady(video.id) : ctx.llmReady)) {
        d = { show: false, pending: true, source: 'claude', hiddenBecause: 'Asking Claude' };
      } else {
        d = { show: false, source: 'classifier', hiddenBecause: result.verdict === 'no' && result.negative.length ? 'Looks like ' + result.negative[0].term : 'Not about building things' };
      }
    }
    d.result = result;
    d.channel = channel;
    if (d.show) {
      if (d.category && settings.categories[d.category] === false) {
        d = { ...d, show: false, hiddenBecause: label(d.category) + ' is turned off' };
      } else if (video.isShort && settings.hideShorts) {
        d = { ...d, show: false, hiddenBecause: 'Shorts are hidden' };
      } else if (settings.minMinutes > 0 && video.seconds > 0 && !video.isLive && video.seconds < settings.minMinutes * 60) {
        d = { ...d, show: false, hiddenBecause: 'Shorter than ' + settings.minMinutes + ' min' };
      }
    }
    if (d.show && d.category) d.why = [...(d.why || []), 'Category: ' + label(d.category)];
    return d;
  }

  root.YouBuild = Object.assign(root.YouBuild || {}, {
    CATEGORIES, CATEGORY_IDS, CATEGORY_BY_ID, DEFAULT_SETTINGS,
    norm, classify, decide, buildIndex, findChannel, withDefaults, normHandle, normName, label,
    _terms: { TERMS, NEGATIVE, INDEX, scan, singular },
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
