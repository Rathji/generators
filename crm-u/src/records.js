window.CRM_RECORDS = (function () {
  const BS = window.BcrmStore;

  const PREFIX = { companies: "c", contacts: "ct", leads: "l", deals: "d", activities: "a", services: "svc", sites: "site", assets: "ast", tickets: "tk", documents: "doc" };

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function esc(s) {
    return String(s === undefined || s === null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function nowISO() {
    return new Date().toISOString();
  }

  function fmtDate(iso) {
    if (!iso) return "";
    const s = String(iso);
    const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + "T00:00:00") : new Date(s);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  function fmtStamp(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    const date = d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    return date + " · " + time;
  }

  function timeAgo(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    let s = (Date.now() - d.getTime()) / 1000;
    if (s < 0) s = 0;
    if (s < 45) return "just now";
    const m = s / 60;
    if (m < 60) return Math.round(m) + "m ago";
    const h = m / 60;
    if (h < 24) return Math.round(h) + "h ago";
    const days = h / 24;
    if (days < 7) return Math.round(days) + "d ago";
    if (days < 30) return Math.round(days / 7) + "w ago";
    if (days < 365) return Math.round(days / 30) + "mo ago";
    return Math.round(days / 365) + "y ago";
  }

  function newId(moduleOrPrefix) {
    const p = PREFIX[moduleOrPrefix] || moduleOrPrefix || "r";
    const hex = BS && BS.randHex ? BS.randHex(6) : Math.floor(Math.random() * 0xffffff).toString(16);
    return p + "-" + hex;
  }

  function recordsOf(content) {
    return content && Array.isArray(content.records) ? content.records : [];
  }

  function getRecord(content, id) {
    const s = String(id);
    for (const r of recordsOf(content)) {
      if (r && typeof r === "object" && String(r.id) === s) return r;
    }
    return null;
  }

  function upsertRecord(content, record) {
    content = content && typeof content === "object" && !Array.isArray(content) ? content : { records: [] };
    if (!Array.isArray(content.records)) content.records = [];
    const s = String(record && record.id);
    const i = content.records.findIndex(r => r && String(r.id) === s);
    const prev = i >= 0 ? content.records[i] : null;
    if (i >= 0) content.records[i] = record;
    else content.records.push(record);
    return { content, prev, created: i < 0 };
  }

  function removeRecord(content, id) {
    content = content && typeof content === "object" && !Array.isArray(content) ? content : { records: [] };
    if (!Array.isArray(content.records)) content.records = [];
    const s = String(id);
    const i = content.records.findIndex(r => r && String(r.id) === s);
    if (i < 0) return { content, removed: false };
    content.records.splice(i, 1);
    return { content, removed: true };
  }

  function recordName(r) {
    if (!r || typeof r !== "object") return "";
    return r.name || r.title || r.subject || (r.id !== undefined ? "record " + r.id : "");
  }

  function sortByName(records, opts) {
    opts = opts || {};
    const activeLast = opts.activeLast !== false;
    const arr = (records || []).slice();
    const rank = r => (activeLast && r && r.active === false ? 1 : 0);
    arr.sort((a, b) => {
      const d = rank(a) - rank(b);
      if (d) return d;
      const an = String(recordName(a)).toLowerCase();
      const bn = String(recordName(b)).toLowerCase();
      if (an < bn) return -1;
      if (an > bn) return 1;
      return String(a && a.id).localeCompare(String(b && b.id));
    });
    return arr;
  }

  function searchableText(r) {
    const addr = r && r.address && typeof r.address === "object" ? r.address : {};
    const bits = [
      recordName(r),
      r && r.industry,
      r && r.taxId,
      r && r.website,
      r && r.notes,
      r && r.email,
      r && r.phone,
      addr.street,
      addr.city,
      addr.region,
      addr.postalCode,
      addr.country
    ];
    if (r && Array.isArray(r.tags)) bits.push(r.tags.join(" "));
    return bits.filter(b => b !== undefined && b !== null).join(" ").toLowerCase();
  }

  function filterRecords(records, q) {
    q = String(q || "").trim().toLowerCase();
    if (!q) return records || [];
    return (records || []).filter(r => searchableText(r).indexOf(q) !== -1);
  }

  function parseTags(v) {
    let arr = Array.isArray(v) ? v.map(s => String(s).trim()).filter(Boolean)
      : String(v || "").split(/[,;\n]+/).map(s => s.trim()).filter(Boolean);
    return Array.from(new Set(arr));
  }

  function moduleLabel(id) {
    const list = window.CRM_MODULES;
    if (list) {
      const def = list.find(m => m.id === id);
      if (def) return def.label;
    }
    return id.charAt(0).toUpperCase() + id.slice(1);
  }

  async function findRefs(store, module, refKey, id) {
    const out = [];
    const s = String(id);
    for (const m of (store && store.modules) || []) {
      if (m === module) continue;
      let doc;
      try {
        doc = await store.loadDoc(m);
      } catch (e) {
        continue;
      }
      if (!doc || !doc.content) continue;
      for (const r of recordsOf(doc.content)) {
        if (!r || typeof r !== "object") continue;
        const direct = r[refKey] !== undefined && String(r[refKey]) === s;
        const owner = r.ownerId !== undefined && String(r.ownerId) === s;
        if (direct || owner) out.push({ module: m, id: r.id, name: recordName(r) });
      }
    }
    return out;
  }

  function changedRecords(before, after) {
    const map = {};
    (before && before.records || []).forEach(r => { if (r && r.id !== undefined) map[r.id] = { prev: r, next: null }; });
    (after && after.records || []).forEach(r => {
      if (r && r.id !== undefined) {
        if (!map[r.id]) map[r.id] = { prev: null, next: r };
        else map[r.id].next = r;
      }
    });
    const out = [];
    for (const id of Object.keys(map)) {
      const pair = map[id];
      if (pair.prev === null || pair.next === null || !deepEq(pair.prev, pair.next)) {
        out.push({ id, prev: pair.prev, next: pair.next });
      }
    }
    return out;
  }

  function deepEq(a, b) {
    try { return JSON.stringify(a) === JSON.stringify(b); } catch (e) { return a === b; }
  }

  async function persistUpdate(store, module, updater, opts) {
    opts = opts || {};
    let lastRes = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      const out = await persistAttempt(store, module, updater, opts);
      if (!out.retryable) return out;
      lastRes = out;
      await new Promise(r => setTimeout(r, 1600));
    }
    if (lastRes && lastRes.retryable) { delete lastRes.retryable; }
    return lastRes;
  }

  async function persistAttempt(store, module, updater, opts) {
    let doc;
    try {
      doc = await store.loadDoc(module, { refresh: true });
    } catch (e) {
      return { ok: false, code: "load_failed", detail: (e && e.message) || String(e) };
    }
    if (!doc || doc.ok === false) {
      return doc || { ok: false, code: "load_failed", detail: "the document could not be read" };
    }
    let content;
    try {
      content = JSON.parse(JSON.stringify(doc.content || { records: [] }));
    } catch (e) {
      return { ok: false, code: "load_failed", detail: "the document could not be read" };
    }
    const before = JSON.parse(JSON.stringify(content));
    let out;
    try {
      out = updater(content);
    } catch (e) {
      return { ok: false, code: "update_failed", detail: (e && e.message) || String(e) };
    }
    if (!out || !out.changed) return { ok: true, noop: true, revision: doc.revision };
    let res;
    try {
      res = await store.saveChecked(module, out.content, { expectedBase: doc.revision });
    } catch (e) {
      return { ok: false, code: "save_failed", detail: (e && e.message) || String(e) };
    }
    if (res && res.code === "server_lag") return { retryable: true, ok: false, code: "server_lag", detail: res.detail };
    if (res && res.ok && !res.noop && window.CRM_EVENTS) {
      const changes = changedRecords(before, out.content);
      if (opts.events !== false) window.CRM_EVENTS.fire("moduleWrite", { module, res, changes, store });
    }
    return res;
  }

  return {
    el,
    esc,
    nowISO,
    fmtDate,
    fmtStamp,
    timeAgo,
    newId,
    PREFIX,
    recordsOf,
    getRecord,
    upsertRecord,
    removeRecord,
    recordName,
    sortByName,
    filterRecords,
    parseTags,
    moduleLabel,
    findRefs,
    persistUpdate
  };
})();
