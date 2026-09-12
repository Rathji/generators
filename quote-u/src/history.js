// ============================================================================
// quote-u — document version history (roadmap task 8)
// ----------------------------------------------------------------------------
// Every time a two-device conflict is resolved, or a backup/older version is
// restored, the document store archives the version that lost into the module's
// resolution history. This panel lists that history for a chosen entity
// document and lets an operator roll any archived version back into the live
// document as a NEW revision — the current version is archived in turn, so
// nothing is ever destroyed and every restore stays revision-guarded.
// ============================================================================
window.QU_HISTORY = (function () {
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
    return new Date(iso).toLocaleDateString();
  }
  function fmtBytes(n) {
    if (n == null) return "";
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
    return (n / (1024 * 1024)).toFixed(2) + " MB";
  }
  function fmtVal(v) {
    const s = JSON.stringify(v);
    if (s == null) return "null";
    return s.length > 90 ? s.slice(0, 90) + "…" : s;
  }

  function entryKind(entry) {
    if (!entry) return "unknown";
    if (entry.kind === "restore") return "backup-restore";
    if (entry.kind === "history-restore") return "history-restore";
    return "conflict";
  }

  function describeEntry(entry) {
    if (!entry) return "Unknown history entry";
    if (entry.kind === "restore") {
      return "Backup restore replaced rev " + ((entry.previous && entry.previous.revision) || 0) + " — that version is archived here";
    }
    if (entry.kind === "history-restore") {
      const prev = entry.previous ? "rev " + entry.previous.revision : "nothing (fresh document)";
      return "An older version was restored to rev " + entry.restoredRevision + " — it replaced " + prev;
    }
    const rev = entry.revision != null ? "rev " + entry.revision : "the document";
    if (entry.choice === "keepMine") return "Conflict resolved by keeping this device's version (" + rev + ") — the other device's version is archived here";
    if (entry.choice === "keepTheirs") return "Conflict resolved by keeping the other device's version (" + rev + ") — this device's version is archived here";
    if (entry.choice === "merge") return "Conflict resolved by a field-level merge (" + rev + ") — both original sides are archived here";
    return "Conflict resolved (" + rev + ")";
  }

  function versionsOf(entry) {
    const out = [];
    if (!entry) return out;
    if (entry.kind === "restore" || entry.kind === "history-restore") {
      if (entry.previous && entry.previous.content) {
        out.push({ key: "previous", label: "Version replaced by the restore (rev " + entry.previous.revision + ")", content: entry.previous.content });
      }
      return out;
    }
    if (entry.choice === "keepMine") {
      if (entry.theirs && entry.theirs.content) out.push({ key: "theirs", label: "Other device's version (rev " + entry.theirs.revision + ")", content: entry.theirs.content });
    } else if (entry.choice === "keepTheirs") {
      if (entry.mine && entry.mine.content) out.push({ key: "mine", label: "This device's version (rev " + entry.mine.revision + ")", content: entry.mine.content });
    } else {
      if (entry.mine && entry.mine.content) out.push({ key: "mine", label: "This device's version (rev " + entry.mine.revision + ")", content: entry.mine.content });
      if (entry.theirs && entry.theirs.content) out.push({ key: "theirs", label: "Other device's version (rev " + entry.theirs.revision + ")", content: entry.theirs.content });
      if (entry.merged) out.push({ key: "merged", label: "Merged version (rev " + entry.revision + ")", content: entry.merged });
    }
    return out;
  }

  function versionBlock(store, module, entry, version, onChange) {
    const block = el("div", "bkp-panel hist-version");
    const head = el("div", "bkp-panel-head");
    const tWrap = el("div");
    tWrap.appendChild(el("div", "bkp-panel-title", version.label));
    tWrap.appendChild(el("div", "bkp-panel-sub", fmtBytes(JSON.stringify(version.content).length) + " of content"));
    head.appendChild(tWrap);
    const actWrap = el("div", "bkp-actions");
    const restBtn = el("button", "btn btn-primary btn-sm", "Restore this version");
    restBtn.dataset.label = restBtn.textContent;
    actWrap.appendChild(restBtn);
    head.appendChild(actWrap);
    block.appendChild(head);
    const det = el("details", "hist-preview");
    const sum = el("summary", "hist-preview-sum", "Preview JSON");
    det.appendChild(sum);
    det.appendChild(el("pre", "arc-json", JSON.stringify(version.content, null, 1)));
    block.appendChild(det);
    const msg = el("div", "bkp-msg");
    msg.hidden = true;
    block.appendChild(msg);
    restBtn.addEventListener("click", async () => {
      restBtn.disabled = true;
      restBtn.textContent = "Restoring…";
      msg.hidden = true;
      const res = await store.restoreHistoryVersion(module, { content: version.content, label: version.label }).catch(e => ({ ok: false, code: "error", detail: (e && e.message) || String(e) }));
      restBtn.textContent = restBtn.dataset.label;
      if (!res.ok) {
        msg.className = "bkp-msg err";
        msg.textContent = res.detail || ("Couldn't restore that version (" + res.code + ").");
        msg.hidden = false;
        restBtn.disabled = false;
        return;
      }
      msg.className = "bkp-msg ok";
      msg.textContent = "Restored to revision " + res.revision + (res.previousRevision != null ? " — the version it replaced (rev " + res.previousRevision + ") is now archived." : ".");
      msg.hidden = false;
      if (window.QU && window.QU.toast) window.QU.toast("Version restored to rev " + res.revision);
      if (onChange) onChange(module, res);
    });
    return block;
  }

  async function renderZone(store, opts) {
    if (!store || typeof store.listHistory !== "function") return null;
    opts = opts || {};
    const zone = el("section", "history-zone card");
    zone.innerHTML = `
      <div class="card-title-row" style="margin-bottom:6px">
        <h2>Version history &amp; restore</h2>
        <span class="chip" data-hist-chip>…</span>
      </div>
      <p class="hint bkp-lead">When a sync conflict is resolved, or a backup or older version is restored, the version that lost is archived here. Restore any archived version to roll it back into the live document as a new revision — the current version is archived in turn, so nothing is lost.</p>
      <div class="hist-form">
        <label class="cap-label" for="histModuleSel">Document</label>
        <select class="cap-select" id="histModuleSel" data-hist-module></select>
      </div>
      <div class="hist-list" data-hist-list></div>
    `;
    const chipEl = zone.querySelector("[data-hist-chip]");
    const modSel = zone.querySelector("[data-hist-module]");
    const listEl = zone.querySelector("[data-hist-list]");

    const frag = document.createDocumentFragment();
    for (const m of store.modules) frag.appendChild(new Option(moduleLabel(m), m));
    modSel.appendChild(frag);

    async function refresh() {
      const m = modSel.value;
      listEl.innerHTML = "";
      if (!m) {
        chipEl.textContent = "no documents";
        listEl.appendChild(el("p", "hint", "No entity documents yet."));
        return;
      }
      listEl.appendChild((() => { const l = el("div", "bkp-loading"); l.appendChild(el("span", "bkp-spinner")); l.appendChild(document.createTextNode("Reading history…")); return l; })());
      const hist = await store.listHistory(m).catch(() => []);
      listEl.innerHTML = "";
      chipEl.textContent = hist.length + (hist.length === 1 ? " entry" : " entries");
      if (!hist.length) {
        listEl.appendChild(el("p", "hint", "No history for " + moduleLabel(m) + " yet. Resolving a sync conflict or restoring a backup will archive the losing version here."));
        return;
      }
      const list = el("div", "arc-batches");
      for (const entry of hist) {
        const item = el("div", "arc-batch");
        const head = el("div", "arc-batch-head");
        const tWrap = el("div", "arc-batch-t");
        tWrap.appendChild(el("span", "arc-batch-title", describeEntry(entry)));
        const subBits = [timeAgo(entry.resolvedAt || entry.at)];
        if (entry.merged) subBits.push("merge");
        subBits.push(entryKind(entry));
        tWrap.appendChild(el("span", "arc-batch-sub", subBits.join(" · ")));
        head.appendChild(tWrap);
        item.appendChild(head);
        const body = el("div", "arc-batch-body");
        item.appendChild(body);
        const versions = versionsOf(entry);
        if (!versions.length) {
          body.appendChild(el("p", "hint", "This entry kept no separately-restorable content."));
        } else {
          body.appendChild(el("p", "hint", "Archived for " + fmtStamp(entry.resolvedAt || entry.at) + " — restoring publishes the chosen version as a new revision."));
          for (const v of versions) body.appendChild(versionBlock(store, m, entry, v, opts.onChange));
        }
        list.appendChild(item);
      }
      listEl.appendChild(list);
    }

    modSel.addEventListener("change", refresh);
    const initial = opts.module || store.modules[0] || "";
    if (initial) modSel.value = initial;
    await refresh();

    return zone;
  }

  return { renderZone, describeEntry, versionsOf, entryKind };
})();
