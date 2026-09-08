window.CRM_RENDERERS = window.CRM_RENDERERS || {};
window.CRM_RULES = (function () {
  const R = window.CRM_RECORDS;
  const A = window.CRM_ACTIVITIES;
  const U = window.RECORDUI;
  if (!R || !A || !U) return null;
  const MOD = "rules";
  const DAY = 86400000;

  const RESERVED = { id: 1, createdAt: 1, updatedAt: 1, dismissedNext: 1, dismissed: 1, closeReminderAfter: 1, closeReminderDismissed: 1, events: 1 };

  const FIELD_DEFS = {
    deals: [
      { f: "stage", label: "Pipeline stage", type: "stage" },
      { f: "owner", label: "Owner", type: "string" },
      { f: "expectedValue", label: "Expected value ($)", type: "num" },
      { f: "probability", label: "Probability (%)", type: "num" },
      { f: "closeDate", label: "Close date", type: "date" },
      { f: "name", label: "Name", type: "string" },
      { f: "daysSinceLastActivity", label: "Days since last activity", type: "num", scan: true },
      { f: "custom", label: "Custom field…", type: "custom" }
    ],
    leads: [
      { f: "status", label: "Status", type: "string", options: ["new", "contacted", "qualified", "converted", "disqualified"] },
      { f: "source", label: "Source", type: "string" },
      { f: "owner", label: "Owner", type: "string" },
      { f: "name", label: "Name", type: "string" },
      { f: "daysSinceLastActivity", label: "Days since last activity", type: "num", scan: true },
      { f: "custom", label: "Custom field…", type: "custom" }
    ],
    companies: [
      { f: "isCustomer", label: "Is a customer", type: "bool" },
      { f: "active", label: "Active", type: "bool" },
      { f: "industry", label: "Industry", type: "string" },
      { f: "employees", label: "Company size band", type: "num" },
      { f: "name", label: "Name", type: "string" },
      { f: "daysSinceLastActivity", label: "Days since last activity", type: "num", scan: true },
      { f: "custom", label: "Custom field…", type: "custom" }
    ],
    contacts: [
      { f: "active", label: "Active", type: "bool" },
      { f: "consent", label: "Has communication consent", type: "bool" },
      { f: "role", label: "Role / title", type: "string" },
      { f: "email", label: "Email", type: "string" },
      { f: "name", label: "Name", type: "string" },
      { f: "daysSinceLastActivity", label: "Days since last activity", type: "num", scan: true },
      { f: "custom", label: "Custom field…", type: "custom" }
    ]
  };

  const OPS = [
    { id: "eq", label: "is" },
    { id: "ne", label: "is not" },
    { id: "contains", label: "contains" },
    { id: "gt", label: "is greater than" },
    { id: "gte", label: "is at least" },
    { id: "lt", label: "is less than" },
    { id: "lte", label: "is at most" },
    { id: "is_set", label: "is set" },
    { id: "is_empty", label: "is empty" },
    { id: "changed_to", label: "changed to" },
    { id: "changed_from", label: "changed from" }
  ];
  const WRITE_ONLY = { changed_to: 1, changed_from: 1 };
  const SCAN_FIELDS = { daysSinceLastActivity: 1 };

  const MODULES = [
    { id: "deals", label: "Deal" },
    { id: "leads", label: "Lead" },
    { id: "companies", label: "Company" },
    { id: "contacts", label: "Contact" }
  ];
  const MODULE_LABELS = { deals: "Deals", leads: "Leads", companies: "Companies", contacts: "Contacts" };

  function newId(p) {
    const hex = window.BcrmStore ? window.BcrmStore.randHex(6) : Math.floor(Math.random() * 0xffffff).toString(16);
    return p + "-" + hex;
  }
  function localDateISO(d) {
    const p = n => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }
  function num(v) {
    const n = Number(v);
    return v !== "" && v !== null && v !== undefined && isFinite(n) ? n : null;
  }
  function dateMs(v) {
    if (v === undefined || v === null || v === "") return null;
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d.getTime();
  }
  function daysSince(ms) {
    return ms ? (Date.now() - ms) / DAY : Infinity;
  }
  function fieldLabel(module, f) {
    const d = (FIELD_DEFS[module] || []).find(x => x.f === f);
    return d ? d.label : f;
  }
  function opLabel(op) {
    const o = OPS.find(x => x.id === op);
    return o ? o.label : op;
  }
  function textOf(v) {
    if (v === undefined || v === null) return "";
    return Array.isArray(v) ? v.join(" ") : String(v);
  }

  async function activityIndex(store) {
    if (window.CRM_SEGMENTS && window.CRM_SEGMENTS.activityIndex) {
      return window.CRM_SEGMENTS.activityIndex(store);
    }
    return { companies: {}, contacts: {}, leads: {}, deals: {} };
  }

  function stageMatchesAny(recVal, target, sctx) {
    const t = String(target).toLowerCase().trim();
    const vals = [recVal];
    if (sctx) {
      const id2l = sctx.idToLabel;
      const l2i = sctx.labelToId;
      const rl = String(recVal).toLowerCase();
      if (id2l && id2l[rl]) vals.push(id2l[rl]);
      if (l2i && l2i[rl]) vals.push(l2i[rl]);
    }
    return vals.some(v => String(v).toLowerCase().trim() === t);
  }

  function compareNumeric(a, b) {
    const na = num(a);
    const nb = num(b);
    if (na !== null && nb !== null) return [na, nb];
    const da = dateMs(typeof a === "string" ? a : null);
    const db = dateMs(typeof b === "string" ? b : null);
    if (da !== null && db !== null) return [da, db];
    return null;
  }

  function resolveRaw(rec, f, aidx, module) {
    if (f === "daysSinceLastActivity") {
      const map = (aidx && aidx[module]) || {};
      const last = rec && rec.id ? map[rec.id] : 0;
      return last ? daysSince(last) : Infinity;
    }
    return rec && rec.id !== undefined ? rec[f] : undefined;
  }

  function condMatches(cond, module, rec, prev, aidx, sctx) {
    const f = cond.f;
    const op = cond.op || "eq";
    const v = cond.v;
    if (!f) return false;
    const raw = resolveRaw(rec, f, aidx, module);
    const prevRaw = prev && prev.id !== undefined ? prev[f] : undefined;
    const isArr = Array.isArray(raw);
    const lower = textOf(raw).toLowerCase();
    const targetLower = String(v === undefined || v === null ? "" : v).toLowerCase().trim();

    if (module === "deals" && f === "stage") {
      if (op === "is_set") return raw !== undefined && raw !== null && raw !== "";
      if (op === "is_empty") return raw === undefined || raw === null || raw === "";
      if (op === "changed_to" || op === "changed_from") {
        const prevSet = prevRaw !== undefined && prevRaw !== null && prevRaw !== "";
        const nowSet = raw !== undefined && raw !== null && raw !== "";
        if (op === "changed_to") return nowSet && (!prevSet || !stageMatchesAny(prevRaw, v, sctx)) && stageMatchesAny(raw, v, sctx);
        return prevSet && stageMatchesAny(prevRaw, v, sctx) && !stageMatchesAny(raw, v, sctx);
      }
      if (op === "contains") return stageMatchesAny(raw, v, sctx) || String(raw).toLowerCase().indexOf(targetLower) !== -1;
      if (op === "ne") return !stageMatchesAny(raw, v, sctx);
      return stageMatchesAny(raw, v, sctx);
    }

    if (op === "changed_to" || op === "changed_from") {
      const eq = (a, b) => {
        const pair = compareNumeric(a, b);
        if (pair) return pair[0] === pair[1];
        if (Array.isArray(a) || Array.isArray(b)) return textOf(a).toLowerCase() === textOf(b).toLowerCase();
        return String(a === undefined || a === null ? "" : a).toLowerCase() === String(b === undefined || b === null ? "" : b).toLowerCase();
      };
      if (op === "changed_to") return eq(raw, v) && (prev === null || !eq(prevRaw, v));
      return !eq(raw, v) && prev !== null && eq(prevRaw, v);
    }
    if (op === "is_set") return !isArr ? raw !== undefined && raw !== null && raw !== "" : raw.length > 0;
    if (op === "is_empty") return !isArr ? raw === undefined || raw === null || raw === "" : raw.length === 0;
    if (op === "eq" || op === "ne") {
      if (isArr) {
        const hit = raw.some(x => String(x).toLowerCase().trim() === targetLower);
        return op === "eq" ? hit : !hit;
      }
      let eq = false;
      const pair = compareNumeric(raw, v);
      if (pair) eq = pair[0] === pair[1];
      else if (raw !== undefined && raw !== null) eq = String(raw).toLowerCase().trim() === targetLower;
      else eq = v === "" || v === null || v === undefined;
      return op === "eq" ? eq : !eq;
    }
    if (op === "contains") {
      return isArr ? raw.some(x => String(x).toLowerCase().includes(targetLower)) : lower.indexOf(targetLower) !== -1;
    }
    if (op === "gt" || op === "gte" || op === "lt" || op === "lte") {
      if (raw === undefined || raw === null || raw === "") return false;
      const pair = compareNumeric(raw, v);
      if (pair) {
        const [a, b] = pair;
        if (op === "gt") return a > b;
        if (op === "gte") return a >= b;
        if (op === "lt") return a < b;
        return a <= b;
      }
      if (op === "gt") return lower > targetLower;
      if (op === "gte") return lower >= targetLower;
      if (op === "lt") return lower < targetLower;
      return lower <= targetLower;
    }
    return false;
  }

  function validateRule(raw) {
    const errors = {};
    const name = String(raw.name || "").trim();
    if (!name) errors.name = "Give the rule a name.";
    const module = MODULES.some(m => m.id === raw.module) ? raw.module : "";
    if (!module) errors.module = "Pick what the rule watches.";
    const event = raw.event === "scan" ? "scan" : "write";
    const cond = raw.condition || {};
    const condF = String(cond.f || "").trim();
    if (!condF) errors.condition = "Pick a condition field.";
    const allowedOps = OPS.map(o => o.id);
    const op = allowedOps.indexOf(cond.op) !== -1 ? cond.op : "eq";
    if (WRITE_ONLY[op] && event !== "write") errors.condition = "\"" + opLabel(op) + "\" only works for save-triggered rules.";
    if (WRITE_ONLY[op] && event === "write" && (cond.v === undefined || String(cond.v).trim() === "")) {
      errors.condition = "Pick the value the field changes to/from.";
    }
    const needVal = ["eq", "ne", "contains", "gt", "gte", "lt", "lte"].indexOf(op) !== -1;
    if (needVal && cond.v === undefined) errors.condition = "Set a comparison value.";
    const actions = Array.isArray(raw.actions) ? raw.actions.filter(a => a && a.type) : [];
    if (!actions.length) errors.actions = "Add at least one action.";
    if (Object.keys(errors).length) return { ok: false, errors };
    return {
      ok: true,
      values: {
        name,
        module,
        event,
        condition: { f: condF, op, v: cond.v === undefined ? "" : cond.v },
        actions
      }
    };
  }

  async function saveRule(store, rule) {
    const v = validateRule(rule);
    if (!v.ok) return v;
    const id = rule.id || newId("ru");
    return R.persistUpdate(store, MOD, content => {
      if (!Array.isArray(content.rules)) content.rules = [];
      const clean = {
        id,
        kind: "rule",
        name: v.values.name,
        module: v.values.module,
        event: v.values.event,
        condition: v.values.condition,
        actions: v.values.actions.map(a => {
          const o = { type: a.type };
          if (a.type === "task") {
            o.subject = String(a.subject || "").trim();
            o.dueIn = Math.max(0, Math.round(Number(a.dueIn) || 0));
            o.priority = ["high", "med", "low"].indexOf(a.priority) !== -1 ? a.priority : "med";
          } else if (a.type === "note") {
            o.subject = String(a.subject || "").trim() || "Automation note";
            o.text = String(a.text || "").trim();
          } else if (a.type === "field") {
            o.field = String(a.field || "").trim();
            o.value = a.value;
          }
          return o;
        }).filter(a => a.type === "field" ? a.field && !RESERVED[a.field] : a.type === "task" ? a.subject : a.type === "note" ? a.text : false),
        enabled: rule.enabled !== false,
        createdAt: rule.createdAt,
        updatedAt: R.nowISO()
      };
      const i = content.rules.findIndex(s => s && s.id === id);
      if (i >= 0) {
        clean.createdAt = content.rules[i].createdAt;
        content.rules[i] = clean;
      } else {
        clean.createdAt = R.nowISO();
        content.rules.push(clean);
      }
      return { changed: true, content };
    });
  }

  async function deleteRule(store, id) {
    return R.persistUpdate(store, MOD, content => {
      if (!Array.isArray(content.rules)) return { changed: false };
      const i = content.rules.findIndex(s => s && s.id === id);
      if (i < 0) return { changed: false };
      content.rules.splice(i, 1);
      return { changed: true, content };
    });
  }

  async function setEnabled(store, id, enabled) {
    return R.persistUpdate(store, MOD, content => {
      const rule = (content.rules || []).find(s => s && s.id === id);
      if (!rule) return { changed: false };
      rule.enabled = !!enabled;
      rule.updatedAt = R.nowISO();
      return { changed: true, content };
    });
  }

  async function docRules(store) {
    try {
      const doc = await store.loadDoc(MOD);
      return doc && doc.content && Array.isArray(doc.content.rules) ? doc.content.rules : [];
    } catch (e) {
      return [];
    }
  }

  function recName(rec, module) {
    if (!rec) return "";
    if (rec.name || rec.subject || rec.title) return rec.name || rec.subject || rec.title;
    return R.recordName(rec) || (rec.id ? module + " " + rec.id : "");
  }

  function linkOf(module, rec) {
    const o = { companyId: undefined, contactId: undefined, dealId: undefined, leadId: undefined };
    if (module === "deals") o.dealId = rec.id;
    else if (module === "leads") o.leadId = rec.id;
    else if (module === "companies") o.companyId = rec.id;
    else if (module === "contacts") o.contactId = rec.id;
    if (rec.companyId) o.companyId = rec.companyId;
    if (rec.contactId) o.contactId = rec.contactId;
    return o;
  }

  async function companyName(store, id) {
    if (!id) return "";
    try {
      const doc = await store.loadDoc("companies");
      const c = doc && doc.content ? R.getRecord(doc.content, id) : null;
      return c ? c.name : "";
    } catch (e) {
      return "";
    }
  }

  async function resolveTemplate(tpl, store, module, rec) {
    const name = recName(rec, module);
    const owner = rec.owner || "";
    const company = await companyName(store, rec.companyId);
    const stage = rec.stage !== undefined ? String(rec.stage) : "";
    const value = rec.expectedValue !== undefined && rec.expectedValue !== null ? "$" + Number(rec.expectedValue).toLocaleString() : "";
    const source = rec.source || "";
    const date = R.fmtDate(localDateISO(new Date()));
    return String(tpl || "").replace(/\{(name|owner|company|stage|value|source|date)\}/g, (m, k) => ({ name, owner, company, stage, value, source, date }[k] || m));
  }

  async function executeActions(store, rule, module, rec, logNote) {
    const results = [];
    for (const a of rule.actions) {
      try {
        if (a.type === "task") {
          const subject = await resolveTemplate(a.subject, store, module, rec);
          const values = Object.assign({
            type: "task",
            subject,
            at: new Date().toISOString(),
            owner: rec.owner || "",
            priority: a.priority || "med",
            notes: "Created by automation rule “" + rule.name + "”."
          }, linkOf(module, rec));
          if (a.dueIn) {
            const d = new Date(Date.now() + a.dueIn * DAY);
            values.dueDate = localDateISO(d);
          }
          const res = await A.create(store, values, { events: false });
          results.push(res.ok ? { ok: true, note: "created task" + (a.dueIn ? " in " + a.dueIn + "d" : "") } : { ok: false, note: "task failed: " + (res.detail || res.code) });
        } else if (a.type === "note") {
          const subject = await resolveTemplate(a.subject, store, module, rec);
          const text = await resolveTemplate(a.text, store, module, rec);
          const values = Object.assign({
            type: "note",
            subject: subject.slice(0, 160),
            at: new Date().toISOString(),
            owner: rec.owner || "",
            notes: text || undefined
          }, linkOf(module, rec));
          const res = await A.create(store, values, { events: false });
          results.push(res.ok ? { ok: true, note: "logged note" } : { ok: false, note: "note failed: " + (res.detail || res.code) });
        } else if (a.type === "field") {
          if (RESERVED[a.field]) {
            results.push({ ok: false, note: "field “" + a.field + "” is protected" });
            continue;
          }
          const fv = a.value === "true" ? true : a.value === "false" ? false : a.value === "" || a.value === null ? "" : num(a.value) !== null && String(a.value).trim() !== "" ? num(a.value) : a.value;
          const res = await R.persistUpdate(store, module, content => {
            const r = R.getRecord(content, rec.id);
            if (!r) return { changed: false };
            const before = r[a.field];
            if (before === fv) return { changed: false };
            r[a.field] = fv;
            r.updatedAt = R.nowISO();
            return { changed: true, content };
          }, { events: false });
          results.push(res.ok ? { ok: true, note: "set " + a.field + " = " + String(fv) } : { ok: false, note: "field update failed: " + (res.detail || res.code) });
        } else {
          results.push({ ok: false, note: "unknown action type" });
        }
      } catch (e) {
        results.push({ ok: false, note: (e && e.message) || String(e) });
      }
    }
    await logNote(results);
    return results;
  }

  async function appendLog(store, entry) {
    return R.persistUpdate(store, MOD, content => {
      if (!Array.isArray(content.execLog)) content.execLog = [];
      content.execLog.push(entry);
      if (content.execLog.length > 200) content.execLog = content.execLog.slice(-200);
      return { changed: true, content };
    }, { events: false });
  }

  const throttle = new Map();
  function throttled(store, ruleId, recId) {
    const nsKey = (store && store.ns) || "x";
    const k = nsKey + ":" + ruleId + ":" + recId;
    const t = throttle.get(k) || 0;
    const now = Date.now();
    if (now - t < 8000) return true;
    throttle.set(k, now);
    if (throttle.size > 500) {
      for (const key of throttle.keys()) {
        if (now - throttle.get(key) > 60000) throttle.delete(key);
      }
    }
    return false;
  }

  async function fire(store, rule, rec, prev, mode) {
    if (!rule || rule.enabled === false || !rec) return null;
    if (throttled(store, rule.id, rec.id)) return null;
    const aidx = await activityIndex(store);
    let sctx = null;
    if (rule.module === "deals") {
      try {
        const doc = await store.loadDoc("deals");
        const pl = doc && doc.content && doc.content.pipeline;
        const stages = pl && Array.isArray(pl.stages) ? pl.stages : [];
        sctx = { labelToId: {}, idToLabel: {} };
        stages.forEach(s => {
          const id = String(s.id || "").toLowerCase();
          const label = String(s.label || "").toLowerCase();
          if (id) sctx.idToLabel[id] = s.label;
          if (label) sctx.labelToId[label] = s.id;
        });
      } catch (e) {}
    }
    const matches = condMatches(rule.condition, rule.module, rec, prev, aidx, sctx);
    if (!matches) return null;
    const results = await executeActions(store, rule, rule.module, rec, async notes => {
      const ok = notes.every(n => n.ok);
      await appendLog(store, {
        id: newId("rl"),
        kind: "rulelog",
        ruleId: rule.id,
        ruleName: rule.name,
        at: new Date().toISOString(),
        mode,
        module: rule.module,
        recordId: rec.id,
        recordName: recName(rec, rule.module),
        ok,
        note: notes.map(n => n.note).join("; ")
      });
    });
    return results;
  }

  async function handleWrite(store, data) {
    const changes = data && Array.isArray(data.changes) ? data.changes : [];
    if (!changes.length) return;
    const module = data.module;
    if (["deals", "leads", "companies", "contacts"].indexOf(module) === -1) return;
    const rules = (await docRules(store)).filter(r => r.enabled !== false && r.module === module && r.event !== "scan");
    if (!rules.length) return;
    for (const rule of rules) {
      for (const ch of changes) {
        const rec = ch && ch.next;
        if (!rec) continue;
        try {
          await fire(store, rule, rec, ch.prev || null, "write");
        } catch (e) {
          console.error("CRM rule “" + rule.name + "” failed:", e);
        }
      }
    }
  }

  async function runScan(store, onlyRuleId) {
    const rules = (await docRules(store)).filter(r => r.enabled !== false && r.event === "scan");
    const scanRules = onlyRuleId ? rules.filter(r => r.id === onlyRuleId) : rules;
    const byModule = {};
    scanRules.forEach(r => { (byModule[r.module] = byModule[r.module] || []).push(r); });
    let fired = 0;
    for (const module of Object.keys(byModule)) {
      const doc = await store.loadDoc(module);
      const recs = R.recordsOf(doc && doc.content);
      for (const rule of byModule[module]) {
        for (const rec of recs) {
          try {
            const res = await fire(store, rule, rec, null, "scan");
            if (res) fired++;
          } catch (e) {
            console.error("CRM rule “" + rule.name + "” scan failed:", e);
          }
        }
      }
    }
    return fired;
  }

  async function runManual(store, ruleId) {
    const rules = await docRules(store);
    const rule = rules.find(r => r.id === ruleId);
    if (!rule) return { ok: false, detail: "Rule not found." };
    if (rule.event === "scan") {
      const fired = await runScan(store, ruleId);
      return { ok: true, fired };
    }
    const doc = await store.loadDoc(rule.module);
    const recs = R.recordsOf(doc && doc.content);
    let fired = 0;
    for (const rec of recs) {
      try {
        const res = await fire(store, rule, rec, null, "manual");
        if (res) fired++;
      } catch (e) {}
    }
    return { ok: true, fired };
  }

  async function execLog(store) {
    try {
      const doc = await store.loadDoc(MOD);
      const arr = doc && doc.content && Array.isArray(doc.content.execLog) ? doc.content.execLog : [];
      return arr.slice(-200).reverse();
    } catch (e) {
      return [];
    }
  }

  const esc = s => String(s === undefined || s === null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function opt(v, text) {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = text;
    return o;
  }

  function ruleSummary(rule) {
    const cond = rule.condition || {};
    const bits = ["When a " + (MODULES.find(m => m.id === rule.module) || { label: rule.module }).label.toLowerCase() + (rule.event === "scan" ? " matches on the daily sweep" : " is saved") + " and " + fieldLabel(rule.module, cond.f) + " " + opLabel(cond.op)];
    if (["eq", "ne", "contains", "gt", "gte", "lt", "lte", "changed_to", "changed_from"].indexOf(cond.op) !== -1) bits.push("“" + cond.v + "”");
    const actBits = rule.actions.map(a => {
      if (a.type === "task") return "create follow-up task" + (a.dueIn ? " in " + a.dueIn + "d" : "");
      if (a.type === "note") return "log note";
      return "set " + a.field + " = " + String(a.value);
    });
    return { when: bits.join(" "), then: actBits };
  }

  function actionRowView(rule, action, idx, onChanged) {
    const row = el("div", "rl-act");
    const typeSel = document.createElement("select");
    typeSel.className = "sel";
    const types = [["task", "Create follow-up task"], ["note", "Log a note"], ["field", "Set a field on the record"]];
    types.forEach(t => typeSel.appendChild(opt(t[0], t[1])));
    typeSel.value = action.type;
    const inputs = el("div", "rl-act-in");
    function rebuild() {
      inputs.innerHTML = "";
      const st = { type: typeSel.value };
      if (typeSel.value === "task") {
        const sub = document.createElement("input");
        sub.className = "inp";
        sub.placeholder = "Subject, e.g. “Follow up on {name} — send proposal”";
        sub.value = action.subject || "Follow up on {name}";
        sub.addEventListener("input", () => { st.subject = sub.value; });
        const due = document.createElement("input");
        due.type = "number";
        due.min = "0";
        due.className = "inp rl-due";
        due.value = action.dueIn === undefined ? 7 : action.dueIn;
        due.title = "Due in how many days";
        due.addEventListener("change", () => { st.dueIn = Number(due.value); });
        const prio = document.createElement("select");
        prio.className = "sel";
        [["high", "High"], ["med", "Medium"], ["low", "Low"]].forEach(p => prio.appendChild(opt(p[0], p[1])));
        prio.value = action.priority || "med";
        prio.addEventListener("change", () => { st.priority = prio.value; });
        inputs.appendChild(el("span", "rl-lbl", "Subject"));
        inputs.appendChild(sub);
        inputs.appendChild(el("span", "rl-lbl", "Due in"));
        const dueWrap = el("span", "rl-duewrap");
        dueWrap.appendChild(due);
        dueWrap.appendChild(el("span", "rl-suffix", "days"));
        inputs.appendChild(dueWrap);
        inputs.appendChild(el("span", "rl-lbl", "Priority"));
        inputs.appendChild(prio);
        inputs.appendChild(el("p", "hint", "Tokens: {name} {owner} {company} {stage} {value} {source} {date}"));
      } else if (typeSel.value === "note") {
        const sub = document.createElement("input");
        sub.className = "inp";
        sub.placeholder = "Subject line, e.g. “Flagged by automation”";
        sub.value = action.subject || "Flagged by automation";
        sub.addEventListener("input", () => { st.subject = sub.value; });
        const body = document.createElement("input");
        body.className = "inp";
        body.placeholder = "Note body, e.g. “No activity on {name} for 10 days”";
        body.value = action.text || "";
        body.addEventListener("input", () => { st.text = body.value; });
        inputs.appendChild(el("span", "rl-lbl", "Subject"));
        inputs.appendChild(sub);
        inputs.appendChild(el("span", "rl-lbl", "Note body"));
        inputs.appendChild(body);
      } else {
        const field = document.createElement("input");
        field.className = "inp";
        field.placeholder = "Field, e.g. flag or probability";
        field.value = action.field || "";
        field.addEventListener("input", () => { st.field = field.value; });
        const value = document.createElement("input");
        value.className = "inp";
        value.placeholder = "Value, e.g. true or 50";
        value.value = action.value === undefined ? "" : String(action.value);
        value.addEventListener("input", () => { st.value = value.value; });
        inputs.appendChild(el("span", "rl-lbl", "Field"));
        inputs.appendChild(field);
        inputs.appendChild(el("span", "rl-lbl", "Value"));
        inputs.appendChild(value);
      }
      row._read = () => {
        const o = { type: typeSel.value };
        if (typeSel.value === "task") {
          const s = inputs.querySelector("input");
          const d = inputs.querySelector('input[type="number"]');
          const p = inputs.querySelector("select");
          o.subject = s ? s.value.trim() : "";
          o.dueIn = d ? Math.max(0, Math.round(Number(d.value) || 0)) : 0;
          o.priority = p ? p.value : "med";
        } else if (typeSel.value === "note") {
          const ins = inputs.querySelectorAll("input");
          o.subject = ins[0] ? ins[0].value.trim() : "";
          o.text = ins[1] ? ins[1].value.trim() : "";
        } else {
          const ins = inputs.querySelectorAll("input");
          o.field = ins[0] ? ins[0].value.trim() : "";
          o.value = ins[1] ? ins[1].value : "";
        }
        return o;
      };
    }
    typeSel.addEventListener("change", () => {
      action = { type: typeSel.value };
      rebuild();
      if (onChanged) onChanged();
    });
    row.appendChild(typeSel);
    row.appendChild(inputs);
    const del = document.createElement("button");
    del.type = "button";
    del.className = "btn btn-ghost btn-sm";
    del.textContent = "✕";
    del.title = "Remove action";
    del.addEventListener("click", () => row.remove());
    row.appendChild(del);
    rebuild();
    return row;
  }

  function ruleForm(store, rule, onDone) {
    rule = rule || {};
    const card = el("section", "card rl-form");
    card.dataset.rlForm = "1";
    const title = el("div", "card-title-row");
    title.appendChild(el("h2", null, rule.id ? "Edit rule" : "New automation rule"));
    card.appendChild(title);
    const msg = el("div", "bkp-msg");
    msg.hidden = true;
    card.appendChild(msg);
    const form = el("form", "frm rl-editor");
    form.setAttribute("novalidate", "");
    card.appendChild(form);
    const nameIn = document.createElement("input");
    nameIn.className = "inp";
    nameIn.placeholder = "e.g. Proposal sent → follow up in a week";
    nameIn.value = rule.name || "";
    form.appendChild(U.fld("text", "Rule name", nameIn, { id: "rl-name", required: true, full: true }));

    const modSel = document.createElement("select");
    modSel.className = "sel";
    MODULES.forEach(m => modSel.appendChild(opt(m.id, MODULE_LABELS[m.id] || m.label + "s")));
    if (rule.module) modSel.value = rule.module;
    const modFld = U.fld("select", "Watches", modSel, { id: "rl-mod" });
    form.appendChild(modFld);

    const evSel = document.createElement("select");
    evSel.className = "sel";
    const w = opt("write", "When a record is saved or changed");
    const s = opt("scan", "Daily sweep — matches records on load & Run now");
    evSel.appendChild(w);
    evSel.appendChild(s);
    evSel.value = rule.event || "write";
    form.appendChild(U.fld("select", "Trigger", evSel, { id: "rl-event" }));

    const condWrap = el("div", "full rl-cond");
    condWrap.appendChild(el("p", "fld-hint", "Condition — fires when the record matches."));
    form.appendChild(condWrap);

    const cond = Object.assign({ f: rule.condition ? rule.condition.f : "", op: "eq", v: "" }, rule.condition || {});
    const condRow = el("div", "rl-condrow");
    const fSel = document.createElement("select");
    fSel.className = "sel";
    const opSel = document.createElement("select");
    opSel.className = "sel";
    const vWrap = el("span", "rl-val");
    condRow.appendChild(fSel);
    condRow.appendChild(opSel);
    condRow.appendChild(vWrap);
    condWrap.appendChild(condRow);

    function defFor(module, f) {
      const defs = FIELD_DEFS[module] || [];
      const d = defs.find(x => x.f === f);
      return d || (f === "custom" ? { f: "custom", label: "Custom field…", type: "custom" } : null);
    }
    function paintCond() {
      const module = modSel.value;
      const event = evSel.value;
      const defs = FIELD_DEFS[module] || [];
      const visDefs = defs.filter(d => !(d.scan && event !== "scan"));
      const current = fSel.value || cond.f;
      fSel.innerHTML = "";
      visDefs.forEach(d => {
        const o = opt(d.f, d.label);
        if (d.f === "custom") o.dataset.custom = "1";
        fSel.appendChild(o);
      });
      let f = current;
      if (f !== "custom") {
        const known = visDefs.some(d => d.f === f);
        if (!known) {
          f = f && defs.some(d => d.f === f) ? (event === "scan" ? f : "custom") : (f ? "custom" : ((visDefs.find(d => d.f !== "custom") || {}).f || "custom"));
        }
      }
      if (!visDefs.some(d => d.f === f)) f = (visDefs.find(d => d.f !== "custom") || {}).f || "custom";
      fSel.value = f;
      const d = defFor(module, f) || { type: "string" };
      const isCustom = f === "custom";
      opSel.innerHTML = "";
      const ops = OPS.filter(o => {
        if (WRITE_ONLY[o.id]) return event === "write";
        return true;
      });
      ops.forEach(o => opSel.appendChild(opt(o.id, o.label)));
      let op = cond.op;
      if (WRITE_ONLY[op] && event !== "write") op = "eq";
      if (!ops.some(o => o.id === op)) op = "eq";
      opSel.value = op;
      vWrap.innerHTML = "";
      const opId = opSel.value;
      if (opId === "is_set" || opId === "is_empty") {
        if (isCustom) {
          const fn = el("input", "inp rl-fieldname");
          fn.placeholder = "Record field name, e.g. vatNumber";
          fn.value = customFieldName();
          fn.addEventListener("input", () => { cond.f = fn.value.trim(); });
          vWrap.appendChild(fn);
        }
        return;
      }
      if (isCustom) {
        const fn = el("input", "inp rl-fieldname");
        fn.placeholder = "Record field name, e.g. source";
        fn.value = customFieldName();
        fn.addEventListener("input", () => { cond.f = fn.value.trim(); });
        vWrap.appendChild(fn);
      }
      let val;
      if (d.type === "bool") {
        val = el("label", "rl-bool");
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = cond.v === true || cond.v === "true";
        cb.addEventListener("change", () => { cond.v = cb.checked; });
        val.appendChild(cb);
        val.appendChild(el("span", null, "yes"));
      } else {
        val = document.createElement("input");
        if (d.type === "num") { val.type = "number"; val.step = "any"; }
        else if (d.type === "date") val.type = "date";
        else val.type = "text";
        val.className = "inp";
        val.value = cond.v === undefined || cond.v === null ? "" : String(cond.v);
        if (d.type === "stage" && window.CRM_DEALS && window.CRM_DEALS.stageLabels) {
          const listId = "rlStages" + (Math.random() * 1e6 | 0);
          val.setAttribute("list", listId);
          const dl = el("datalist");
          dl.id = listId;
          window.CRM_DEALS.stageLabels().forEach(l => dl.appendChild(opt(l, l)));
          vWrap.appendChild(dl);
        }
        val.addEventListener("input", () => { cond.v = val.value; });
        val.addEventListener("change", () => {
          if (val.type === "number") cond.v = val.value === "" ? "" : Number(val.value);
          else cond.v = val.value;
        });
      }
      vWrap.appendChild(val);
      condRow._read = () => {
        const o = { f: isCustom ? cond.f || customFieldName() : fSel.value, op: opSel.value };
        if (opId === "is_set" || opId === "is_empty") return o;
        o.v = cond.v;
        return o;
      };
    }
    function customFieldName() {
      if (cond.f && cond.f !== "custom" && !(FIELD_DEFS[modSel.value] || []).some(d => d.f === cond.f)) return cond.f;
      return "";
    }
    fSel.addEventListener("change", () => {
      cond.f = fSel.value;
      cond.op = "eq";
      cond.v = "";
      paintCond();
    });
    opSel.addEventListener("change", () => { cond.op = opSel.value; paintCond(); });
    evSel.addEventListener("change", () => paintCond());
    modSel.addEventListener("change", () => {
      cond.f = "";
      cond.op = "eq";
      cond.v = "";
      paintCond();
    });
    paintCond();

    const actWrap = el("div", "full rl-acts");
    actWrap.appendChild(el("p", "fld-hint", "Actions — what happens when it fires (each action is also written to the activity log)."));
    form.appendChild(actWrap);
    const actionDefs = (rule.actions && rule.actions.length ? rule.actions : [{ type: "task", subject: "Follow up on {name}", dueIn: 7, priority: "med" }]).slice();
    let actionViews = [];
    function renderActions() {
      actWrap.querySelectorAll(".rl-act").forEach(n => n.remove());
      actionViews = actionDefs.map((a, i) => actionRowView(rule, a, i));
      actionViews.forEach(v => actWrap.appendChild(v));
      const add = document.createElement("button");
      add.type = "button";
      add.className = "btn btn-ghost btn-sm";
      add.textContent = "＋ Add action";
      add.addEventListener("click", () => {
        actionDefs.push({ type: "note", subject: "Flagged by automation", text: "" });
        renderActions();
      });
      const box = el("div", "sg-addwrap");
      box.appendChild(add);
      actWrap.appendChild(box);
    }
    renderActions();

    const foot = el("div", "frm-foot full");
    const save = document.createElement("button");
    save.type = "submit";
    save.className = "btn btn-primary";
    save.textContent = rule.id ? "Save rule" : "Create rule";
    save.dataset.rlSave = "1";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "btn btn-ghost";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => { if (onDone) onDone(); });
    foot.appendChild(save);
    foot.appendChild(cancel);
    form.appendChild(foot);

    form.addEventListener("submit", async ev => {
      ev.preventDefault();
      const name = nameIn.value.trim();
      if (!name) {
        msg.className = "bkp-msg err";
        msg.textContent = "Give the rule a name.";
        msg.hidden = false;
        return;
      }
      const condRead = condRow._read ? condRow._read() : null;
      const actions = [];
      actWrap.querySelectorAll(".rl-act").forEach(n => {
        const r = n._read ? n._read() : null;
        if (r && r.type) {
          if (r.type === "task" && r.subject) actions.push(r);
          else if (r.type === "note" && r.text) actions.push(r);
          else if (r.type === "field" && r.field) actions.push(r);
        }
      });
      const res = await saveRule(store, {
        id: rule.id,
        name,
        module: modSel.value,
        event: evSel.value,
        enabled: rule.enabled !== false,
        condition: condRead,
        actions
      });
      if (res && res.ok) {
        window.CRM.toast(rule.id ? "Rule saved." : "Rule created.");
        if (onDone) onDone();
      } else {
        save.disabled = false;
        msg.className = "bkp-msg err";
        msg.textContent = (res && res.errors) ? Object.values(res.errors).join(" ") : U ? U.describeError(res, "rules") : "Could not save.";
        msg.hidden = false;
      }
    });
    return card;
  }

  async function managerView(ctx) {
    const store = ctx.store;
    const wrap = el("div", "rl-view");
    const intro = el("div", "card rl-intro");
    intro.appendChild(el("h2", null, "Automation rules"));
    intro.appendChild(el("p", "hint", "When-then rules that act on your pipeline: when a deal stage changes, create a follow-up task and assign it to the deal owner; when a lead goes quiet for 10 days, flag it with a note. Rules fire on record saves and on the daily sweep (run at load and on demand), and every firing is written to the execution log below."));
    wrap.appendChild(intro);
    const editing = { rule: null, open: false };
    const listBox = el("div", "rl-list");
    const formAnchor = el("div");
    const newBar = el("div", "sg-newbar");
    const logCard = el("section", "card rl-logcard");
    const logTitle = el("div", "card-title-row");
    logTitle.appendChild(el("h2", null, "Execution log"));
    logCard.appendChild(logTitle);
    const logBody = el("div");
    logCard.appendChild(logBody);
    wrap.appendChild(listBox);
    wrap.appendChild(formAnchor);
    wrap.appendChild(newBar);
    wrap.appendChild(logCard);

    function showNew() {
      editing.open = true;
      newBar.innerHTML = "";
      formAnchor.innerHTML = "";
      formAnchor.appendChild(ruleForm(store, null, () => {
        editing.open = false;
        formAnchor.innerHTML = "";
        newBar.innerHTML = "";
        refresh();
      }));
    }
    async function paintLog() {
      const entries = await execLog(store);
      logBody.innerHTML = "";
      if (!entries.length) {
        logBody.appendChild(el("p", "hint muted-line", "Nothing executed yet. Create a rule and save a matching record, or hit Run now on a rule."));
        return;
      }
      entries.slice(0, 40).forEach(e => {
        const row = el("div", "tl-row rl-logrow");
        row.dataset.rlLog = "1";
        const main = el("div", "tl-main");
        const t = el("div", "tl-title");
        t.appendChild(el("span", "chip " + (e.ok ? "pass" : "fail"), e.ok ? "ok" : "failed"));
        t.appendChild(document.createTextNode(e.ruleName));
        main.appendChild(t);
        const bits = [e.mode, e.module];
        if (e.recordId) bits.push("#" + e.recordId);
        main.appendChild(el("div", "tl-sub", bits.join(" · ") + (e.note ? " — " + esc(e.note) : "")));
        if (e.recordId && e.module) {
          const a = document.createElement("a");
          a.href = "#/" + e.module + "/" + encodeURIComponent(e.recordId);
          a.textContent = "open";
          a.className = "tag-pill";
          a.dataset.rlLogLink = "1";
          main.appendChild(a);
        }
        row.appendChild(main);
        row.appendChild(el("span", "tl-when", R.fmtStamp(e.at)));
        logBody.appendChild(row);
      });
    }
    async function refresh() {
      listBox.innerHTML = "";
      newBar.innerHTML = "";
      const rules = await docRules(store);
      if (!rules.length) {
        const empty = el("div", "rec-empty");
        empty.appendChild(el("p", "state-title", "No automation rules yet"));
        empty.appendChild(el("p", "state-msg", "Create your first rule — e.g. when a deal stage becomes “proposal sent”, create a follow-up task in 7 days for the owner."));
        listBox.appendChild(empty);
      }
      rules.forEach(rule => {
        const card = el("section", "card rl-rule");
        card.dataset.rlRule = "1";
        const head = el("div", "rl-rule-head");
        const left = el("div", "rl-rule-namebox");
        const nameRow = el("div", "rl-rule-namerow");
        nameRow.appendChild(el("span", "rec-name", rule.name));
        if (rule.enabled === false) nameRow.appendChild(el("span", "badge inactive", "paused"));
        left.appendChild(nameRow);
        const sum = ruleSummary(rule);
        left.appendChild(el("p", "hint", sum.when + ""));
        const thenBox = el("div", "rl-thens");
        sum.then.forEach(t => thenBox.appendChild(el("span", "chip", t)));
        left.appendChild(thenBox);
        head.appendChild(left);
        const acts = el("span", "sg-acts rl-rule-acts");
        const enLab = el("label", "rl-enable");
        const enCb = document.createElement("input");
        enCb.type = "checkbox";
        enCb.checked = rule.enabled !== false;
        enCb.dataset.rlEnable = "1";
        enLab.appendChild(enCb);
        enLab.appendChild(el("span", null, rule.enabled === false ? "Paused" : "Active"));
        enCb.addEventListener("change", async () => {
          const res = await setEnabled(store, rule.id, enCb.checked);
          if (res.ok) {
            window.CRM.toast(enCb.checked ? "Rule active." : "Rule paused.");
            refresh();
          } else {
            enCb.checked = !enCb.checked;
            window.CRM.toast("Could not update the rule.");
          }
        });
        acts.appendChild(enLab);
        const runB = document.createElement("button");
        runB.type = "button";
        runB.className = "btn btn-ghost btn-sm";
        runB.textContent = "Run now";
        runB.dataset.rlRun = "1";
        runB.title = "Run this rule against every current record";
        runB.addEventListener("click", async () => {
          runB.disabled = true;
          runB.textContent = "Running…";
          const res = await runManual(store, rule.id);
          if (res.ok) window.CRM.toast(res.fired ? "Rule fired for " + res.fired + " record" + (res.fired === 1 ? "" : "s") + "." : "Rule matched nothing right now.");
          else window.CRM.toast(res.detail || "Rule could not run.");
          runB.disabled = false;
          runB.textContent = "Run now";
          refresh();
        });
        acts.appendChild(runB);
        const editB = document.createElement("button");
        editB.type = "button";
        editB.className = "btn btn-ghost btn-sm";
        editB.textContent = "Edit";
        editB.dataset.rlEdit = "1";
        editB.addEventListener("click", () => {
          editing.rule = rule;
          editing.open = true;
          formAnchor.innerHTML = "";
          formAnchor.appendChild(ruleForm(store, rule, () => {
            editing.open = false;
            formAnchor.innerHTML = "";
            refresh();
          }));
        });
        acts.appendChild(editB);
        const delB = document.createElement("button");
        delB.type = "button";
        delB.className = "btn btn-danger btn-sm";
        delB.textContent = "Delete";
        delB.dataset.rlDel = "1";
        let armed = false;
        delB.addEventListener("click", async () => {
          if (!armed) {
            armed = true;
            delB.textContent = "Confirm delete";
            delB.classList.add("armed");
            setTimeout(() => {
              armed = false;
              delB.textContent = "Delete";
              delB.classList.remove("armed");
            }, 4000);
            return;
          }
          const res = await deleteRule(store, rule.id);
          if (res.ok) {
            window.CRM.toast("Rule deleted.");
            if (editing.open && editing.rule && editing.rule.id === rule.id) formAnchor.innerHTML = "";
            refresh();
          } else window.CRM.toast("Could not delete the rule.");
        });
        acts.appendChild(delB);
        head.appendChild(acts);
        card.appendChild(head);
        listBox.appendChild(card);
      });
      if (!editing.open) {
        formAnchor.innerHTML = "";
        const openNew = document.createElement("button");
        openNew.type = "button";
        openNew.className = "btn btn-primary btn-sm";
        openNew.textContent = "＋ New rule";
        openNew.dataset.rlNew = "1";
        openNew.addEventListener("click", showNew);
        newBar.appendChild(openNew);
      }
      paintLog();
    }
    await refresh();
    return wrap;
  }

  async function view(ctx) {
    return managerView(ctx);
  }

  async function onWrite(store, data) {
    try {
      await handleWrite(store, data);
    } catch (e) {
      console.error("Automation rules write handler failed:", e);
    }
  }

  return {
    MOD,
    FIELD_DEFS,
    OPS,
    MODULES,
    validateRule,
    saveRule,
    deleteRule,
    setEnabled,
    docRules,
    condMatches,
    fire,
    runScan,
    runManual,
    handleWrite,
    onWrite,
    execLog,
    view,
    newId,
    ruleSummary
  };
})();
window.CRM_RENDERERS.rules = function (ctx) {
  return window.CRM_RULES ? window.CRM_RULES.view(ctx) : null;
};
(function () {
  if (typeof window === "undefined") return;
  window.CRM_BOOT_HOOKS = window.CRM_BOOT_HOOKS || [];
  window.CRM_BOOT_HOOKS.push(async store => {
    if (window.CRM_EVENTS && window.CRM_RULES) {
      window.CRM_EVENTS.on("moduleWrite", data => {
        if (data && data.store && data.store !== store) return;
        window.CRM_RULES.onWrite(store, data);
      });
      setTimeout(() => {
        if (window.CRM_RULES) window.CRM_RULES.runScan(store).catch(() => {});
      }, 6000);
    }
  });
})();
