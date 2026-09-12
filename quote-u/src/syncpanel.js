// ============================================================================
// quote-u — sync conflict resolution panel (roadmap task 8)
// ----------------------------------------------------------------------------
// Renders the unresolved conflicts the document store surfaced when the same
// entity document was changed on more than one device since the last sync.
// Offers keep-mine / keep-theirs / field-by-field merge, calls the store's
// guarded resolvers, and never overwrites a moved document. The losing side is
// archived by the store into the module's resolution history.
// Lifted from CRM-U's src/syncpanel.js (window.QU_SYNC).
// ============================================================================
window.QU_SYNC = (function () {
  function moduleLabel(id) {
    const def = (window.QU_MODULES || []).find(m => m.id === id);
    if (def) return def.label;
    return id.charAt(0).toUpperCase() + id.slice(1);
  }
  function fmtVal(v) {
    const s = JSON.stringify(v);
    if (s == null) return "null";
    return s.length > 74 ? s.slice(0, 74) + "…" : s;
  }
  function shortId(id) {
    return id === "__anon0" || /^__anon\d+$/.test(String(id)) ? null : String(id);
  }
  function recLabel(record) {
    if (!record || typeof record !== "object") return "record";
    const cand = ["title", "name", "company", "subject", "email", "quote_number", "stage"].find(k => typeof record[k] === "string" && record[k]);
    return cand ? String(record[cand]) : record.id !== undefined ? "Record #" + record.id : "Unnamed record";
  }
  function timeAgo(iso) {
    if (!iso) return "recently";
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 8) return "just now";
    if (s < 60) return Math.round(s) + "s ago";
    if (s < 3600) return Math.round(s / 60) + "m ago";
    if (s < 86400) return Math.round(s / 3600) + "h ago";
    return new Date(iso).toLocaleDateString();
  }
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function radioRow(scopeKey, labelEl, mineTxt, theirsTxt) {
    const row = el("div", "mdf-row");
    const lab = el("div", "mdf-label");
    lab.appendChild(labelEl);
    row.appendChild(lab);
    const opts = el("div", "mdf-opts");
    function sideEl(value, content, checked) {
      const l = el("label", "mdf-side");
      const inp = document.createElement("input");
      inp.type = "radio";
      inp.name = "mrg-" + scopeKey;
      inp.value = value;
      inp.checked = !!checked;
      inp.dataset.scope = "pick";
      l.appendChild(inp);
      const sp = el("span", "mdf-side-txt");
      sp.appendChild(el("span", "mdf-side-who", value === "mine" ? "This device" : "Other device"));
      if (typeof content === "string") sp.appendChild(document.createTextNode(content));
      else sp.appendChild(content);
      l.appendChild(sp);
      return l;
    }
    opts.appendChild(sideEl("mine", mineTxt, true));
    opts.appendChild(sideEl("theirs", theirsTxt, false));
    row.appendChild(opts);
    return row;
  }

  function buildMergeArea(diff) {
    const area = el("div", "merge-box");
    const top = diff.top || [];
    const recs = (diff.records || {});
    const topConflictRows = top.filter(t => t.conflict);
    const topAutoRows = top.filter(t => !t.conflict && t.only);
    const changedRecs = recs.changed || [];
    const mineOnly = (recs.mineOnly || []).length;
    const theirsOnly = (recs.theirsOnly || []).length;
    const many = changedRecs.length + topConflictRows.length;

    const note = el("p", "merge-note");
    note.textContent = "Pick which version to keep for each changed field; the rest merge automatically. Nothing is discarded — the losing side is archived.";
    area.appendChild(note);

    if (many === 0) {
      const p = el("p", "hint");
      p.textContent = mineOnly || theirsOnly
        ? "The two versions differ only by added records — the merge keeps everything from both sides."
        : "The two versions differ only in fields that changed on one side — the merge keeps the changed side automatically.";
      area.appendChild(p);
    }

    if (topConflictRows.length) {
      area.appendChild(el("div", "mdf-group-title", "Document fields"));
      for (const t of topConflictRows) {
        const label = el("span", "mdf-key", String(t.key));
        const mineC = el("code", "mdf-val", fmtVal(t.mine));
        const theirsC = el("code", "mdf-val", fmtVal(t.theirs));
        const row = radioRow("top-" + String(t.key), label, mineC, theirsC);
        row.querySelector("input[value='mine']").dataset.field = String(t.key);
        row.querySelector("input[value='theirs']").dataset.field = String(t.key);
        row.dataset.role = "top-pick";
        area.appendChild(row);
      }
    }
    if (topAutoRows.length) {
      area.appendChild(el("div", "mdf-group-title", "Kept automatically (changed on one side only)"));
      for (const t of topAutoRows) {
        const row = el("div", "mdf-row mdf-auto");
        const lab = el("div", "mdf-label");
        lab.appendChild(el("span", "mdf-key", String(t.key)));
        lab.appendChild(el("span", "mdf-who", t.only === "mine" ? "changed on this device" : "changed on the other device"));
        row.appendChild(lab);
        area.appendChild(row);
      }
    }

    if (changedRecs.length) {
      area.appendChild(el("div", "mdf-group-title", "Records changed on both devices"));
      for (const c of changedRecs) {
        const block = el("div", "mdf-record");
        block.appendChild(el("div", "mdf-record-title", recLabel(c.record) + (shortId(c.id) !== null ? "  ·  #" + shortId(c.id) : "")));
        for (const f of c.fields || []) {
          if (f.only) continue;
          const label = el("span", "mdf-key", String(f.key));
          const row = radioRow("rec-" + String(c.id) + "-" + String(f.key), label, el("code", "mdf-val", fmtVal(f.mine)), el("code", "mdf-val", fmtVal(f.theirs)));
          row.querySelectorAll("input").forEach(inp => {
            inp.dataset.role = "rec-pick";
            inp.dataset.rec = String(c.id);
            inp.dataset.field = String(f.key);
          });
          block.appendChild(row);
        }
        area.appendChild(block);
      }
    }

    const addParts = [];
    if (mineOnly) addParts.push(mineOnly + " record" + (mineOnly === 1 ? "" : "s") + " added on this device");
    if (theirsOnly) addParts.push(theirsOnly + " record" + (theirsOnly === 1 ? "" : "s") + " added on the other device");
    if (addParts.length) {
      const addLine = el("p", "merge-additions");
      addLine.textContent = "Merge keeps: " + addParts.join(" and ") + ".";
      area.appendChild(addLine);
    }
    return area;
  }

  function gatherPicks(area) {
    const picks = { top: {}, recs: {} };
    area.querySelectorAll("input[data-role='top-pick']").forEach(inp => {
      if (inp.checked) picks.top[inp.dataset.field] = inp.value;
    });
    area.querySelectorAll("input[data-role='rec-pick']").forEach(inp => {
      if (!inp.checked) return;
      picks.recs[inp.dataset.rec] = picks.recs[inp.dataset.rec] || {};
      picks.recs[inp.dataset.rec][inp.dataset.field] = inp.value;
    });
    return picks;
  }

  function conflictBlock(store, conflict, opts) {
    const module = conflict.module;
    const wrap = el("div", "conflict-block");
    const head = el("div", "conflict-head");
    const title = el("div", "conflict-title");
    title.appendChild(el("span", "conflict-mod", moduleLabel(module)));
    title.appendChild(el("span", "chip chip-danger", "needs resolution"));
    head.appendChild(title);
    const sub = el("div", "conflict-sub");
    sub.textContent =
      "Edited on this device " + timeAgo(conflict.mine.stagedAt || conflict.detectedAt) +
      " (from revision " + conflict.base.revision + "), while the other device saved revision " +
      conflict.theirs.revision + " " + timeAgo(conflict.theirs.updatedAt) + ". Nothing has been overwritten.";
    head.appendChild(sub);
    wrap.appendChild(head);

    const err = el("div", "conflict-err");
    err.hidden = true;
    wrap.appendChild(err);

    const actions = el("div", "conflict-actions");
    const mineBtn = el("button", "btn btn-primary btn-sm", "Keep this device's changes");
    const theirsBtn = el("button", "btn btn-ghost btn-sm", "Keep the other changes");
    const mergeBtn = el("button", "btn btn-ghost btn-sm", "Merge field by field…");
    actions.appendChild(mineBtn);
    actions.appendChild(theirsBtn);
    actions.appendChild(mergeBtn);
    wrap.appendChild(actions);

    function busy(btn, on) {
      btn.disabled = on;
      btn.textContent = on ? "Working…" : btn.dataset.label;
    }
    mineBtn.dataset.label = mineBtn.textContent;
    theirsBtn.dataset.label = theirsBtn.textContent;

    async function runResolve(choice, payload) {
      [mineBtn, theirsBtn, mergeBtn].forEach(b => busy(b, true));
      err.hidden = true;
      const res = await store.resolveConflict(module, choice, payload || {});
      [mineBtn, theirsBtn, mergeBtn].forEach(b => busy(b, false));
      if (res.ok) {
        if (opts && opts.onChange) opts.onChange(module, res);
        return;
      }
      err.textContent = res.detail || ("Couldn't resolve: " + res.code);
      err.hidden = false;
    }

    mineBtn.addEventListener("click", () => runResolve("keepMine"));
    theirsBtn.addEventListener("click", () => runResolve("keepTheirs"));

    const mergeArea = el("div", "merge-ctn");
    mergeArea.hidden = true;
    let diffLoaded = false;
    mergeBtn.addEventListener("click", async () => {
      if (diffLoaded) {
        mergeArea.hidden = !mergeArea.hidden;
        mergeBtn.textContent = mergeArea.hidden ? "Merge field by field…" : "Merge field by field… (hide)";
        return;
      }
      mergeBtn.disabled = true;
      const res = await store.mergeDiff(module);
      if (!res.ok) {
        mergeBtn.disabled = false;
        err.textContent = res.detail || ("Couldn't prepare a merge: " + res.code);
        err.hidden = false;
        return;
      }
      const box = buildMergeArea(res.diff);
      const applyBtn = el("button", "btn btn-primary btn-sm", "Apply merged changes");
      const foot = el("div", "merge-foot");
      foot.appendChild(applyBtn);
      mergeArea.appendChild(box);
      mergeArea.appendChild(foot);
      wrap.insertBefore(mergeArea, wrap.querySelector(".conflict-actions").nextSibling);
      mergeArea.hidden = false;
      diffLoaded = true;
      mergeBtn.disabled = false;
      mergeBtn.textContent = "Merge field by field… (hide)";
      applyBtn.addEventListener("click", async () => {
        const picks = gatherPicks(box);
        applyBtn.disabled = true;
        const built = await store.buildMerged(module, picks);
        if (!built.ok) {
          err.textContent = built.detail || ("Couldn't build the merged version: " + built.code);
          err.hidden = false;
          applyBtn.disabled = false;
          return;
        }
        await runResolve("merge", { merged: built.merged, picks });
      });
    });

    const arch = el("p", "conflict-arch");
    arch.textContent = "The side you don't keep is archived to this device's resolution history, so nothing is ever discarded silently.";
    wrap.appendChild(arch);
    return wrap;
  }

  async function conflictBlocks(store, opts) {
    const list = await store.listConflicts();
    if (!list.length) return null;
    const zone = el("section", "sync-zone card");
    const head = el("div", "sync-zone-head");
    head.appendChild(el("h2", "", "Sync conflicts"));
    head.appendChild(el("span", "chip chip-danger", list.length + (list.length === 1 ? " document" : " documents")));
    zone.appendChild(head);
    const lead = el("p", "sync-zone-lead");
    lead.textContent = "The same documents were changed on more than one device since the last sync. Choose what to keep before anything is overwritten.";
    zone.appendChild(lead);
    for (const c of list) zone.appendChild(conflictBlock(store, c, opts));
    return zone;
  }

  return { conflictBlocks, moduleLabel, timeAgo, fmtVal };
})();
