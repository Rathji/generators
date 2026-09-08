// SillyTavern Interop — self-test suite.
// Runs against the LIVE plugin namespace. Self-contained: all fixtures are
// reconstructed inline (no files needed), PNGs are crafted programmatically.
//
// Usage (from the demo page or a page_eval):
//   import("./src/tests.js").then(m => m.runTests(root.stistInteropNamespace(), root))
//   .then(res => console.log(res.passed + " passed, " + res.failed + " failed"));
//
// runTests(ns, root) -> { passed, failed, results: [{name, ok, detail?}] }
// `root` is passed for test-only access to internal sti* helpers (chunk
// crafting, etc.) which are intentionally NOT on the public namespace.

export async function runTests(ns, root) {
  const results = [];
  const thrownCodes = new Set();

  function test(name, fn) {
    return (async () => {
      try {
        await fn();
        results.push({ name, ok: true });
        return true;
      } catch (e) {
        results.push({ name, ok: false, detail: e && e.message ? e.message : String(e) });
        return false;
      }
    })();
  }

  function eq(a, b) {
    if (a === b) return true;
    if (a == null || b == null) return false;
    if (typeof a !== "object" || typeof b !== "object") return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
    if (ka.length !== kb.length) return false;
    for (let i = 0; i < ka.length; i++) {
      if (ka[i] !== kb[i]) return false;
      if (!eq(a[ka[i]], b[ka[i]])) return false;
    }
    return true;
  }

  function deepEq(name, a, b) {
    if (!eq(a, b)) throw new Error("deep equality failed");
  }

  async function throws(fn, code) {
    try { await fn(); } catch (e) {
      if (e && e.code) thrownCodes.add(e.code);
      if (e && e.code === code) return;
      throw new Error("expected error code " + code + " but got " + (e && e.code ? e.code : "no code: " + e));
    }
    throw new Error("expected error code " + code + " but nothing threw");
  }

  // ── tiny helpers ──────────────────────────────────────────────────────
  const utf8 = (s) => new TextEncoder().encode(s);
  const latin1 = (s) => Uint8Array.from(s.split("").map((c) => c.charCodeAt(0) & 0xFF));
  function concat(...parts) {
    let n = 0; for (const p of parts) n += p.length;
    const out = new Uint8Array(n); let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }
  // Rebuild a PNG: keep all chunks of base except tEXt/iTXt chara/ccv3, then append addChunks before IEND.
  function buildPNG(basePNG, addChunks) {
    const parsed = root.stiparsePNGChunks(basePNG);
    let iend = null; const others = [];
    for (const c of parsed) {
      const kw = (c.type === "tEXt" || c.type === "iTXt") ? root.stichunkKeyword(c).toLowerCase() : "";
      if (c.type === "IEND") iend = c;
      else if (c.type === "tEXt" && (kw === "chara" || kw === "ccv3")) { /* drop */ }
      else others.push(c);
    }
    if (!iend) throw new Error("no IEND in base PNG");
    const out = others.map((c) => root.stiencodeChunkBytes(c.type, c.data));
    for (const a of addChunks) out.push(root.stiencodeChunkBytes(a.type, a.data));
    out.push(root.stiencodeChunkBytes("IEND", iend.data));
    return root.sticoncatPNGChunks(out);
  }
  const tEXt = (kw, text) => ({ type: "tEXt", data: concat(latin1(kw), [0], utf8(text)) });
  async function iTXt(kw, text) {
    const comp = await new Response(
      new Blob([utf8(text)]).stream().pipeThrough(new CompressionStream("deflate"))
    ).arrayBuffer();
    return { type: "iTXt", data: concat(latin1(kw), [0, 1, 0, 0, 0], new Uint8Array(comp)) };
  }
  async function buildBasePNG() {
    return ns.cardToPNG(ns.fromV1({ name: "Base", description: "base" }));
  }

  // ── fixtures ──────────────────────────────────────────────────────────
  const V2 = {
    spec: "chara_card_v2", spec_version: "2.0",
    data: {
      name: "Seraphine", description: "A siren of the deep.", personality: "Charming, teasing.",
      scenario: "The moonlit harbor.", first_mes: "*She surfaces beside your boat.*",
      mes_example: "<START>\n{{user}}: Ahoy\n{{char}}: *a low laugh*", creator_notes: { text: "handmade", note: 1 },
      system_prompt: "", post_history_instructions: "",
      alternate_greetings: ["Hello, sailor.", "The tide turns."],
      tags: ["mermaid", "siren"], creator: "Me", character_version: "1.0",
      extensions: { fav: true, talkativeness: 0.7, world: { z: 1 }, myext: { a: 1 } },
      character_book: { name: "Harbor", entries: [{ keys: ["harbor"], content: "The harbor's secrets." }] },
      unknown_field: "kept"
    }
  };
  const V3 = {
    spec: "chara_card_v3", spec_version: "3.0",
    data: {
      name: "Zara", description: "A wanderer.", personality: "", scenario: "", first_mes: "",
      mes_example: "", creator_notes: "", system_prompt: "", post_history_instructions: "",
      alternate_greetings: [], tags: [], creator: { name: "Ann", version: "2.0", notes: "n", extra: 1 },
      assets: [{ type: "background", uri: "u://x" }], extensions: {}
    }
  };
  const LEGACY_LORE = {
    name: "World", description: "legacy",
    entries: [{
      key: "kw", keysecondary: "sk", order: 3, disable: false, content: "c", comment: "cm",
      selective: true, constant: false, position: 0, uid: 7, excludeRecursion: true,
      probability: 0.5, useProbability: true, depth: 2, matchWholeWords: true,
      caseSensitive: true, matchPersonaDescription: true, customLegacy: "x"
    }]
  };
  const CHAT = [
    '{"chat_metadata":{"something":"yes"}}',
    '{"name":"Narrator","is_user":false,"is_system":true,"send_date":"2020-01-01T00:00:00.000Z","mes":"The sun rises.","swipes":["The moon sets."],"swipe_info":{"index":0},"extra":{"foo":"bar"},"custom":"keep"}',
    '{"name":"User","is_user":true,"is_name":true,"mes":"hello there"}'
  ].join("\n");

  // ══ 1. base64 ══
  await test("b64: unicode roundtrip (emoji/CJK/quotes/newlines)", () => {
    const s = 'héllo "world"\n🌊 海 {[|]} \\end\t\u0000null';
    if (ns.b64decode(ns.b64encode(s)) !== s) throw new Error("roundtrip mismatch");
  });
  await test("b64: large payload (200k) chunked roundtrip", () => {
    const s = "x".repeat(200000) + "🌊";
    if (ns.b64decode(ns.b64encode(s)) !== s) throw new Error("large roundtrip mismatch");
  });
  await test("b64: invalid characters → E_BASE64", async () => {
    await throws(() => ns.b64decode("!!!not-base64!!!"), "E_BASE64");
  });
  await test("b64: empty → E_BASE64", async () => {
    await throws(() => ns.b64decode("   "), "E_BASE64");
  });

  // ══ 2. detectSpec ══
  await test("detectSpec: v1/v2/v3 classification", () => {
    if (ns.detectSpec({ name: "x", description: "y" }) !== "v1") throw new Error("v1");
    if (ns.detectSpec(V2) !== "v2") throw new Error("v2");
    if (ns.detectSpec(V3) !== "v3") throw new Error("v3");
  });
  await test("detectSpec: unknown spec → E_CARD_SPEC", async () => {
    await throws(() => ns.detectSpec({ spec: "chara_card_v9", data: {} }), "E_CARD_SPEC");
  });
  await test("detectSpec: non-object → E_CARD_SHAPE", async () => {
    await throws(() => ns.detectSpec(42), "E_CARD_SHAPE");
    await throws(() => ns.detectSpec([]), "E_CARD_SHAPE");
  });

  // ══ 3. canonical shapes ══
  await test("v1: flat → canonical with defaults + legacy", () => {
    const c = ns.fromV1({ name: "Bob", avatar: "u://a", chat: "c", create_date: "d", tags: "a, b" });
    if (c.name !== "Bob") throw new Error("name");
    if (c.description !== "" || c.scenario !== "" || c.talkativeness !== 0.5 || c.fav !== false) throw new Error("defaults");
    if (c.tags.join(",") !== "a,b") throw new Error("tags split");
    if (c.legacy.avatar !== "u://a" || c.legacy.chat !== "c" || c.legacy.create_date !== "d") throw new Error("legacy");
  });
  await test("v2: creator_notes object → text; extensions preserved", () => {
    const c = ns.fromV2(V2);
    if (c.creator_notes !== "handmade") throw new Error("creator_notes");
    if (c.extensions.world.z !== 1 || c.extensions.myext.a !== 1) throw new Error("extensions");
    if (c.legacy.unknown_field !== "kept") throw new Error("legacy unknown");
  });
  await test("v2: talkativeness/fav lifted from extensions", () => {
    const c = ns.fromV2(V2);
    if (c.talkativeness !== 0.7 || c.fav !== true) throw new Error("lifted");
    if ("talkativeness" in c.extensions || "fav" in c.extensions) throw new Error("not removed");
  });
  await test("v3: creator object → name + preserved object/assets", () => {
    const c = ns.fromV3(V3);
    if (c.creator !== "Ann") throw new Error("creator name");
    if (c.legacy.creatorObject.name !== "Ann" || c.legacy.creatorObject.extra !== 1) throw new Error("creatorObject");
    if (c.legacy.assets.length !== 1 || c.legacy.assets[0].type !== "background") throw new Error("assets");
    const v3 = ns.toV3(c);
    if (v3.data.creator.name !== "Ann" || v3.data.creator.extra !== 1) throw new Error("creator re-serialized");
    if (v3.data.assets[0].uri !== "u://x") throw new Error("assets re-serialized");
  });

  // ══ 4. roundtrip stability ══
  await test("v2: full roundtrip stability (with tags + book + unknown)", async () => {
    const c1 = ns.fromV2(V2);
    const back = ns.fromV2(JSON.parse(JSON.stringify(ns.toV2(c1))));
    deepEq("v2 roundtrip", back, c1);
  });
  await test("v3: full roundtrip stability", async () => {
    const c1 = ns.fromV3(V3);
    const back = ns.fromV3(JSON.parse(JSON.stringify(ns.toV3(c1))));
    deepEq("v3 roundtrip", back, c1);
  });
  await test("v1: comma-tags roundtrip stability", async () => {
    const src = { name: "B", description: "d", personality: "p", scenario: "s", first_mes: "f", tags: "mermaid,siren", avatar: "u://a" };
    const c1 = ns.fromV1(src);
    const back = ns.fromV1(JSON.parse(JSON.stringify(ns.toV1(c1))));
    deepEq("v1 roundtrip", back, c1);
  });
  await test("toV2 accepts canonical/raw/parse-result", () => {
    const c = ns.fromV2(V2);
    if (ns.toV2(c).data.name !== "Seraphine") throw new Error("canonical");
    if (ns.toV2(V2).data.name !== "Seraphine") throw new Error("raw");
    if (ns.toV2({ spec: "v2", canonical: c, original: V2 }).data.name !== "Seraphine") throw new Error("parse result");
  });
  await test("cardToJSON: valid JSON with correct spec", () => {
    const o = JSON.parse(ns.cardToJSON(ns.fromV2(V2), "v2"));
    if (o.spec !== "chara_card_v2" || o.data.name !== "Seraphine") throw new Error("v2 json");
    const o1 = JSON.parse(ns.cardToJSON(ns.fromV2(V2), "v1"));
    if (o1.tags !== "mermaid,siren" || o1.avatar !== undefined) throw new Error("v1 json");
  });

  // ══ 5. parseCharacter ══
  await test("parseCharacter: v1/v2 JSON strings", async () => {
    const p1 = await ns.parseCharacter(JSON.stringify({ name: "A", description: "b" }));
    if (p1.spec !== "v1" || p1.source !== "json" || p1.canonical.name !== "A") throw new Error("v1");
    const p2 = await ns.parseCharacter(JSON.stringify(V2));
    if (p2.spec !== "v2" || p2.canonical.name !== "Seraphine") throw new Error("v2");
    if (!p2.original || p2.original.spec !== "chara_card_v2") throw new Error("original");
  });
  await test("parseCharacter: garbage → E_JSON", async () => {
    await throws(() => ns.parseCharacter("this is {not json"), "E_JSON");
  });
  await test("parseCharacter: empty → E_EMPTY", async () => {
    await throws(() => ns.parseCharacter("   "), "E_EMPTY");
    await throws(() => ns.parseCharacter(null), "E_EMPTY");
  });

  // ══ 6. PNG ══
  await test("cardToPNG → parseCharacter roundtrip (placeholder portrait)", async () => {
    const png = await ns.cardToPNG(ns.fromV2(V2));
    if (!root.stiisPNG(png)) throw new Error("not a PNG");
    const p = await ns.parseCharacter(png);
    if (p.source !== "png" || p.canonical.name !== "Seraphine") throw new Error("parse");
    if (!p.portrait || p.portrait.slice(0, 22) !== "data:image/png;base64,") throw new Error("portrait");
    if (p.spec !== "v3") throw new Error("ccv3 (v3) chunk should win on re-parse, got " + p.spec);
  });
  await test("PNG: ccv3 tEXt takes precedence over chara", async () => {
    const base = await buildBasePNG();
    const cardA = { spec: "chara_card_v2", spec_version: "2.0", data: { name: "Alpha", description: "from chara" } };
    const cardB = { spec: "chara_card_v3", spec_version: "3.0", data: { name: "Beta", description: "from ccv3" } };
    const png = buildPNG(base, [tEXt("chara", ns.b64encode(JSON.stringify(cardA))), tEXt("ccv3", ns.b64encode(JSON.stringify(cardB)))]);
    const p = await ns.parseCharacter(png);
    if (p.canonical.name !== "Beta") throw new Error("ccv3 should win, got " + p.canonical.name);
  });
  await test("PNG: iTXt ccv3 (zlib) read + precedence over chara", async () => {
    const base = await buildBasePNG();
    const cardC = { spec: "chara_card_v2", spec_version: "2.0", data: { name: "iTXtCard", description: "from itxt" } };
    const it = await iTXt("ccv3", ns.b64encode(JSON.stringify(cardC)));
    const png = buildPNG(base, [tEXt("chara", ns.b64encode(JSON.stringify({ spec: "chara_card_v2", spec_version: "2.0", data: { name: "Old", description: "x" } }))), it]);
    const p = await ns.parseCharacter(png);
    if (p.canonical.name !== "iTXtCard") throw new Error("iTXt ccv3 should win, got " + p.canonical.name);
  });
  await test("PNG: no card chunk → E_NO_CARD_CHUNK", async () => {
    const base = await buildBasePNG();
    const png = buildPNG(base, [tEXt("Comment", "hello world")]);
    await throws(() => ns.parseCharacter(png), "E_NO_CARD_CHUNK");
  });
  await test("PNG: bad CRC → E_PNG_CRC", async () => {
    const base = await buildBasePNG();
    const parsed = root.stiparsePNGChunks(base);
    const idat = parsed.find((c) => c.type === "IDAT");
    const enc = root.stiencodeChunkBytes("IDAT", idat.data);
    enc[10] ^= 0xFF; // corrupt a data byte (chunk data starts at offset 8) but keep length/type/CRC
    const rebuilt = parsed
      .filter((c) => c !== idat && c.type !== "IEND")
      .map((c) => root.stiencodeChunkBytes(c.type, c.data));
    rebuilt.push(enc);
    const iend = parsed.find((c) => c.type === "IEND");
    rebuilt.push(root.stiencodeChunkBytes("IEND", iend.data));
    await throws(() => ns.parseCharacter(root.sticoncatPNGChunks(rebuilt)), "E_PNG_CRC");
  });
  await test("PNG: truncated → E_PNG_TRUNCATED", async () => {
    const base = await buildBasePNG();
    await throws(() => ns.parseCharacter(base.slice(0, Math.floor(base.length / 2))), "E_PNG_TRUNCATED");
  });
  await test("PNG: JPEG portrait coerced to PNG", async () => {
    const cv = document.createElement("canvas"); cv.width = 48; cv.height = 48;
    const jpeg = await new Promise((res) => cv.toBlob(res, "image/jpeg"));
    const png = await ns.cardToPNG(ns.fromV1({ name: "J", description: "d" }), { image: jpeg });
    if (!root.stiisPNG(png)) throw new Error("should be PNG after coercion");
    const p = await ns.parseCharacter(png);
    if (p.canonical.name !== "J") throw new Error("parse after coercion");
  });
  await test("extractPNGText: lists chara + ccv3", async () => {
    const base = await buildBasePNG();
    const png = await ns.cardToPNG(ns.fromV2(V2));
    const list = await ns.extractPNGText(png);
    const kws = list.map((c) => c.keyword.toLowerCase()).sort();
    if (kws.indexOf("chara") < 0 || kws.indexOf("ccv3") < 0) throw new Error("keywords: " + kws.join(","));
  });
  await test("extractPNGText: non-PNG → E_PNG_MAGIC", async () => {
    await throws(() => ns.extractPNGText(new Uint8Array([1, 2, 3])), "E_PNG_MAGIC");
  });
  await test("PNG: iTXt chara/ccv3 stripped on rewrite (no duplicates)", async () => {
    const base = await buildBasePNG();
    const it = await iTXt("ccv3", ns.b64encode(JSON.stringify(V2)));
    const png1 = buildPNG(base, [it]);
    const png2 = await ns.cardToPNG(await ns.parseCharacter(png1)); // rewrite keeps portrait
    const list = await ns.extractPNGText(png2);
    const ccv3 = list.filter((c) => c.keyword.toLowerCase() === "ccv3");
    if (ccv3.length !== 1) throw new Error("expected exactly 1 ccv3 after rewrite, got " + ccv3.length);
  });

  // ══ 7. lorebook ══
  await test("lorebook: modern parse → canonical entries", async () => {
    const b = await ns.parseLorebook(JSON.stringify({ name: "B", entries: [{ keys: ["k1"], content: "c1", comment: "hi", priority: 20, use_regex: true }] }));
    if (b.name !== "B" || b.entries.length !== 1) throw new Error("shape");
    const en = b.entries[0];
    if (en.keys[0] !== "k1" || en.content !== "c1" || en.comment !== "hi") throw new Error("fields");
    if (en.priority !== 20 || en.use_regex !== true || en.enabled !== true) throw new Error("fields2");
  });
  await test("lorebook: modern roundtrip stability", async () => {
    const src = { name: "B", description: "d", scan_depth: 6, token_budget: 900, recursive_scanning: true, extensions: { x: 1 }, entries: [{ keys: ["a", "b"], secondary_keys: ["c"], content: "body", enabled: true, insertion_order: 12, case_sensitive: true, selective: false, constant: true, position: "after_char", name: "E", comment: "cm", priority: 30, id: 99, extensions: { y: 2 } }] };
    const b = await ns.parseLorebook(JSON.stringify(src));
    const out = JSON.parse(ns.lorebookToJSON(b));
    const b2 = await ns.parseLorebook(JSON.stringify(out));
    deepEq("lorebook roundtrip", b2, b);
  });
  await test("lorebook: legacy entry mapped to modern shape", async () => {
    const b = await ns.parseLorebook(JSON.stringify(LEGACY_LORE));
    const en = b.entries[0];
    if (en.keys[0] !== "kw" || en.secondary_keys[0] !== "sk") throw new Error("keys");
    if (en.insertion_order !== 3 || en.enabled !== true || en.position !== "before_char" || en.id !== 7) throw new Error("mapping");
    if (en.extensions.exclude_recursion !== true || en.extensions.probability !== 0.5 || en.extensions.match_whole_words !== true || en.extensions.match_persona_description !== true) throw new Error("extensions");
    if (en.extensions.position !== 0) throw new Error("legacy position kept in extensions");
    if (en.legacy.customLegacy !== "x") throw new Error("legacy bucket");
  });
  await test("lorebook: legacy → out keeps everything (no legacy wrapper)", async () => {
    const b = await ns.parseLorebook(JSON.stringify(LEGACY_LORE));
    const out = JSON.parse(ns.lorebookToJSON(b));
    const en = out.entries[0];
    if ("legacy" in en) throw new Error("legacy key leaked");
    if (en.customLegacy !== "x") throw new Error("legacy field dropped");
    if (en.insertion_order !== 3 || en.position !== "before_char") throw new Error("mapping in out");
  });
  await test("lorebook: missing entries → E_NO_ENTRIES", async () => {
    await throws(() => ns.parseLorebook('{"name":"x"}'), "E_NO_ENTRIES");
  });
  await test("lorebook: not an object → E_LOREBOOK_SHAPE", async () => {
    await throws(() => ns.parseLorebook("[1,2]"), "E_LOREBOOK_SHAPE");
  });
  await test("lorebook: PNG input → E_WRONG_TYPE", async () => {
    const base = await buildBasePNG();
    await throws(() => ns.parseLorebook(base), "E_WRONG_TYPE");
  });
  await test("character_book: extract + attach (clean ST shape)", async () => {
    const c = ns.fromV2(V2);
    const book = ns.characterBookFromCard(c);
    if (!book || book.name !== "Harbor" || book.entries[0].keys[0] !== "harbor") throw new Error("extract");
    const lore = await ns.parseLorebook(JSON.stringify({ name: "Attached", entries: [{ keys: ["z"], content: "zc" }], customTop: "keep" }));
    const c2 = ns.attachCharacterBook(ns.fromV1({ name: "X", description: "d" }), lore);
    const v2 = ns.toV2(c2);
    const cb = v2.data.character_book;
    if (cb.name !== "Attached" || cb.customTop !== "keep") throw new Error("book legacy folded");
    if (cb.entries[0].keys[0] !== "z" || cb.entries[0].content !== "zc") throw new Error("entry fields");
    if ("legacy" in cb.entries[0]) throw new Error("entry legacy leaked");
  });

  // ══ 8. chat ══
  await test("chat: parse roles + metadata + preservation", async () => {
    const c = await ns.parseChat(CHAT);
    if (c.count !== 2 || c.metadata.chat_metadata.something !== "yes") throw new Error("meta");
    const [m0, m1] = c.messages;
    if (m0.role !== "system" || m0.is_system !== true || m0.mes !== "The sun rises.") throw new Error("system");
    if (m0.swipes[0] !== "The moon sets." || m0.swipe_info.index !== 0 || m0.extra.foo !== "bar") throw new Error("swipes");
    if (m0.legacy.custom !== "keep") throw new Error("legacy");
    if (m1.role !== "user" || m1.is_user !== true || m1.mes !== "hello there" || m1.name !== "User") throw new Error("user");
  });
  await test("chat: jsonl roundtrip stability", async () => {
    const c1 = await ns.parseChat(CHAT);
    const c2 = await ns.parseChat(ns.chatToJSONL(c1));
    if (!eq(c1.metadata, c2.metadata)) throw new Error("metadata");
    if (c2.messages.length !== c1.messages.length) throw new Error("count");
    for (let i = 0; i < c1.messages.length; i++) {
      if (!eq(c1.messages[i], c2.messages[i])) throw new Error("message " + i);
    }
  });
  await test("chat: malformed line → E_JSONL_LINE with line number", async () => {
    try { await ns.parseChat('{"a":1}\n{"b":2}\nnot json\n'); }
    catch (e) {
      if (e.code !== "E_JSONL_LINE") throw new Error("wrong code " + e.code);
      if (e.message.indexOf("3") < 0) throw new Error("line number missing: " + e.message);
      return;
    }
    throw new Error("should have thrown");
  });
  await test("chat: empty file → 0 messages, no error", async () => {
    const c = await ns.parseChat("");
    if (c.count !== 0 || c.messages.length !== 0 || c.metadata !== null) throw new Error("empty");
    if (ns.chatToJSONL(c) !== "") throw new Error("empty jsonl");
  });
  await test("chat: PNG input → E_WRONG_TYPE", async () => {
    const base = await buildBasePNG();
    await throws(() => ns.parseChat(base), "E_WRONG_TYPE");
  });
  await test("chatToPrompt: system separate, speakers resolved", async () => {
    const c = await ns.parseChat(CHAT);
    const p = ns.chatToPrompt(c);
    if (p.system.length !== 1 || p.system[0].speaker !== "system" || p.system[0].text !== "The sun rises.") throw new Error("system");
    if (p.messages.length !== 1 || p.messages[0].speaker !== "User" || p.messages[0].text !== "hello there") throw new Error("messages");
  });

  // ══ 9. pjs ══
  await test("toPjs: escapes all brackets/backslashes/newlines → fromPjs roundtrip", async () => {
    const nasty = {
      name: "R[1]y {X} \\ Y", description: "line1\r\nline2 [b] }c{",
      personality: "a{b", scenario: "c]d", first_mes: "back\\slash",
      mes_example: "", creator_notes: "", system_prompt: "", post_history_instructions: "",
      alternate_greetings: ["hi]there", "bye{now"], tags: ["t1", "t2"]
    };
    const c = ns.fromV1(nasty);
    const tree = ns.fromPjs(ns.toPjs(c));
    const g = (p) => tree.character[p].evaluateItem;
    if (g("name") !== nasty.name) throw new Error("name: " + JSON.stringify(g("name")));
    if (g("description") !== "line1\nline2 [b] }c{") throw new Error("description: " + JSON.stringify(g("description")));
    if (g("personality") !== "a{b" || g("scenario") !== "c]d" || g("firstMes") !== "back\\slash") throw new Error("fields");
  });
  await test("toPjsLorebook → fromPjs", async () => {
    const b = await ns.parseLorebook(JSON.stringify({ name: "Book [1]", entries: [{ keys: ["k"], name: "Entry {A}", content: "c1 }x]" }] }));
    const tree = ns.fromPjs(ns.toPjsLorebook(b));
    if (tree.lorebook.name.evaluateItem !== "Book [1]") throw new Error("name");
    const lines = tree.lorebook.entries.selectAll.map((it) => it.evaluateItem);
    if (lines.length !== 1 || lines[0] !== "Entry {A}: c1 }x]") throw new Error("entry lines: " + JSON.stringify(lines));
  });
  await test("toPjsChat → fromPjs", async () => {
    const c = await ns.parseChat(CHAT);
    const tree = ns.fromPjs(ns.toPjsChat(c));
    const lines = tree.chat.selectAll.map((it) => it.evaluateItem);
    if (lines.length !== 2) throw new Error("count");
    if (lines[0] !== "system: The sun rises." || lines[1] !== "user: hello there") throw new Error("lines: " + JSON.stringify(lines));
  });
  await test("fromPjs: empty → E_PJS", async () => {
    await throws(() => ns.fromPjs("   "), "E_PJS");
    await throws(() => ns.fromPjs(""), "E_PJS");
  });

  // ══ 10. error-code registry ══
  await test("errors.codes: every thrown code is registered", () => {
    const codes = ns.errors.codes;
    if (!Array.isArray(codes) || codes.length < 20) throw new Error("registry too small");
    for (const c of thrownCodes) {
      if (codes.indexOf(c) < 0) throw new Error("unregistered code: " + c);
    }
  });

  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  return { passed, failed, results };
}
