/* ============================================================
   Module: Settings — storage capacity & archival (task 5),
   backup & restore (task 4), snapshot publishing (task 29),
   roles & realtime (tasks 35–38), and the data-integrity panel
   (task 31). Only admins see the destructive/management sections.
   ============================================================ */
(function () {
  "use strict";

  const BI = window.BI;

  function fmtBytes(n) {
    if (n < 1024) return n + " B";
    if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
    return (n / 1048576).toFixed(2) + " MB";
  }

  BI.register({
    id: "settings",
    async load(ctx) {
      return {
        capacity: BI.store.capacity(),
        status: BI.store.status(),
        backups: BI.store.list().filter((e) => e.kind === "backup").map((e) => BI.store.get(e.id)).filter((d) => d).sort((a, b) => b.id.localeCompare(a.id)),
        snapshot: BI.snapshot ? BI.snapshot.status() : null,
        keys: (() => { try { const k = BI.store.exportEditKeys(); return Object.keys(k.keys).length; } catch { return 0; } })(),
        realtime: BI.realtime ? BI.realtime.status() : null,
      };
    },

  });

  function render(ctx, data) {
    const el = ctx.el;
      el.innerHTML = "";
      const isAdmin = BI.realtime.can("manage_sources");
      el.appendChild(BI.ui.pageHead({
        title: "Settings",
        description: "Storage, backup & restore, snapshot publishing, roles & realtime, and system health.",
      }));

      const body = document.createElement("div");
      body.className = "bi-module-body";

      /* ---------- capacity & archival (task 5) ---------- */
      const capCard = BI.ui.card({ header: "Storage capacity", body: document.createElement("div") });
      const capB = capCard.querySelector(".bi-card-b");
      const bar = document.createElement("div");
      bar.className = "bi-cap-bar";
      const fill = document.createElement("div");
      fill.className = "bi-cap-fill";
      fill.style.width = Math.min(100, Math.round(data.capacity.pct * 100)) + "%";
      bar.appendChild(fill);
      capB.appendChild(bar);
      const capMeta = document.createElement("div");
      capMeta.className = "bi-source-meta";
      capMeta.innerHTML = fmtBytes(data.capacity.usedBytes) + " of " + fmtBytes(data.capacity.ceilingBytes) + " used (" + Math.round(data.capacity.pct * 100) + "%) · " + data.capacity.docCount + " documents · mode: " + BI.esc(data.status.mode);
      capB.appendChild(capMeta);
      if (data.capacity.docs.length) {
        const tbl = document.createElement("div");
        tbl.className = "bi-cap-docs";
        for (const d of data.capacity.docs) {
          const rowEl = document.createElement("div");
          rowEl.className = "bi-cap-row";
          rowEl.innerHTML = "<span><b>" + BI.esc(d.id) + "</b><small>" + BI.esc(d.kind) + " · " + BI.esc(d.status) + "</small></span><b>" + fmtBytes(d.bytes) + "</b>";
          const doc = BI.store.get(d.id);
          if (doc && (d.kind === "report" || d.kind === "dashboard" || d.kind === "archive") && BI.realtime.can("edit_dashboard")) {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "bi-btn bi-btn-ghost bi-btn--sm";
            if (d.kind === "archive") {
              btn.textContent = "Unarchive";
              btn.addEventListener("click", async () => {
                const orig = (doc.meta && doc.meta.originalKind) || "report";
                const res = await BI.store.changeKind(d.id, orig);
                if (res.ok) { BI.ui.toast("Unarchived " + d.id, "success"); render(ctx, await ctx.module.load(ctx)); }
              });
            } else {
              btn.textContent = "Archive";
              btn.addEventListener("click", async () => {
                const res = await BI.store.changeKind(d.id, "archive");
                if (res.ok) { BI.ui.toast("Archived " + d.id, "success"); if (BI.integrity) BI.integrity.refresh(); render(ctx, await ctx.module.load(ctx)); }
              });
            }
            rowEl.appendChild(btn);
          }
          tbl.appendChild(rowEl);
        }
        capB.appendChild(tbl);
      }
      body.appendChild(capCard);

      /* ---------- backup & restore (task 4) ---------- */
      const bakCard = BI.ui.card({ header: "Backup & restore", body: document.createElement("div") });
      const bakB = bakCard.querySelector(".bi-card-b");
      const bakActs = document.createElement("div");
      bakActs.className = "bi-settings-acts";
      const dl = document.createElement("button");
      dl.type = "button"; dl.className = "bi-btn bi-btn-primary bi-btn--sm"; dl.textContent = "Download backup";
      dl.addEventListener("click", () => { BI.backup.download(); BI.ui.toast("Backup downloaded", "success"); });
      bakActs.appendChild(dl);
      const pub = document.createElement("button");
      pub.type = "button"; pub.className = "bi-btn bi-btn-ghost bi-btn--sm"; pub.textContent = "Publish backup";
      pub.addEventListener("click", async () => {
        pub.disabled = true; pub.textContent = "…";
        const res = await BI.backup.publish();
        pub.disabled = false; pub.textContent = "Publish backup";
        if (res.ok) { BI.ui.toast("Backup published", "success"); render(ctx, await ctx.module.load(ctx)); }
        else BI.ui.toast((res.error && res.error.message) || "Publish failed", "error");
      });
      bakActs.appendChild(pub);
      const restFile = document.createElement("button");
      restFile.type = "button"; restFile.className = "bi-btn bi-btn-ghost bi-btn--sm"; restFile.textContent = "Restore from file…";
      restFile.addEventListener("click", () => {
        const fi = document.createElement("input");
        fi.type = "file";
        fi.accept = ".json,application/json";
        fi.addEventListener("change", async () => {
          const f = fi.files && fi.files[0];
          if (!f) return;
          const text = await f.text();
          let raw; try { raw = JSON.parse(text); } catch (e) { BI.ui.toast("Not valid JSON", "error"); return; }
          confirmRestore(ctx, raw);
        });
        fi.click();
      });
      bakActs.appendChild(restFile);
      bakB.appendChild(bakActs);
      if (data.backups.length) {
        const bl = document.createElement("div");
        bl.className = "bi-backup-list";
        for (const b of data.backups) {
          const rowEl = document.createElement("div");
          rowEl.className = "bi-backup-row";
          const payload = b.data;
          rowEl.innerHTML = "<span><b>" + BI.esc(b.label || b.id) + "</b><small>" + (payload ? payload.docCount + " docs · " + new Date(payload.generatedAt).toLocaleString() : "backup") + "</small></span>";
          const acts = document.createElement("div");
          acts.className = "bi-report-acts";
          const rest = document.createElement("button");
          rest.type = "button"; rest.className = "bi-btn bi-btn-ghost bi-btn--sm"; rest.textContent = "Restore";
          rest.addEventListener("click", async () => {
            BI.ui.confirm({ title: "Restore from backup", message: "Restore documents from '" + (b.label || b.id) + "'? Current local edits to the same docs will be overwritten.", confirmLabel: "Restore", danger: true }, async (yes) => {
              if (!yes) return;
              const res = await BI.backup.restoreFromDoc(b.id);
              if (res.ok) { BI.ui.toast("Restored " + res.summary.restored + " doc(s)", "success"); render(ctx, await ctx.module.load(ctx)); }
              else BI.ui.toast((res.error && res.error.message) || "Restore failed", "error");
            });
          });
          acts.appendChild(rest);
          rowEl.appendChild(acts);
          bl.appendChild(rowEl);
        }
        bakB.appendChild(bl);
      }
      body.appendChild(bakCard);

      /* ---------- edit keys (cross-device writes) ---------- */
      const keyCard = BI.ui.card({ header: "Edit keys (" + data.keys + " on this device)", body: document.createElement("div") });
      const keyB = keyCard.querySelector(".bi-card-b");
      const keyActs = document.createElement("div");
      keyActs.className = "bi-settings-acts";
      const exp = document.createElement("button");
      exp.type = "button"; exp.className = "bi-btn bi-btn-ghost bi-btn--sm"; exp.textContent = "Export keys";
      exp.addEventListener("click", () => {
        const k = BI.store.exportEditKeys();
        const m = BI.ui.modal({ title: "Export edit keys", body: "<p class=\"bi-modal-msg\">Copy this JSON to the target device (Settings → Import). It grants write access to your documents — keep it private.</p>", width: "wide" });
        const ta = document.createElement("textarea");
        ta.className = "bi-textarea";
        ta.value = JSON.stringify(k, null, 1);
        ta.readOnly = true;
        m.body.appendChild(ta);
        m.box.querySelector(".bi-modal-f").remove();
      });
      keyActs.appendChild(exp);
      const imp = document.createElement("button");
      imp.type = "button"; imp.className = "bi-btn bi-btn-ghost bi-btn--sm"; imp.textContent = "Import keys…";
      imp.addEventListener("click", () => {
        const ta = document.createElement("textarea");
        ta.className = "bi-textarea";
        ta.placeholder = "Paste the exported keys JSON here";
        const m = BI.ui.modal({
          title: "Import edit keys",
          bodyEl: ta,
          actions: [
            { label: "Cancel", kind: "ghost", onClick: (e, close) => close() },
            { label: "Import", kind: "primary", onClick: async (e, close) => {
              let obj; try { obj = JSON.parse(ta.value); } catch (err) { BI.ui.toast("Not valid JSON", "error"); return; }
              const r = BI.store.importEditKeys(obj);
              if (r.ok) { BI.ui.toast("Imported " + r.imported + " key(s)", "success"); close(); render(ctx, await ctx.module.load(ctx)); }
              else BI.ui.toast((r.error && r.error.message) || "Import failed", "error");
            } },
          ],
        });
      });
      keyActs.appendChild(imp);
      keyB.appendChild(keyActs);
      body.appendChild(keyCard);

      /* ---------- roles & realtime (tasks 35–38) ---------- */
      body.appendChild(renderRealtime(ctx, data));

      /* ---------- integrity panel (task 31) ---------- */
      const intCard = BI.ui.card({ header: "Data integrity", body: document.createElement("div") });
      const intB = intCard.querySelector(".bi-card-b");
      const intCtn = document.createElement("div");
      intB.appendChild(intCtn);
      BI.integrity.render(intCtn);
      const rerun = document.createElement("button");
      rerun.type = "button"; rerun.className = "bi-btn bi-btn-ghost bi-btn--sm";
      rerun.textContent = "Re-run checks";
      rerun.addEventListener("click", () => { BI.integrity.render(intCtn); BI.integrity.refresh(); BI.ui.toast("Checks re-run"); });
      intB.appendChild(rerun);
      body.appendChild(intCard);

      el.appendChild(body);
  }

  BI.modules.settings.render = render;

  /* ---------- roles & realtime section ---------- */
  function renderRealtime(ctx, data) {
    const card = BI.ui.card({ header: "Roles & realtime", body: document.createElement("div") });
    const b = card.querySelector(".bi-card-b");
    const rt = data.realtime || { mode: "off", role: "viewer" };
    const meta = document.createElement("div");
    meta.className = "bi-source-meta";
    meta.innerHTML = "mode: <b>" + BI.esc(rt.mode) + "</b> · role: <b>" + BI.esc(rt.role) + "</b>" +
      (rt.presence ? " · open sessions: viewer " + rt.presence.viewer + ", analyst " + rt.presence.analyst + ", admin " + rt.presence.admin : "");
    b.appendChild(meta);
    const acts = document.createElement("div");
    acts.className = "bi-settings-acts";

    if (rt.role === "viewer") {
      const pw = BI.ui.textInput("", "Admin password");
      pw.type = "password";
      const go = document.createElement("button");
      go.type = "button"; go.className = "bi-btn bi-btn-primary bi-btn--sm"; go.textContent = "Sign in as admin";
      go.addEventListener("click", async () => {
        if (!pw.value) { BI.ui.toast("Enter the admin password", "warn"); return; }
        go.disabled = true; go.textContent = "…";
        const res = await BI.realtime.auth(pw.value);
        go.disabled = false; go.textContent = "Sign in as admin";
        if (res && res.ok) { BI.ui.toast("Signed in as " + res.role, "success"); render(ctx, await ctx.module.load(ctx)); }
        else BI.ui.toast("Authentication failed", "error");
      });
      const row = document.createElement("div");
      row.className = "bi-inline";
      row.appendChild(pw); row.appendChild(go);
      acts.appendChild(row);
    } else {
      const out = document.createElement("button");
      out.type = "button"; out.className = "bi-btn bi-btn-ghost bi-btn--sm"; out.textContent = "Sign out";
      out.addEventListener("click", async () => { BI.realtime.setRole("viewer"); BI.ui.toast("Signed out"); render(ctx, await ctx.module.load(ctx)); });
      acts.appendChild(out);
    }

    if (BI.realtime.can("manage_sources")) {
      const force = document.createElement("button");
      force.type = "button"; force.className = "bi-btn bi-btn-ghost bi-btn--sm"; force.textContent = "Reconnect hub";
      force.addEventListener("click", async () => { await BI.realtime.connect(true); BI.ui.toast("Reconnecting…"); });
      acts.appendChild(force);
      const tail = document.createElement("button");
      tail.type = "button"; tail.className = "bi-btn bi-btn-ghost bi-btn--sm"; tail.textContent = "Audit tail";
      tail.addEventListener("click", async () => {
        const res = await BI.realtime.auditTail();
        const m = BI.ui.modal({ title: "Hub audit tail", width: "wide" });
        m.body.innerHTML = "<pre class=\"bi-pre\">" + BI.esc(JSON.stringify(res, null, 1)) + "</pre>";
      });
      acts.appendChild(tail);
    }
    b.appendChild(acts);

    const note = document.createElement("div");
    note.className = "bi-field-hint";
    note.textContent = "Admin password is verified server-side against a hash only. In the unsaved editor the hub runs as a local emulator (single-tab); once saved it goes live across devices.";
    b.appendChild(note);
    return card;
  }

  function confirmRestore(ctx, raw) {
    const v = BI.backup.validate(raw);
    if (!v.ok) {
      const m = BI.ui.modal({ title: "Invalid backup" });
      m.body.innerHTML = "<p class=\"bi-modal-msg\">" + BI.esc((v.error && v.error.message) || "This file is not a valid BI backup.") + "</p>";
      return;
    }
    const bodyEl = document.createElement("div");
    bodyEl.innerHTML = "<p class=\"bi-modal-msg\">This backup contains <b>" + v.docCount + "</b> document(s) (" + fmtBytes(v.sizeBytes) + "). Restoring will overwrite local copies of the same documents.</p>";
    BI.ui.modal({
      title: "Restore from file",
      bodyEl,
      actions: [
        { label: "Cancel", kind: "ghost", onClick: (e, close) => close() },
        { label: "Restore", kind: "danger", onClick: async (e, close) => {
          const res = await BI.backup.restore(raw);
          if (res.ok) { BI.ui.toast("Restored " + res.summary.restored + " doc(s)", "success"); close(); render(ctx, await ctx.module.load(ctx)); if (BI.integrity) BI.integrity.refresh(); }
          else BI.ui.toast((res.error && res.error.message) || "Restore failed", "error");
        } },
      ],
    });
  }
})();
