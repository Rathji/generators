(function () {
  const KB = 1024;
  const MB = 1024 * KB;
  const EDITABLE_MAX = 5 * MB;
  const DEFAULT_BUDGET = Math.floor(2.5 * MB);
  const ENVELOPE_OVERHEAD = 700;
  const HISTORY_CAP = 20;
  const HISTORY_BYTES = 8 * MB;
  const DEFAULT_MODULES = ["companies", "contacts", "leads", "deals", "activities", "reports"];

  function fnv1a(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }

  function tokenFrom(idStr) {
    const s = String(idStr == null ? "" : idStr);
    const a = (fnv1a(s + "::a") >>> 0).toString(16).padStart(8, "0");
    const b = (fnv1a(s + "::b") >>> 0).toString(16).padStart(8, "0");
    return (a + b).slice(0, 12);
  }

  function randHex(n) {
    const arr = new Uint8Array(n);
    if (globalThis.crypto && crypto.getRandomValues) crypto.getRandomValues(arr);
    else for (let i = 0; i < n; i++) arr[i] = Math.floor(Math.random() * 256);
    let out = "";
    for (let i = 0; i < arr.length; i++) out += arr[i].toString(16).padStart(2, "0");
    return out.slice(0, n);
  }

  function digestHex(text) {
    try {
      if (globalThis.crypto && crypto.subtle) {
        return crypto.subtle
          .digest("SHA-256", new TextEncoder().encode(text))
          .then(buf => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join(""));
      }
    } catch (e) {}
    let h1 = fnv1a(text);
    let h2 = fnv1a(text + "\u0001");
    for (let i = 0; i < 4; i++) {
      h2 ^= h1;
      h2 = Math.imul(h2, 0x01000193) >>> 0;
      h1 = Math.imul(h1 ^ (h2 >>> 15), 0x85ebca6b) >>> 0;
    }
    return "f" + h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
  }

  function dateValueOf(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === "string") {
      const t = Date.parse(v);
      return isNaN(t) ? null : t;
    }
    if (typeof v === "number" && isFinite(v)) {
      if (v >= 1e12) return v;
      if (v >= 1e9) return v * 1000;
      return null;
    }
    return null;
  }

  function fieldValue(rec, path) {
    if (!rec || typeof rec !== "object" || Array.isArray(rec)) return undefined;
    if (!path) return undefined;
    const parts = String(path).split(".");
    let cur = rec;
    for (const p of parts) {
      if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
      cur = cur[p];
    }
    return cur;
  }

  function recordDateMs(rec, field) {
    const v = fieldValue(rec, field);
    if (v === null || v === undefined) return null;
    return dateValueOf(v);
  }

  function collectArchiveMatches(content, field, beforeMs) {
    const recs = Array.isArray(content && content.records) ? content.records : [];
    const matches = [];
    for (const r of recs) {
      if (!r || typeof r !== "object" || Array.isArray(r)) continue;
      const d = recordDateMs(r, field);
      if (d !== null && d < beforeMs) matches.push(r);
    }
    return matches;
  }

  function utf8Bytes(text) {
    try {
      return new TextEncoder().encode(text === null || text === undefined ? "" : String(text)).length;
    } catch (e) {
      return String(text === null || text === undefined ? "" : text).length;
    }
  }

  function deepEqual(a, b) {
    if (a === b) return true;
    if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
      return true;
    }
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (const k of ka) {
      if (!(k in b)) return false;
      if (!deepEqual(a[k], b[k])) return false;
    }
    return true;
  }

  function normalizePluginError(err) {
    if (!err) return null;
    const e = typeof err === "string" ? err : err.message || String(err);
    const low = e.toLowerCase();
    if (low.indexOf("key") !== -1) return "no_edit_key";
    if (low.indexOf("saved") !== -1) return "requires_saved_generator";
    if (low.indexOf("large") !== -1 || low.indexOf("big") !== -1) return "file_too_big";
    if (low.indexOf("allowance") !== -1 || low.indexOf("quota") !== -1) return "over_daily_allowance";
    return "editable_error";
  }

  function splitRecords(arr) {
    const map = new Map();
    const anon = [];
    for (const r of arr || []) {
      if (r && typeof r === "object" && !Array.isArray(r) && r.id !== undefined) {
        const k = String(r.id);
        if (!map.has(k)) map.set(k, r);
      } else {
        anon.push(r);
      }
    }
    return { map, anon };
  }

  function sideOf(m, t, b, pick) {
    if (pick === "mine" || pick === "theirs") return pick;
    if (deepEqual(m, t)) return "mine";
    if (b !== undefined && deepEqual(m, b)) return "theirs";
    if (b !== undefined && deepEqual(t, b)) return "mine";
    return "mine";
  }

  function mergePairFields(m, t, b, pickMap) {
    const fields = {};
    const keys = new Set([...Object.keys(m), ...Object.keys(t)]);
    for (const k of keys) {
      const mHas = k in m;
      const tHas = k in t;
      if (!tHas) { fields[k] = m[k]; continue; }
      if (!mHas) { fields[k] = t[k]; continue; }
      const pick = pickMap ? pickMap[k] : undefined;
      const bv = b && k in b ? b[k] : undefined;
      const side = sideOf(m[k], t[k], bv, pick);
      fields[k] = side === "mine" ? m[k] : t[k];
    }
    return fields;
  }

  function mergeRecordArrays(mineA, theirsA, baseA, pickRec) {
    const mine = splitRecords(mineA);
    const theirs = splitRecords(theirsA);
    const base = splitRecords(baseA || []);
    const out = [];
    const seen = new Set();
    const pushMerged = (id, item) => {
      if (seen.has(id)) return;
      seen.add(id);
      out.push(item);
    };
    for (const id of base.map.keys()) {
      const m = mine.map.get(id);
      const t = theirs.map.get(id);
      if (!m && !t) continue;
      if (m && t) {
        pushMerged(id, deepEqual(m, t) ? t : mergePairFields(m, t, base.map.get(id), pickRec ? pickRec[id] : undefined));
      } else {
        pushMerged(id, m || t);
      }
    }
    for (const [id, m] of mine.map) if (!theirs.map.has(id)) pushMerged(id, m);
    for (const [id, t] of theirs.map) if (!mine.map.has(id)) pushMerged(id, t);
    const maxAnon = Math.max(mine.anon.length, theirs.anon.length, base.anon.length);
    for (let i = 0; i < maxAnon; i++) {
      const m = mine.anon[i];
      const t = theirs.anon[i];
      const b = base.anon[i];
      const key = "__anon" + i;
      if (m && t) pushMerged(key, deepEqual(m, t) ? t : mergePairFields(m, t, b, pickRec ? pickRec[key] : undefined));
      else if (m) pushMerged(key, m);
      else if (t) pushMerged(key, t);
    }
    return out;
  }

  function mergeContent(rec, picks) {
    picks = picks || {};
    picks.top = picks.top || {};
    picks.recs = picks.recs || {};
    const base = (rec.base && rec.base.content) || {};
    const mine = rec.mine.content;
    const theirs = rec.theirs.content;
    const out = {};
    const hasMineRecords = Array.isArray(mine && mine.records);
    const hasTheirsRecords = Array.isArray(theirs && theirs.records);
    const bothRecords = hasMineRecords && hasTheirsRecords;
    const topKeys = new Set([...Object.keys(mine || {}), ...Object.keys(theirs || {}), ...Object.keys(base || {})]);
    for (const key of topKeys) {
      if (key === "records" && bothRecords) continue;
      const mHas = mine && key in mine;
      const tHas = theirs && key in theirs;
      if (!mHas && !tHas) continue;
      if (!tHas) { out[key] = mine[key]; continue; }
      if (!mHas) { out[key] = theirs[key]; continue; }
      const m = mine[key];
      const t = theirs[key];
      const b = base && key in base ? base[key] : undefined;
      const side = sideOf(m, t, b, picks.top[key]);
      out[key] = side === "mine" ? m : t;
    }
    if (bothRecords) {
      out.records = mergeRecordArrays(mine.records, theirs.records, base.records, picks.recs);
    } else if (hasMineRecords || hasTheirsRecords) {
      const m = hasMineRecords ? mine.records : undefined;
      const t = hasTheirsRecords ? theirs.records : undefined;
      const b = base.records;
      const side = sideOf(m, t, b, picks.top.records);
      out.records = side === "mine" ? m : t;
    }
    return out;
  }

  function computeMergeDiff(rec) {
    const base = (rec.base && rec.base.content) || {};
    const mine = rec.mine.content;
    const theirs = rec.theirs.content;
    const top = [];
    const recDiff = { mineOnly: [], theirsOnly: [], changed: [] };
    const hasMineRecords = Array.isArray(mine && mine.records);
    const hasTheirsRecords = Array.isArray(theirs && theirs.records);
    const bothRecords = hasMineRecords && hasTheirsRecords;
    const topKeys = new Set([...Object.keys(mine || {}), ...Object.keys(theirs || {})]);
    for (const key of topKeys) {
      if (key === "records" && bothRecords) continue;
      const mHas = mine && key in mine;
      const tHas = theirs && key in theirs;
      if (mHas && tHas && deepEqual(mine[key], theirs[key])) continue;
      if (!tHas) { top.push({ key, only: "mine", mine: mine[key] }); continue; }
      if (!mHas) { top.push({ key, only: "theirs", theirs: theirs[key] }); continue; }
      const m = mine[key];
      const t = theirs[key];
      const b = base && key in base ? base[key] : undefined;
      const conflict = !(b !== undefined && deepEqual(m, b)) && !(b !== undefined && deepEqual(t, b));
      top.push({ key, conflict, mine: m, theirs: t });
    }
    if (bothRecords) {
      const mineR = splitRecords(mine.records);
      const theirsR = splitRecords(theirs.records);
      for (const [id, m] of mineR.map) if (!theirsR.map.has(id)) recDiff.mineOnly.push({ id: id, record: m });
      for (const [id, t] of theirsR.map) if (!mineR.map.has(id)) recDiff.theirsOnly.push({ id: id, record: t });
      const baseR = splitRecords(base.records);
      for (const [id, m] of mineR.map) {
        const t = theirsR.map.get(id);
        if (!t) continue;
        if (deepEqual(m, t)) continue;
        const b = baseR.map.get(id);
        const fields = [];
        const keys = new Set([...Object.keys(m), ...Object.keys(t)]);
        for (const k of keys) {
          const mHas = k in m;
          const tHas = k in t;
          if (!mHas) { fields.push({ key: k, only: "theirs", theirs: t[k] }); continue; }
          if (!tHas) { fields.push({ key: k, only: "mine", mine: m[k] }); continue; }
          if (deepEqual(m[k], t[k])) continue;
          const bv = b && k in b ? b[k] : undefined;
          const conflict = !(bv !== undefined && deepEqual(m[k], bv)) && !(bv !== undefined && deepEqual(t[k], bv));
          fields.push({ key: k, conflict, mine: m[k], theirs: t[k] });
        }
        recDiff.changed.push({ id: id, anon: false, fields, record: m });
      }
      const maxAnon = Math.max(mineR.anon.length, theirsR.anon.length);
      for (let i = 0; i < maxAnon; i++) {
        const m = mineR.anon[i];
        const t = theirsR.anon[i];
        if (!m && !t) continue;
        if (m && !t) { recDiff.mineOnly.push({ id: "__anon" + i, anon: true, record: m }); continue; }
        if (t && !m) { recDiff.theirsOnly.push({ id: "__anon" + i, anon: true, record: t }); continue; }
        if (deepEqual(m, t)) continue;
        const fields = [];
        const keys = new Set([...Object.keys(m), ...Object.keys(t)]);
        for (const k of keys) {
          const mHas = k in m;
          const tHas = k in t;
          if (!mHas) { fields.push({ key: k, only: "theirs", theirs: t[k] }); continue; }
          if (!tHas) { fields.push({ key: k, only: "mine", mine: m[k] }); continue; }
          if (deepEqual(m[k], t[k])) continue;
          fields.push({ key: k, conflict: true, mine: m[k], theirs: t[k] });
        }
        recDiff.changed.push({ id: "__anon" + i, anon: true, fields, record: m });
      }
    }
    return { top, records: recDiff };
  }

  function createStore(opts) {
    opts = opts || {};
    const ns = opts.ns || "";
    const modules = (opts.modules && opts.modules.slice()) || DEFAULT_MODULES.slice();
    const kv = opts.kv;
    const editable = opts.editable;
    const budget = Math.max(2000, opts.budget || DEFAULT_BUDGET);
    const ceiling = opts.ceiling || EDITABLE_MAX;
    const softCap = Math.max(1500, Math.floor(budget) - ENVELOPE_OVERHEAD);
    const hardMax = Math.max(softCap, Math.floor(ceiling * 0.88) - ENVELOPE_OVERHEAD);
    const token = opts.token || tokenFrom(typeof window !== "undefined" ? window.generatorPublicId || window.generatorName || "bcrm" : "bcrm");
    const genName = opts.generatorName || (typeof window !== "undefined" ? window.generatorName : null);
    const q = ns || "__main__";

    const K_META = "meta";
    const kDoc = m => "doc:" + q + ":" + m;
    const kKey = n => "editkey:" + q + ":" + n;
    const kSync = m => "sync:" + q + ":" + m;
    const kLedger = m => "ledger:" + q + ":" + m;
    const kConflict = m => "conflict:" + q + ":" + m;
    const kHistory = m => "history:" + q + ":" + m;
    const kRecon = "recon:" + q;

    function fileName(module) {
      return ["bcrm", module, ns ? "x" + ns : null, token].filter(Boolean).join("-");
    }
    function partName(module, k) {
      return fileName(module) + "-p" + k;
    }
    function fileUrl(module) {
      return genName ? "https://editable.uploads.dev/file/" + genName + "/" + fileName(module) : null;
    }
    function bkpHeadName(module) {
      return ["bcrm", "bkp", module, ns ? "x" + ns : null, token].filter(Boolean).join("-");
    }
    function bkpPartName(module, k) {
      return bkpHeadName(module) + "-p" + k;
    }
    function bkpIndexName() {
      return ["bcrm", "bkp", "index", ns ? "x" + ns : null, token].filter(Boolean).join("-");
    }
    function archiveIndexName(module) {
      return ["bcrm", "arc", module, ns ? "x" + ns : null, token].filter(Boolean).join("-");
    }
    function archiveBatchName(module, no) {
      return archiveIndexName(module) + "-b" + no;
    }
    function archiveBatchPartName(module, no, k) {
      return archiveBatchName(module, no) + "-p" + k;
    }

    function defaultContent() {
      return { records: [] };
    }

    function parseHead(text, module, expectK) {
      expectK = expectK || "bcrmdoc";
      let h;
      try {
        h = JSON.parse(text);
      } catch (e) {
        return { error: { ok: false, state: "corrupt", code: "corrupt_head", detail: "document is not valid JSON" } };
      }
      const markerLabel = expectK === "bcrmdoc" ? "bcrmdoc" : "archive";
      if (!h || h.k !== expectK) return { error: { ok: false, state: "corrupt", code: "corrupt_head", detail: "document is missing the " + markerLabel + " marker" } };
      if (h.module !== module || h.v !== 1) return { error: { ok: false, state: "corrupt", code: "schema_mismatch", detail: `expected module "${module}" v1; found "${h.module}" v${h.v}` } };
      return { head: h };
    }

    function parsePart(text, module, partNum) {
      let p;
      try {
        p = JSON.parse(text);
      } catch (e) {
        return { error: { ok: false, state: "corrupt", code: "corrupt_part", detail: `part p${partNum} is not valid JSON` } };
      }
      if (!p || p.k !== "bcrmpart" || p.module !== module || p.part !== partNum) {
        return { error: { ok: false, state: "corrupt", code: "corrupt_part", detail: `part p${partNum} failed validation` } };
      }
      return { content: p.content };
    }

    function mergeParts(headContent, partContents) {
      let c = headContent;
      if (partContents.length) {
        let recs = Array.isArray(c && c.records) ? c.records.slice() : [];
        for (const p of partContents) recs = recs.concat(Array.isArray(p && p.records) ? p.records : []);
        c = Object.assign({}, c, { records: recs });
      }
      return c;
    }

    function splitByRecords(content) {
      if (!Array.isArray(content.records)) return null;
      const recs = content.records;
      const base = Object.assign({}, content);
      delete base.records;
      const baseText = JSON.stringify(Object.assign({}, base, { records: [] }));
      if (baseText.length > softCap) return null;
      const groups = [];
      let group = [];
      let groupLen = 2;
      for (const r of recs) {
        const t = JSON.stringify(r);
        if (group.length && groupLen + t.length + 1 > softCap) {
          groups.push(group);
          group = [];
          groupLen = 2;
        }
        if (t.length > hardMax) return null;
        group.push(r);
        groupLen += t.length + 1;
      }
      if (group.length) groups.push(group);
      if (!groups.length) groups.push([]);
      return {
        headContent: Object.assign({}, base, { records: groups[0] }),
        partContents: groups.slice(1).map(g => ({ records: g }))
      };
    }

    async function kvGet(key) {
      if (!kv) return undefined;
      try {
        return await kv.get(key);
      } catch (e) {
        return undefined;
      }
    }
    async function kvSet(key, val) {
      if (!kv) return false;
      try {
        await kv.set(key, val);
        return true;
      } catch (e) {
        return false;
      }
    }
    async function kvDel(key) {
      if (!kv) return;
      try {
        await kv.delete(key);
      } catch (e) {}
    }

    async function getMeta() {
      let m = await kvGet(K_META);
      if (!m || !m.deviceId) {
        m = { store: "bcrm", schema: 1, deviceId: randHex(10), createdAt: new Date().toISOString() };
        await kvSet(K_META, m);
      }
      return m;
    }

    function readRaw(name) {
      return editable.get(name).then(
        text => ({ text: text === undefined ? null : text }),
        err => ({ error: { ok: false, state: "error", code: "read_failed", detail: (err && err.message) || String(err) } })
      );
    }

    function readHeadRaw(module) {
      return readRaw(fileName(module));
    }

    async function readFileset(module, hNameFn, pNameFn, what, expectK) {
      const raw = await readRaw(hNameFn(module));
      if (raw.error) return raw.error;
      if (raw.text === null) return { ok: false, state: "none" };
      if (typeof raw.text === "string" && raw.text.trim() === "") {
        return { ok: false, state: "corrupt", code: "corrupt_head", detail: what + " is empty" };
      }
      const parsed = parseHead(raw.text, module, expectK);
      if (parsed.error) return parsed.error;
      const h = parsed.head;
      const partContents = [];
      if (h.parts > 1) {
        const texts = await Promise.all(
          Array.from({ length: h.parts - 1 }, (_, i) => i + 2).map(k =>
            editable.get(pNameFn(module, k)).then(t => t, () => null)
          )
        );
        for (let i = 0; i < texts.length; i++) {
          const t = texts[i];
          const partNum = i + 2;
          if (t === null || t === undefined) return { ok: false, state: "corrupt", code: "corrupt_part", detail: `part p${partNum} is missing` };
          const pp = parsePart(t, module, partNum);
          if (pp.error) return pp.error;
          partContents.push(pp.content);
        }
      }
      const content = mergeParts(h.content, partContents);
      const sha = await digestHex(JSON.stringify(content));
      if (sha !== h.sha) return { ok: false, state: "corrupt", code: "corrupt_sha", detail: what + " failed its content-hash check" };
      return { ok: true, state: "canonical", content, revision: h.revision, updatedAt: h.updatedAt, updatedBy: h.updatedBy, parts: h.parts, sha: h.sha };
    }

    async function readDoc(module) {
      return readFileset(module, fileName, partName, "canonical document");
    }

    async function readBkpDoc(module) {
      return readFileset(module, bkpHeadName, bkpPartName, "published backup document");
    }

    function cacheDoc(module, doc) {
      return kvSet(kDoc(module), {
        content: doc.content,
        revision: doc.revision,
        updatedAt: doc.updatedAt,
        updatedBy: doc.updatedBy,
        parts: doc.parts,
        lastText: doc.lastText !== undefined ? doc.lastText : JSON.stringify(doc.content),
        syncedAt: new Date().toISOString(),
        syncRevision: doc.revision
      });
    }

    async function loadDoc(module, opts) {
      opts = opts || {};
      const ledger = await kvGet(kLedger(module));
      if (ledger && ledger.content) {
        return { ok: true, state: "dirty", content: ledger.content, revision: ledger.baseRevision, dirty: true, stagedAt: ledger.stagedAt };
      }
      const cache = await kvGet(kDoc(module));
      if (cache && cache.content && !opts.refresh) {
        return { ok: true, state: "cache", content: cache.content, revision: cache.revision, syncedAt: cache.syncedAt };
      }
      const remote = await readDoc(module);
      if (remote.ok) {
        if (cache && cache.revision > remote.revision && Date.now() - new Date(cache.syncedAt || 0).getTime() < 15000) {
          return { ok: true, state: "cache", content: cache.content, revision: cache.revision, syncedAt: cache.syncedAt, note: "canonical read may lag this device's recent write" };
        }
        await cacheDoc(module, remote);
        return { ok: true, state: "canonical", content: remote.content, revision: remote.revision, updatedAt: remote.updatedAt, updatedBy: remote.updatedBy };
      }
      if (cache && cache.content) {
        if (opts.refresh && remote.state !== "none") return remote;
        return { ok: true, state: "cache", content: cache.content, revision: cache.revision, syncedAt: cache.syncedAt };
      }
      if (remote.state === "none") return { ok: true, state: "none", content: defaultContent(), revision: 0 };
      return remote;
    }

    function recentCache(cache) {
      return cache && cache.syncedAt && Date.now() - new Date(cache.syncedAt).getTime() < 15000;
    }

    async function syncDoc(module) {
      const cache = await kvGet(kDoc(module));
      const remote = await readDoc(module);
      if (remote.ok) {
        if (cache && cache.revision === remote.revision) {
          return { state: "synced", module, revision: cache.revision };
        }
        if (cache && cache.revision > remote.revision) {
          if (recentCache(cache)) return { state: "synced", module, revision: cache.revision, note: "server read may lag the most recent local write" };
          return { state: "diverged", module, revision: cache.revision, remoteRevision: remote.revision };
        }
        await cacheDoc(module, remote);
        return { state: "synced", module, revision: remote.revision, pulled: true };
      }
      if (remote.state === "none") {
        if (cache) return { state: "local_only", module, revision: cache.revision };
        return { state: "none", module };
      }
      return { state: remote.state, module, code: remote.code, detail: remote.detail };
    }

    let lastSyncResult = null;
    let syncPromise = null;
    let bootPromise = null;

    async function setLedger(module, o) {
      const meta = await getMeta();
      const led = { content: o.content, baseRevision: o.baseRevision, stagedAt: new Date().toISOString(), deviceId: meta.deviceId };
      await kvSet(kLedger(module), led);
      return led;
    }

    async function clearLedger(module) {
      await kvDel(kLedger(module));
    }

    async function materializeConflict(module, ledger, remote) {
      const existing = await kvGet(kConflict(module));
      const cache = await kvGet(kDoc(module));
      let baseContent;
      if (cache && cache.content && cache.revision === ledger.baseRevision) baseContent = cache.content;
      else if (ledger.baseRevision === 0) baseContent = defaultContent();
      else baseContent = remote.ok ? remote.content : defaultContent();
      if (
        existing &&
        existing.base.revision === ledger.baseRevision &&
        existing.theirs.revision === remote.revision &&
        deepEqual(existing.mine.content, ledger.content) &&
        deepEqual(existing.theirs.content, remote.ok ? remote.content : null)
      ) {
        return existing;
      }
      const rec = {
        conflictId: module + "-" + Date.now().toString(36) + randHex(4),
        module,
        detectedAt: new Date().toISOString(),
        base: { revision: ledger.baseRevision, content: baseContent },
        mine: { content: ledger.content, stagedAt: ledger.stagedAt, revision: ledger.baseRevision },
        theirs: remote.ok ? { content: remote.content, revision: remote.revision, updatedAt: remote.updatedAt, updatedBy: remote.updatedBy } : { content: null, revision: 0 },
        resolution: null
      };
      await kvSet(kConflict(module), rec);
      return rec;
    }

    async function ensureConflict(module, ledger, remote) {
      if (!remote.ok) {
        const rec = {
          conflictId: module + "-" + Date.now().toString(36) + randHex(4),
          module,
          detectedAt: new Date().toISOString(),
          base: { revision: ledger.baseRevision, content: (await kvGet(kDoc(module)) || {}).content || defaultContent() },
          mine: { content: ledger.content, stagedAt: ledger.stagedAt, revision: ledger.baseRevision },
          theirs: { content: null, revision: 0 },
          resolution: null
        };
        await kvSet(kConflict(module), rec);
        return rec;
      }
      return materializeConflict(module, ledger, remote);
    }

    async function writeCanonical(module, split, info) {
      const canonicalText = info.canonicalText || JSON.stringify(split.partContents.length ? mergeParts(split.headContent, split.partContents) : split.headContent);
      const sha = await digestHex(canonicalText);
      const headName = fileName(module);
      const parts = split.partContents;
      for (let i = 0; i < parts.length; i++) {
        const pn = partName(module, i + 2);
        const body = JSON.stringify({ k: "bcrmpart", v: 1, module, ns, part: i + 2, content: parts[i] });
        const pKey = await kvGet(kKey(pn));
        const res = await editable.set(pn, body, pKey ? { editKey: pKey } : {});
        if (res && res.error) return { ok: false, code: normalizePluginError(res.error), detail: String(res.error) };
        if (res && res.editKey && !pKey) await kvSet(kKey(pn), res.editKey);
      }
      if (info.remotePresent) {
        const raw = await readHeadRaw(module);
        if (raw.error) return raw.error;
        if (raw.text === null) return { ok: false, code: "conflict_stale", detail: "the canonical document disappeared while saving" };
        const parsed = parseHead(raw.text, module);
        if (parsed.error) return parsed.error;
        if (parsed.head.revision !== info.expectedRemoteRev) {
          return { ok: false, code: "conflict_stale", detail: `the canonical ${module} document moved to revision ${parsed.head.revision} while saving (expected ${info.expectedRemoteRev})` };
        }
      }
      const base = { k: "bcrmdoc", v: 1, module, ns, revision: info.revision, updatedAt: info.updatedAt, updatedBy: info.updatedBy, parts: parts.length + 1, sha };
      const headBody = JSON.stringify(Object.assign({}, base, { content: split.headContent }));
      const cachedKey = await kvGet(kKey(headName));
      const headRes = await editable.set(headName, headBody, cachedKey ? { editKey: cachedKey } : {});
      if (headRes && headRes.error) return { ok: false, code: normalizePluginError(headRes.error), detail: String(headRes.error) };
      if (headRes && headRes.editKey && !cachedKey) await kvSet(kKey(headName), headRes.editKey);
      return { ok: true, revision: info.revision, parts: parts.length + 1, canonicalText };
    }

    async function tryPublish(module, content, info) {
      const split = splitByRecords(content);
      if (!split) {
        const text = JSON.stringify(content);
        return { ok: false, code: "doc_too_large", size: text.length, detail: `This ${module} document is ${(text.length / MB).toFixed(2)} MiB — too large to store safely, and it has no records array to split across part files.` };
      }
      const canonical = split.partContents.length ? mergeParts(split.headContent, split.partContents) : split.headContent;
      const canonicalText = JSON.stringify(canonical);
      const meta = await getMeta();
      const updatedAt = new Date().toISOString();
      const updatedBy = meta.deviceId;
      const res = await writeCanonical(module, split, {
        revision: info.revision,
        expectedRemoteRev: info.expectedRemoteRev,
        remotePresent: info.remotePresent,
        canonicalText,
        updatedAt,
        updatedBy
      });
      if (!res.ok) return res;
      return { ok: true, revision: res.revision, parts: res.parts, canonicalText, updatedAt, updatedBy };
    }

    async function saveDoc(module, content) {
      try {
        if (!content || typeof content !== "object" || Array.isArray(content)) {
          return { ok: false, code: "bad_content", detail: "module content must be a JSON object" };
        }
        const text = JSON.stringify(content);
        const split = splitByRecords(content);
        if (!split) {
          return { ok: false, code: "doc_too_large", size: text.length, detail: `This ${module} document is ${(text.length / MB).toFixed(2)} MiB — too large to store safely, and it has no records array to split across part files.` };
        }
        const canonical = split.partContents.length ? mergeParts(split.headContent, split.partContents) : split.headContent;
        const canonicalText = JSON.stringify(canonical);
        const cache = await kvGet(kDoc(module));
        const headName = fileName(module);
        const cachedKey = await kvGet(kKey(headName));
        const raw = await readHeadRaw(module);
        if (raw.error) return raw.error;

        let remoteRev = 0;
        let remotePresent = false;
        if (raw.text !== null) {
          const parsed = parseHead(raw.text, module);
          if (parsed.error) return parsed.error;
          remotePresent = true;
          remoteRev = parsed.head.revision;
        }

        if (cache && cache.lastText === canonicalText && remoteRev <= (cache.revision || 0)) {
          return { ok: true, noop: true, revision: cache.revision, state: "canonical" };
        }
        if (remotePresent && !cachedKey) {
          return { ok: false, code: "no_edit_key", detail: `This device has no write key for the ${module} document. Restore from a backup to claim ownership, or work from the device that created it.` };
        }
        if (remotePresent && remoteRev > (cache ? cache.revision || 0 : 0)) {
          return { ok: false, code: "conflict_stale", detail: `The canonical ${module} document is at revision ${remoteRev}; this device last synced at revision ${cache ? cache.revision : 0}. Nothing was overwritten.` };
        }

        const revision = Math.max(cache ? cache.revision || 0 : 0, remoteRev) + 1;
        const meta = await getMeta();
        const updatedAt = new Date().toISOString();
        const updatedBy = meta.deviceId;

        const res = await writeCanonical(module, split, { revision, expectedRemoteRev: remoteRev, remotePresent, canonicalText, updatedAt, updatedBy });
        if (!res.ok) return res;

        await cacheDoc(module, { content, revision, updatedAt, updatedBy, parts: res.parts, lastText: canonicalText });
        lastSyncResult = lastSyncResult || {};
        lastSyncResult[module] = { state: "synced", module, revision };
        return { ok: true, revision, created: !remotePresent, parts: res.parts };
      } catch (e) {
        return { ok: false, code: "save_failed", detail: (e && e.message) || String(e) };
      }
    }

    async function saveChecked(module, content, opts) {
      opts = opts || {};
      try {
        if (!content || typeof content !== "object" || Array.isArray(content)) {
          return { ok: false, code: "bad_content", detail: "module content must be a JSON object" };
        }
        const expectedBase = opts.expectedBase;
        if (typeof expectedBase !== "number" || !isFinite(expectedBase) || expectedBase < 0) {
          return { ok: false, code: "expected_base_required", detail: "saveChecked needs opts.expectedBase — the revision the content was loaded from (loadDoc returns it)" };
        }
        const cache = await kvGet(kDoc(module));
        const ledger = await kvGet(kLedger(module));
        if (ledger && ledger.content && ledger.baseRevision !== expectedBase) {
          return { ok: false, code: "base_mismatch", detail: `a staged edit already exists at base revision ${ledger.baseRevision}, not ${expectedBase}` };
        }
        const remote = await readDoc(module);
        if (!remote.ok && remote.state !== "none") return remote;
        const remotePresent = remote.ok;
        const remoteRev = remote.ok ? remote.revision : 0;

        if (remotePresent && expectedBase < remoteRev) {
          const st = await setLedger(module, { content, baseRevision: expectedBase });
          const rec = await ensureConflict(module, st, remote);
          return { ok: false, code: "conflict", conflict: rec, detail: `The canonical ${module} document advanced to revision ${remoteRev} after this edit was made at revision ${expectedBase}. Nothing was overwritten.` };
        }
        if (remotePresent && expectedBase > remoteRev) {
          if (cache && cache.content && deepEqual(remote.content, cache.content) && cache.revision >= remoteRev && recentCache(cache)) {
            return { ok: true, noop: true, revision: cache.revision, state: "synced", note: "this document was already saved; the server read is lagging behind" };
          }
          return { ok: false, code: "server_lag", detail: "the canonical document currently reads older than this edit's base revision; retry in a few seconds" };
        }
        if (!remotePresent && expectedBase !== 0) {
          return { ok: false, code: "doc_missing", detail: `the canonical ${module} document no longer exists, but this edit was based on revision ${expectedBase}` };
        }
        if (remotePresent && deepEqual(remote.content, content)) {
          return { ok: true, noop: true, revision: remoteRev, state: "synced" };
        }
        if (remotePresent) {
          const headKey = await kvGet(kKey(fileName(module)));
          if (!headKey) {
            return { ok: false, code: "no_edit_key", detail: `This device has no write key for the ${module} document. Restore from a backup to claim ownership, or work from the device that created it.` };
          }
        }
        const st = await setLedger(module, { content, baseRevision: expectedBase });
        const res = await tryPublish(module, content, { revision: expectedBase + 1, expectedRemoteRev: remotePresent ? remoteRev : 0, remotePresent });
        if (res.ok) {
          await clearLedger(module);
          await cacheDoc(module, { content, revision: res.revision, updatedAt: res.updatedAt, updatedBy: res.updatedBy, parts: res.parts, lastText: res.canonicalText });
          lastSyncResult = lastSyncResult || {};
          lastSyncResult[module] = { state: "synced", module, revision: res.revision };
          return { ok: true, revision: res.revision, created: !remotePresent && expectedBase === 0, parts: res.parts };
        }
        if (res.code === "conflict_stale") {
          const rr = await readDoc(module);
          const rec = await ensureConflict(module, st, rr.ok ? rr : remote);
          return { ok: false, code: "conflict", conflict: rec, detail: "the document changed while saving; nothing was overwritten" };
        }
        if (res.code === "no_edit_key" || res.code === "corrupt_head" || res.code === "schema_mismatch" || res.code === "doc_too_large") {
          await clearLedger(module);
          return res;
        }
        await clearLedger(module);
        return res;
      } catch (e) {
        return { ok: false, code: "save_failed", detail: (e && e.message) || String(e) };
      }
    }

    async function stageEdit(module, content) {
      try {
        if (!content || typeof content !== "object" || Array.isArray(content)) {
          return { ok: false, code: "bad_content", detail: "module content must be a JSON object" };
        }
        const remote = await readDoc(module);
        if (!remote.ok && remote.state !== "none") return remote;
        const base = remote.ok ? remote.revision : 0;
        if (remote.ok && deepEqual(remote.content, content)) {
          return { ok: true, noop: true, state: "synced", revision: base };
        }
        const ledger = await kvGet(kLedger(module));
        if (ledger && ledger.content) {
          if (ledger.baseRevision !== base) return { ok: false, code: "base_mismatch", detail: "a staged edit exists at a different base revision" };
          await setLedger(module, { content, baseRevision: base });
          return { ok: true, state: "pending", baseRevision: base };
        }
        const st = await setLedger(module, { content, baseRevision: base });
        return { ok: true, state: "pending", baseRevision: base, staged: st };
      } catch (e) {
        return { ok: false, code: "save_failed", detail: (e && e.message) || String(e) };
      }
    }

    async function reconcileDoc(module) {
      const ledger = await kvGet(kLedger(module));
      if (!ledger || !ledger.content) return syncDoc(module);
      const remote = await readDoc(module);
      if (!remote.ok) {
        if (remote.state === "none") {
          const res = await tryPublish(module, ledger.content, { revision: 1, expectedRemoteRev: 0, remotePresent: false });
          if (res.ok) {
            await clearLedger(module);
            await cacheDoc(module, { content: ledger.content, revision: 1, updatedAt: res.updatedAt, updatedBy: res.updatedBy, parts: res.parts, lastText: res.canonicalText });
            return { state: "synced", module, revision: 1, published: true };
          }
          return { state: "error", module, code: res.code, detail: res.detail };
        }
        return { state: remote.state, module, code: remote.code, detail: remote.detail };
      }
      if (remote.revision < ledger.baseRevision) {
        const cache = await kvGet(kDoc(module));
        if (cache && cache.content && deepEqual(remote.content, cache.content) && recentCache(cache)) {
          await clearLedger(module);
          return { state: "synced", module, revision: cache.revision, note: "server read lagged behind this device's last write" };
        }
        return { state: "pending", module, code: "server_lag", detail: "the canonical document reads older than the staged edit's base; sync will retry automatically" };
      }
      if (remote.revision === ledger.baseRevision) {
        if (deepEqual(remote.content, ledger.content)) {
          await clearLedger(module);
          return { state: "synced", module, revision: remote.revision };
        }
        const res = await tryPublish(module, ledger.content, { revision: remote.revision + 1, expectedRemoteRev: remote.revision, remotePresent: true });
        if (res.ok) {
          await clearLedger(module);
          await cacheDoc(module, { content: ledger.content, revision: res.revision, updatedAt: res.updatedAt, updatedBy: res.updatedBy, parts: res.parts, lastText: res.canonicalText });
          return { state: "synced", module, revision: res.revision, published: true };
        }
        if (res.code === "conflict_stale") {
          const rr = await readDoc(module);
          if (rr.ok) await ensureConflict(module, ledger, rr);
          return { state: "conflict", module, baseRevision: ledger.baseRevision, remoteRevision: rr.ok ? rr.revision : 0 };
        }
        return { state: "error", module, code: res.code, detail: res.detail };
      }
      if (deepEqual(remote.content, ledger.content)) {
        await clearLedger(module);
        await cacheDoc(module, remote);
        return { state: "synced", module, revision: remote.revision, pulled: true, note: "both sides made identical changes" };
      }
      await ensureConflict(module, ledger, remote);
      return { state: "conflict", module, baseRevision: ledger.baseRevision, remoteRevision: remote.revision };
    }

    async function reconcileAll() {
      const results = {};
      for (const m of modules) {
        try {
          results[m] = await reconcileDoc(m);
        } catch (e) {
          results[m] = { state: "error", module: m, code: "reconcile_failed", detail: (e && e.message) || String(e) };
        }
      }
      lastSyncResult = results;
      await kvSet(kRecon, { at: new Date().toISOString() });
      return results;
    }

    async function boot() {
      await getMeta();
      await reconcileAll();
      return { ok: true };
    }

    async function pushHistory(module, rec, ev) {
      let h = await kvGet(kHistory(module));
      h = Array.isArray(h) ? h : [];
      h.unshift({
        conflictId: rec.conflictId,
        module,
        base: rec.base,
        mine: rec.mine,
        theirs: rec.theirs,
        merged: ev.merged || null,
        choice: ev.choice,
        resolvedAt: ev.resolvedAt,
        revision: ev.revision || null
      });
      let total = 0;
      for (const x of h) total += JSON.stringify(x).length;
      while (h.length > 1 && (h.length > HISTORY_CAP || total > HISTORY_BYTES)) {
        const dropped = h.pop();
        total -= JSON.stringify(dropped).length;
      }
      await kvSet(kHistory(module), h);
    }

    async function resolveConflict(module, choice, opts) {
      opts = opts || {};
      try {
        if (["keepMine", "keepTheirs", "merge"].indexOf(choice) === -1) {
          return { ok: false, code: "bad_choice", detail: "choice must be keepMine, keepTheirs or merge" };
        }
        const rec = await kvGet(kConflict(module));
        if (!rec) return { ok: false, code: "no_conflict", detail: `there is no unresolved conflict for ${module}` };
        const ledger = await kvGet(kLedger(module));
        if (!ledger || !ledger.content) return { ok: false, code: "no_conflict", detail: "the staged edit behind this conflict is missing" };
        const remote = await readDoc(module);
        if (!remote.ok && remote.state !== "none") return remote;
        const remotePresent = remote.ok;
        const remoteRev = remote.ok ? remote.revision : 0;
        if (!remotePresent || remoteRev !== rec.theirs.revision) {
          let fresh = null;
          if (remote.ok && remoteRev > rec.theirs.revision) fresh = await ensureConflict(module, ledger, remote);
          return { ok: false, code: "conflict_moved", detail: "this conflict changed while it was being reviewed; nothing was overwritten", conflict: fresh };
        }
        if (choice === "keepTheirs") {
          await cacheDoc(module, remote);
          await clearLedger(module);
          await kvDel(kConflict(module));
          await pushHistory(module, rec, { choice, resolvedAt: new Date().toISOString(), revision: remoteRev });
          lastSyncResult = lastSyncResult || {};
          lastSyncResult[module] = { state: "synced", module, revision: remoteRev, pulled: true };
          return { ok: true, resolution: "keepTheirs", revision: remoteRev, archived: true };
        }
        const headKey = await kvGet(kKey(fileName(module)));
        if (!headKey) {
          return { ok: false, code: "no_edit_key", detail: `This device has no write key for the ${module} document. Restore from a backup to claim ownership before resolving.` };
        }
        const mineContent = choice === "merge" ? opts.merged : ledger.content;
        if (!mineContent || typeof mineContent !== "object" || Array.isArray(mineContent)) {
          return { ok: false, code: "bad_content", detail: "merged content must be a JSON object" };
        }
        const res = await tryPublish(module, mineContent, { revision: remoteRev + 1, expectedRemoteRev: remoteRev, remotePresent: true });
        if (!res.ok) return res;
        await cacheDoc(module, { content: mineContent, revision: res.revision, updatedAt: res.updatedAt, updatedBy: res.updatedBy, parts: res.parts, lastText: res.canonicalText });
        await clearLedger(module);
        await kvDel(kConflict(module));
        await pushHistory(module, rec, { choice, merged: choice === "merge" ? mineContent : undefined, resolvedAt: new Date().toISOString(), revision: res.revision });
        lastSyncResult = lastSyncResult || {};
        lastSyncResult[module] = { state: "synced", module, revision: res.revision };
        return { ok: true, resolution: choice, revision: res.revision, archived: true };
      } catch (e) {
        return { ok: false, code: "resolve_failed", detail: (e && e.message) || String(e) };
      }
    }

    async function mergeDiff(module) {
      const rec = await kvGet(kConflict(module));
      if (!rec) return { ok: false, code: "no_conflict", detail: `there is no unresolved conflict for ${module}` };
      return { ok: true, conflict: rec, diff: computeMergeDiff(rec) };
    }

    async function buildMerged(module, picks) {
      const rec = await kvGet(kConflict(module));
      if (!rec) return { ok: false, code: "no_conflict", detail: `there is no unresolved conflict for ${module}` };
      return { ok: true, merged: mergeContent(rec, picks) };
    }

    async function listConflicts() {
      const out = [];
      for (const m of modules) {
        const c = await kvGet(kConflict(m));
        if (c) out.push(c);
      }
      return out;
    }

    async function getConflict(module) {
      return kvGet(kConflict(module));
    }

    async function listHistory(module) {
      const h = await kvGet(kHistory(module));
      return Array.isArray(h) ? h : [];
    }

    /* ── backup & restore ──────────────────────────────────────────────── */

    function backupIndexName() {
      return bkpIndexName();
    }
    function backupHeadName(module) {
      return bkpHeadName(module);
    }
    function backupPartName(module, k) {
      return bkpPartName(module, k);
    }

    function parseIndexText(text) {
      let meta;
      try {
        meta = JSON.parse(text);
      } catch (e) {
        return { error: { ok: false, state: "corrupt", code: "corrupt_index", detail: "the published-backup index is not valid JSON" } };
      }
      if (!meta || meta.k !== "bcrmbkp" || meta.v !== 1 || !Array.isArray(meta.modules)) {
        return { error: { ok: false, state: "corrupt", code: "corrupt_index", detail: "the published-backup index failed validation" } };
      }
      return { meta };
    }

    async function buildBackup() {
      const meta = await getMeta();
      const mods = [];
      const editKeys = {};
      const problems = [];
      let present = 0;
      let records = 0;
      for (const m of modules) {
        const doc = await readDoc(m);
        if (doc.ok) {
          present++;
          if (Array.isArray(doc.content.records)) records += doc.content.records.length;
          mods.push({ module: m, present: true, revision: doc.revision, updatedAt: doc.updatedAt, updatedBy: doc.updatedBy, parts: doc.parts, sha: doc.sha, content: doc.content });
          const names = [fileName(m)];
          for (let k = 2; k <= doc.parts; k++) names.push(partName(m, k));
          for (const n of names) {
            const key = await kvGet(kKey(n));
            if (key) editKeys[n] = key;
          }
        } else if (doc.state === "none") {
          mods.push({ module: m, present: false, revision: 0 });
        } else {
          problems.push(m + ": " + (doc.detail || doc.code || doc.state));
          mods.push({ module: m, present: false, revision: 0, unreadable: doc.code || doc.state });
        }
      }
      for (const m of modules) {
        try {
          const ai = await readArchiveIndex(m);
          if (ai.ok && ai.index) {
            const aNames = [archiveIndexName(m)];
            for (const b of ai.index.batches) {
              aNames.push(archiveBatchName(m, b.no));
              for (let k = 2; k <= (b.parts || 1); k++) aNames.push(archiveBatchPartName(m, b.no, k));
            }
            for (const n of aNames) {
              const key = await kvGet(kKey(n));
              if (key) editKeys[n] = key;
            }
          }
        } catch (e) {}
      }
      const snapshot = {
        k: "bcrmbak",
        v: 1,
        kind: "full",
        id: "bk" + Date.now().toString(36) + randHex(4),
        at: new Date().toISOString(),
        ns,
        deviceId: meta.deviceId,
        generator: { name: genName || null, token },
        modules: mods,
        editKeys
      };
      const summary = { total: mods.length, present, records, bytes: JSON.stringify(snapshot).length, absent: mods.filter(x => !x.present).map(x => x.module) };
      if (problems.length) return { ok: false, code: "unreadable_modules", problems, detail: "Some module documents could not be read, so this is not a complete backup: " + problems.join("; "), snapshot, summary };
      return { ok: true, snapshot, summary };
    }

    async function validateBackup(raw) {
      let snap = raw;
      if (typeof raw === "string") {
        try {
          snap = JSON.parse(raw);
        } catch (e) {
          return { ok: false, code: "invalid_json", detail: "That file is not valid JSON, so it is not a CRM-U backup." };
        }
      }
      if (!snap || typeof snap !== "object" || Array.isArray(snap)) return { ok: false, code: "not_a_backup", detail: "That file does not contain a CRM-U backup." };
      if (snap.k !== "bcrmbak" || snap.v !== 1 || (snap.kind !== "full" && snap.kind !== "published")) {
        return { ok: false, code: "not_a_backup", detail: "That file does not look like a CRM-U backup (missing the backup marker)." };
      }
      if (!Array.isArray(snap.modules) || !snap.modules.length) return { ok: false, code: "bad_backup", detail: "The backup contains no module documents." };
      if (!snap.at || isNaN(new Date(snap.at).getTime())) return { ok: false, code: "bad_backup", detail: "The backup is missing its timestamp." };
      const problems = [];
      const seen = {};
      let present = 0;
      let records = 0;
      for (const me of snap.modules) {
        if (!me || typeof me !== "object") { problems.push("a module entry is malformed"); continue; }
        const m = String(me.module || "");
        if (!m || seen[m]) { problems.push(m ? "module \"" + m + "\" appears more than once" : "a module entry has no name"); continue; }
        seen[m] = true;
        if (!me.present) { if (me.revision !== 0) problems.push(m + ": absent entry has revision " + me.revision); continue; }
        present++;
        if (!me.content || typeof me.content !== "object" || Array.isArray(me.content)) { problems.push(m + ": document content is missing"); continue; }
        if (!(me.revision >= 1)) problems.push(m + ": missing document revision");
        if (typeof me.sha !== "string" || me.sha.length < 8) { problems.push(m + ": missing content hash"); continue; }
        const sha = await digestHex(JSON.stringify(me.content));
        if (sha !== me.sha) problems.push(m + ": content does not match its recorded hash");
        if (Array.isArray(me.content.records)) records += me.content.records.length;
      }
      if (problems.length) return { ok: false, code: "invalid_backup", problems, detail: "The backup failed validation: " + problems.join("; ") };
      return { ok: true, snapshot: snap, summary: { total: snap.modules.length, present, records } };
    }

    async function backupFingerprint(snap) {
      const parts = snap.modules.map(m => m.present ? m.module + ":" + m.revision + ":" + (m.sha || "") + ":" + (m.parts || 1) : m.module + ":absent").join("|");
      return digestHex("bcrmbkp:" + ns + ":" + parts);
    }

    async function writeBkpFileset(module, split, info) {
      const parts = split.partContents;
      const canonicalText = JSON.stringify(parts.length ? mergeParts(split.headContent, parts) : split.headContent);
      const sha = await digestHex(canonicalText);
      for (let i = 0; i < parts.length; i++) {
        const pn = bkpPartName(module, i + 2);
        const body = JSON.stringify({ k: "bcrmpart", v: 1, module, ns, part: i + 2, content: parts[i] });
        const pKey = await kvGet(kKey(pn));
        const res = await editable.set(pn, body, pKey ? { editKey: pKey } : {});
        if (res && res.error) return { ok: false, code: normalizePluginError(res.error), detail: String(res.error) };
        if (res && res.editKey && !pKey) await kvSet(kKey(pn), res.editKey);
      }
      const headName = bkpHeadName(module);
      const base = { k: "bcrmdoc", v: 1, module, ns, revision: info.revision, updatedAt: info.updatedAt, updatedBy: info.updatedBy, parts: parts.length + 1, sha };
      const headBody = JSON.stringify(Object.assign({}, base, { content: split.headContent }));
      const cachedKey = await kvGet(kKey(headName));
      const headRes = await editable.set(headName, headBody, cachedKey ? { editKey: cachedKey } : {});
      if (headRes && headRes.error) return { ok: false, code: normalizePluginError(headRes.error), detail: String(headRes.error) };
      if (headRes && headRes.editKey && !cachedKey) await kvSet(kKey(headName), headRes.editKey);
      return { ok: true, parts: parts.length + 1 };
    }

    async function publishBackup() {
      const built = await buildBackup();
      if (!built.ok) return { ok: false, code: "backup_incomplete", problems: built.problems, detail: "Nothing was published. " + built.detail };
      const snap = built.snapshot;
      const idx = bkpIndexName();
      const rawIdx = await readRaw(idx);
      if (rawIdx.error) return rawIdx.error;
      let existing = null;
      if (rawIdx.text !== null) {
        const parsed = parseIndexText(rawIdx.text);
        if (parsed.error) return parsed.error;
        existing = parsed.meta;
      }
      const fp = await backupFingerprint(snap);
      if (existing && existing.fp === fp) {
        return { ok: true, noop: true, published: existing, detail: "everything is already published unchanged" };
      }
      const metaMods = [];
      let changed = 0;
      let unchanged = 0;
      for (const me of snap.modules) {
        if (!me.present) {
          metaMods.push({ module: me.module, present: false, revision: 0, records: 0 });
          unchanged++;
          continue;
        }
        const prev = existing && existing.modules.find(x => x.module === me.module);
        if (prev && prev.present && prev.revision === me.revision && prev.sha === me.sha && prev.parts === me.parts) {
          metaMods.push({ module: me.module, present: true, revision: me.revision, parts: me.parts, sha: me.sha, records: prev.records || 0 });
          unchanged++;
          continue;
        }
        const split = splitByRecords(me.content);
        if (!split) return { ok: false, code: "doc_too_large", detail: "The " + me.module + " backup is too large to publish." };
        const res = await writeBkpFileset(me.module, split, { revision: me.revision, updatedAt: me.updatedAt, updatedBy: me.updatedBy });
        if (!res.ok) return { ok: false, code: res.code, detail: "Publishing the " + me.module + " backup failed: " + (res.detail || res.code) };
        changed++;
        metaMods.push({ module: me.module, present: true, revision: me.revision, parts: res.parts, sha: me.sha, records: Array.isArray(me.content.records) ? me.content.records.length : 0 });
      }
      const published = {
        k: "bcrmbkp",
        v: 1,
        id: snap.id,
        at: snap.at,
        ns,
        deviceId: snap.deviceId,
        generator: { name: snap.generator.name, token: snap.generator.token },
        fp,
        modules: metaMods
      };
      const body = JSON.stringify(published);
      const cachedKey = await kvGet(kKey(idx));
      const res = await editable.set(idx, body, cachedKey ? { editKey: cachedKey } : {});
      if (res && res.error) return { ok: false, code: normalizePluginError(res.error), detail: String(res.error) };
      if (res && res.editKey && !cachedKey) await kvSet(kKey(idx), res.editKey);
      return { ok: true, published, changed, unchanged };
    }

    async function latestPublishedBackup() {
      const raw = await readRaw(bkpIndexName());
      if (raw.error) return raw.error;
      if (raw.text === null) return { ok: false, state: "none", code: "no_published_backup", detail: "No backup has been published for this CRM yet." };
      const parsed = parseIndexText(raw.text);
      if (parsed.error) return parsed.error;
      return { ok: true, meta: parsed.meta };
    }

    async function readPublishedBackup() {
      const latest = await latestPublishedBackup();
      if (!latest.ok) return latest;
      const meta = latest.meta;
      const mods = [];
      const problems = [];
      for (const entry of meta.modules) {
        if (!entry.present) { mods.push({ module: entry.module, present: false, revision: 0 }); continue; }
        const doc = await readBkpDoc(entry.module);
        if (doc.ok) mods.push({ module: entry.module, present: true, revision: doc.revision, updatedAt: doc.updatedAt, updatedBy: doc.updatedBy, parts: doc.parts, sha: doc.sha, content: doc.content });
        else problems.push(entry.module + ": " + (doc.detail || doc.code || doc.state));
      }
      if (problems.length) return { ok: false, code: "published_incomplete", problems, detail: "The published backup is incomplete or damaged: " + problems.join("; ") };
      return { ok: true, snapshot: { k: "bcrmbak", v: 1, kind: "published", id: meta.id, at: meta.at, ns, deviceId: meta.deviceId, generator: meta.generator, modules: mods } };
    }

    async function previewBackup(raw) {
      const v = await validateBackup(raw);
      if (!v.ok) return v;
      const snap = v.snapshot;
      const rows = [];
      const blocking = [];
      for (const m of modules) {
        const me = snap.modules.find(x => x.module === m);
        const conflict = await kvGet(kConflict(m));
        const ledger = await kvGet(kLedger(m));
        const hasPending = !!(conflict || (ledger && ledger.content));
        if (hasPending) blocking.push(m);
        const live = await readDoc(m);
        const livePresent = live.ok;
        const liveRev = live.ok ? live.revision : 0;
        if (!me || !me.present) {
          rows.push({ module: m, present: false, snapRev: 0, liveRev, liveState: live.ok ? "canonical" : live.state, action: "skip", rollback: false, pending: hasPending, records: 0, note: "absent in backup — will be left alone" });
          continue;
        }
        const snapRecords = Array.isArray(me.content.records) ? me.content.records.length : 0;
        let action;
        let rollback = false;
        let note = "";
        if (live.ok && deepEqual(live.content, me.content)) {
          action = "noop";
          note = "already identical to today's data — no change";
        } else if (live.ok) {
          action = "replace";
          if (liveRev > me.revision) {
            rollback = true;
            const n = liveRev - me.revision;
            note = "rolls back " + n + " newer save" + (n === 1 ? "" : "s") + " made since this backup";
          } else {
            note = "replaces the live version";
          }
        } else if (live.state === "none") {
          action = "create";
          note = "creates the document";
        } else {
          action = "replace";
          note = "live document is unreadable (" + (live.code || live.state) + ") — it will be replaced";
        }
        rows.push({ module: m, present: true, snapRev: me.revision, liveRev, liveState: live.ok ? "canonical" : live.state, action, rollback, pending: hasPending, records: snapRecords, note });
      }
      return { ok: true, rows, blocking, summary: v.summary };
    }

    async function archiveRestore(module, o) {
      let h = await kvGet(kHistory(module));
      h = Array.isArray(h) ? h : [];
      h.unshift({ kind: "restore", module, restoredBackup: o.restoredId, restoredAt: o.at, previous: { revision: o.prevRev, content: o.prevContent }, restoredRevision: o.newRev });
      let total = 0;
      for (const x of h) total += JSON.stringify(x).length;
      while (h.length > 1 && (h.length > HISTORY_CAP || total > HISTORY_BYTES)) {
        const dropped = h.pop();
        total -= JSON.stringify(dropped).length;
      }
      await kvSet(kHistory(module), h);
    }

    async function restoreBackup(raw) {
      const v = await validateBackup(raw);
      if (!v.ok) return v;
      const snap = v.snapshot;
      const blocking = [];
      for (const m of modules) {
        const conflict = await kvGet(kConflict(m));
        const ledger = await kvGet(kLedger(m));
        if (conflict || (ledger && ledger.content)) blocking.push(m);
      }
      if (blocking.length) {
        return { ok: false, code: "pending_changes", modules: blocking, detail: "Finish the pending " + blocking.length + " sync item" + (blocking.length === 1 ? "" : "s") + " first (" + blocking.join(", ") + "), so restoring cannot discard unsaved changes." };
      }
      const keys = snap.editKeys || {};
      let keysApplied = 0;
      for (const n of Object.keys(keys)) {
        if (typeof keys[n] === "string" && keys[n]) {
          await kvSet(kKey(n), keys[n]);
          keysApplied++;
        }
      }
      const metaNow = await getMeta();
      const results = {};
      for (const m of modules) {
        const me = snap.modules.find(x => x.module === m);
        const row = { action: "skipped", revision: null };
        if (!me || !me.present) { results[m] = row; continue; }
        const cache = await kvGet(kDoc(m));
        const live = await readDoc(m);
        if (live.ok && deepEqual(live.content, me.content)) {
          row.action = "noop";
          row.revision = live.revision;
          await cacheDoc(m, live);
          results[m] = row;
          continue;
        }
        const split = splitByRecords(me.content);
        if (!split) {
          row.action = "failed";
          row.code = "doc_too_large";
          row.detail = "The restored " + m + " document is too large to write.";
          results[m] = row;
          continue;
        }
        const canonicalText = JSON.stringify(split.partContents.length ? mergeParts(split.headContent, split.partContents) : split.headContent);
        let newRev;
        let remotePresent;
        let expectedRemoteRev;
        let prevContent = null;
        let prevRev = 0;
        if (live.ok) {
          remotePresent = true;
          expectedRemoteRev = live.revision;
          newRev = Math.max(live.revision, me.revision || 0) + 1;
          prevContent = live.content;
          prevRev = live.revision;
        } else if (live.state === "none") {
          remotePresent = false;
          expectedRemoteRev = 0;
          newRev = 1;
        } else {
          remotePresent = false;
          expectedRemoteRev = 0;
          newRev = Math.max((cache && cache.revision) || 0, me.revision || 0) + 1;
          prevRev = (cache && cache.revision) || 0;
          prevContent = cache && cache.content ? cache.content : null;
          row.note = "live document was unreadable and was replaced";
        }
        if (remotePresent && !(await kvGet(kKey(fileName(m))))) {
          row.action = "failed";
          row.code = "no_edit_key";
          row.detail = "Restoring " + m + " would overwrite the live document, but this device has no write key for it. Use the downloaded backup file (it carries the keys), or restore on the device that created the data.";
          results[m] = row;
          continue;
        }
        const ts = new Date().toISOString();
        const wrote = await writeCanonical(m, split, { revision: newRev, expectedRemoteRev, remotePresent, canonicalText, updatedAt: ts, updatedBy: metaNow.deviceId });
        if (!wrote.ok) {
          row.action = "failed";
          row.code = wrote.code;
          row.detail = (wrote.detail || wrote.code) + " Nothing was changed for " + m + " — retry the restore.";
          results[m] = row;
          continue;
        }
        row.action = live.ok ? "replace" : "create";
        row.revision = newRev;
        row.previousRevision = prevRev;
        await cacheDoc(m, { content: me.content, revision: newRev, updatedAt: ts, updatedBy: metaNow.deviceId, parts: wrote.parts, lastText: canonicalText });
        if (prevContent !== null) await archiveRestore(m, { restoredId: snap.id, at: snap.at, prevRev, prevContent, newRev });
        lastSyncResult = lastSyncResult || {};
        lastSyncResult[m] = { state: "synced", module: m, revision: newRev };
        results[m] = row;
      }
      await kvSet(kRecon, { at: new Date().toISOString() });
      return { ok: true, id: snap.id, at: snap.at, keysApplied, results };
    }

    async function statusInfo() {
      const meta = await getMeta();
      const recon = await kvGet(kRecon);
      const info = { ns, token, deviceId: meta.deviceId, lastReconcileAt: recon ? recon.at : null, modules: {} };
      for (const m of modules) {
        const cache = await kvGet(kDoc(m));
        const ledger = await kvGet(kLedger(m));
        const conflict = await kvGet(kConflict(m));
        const sync = lastSyncResult && lastSyncResult[m];
        let state = "none";
        if (ledger && ledger.content) {
          state = conflict ? "conflict" : "pending";
        } else if (cache && cache.content) {
          state = sync && sync.state ? sync.state : "local_only";
          if (state === "none") state = "local_only";
        } else if (conflict) {
          state = "conflict";
        } else if (sync && sync.state && sync.state !== "none") {
          state = sync.state === "synced" && sync.pulled ? "synced" : sync.state;
        }
        info.modules[m] = {
          state,
          revision: cache ? cache.revision : sync && sync.revision ? sync.revision : 0,
          cached: !!(cache && cache.content),
          dirty: !!(ledger && ledger.content)
        };
      }
      return info;
    }

    async function statusSummary() {
      const info = await statusInfo();
      const counts = { total: 0, synced: 0, localOnly: 0, none: 0, pending: 0, conflict: 0, diverged: 0, problem: 0 };
      for (const m of modules) {
        const s = info.modules[m].state;
        counts.total++;
        if (s === "synced") counts.synced++;
        else if (s === "local_only") counts.localOnly++;
        else if (s === "none") counts.none++;
        else if (s === "pending") counts.pending++;
        else if (s === "conflict") counts.conflict++;
        else if (s === "diverged") counts.diverged++;
        else counts.problem++;
      }
      return { counts, info };
    }

    /* ── capacity & archival ───────────────────────────────────────────── */

    async function readArchiveIndex(module) {
      const raw = await readRaw(archiveIndexName(module));
      if (raw.error) return raw.error;
      if (raw.text === null) return { ok: true, none: true, index: null };
      let idx;
      try {
        idx = JSON.parse(raw.text);
      } catch (e) {
        return { ok: false, state: "corrupt", code: "corrupt_archidx", detail: "the archive index for " + module + " is not valid JSON" };
      }
      if (!idx || idx.k !== "bcrmarc" || idx.v !== 1 || idx.module !== module || !Array.isArray(idx.batches) || typeof idx.nextNo !== "number") {
        return { ok: false, state: "corrupt", code: "corrupt_archidx", detail: "the archive index for " + module + " failed validation" };
      }
      return { ok: true, index: idx };
    }

    async function writeArchiveIndex(module, idx) {
      const meta = await getMeta();
      idx.updatedAt = new Date().toISOString();
      idx.updatedBy = meta.deviceId;
      const name = archiveIndexName(module);
      const body = JSON.stringify(idx);
      const cachedKey = await kvGet(kKey(name));
      const res = await editable.set(name, body, cachedKey ? { editKey: cachedKey } : {});
      if (res && res.error) return { ok: false, code: normalizePluginError(res.error), detail: String(res.error) };
      if (res && res.editKey && !cachedKey) await kvSet(kKey(name), res.editKey);
      return { ok: true, bytes: utf8Bytes(body) };
    }

    async function writeArchBatchFile(module, no, records, rule, by, archivedAt) {
      const content = { records: records };
      const split = splitByRecords(content);
      if (!split) {
        return { ok: false, code: "doc_too_large", detail: "This archival batch is too large to store in one batch file." };
      }
      const canonicalText = JSON.stringify(split.partContents.length ? mergeParts(split.headContent, split.partContents) : split.headContent);
      const sha = await digestHex(canonicalText);
      const parts = split.partContents;
      let bytes = 0;
      for (let i = 0; i < parts.length; i++) {
        const pn = archiveBatchPartName(module, no, i + 2);
        const body = JSON.stringify({ k: "bcrmpart", v: 1, module, ns, part: i + 2, content: parts[i] });
        bytes += utf8Bytes(body);
        const pKey = await kvGet(kKey(pn));
        const res = await editable.set(pn, body, pKey ? { editKey: pKey } : {});
        if (res && res.error) return { ok: false, code: normalizePluginError(res.error), detail: String(res.error) };
        if (res && res.editKey && !pKey) await kvSet(kKey(pn), res.editKey);
      }
      const headName = archiveBatchName(module, no);
      const headBody = JSON.stringify({
        k: "bcrmarcb",
        v: 1,
        module,
        ns,
        no,
        archivedAt,
        archivedBy: by,
        rule,
        readOnly: true,
        parts: parts.length + 1,
        sha,
        content: split.headContent
      });
      bytes += utf8Bytes(headBody);
      const cachedKey = await kvGet(kKey(headName));
      const headRes = await editable.set(headName, headBody, cachedKey ? { editKey: cachedKey } : {});
      if (headRes && headRes.error) return { ok: false, code: normalizePluginError(headRes.error), detail: String(headRes.error) };
      if (headRes && headRes.editKey && !cachedKey) await kvSet(kKey(headName), headRes.editKey);
      return { ok: true, no, parts: parts.length + 1, bytes, sha };
    }

    async function readArchiveBatchFile(module, no) {
      return readFileset(module, () => archiveBatchName(module, no), (_m, k) => archiveBatchPartName(module, no, k), "archived batch", "bcrmarcb");
    }

    async function previewArchive(module, opts) {
      opts = opts || {};
      try {
        if (modules.indexOf(module) === -1) return { ok: false, code: "bad_module", detail: `no module named "${module}"` };
        const field = opts.field;
        const beforeMs = dateValueOf(opts.before);
        if (!field) return { ok: false, code: "field_required", detail: "Choose the date field archival should judge records by." };
        if (beforeMs === null) return { ok: false, code: "bad_before", detail: "The cutoff date is not a readable date." };
        const ld = await readDoc(module);
        if (!ld.ok && ld.state !== "none") return ld;
        const content = ld.ok ? ld.content : defaultContent();
        const matches = collectArchiveMatches(content, String(field), beforeMs);
        let bytes = 0;
        for (const r of matches) bytes += utf8Bytes(JSON.stringify(r));
        return {
          ok: true,
          module,
          field: String(field),
          before: new Date(beforeMs).toISOString(),
          count: matches.length,
          bytes,
          records: matches
        };
      } catch (e) {
        return { ok: false, code: "preview_failed", detail: (e && e.message) || String(e) };
      }
    }

    async function archiveRecords(module, opts) {
      opts = opts || {};
      try {
        if (modules.indexOf(module) === -1) return { ok: false, code: "bad_module", detail: `no module named "${module}"` };
        const field = opts.field;
        const beforeMs = dateValueOf(opts.before);
        if (!field) return { ok: false, code: "field_required", detail: "Choose the date field archival should judge records by." };
        if (beforeMs === null) return { ok: false, code: "bad_before", detail: "The cutoff date is not a readable date." };
        const meta = await getMeta();
        const by = meta.deviceId;
        const ld = await readDoc(module);
        if (!ld.ok && ld.state !== "none") return ld;
        const content = ld.ok ? ld.content : defaultContent();
        const base = ld.ok ? ld.revision : 0;
        const fieldS = String(field);
        const beforeISO = new Date(beforeMs).toISOString();
        const matches = collectArchiveMatches(content, fieldS, beforeMs);
        if (!matches.length) {
          return { ok: true, archived: 0, module, field: fieldS, before: beforeISO, batch: null, detail: "No live records in " + module + " are older than this cutoff, so nothing was archived." };
        }
        const rule = { field: fieldS, before: beforeISO };
        const fp = await digestHex(JSON.stringify({ records: matches }));
        const idxRes = await readArchiveIndex(module);
        if (!idxRes.ok) return idxRes;
        let idx = idxRes.index;
        if (!idx) {
          idx = { k: "bcrmarc", v: 1, module, ns, readOnly: true, nextNo: 1, updatedAt: new Date().toISOString(), updatedBy: by, batches: [] };
        }
        const existing = (idx.batches || []).find(b => b && b.rule && b.rule.field === fieldS && b.rule.before === beforeISO && b.sha === fp && !b.restoredAt) || null;
        let entry = existing;
        let entryIsNew = !existing;
        if (!entry) {
          const no = idx.nextNo;
          const wr = await writeArchBatchFile(module, no, matches, rule, by, new Date().toISOString());
          if (!wr.ok) return wr;
          entry = {
            no,
            id: "arc" + Date.now().toString(36) + randHex(4),
            archivedAt: new Date().toISOString(),
            archivedBy: by,
            rule,
            readOnly: true,
            count: matches.length,
            parts: wr.parts,
            bytes: wr.bytes,
            sha: fp,
            status: "archived",
            restoredAt: null,
            restoredBy: null
          };
          idx.batches.push(entry);
          idx.nextNo = no + 1;
          const wi = await writeArchiveIndex(module, idx);
          if (!wi.ok) {
            return {
              ok: false,
              code: "archidx_write_failed",
              detail: "The records were written to the archive, but the archive index could not be saved (" + (wi.detail || wi.code) + "). Nothing was removed from live data — run the archive step again to re-link them.",
              batch: { no, rule, count: matches.length }
            };
          }
        }
        const prunedContent = Object.assign({}, content, { records: content.records.filter(r => matches.indexOf(r) === -1) });
        const sv = await saveChecked(module, prunedContent, { expectedBase: base });
        const batchMeta = {
          no: entry.no,
          id: entry.id,
          archivedAt: entry.archivedAt,
          rule: entry.rule,
          count: entry.count,
          parts: entry.parts,
          bytes: entry.bytes,
          sha: entry.sha,
          reused: !entryIsNew
        };
        if (sv.ok) {
          return {
            ok: true,
            archived: matches.length,
            batch: batchMeta,
            live: { action: sv.noop ? "already_pruned" : "pruned", revision: sv.revision, noop: !!sv.noop }
          };
        }
        if (sv.code === "conflict" || sv.code === "conflict_stale") {
          return {
            ok: true,
            archived: matches.length,
            batch: batchMeta,
            live: { action: "needs_sync", code: sv.code, detail: sv.detail }
          };
        }
        return {
          ok: false,
          code: sv.code,
          detail: "The records are safe in the archive, but the live " + module + " document could not be pruned: " + (sv.detail || sv.code) + " Run the archive step again once the store is writable.",
          batch: batchMeta
        };
      } catch (e) {
        return { ok: false, code: "archive_failed", detail: (e && e.message) || String(e) };
      }
    }

    async function listArchive(module) {
      try {
        const idxRes = await readArchiveIndex(module);
        if (!idxRes.ok) return idxRes;
        if (!idxRes.index) return { ok: true, none: true, batches: [] };
        return { ok: true, index: idxRes.index, batches: idxRes.index.batches.slice() };
      } catch (e) {
        return { ok: false, code: "list_failed", detail: (e && e.message) || String(e) };
      }
    }

    async function readArchiveBatch(module, no) {
      try {
        const idxRes = await readArchiveIndex(module);
        if (!idxRes.ok) return idxRes;
        const entry = idxRes.index && idxRes.index.batches.find(b => b.no === no);
        if (!entry) return { ok: false, code: "batch_not_found", detail: `archive batch b${no} is not listed for ${module}` };
        const rd = await readArchiveBatchFile(module, no);
        if (!rd.ok) return rd;
        return { ok: true, batch: entry, records: rd.content.records || [], parts: rd.parts, sha: rd.sha, readOnly: true };
      } catch (e) {
        return { ok: false, code: "read_failed", detail: (e && e.message) || String(e) };
      }
    }

    async function restoreArchiveBatch(module, no) {
      try {
        const idxRes = await readArchiveIndex(module);
        if (!idxRes.ok) return idxRes;
        if (!idxRes.index) return { ok: false, code: "no_archive", detail: "No archive exists for " + module + " yet." };
        const idx = idxRes.index;
        const entry = idx.batches.find(b => b.no === no);
        if (!entry) return { ok: false, code: "batch_not_found", detail: `archive batch b${no} is not listed for ${module}` };
        if (entry.restoredAt) return { ok: true, noop: true, restored: 0, batch: entry, detail: "This batch was already restored to live data on " + entry.restoredAt + "." };
        const rd = await readArchiveBatchFile(module, no);
        if (!rd.ok) return rd;
        const ld = await readDoc(module);
        if (!ld.ok && ld.state !== "none") return ld;
        const liveContent = ld.ok ? ld.content : defaultContent();
        const base = ld.ok ? ld.revision : 0;
        const liveRecs = Array.isArray(liveContent.records) ? liveContent.records.slice() : [];
        let added = 0;
        for (const r of rd.content.records || []) {
          if (!liveRecs.some(x => deepEqual(x, r))) {
            liveRecs.push(r);
            added++;
          }
        }
        if (!added && ld.ok) {
          const metaNow = await getMeta();
          entry.restoredAt = new Date().toISOString();
          entry.restoredBy = metaNow.deviceId;
          entry.status = "restored";
          const wi = await writeArchiveIndex(module, idx);
          if (!wi.ok) return { ok: false, code: "archidx_write_failed", detail: "These records are already present in live data; the archive index could not be marked restored (" + (wi.detail || wi.code) + ").", batch: entry };
          return { ok: true, noop: true, restored: 0, batch: entry, detail: "Every record in this batch is already present in live data — the batch is now marked restored." };
        }
        const merged = Object.assign({}, liveContent, { records: liveRecs });
        const sv = await saveChecked(module, merged, { expectedBase: base });
        if (!sv.ok) return sv;
        const metaNow = await getMeta();
        entry.restoredAt = new Date().toISOString();
        entry.restoredBy = metaNow.deviceId;
        entry.status = "restored";
        const wi = await writeArchiveIndex(module, idx);
        if (!wi.ok) {
          return {
            ok: true,
            restored: added,
            batch: entry,
            live: { action: sv.noop ? "noop" : "written", revision: sv.revision },
            note: "Records are back in live data, but the archive index could not be marked restored (" + (wi.detail || wi.code) + ") — run restore again to mark it."
          };
        }
        return { ok: true, restored: added, batch: entry, live: { action: sv.noop ? "noop" : "written", revision: sv.revision } };
      } catch (e) {
        return { ok: false, code: "restore_failed", detail: (e && e.message) || String(e) };
      }
    }

    async function fileBytes(name) {
      try {
        const text = await editable.get(name);
        return text === undefined || text === null ? 0 : utf8Bytes(text);
      } catch (e) {
        return -1;
      }
    }

    async function capacityInfo() {
      const meta = await getMeta();
      const totals = { liveFiles: 0, liveBytes: 0, maxLiveFile: 0, maxLiveName: null, records: 0, present: 0, archFiles: 0, archBytes: 0, batches: 0, archivedRecords: 0, restoredBatches: 0 };
      const out = { ok: true, ns, at: new Date().toISOString(), ceiling: EDITABLE_MAX, budget, softCap, hardMax, totals, modules: {} };
      for (const m of modules) {
        const row = { module: m, present: false, state: "none", revision: 0, records: 0, parts: 0, localOnly: false, files: [], liveBytes: 0, maxFileBytes: 0, archive: null };
        const ld = await readDoc(m);
        if (ld.ok) {
          row.present = true;
          row.state = ld.state || "canonical";
          row.revision = ld.revision;
          row.records = Array.isArray(ld.content.records) ? ld.content.records.length : 0;
          row.parts = ld.parts || 1;
          for (let k = 1; k <= row.parts; k++) {
            const name = k === 1 ? fileName(m) : partName(m, k);
            const bytes = await fileBytes(name);
            row.files.push({ name, kind: k === 1 ? "head" : "part", bytes });
            if (bytes > 0) {
              row.liveBytes += bytes;
              row.maxFileBytes = Math.max(row.maxFileBytes, bytes);
            }
          }
          totals.present++;
          totals.liveFiles += row.parts;
          totals.liveBytes += row.liveBytes;
          totals.records += row.records;
          totals.maxLiveFile = Math.max(totals.maxLiveFile, row.maxFileBytes);
        } else if (ld.state === "none") {
          row.state = "none";
          const cache = await kvGet(kDoc(m));
          row.localOnly = !!(cache && cache.content);
        } else {
          row.state = ld.code || ld.state;
          row.readError = ld.detail || ld.code;
        }
        const ai = await readArchiveIndex(m);
        if (ai.ok && ai.index) {
          const ar = { present: true, batches: ai.index.batches.length, archivedRecords: 0, restored: 0, archFiles: 0, bytes: 0, lastAt: ai.index.updatedAt || null };
          const counted = {};
          for (const b of ai.index.batches) {
            ar.archivedRecords += b.count || 0;
            if (b.restoredAt) ar.restored++;
            const names = [archiveBatchName(m, b.no), archiveIndexName(m)];
            for (let k = 2; k <= (b.parts || 1); k++) names.push(archiveBatchPartName(m, b.no, k));
            for (const name of names) {
              if (counted[name]) continue;
              counted[name] = true;
              const bytes = await fileBytes(name);
              ar.archFiles++;
              if (bytes > 0) ar.bytes += bytes;
            }
          }
          row.archive = ar;
          totals.batches += ar.batches;
          totals.archivedRecords += ar.archivedRecords;
          totals.restoredBatches += ar.restored;
          totals.archFiles += ar.archFiles;
          totals.archBytes += ar.bytes;
        }
        out.modules[m] = row;
      }
      return out;
    }

    return {
      ns,
      token,
      modules: modules.slice(),
      fileName,
      fileUrl,
      saveDoc,
      saveChecked,
      stageEdit,
      loadDoc,
      syncDoc,
      reconcileDoc,
      reconcileAll,
      listConflicts,
      getConflict,
      resolveConflict,
      mergeDiff,
      buildMerged,
      listHistory,
      boot,
      statusInfo,
      statusSummary,
      getMeta,
      digestHex,
      backupIndexName,
      backupHeadName,
      backupPartName,
      buildBackup,
      validateBackup,
      previewBackup,
      publishBackup,
      latestPublishedBackup,
      readPublishedBackup,
      restoreBackup,
      archiveIndexName,
      archiveBatchName,
      archiveBatchPartName,
      previewArchive,
      archiveRecords,
      listArchive,
      readArchiveBatch,
      restoreArchiveBatch,
      capacityInfo,
      constants: { EDITABLE_MAX, budget, softCap, hardMax },
      get lastSyncResult() { return lastSyncResult; },
      ready: function () {
        if (!bootPromise) bootPromise = boot().catch(e => ({ ok: false, detail: (e && e.message) || String(e) }));
        return bootPromise;
      },
      get bootPromise() { return bootPromise; }
    };
  }

  function createDefault(opts) {
    opts = opts || {};
    if (typeof window === "undefined" || !window.root) throw new Error("store: perchance root unavailable");
    const r = window.root;
    if (!r.kv || !r.uploadPlugin || !r.uploadPlugin.editable) throw new Error("store: kv-plugin and upload-plugin must be imported in main.pjs");
    const kvReal = {
      get: key => r.kv.bcrm.get(key),
      set: (key, val) => r.kv.bcrm.set(key, val),
      delete: key => r.kv.bcrm.delete(key)
    };
    const edReal = {
      get: name => r.uploadPlugin.editable.get(name),
      set: (name, text, o) => r.uploadPlugin.editable.set(name, text, o || {})
    };
    return createStore(
      Object.assign({}, opts, {
        kv: kvReal,
        editable: edReal,
        generatorName: window.generatorName || null,
        token: tokenFrom(window.generatorPublicId || window.generatorName || "bcrm")
      })
    );
  }

  window.BcrmStore = { create: createStore, createDefault, tokenFrom, randHex, digestHex, DEFAULT_MODULES: DEFAULT_MODULES.slice(), EDITABLE_MAX };
})();
