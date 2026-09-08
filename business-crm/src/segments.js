window.CRM_SEGMENTS = (function () {
  const R = window.CRM_RECORDS;
  const el = R.el;
  const MOD = "segments";

  const FIELD_DEFS = {
    companies: [
      { f: "isCustomer", label: "Is a customer", type: "bool" },
      { f: "active", label: "Active", type: "bool" },
      { f: "industry", label: "Industry", type: "string" },
      { f: "employees", label: "Company size band", type: "num", hint: "10, 50, 200, 500, 1000, 5000, 5001" },
      { f: "tags", label: "Tag", type: "tag" },
      { f: "website", label: "Has website", type: "is" },
      { f: "email", label: "Legacy email", type: "string" },
      { f: "owner", label: "Legacy owner", type: "string" },
      { f: "daysSinceCreated", label: "Days since created", type: "num" },
      { f: "daysSinceCustomer", label: "Days since becoming a customer", type: "num" },
      { f: "daysSinceLastActivity", label: "Days since last activity", type: "num", hint: "e.g. ≥ 30 for no activity in 30 days" },
      { f: "custom", label: "Custom field…", type: "custom" }
    ],
    contacts: [
      { f: "companyId", label: "Linked to a company", type: "is" },
      { f: "active", label: "Active", type: "bool" },
      { f: "role", label: "Role / title", type: "string" },
      { f: "email", label: "Email", type: "string" },
      { f: "consent", label: "Has communication consent", type: "bool" },
      { f: "tags", label: "Tag", type: "tag" },
      { f: "daysSinceCreated", label: "Days since created", type: "num" },
      { f: "daysSinceLastActivity", label: "Days since last activity", type: "num" },
      { f: "custom", label: "Custom field…", type: "custom" }
    ],
    leads: [
      { f: "status", label: "Status", type: "string", options: ["new", "contacted", "qualified", "converted", "disqualified"] },
      { f: "source", label: "Source", type: "string" },
      { f: "owner", label: "Owner", type: "string" },
      { f: "companyId", label: "Linked to a company", type: "is" },
      { f: "daysSinceCreated", label: "Days since created", type: "num" },
      { f: "daysSinceLastActivity", label: "Days since last activity", type: "num" },
      { f: "custom", label: "Custom field…", type: "custom" }
    ],
    deals: [
      { f: "stage", label: "Pipeline stage", type: "string", stage: true },
      { f: "owner", label: "Owner", type: "string" },
      { f: "expectedValue", label: "Expected value ($)", type: "num" },
      { f: "probability", label: "Probability (%)", type: "num" },
      { f: "closeDate", label: "Close date", type: "date" },
      { f: "daysUntilClose", label: "Days until close", type: "num" },
      { f: "daysSinceCreated", label: "Days since created", type: "num" },
      { f: "daysInStage", label: "Days in current stage", type: "num" },
      { f: "daysSinceLastActivity", label: "Days since last activity", type: "num" },
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
    { id: "between", label: "is between" },
    { id: "is_set", label: "is set" },
    { id: "is_empty", label: "is empty" }
  ];

  const BOOL_OPS = ["eq", "ne", "is_set", "is_empty"];
  const IS_OPS = ["is_set", "is_empty"];
  let dlSeq = 0;

  function defaultRuleFor(module) {
    const ds = (FIELD_DEFS[module] || FIELD_DEFS.companies).filter(d => d.f !== "custom");
    const d = ds.find(x => x.type === "bool") || ds[0] || { f: "tags", type: "string" };
    if (d.type === "bool") return { f: d.f, op: "eq", v: true };
    if (d.type === "is") return { f: d.f, op: "is_set" };
    return { f: d.f, op: "eq", v: "" };
  }

  function newId() {
    return "sg-" + (window.BcrmStore ? window.BcrmStore.randHex(6) : Math.floor(Math.random() * 0xffffff).toString(16));
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
    if (!ms) return Infinity;
    return (Date.now() - ms) / 86400000;
  }

  async function activityIndex(store) {
    const out = { companies: {}, contacts: {}, leads: {}, deals: {} };
    try {
      const doc = await store.loadDoc("activities");
      if (!doc || !doc.content) return out;
      const by = out;
      for (const a of R.recordsOf(doc.content)) {
        const t = dateMs(a.at || a.createdAt);
        if (!t) continue;
        for (const key of Object.keys(by)) {
          const ref = a[key === "companies" ? "companyId" : key === "contacts" ? "contactId" : key === "deals" ? "dealId" : "leadId"];
          if (ref) {
            const prev = by[key][ref] || 0;
            if (t > prev) by[key][ref] = t;
          }
        }
      }
    } catch (e) {}
    return out;
  }

  function dayDelta(rec, f) {
    if (f === "daysSinceCreated") return daysSince(dateMs(rec && rec.createdAt));
    if (f === "daysSinceUpdated") return daysSince(dateMs(rec && rec.updatedAt));
    if (f === "daysSinceCustomer") return daysSince(dateMs((rec && rec.customerSince) || (rec && rec.isCustomer ? rec.createdAt : null)));
    if (f === "daysUntilClose") {
      const m = dateMs(rec && rec.closeDate);
      return m ? (m - Date.now()) / 86400000 : null;
    }
    if (f === "daysInStage") return daysSince(dateMs(rec && rec.stageEnteredAt));
    if (f === "daysSinceLastActivity") return null;
    return null;
  }

  function valueOf(rec, f, aidx, module) {
    if (f === "daysSinceLastActivity") {
      const refId = rec && rec.id;
      if (!refId) return null;
      const map = (aidx && aidx[module]) || {};
      const last = map[refId] || 0;
      return last ? daysSince(last) : Infinity;
    }
    const d = dayDelta(rec, f);
    if (d !== null) return d;
    if (rec && f in rec) {
      const v = rec[f];
      if (Array.isArray(v)) return v.slice();
      return v;
    }
    return undefined;
  }

  function textOf(v) {
    if (v === undefined || v === null) return "";
    return Array.isArray(v) ? v.join(" ") : String(v);
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

  function stageCandidates(raw, sctx) {
    const vals = Array.isArray(raw) ? raw : [raw];
    const out = [];
    vals.forEach(v => {
      const s = String(v === undefined || v === null ? "" : v).trim().toLowerCase();
      if (!s) return;
      if (out.indexOf(s) === -1) out.push(s);
      const id2l = sctx && sctx.idToLabel;
      const l2i = sctx && sctx.labelToId;
      if (id2l && id2l[s]) {
        const l = String(id2l[s]).toLowerCase();
        if (out.indexOf(l) === -1) out.push(l);
      }
      if (l2i && l2i[s]) {
        const i2 = String(l2i[s]).toLowerCase();
        if (out.indexOf(i2) === -1) out.push(i2);
      }
    });
    return out;
  }

  function ruleMatches(rule, rec, aidx, module, sctx) {
    const f = rule.f;
    const op = rule.op || "eq";
    const raw = rec && rec.id !== undefined ? valueOf(rec, f, aidx, module) : undefined;
    const isArr = Array.isArray(raw);
    const text = textOf(raw);
    const lower = text.toLowerCase();
    const target = rule.v;
    const targetLower = String(target === undefined || target === null ? "" : target).toLowerCase().trim();

    if (module === "deals" && f === "stage" && sctx) {
      if (op === "is_set") return raw !== undefined && raw !== null && raw !== "";
      if (op === "is_empty") return raw === undefined || raw === null || raw === "";
      const cands = stageCandidates(raw, sctx);
      if (!cands.length) return false;
      if (op === "contains") return cands.some(c => c.indexOf(targetLower) !== -1);
      if (op === "ne") return cands.every(c => c !== targetLower);
      return cands.some(c => c === targetLower);
    }

    if (op === "is_set") return !isArr ? raw !== undefined && raw !== null && raw !== "" : raw.length > 0;
    if (op === "is_empty") return !isArr ? raw === undefined || raw === null || raw === "" : raw.length === 0;
    if (op === "eq" || op === "ne") {
      if (isArr) {
        const hit = raw.some(x => String(x).toLowerCase().trim() === targetLower);
        return op === "eq" ? hit : !hit;
      }
      let eq = false;
      const pair = compareNumeric(raw, target);
      if (pair) eq = pair[0] === pair[1];
      else if (raw !== undefined && raw !== null) eq = String(raw).toLowerCase().trim() === targetLower;
      else eq = target === "" || target === null;
      return op === "eq" ? eq : !eq;
    }
    if (op === "contains") {
      return isArr ? raw.some(x => String(x).toLowerCase().includes(targetLower)) : lower.indexOf(targetLower) !== -1;
    }
    if (op === "gt" || op === "gte" || op === "lt" || op === "lte") {
      if (raw === undefined || raw === null || raw === "") return false;
      const pair = compareNumeric(raw, target);
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
    if (op === "between") {
      if (raw === undefined || raw === null) return false;
      const from = rule.from;
      const to = rule.to;
      const fromEmpty = from === undefined || from === null || String(from).trim() === "";
      const toEmpty = to === undefined || to === null || String(to).trim() === "";
      if (fromEmpty && toEmpty) return false;
      const rn = num(raw);
      const fn = num(from);
      const tn = num(to);
      if (rn !== null && (fromEmpty || fn !== null) && (toEmpty || tn !== null)) {
        const lo = fromEmpty ? -Infinity : fn;
        const hi = toEmpty ? Infinity : tn;
        return rn >= lo && rn <= hi;
      }
      const rm = dateMs(raw);
      const fm = dateMs(from);
      const tm = dateMs(to);
      if (rm !== null && (fromEmpty || fm !== null) && (toEmpty || tm !== null)) {
        const lo = fromEmpty ? -Infinity : fm;
        const hi = toEmpty ? Infinity : tm;
        return rm >= lo && rm <= hi;
      }
      const fl = String(fromEmpty ? "" : from).toLowerCase();
      const tl = String(toEmpty ? "" : to).toLowerCase();
      return (!fl || lower >= fl) && (!tl || lower <= tl);
    }
    return false;
  }

  function segMatches(seg, rec, aidx, sctx) {
    const rules = Array.isArray(seg && seg.rules) ? seg.rules : [];
    if (!rules.length) return false;
    const kind = seg.kind === "any" ? "any" : "all";
    const res = rules.map(r => ruleMatches(r, rec, aidx, seg.module, sctx));
    return kind === "any" ? res.some(Boolean) : res.every(Boolean);
  }

  async function docSegments(store) {
    let doc = null;
    try { doc = await store.loadDoc(MOD); } catch (e) {}
    return doc && doc.content && Array.isArray(doc.content.segments) ? doc.content.segments : [];
  }

  async function listSegments(store, module) {
    const all = await docSegments(store);
    return module ? all.filter(s => s.module === module) : all;
  }

  async function saveSegment(store, seg) {
    const id = seg.id || newId();
    return R.persistUpdate(store, MOD, content => {
      if (!Array.isArray(content.segments)) content.segments = [];
      const clean = {
        id,
        name: String(seg.name || "").trim(),
        module: seg.module,
        kind: seg.kind === "any" ? "any" : "all",
        rules: Array.isArray(seg.rules) ? seg.rules.slice() : [],
        createdAt: seg.createdAt,
        updatedAt: R.nowISO()
      };
      if (!clean.name) return { changed: false };
      const i = content.segments.findIndex(s => s && s.id === id);
      if (i >= 0) {
        clean.createdAt = content.segments[i].createdAt;
        content.segments[i] = clean;
      } else {
        clean.createdAt = R.nowISO();
        content.segments.push(clean);
      }
      return { changed: true, content };
    });
  }

  async function deleteSegment(store, id) {
    return R.persistUpdate(store, MOD, content => {
      if (!Array.isArray(content.segments)) return { changed: false };
      const i = content.segments.findIndex(s => s && s.id === id);
      if (i < 0) return { changed: false };
      content.segments.splice(i, 1);
      return { changed: true, content };
    });
  }

  async function members(store, seg) {
    if (!seg || !seg.module) return [];
    let doc;
    try { doc = await store.loadDoc(seg.module); } catch (e) { return []; }
    if (!doc || !doc.content) return [];
    const aidx = await activityIndex(store);
    const sctx = seg.module === "deals" ? await stageCtx(store) : null;
    return R.recordsOf(doc.content).filter(r => segMatches(seg, r, aidx, sctx));
  }

  function fieldDefsFor(module) {
    return FIELD_DEFS[module] || FIELD_DEFS.companies;
  }

  async function stageOptions(store) {
    try {
      const doc = await store.loadDoc("deals");
      const pl = doc && doc.content && doc.content.pipeline;
      if (pl && Array.isArray(pl.stages)) return pl.stages.map(s => ({ id: s.id, label: s.label }));
    } catch (e) {}
    return null;
  }

  async function stageCtx(store) {
    const ctx = { labelToId: {}, idToLabel: {} };
    try {
      const doc = await store.loadDoc("deals");
      const pl = doc && doc.content && doc.content.pipeline;
      const stages = (pl && Array.isArray(pl.stages)) ? pl.stages : [];
      stages.forEach(s => {
        const id = String(s.id || "").toLowerCase();
        const label = String(s.label || "").toLowerCase();
        if (id && !(id in ctx.idToLabel)) ctx.idToLabel[id] = s.label;
        if (label && !(label in ctx.labelToId)) ctx.labelToId[label] = s.id;
      });
    } catch (e) {}
    return ctx;
  }

  const esc = s => String(s === undefined || s === null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function savedSegControl(store, module, opts) {
    opts = opts || {};
    const box = el("span", "seg-saved-box");
    const sel = document.createElement("select");
    sel.className = "sel seg-sel";
    sel.title = "Filter by a saved segment";
    const noneOpt = document.createElement("option");
    noneOpt.value = "";
    noneOpt.textContent = opts.placeholder || "Saved segments…";
    sel.appendChild(noneOpt);
    const manage = document.createElement("a");
    manage.className = "btn btn-ghost btn-sm";
    manage.href = "#/segments";
    manage.textContent = "Segments";
    manage.title = "Create and edit saved segments";
    box.appendChild(sel);
    box.appendChild(manage);
    let segs = [];
    sel.addEventListener("change", () => {
      const seg = segs.find(s => s.id === sel.value) || null;
      if (opts.onPick) opts.onPick(seg);
    });
    async function refresh() {
      segs = await listSegments(store, module);
      const current = sel.value;
      sel.innerHTML = "";
      const n = document.createElement("option");
      n.value = "";
      n.textContent = opts.placeholder || "Saved segments…";
      sel.appendChild(n);
      segs.forEach(s => {
        const o = document.createElement("option");
        o.value = s.id;
        o.textContent = s.name;
        sel.appendChild(o);
      });
      if (segs.some(s => s.id === current)) sel.value = current;
      sel.hidden = segs.length === 0;
    }
    refresh();
    box._refresh = refresh;
    return box;
  }

  function segRuleLabel(seg, store, module) {
    const defs = fieldDefsFor(module);
    const findDef = f => {
      const d = defs.find(x => x.f === f);
      if (d) return d.label;
      const c = defs.find(x => x.f === "custom");
      return f === "custom" ? (c ? c.label : f) : (c ? f + " (custom)" : f);
    };
    const opLabel = id => {
      const o = OPS.find(x => x.id === id);
      return o ? o.label : id;
    };
    const vText = (f, v, from, to) => {
      const d = defs.find(x => x.f === f);
      if (from !== undefined || to !== undefined) {
        return (from === undefined || from === null || from === "" ? "…" : from) + " – " + (to === undefined || to === null || to === "" ? "…" : to);
      }
      if (d && d.type === "bool") return v === true || v === "true" ? "yes" : "no";
      if (d && d.stage && window.CRM_DEALS && window.CRM_DEALS.stageLabel) {
        const l = window.CRM_DEALS.stageLabel(v);
        return l ? l : String(v === undefined || v === null ? "" : v);
      }
      return String(v === undefined || v === null ? "" : v);
    };
    return seg.rules.map(r => findDef(r.f) + " " + opLabel(r.op) + " " + vText(r.f, r.v, r.from, r.to));
  }

  function ruleRowView(seg, idx, store) {
    const defs = fieldDefsFor(seg.module);
    const row = el("div", "sg-rule");
    const fSel = document.createElement("select");
    fSel.className = "sel sg-f";
    defs.forEach(d => {
      const o = document.createElement("option");
      o.value = d.f;
      o.textContent = d.label;
      if (d.f === "custom") o.dataset.custom = "1";
      fSel.appendChild(o);
    });
    const nameIn = document.createElement("input");
    nameIn.type = "text";
    nameIn.className = "inp sg-name";
    nameIn.placeholder = "Record field name, e.g. vatNumber";
    nameIn.maxLength = 60;
    nameIn.hidden = true;
    const opSel = document.createElement("select");
    opSel.className = "sel sg-op";
    const valWrap = el("span", "sg-val");
    const del = document.createElement("button");
    del.type = "button";
    del.className = "btn btn-ghost btn-sm";
    del.textContent = "✕";
    del.title = "Remove rule";
    del.addEventListener("click", () => row.remove());
    const fG = el("div", "sg-ctl sg-ctl-f");
    fG.appendChild(el("span", "sg-ctl-lbl", "Field"));
    fG.appendChild(fSel);
    fG.appendChild(nameIn);
    const oG = el("div", "sg-ctl sg-ctl-o");
    oG.appendChild(el("span", "sg-ctl-lbl", "Operator"));
    oG.appendChild(opSel);
    const vG = el("div", "sg-ctl sg-ctl-v");
    vG.appendChild(el("span", "sg-ctl-lbl", "Value"));
    vG.appendChild(valWrap);
    row.appendChild(fG);
    row.appendChild(oG);
    row.appendChild(vG);
    row.appendChild(del);
    const rule = seg.rules[idx];
    const st = { f: rule.f, op: rule.op, v: rule.v, from: rule.from, to: rule.to };
    function rebuild() {
      const custom = fSel.value === "custom";
      const d = custom ? { type: "string", stage: false } : defs.find(x => x.f === fSel.value) || { type: "string", stage: false };
      if (!custom && st.f !== fSel.value) {
        st.f = fSel.value;
        st.v = "";
      }
      if (custom && defs.some(x => x.f === st.f)) st.f = "";
      nameIn.hidden = !custom;
      if (custom) nameIn.value = st.f || "";
      opSel.innerHTML = "";
      const type = d.type;
      const allowed = type === "bool" ? BOOL_OPS : type === "is" ? IS_OPS : OPS.map(o => o.id);
      allowed.forEach(id => {
        const o = OPS.find(x => x.id === id);
        const opt = document.createElement("option");
        opt.value = id;
        opt.textContent = o.label;
        opSel.appendChild(opt);
      });
      if (!st.op || allowed.indexOf(st.op) === -1) st.op = type === "is" ? "is_set" : "eq";
      opSel.value = st.op;
      const op = opSel.value;
      valWrap.innerHTML = "";
      if (op === "is_set" || op === "is_empty") { vG.hidden = true; return; }
      vG.hidden = false;
      if (op === "between") {
        valWrap.appendChild(el("span", "sg-word", "from"));
        const a = document.createElement("input");
        a.type = type === "date" ? "date" : "text";
        a.className = "inp sg-from";
        a.value = st.from === undefined ? "" : st.from;
        valWrap.appendChild(a);
        valWrap.appendChild(el("span", "sg-word", "to"));
        const b = document.createElement("input");
        b.type = type === "date" ? "date" : "text";
        b.className = "inp sg-to";
        b.value = st.to === undefined ? "" : st.to;
        valWrap.appendChild(b);
        a.addEventListener("input", () => { st.from = a.value; });
        b.addEventListener("input", () => { st.to = b.value; });
        return;
      }
      const val = document.createElement("input");
      if (type === "date") val.type = "date";
      else if (type === "num") { val.type = "number"; val.step = "any"; }
      else if (type === "bool") val.type = "checkbox";
      else val.type = "text";
      val.className = type === "bool" ? "sg-bool" : "inp";
      if (type === "bool") {
        val.checked = st.v === true || st.v === "true";
        const lab = el("label", "sg-bool-lab");
        lab.appendChild(val);
        lab.appendChild(el("span", null, fSel.value === "active" ? "active" : fSel.value === "consent" ? "consented" : "yes"));
        valWrap.appendChild(lab);
      } else {
        val.value = st.v === undefined || st.v === null ? "" : String(st.v);
        if (d.stage) {
          dlSeq++;
          const did = "sg-stages-" + dlSeq;
          val.setAttribute("list", did);
          const dl = el("datalist", null);
          dl.id = did;
          const labels = (window.CRM_DEALS && window.CRM_DEALS.stageLabels) ? window.CRM_DEALS.stageLabels() : [];
          labels.forEach(l => {
            const o = document.createElement("option");
            o.value = l;
            dl.appendChild(o);
          });
          valWrap.appendChild(dl);
        }
        valWrap.appendChild(val);
      }
      val.addEventListener("input", () => {
        if (type === "bool") st.v = val.checked;
        else st.v = val.value;
      });
      val.addEventListener("change", () => {
        if (type === "bool") st.v = val.checked;
        else if (val.type === "number") st.v = val.value === "" ? "" : Number(val.value);
        else st.v = val.value;
      });
    }
    fSel.addEventListener("change", () => {
      if (fSel.value === "custom") {
        st.f = "";
        st.op = "eq";
        st.v = "";
        st.from = undefined;
        st.to = undefined;
      } else {
        const d = defs.find(x => x.f === fSel.value);
        st.f = fSel.value;
        st.op = "eq";
        st.v = d && d.type === "bool" ? false : "";
        st.from = undefined;
        st.to = undefined;
        if (d && d.type === "is") st.op = "is_set";
      }
      rebuild();
    });
    nameIn.addEventListener("input", () => { st.f = nameIn.value.trim(); });
    opSel.addEventListener("change", () => { st.op = opSel.value; rebuild(); });
    if (rule.f && defs.some(d => d.f === rule.f)) {
      fSel.value = rule.f;
      st.f = rule.f;
    } else {
      fSel.value = "custom";
    }
    if (!st.op) st.op = "eq";
    rebuild();
    row._read = () => {
      const custom = fSel.value === "custom";
      const fieldName = (custom ? nameIn.value.trim() : st.f) || "";
      if (!fieldName) return null;
      const d = custom ? { type: "string" } : defs.find(x => x.f === fieldName) || { type: "string" };
      const out = { f: fieldName, op: opSel.value };
      const op = opSel.value;
      if (op === "is_set" || op === "is_empty") return out;
      if (op === "between") {
        const fromI = valWrap.querySelector(".sg-from");
        const toI = valWrap.querySelector(".sg-to");
        const fromV = fromI ? fromI.value : "";
        const toV = toI ? toI.value : "";
        if (fromV !== "" || toV !== "") {
          out.from = fromV;
          out.to = toV;
        }
        return out;
      }
      const vi = valWrap.querySelector("input");
      if (!vi) return out;
      if (vi.type === "checkbox") out.v = vi.checked;
      else if (vi.type === "number") out.v = vi.value === "" ? "" : Number(vi.value);
      else out.v = vi.value;
      if (d.type === "bool") out.v = !!vi.checked;
      if (d.type === "is") out.v = true;
      return out;
    };
    return row;
  }

  function segmentForm(store, seg, onDone) {
    seg = seg || {};
    const card = el("section", "card sg-form");
    const title = el("div", "card-title-row");
    title.appendChild(el("h2", null, seg.id ? "Edit segment" : "New segment"));
    card.appendChild(title);
    const top = el("div", "bkp-msg");
    top.hidden = true;
    card.appendChild(top);
    const form = el("form", "frm sg-editor");
    form.setAttribute("novalidate", "");
    const nameIn = document.createElement("input");
    nameIn.className = "inp";
    nameIn.placeholder = "e.g. customers > 6 months";
    nameIn.value = seg.name || "";
    const U = window.RECORDUI;
    form.appendChild(U.fld("text", "Segment name", nameIn, { id: "sg-name", required: true, full: true }));
    const modSel = document.createElement("select");
    modSel.className = "sel";
    const MODULES = [
      { id: "companies", label: "Companies" },
      { id: "contacts", label: "Contacts" },
      { id: "leads", label: "Leads" },
      { id: "deals", label: "Deals" }
    ];
    MODULES.forEach(m => {
      const o = document.createElement("option");
      o.value = m.id;
      o.textContent = m.label;
      modSel.appendChild(o);
    });
    if (seg.module) modSel.value = seg.module;
    form.appendChild(U.fld("select", "Applies to", modSel, { id: "sg-mod" }));
    const kindSel = document.createElement("select");
    kindSel.className = "sel";
    const ka = document.createElement("option");
    ka.value = "all";
    ka.textContent = "Match ALL rules";
    const ko = document.createElement("option");
    ko.value = "any";
    ko.textContent = "Match ANY rule";
    kindSel.appendChild(ka);
    kindSel.appendChild(ko);
    kindSel.value = seg.kind === "any" ? "any" : "all";
    form.appendChild(U.fld("select", "Matching", kindSel, { id: "sg-kind" }));
    const rulesWrap = el("div", "full sg-rules");
    rulesWrap.appendChild(el("p", "fld-hint", "Rules — members are computed live from the current records."));
    form.appendChild(rulesWrap);
    const rules = (seg.rules || [defaultRuleFor(modSel.value)]).slice();
    const fakeSeg = { module: modSel.value, rules };
    let ruleViews = [];
    function renderRules() {
      rulesWrap.querySelectorAll(".sg-rule").forEach(n => n.remove());
      ruleViews = rules.map((rl, i) => ruleRowView(fakeSeg, i, store));
      ruleViews.forEach(v => rulesWrap.appendChild(v));
      const add = document.createElement("button");
      add.type = "button";
      add.className = "btn btn-ghost btn-sm";
      add.textContent = "＋ Add rule";
      add.addEventListener("click", () => {
        rules.push(defaultRuleFor(modSel.value));
        fakeSeg.module = modSel.value;
        renderRules();
      });
      const box = el("div", "sg-addwrap");
      box.appendChild(add);
      rulesWrap.appendChild(box);
    }
    renderRules();
    modSel.addEventListener("change", () => {
      fakeSeg.module = modSel.value;
      rules.splice(0);
      rules.push(defaultRuleFor(modSel.value));
      renderRules();
    });
    const foot = el("div", "frm-foot full");
    const save = document.createElement("button");
    save.type = "submit";
    save.className = "btn btn-primary";
    save.textContent = seg.id ? "Save segment" : "Create segment";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "btn btn-ghost";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => { if (onDone) onDone(); });
    foot.appendChild(save);
    foot.appendChild(cancel);
    form.appendChild(foot);
    card.appendChild(form);
    form.addEventListener("submit", async ev => {
      ev.preventDefault();
      const name = nameIn.value.trim();
      if (!name) {
        top.className = "bkp-msg err";
        top.textContent = "Give the segment a name.";
        top.hidden = false;
        return;
      }
      const cleanRules = [];
      rulesWrap.querySelectorAll(".sg-rule").forEach(rowNode => {
        const r = rowNode._read ? rowNode._read() : null;
        if (r && r.f) cleanRules.push(r);
      });
      if (!cleanRules.length) {
        top.className = "bkp-msg err";
        top.textContent = "Add at least one rule.";
        top.hidden = false;
        return;
      }
      save.disabled = true;
      const res = await saveSegment(store, {
        id: seg.id,
        name,
        module: modSel.value,
        kind: kindSel.value,
        rules: cleanRules
      });
      if (res && res.ok) {
        window.CRM.toast(seg.id ? "Segment saved." : "Segment created.");
        if (onDone) onDone();
      } else {
        save.disabled = false;
        top.className = "bkp-msg err";
        top.textContent = U ? U.describeError(res, "segments") : ((res && res.detail) || "Could not save.");
        top.hidden = false;
      }
    });
    return card;
  }

  async function managerView(ctx) {
    const store = (window.CRM && window.CRM.store) || null;
    const wrap = el("div", "cmp-view");
    if (!store) {
      wrap.appendChild(el("div", "card"));
      wrap.appendChild(el("p", "hint", "The document store isn't ready yet. Try again in a moment."));
      return wrap;
    }
    const intro = el("div", "card sg-intro");
    intro.appendChild(el("h2", null, "Saved segments"));
    intro.appendChild(el("p", "hint", "Segments are named, reusable filters over any company, contact, lead or deal field — including time-based ones like “no activity in 30 days”. Members are computed live each time the segment is applied, so they stay up to date automatically. Pick a saved segment from the dropdown on the Companies, Contacts, Leads or Deals page, or filter from the Dashboard KPI tiles."));
    wrap.appendChild(intro);
    const editing = { seg: null, open: false };
    const listBox = el("div", "sg-list");
    const formAnchor = el("div");
    const newBar = el("div", "sg-newbar");
    wrap.appendChild(listBox);
    wrap.appendChild(formAnchor);
    wrap.appendChild(newBar);
    function showNew() {
      editing.open = true;
      newBar.innerHTML = "";
      formAnchor.innerHTML = "";
      formAnchor.appendChild(segmentForm(store, null, () => {
        editing.open = false;
        formAnchor.innerHTML = "";
        newBar.innerHTML = "";
        refresh();
      }));
    }
    async function refresh() {
      listBox.innerHTML = "";
      newBar.innerHTML = "";
      const segs = await docSegments(store);
      const byMod = {};
      segs.forEach(s => { (byMod[s.module] = byMod[s.module] || []).push(s); });
      const order = ["companies", "contacts", "leads", "deals"];
      let any = false;
      for (const m of order) {
        const list = byMod[m] || [];
        if (!list.length) continue;
        any = true;
        const card = el("section", "card sg-modcard");
        const h = el("div", "card-title-row");
        h.appendChild(el("h2", null, window.CRM_RECORDS.moduleLabel(m)));
        h.appendChild(el("span", "chip", list.length + (list.length === 1 ? " segment" : " segments")));
        card.appendChild(h);
        for (const s of list) {
          const row = el("div", "sg-card");
          const head = el("div", "sg-card-head");
          head.appendChild(el("span", "rec-name", s.name));
          const acts = el("span", "sg-acts");
          const editB = document.createElement("button");
          editB.type = "button";
          editB.className = "btn btn-ghost btn-sm";
          editB.textContent = "Edit";
          const delB = document.createElement("button");
          delB.type = "button";
          delB.className = "btn btn-danger btn-sm";
          delB.textContent = "Delete";
          acts.appendChild(editB);
          acts.appendChild(delB);
          head.appendChild(acts);
          row.appendChild(head);
          const rulesLine = el("p", "hint");
          rulesLine.textContent = "Match " + (s.kind === "any" ? "any" : "all") + ": " + segRuleLabel(s, store, m).join("; ");
          row.appendChild(rulesLine);
          const footLine = el("div", "sg-card-foot");
          const count = el("span", "chip sg-count");
          count.textContent = "counting…";
          footLine.appendChild(count);
          if (s.updatedAt) footLine.appendChild(el("span", "muted", "updated " + window.CRM_RECORDS.timeAgo(s.updatedAt)));
          row.appendChild(footLine);
          members(store, s).then(list2 => {
            count.textContent = list2.length + " member" + (list2.length === 1 ? "" : "s") + " now";
          }).catch(() => { count.textContent = "—"; });
          card.appendChild(row);
          editB.addEventListener("click", () => {
            editing.seg = s;
            editing.open = true;
            formAnchor.innerHTML = "";
            formAnchor.appendChild(segmentForm(store, s, () => {
              editing.open = false;
              formAnchor.innerHTML = "";
              refresh();
            }));
          });
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
            const res = await deleteSegment(store, s.id);
            if (res && res.ok) {
              window.CRM.toast("Segment deleted.");
              if (editing.open && editing.seg && editing.seg.id === s.id) formAnchor.innerHTML = "";
              refresh();
            } else {
              window.CRM.toast((res && res.detail) || "Could not delete the segment.");
            }
          });
        }
        listBox.appendChild(card);
      }
      if (!any) {
        const empty = el("div", "rec-empty");
        empty.appendChild(el("p", "state-title", "No saved segments yet"));
        empty.appendChild(el("p", "state-msg", "Create your first named filter — e.g. “customers > 6 months”, “prospects closing this quarter” or “no activity in 30 days”."));
        listBox.appendChild(empty);
      }
      if (!editing.open) {
        formAnchor.innerHTML = "";
        const openNew = document.createElement("button");
        openNew.type = "button";
        openNew.className = "btn btn-primary btn-sm";
        openNew.textContent = "＋ New segment";
        openNew.addEventListener("click", showNew);
        newBar.appendChild(openNew);
      }
    }
    await refresh();
    return wrap;
  }

  return {
    MOD,
    newId,
    FIELD_DEFS,
    fieldDefsFor,
    OPS,
    segMatches,
    ruleMatches,
    docSegments,
    listSegments,
    saveSegment,
    deleteSegment,
    members,
    activityIndex,
    stageOptions,
    stageCtx,
    defaultRuleFor,
    savedSegControl,
    managerView,
    boolOps: BOOL_OPS,
    isOps: IS_OPS
  };
})();
