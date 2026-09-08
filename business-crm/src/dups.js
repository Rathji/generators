window.CRM_DUP = (function () {
  const R = window.CRM_RECORDS;

  function normName(s) {
    return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  }

  function normEmail(s) {
    return String(s || "").trim().toLowerCase().replace(/^mailto:/i, "");
  }

  function normUrl(s) {
    let u = String(s || "").trim().toLowerCase();
    u = u.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/+$/, "");
    return u;
  }

  function emails(rec) {
    const out = [];
    if (rec && rec.email) out.push(normEmail(rec.email));
    if (rec && Array.isArray(rec.emails)) rec.emails.forEach(e => { if (e) out.push(normEmail(e)); });
    return Array.from(new Set(out.filter(Boolean)));
  }

  function dupReasons(module, a, b) {
    const reasons = [];
    if (module === "companies") {
      const na = normName(a && a.name);
      const nb = normName(b && b.name);
      if (na && na === nb) reasons.push("same name");
      const wa = normUrl(a && a.website);
      const wb = normUrl(b && b.website);
      if (wa && wa === wb) reasons.push("same website");
    } else if (module === "contacts") {
      const ea = emails(a).join(",");
      const eb = emails(b).join(",");
      if (ea && ea === eb) reasons.push("same email");
      const na = normName(a && a.name);
      const nb = normName(b && b.name);
      const sameCo = String(a && a.companyId || "") === String(b && b.companyId || "");
      if (na && na === nb && sameCo) reasons.push("same name at same company");
    }
    return reasons;
  }

  function candidatePairs(module, records) {
    const list = (records || []).filter(r => r && typeof r === "object");
    const out = [];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (a.active === false || b.active === false) continue;
        if (a.id === b.id) continue;
        const reasons = dupReasons(module, a, b);
        if (reasons.length) out.push({ a, b, reasons });
      }
    }
    return out;
  }

  function candidatesFor(module, records, rec) {
    const list = (records || []).filter(r => r && r.id !== rec.id);
    const out = [];
    for (const other of list) {
      if (other.active === false || rec.active === false) continue;
      const reasons = dupReasons(module, rec, other);
      if (reasons.length) out.push({ other, reasons });
    }
    return out;
  }

  function dismissedKeys(rec) {
    return Array.isArray(rec && rec.dupDismissed) ? rec.dupDismissed : [];
  }

  const REF_FIELD = { companies: "companyId", contacts: "contactId", leads: "leadId", deals: "dealId" };

  async function docOf(store, module) {
    let doc;
    try {
      doc = await store.loadDoc(module);
    } catch (e) {
      return null;
    }
    return doc && doc.content ? doc : null;
  }

  async function refStats(store, module, id) {
    const field = REF_FIELD[module];
    if (!field) return [];
    const out = [];
    for (const m of (store && store.modules) || []) {
      if (m === module) continue;
      const doc = await docOf(store, m);
      if (!doc) continue;
      let n = 0;
      for (const r of R.recordsOf(doc.content)) {
        if (r && String(r[field]) === String(id)) n++;
      }
      if (n) out.push({ module: m, count: n });
    }
    return out;
  }

  async function mergeRecords(store, opts) {
    const module = opts.module;
    const survivorId = opts.survivorId;
    const dupId = opts.dupId;
    if (!module || !survivorId || !dupId || survivorId === dupId) {
      return { ok: false, code: "bad_request", detail: "Choose two different records to merge." };
    }
    const field = REF_FIELD[module];
    if (!field) return { ok: false, code: "bad_request", detail: "Merging is only supported for companies and contacts." };
    const report = { ok: true, rewrites: [], survivor: null, duplicate: dupId };
    try {
      if (field) {
        for (const m of (store && store.modules) || []) {
          if (m === module) continue;
          const doc = await docOf(store, m);
          if (!doc) continue;
          const content = JSON.parse(JSON.stringify(doc.content || {}));
          let moved = 0;
          for (const r of R.recordsOf(content)) {
            if (r && String(r[field]) === String(dupId)) {
              r[field] = survivorId;
              if (r.updatedAt === undefined) r.updatedAt = R.nowISO();
              moved++;
            }
          }
          if (moved) {
            const res = await store.saveChecked(m, content, { expectedBase: doc.revision });
            if (!res.ok) {
              report.ok = false;
              report.code = res.code;
              report.detail = "References in " + m + " could not be rewritten: " + ((res && res.detail) || res.code);
              return report;
            }
            report.rewrites.push({ module: m, count: moved });
          }
        }
      }
      const sDoc = await docOf(store, module);
      if (!sDoc) return { ok: false, code: "load_failed", detail: "The record document could not be read." };
      const content = JSON.parse(JSON.stringify(sDoc.content || {}));
      const survivor = R.getRecord(content, survivorId);
      const dup = R.getRecord(content, dupId);
      if (!survivor || !dup) return { ok: false, code: "not_found", detail: "One of the records no longer exists." };
      const now = R.nowISO();
      survivor.updatedAt = now;
      if (!Array.isArray(survivor.merges)) survivor.merges = [];
      survivor.merges.push({ at: now, dupId, name: R.recordName(dup) });
      const tags = Array.from(new Set([].concat(Array.isArray(survivor.tags) ? survivor.tags : [], Array.isArray(dup.tags) ? dup.tags : [])));
      if (tags.length) survivor.tags = tags;
      const notes = [survivor.notes, dup.notes ? "— merged from " + R.recordName(dup) + " —\n" + dup.notes : ""].filter(Boolean).join("\n\n");
      if (notes) survivor.notes = notes;
      const note = opts.note;
      if (note) survivor.notes = [survivor.notes, "— merge note: " + note].filter(Boolean).join("\n\n");
      if (!survivor.createdAt && dup.createdAt) survivor.createdAt = dup.createdAt;
      for (const key of Object.keys(dup)) {
        if (key === "id" || key === "createdAt" || key === "updatedAt" || key === "tags" || key === "notes" || key === "merges" || key === "dupDismissed") continue;
        if (survivor[key] === undefined || survivor[key] === null || survivor[key] === "") survivor[key] = dup[key];
      }
      const idx = content.records.findIndex(r => r && String(r.id) === String(dupId));
      if (idx >= 0) content.records.splice(idx, 1);
      const res = await store.saveChecked(module, content, { expectedBase: sDoc.revision });
      if (!res.ok) {
        report.ok = false;
        report.code = res.code;
        report.detail = (res && res.detail) || res.code;
        return report;
      }
      report.survivor = R.getRecord(content, survivorId);
      return report;
    } catch (e) {
      return { ok: false, code: "merge_failed", detail: (e && e.message) || String(e) };
    }
  }

  function isMergeDisabled(rec) {
    return !!(rec && (rec.mergedInto !== undefined || (Array.isArray(rec.merges) && rec.merges.length && rec.active === false)));
  }

  return {
    normName,
    normEmail,
    normUrl,
    dupReasons,
    candidatePairs,
    candidatesFor,
    dismissedKeys,
    refStats,
    mergeRecords,
    REF_FIELD
  };
})();
