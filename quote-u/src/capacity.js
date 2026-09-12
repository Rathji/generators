// ============================================================================
// quote-u — capacity & archive panel (roadmap task 8)
// ----------------------------------------------------------------------------
// Reports each entity document's live size, its number of files and its
// largest file against the 5 MiB editable-file ceiling, and guides archival:
// old-period records are moved into a read-only, hash-verified batch and pruned
// from the live document, freeing room while staying retrievable on demand.
// Lifted from CRM-U's src/capacity.js (window.QU_CAPACITY).
// ============================================================================
window.QU_CAPACITY = (function () {
  function moduleLabel(id) {
    const def = (window.QU_MODULES || []).find(m => m.id === id);
    if (def) return def.label;
    return id.charAt(0).toUpperCase() + id.slice(1);
  }
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function fmtBytes(n) {
    if (n == null) return "";
    if (n < 0) return "unreadable";
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
    return (n / (1024 * 1024)).toFixed(2) + " MB";
  }
  function fmtDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }
  function fmtStamp(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }
  function timeAgo(iso) {
    if (!iso) return "recently";
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 8) return "just now";
    if (s < 60) return Math.round(s) + "s ago";
    if (s < 3600) return Math.round(s / 60) + "m ago";
    if (s < 86400) return Math.round(s / 3600) + "h ago";
    return fmtDate(iso);
  }
  function isDateVal(v, key) {
    if (v === null || v === undefined) return false;
    const kDate = !!key && /(date|time|when|at$|^on$|_on$|closed|close|created|updated|due|won|start|end|since|until|sent|scheduled|completed|opened|deadline|year|month|day|last|next|expiry|expires|anniversary|birth|paid|signed|shipped|received|invoice|follow|approved|decided)/i.test(String(key));
    if (!kDate) return false;
    if (typeof v === "string") return !isNaN(Date.parse(v));
    if (typeof v === "number" && isFinite(v) && v >= 1e9) return true;
    return false;
  }
  function detectDateFields(content, limit) {
    const counts = {};
    const samples = {};
    const recs = Array.isArray(content && content.records) ? content.records : [];
    for (const r of recs) {
      if (!r || typeof r !== "object" || Array.isArray(r)) continue;
      for (const k of Object.keys(r)) {
        if (typeof r[k] === "object" && r[k] !== null) continue;
        if (isDateVal(r[k], k)) {
          counts[k] = (counts[k] || 0) + 1;
          if (samples[k] === undefined) samples[k] = r[k];
        }
      }
    }
    return Object.keys(counts)
      .sort((a, b) => counts[b] - counts[a] || a.localeCompare(b))
      .slice(0, limit === undefined ? 10 : limit)
      .map(k => ({ path: k, count: counts[k], sample: samples[k] }));
  }
  function recordTitle(r) {
    if (!r || typeof r !== "object" || Array.isArray(r)) return "—";
    const keys = ["name", "title", "subject", "full_name", "company", "companyName", "email", "label", "account", "deal", "quote_number", "id"];
    for (const k of keys) {
      const v = r[k];
      if (v !== null && v !== undefined && typeof v !== "object") return String(v);
    }
    return r.id !== undefined ? "Record #" + r.id : "Record";
  }
  function recordSub(r) {
    if (!r || typeof r !== "object" || Array.isArray(r)) return "";
    const bits = [];
    for (const k of Object.keys(r)) {
      const v = r[k];
      if (v === null || v === undefined || typeof v === "object") continue;
      const s = String(v);
      if (s.length > 0 && s.length <= 60 && k !== "name" && k !== "title" && k !== "subject") bits.push(k + ": " + s);
    }
    return bits.slice(0, 3).join(" · ");
  }
  function busy(btn, on) {
    if (!btn) return;
    btn.disabled = on;
    btn.textContent = on ? "Working…" : btn.dataset.label;
  }
  function statusShow(elm, kind, text) {
    elm.innerHTML = "";
    elm.hidden = false;
    elm.appendChild(el("div", "bkp-msg " + kind, text));
  }
  function loadingLine(text) {
    const row = el("div", "bkp-loading");
    row.appendChild(el("span", "bkp-spinner"));
    row.appendChild(document.createTextNode(text));
    return row;
  }
  function recordRows(records) {
    const list = el("div", "arc-records");
    for (const r of records) {
      const det = el("details", "arc-record");
      const sum = el("summary", "arc-record-sum");
      sum.appendChild(el("span", "arc-record-title", recordTitle(r)));
      const sub = recordSub(r);
      if (sub) sum.appendChild(el("span", "arc-record-sub", " — " + sub));
      det.appendChild(sum);
      det.appendChild(el("pre", "arc-json", JSON.stringify(r, null, 1)));
      list.appendChild(det);
    }
    return list;
  }

  async function renderZone(store) {
    if (!store || typeof store.capacityInfo !== "function") return null;
    const zone = el("section", "capacity-zone card");
    zone.innerHTML = `
      <div class="card-title-row" style="margin-bottom:6px">
        <h2>Capacity &amp; archive</h2>
        <span class="chip" data-cap-chip>…</span>
      </div>
      <p class="hint cap-lead">Every entity document lives in server files (one head + part files when it grows) under a 5&nbsp;MB ceiling per file. Old-period records can be moved out of a document into its read-only archive, freeing room while staying retrievable on demand.</p>
      <div class="cap-table-wrap">
        <table class="cap-table" data-cap-table>
          <thead><tr>
            <th>Module</th><th>Live document</th><th>Largest file vs ceiling</th><th>Archive</th>
          </tr></thead>
          <tbody></tbody>
        </table>
      </div>
      <div class="cap-grid">
        <div class="cap-col">
          <h3>Archive old records</h3>
          <p class="hint">Choose a module, the date field that marks each record, and an age. Matching records are listed for review first — archiving moves them into a read-only batch and prunes them from the live document.</p>
          <div class="cap-form">
            <div class="cap-field">
              <label class="cap-label">Module</label>
              <select class="cap-select" data-cap-module></select>
            </div>
            <div class="cap-field">
              <label class="cap-label">Date field on records</label>
              <select class="cap-select" data-cap-field></select>
              <input class="cap-input cap-custom" data-cap-custom placeholder="…or type a field path (e.g. created_at, meta.decided_at)" autocomplete="off">
            </div>
            <div class="cap-field">
              <label class="cap-label">Older than</label>
              <div class="cap-age-row">
                <input class="cap-input cap-num" data-cap-age type="number" min="0" step="1" value="1">
                <select class="cap-select cap-unit" data-cap-unit>
                  <option value="y">years</option>
                  <option value="m">months</option>
                </select>
                <span class="cap-or">or</span>
                <input class="cap-input cap-date" data-cap-date type="date">
              </div>
              <p class="hint cap-cutoff" data-cap-cutoff></p>
            </div>
            <div class="bkp-actions">
              <button class="btn btn-ghost btn-sm" data-cap-preview>Preview matching records</button>
              <button class="btn btn-primary btn-sm" data-cap-archive hidden>Archive to read-only storage</button>
            </div>
          </div>
          <div class="cap-preview" data-cap-previewarea></div>
        </div>
        <div class="cap-col">
          <h3>Archives &amp; retrieval</h3>
          <p class="hint">Batches are read-only: their content is never rewritten. Browse any batch on demand, or move a whole batch back into the live module.</p>
          <div class="arc-list" data-cap-archives></div>
        </div>
      </div>
      <div class="bkp-status" data-cap-status hidden></div>
    `;

    const chipEl = zone.querySelector("[data-cap-chip]");
    const tbody = zone.querySelector("[data-cap-table] tbody");
    const statusEl = zone.querySelector("[data-cap-status]");
    const modSel = zone.querySelector("[data-cap-module]");
    const fieldSel = zone.querySelector("[data-cap-field]");
    const customInput = zone.querySelector("[data-cap-custom]");
    const ageInput = zone.querySelector("[data-cap-age]");
    const unitSel = zone.querySelector("[data-cap-unit]");
    const dateInput = zone.querySelector("[data-cap-date]");
    const cutoffEl = zone.querySelector("[data-cap-cutoff]");
    const previewBtn = zone.querySelector("[data-cap-preview]");
    const archiveBtn = zone.querySelector("[data-cap-archive]");
    const previewArea = zone.querySelector("[data-cap-previewarea]");
    const archArea = zone.querySelector("[data-cap-archives]");
    previewBtn.dataset.label = previewBtn.textContent;
    archiveBtn.dataset.label = archiveBtn.textContent;

    let lastPreview = null;

    function resetStatus() {
      statusEl.innerHTML = "";
      statusEl.hidden = true;
    }
    function cutoffMs() {
      const dv = dateInput.value;
      if (dv) {
        const d = new Date(dv + "T23:59:59.999");
        return isNaN(d.getTime()) ? null : d.getTime();
      }
      const n = Math.max(0, parseInt(ageInput.value, 10) || 0);
      const now = new Date();
      const d = new Date(now);
      if (unitSel.value === "y") d.setFullYear(d.getFullYear() - n);
      else d.setMonth(d.getMonth() - n);
      return d.getTime();
    }
    function chosenField() {
      const custom = customInput.value.trim();
      if (custom) return custom;
      return fieldSel.value && fieldSel.value !== "__none__" ? fieldSel.value : null;
    }
    function updateCutoffText() {
      const ms = cutoffMs();
      const field = chosenField();
      cutoffEl.textContent = ms === null
        ? "Enter an age or an exact date."
        : (field ? "Archives records whose “" + field + "” is before " + fmtDate(new Date(ms).toISOString()) + " — records without a readable date in that field are left alone." : "Choose a date field to see the rule.");
    }

    async function refreshFieldOptions() {
      const m = modSel.value;
      lastPreview = null;
      previewArea.innerHTML = "";
      archiveBtn.hidden = true;
      fieldSel.innerHTML = "";
      customInput.value = "";
      if (!m) {
        fieldSel.appendChild(new Option("no document yet", ""));
        updateCutoffText();
        return;
      }
      let content = null;
      try {
        const ld = await store.loadDoc(m, { refresh: true });
        if (ld && ld.content) content = ld.content;
      } catch (e) {}
      const fields = detectDateFields(content);
      if (fields.length) {
        for (const f of fields) fieldSel.appendChild(new Option(f.path + " (" + f.count + " rec)", f.path));
        fieldSel.appendChild(new Option("(no field — type your own)", "__none__"));
      } else {
        fieldSel.appendChild(new Option("(no date field found — type your own)", "__none__"));
      }
      updateCutoffText();
    }

    function moduleOptions() {
      const frag = document.createDocumentFragment();
      for (const m of store.modules) frag.appendChild(new Option(moduleLabel(m), m));
      modSel.appendChild(frag);
    }

    async function refreshCapacity() {
      const info = await store.capacityInfo().catch(() => null);
      if (!info) {
        tbody.innerHTML = "";
        const tr = document.createElement("tr");
        const td = document.createElement("td");
        td.colSpan = 4;
        td.textContent = "Capacity could not be read.";
        tr.appendChild(td);
        tbody.appendChild(tr);
        chipEl.textContent = "unavailable";
        return;
      }
      chipEl.textContent = store.modules.length + " modules · " + info.totals.liveFiles + " live file" + (info.totals.liveFiles === 1 ? "" : "s") + " · " + fmtBytes(info.totals.liveBytes + info.totals.archBytes);
      tbody.innerHTML = "";
      const ceiling = info.ceiling || 5 * 1024 * 1024;
      for (const m of store.modules) {
        const row = info.modules[m];
        const tr = document.createElement("tr");
        if (row.present) tr.className = "cap-row-live";
        else if (row.archive) tr.className = "cap-row-archived-only";
        const modTd = document.createElement("td");
        modTd.appendChild(el("span", "cap-mod", moduleLabel(m)));
        const st = el("span", "cap-sub");
        if (row.present) st.textContent = "rev " + row.revision + (row.records ? " · " + row.records + " records" : " · no records");
        else if (row.archive) st.textContent = row.localOnly ? "live doc removed here — cache only" : "no live document";
        else st.textContent = row.localOnly ? "local draft only (not on the server)" : "no document yet";
        modTd.appendChild(st);
        if (row.readError) modTd.appendChild(el("div", "cap-sub err", row.readError));
        tr.appendChild(modTd);

        const liveTd = document.createElement("td");
        if (row.present) {
          liveTd.appendChild(el("span", "cap-cell", fmtBytes(row.liveBytes)));
          liveTd.appendChild(el("span", "cap-sub", (row.parts > 1 ? " · " + row.parts + " files" : " · head file")));
          if (row.files.some(f => f.bytes < 0)) liveTd.appendChild(el("span", "cap-sub err", " · a file is unreadable"));
        } else {
          liveTd.appendChild(el("span", "cap-sub muted", "—"));
        }
        tr.appendChild(liveTd);

        const barTd = document.createElement("td");
        if (row.maxFileBytes > 0) {
          const pct = Math.min(100, (row.maxFileBytes / ceiling) * 100);
          const wrap = el("div", "cap-bar");
          const fill = el("div", "cap-bar-fill");
          fill.style.width = Math.max(1.2, pct).toFixed(2) + "%";
          if (pct >= 80) fill.classList.add("hot");
          wrap.appendChild(fill);
          const cap = el("div", "cap-bar-cap");
          cap.textContent = fmtBytes(row.maxFileBytes) + " of " + fmtBytes(ceiling) + " (" + (pct < 0.1 ? "<0.1" : pct.toFixed(pct < 10 ? 1 : 0)) + "%)";
          barTd.appendChild(wrap);
          barTd.appendChild(cap);
        } else {
          barTd.appendChild(el("span", "cap-sub muted", "—"));
        }
        tr.appendChild(barTd);

        const arcTd = document.createElement("td");
        if (row.archive && row.archive.batches) {
          arcTd.appendChild(el("span", "cap-cell", row.archive.batches + " batch" + (row.archive.batches === 1 ? "" : "es") + " · " + row.archive.archivedRecords + " records"));
          const bits = [fmtBytes(row.archive.bytes) + " stored"];
          if (row.archive.restored) bits.push(row.archive.restored + " restored");
          if (row.archive.lastAt) bits.push("last " + timeAgo(row.archive.lastAt));
          arcTd.appendChild(el("span", "cap-sub", bits.join(" · ")));
        } else {
          arcTd.appendChild(el("span", "cap-sub muted", "—"));
        }
        tr.appendChild(arcTd);
        tbody.appendChild(tr);
      }
    }

    async function refreshArchives() {
      archArea.innerHTML = "";
      const m = modSel.value;
      if (!m) {
        archArea.appendChild(el("p", "hint", "Pick a module to see its archive."));
        return;
      }
      archArea.appendChild(loadingLine("Reading the archive index…"));
      const la = await store.listArchive(m).catch(e => ({ ok: false, code: "error", detail: (e && e.message) || String(e) }));
      archArea.innerHTML = "";
      if (!la.ok) {
        archArea.appendChild(el("div", "bkp-msg err", la.detail || ("Couldn't read the archive (" + la.code + ").")));
        return;
      }
      if (la.none || !la.batches.length) {
        archArea.appendChild(el("p", "hint", "No archived batches for " + moduleLabel(m) + " yet. Records you archive from this module will be listed here, read-only."));
        return;
      }
      const list = el("div", "arc-batches");
      const sorted = la.batches.slice().sort((a, b) => b.no - a.no);
      for (const b of sorted) {
        const item = el("div", "arc-batch");
        const head = el("div", "arc-batch-head");
        const tWrap = el("div", "arc-batch-t");
        tWrap.appendChild(el("span", "arc-batch-title", "Batch b" + b.no + " · " + b.count + " record" + (b.count === 1 ? "" : "s") + " archived " + fmtStamp(b.archivedAt)));
        const subBits = [];
        if (b.rule) subBits.push("“" + b.rule.field + "” before " + fmtDate(b.rule.before));
        subBits.push(fmtBytes(b.bytes || 0));
        if (b.restoredAt) subBits.push("restored " + fmtDate(b.restoredAt));
        tWrap.appendChild(el("span", "arc-batch-sub", subBits.join(" · ")));
        head.appendChild(tWrap);
        const acts = el("div", "arc-batch-acts");
        const viewBtn = el("button", "btn btn-ghost btn-sm", "View records");
        viewBtn.dataset.label = viewBtn.textContent;
        const restBtn = el("button", "btn btn-ghost btn-sm", b.restoredAt ? "Restored" : "Restore to live…");
        restBtn.dataset.label = restBtn.textContent;
        if (b.restoredAt) restBtn.disabled = true;
        acts.appendChild(viewBtn);
        acts.appendChild(restBtn);
        head.appendChild(acts);
        item.appendChild(head);
        const body = el("div", "arc-batch-body");
        body.hidden = true;
        item.appendChild(body);
        viewBtn.addEventListener("click", async () => {
          if (!body.hidden) { body.hidden = true; return; }
          body.innerHTML = "";
          body.hidden = false;
          body.appendChild(loadingLine("Reading batch b" + b.no + "…"));
          const rb = await store.readArchiveBatch(m, b.no).catch(e => ({ ok: false, code: "error", detail: (e && e.message) || String(e) }));
          body.innerHTML = "";
          if (!rb.ok) {
            body.appendChild(el("div", "bkp-msg err", rb.detail || ("Couldn't read batch b" + b.no + " (" + rb.code + ").")));
            return;
          }
          body.appendChild(el("p", "hint", "Read-only archive content — " + rb.records.length + " records, verified by content hash."));
          body.appendChild(recordRows(rb.records));
        });
        restBtn.addEventListener("click", async () => {
          busy(restBtn, true);
          resetStatus();
          statusShow(statusEl, "ok", "Moving batch b" + b.no + " back into " + moduleLabel(m) + "…");
          const res = await store.restoreArchiveBatch(m, b.no).catch(e => ({ ok: false, code: "error", detail: (e && e.message) || String(e) }));
          if (!res.ok) {
            statusShow(statusEl, "err", res.detail || ("Couldn't restore batch b" + b.no + " (" + res.code + ")."));
            busy(restBtn, false);
            return;
          }
          const n = res.noop ? "no changes needed" : res.restored + " record" + (res.restored === 1 ? "" : "s") + " restored to the live " + moduleLabel(m) + " module";
          statusShow(statusEl, "ok", "Batch b" + b.no + " — " + n + "." + (res.note ? " " + res.note : ""));
          if (window.QU && window.QU.toast) window.QU.toast("Batch b" + b.no + " restored to live data");
          refreshCapacity();
          refreshArchives();
          refreshFieldOptions();
        });
        list.appendChild(item);
      }
      archArea.appendChild(list);
    }

    function renderPreviewArea(res) {
      previewArea.innerHTML = "";
      lastPreview = res;
      archiveBtn.hidden = true;
      if (!res.ok) {
        previewArea.appendChild(el("div", "bkp-msg err", res.detail || ("Preview failed (" + res.code + ").")));
        return;
      }
      if (!res.count) {
        previewArea.appendChild(el("div", "bkp-msg ok", "No live records in " + moduleLabel(res.module) + " match “" + res.field + "” before " + fmtDate(res.before) + " — nothing to archive."));
        return;
      }
      const box = el("div", "bkp-panel cap-preview-panel");
      const head = el("div", "bkp-panel-head");
      const tWrap = el("div");
      tWrap.appendChild(el("div", "bkp-panel-title", res.count + " record" + (res.count === 1 ? "" : "s") + " match this rule"));
      tWrap.appendChild(el("div", "bkp-panel-sub", "“" + res.field + "” before " + fmtDate(res.before) + " · about " + fmtBytes(res.bytes) + " to move into the archive"));
      head.appendChild(tWrap);
      box.appendChild(head);
      const shown = res.records.slice(0, 40);
      const list = el("div", "arc-records");
      for (const r of shown) {
        const det = el("details", "arc-record");
        const sum = el("summary", "arc-record-sum");
        sum.appendChild(el("span", "arc-record-title", recordTitle(r)));
        const sub = recordSub(r);
        if (sub) sum.appendChild(el("span", "arc-record-sub", " — " + sub));
        det.appendChild(sum);
        det.appendChild(el("pre", "arc-json", JSON.stringify(r, null, 1)));
        list.appendChild(det);
      }
      box.appendChild(list);
      if (res.records.length > shown.length) box.appendChild(el("p", "hint", "…and " + (res.records.length - shown.length) + " more matching records."));
      previewArea.appendChild(box);
      archiveBtn.hidden = false;
    }

    async function doPreview() {
      const m = modSel.value;
      const field = chosenField();
      const ms = cutoffMs();
      if (!m) { statusShow(statusEl, "err", "Pick a module first."); return; }
      if (!field || field === "__none__") { statusShow(statusEl, "err", "Pick or type a date field first."); return; }
      if (ms === null) { statusShow(statusEl, "err", "That cutoff date isn't valid."); return; }
      resetStatus();
      previewArea.innerHTML = "";
      previewArea.appendChild(loadingLine("Scanning " + moduleLabel(m) + " records…"));
      archiveBtn.hidden = true;
      const res = await store.previewArchive(m, { field, before: new Date(ms).toISOString() }).catch(e => ({ ok: false, code: "error", detail: (e && e.message) || String(e) }));
      renderPreviewArea(res);
    }

    async function doArchive() {
      const m = modSel.value;
      if (!lastPreview || !lastPreview.count) return;
      const field = lastPreview.field;
      const ms = cutoffMs();
      const before = new Date(lastPreview.before).getTime();
      const useBefore = ms === null ? before : ms;
      busy(archiveBtn, true);
      previewBtn.disabled = true;
      resetStatus();
      statusShow(statusEl, "ok", "Archiving " + lastPreview.count + " record" + (lastPreview.count === 1 ? "" : "s") + " into the read-only archive and pruning the live document…");
      const res = await store.archiveRecords(m, { field, before: new Date(useBefore).toISOString() }).catch(e => ({ ok: false, code: "error", detail: (e && e.message) || String(e) }));
      if (!res.ok) {
        statusShow(statusEl, "err", res.detail || ("Archiving failed (" + res.code + ")."));
        busy(archiveBtn, false);
        previewBtn.disabled = false;
        return;
      }
      if (res.archived === 0) {
        statusShow(statusEl, "ok", res.detail || "No matching records were found — nothing changed.");
        renderPreviewArea(res);
        busy(archiveBtn, false);
        previewBtn.disabled = false;
        return;
      }
      const b = res.batch || {};
      const bits = [res.archived + " record" + (res.archived === 1 ? "" : "s") + " archived into batch b" + b.no + " of the " + moduleLabel(m) + " archive"];
      if (res.live && res.live.action === "pruned") bits.push("the live module now holds the remaining records (rev " + res.live.revision + ")");
      else if (res.live && res.live.action === "needs_sync") bits.push("live data changed on another device meanwhile — resolve the sync item to finish pruning (records are safe in the archive)");
      else if (res.live && res.live.action === "not_pruned") bits.push("this device has no write key for the live document, so the records are archived but still listed live");
      else if (res.live && res.live.action === "already_pruned") bits.push("the live module was already pruned");
      statusShow(statusEl, "ok", bits.join(" — "));
      if (window.QU && window.QU.toast) window.QU.toast("Archived " + res.archived + " records to batch b" + b.no);
      previewArea.innerHTML = "";
      archiveBtn.hidden = true;
      lastPreview = null;
      busy(archiveBtn, false);
      previewBtn.disabled = false;
      refreshCapacity();
      refreshArchives();
      refreshFieldOptions();
    }

    modSel.addEventListener("change", () => {
      resetStatus();
      refreshFieldOptions();
      refreshArchives();
    });
    customInput.addEventListener("input", updateCutoffText);
    ageInput.addEventListener("input", updateCutoffText);
    unitSel.addEventListener("change", updateCutoffText);
    dateInput.addEventListener("change", updateCutoffText);
    previewBtn.addEventListener("click", doPreview);
    archiveBtn.addEventListener("click", doArchive);

    moduleOptions();
    const initial = store.modules[0] || "";
    refreshCapacity().then(() => {
      modSel.value = initial;
      refreshFieldOptions();
      refreshArchives();
    }).catch(e => {
      chipEl.textContent = "unavailable";
      console.error("quote-u capacity zone init failed:", e);
    });

    return zone;
  }

  return { renderZone, detectDateFields, recordTitle };
})();
