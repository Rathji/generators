"use strict";

// ============================================================================
//  PASSSPEN.JS — character-based password engine (Phase 1 of the roadmap)
//  Pure, DOM-free logic. Exposed on window as `Passgen`.
// ============================================================================

window.Passgen = (() => {
  const MIN_LENGTH = 8;
  const MAX_LENGTH = 64;

  const CLASSES = {
    upper: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    lower: "abcdefghijklmnopqrstuvwxyz",
    digits: "0123456789",
    symbols: "!@#$%^&*()-_=+[]{};:,.<>?/",
  };
  const AMBIGUOUS = "0O1lI";
  const VOWELS = "aeiou";
  const CONSONANTS = "bcdfghjklmnpqrstvwxyz";
  const INJECT_SYMBOLS = "!@#$%^&*()-_=+[]{};:,.<>?/";
  const INJECT_DIGITS = "0123456789";

  // ── Phase 2: word dictionaries ───────────────────────────────────────────
  // Common English / Technical / Random. All lowercase, no duplicates.
  const WORD_COMMON = [
    "about","above","accept","across","action","active","actual","add","after","again","against","agree","air","allow","almost","along","already","also","always","among","amount","animal","another","answer","any","apple","area","arm","around","arrive","art","ask","atom","baby","back","bad","bag","ball","bank","base","beach","bear","because","become","before","begin","behind","believe","below","best","better","between","beyond","big","bird","black","blood","blue","board","boat","body","bone","book","both","bottom","box","boy","branch","brave","bread","break","bridge","bright","bring","broad","brother","brown","build","burn","busy","buy","call","calm","camera","camp","candle","car","card","care","carry","case","cat","catch","cause","cell","center","chair","chance","change","charge","cheap","check","child","choose","circle","city","class","clean","clear","clever","climb","clock","close","cloud","club","coast","coffee","cold","color","common","compare","complete","condition","consider","contain","continue","cook","cool","copy","corner","cost","count","country","course","cover","cow","create","cross","crowd","cry","culture","cup","current","cut","dance","dark","data","daughter","day","dead","deal","dear","decide","deep","deliver","design","desk","detail","develop","die","difference","different","difficult","dinner","direction","dirty","discover","discuss","distance","divide","doctor","dog","door","double","down","draw","dream","dress","drink","drive","drop","dry","during","each","early","earth","east","easy","eat","edge","effect","effort","egg","eight","either","electric","element","else","empty","end","enemy","energy","engine","enough","enter","equal","escape","even","evening","event","ever","every","exact","example","except","exchange","exercise","exist","expect","experience","explain","express","eye","face","fact","fail","fair","fall","family","famous","far","farm","fast","father","favor","feed","feel","field","fight","figure","fill","film","final","find","fine","finger","finish","fire","first","fish","fit","five","fix","flat","floor","flower","fly","follow","food","foot","force","forest","form","forward","four","free","fresh","friend","front","fruit","full","fun","future","game","garden","gas","gate","gather","girl","give","glad","glass","goal","gold","good","grass","great","green","ground","group","grow","guess","guide","hair","half","hall","hand","hang","happen","happy","hard","harm","hat","hate","have","head","hear","heart","heat","heavy","hello","help","high","hill","history","hit","hold","hole","home","hope","horse","hospital","hot","hour","house","however","human","hundred","hunt","hurry","ice","idea","image","imagine","important","improve","include","increase","indeed","inform","inside","instead","interest","into","introduce","invent","invite","iron","island","item","job","join","journey","joy","judge","jump","just","keep","key","kick","kid","kind","king","kitchen","know","knowledge","land","language","large","last","late","laugh","law","lay","lead","learn","least","leave","left","leg","less","lesson","let","letter","level","library","lie","life","light","like","line","link","list","listen","little","live","local","long","look","lose","loss","loud","love","low","luck","machine","main","major","make","man","many","map","mark","market","marry","match","material","matter","maybe","mean","measure","meat","meet","member","memory","mention","message","metal","method","middle","might","mile","milk","mind","minute","miss","mix","model","modern","moment","money","month","moon","more","morning","most","mother","mountain","mouth","move","movie","much","music","must","name","nation","natural","nature","near","necessary","need","never","new","news","next","nice","night","noise","north","note","nothing","notice","now","number","object","ocean","offer","office","often","oil","old","once","one","only","open","operate","opinion","opposite","orange","order","other","outside","over","own","page","pain","paint","paper","parent","park","part","particular","pass","past","path","pay","peace","people","perhaps","period","person","pick","picture","piece","place","plan","plant","play","please","pleasure","point","poor","popular","position","possible","post","potato","power","practice","prepare","present","press","pretty","prevent","price","print","probably","process","produce","product","program","project","protect","provide","public","pull","purpose","push","put","question","quick","quiet","quite","radio","rain","raise","range","rather","reach","read","ready","real","reason","receive","recent","record","red","reduce","remember","remove","repeat","report","represent","require","research","respect","rest","result","return","rich","ride","right","ring","rise","river","road","rock","roll","room","root","rose","round","rule","run","safe","same","save","say","school","science","sea","season","seat","second","section","see","seed","seem","sell","send","sense","sentence","serve","seven","several","shadow","shall","shape","share","sharp","ship","shoe","shop","short","should","shoulder","shout","show","side","simple","since","sing","sister","sit","six","size","skill","skin","sky","sleep","slip","small","smell","smile","smoke","snow","soft","soil","soldier","solution","some","son","song","soon","sort","sound","south","space","speak","special","speed","spend","spot","spread","spring","square","stand","star","start","state","station","stay","step","stick","stone","stop","store","story","straight","strange","street","strength","strike","strong","student","study","subject","success","such","sudden","sugar","suggest","summer","sun","support","sure","surprise","swim","system","table","take","talk","tall","teacher","team","tell","ten","tend","term","test","than","thank","that","their","them","then","there","these","they","thick","thin","thing","think","third","this","those","though","thought","thousand","three","through","throw","thus","tie","time","tiny","today","together","tomorrow","tone","too","took","tool","top","total","touch","toward","town","trade","traffic","train","travel","tree","trip","trouble","true","trust","truth","try","turn","twelve","twenty","two","type","under","understand","unit","until","upon","use","usual","value","verb","very","view","village","visit","voice","wait","walk","wall","want","war","warm","wash","watch","water","wave","way","wear","weather","week","weight","well","went","were","west","what","whatever","wheel","when","where","whether","which","while","white","who","whole","why","wide","wife","wild","will","win","wind","window","winter","wish","with","within","without","woman","wonder","wood","word","work","world","worry","would","write","wrong","year","yellow","yes","yet","you","young"
  ];

  const WORD_TECHNICAL = [
    "algorithm","analytics","api","archive","authentication","automation","backend","bandwidth","binary","bit","blockchain","browser","bug","cache","captcha","certificate","checksum","cipher","client","cloud","cluster","compiler","compression","config","container","cpu","cryptography","dashboard","database","debug","deploy","dns","docker","domain","download","encryption","endpoint","ethernet","firmware","firewall","framework","frontend","function","gateway","gpu","graph","hash","host","http","https","index","input","instance","integration","interface","interrupt","ip","javascript","json","kernel","key","lambda","latency","library","linux","load","localhost","log","logic","loop","malware","memory","metadata","microservice","middleware","module","monitor","node","oauth","object","offline","online","operating","optimization","output","packet","parallel","password","patch","payload","peer","permission","php","pipeline","pixel","plugin","port","process","processor","protocol","proxy","python","query","queue","ram","realtime","reboot","recursion","regex","registry","render","repository","request","response","router","runtime","sandbox","schema","script","server","session","shell","socket","software","spam","spreadsheet","sql","ssh","stack","storage","stream","string","syntax","template","terminal","thread","token","traffic","transaction","tunnel","url","user","username","utility","validation","variable","vector","virtual","vm","vpn","webhook","website","wifi","wireframe","workflow"
  ];

  const WORD_RANDOM = [
    "abacus","acorn","adobe","aerial","agate","albino","almond","alpine","amber","anvil","apricot","arcade","arch","aster","atlas","aurora","awning","bamboo","banjo","barley","basalt","bayou","beacon","beetle","birch","blizzard","blossom","boulder","bramble","brass","breeze","briar","brooch","buckle","buffalo","bullet","butter","cactus","calico","canyon","caravan","carnival","cashew","cascade","cello","chalet","chalk","chasm","chimney","cinnamon","circuit","clover","cobalt","comet","coral","crane","crater","crescent","cricket","crimson","crystal","cyclone","cypress","daffodil","dagger","dahlia","dandelion","dart","delta","denim","desert","diamond","dinghy","dolphin","dome","dove","drizzle","dune","eagle","ebony","echo","eclipse","elm","ember","emerald","falcon","fern","fjord","flame","flint","foam","fresco","frigate","fuchsia","galaxy","gazelle","geyser","gibbon","ginkgo","glacier","gondola","granite","grove","gull","harbor","harp","hazel","hearth","hedgehog","helium","heron","hickory","hollow","horizon","hush","ibis","icicle","iguana","indigo","ivory","jackal","jade","jaguar","jasmine","jetty","juniper","kayak","kettle","koala","kite","lagoon","larch","lattice","lavender","lemur","lichen","lilac","limestone","llama","lobster","locket","lodge","lotus","lullaby","lynx","mango","manatee","maple","marigold","marsh","meadow","meridian","mesa","mica","mimosa","minaret","moat","mosaic","moth","mural","musk","myth","narwhal","nectar","newt","nickel","nocturne","nomad","oak","onyx","orchid","oriole","osprey","otter","opal","panda","parchment","parrot","pasture","pebble","pelican","pepper","pergola","phoenix","pier","pinecone","plum","podium","poppy","porcelain","prairie","prism","puma","pyramid","quail","quartz","quill","quilt","raccoon","radius","rafter","raven","reef","resin","rhino","riddle","sage","sailor","salamander","sapphire","savanna","saxophone","scallop","scarab","schooner","sequoia","serpent","shale","shimmer","sierra","silhouette","silver","skylark","sleet","sloth","sparrow","spruce","starling","stucco","sundial","surge","swallow","swamp","swift","taiga","talon","tapestry","tarantula","teak","tempest","terrace","thistle","thunder","tide","timber","toucan","trail","trout","tsunami","tulip","tundra","turquoise","twilight","umbrella","valley","vapor","velvet","verdant","violet","volcano","vulture","waffle","wagon","walrus","wander","whisker","willow","wren","yacht","zephyr","zinc","zipper","zodiac"
  ];

  function randInt(n) {
    if (n <= 0) return 0;
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0] % n;
  }

  function randBool() {
    return randInt(2) === 0;
  }

  function pick(pool) {
    return pool[randInt(pool.length)];
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = randInt(i + 1);
      const t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }

  function filterAmbiguous(pool, opts) {
    if (!opts.excludeAmbiguous) return pool;
    return pool.split("").filter((c) => !AMBIGUOUS.includes(c)).join("");
  }

  // Task 1 — build the character pool from the class toggles.
  function classPool(name, opts) {
    return filterAmbiguous(opts[name] ? CLASSES[name] : "", opts);
  }

  function buildPool(opts) {
    let pool = "";
    if (opts.upper) pool += CLASSES.upper;
    if (opts.lower) pool += CLASSES.lower;
    if (opts.digits) pool += CLASSES.digits;
    if (opts.symbols) pool += CLASSES.symbols;
    pool = filterAmbiguous(pool, opts);
    if (opts.custom) pool += [...new Set(String(opts.custom))].join("");
    return pool;
  }

  function enabledClasses(opts) {
    return ["upper", "lower", "digits", "symbols"].filter((k) => opts[k]);
  }

  // Tasks 2 + 4 + 5 — exact length, minimum-per-class, no repeats.
  function generateRandom(o) {
    const pool = buildPool(o);
    if (!pool) return { error: "Selected classes produced an empty character pool." };

    const enabled = enabledClasses(o);
    if (o.noRepeat && o.length > pool.length) {
      return {
        error:
          "No-repeat mode needs at least " +
          o.length +
          " unique characters — enable more classes or reduce the length.",
      };
    }

    const result = [];
    const used = new Set();
    if (o.minEachClass) {
      for (const name of enabled) {
        const cp = classPool(name, o);
        if (!cp) continue;
        const c = pick(cp);
        result.push(c);
        if (o.noRepeat) used.add(c);
      }
    }

    while (result.length < o.length) {
      let c;
      let guard = 0;
      do {
        c = pick(pool);
        guard++;
      } while (o.noRepeat && used.has(c) && guard < 1000);
      if (o.noRepeat && used.has(c)) {
        return { error: "Could not fill a unique character set of this size." };
      }
      result.push(c);
      if (o.noRepeat) used.add(c);
    }

    shuffle(result);
    return { value: result.join(""), poolSize: pool.length };
  }

  // Task 6 — readable/pronounceable passwords (alternating consonant/vowel).
  function generatePronounceable(o) {
    const lettersOn = o.upper || o.lower;
    if (!lettersOn) return generateRandom(o);

    let vowels = filterAmbiguous(VOWELS, o).split("");
    let cons = filterAmbiguous(CONSONANTS, o).split("");
    if (vowels.length === 0 || cons.length === 0) return generateRandom(o);

    const applyCase = (c) => {
      if (o.upper && !o.lower) return c.toUpperCase();
      if (o.upper && o.lower) return randBool() ? c.toUpperCase() : c;
      return c;
    };

    const extras = [];
    if (o.digits) extras.push(classPool("digits", o));
    if (o.symbols) extras.push(classPool("symbols", o));
    if (o.custom) extras.push([...new Set(String(o.custom))].join(""));
    const extraPool = extras.filter(Boolean).join("");
    const extraCount = Math.max(extras.filter(Boolean).length, Math.min(3, Math.floor(o.length * 0.2)));

    for (let attempt = 0; attempt < 25; attempt++) {
      const letters = [];
      let wantVowel = randBool();
      for (let i = 0; i < o.length; i++) {
        letters.push(applyCase(wantVowel ? pick(vowels) : pick(cons)));
        wantVowel = !wantVowel;
      }

      // Sprinkle digits/symbols at random positions when enabled.
      const positions = shuffle([...letters.keys()]).slice(0, extraCount);
      const extrasUsed = new Set(extras.filter(Boolean).map((p) => pick(p)));
      for (const idx of positions) {
        letters[idx] = pick(extras.length ? extras[randInt(extras.length)] : extraPool);
      }

      let value = letters.join("");
      if (o.noRepeat) {
        if (new Set(value).size === value.length) {
          return { value, poolSize: poolSizeForPronounceable(o, vowels, cons, extras) };
        }
      } else {
        return { value, poolSize: poolSizeForPronounceable(o, vowels, cons, extras) };
      }
    }
    return {
      error:
        "Could not build a unique readable password of this length — enable more classes or shorten it.",
    };
  }

  function poolSizeForPronounceable(o, vowels, cons, extras) {
    const base = (vowels.length + cons.length) * (o.upper && o.lower ? 2 : 1);
    const extraSize = extras.filter(Boolean).reduce((n, p) => n + p.length, 0);
    return base + extraSize;
  }

  // ── Phase 2: passphrase engine ────────────────────────────────────────────

  function getWordList(name) {
    if (name === "technical") return WORD_TECHNICAL;
    if (name === "random") return WORD_RANDOM;
    return WORD_COMMON;
  }

  function injectionPool(type) {
    if (type === "digits") return INJECT_DIGITS;
    if (type === "symbols") return INJECT_SYMBOLS;
    if (type === "both") return INJECT_DIGITS + INJECT_SYMBOLS;
    return "";
  }

  // Tasks 7–11 — word lists, composition, separators, formatting, injection.
  function generatePassphrase(opts = {}) {
    const o = {
      wordList: "common",
      wordCount: 4,
      separator: "space", // space | hyphen | dot | none
      wordCase: "title", // title | upper | lower
      injectionType: "none", // none | digits | symbols | both
      injectionPosition: "end", // start | end | between | startEnd
      injectionCount: 2,
      ...opts,
    };
    const list = getWordList(o.wordList);
    const n = Math.min(12, Math.max(3, Math.floor(o.wordCount) || 3));
    const sepMap = { space: " ", hyphen: "-", dot: ".", none: "" };
    const sep = sepMap[o.separator] != null ? sepMap[o.separator] : " ";
    const pool = injectionPool(o.injectionType);
    const injCount = Math.min(4, Math.max(1, Math.floor(o.injectionCount) || 1));

    const format = (w) => {
      if (o.wordCase === "upper") return w.toUpperCase();
      if (o.wordCase === "lower") return w.toLowerCase();
      return w.charAt(0).toUpperCase() + w.slice(1);
    };

    const words = [];
    for (let i = 0; i < n; i++) words.push(format(pick(list)));

    const joinedWords = words.join(sep);
    let value = joinedWords;
    if (pool) {
      const tokens = [];
      for (let i = 0; i < injCount; i++) tokens.push(pick(pool));
      const inj = tokens.join("");
      if (o.injectionPosition === "start") value = inj + sep + joinedWords;
      else if (o.injectionPosition === "between") {
        const k = randInt(n - 1) + 1;
        value = words.slice(0, k).join(sep) + sep + inj + sep + words.slice(k).join(sep);
      } else if (o.injectionPosition === "startEnd") value = inj + sep + joinedWords + sep + inj;
      else value = joinedWords + sep + inj; // end (default)
    }

    let entropy = n * Math.log2(list.length);
    if (pool) entropy += injCount * Math.log2(pool.length);

    return { value, wordCount: n, dictionarySize: list.length, entropy };
  }

  // Main entry point.
  function generate(opts = {}) {
    const o = {
      length: 16,
      upper: true,
      lower: true,
      digits: true,
      symbols: false,
      excludeAmbiguous: false,
      minEachClass: true,
      noRepeat: false,
      pronounceable: false,
      custom: "",
      ...opts,
    };
    o.length = Math.min(MAX_LENGTH, Math.max(MIN_LENGTH, Math.floor(o.length) || MIN_LENGTH));

    const enabled = enabledClasses(o);
    if (enabled.length === 0 && !o.custom) return { error: "Select at least one character class." };

    const res = o.pronounceable ? generatePronounceable(o) : generateRandom(o);
    if (res.error) return res;
    const entropy = o.pronounceable ? res.poolSize : res.poolSize;
    return {
      value: res.value,
      poolSize: res.poolSize,
      entropy: entropyBits(res.poolSize, res.value.length),
    };
  }

  // Task 13 (Phase 3) — bits of entropy = length * log2(pool size).
  function entropyBits(poolSize, length) {
    return length * Math.log2(Math.max(1, poolSize));
  }

  // Task 14 (Phase 3) — strength classification shared by single + bulk UI.
  function strengthOf(bits) {
    if (bits < 50) return { label: "Weak", cls: "weak", pct: Math.max(6, (bits / 50) * 100) };
    if (bits < 75) return { label: "Good", cls: "good", pct: 50 + ((bits - 50) / 25) * 30 };
    if (bits < 100) return { label: "Strong", cls: "strong", pct: 80 + ((bits - 75) / 25) * 16 };
    return { label: "Excellent", cls: "excellent", pct: Math.min(100, 96 + ((bits - 100) / 60) * 4) };
  }

  // Task 12 (Phase 3) — batch generation, up to 50 items in one operation.
  function generateBatch({ type = "password", count = 10, ...options } = {}) {
    const n = Math.min(50, Math.max(1, Math.floor(count) || 1));
    const gen = type === "passphrase" ? generatePassphrase : generate;
    const items = [];
    for (let i = 0; i < n; i++) {
      const res = gen(options);
      if (res.error) return { error: res.error, items: [], count: 0, type };
      items.push({ value: res.value, entropy: res.entropy, poolSize: res.poolSize, wordCount: res.wordCount });
    }
    return { items, count: items.length, type };
  }

  // Task 15 (Phase 3) — session history (most recent first, capped).
  const HISTORY = [];
  const MAX_HISTORY = 50;
  function logHistory(entry) {
    HISTORY.unshift({ ...entry, ts: Date.now() });
    if (HISTORY.length > MAX_HISTORY) HISTORY.length = MAX_HISTORY;
  }
  function getHistory() {
    return HISTORY.slice();
  }
  function clearHistory() {
    HISTORY.length = 0;
  }
  function restoreHistory(entries) {
    HISTORY.length = 0;
    if (!Array.isArray(entries)) return;
    for (const e of entries) {
      if (e && typeof e.value === "string") {
        HISTORY.push({
          value: e.value,
          mode: e.mode === "passphrase" ? "passphrase" : "password",
          entropy: Number(e.entropy) || 0,
          ts: Number(e.ts) || Date.now(),
        });
      }
    }
    if (HISTORY.length > MAX_HISTORY) HISTORY.length = MAX_HISTORY;
  }

  function hasFrom(value, pool) {
    return [...value].some((c) => pool.includes(c));
  }

  // Roadmap validation tests for Phase 1 tasks 1–6.
  function runSelfTests() {
    const tests = [];
    const ok = (name, pass, detail) => tests.push({ name, pass, detail: String(detail) });

    // 1 — Character class control (digits only / uppercase only)
    let r = generate({ length: 20, upper: false, lower: false, digits: true, symbols: false });
    ok("1. Class control — digits only", !r.error && /^[0-9]{20}$/.test(r.value), r.value || r.error);
    r = generate({ length: 12, upper: true, lower: false, digits: false, symbols: false });
    ok("1b. Class control — uppercase only", !r.error && /^[A-Z]{12}$/.test(r.value), r.value || r.error);

    // 2 — Exact length constraint
    r = generate({ length: 8, upper: true, lower: true, digits: true, symbols: true });
    ok("2. Exact length 8", r.value.length === 8, r.value.length);
    r = generate({ length: 64, upper: true, lower: true, digits: true, symbols: true });
    ok("2b. Exact length 64", r.value.length === 64, r.value.length);
    r = generate({ length: 100, upper: true, lower: true, digits: true, symbols: true });
    ok("2c. Length clamps to 64", r.value.length === 64, r.value.length);

    // 3 — Ambiguous character filter
    r = generate({ length: 40, upper: true, lower: true, digits: true, symbols: true, excludeAmbiguous: true });
    const ambFound = [...r.value].filter((c) => AMBIGUOUS.includes(c));
    ok("3. Exclude ambiguous (0 O 1 l I)", !r.error && ambFound.length === 0, ambFound.join("") || "none found");

    // 4 — Minimum class distribution
    r = generate({ length: 16, upper: true, lower: true, digits: true, symbols: true, minEachClass: true });
    ok(
      "4. Min one per selected class",
      hasFrom(r.value, CLASSES.upper) && hasFrom(r.value, CLASSES.lower) && hasFrom(r.value, CLASSES.digits) && hasFrom(r.value, CLASSES.symbols),
      r.value
    );

    // 5 — No repeating characters
    r = generate({ length: 24, upper: true, lower: true, digits: true, symbols: true, noRepeat: true });
    ok("5. No repeating characters", !r.error && new Set(r.value).size === r.value.length, r.value || r.error);

    // 6 — Pronounceable / readable mode
    r = generate({ length: 16, upper: true, lower: true, digits: true, symbols: false, pronounceable: true });
    const isVowel = (c) => "aeiouAEIOU".includes(c);
    const isLetter = (c) => /[a-zA-Z]/.test(c);
    let alternating = r.value.length > 1;
    for (let i = 1; i < r.value.length; i++) {
      const a = r.value[i - 1], b = r.value[i];
      if (isLetter(a) && isLetter(b) && isVowel(a) === isVowel(b)) { alternating = false; break; }
    }
    ok("6. Pronounceable (alternating C/V)", !r.error && alternating, r.value || r.error);

    // ── Phase 2: passphrase engine (tasks 7–11) ────────────────────────────
    let p;

    // 7 — Word list integration (every word must come from the chosen list)
    for (const name of ["common", "technical", "random"]) {
      p = generatePassphrase({ wordList: name, wordCount: 6, separator: "space", wordCase: "lower", injectionType: "none" });
      const list = getWordList(name);
      const words = p.value.split(" ");
      ok("7. Word list — " + name, !p.error && words.length === 6 && words.every((w) => list.includes(w)), p.value);
    }

    // 8 — Passphrase composition (word count)
    p = generatePassphrase({ wordCount: 3, separator: "hyphen", injectionType: "none" });
    ok("8. Composition — 3 words", p.value.split("-").length === 3, p.value);
    p = generatePassphrase({ wordCount: 12, separator: "space", injectionType: "none" });
    ok("8b. Composition — 12 words", p.value.split(" ").length === 12, p.value.split(" ").length);
    p = generatePassphrase({ wordCount: 99, separator: "space", injectionType: "none" });
    ok("8c. Word count clamps to 12", p.value.split(" ").length === 12, p.value.split(" ").length);

    // 9 — Separator logic
    for (const [key, ch] of [["hyphen", "-"], ["dot", "."]]) {
      p = generatePassphrase({ wordCount: 5, separator: key, wordCase: "lower", injectionType: "none" });
      ok("9. Separator — " + key, p.value.split(ch).length === 5, JSON.stringify(p.value));
    }
    p = generatePassphrase({ wordCount: 5, separator: "none", wordCase: "lower", injectionType: "none" });
    ok("9. Separator — none", /^[a-z]{10,70}$/.test(p.value), JSON.stringify(p.value));

    // 10 — Word formatting
    p = generatePassphrase({ wordCount: 5, separator: "space", wordCase: "title", wordList: "common", injectionType: "none" });
    ok("10. Formatting — title", p.value.split(" ").every((w) => /^[A-Z][a-z]*$/.test(w)), p.value);
    p = generatePassphrase({ wordCount: 5, separator: "space", wordCase: "upper", injectionType: "none" });
    ok("10b. Formatting — upper", p.value.split(" ").every((w) => /^[A-Z]+$/.test(w)), p.value);
    p = generatePassphrase({ wordCount: 5, separator: "space", wordCase: "lower", injectionType: "none" });
    ok("10c. Formatting — lower", p.value.split(" ").every((w) => /^[a-z]+$/.test(w)), p.value);

    // 11 — Injection logic
    p = generatePassphrase({ wordCount: 4, separator: "hyphen", wordCase: "lower", injectionType: "digits", injectionPosition: "start", injectionCount: 3 });
    ok("11. Injection — digits at start", /^\d{3}-/.test(p.value), p.value);
    p = generatePassphrase({ wordCount: 4, separator: "hyphen", wordCase: "lower", injectionType: "digits", injectionPosition: "end", injectionCount: 2 });
    ok("11b. Injection — digits at end", /-\d{2}$/.test(p.value), p.value);
    p = generatePassphrase({ wordCount: 4, separator: "space", wordCase: "lower", injectionType: "symbols", injectionPosition: "between", injectionCount: 1 });
    const parts = p.value.split(" ");
    const mid = parts.findIndex((pt) => /[^A-Za-z]/.test(pt));
    ok("11c. Injection — symbol between words", parts.length === 5 && mid >= 1 && mid <= 3 && parts.every((pt, i) => (i === mid ? /^[^A-Za-z]+$/.test(pt) : /^[A-Za-z]+$/.test(pt))), p.value);
    p = generatePassphrase({ wordCount: 4, separator: "space", wordCase: "lower", injectionType: "both", injectionPosition: "startEnd", injectionCount: 2 });
    ok("11d. Injection — both, both ends", /^[0-9!@#$%^&*()\-_=+\[\]{};:,.<>?/]{2} [a-z ]+ [0-9!@#$%^&*()\-_=+\[\]{};:,.<>?/]{2}$/.test(p.value), p.value);

    // ── Phase 3: batch, entropy, strength, history (tasks 12–15) ──────────
    let b;

    // 12 — Batch generation (up to 50)
    b = generateBatch({ type: "password", count: 50, length: 12, upper: true, lower: true, digits: true, symbols: false });
    ok("12. Batch — 50 items", !b.error && b.count === 50 && b.items.length === 50 && b.items.every((i) => i.value.length === 12), b.count);
    b = generateBatch({ type: "passphrase", count: 100, wordCount: 4, separator: "hyphen", injectionType: "digits" });
    ok("12b. Batch — clamps to 50", !b.error && b.count === 50 && b.items.length === 50, b.count);
    b = generateBatch({ type: "password", count: 1, length: 8, upper: true, lower: true, digits: true, symbols: false });
    ok("12c. Batch — single item", !b.error && b.count === 1 && b.items[0].value.length === 8, JSON.stringify(b.items));
    b = generateBatch({ type: "password", count: 5, length: 16, upper: false, lower: false, digits: false, symbols: false });
    ok("12d. Batch — config error propagates", b.error != null && b.items.length === 0, b.error || "no error");

    // 13 — Entropy calculation (pool * length, per-string)
    r = generate({ length: 8, upper: false, lower: false, digits: true, symbols: false });
    const expected13 = 8 * Math.log2(10);
    ok("13. Entropy — 8 digits ≈ 26.6 bits", Math.abs(r.entropy - expected13) < 1e-9, r.entropy.toFixed(4) + " vs " + expected13.toFixed(4));
    p = generatePassphrase({ wordCount: 5, wordList: "common", injectionType: "none" });
    const expPhrase = 5 * Math.log2(Passgen.getWordList("common").length);
    ok("13b. Entropy — passphrase = n·log2(dict)", Math.abs(p.entropy - expPhrase) < 1e-9, p.entropy.toFixed(4) + " vs " + expPhrase.toFixed(4));

    // 14 — Strength meter classification
    const s14 = [strengthOf(30).cls, strengthOf(60).cls, strengthOf(85).cls, strengthOf(130).cls];
    ok("14. Strength — weak/good/strong/excellent", JSON.stringify(s14) === JSON.stringify(["weak", "good", "strong", "excellent"]), s14.join(","));
    ok("14b. Strength — monotonically increasing meter", strengthOf(30).pct < strengthOf(60).pct && strengthOf(60).pct < strengthOf(85).pct && strengthOf(85).pct < strengthOf(130).pct, [strengthOf(30).pct, strengthOf(60).pct, strengthOf(85).pct, strengthOf(130).pct].join(","));

    // 15 — Generation history (session log, most recent first, capped)
    clearHistory();
    for (let i = 0; i < 3; i++) logHistory({ value: "h" + i, mode: "password", entropy: 50 + i });
    ok("15. History — records entries", getHistory().length === 3 && getHistory()[0].value === "h2", JSON.stringify(getHistory().map((h) => h.value)));
    for (let i = 0; i < 60; i++) logHistory({ value: "x" + i, mode: "password", entropy: 60 });
    ok("15b. History — capped at 50, newest first", getHistory().length === 50 && getHistory()[0].value === "x59", getHistory().length + " / " + getHistory()[0].value);
    clearHistory();
    ok("15c. History — clear works", getHistory().length === 0, getHistory().length);

    // ── Post-roadmap extras: custom character sets ─────────────────────────
    r = generate({ length: 12, upper: false, lower: false, digits: false, symbols: false, custom: "X" });
    ok("E1. Custom charset — custom-only pool", !r.error && /^X{12}$/.test(r.value), r.value || r.error);
    const rNo = generate({ length: 16, upper: true, lower: true, digits: true, symbols: true });
    const rYes = generate({ length: 16, upper: true, lower: true, digits: true, symbols: true, custom: "ÆØÅ" });
    ok("E2. Custom charset — raises pool entropy", rYes.entropy > rNo.entropy, rYes.entropy.toFixed(2) + " > " + rNo.entropy.toFixed(2));
    const allowedE = new Set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()-_=+[]{};:,.<>?/ÆØÅ");
    ok("E3. Custom charset — output only from allowed chars", [...rYes.value].every((c) => allowedE.has(c)), rYes.value);

    return tests;
  }

  return {
    MIN_LENGTH,
    MAX_LENGTH,
    CLASSES,
    AMBIGUOUS,
    generate,
    generatePassphrase,
    generateBatch,
    strengthOf,
    entropyBits,
    getWordList,
    injectionPool,
    logHistory,
    getHistory,
    clearHistory,
    restoreHistory,
    MAX_HISTORY,
    runSelfTests,
  };
})();
