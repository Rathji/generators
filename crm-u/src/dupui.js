window.CRM_DUPUI = (function () {
  const R = window.CRM_RECORDS;
  const el = R.el;
  const DUP = window.CRM_DUP;

  function pairSurvivorRow(store, module, a, b, opts) {
    opts = opts || {};
    const row = el("div", "dup-pair");
    const heads = [a, b];
    const defId = opts.defaultId || (a.active !== false ? a.id : b.id);
    const cells = heads.map(rec => {
      const cell = el("label", "dup-side");
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = opts.groupName || "survivor";
      radio.checked = rec.id === defId;
      cell.appendChild(radio);
      const box = el("span", "dup-side-body");
      box.appendChild(el("span", "dup-side-name", R.recordName(rec) || "(unnamed)"));
      if (rec.id) box.appendChild(el("span", "mono dup-side-id", rec.id));
      if (rec.active === false) box.appendChild(el("span", "badge inactive", "Inactive"));
      cell.appendChild(box);
      return cell;
    });
    cells.forEach(c => row.appendChild(c));
    const arrow = el("span", "dup-arrow", "→");
    row.appendChild(arrow);
    return { row, cells, read: () => (cells[0].querySelector("input").checked ? a.id : b.id) };
  }

  function mergeNoteBox() {
    const box = el("div", "dup-note");
    const ta = document.createElement("textarea");
    ta.className = "txa";
    ta.rows = 2;
    ta.placeholder = "Optional note recorded on the survivor (e.g. why you merged).";
    box.appendChild(ta);
    return { box, ta };
  }

  function mergeActionBar(store, module, opts) {
    const U = window.RECORDUI;
    const bar = el("div", "dup-actions");
    const msg = el("div", "bkp-msg dup-msg");
    msg.hidden = true;
    bar.appendChild(msg);
    const run = document.createElement("button");
    run.type = "button";
    run.className = "btn btn-primary btn-sm";
    run.textContent = "Merge records";
    run.disabled = true;
    bar.appendChild(run);
    const note = mergeNoteBox();
    bar.appendChild(note.box);
    function update(pair, what) {
      if (what && pair) {
        run.disabled = false;
        run.textContent = "Merge “" + (pair.read() === opts.aId ? R.recordName(opts.a) : R.recordName(opts.b)) + "” ← duplicate";
      } else {
        run.disabled = true;
      }
      return bar;
    }
    run.addEventListener("click", async () => {
      const survivorId = pair.read();
      const dupId = survivorId === opts.aId ? opts.bId : opts.aId;
      run.disabled = true;
      run.textContent = "Merging…";
      const res = await DUP.mergeRecords(store, { module, survivorId, dupId, note: (note && note.ta && note.ta.value || "").trim() });
      if (res && res.ok) {
        if (opts.onMerged) opts.onMerged(res, dupId);
      } else {
        run.disabled = false;
        run.textContent = "Merge records";
        msg.className = "bkp-msg err dup-msg";
        msg.textContent = U.describeError(res, module);
        msg.hidden = false;
      }
    });
    return bar;
  }

  function dismissAction(store, module, a, b, onDone) {
    const U = window.RECORDUI;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-ghost btn-sm";
    btn.textContent = "Not a duplicate";
    btn.title = "Hide this pair and stop suggesting it";
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      const res = await R.persistUpdate(store, module, content => {
        let changed = false;
        for (const pair of [[a, b], [b, a]]) {
          const rec = R.getRecord(content, pair[0].id);
          if (rec) {
            if (!Array.isArray(rec.dupDismissed)) rec.dupDismissed = [];
            if (rec.dupDismissed.indexOf(pair[1].id) === -1) {
              rec.dupDismissed.push(pair[1].id);
              if (rec.dupDismissed.length > 24) rec.dupDismissed = rec.dupDismissed.slice(-24);
              changed = true;
            }
          }
        }
        return { changed, content };
      }, { events: false });
      if (res && res.ok) {
        window.CRM.toast("Pair dismissed.");
        if (onDone) onDone();
      } else {
        btn.disabled = false;
        window.CRM.toast(U.describeError(res, module));
      }
    });
    return btn;
  }

  async function renderMergePanel(store, module, aId, bId, opts) {
    opts = opts || {};
    const U = window.RECORDUI;
    const doc = await store.loadDoc(module);
    if (!doc || !doc.content) return null;
    const a = R.getRecord(doc.content, aId);
    const b = R.getRecord(doc.content, bId);
    if (!a || !b) return null;
    const card = el("div", "dup-panel");
    const head = el("div", "dup-head");
    head.appendChild(el("strong", null, "Merge duplicate records"));
    head.appendChild(el("span", "dup-hint", "Which record should survive? Its id and every linked deal, activity and note stay; the other is closed out."));
    card.appendChild(head);
    const stats = await Promise.all([aId, bId].map(id => DUP.refStats(store, module, id)));
    const rows = [a, b].map((rec, i) => {
      const line = el("div", "dup-stat");
      line.appendChild(el("span", "rec-name", R.recordName(rec) || "(unnamed)"));
      const extra = [];
      if (rec.email) extra.push(rec.email);
      if (rec.website) extra.push(rec.website);
      if (extra.length) line.appendChild(el("span", "muted", extra.join(" · ")));
      const counts = stats[i].map(s => s.count + " in " + R.moduleLabel(s.module)).join(", ");
      if (counts) line.appendChild(el("span", "dup-linked", counts + " link" + (stats[i].reduce((x, s) => x + s.count, 0) === 1 ? "" : "s")));
      else line.appendChild(el("span", "dup-linked muted", "no linked records"));
      return line;
    });
    rows.forEach(r => card.appendChild(r));
    const pair = pairSurvivorRow(store, module, a, b, { defaultId: opts.defaultId || aId, groupName: "dp-" + aId + bId });
    card.appendChild(pair.row);
    const bar = mergeActionBar(store, module, { a, b, aId, bId });
    card.appendChild(bar.bar);
    const dismiss = dismissAction(store, module, a, b, () => {
      if (opts.onDismiss) opts.onDismiss();
    });
    card.appendChild(dismiss);
    pair.cells.forEach(c => c.querySelector("input").addEventListener("change", () => bar.update(pair, true)));
    bar.update(pair, true);
    return card;
  }

  function dupBanner(store, module, rec, opts) {
    opts = opts || {};
    return (async () => {
      const doc = await store.loadDoc(module);
      if (!doc || !doc.content) return null;
      const fresh = R.getRecord(doc.content, rec.id);
      if (!fresh) return null;
      const dismissed = DUP.dismissedKeys(fresh);
      const cands = DUP.candidatesFor(module, R.recordsOf(doc.content), fresh).filter(c => dismissed.indexOf(c.other.id) === -1);
      if (!cands.length) return null;
      const holder = el("div", "dup-zone");
      function bannerEl(cand) {
        const b = el("div", "bkp-msg warn dup-banner");
        const strong = el("strong", null, "Possible duplicate");
        const txt = el("span", null, " “" + (cand.other.name || R.recordName(cand.other)) + "” looks like the same record (" + cand.reasons.join(", ") + "). ");
        const merge = document.createElement("button");
        merge.type = "button";
        merge.className = "btn btn-primary btn-sm";
        merge.textContent = "Merge records…";
        const keep = document.createElement("button");
        keep.type = "button";
        keep.className = "btn btn-ghost btn-sm";
        keep.textContent = "Not a duplicate";
        b.appendChild(strong);
        b.appendChild(txt);
        b.appendChild(merge);
        b.appendChild(keep);
        merge.addEventListener("click", async () => {
          holder.innerHTML = "";
          const panel = await renderMergePanel(store, module, fresh.id, cand.other.id, {
            defaultId: fresh.id,
            onMerged: () => {
              window.CRM.toast("Records merged.");
              if (window.CRM.rerender) window.CRM.rerender();
            },
            onDismiss: () => { if (window.CRM.rerender) window.CRM.rerender(); }
          });
          if (panel) holder.appendChild(panel);
        });
        keep.addEventListener("click", async () => {
          const res = await R.persistUpdate(store, module, content => {
            const r = R.getRecord(content, fresh.id);
            if (!r) return { changed: false };
            if (!Array.isArray(r.dupDismissed)) r.dupDismissed = [];
            if (r.dupDismissed.indexOf(cand.other.id) === -1) {
              r.dupDismissed.push(cand.other.id);
              if (r.dupDismissed.length > 24) r.dupDismissed = r.dupDismissed.slice(-24);
              return { changed: true, content };
            }
            return { changed: false };
          }, { events: false });
          if (res && res.ok) {
            if (opts.onDismiss) opts.onDismiss();
            else if (window.CRM.rerender) window.CRM.rerender();
          }
        });
        return b;
      }
      for (const c of cands) holder.appendChild(bannerEl(c));
      return holder;
    })();
  }

  async function scanPanel(store, module, opts) {
    opts = opts || {};
    const U = window.RECORDUI;
    const doc = await store.loadDoc(module);
    if (!doc || !doc.content) return null;
    const pairs = DUP.candidatePairs(module, R.recordsOf(doc.content));
    const card = el("div", "dup-scan");
    const head = el("div", "dup-head");
    head.appendChild(el("strong", null, "Duplicate scan — " + R.moduleLabel(module)));
    head.appendChild(el("span", "dup-hint", pairs.length + " potential duplicate pair" + (pairs.length === 1 ? "" : "s") + " found. Merging keeps one stable record id and moves every linked deal, activity and note to it."));
    card.appendChild(head);
    if (!pairs.length) {
      card.appendChild(el("p", "hint", "No likely duplicates in this module. New duplicates are also flagged automatically when a record is saved."));
      return card;
    }
    let anyChanged = false;
    const zone = el("div", "dup-list");
    card.appendChild(zone);
    const skipList = [];
    for (const p of pairs) {
      const dismissedA = DUP.dismissedKeys(p.a).indexOf(p.b.id) !== -1;
      const dismissedB = DUP.dismissedKeys(p.b).indexOf(p.a.id) !== -1;
      if (dismissedA && dismissedB) continue;
      const rowCard = el("div", "dup-paircard");
      const why = el("div", "dup-why", "Why: " + p.reasons.join(", "));
      rowCard.appendChild(why);
      const holder = el("div");
      rowCard.appendChild(holder);
      const render = async () => {
        holder.innerHTML = "";
        const panel = await renderMergePanel(store, module, p.a.id, p.b.id, {
          onMerged: res => {
            window.CRM.toast("Records merged — " + (res.rewrites || []).map(r => r.count + " " + r.module).join(", ") + " relinked.");
            anyChanged = true;
            zone.innerHTML = "";
            card.querySelector(".dup-hint").textContent = "Scan complete — records merged. New duplicates are also flagged automatically when a record is saved.";
            if (opts.onDone) opts.onDone(true);
          },
          onDismiss: () => {
            render();
          }
        });
        if (panel) holder.appendChild(panel);
      };
      await render();
      zone.appendChild(rowCard);
    }
    return card;
  }

  function scanButton(store, module, zoneEl) {
    const holder = el("span", "dup-scanholder");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-ghost btn-sm";
    btn.textContent = "Scan for duplicates";
    btn.title = "Find likely duplicate " + R.moduleLabel(module).toLowerCase() + " and merge them";
    holder.appendChild(btn);
    btn.addEventListener("click", async () => {
      const zone = zoneEl || holder;
      const existing = zone.querySelector(":scope > .dup-scan");
      if (existing) {
        existing.remove();
        return;
      }
      btn.disabled = true;
      holder.appendChild(el("span", "dup-scanning", " scanning…"));
      const panel = await scanPanel(store, module, { onDone: () => { btn.disabled = false; } });
      btn.disabled = false;
      const spin = holder.querySelector(".dup-scanning");
      if (spin) spin.remove();
      if (panel) {
        const old = zone.querySelector(":scope > .dup-scan");
        if (old) old.remove();
        zone.appendChild(panel);
      }
    });
    return holder;
  }

  return { renderMergePanel, dupBanner, scanPanel, scanButton };
})();
