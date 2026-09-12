window.CRM_BUS = (function () {
  const BS = window.BcrmStore;
  const R = window.CRM_RECORDS;

  const WON = "won";

  const MANIFEST_FILE = "bus-manifest";
  const PROTO = { k: "bcrm-bus", v: 1 };
  const MANIFEST_K = "bcrm-bus-manifest";

  const STREAMS = {
    ideas: {
      dir: "in",
      file: "bus-ideas",
      label: "Idea bundles",
      kind: "idea",
      peerLabel: "idea source generator",
      placeholder: "e.g. idea-incubator",
      hint: "Qualified leads you import from ideas your incubator publishes to the shared pipeline."
    },
    projects: {
      dir: "out",
      file: "bus-projects",
      label: "Project seeds",
      kind: "project-seed",
      consumerLabel: "consumed by project-master",
      hint: "Every deal you win publishes a project-seed bundle so a project tracker can pick it up."
    },
    customers: {
      dir: "out",
      file: "bus-customers",
      label: "Customer records",
      kind: "customer",
      consumerLabel: "consumed by the-ledger and the ERP",
      hint: "New customers are published so billing and the ERP can set them up."
    },
    receivables: {
      dir: "in",
      file: "bus-receivables",
      label: "Receivable status",
      kind: "receivable",
      peerLabel: "receivable source generators",
      placeholder: "e.g. the-ledger, erp",
      hint: "Payment status bundles from your ledger/ERP are matched to customers and shown on their record."
    }
  };

  const STREAM_ORDER = ["ideas", "projects", "customers", "receivables"];

  let injected = null;

  function setTransport(t) {
    injected = t || null;
  }

  function defaultTransport() {
    const r = typeof window !== "undefined" ? window.root : null;
    if (!r || !r.kv || !r.uploadPlugin || !r.uploadPlugin.editable) return null;
    return {
      kv: {
        get: k => r.kv.bcrm.get(k),
        set: (k, v) => r.kv.bcrm.set(k, v),
        delete: k => r.kv.bcrm.delete(k)
      },
      editable: {
        get: name => r.uploadPlugin.editable.get(name),
        set: (name, text, o) => r.uploadPlugin.editable.set(name, text, o || {})
      },
      genName: window.generatorName || "",
      readPeer: null
    };
  }

  function transport() {
    return injected || defaultTransport();
  }

  function hasTransport() {
    return !!(injected || (typeof window !== "undefined" && window.root && window.root.kv && window.root.uploadPlugin && window.root.uploadPlugin.editable));
  }

  function esc(s) {
    return String(s === undefined || s === null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function nowISO() {
    return new Date().toISOString();
  }

  function randHex(n) {
    return BS && BS.randHex ? BS.randHex(n) : Math.floor(Math.random() * Math.pow(16, n)).toString(16).padStart(n, "0");
  }

  function newBundleId() {
    return "bs-" + randHex(8);
  }

  function num(v) {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return isFinite(n) && n >= 0 ? n : null;
  }

  function normalizeName(s) {
    return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }

  function busDocRecords(content) {
    return content && Array.isArray(content.records) ? content.records : [];
  }

  function findRec(content, id) {
    return busDocRecords(content).find(r => r && r.id === id) || null;
  }

  function upsertRec(content, rec) {
    if (!Array.isArray(content.records)) content.records = [];
    const i = content.records.findIndex(r => r && r.id === rec.id);
    if (i >= 0) content.records[i] = rec;
    else content.records.push(rec);
    return true;
  }

  async function loadBus(store, opts) {
    const doc = await store.loadDoc("bus", opts || {});
    if (!doc || doc.ok === false) return { ok: false, code: "load_failed", detail: (doc && doc.detail) || "the bus document could not be read", doc };
    if (!doc.content || typeof doc.content !== "object") doc.content = { records: [] };
    if (!Array.isArray(doc.content.records)) doc.content.records = [];
    return { ok: true, doc };
  }

  async function busUpdate(store, updater) {
    const out = await R.persistUpdate(store, "bus", updater, { events: false });
    return out;
  }

  function defaultCfg() {
    return {
      id: "buscfg",
      kind: "cfg",
      createdAt: null,
      updatedAt: null,
      ideasPeer: "",
      receivablePeers: ""
    };
  }

  async function ensureConfig(store) {
    const loaded = await loadBus(store, { refresh: true });
    if (!loaded.ok) return defaultCfg();
    const found = findRec(loaded.doc.content, "buscfg");
    if (found && found.kind === "cfg") {
      return Object.assign(defaultCfg(), found);
    }
    return defaultCfg();
  }

  async function saveConfig(store, patch) {
    patch = patch || {};
    const loaded = await loadBus(store, { refresh: true });
    if (!loaded.ok) return loaded;
    const cfg = Object.assign(defaultCfg(), findRec(loaded.doc.content, "buscfg"));
    Object.keys(patch).forEach(k => {
      if (k in cfg && k !== "id") cfg[k] = patch[k];
    });
    cfg.updatedAt = nowISO();
    if (!cfg.createdAt) cfg.createdAt = cfg.updatedAt;
    const res = await busUpdate(store, content => {
      upsertRec(content, cfg);
      return { changed: true, content };
    });
    return res && res.ok ? { ok: true, cfg } : res || { ok: false, code: "save_failed" };
  }

  function peersFor(streamId, cfg) {
    if (streamId === "ideas") {
      return String(cfg.ideasPeer || "").split(",").map(s => s.trim()).filter(Boolean);
    }
    if (streamId === "receivables") {
      return String(cfg.receivablePeers || "").split(",").map(s => s.trim()).filter(Boolean);
    }
    return [];
  }

  async function readPeerFile(peerGen, file) {
    const t = transport();
    if (!t) return { ok: false, code: "no_transport" };
    if (t.readPeer) {
      try {
        const r = await t.readPeer(peerGen, file);
        if (r && r.ok) return { ok: true, text: r.text, peer: peerGen };
        return r || { ok: false, code: "read_failed", peer: peerGen };
      } catch (e) {
        return { ok: false, code: "read_failed", detail: (e && e.message) || String(e), peer: peerGen };
      }
    }
    if (!peerGen) return { ok: false, code: "not_configured" };
    const url = "https://editable.uploads.dev/file/" + encodeURIComponent(String(peerGen).toLowerCase()) + "/" + encodeURIComponent(file);
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), 9000) : null;
    try {
      const resp = await fetch(url, ctrl ? { signal: ctrl.signal } : {});
      if (timer) clearTimeout(timer);
      if (resp.status === 404) return { ok: false, code: "not_found", peer: peerGen, url };
      if (!resp.ok) return { ok: false, code: "http_" + resp.status, peer: peerGen, url };
      const text = await resp.text();
      return { ok: true, text, peer: peerGen, url };
    } catch (e) {
      if (timer) clearTimeout(timer);
      const msg = (e && e.message) || String(e);
      return { ok: false, code: msg && msg.indexOf("abort") !== -1 ? "timeout" : "net_error", detail: msg, peer: peerGen, url };
    }
  }

  function parseEnvelope(text, streamId) {
    let env;
    try {
      env = JSON.parse(text);
    } catch (e) {
      return { ok: false, code: "bad_json", detail: "the stream file is not valid JSON" };
    }
    if (!env || env.k !== PROTO.k) return { ok: false, code: "bad_envelope", detail: "the stream file is missing the bus envelope marker" };
    if (env.v !== 1) return { ok: false, code: "bad_envelope", detail: "unsupported envelope version " + env.v };
    if (streamId && env.stream && env.stream !== streamId) return { ok: false, code: "stream_mismatch", detail: 'expected stream "' + streamId + '", found "' + env.stream + '"' };
    const arr = Array.isArray(env.bundles) ? env.bundles : [];
    const bundles = arr.filter(b => b && typeof b === "object" && b.id !== undefined && b.id !== null);
    return { ok: true, env, bundles };
  }

  async function readOnePeer(store, streamId, peer) {
    const def = STREAMS[streamId];
    const t = transport();
    let file = def.file;
    const manifestRes = await readPeerFile(peer, MANIFEST_FILE);
    if (manifestRes.ok) {
      const m = parseManifest(manifestRes.text);
      if (m.ok && m.manifest.streams && m.manifest.streams[streamId] && m.manifest.streams[streamId].file) {
        file = m.manifest.streams[streamId].file;
      }
    }
    const res = await readPeerFile(peer, file);
    if (!res.ok) {
      return { ok: false, peer, file, code: res.code, detail: res.detail, url: res.url };
    }
    const parsed = parseEnvelope(res.text, streamId);
    if (!parsed.ok) return { ok: false, peer, file, code: parsed.code, detail: parsed.detail };
    const kindBundles = parsed.bundles.filter(b => !def.kind || !b.kind || b.kind === def.kind || (streamId === "ideas" && b.kind === "idea"));
    return { ok: true, peer, file, bundles: kindBundles, env: parsed.env, generator: parsed.env.generator || peer };
  }

  function parseManifest(text) {
    let m;
    try {
      m = JSON.parse(text);
    } catch (e) {
      return { ok: false, code: "bad_json" };
    }
    if (!m || m.k !== MANIFEST_K || typeof m.streams !== "object" || m.streams === null) return { ok: false, code: "bad_manifest" };
    return { ok: true, manifest: m };
  }

  async function pullInbound(store, streamId) {
    const cfg = await ensureConfig(store);
    const peers = peersFor(streamId, cfg);
    if (!peers.length) {
      const res = { ok: false, code: "not_configured", peers: [], bundles: [], results: [] };
      await noteInlog(store, streamId, res);
      return res;
    }
    const results = [];
    const byId = new Map();
    for (const peer of peers) {
      const r = await readOnePeer(store, streamId, peer);
      results.push(r);
      if (r.ok) {
        for (const b of r.bundles) {
          const prev = byId.get(b.id);
          if (!prev || String(prev.at || "") < String(b.at || "")) byId.set(b.id, b);
        }
      }
    }
    const bundles = Array.from(byId.values());
    const res = {
      ok: results.some(r => r.ok),
      peers,
      results,
      bundles,
      code: results.some(r => r.ok) ? null : results[0] ? results[0].code : "not_configured"
    };
    await noteInlog(store, streamId, res);
    return res;
  }

  async function noteInlog(store, streamId, res) {
    try {
      const rec = {
        id: "inlog-" + streamId,
        kind: "inlog",
        stream: streamId,
        lastPullAt: nowISO(),
        ok: !!res.ok,
        code: res.code || (res.ok ? "ok" : "error"),
        count: res.bundles ? res.bundles.length : 0,
        peers: res.peers || [],
        detail: (res.results || []).map(r => (r.ok ? r.peer + " → " + r.bundles.length : r.peer + " → " + (r.code || "error"))).join("; ") || null,
        unmatched: res.unmatched || []
      };
      await busUpdate(store, content => {
        upsertRec(content, rec);
        return { changed: true, content };
      });
    } catch (e) {}
  }

  async function importedState(store) {
    const loaded = await loadBus(store);
    if (!loaded.ok) return { byBundle: {}, byLead: {} };
    const byBundle = {};
    const byLead = {};
    for (const r of busDocRecords(loaded.doc.content)) {
      if (r && r.kind === "imp") {
        byBundle[r.bundleId] = r;
        if (r.leadId) byLead[r.leadId] = r;
      }
    }
    return { byBundle, byLead };
  }

  function composeNotes(idea, bundleId) {
    const lines = [];
    lines.push("Imported from the idea-incubator bus stream (idea " + (idea.id || "?") + ", bundle " + bundleId + ").");
    const desc = String(idea.description || idea.desc || "").trim();
    if (desc) lines.push("", desc);
    const goals = Array.isArray(idea.goals) ? idea.goals.map(g => String(g).trim()).filter(Boolean) : (String(idea.goals || "").split("\n").map(s => s.trim()).filter(Boolean));
    if (goals.length) lines.push("", "Goals: " + goals.join(" · "));
    const scope = Array.isArray(idea.scope) ? idea.scope.map(s => String(s).trim()).filter(Boolean) : (String(idea.scope || "").split("\n").map(s => s.trim()).filter(Boolean));
    if (scope.length) lines.push("", "Suggested next steps (from the idea's scope):", "");
    lines.push.apply(lines, scope.map(s => "• " + s));
    return lines.join("\n").trim();
  }

  async function importIdea(store, bundle, opts) {
    opts = opts || {};
    if (!bundle || !bundle.id) return { ok: false, code: "bad_bundle", detail: "That idea bundle has no id." };
    const idea = bundle.payload || bundle;
    const st = await importedState(store);
    if (st.byBundle[bundle.id]) {
      const rec = st.byBundle[bundle.id];
      return { ok: false, code: "already_imported", leadId: rec.leadId, detail: "This idea was already imported as a lead." };
    }
    const leadsDoc = await store.loadDoc("leads", { refresh: true });
    if (leadsDoc && leadsDoc.ok && leadsDoc.content) {
      for (const r of R.recordsOf(leadsDoc.content)) {
        if (r && r.busIdea && String(r.busIdea.bundleId) === String(bundle.id)) {
          return { ok: false, code: "already_imported", leadId: r.id, detail: "This idea was already imported as a lead." };
        }
      }
    }
    const title = String(idea.title || idea.name || "Untitled idea").trim() || "Untitled idea";
    const notes = composeNotes(idea, bundle.id);
    const at = nowISO();
    const lead = {
      id: R.newId("leads"),
      name: title,
      source: "Idea incubator",
      status: "qualified",
      notes: notes || undefined,
      busIdea: { bundleId: bundle.id, ideaId: idea.id !== undefined ? String(idea.id) : String(bundle.id), sourceGen: bundle.sourceGen || opts.sourceGen || null, importedAt: at },
      createdAt: at,
      updatedAt: at,
      events: [
        { kind: "create", at },
        { kind: "status", from: "new", to: "qualified", at, note: "Imported from the idea-incubator bus stream (bundle " + bundle.id + ")." }
      ]
    };
    let createdId = null;
    const res = await R.persistUpdate(store, "leads", content => {
      let attempts = 0;
      while (R.getRecord(content, lead.id) && attempts < 6) {
        lead.id = R.newId("leads");
        attempts++;
      }
      if (attempts >= 6) return { changed: false };
      R.upsertRecord(content, lead);
      createdId = lead.id;
      return { changed: true, content };
    });
    if (!res || !res.ok) return res || { ok: false, code: "lead_save_failed" };
    const impRec = { id: "imp-" + bundle.id, kind: "imp", stream: "ideas", bundleId: String(bundle.id), leadId: createdId, ideaId: idea.id !== undefined ? String(idea.id) : String(bundle.id), at };
    try {
      await busUpdate(store, content => {
        upsertRec(content, impRec);
        return { changed: true, content };
      });
    } catch (e) {}
    return { ok: true, leadId: createdId };
  }

  function snapshotCompany(rec) {
    if (!rec) return null;
    return {
      id: rec.id,
      name: rec.name,
      industry: rec.industry || null,
      website: rec.website || null,
      taxId: rec.taxId || null,
      paymentTerms: rec.paymentTerms || null,
      address: rec.address || null,
      tags: Array.isArray(rec.tags) ? rec.tags : [],
      active: rec.active !== false,
      isCustomer: rec.isCustomer === true
    };
  }

  function snapshotContact(rec) {
    if (!rec) return null;
    return {
      id: rec.id,
      name: rec.name,
      role: rec.role || null,
      email: rec.email || null,
      phone: rec.phone || null,
      active: rec.active !== false
    };
  }

  async function primaryContactFor(store, companyId) {
    try {
      const doc = await store.loadDoc("contacts");
      if (!doc || !doc.ok) return null;
      const mine = R.recordsOf(doc.content).filter(c => c && String(c.companyId) === String(companyId) && c.active !== false);
      if (!mine.length) return null;
      mine.sort((a, b) => {
        const ae = a.email ? 0 : 1;
        const be = b.email ? 0 : 1;
        if (ae !== be) return ae - be;
        return String(a.name || "").localeCompare(String(b.name || ""));
      });
      return snapshotContact(mine[0]);
    } catch (e) {
      return null;
    }
  }

  async function outRecordsFor(store, streamId) {
    const loaded = await loadBus(store);
    if (!loaded.ok) return [];
    return busDocRecords(loaded.doc.content)
      .filter(r => r && r.kind === "out" && (!streamId || r.stream === streamId))
      .sort((a, b) => String(a.at || "").localeCompare(String(b.at || "")));
  }

  function envelopeOf(streamId, bundles, genName) {
    const env = Object.assign({}, PROTO, {
      stream: streamId,
      generator: genName || null,
      updatedAt: bundles.length ? (bundles[bundles.length - 1].at || nowISO()) : nowISO(),
      bundles
    });
    return JSON.stringify(env);
  }

  async function materialize(store, streamId) {
    const def = STREAMS[streamId];
    if (!def || def.dir !== "out") return { ok: false, code: "not_out_stream", detail: "Only outbound streams are published to files." };
    const t = transport();
    if (!t) return { ok: false, code: "no_transport", detail: "The bus transport is unavailable — kv-plugin and upload-plugin must be imported in main.pjs." };
    const outRecs = await outRecordsFor(store, streamId);
    if (!outRecs.length) return { ok: true, noop: true, detail: "No " + def.label.toLowerCase() + " are waiting to be published." };
    const ours = outRecs.map(r => r.bundle).filter(b => b && b.id);
    const file = def.file;
    let cur = { bundles: [] };
    let curText = null;
    let curError = null;
    try {
      curText = await t.editable.get(file);
    } catch (e) {
      curError = { ok: false, code: "read_failed", detail: (e && e.message) || String(e) };
    }
    if (curError) return curError;
    if (curText) {
      const parsed = parseEnvelope(curText, streamId);
      if (parsed.ok) cur = parsed;
      else cur = { bundles: [] };
    }
    const seen = new Set();
    const merged = [];
    for (const b of cur.bundles) {
      if (!seen.has(b.id)) {
        seen.add(b.id);
        merged.push(b);
      }
    }
    let added = 0;
    for (const b of ours) {
      if (!seen.has(b.id)) {
        seen.add(b.id);
        merged.push(b);
        added++;
      }
    }
    async function markMirrored(errText) {
      const mirroredAt = nowISO();
      const mr = await busUpdate(store, content => {
        let changed = false;
        for (const r of busDocRecords(content)) {
          if (r && r.kind === "out" && r.stream === streamId && r.status !== "mirrored") {
            if (errText) r.lastError = errText;
            else {
              r.status = "mirrored";
              r.mirroredAt = mirroredAt;
              delete r.lastError;
            }
            changed = true;
          }
        }
        return { changed, content };
      });
      return mr;
    }
    if (!added) {
      const havePending = outRecs.some(r => r.status !== "mirrored");
      if (havePending) await markMirrored(null);
      return { ok: true, noop: true, count: merged.length, detail: "Everything is already published (" + merged.length + " bundle" + (merged.length === 1 ? "" : "s") + " in the stream file)." };
    }
    const body = envelopeOf(streamId, merged, t.genName || null);
    const cachedKey = await t.kv.get("bus-ek:" + file);
    let res;
    try {
      res = await t.editable.set(file, body, cachedKey ? { editKey: cachedKey } : {});
    } catch (e) {
      const msg = (e && e.message) || String(e);
      await markMirrored(msg);
      return { ok: false, code: normalizeBusError(msg), detail: msg };
    }
    if (res && res.error) {
      await markMirrored(String(res.error));
      return { ok: false, code: normalizeBusError(res.error), detail: String(res.error) };
    }
    if (res && res.superseded) {
      return { ok: false, code: "superseded", detail: "This write was superseded by another queued write to the same stream file. It will be retried automatically." };
    }
    if (res && res.editKey && !cachedKey) {
      try { await t.kv.set("bus-ek:" + file, res.editKey); } catch (e) {}
    }
    const markRes = await markMirrored(null);
    await publishManifest(store, streamId, merged.length);
    const out = { ok: true, added, count: merged.length, file, publicUrl: publicUrlOf(t, file) };
    if (markRes && markRes.ok === false) out.markError = markRes;
    return out;
  }

  function publicUrlOf(t, file) {
    if (!t || !t.genName) return null;
    return "https://editable.uploads.dev/file/" + t.genName + "/" + file;
  }

  async function publishManifest(store, changedStream, count) {
    try {
      const t = transport();
      if (!t || !t.genName) return;
      const manifest = { k: MANIFEST_K, v: 1, generator: t.genName, updatedAt: nowISO(), streams: {} };
      for (const id of STREAM_ORDER) {
        const def = STREAMS[id];
        if (def.dir !== "out") continue;
        const recs = await outRecordsFor(store, id);
        manifest.streams[id] = {
          file: def.file,
          label: def.label,
          count: recs.filter(r => r.status === "mirrored").length,
          lastAt: recs.length ? recs[recs.length - 1].at : null
        };
      }
      const body = JSON.stringify(manifest);
      const cachedKey = await t.kv.get("bus-ek:" + MANIFEST_FILE);
      const res = await t.editable.set(MANIFEST_FILE, body, cachedKey ? { editKey: cachedKey } : {});
      if (res && res.editKey && !cachedKey) await t.kv.set("bus-ek:" + MANIFEST_FILE, res.editKey);
    } catch (e) {}
  }

  function normalizeBusError(msg) {
    const s = String(msg || "").toLowerCase();
    if (s.indexOf("key") !== -1) return "no_edit_key";
    if (s.indexOf("saved") !== -1) return "requires_saved_generator";
    if (s.indexOf("large") !== -1 || s.indexOf("big") !== -1) return "file_too_big";
    if (s.indexOf("allowance") !== -1 || s.indexOf("quota") !== -1) return "over_daily_allowance";
    return "editable_error";
  }

  const inFlight = new Set();

  async function publishProjectSeed(store, deal, opts) {
    opts = opts || {};
    if (!deal || !deal.id || deal.stage !== WON) return { ok: false, code: "not_won", detail: "Only a won deal is handed off." };
    if (deal.busHandoff) return { ok: true, noop: true, detail: "This deal was already handed off." };
    const guardKey = "deals:" + deal.id;
    if (inFlight.has(guardKey)) return { ok: false, code: "busy", detail: "A handoff for this deal is already in progress." };
    inFlight.add(guardKey);
    try {
      const at = nowISO();
      const bundleId = opts.id || newBundleId();
      let flagApplied = false;
      const cas = await R.persistUpdate(store, "deals", content => {
        const r = R.getRecord(content, deal.id);
        if (!r) return { changed: false };
        if (r.stage !== WON) return { changed: false };
        if (r.busHandoff) return { changed: false };
        r.busHandoff = { bundleId, at, status: "pending" };
        r.updatedAt = at;
        flagApplied = true;
        return { changed: true, content };
      }, { events: false });
      if (!cas || !cas.ok) return cas || { ok: false, code: "cas_failed" };
      if (!flagApplied) return { ok: true, noop: true, detail: "This deal was already handed off." };
      const companyRec = deal.companyId ? await companyById(store, deal.companyId) : null;
      const contact = deal.companyId ? await primaryContactFor(store, deal.companyId) : null;
      const bundle = {
        id: bundleId,
        at,
        kind: "project-seed",
        opportunity: {
          id: deal.id,
          name: deal.name || "Untitled deal",
          expectedValue: deal.expectedValue !== undefined ? deal.expectedValue : null,
          closeDate: deal.closeDate || null,
          wonAt: deal.wonAt || at,
          owner: deal.owner || null
        },
        company: snapshotCompany(companyRec),
        contact
      };
      const outRec = {
        id: "out-" + bundleId,
        kind: "out",
        stream: "projects",
        bundleId,
        dealId: deal.id,
        at,
        status: "pending",
        summary: { name: deal.name || "Untitled deal", value: deal.expectedValue, at },
        bundle
      };
      const docRes = await busUpdate(store, content => {
        const same = busDocRecords(content).some(r => r && r.kind === "out" && r.stream === "projects" && r.dealId === deal.id);
        if (same) return { changed: false };
        upsertRec(content, outRec);
        if (content.records.length > 400) {
          const mirrored = content.records.filter(r => r.kind === "out" && r.status === "mirrored");
          if (mirrored.length > 200) {
            mirrored.sort((a, b) => String(a.at || "").localeCompare(String(b.at || "")));
            const drop = new Set(mirrored.slice(0, mirrored.length - 200).map(r => r.id));
            content.records = content.records.filter(r => !drop.has(r.id));
          }
        }
        return { changed: true, content };
      });
      const mat = await materialize(store, "projects");
      return { ok: true, bundleId, dealId: deal.id, queued: mat && mat.ok === false, materialize: mat };
    } finally {
      inFlight.delete(guardKey);
    }
  }

  async function companyById(store, id) {
    try {
      const doc = await store.loadDoc("companies", { refresh: true });
      if (!doc || !doc.ok) return null;
      return R.getRecord(doc.content, id) || null;
    } catch (e) {
      return null;
    }
  }

  async function publishCustomer(store, company, opts) {
    opts = opts || {};
    if (!company || !company.id || company.isCustomer !== true) return { ok: false, code: "not_customer", detail: "Only a customer record is published." };
    if (company.busCustomer) return { ok: true, noop: true, detail: "This company was already published as a customer." };
    const guardKey = "companies:" + company.id;
    if (inFlight.has(guardKey)) return { ok: false, code: "busy", detail: "A publication for this company is already in progress." };
    inFlight.add(guardKey);
    try {
      const at = nowISO();
      const bundleId = opts.id || newBundleId();
      let flagApplied = false;
      const cas = await R.persistUpdate(store, "companies", content => {
        const r = R.getRecord(content, company.id);
        if (!r) return { changed: false };
        if (r.isCustomer !== true) return { changed: false };
        if (r.busCustomer) return { changed: false };
        r.busCustomer = { bundleId, at, status: "pending" };
        r.updatedAt = at;
        flagApplied = true;
        return { changed: true, content };
      }, { events: false });
      if (!cas || !cas.ok) return cas || { ok: false, code: "cas_failed" };
      if (!flagApplied) return { ok: true, noop: true, detail: "This company was already published as a customer." };
      const contact = await primaryContactFor(store, company.id);
      const bundle = {
        id: bundleId,
        at,
        kind: "customer",
        isCustomer: true,
        customerSince: company.customerSince || at,
        company: snapshotCompany(company),
        contact
      };
      const outRec = {
        id: "out-" + bundleId,
        kind: "out",
        stream: "customers",
        bundleId,
        companyId: company.id,
        at,
        status: "pending",
        summary: { name: company.name || "Untitled company", at },
        bundle
      };
      await busUpdate(store, content => {
        const same = busDocRecords(content).some(r => r && r.kind === "out" && r.stream === "customers" && r.companyId === company.id);
        if (same) return { changed: false };
        upsertRec(content, outRec);
        return { changed: true, content };
      });
      const mat = await materialize(store, "customers");
      return { ok: true, bundleId, companyId: company.id, queued: mat && mat.ok === false, materialize: mat };
    } finally {
      inFlight.delete(guardKey);
    }
  }

  function healthOf(b) {
    const amount = num(b.amount);
    const paid = num(b.paid);
    const balance = num(b.balance);
    const status = String(b.status || "").toLowerCase();
    let health;
    if (status === "paid" || (amount !== null && paid !== null && amount > 0 && paid >= amount - 0.005) || balance === 0) health = "paid";
    else if (status === "overdue" || (b.overdue === true)) health = "overdue";
    else if (paid !== null && paid > 0) health = "partial";
    else health = "open";
    const labels = { paid: "Paid", partial: "Partially paid", overdue: "Overdue", open: "Open" };
    return { health, label: labels[health] || health, amount, paid, balance: balance !== null ? balance : (amount !== null && paid !== null ? Math.max(0, amount - paid) : null), dueDate: b.dueDate || null };
  }

  async function pullReceivables(store, opts) {
    opts = opts || {};
    const pull = await pullInbound(store, "receivables");
    const matched = [];
    const unmatched = [];
    let updatedAny = false;
    const bundles = opts.companyId ? pull.bundles.filter(b => {
      const comp = b.company || b.payload || {};
      return comp.id === opts.companyId || normalizeName(comp.name) === normalizeName(opts.companyName || "");
    }) : pull.bundles;
    for (const bundle of bundles) {
      const compInfo = bundle.company || bundle.payload || {};
      const company = await matchCompany(store, compInfo, opts.companyId);
      if (!company) {
        unmatched.push({ bundleId: bundle.id, name: compInfo.name || compInfo.id || "(unnamed)", reason: "no matching customer" });
        continue;
      }
      const h = healthOf(bundle);
      const payment = {
        status: h.health,
        label: h.label,
        amount: h.amount,
        paid: h.paid,
        balance: h.balance,
        dueDate: h.dueDate || null,
        source: bundle.sourceGen || pull.peers[0] || "shared pipeline",
        bundleId: bundle.id,
        at: bundle.at || nowISO(),
        pulledAt: nowISO()
      };
      const setRes = await R.persistUpdate(store, "companies", content => {
        const r = R.getRecord(content, company.id);
        if (!r) return { changed: false };
        const prev = r.busPayment;
        if (prev && prev.bundleId === bundle.id && prev.status === h.health && prev.pulledAt === payment.pulledAt) return { changed: false };
        r.busPayment = payment;
        return { changed: true, content };
      }, { events: false });
      if (setRes && setRes.ok) updatedAny = true;
      matched.push({ companyId: company.id, name: company.name, health: h.health, label: h.label, bundleId: bundle.id, balance: payment.balance, dueDate: payment.dueDate, source: payment.source });
      try {
        await busUpdate(store, content => {
          const rcv = { id: "rcv-" + company.id, kind: "rcv", companyId: company.id, companyName: company.name, health: h.health, bundleId: bundle.id, source: payment.source, at: bundle.at || nowISO(), pulledAt: payment.pulledAt };
          upsertRec(content, rcv);
          return { changed: true, content };
        });
      } catch (e) {}
    }
    pull.matched = matched;
    pull.unmatched = unmatched.slice(0, 20);
    pull.updated = updatedAny;
    if (opts.companyId) return { ok: matched.length ? true : false, code: matched.length ? null : "no_matches", matched, unmatched, pulled: pull };
    return pull;
  }

  async function matchCompany(store, compInfo, hintId) {
    try {
      const doc = await store.loadDoc("companies", { refresh: true });
      if (!doc || !doc.ok) return null;
      const recs = R.recordsOf(doc.content);
      if (hintId) {
        const byId = recs.find(r => String(r.id) === String(hintId));
        if (byId) return byId;
      }
      const id = compInfo && compInfo.id !== undefined && compInfo.id !== null ? String(compInfo.id) : null;
      if (id) {
        const byId = recs.find(r => String(r.id) === id);
        if (byId) return byId;
      }
      const taxId = compInfo && compInfo.taxId ? String(compInfo.taxId).trim().toLowerCase() : null;
      if (taxId) {
        const byTax = recs.find(r => r.taxId && String(r.taxId).trim().toLowerCase() === taxId);
        if (byTax) return byTax;
      }
      const name = compInfo && compInfo.name ? normalizeName(compInfo.name) : null;
      if (name) {
        const byName = recs.find(r => normalizeName(r.name) === name);
        if (byName) return byName;
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  function describe(code) {
    const map = {
      not_configured: "No peer generator is configured for this stream yet — set it in Connections above.",
      not_found: "The peer has not published a stream file yet. Nothing to pull — this is fine until the other generator publishes.",
      timeout: "The peer's stream file did not respond in time. Check that the generator name is right and try again.",
      net_error: "The peer's stream file could not be reached. Check your connection and the generator name.",
      bad_json: "The stream file is not valid JSON — the peer may be mid-write; try again shortly.",
      bad_envelope: "The stream file does not look like a bus stream. Is the peer generator name correct?",
      stream_mismatch: "The stream file is for a different stream. Is the peer generator name correct?",
      bad_manifest: "The peer's manifest could not be read; falling back to the conventional stream file name.",
      no_edit_key: "This device has no write key for the stream file — the device that first published it must publish updates. Other devices queue bundles locally and they will appear once this device next publishes.",
      requires_saved_generator: "Save this generator first (via the editor) to enable pipeline publishing.",
      file_too_big: "The stream file is too large to update. Archive old published bundles before continuing.",
      over_daily_allowance: "Today's storage allowance is used up. The bundles stay queued and will publish when allowance resets.",
      superseded: "Another write to the same stream file was committed just now; this one was queued and will be retried automatically.",
      editable_error: "The stream file could not be written. The bundle stays queued — open Integrations to retry.",
      busy: "That action is already running — wait a moment for it to finish before trying again.",
      no_transport: "The pipeline transport is unavailable (kv-plugin and upload-plugin must be imported in main.pjs).",
      read_failed: "The peer's stream file could not be read. Check the generator name in Connections and retry the pull.",
      bad_bundle: "A published bundle was malformed and was skipped; the rest were processed normally.",
      already_imported: "This idea has already been imported as a lead, so it will not be imported twice.",
      lead_save_failed: "The imported lead could not be saved. Resolve any pending sync conflicts on the Dashboard, then retry the import.",
      not_out_stream: "Only outbound streams are published to files.",
      not_won: "Only a won deal can be handed off — move the deal to Won first.",
      not_customer: "Only a customer record is published — mark the company as a customer first.",
      cas_failed: "Another change landed on the same document while this was saving. Nothing was lost — retry."
    };
    return map[code] || null;
  }

  async function onModuleWrite(store, data) {
    try {
      if (!data || !data.module || !Array.isArray(data.changes) || !data.changes.length) return;
      if (data.module === "deals") {
        for (const ch of data.changes) {
          const prev = ch && ch.prev ? ch.prev : {};
          const next = ch && ch.next;
          if (!next || !next.id) continue;
          if (prev.stage !== WON && next.stage === WON && !next.busHandoff) {
            await publishProjectSeed(store, next);
          }
        }
      } else if (data.module === "companies") {
        for (const ch of data.changes) {
          const prev = ch && ch.prev ? ch.prev : {};
          const next = ch && ch.next;
          if (!next || !next.id) continue;
          if (prev.isCustomer !== true && next.isCustomer === true && !next.busCustomer) {
            await publishCustomer(store, next);
          }
        }
      }
    } catch (e) {
      console.error("Pipeline bus write handler failed:", e);
    }
  }

  async function statusSummary(store) {
    const loaded = await loadBus(store);
    const cfg = Object.assign(defaultCfg(), findRec(loaded.ok ? loaded.doc.content : { records: [] }, "buscfg"));
    const out = { cfg, streams: {} };
    const byStream = {};
    for (const id of STREAM_ORDER) {
      byStream[id] = { dir: STREAMS[id].dir, out: [], inlog: null };
    }
    if (loaded.ok) {
      for (const r of busDocRecords(loaded.doc.content)) {
        if (r && r.kind === "out" && byStream[r.stream]) byStream[r.stream].out.push(r);
        else if (r && r.kind === "inlog" && byStream[r.stream]) byStream[r.stream].inlog = r;
      }
    }
    for (const id of STREAM_ORDER) {
      const s = byStream[id];
      if (s.dir === "out") {
        const total = s.out.length;
        const mirrored = s.out.filter(r => r.status === "mirrored").length;
        const pending = s.out.filter(r => r.status !== "mirrored");
        const last = s.out.length ? s.out[s.out.length - 1] : null;
        out.streams[id] = { dir: "out", total, mirrored, pendingCount: pending.length, last, lastError: pending.length && last && last.lastError ? last.lastError : null, file: STREAMS[id].file };
      } else {
        out.streams[id] = { dir: "in", inlog: s.inlog, peer: peersFor(id, cfg).join(", ") || null, file: STREAMS[id].file };
      }
    }
    return out;
  }

  async function resetStreamFile(store, streamId) {
    const def = STREAMS[streamId];
    if (!def || def.dir !== "out") return { ok: false, code: "not_out_stream" };
    const t = transport();
    if (!t) return { ok: false, code: "no_transport" };
    const body = envelopeOf(streamId, [], t.genName || null);
    const cachedKey = await t.kv.get("bus-ek:" + def.file);
    try {
      const res = await t.editable.set(def.file, body, cachedKey ? { editKey: cachedKey } : {});
      if (res && res.error) return { ok: false, code: normalizeBusError(res.error), detail: String(res.error) };
      return { ok: true };
    } catch (e) {
      return { ok: false, code: normalizeBusError((e && e.message) || String(e)), detail: (e && e.message) || String(e) };
    }
  }

  async function refreshCompanyPayment(store, companyId) {
    const res = await pullReceivables(store, { companyId });
    const doc = await store.loadDoc("companies");
    const rec = doc && doc.ok ? R.getRecord(doc.content, companyId) : null;
    return { pull: res, payment: rec ? rec.busPayment || null : null };
  }

  return {
    MANIFEST_FILE,
    STREAMS,
    STREAM_ORDER,
    PROTO,
    setTransport,
    transport,
    hasTransport,
    ensureConfig,
    saveConfig,
    defaultCfg,
    readPeerFile,
    pullInbound,
    pullReceivables,
    importIdea,
    importedState,
    materialize,
    publishProjectSeed,
    publishCustomer,
    onModuleWrite,
    statusSummary,
    describe,
    healthOf,
    matchCompany,
    resetStreamFile,
    refreshCompanyPayment,
    publicUrlOf,
    esc,
    normalizeName,
    newBundleId
  };
})();

(function () {
  if (typeof window === "undefined") return;
  window.CRM_BOOT_HOOKS = window.CRM_BOOT_HOOKS || [];
  window.CRM_BOOT_HOOKS.push(async store => {
    if (window.CRM_BUS && window.CRM_EVENTS && !window.__busSubscribed) {
      window.__busSubscribed = true;
      window.CRM_EVENTS.on("moduleWrite", data => {
        if (data && data.store && data.store !== store) return;
        window.CRM_BUS.onModuleWrite(store, data);
      });
    }
  });
})();
