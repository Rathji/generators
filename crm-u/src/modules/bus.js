window.CRM_RENDERERS = window.CRM_RENDERERS || {};
window.CRM_BUSUI = (function () {
  const R = window.CRM_RECORDS;
  const U = window.RECORDUI;
  const BUS = window.CRM_BUS;
  const el = R.el;
  const esc = s => BUS ? BUS.esc(s) : R.esc(s);

  const ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>';

  let ideaCache = null;

  function storeErrorCard(detail) {
    return U.storeCard ? U.storeCard("bus", { detail }) : el("div", "card", detail);
  }

  function statusBanner(env) {
    if (!env || env.ok) return null;
    const b = U.banner("warn", "This workspace is not saved yet — outbound bundles will queue locally and publish once you save the generator. Inbound pulls still work.");
    return b;
  }

  async function build(ctx) {
    const store = ctx.store;
    const env = ctx.env;
    const wrap = el("div", "bus-view");
    const banner = statusBanner(env);
    if (banner) wrap.appendChild(banner);

    const status = await BUS.statusSummary(store);
    const cfg = status.cfg;
    const t = BUS.transport();
    const genName = t ? t.genName : (window.generatorName || "");

    const conn = el("section", "card");
    const connTitle = el("div", "card-title-row");
    connTitle.appendChild(el("h2", null, "Connections"));
    connTitle.appendChild(el("span", "chip", "shared pipeline · v1"));
    conn.appendChild(connTitle);
    conn.appendChild(el("p", "hint", "The bus links this CRM to the other small-business tools. Each participant keeps a plain JSON stream file in its own generator namespace, and the file name doubles as the public URL, so any generator can read any other's stream by fetching https://editable.uploads.dev/file/&lt;generator name&gt;/&lt;file name&gt;. You only configure the upstream generators you read from — what you publish needs no configuration."));
    const form = el("form", "frm");
    form.setAttribute("novalidate", "");

    const ideasRow = el("div", "fld full");
    const ideasLab = document.createElement("label");
    ideasLab.htmlFor = "bus-ideas-peer";
    ideasLab.textContent = "Idea source generator";
    ideasRow.appendChild(ideasLab);
    const ideasIn = document.createElement("input");
    ideasIn.id = "bus-ideas-peer";
    ideasIn.className = "inp";
    ideasIn.type = "text";
    ideasIn.placeholder = BUS.STREAMS.ideas.placeholder;
    ideasIn.value = cfg.ideasPeer || "";
    ideasIn.autocomplete = "off";
    ideasRow.appendChild(ideasIn);
    ideasRow.appendChild(el("p", "hint", "The generator that runs your idea-incubator. Its ideas stream (" + BUS.STREAMS.ideas.file + ") appears in the inbox below, one lead per idea."));
    form.appendChild(ideasRow);

    const recRow = el("div", "fld full");
    const recLab = document.createElement("label");
    recLab.htmlFor = "bus-rec-peers";
    recLab.textContent = "Receivable source generators";
    recRow.appendChild(recLab);
    const recIn = document.createElement("input");
    recIn.id = "bus-rec-peers";
    recIn.className = "inp";
    recIn.type = "text";
    recIn.placeholder = BUS.STREAMS.receivables.placeholder;
    recIn.value = cfg.receivablePeers || "";
    recIn.autocomplete = "off";
    recRow.appendChild(recIn);
    recRow.appendChild(el("p", "hint", "One or more comma-separated generators that publish receivable status (typically the-ledger and the erp). Their bundles are matched to your customers and shown on each company record."));
    form.appendChild(recRow);

    const foot = el("div", "frm-foot full");
    const saveB = document.createElement("button");
    saveB.type = "submit";
    saveB.className = "btn btn-primary";
    saveB.textContent = "Save connections";
    saveB.dataset.busSave = "1";
    foot.appendChild(saveB);
    form.appendChild(foot);
    conn.appendChild(form);

    if (genName) {
      const pubBox = el("div", "bus-files");
      pubBox.appendChild(el("p", "hint", "Files this CRM publishes (point project-master, the-ledger and the erp at these):"));
      for (const id of ["projects", "customers"]) {
        const row = el("div", "bus-file-row");
        const file = BUS.STREAMS[id].file;
        const url = BUS.publicUrlOf(t, file);
        row.appendChild(el("span", "chip", id));
        const code = el("code", "mono", file);
        code.title = url || "";
        row.appendChild(code);
        if (url) {
          const a = document.createElement("a");
          a.className = "btn btn-ghost btn-sm";
          a.href = url;
          a.target = "_blank";
          a.rel = "noopener";
          a.textContent = "view";
          row.appendChild(a);
        }
        pubBox.appendChild(row);
      }
      conn.appendChild(pubBox);
    }

    conn.addEventListener("submit", async ev => {
      ev.preventDefault();
      saveB.disabled = true;
      saveB.textContent = "Saving…";
      const res = await BUS.saveConfig(store, {
        ideasPeer: ideasIn.value.trim(),
        receivablePeers: recIn.value.trim()
      });
      saveB.disabled = false;
      saveB.textContent = "Save connections";
      if (res && res.ok) {
        window.CRM.toast("Connections saved.");
        window.CRM.rerender();
      } else {
        window.CRM.toast("Could not save connections — try again.");
      }
    });
    wrap.appendChild(conn);

    wrap.appendChild(streamsCard(ctx, status));
    wrap.appendChild(await ideaInboxCard(ctx, store, status));
    wrap.appendChild(await logCard(store, status));
    if (window.CRM_HUB && typeof window.CRM_HUB.card === "function") {
      wrap.appendChild(await window.CRM_HUB.card(ctx));
    }

    return wrap;
  }

  function chipState(pass, text) {
    return el("span", "st-chip " + (pass ? "pass" : "fail"), text);
  }

  function timeText(iso) {
    return iso ? R.timeAgo(iso) : "—";
  }

  function streamsCard(ctx, status) {
    const store = ctx.store;
    const card = el("section", "card");
    card.appendChild(el("h2", null, "Streams"));
    const rows = el("div", "rel-list");
    for (const id of BUS.STREAM_ORDER) {
      const def = BUS.STREAMS[id];
      const s = status.streams[id];
      const row = el("div", "stream-row");
      const head = el("div", "stream-head");
      const ttl = el("div", "stream-ttl");
      const nm = el("div", null);
      nm.appendChild(el("span", "chip", id));
      nm.appendChild(document.createTextNode(" " + def.label + (def.dir === "out" ? " → outbound" : " → inbound")));
      ttl.appendChild(nm);
      ttl.appendChild(el("p", "hint", def.hint));
      head.appendChild(ttl);
      const acts = el("div", "stream-acts");

      if (s.dir === "out") {
        const state = el("div", "stream-state");
        state.appendChild(el("span", "chip", s.total + " published"));
        if (s.pendingCount) state.appendChild(el("span", "chip pending", s.pendingCount + " queued"));
        if (s.lastError) state.appendChild(el("span", "chip fail", "needs retry"));
        const last = s.last;
        if (last) {
          state.appendChild(el("p", "hint", "Last bundle " + timeText(last.at) + (last.status === "mirrored" ? " · published" : "") + (last.lastError ? " · " + esc(last.lastError) : "")));
        } else {
          state.appendChild(el("p", "hint", "Nothing published yet — it happens automatically as deals are won and customers are created."));
        }
        head.appendChild(state);
        const pub = document.createElement("button");
        pub.type = "button";
        pub.className = "btn btn-ghost btn-sm";
        pub.textContent = s.pendingCount ? "Retry publishing" : "Publish now";
        pub.dataset.busPub = id;
        pub.addEventListener("click", async () => {
          pub.disabled = true;
          pub.textContent = "Publishing…";
          const res = await BUS.materialize(store, id);
          pub.disabled = false;
          if (res && res.ok) {
            window.CRM.toast(res.noop ? "Nothing new to publish." : "Published " + res.added + " new bundle" + (res.added === 1 ? "" : "s") + ".");
          } else {
            window.CRM.toast(BUS.describe(res && res.code) || (res && res.detail) || "Publish failed.");
          }
          window.CRM.rerender();
        });
        acts.appendChild(pub);
      } else {
        const state = el("div", "stream-state");
        const lg = s.inlog;
        if (lg) {
          const okChip = chipState(lg.ok, lg.ok ? "last pull ok" : "last pull failed");
          state.appendChild(okChip);
          if (lg.count !== undefined) state.appendChild(el("span", "chip", lg.count + " bundle" + (lg.count === 1 ? "" : "s")));
          state.appendChild(el("p", "hint", "Pulled " + timeText(lg.lastPullAt) + (lg.detail ? " · " + esc(lg.detail) : "") + (lg.code && !lg.ok ? " · " + esc(lg.code) : "")));
        } else {
          state.appendChild(el("p", "hint", s.peer ? "Never pulled from " + esc(s.peer) + "." : "No source generator configured yet."));
        }
        head.appendChild(state);
        const pull = document.createElement("button");
        pull.type = "button";
        pull.className = "btn btn-ghost btn-sm";
        pull.dataset.busPull = id;
        pull.textContent = id === "ideas" ? "Pull ideas" : "Pull payment status";
        pull.addEventListener("click", async () => {
          pull.disabled = true;
          pull.textContent = "Pulling…";
          const res = await BUS.pullInbound(store, id);
          pull.disabled = false;
          if (id === "ideas") {
            ideaCache = res.bundles || [];
            window.CRM.rerender();
            if (res.bundles.length) window.CRM.toast("Found " + res.bundles.length + " idea" + (res.bundles.length === 1 ? "" : "s") + ".");
            else if (res.ok) window.CRM.toast("The idea stream is live but has no bundles yet.");
            else window.CRM.toast(BUS.describe(res.code) || "Could not read the idea stream.");
          } else {
            const pullRes = await BUS.pullReceivables(store);
            window.CRM.toast(pullRes.ok ? "Payment status updated for " + pullRes.matched.length + " compan" + (pullRes.matched.length === 1 ? "y" : "ies") + "." : (pullRes.matched && pullRes.matched.length ? "Payment status updated for " + pullRes.matched.length + " compan" + (pullRes.matched.length === 1 ? "y" : "ies") + "." : BUS.describe(pullRes.code) || "Nothing pulled yet."));
            window.CRM.rerender();
          }
        });
        acts.appendChild(pull);
      }
      head.appendChild(acts);
      row.appendChild(head);
      rows.appendChild(row);
    }
    card.appendChild(rows);
    return card;
  }

  async function ideaInboxCard(ctx, store, status) {
    const card = el("section", "card");
    card.appendChild(el("h2", null, "Idea inbox"));
    const inbox = el("div", "rel-list");
    const st = await BUS.importedState(store);
    const ideas = ideaCache;
    const lg = status.streams.ideas.inlog;
    if (!ideas || !ideas.length) {
      let msg;
      if (!status.streams.ideas.peer) {
        msg = "Set an idea source generator in Connections, then pull. Ideas import as qualified leads — title becomes the lead name, description and goals become notes, and the scope becomes suggested next steps.";
      } else if (ideas === null && !lg) {
        msg = "Press “Pull ideas” to check " + esc(status.streams.ideas.peer) + " for published ideas.";
      } else if (lg && lg.ok && lg.count === 0) {
        msg = "The idea stream is live but has no bundles published by " + esc(status.streams.ideas.peer) + " yet.";
      } else if (lg && !lg.ok) {
        msg = "The last pull did not find anything. " + (BUS.describe(lg.code) || "Try again.");
      } else {
        msg = "No ideas pulled in this session yet — press “Pull ideas” above.";
      }
      const p = el("p", "hint", msg);
      inbox.appendChild(p);
    } else {
      for (const bundle of ideas) {
        const idea = bundle.payload || bundle;
        const imp = st.byBundle[bundle.id];
        const title = String(idea.title || idea.name || "Untitled idea");
        const row = el("div", "idea-row");
        const body = el("div", "idea-body");
        body.appendChild(el("div", "idea-title", title));
        const metaBits = [];
        if (bundle.id) metaBits.push("bundle " + bundle.id);
        if (bundle.sourceGen) metaBits.push("from " + bundle.sourceGen);
        if (Array.isArray(idea.scope) && idea.scope.length) metaBits.push(idea.scope.length + " scope step" + (idea.scope.length === 1 ? "" : "s"));
        body.appendChild(el("p", "hint", metaBits.join(" · ")));
        const desc = String(idea.description || idea.desc || "").trim();
        if (desc) {
          const pre = el("div", "notes-box");
          pre.textContent = desc;
          body.appendChild(pre);
        }
        row.appendChild(body);
        const act = el("div", "idea-act");
        if (imp) {
          act.appendChild(el("span", "chip ok", "Imported"));
          const a = document.createElement("a");
          a.className = "btn btn-ghost btn-sm";
          a.href = "#/leads/" + encodeURIComponent(imp.leadId || "");
          a.textContent = "Open lead";
          act.appendChild(a);
        } else {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "btn btn-primary btn-sm";
          b.dataset.busImport = bundle.id;
          b.textContent = "Import as qualified lead";
          b.addEventListener("click", async () => {
            b.disabled = true;
            b.textContent = "Importing…";
            const res = await BUS.importIdea(store, bundle, { sourceGen: bundle.sourceGen });
            b.disabled = false;
            if (res && res.ok) {
              window.CRM.toast("Idea imported as a qualified lead.");
            } else if (res && res.code === "already_imported" && res.leadId) {
              window.CRM.toast("Already imported — opening the existing lead.");
              ctx.navigate("leads", [res.leadId]);
              return;
            } else {
              window.CRM.toast(BUS.describe(res && res.code) || "Import failed — try again.");
            }
            window.CRM.rerender();
          });
          act.appendChild(b);
        }
        row.appendChild(act);
        inbox.appendChild(row);
      }
    }
    card.appendChild(inbox);
    return card;
  }

  async function logCard(store, status) {
    const card = el("section", "card");
    const ttl = el("div", "card-title-row");
    ttl.appendChild(el("h2", null, "Export log"));
    ttl.appendChild(el("span", "hint", "append-only — capped at the 300 most recent entries"));
    card.appendChild(ttl);
    const body = el("div", "rel-list");
    const loaded = await BUS.ensureConfig(store).then(() => store.loadDoc("bus"));
    const entries = [];
    if (loaded && loaded.ok) {
      for (const r of R.recordsOf(loaded.content)) {
        if (!r || !r.kind) continue;
        if (r.kind === "out") {
          const mirrored = r.status === "mirrored";
          entries.push({ at: r.at, order: r.at, type: "out", stream: r.stream, text: (r.stream === "projects" ? "Published project seed" : "Published customer") + " — " + (r.summary && r.summary.name || r.bundleId), extra: r.lastError || null, pending: !mirrored, pass: mirrored, bundleId: r.bundleId });
        } else if (r.kind === "imp") {
          entries.push({ at: r.at, order: r.at, type: "imp", stream: "ideas", text: "Imported idea as a qualified lead", extra: "lead " + (r.leadId || ""), pass: true });
        } else if (r.kind === "inlog") {
          entries.push({ at: r.lastPullAt, order: r.lastPullAt, type: "inlog", stream: r.stream, text: (r.stream === "ideas" ? "Pulled idea stream" : "Pulled receivable status"), extra: r.ok ? (r.count + " bundle" + (r.count === 1 ? "" : "s") + (r.detail ? " · " + r.detail : "")) : (r.code || "failed"), pass: !!r.ok });
        } else if (r.kind === "rcv") {
          entries.push({ at: r.pulledAt, order: r.pulledAt, type: "rcv", stream: "receivables", text: "Payment status for " + (r.companyName || r.companyId), extra: r.health + (r.source ? " · " + r.source : ""), pass: true });
        }
      }
    }
    entries.sort((a, b) => String(b.order || "").localeCompare(String(a.order || "")));
    const shown = entries.slice(0, 300);
    if (!shown.length) {
      body.appendChild(el("p", "hint", "Nothing has been published, imported or pulled yet. The log records every bundle this CRM sends, every idea it imports and every payment pull."));
    } else {
      for (const e of shown) {
        const line = el("div", "log-row");
        const chipTxt = e.pending ? "queued" : (e.pass ? "sent" : "error");
        const chip = el("span", "chip " + (e.pass ? "ok" : e.pending ? "pending" : "fail"), e.type + " · " + chipTxt);
        line.appendChild(chip);
        const txt = el("span", null, e.text + (e.extra ? " · " + e.extra : ""));
        line.appendChild(txt);
        line.appendChild(el("span", "mono", timeText(e.at) + (e.bundleId ? " · " + e.bundleId : "")));
        body.appendChild(line);
      }
    }
    card.appendChild(body);
    return card;
  }

  async function view(ctx) {
    const store = ctx.store;
    if (!store) return storeErrorCard("The document store isn't ready yet. Try again in a moment.");
    if (!BUS) return storeErrorCard("The pipeline bus isn't loaded yet. Try again in a moment.");
    return build(ctx);
  }

  async function dealCard(store, deal) {
    if (!deal || deal.stage !== "won") return null;
    const card = el("section", "card");
    const ttl = el("div", "card-title-row");
    ttl.appendChild(el("h2", null, "Pipeline handoff"));
    ttl.appendChild(el("span", "chip", "bus"));
    card.appendChild(ttl);
    card.appendChild(el("p", "hint", "Winning this deal publishes a project-seed bundle so a project tracker (project-master) can open a project from it. Each deal is handed off once."));
    const box = el("div", "bus-handoff-box");
    const hf = deal.busHandoff;
    let outRec = null;
    try {
      const doc = await store.loadDoc("bus");
      if (doc && doc.ok) {
        outRec = R.recordsOf(doc.content).filter(r => r && r.kind === "out" && r.stream === "projects" && r.dealId === deal.id).sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")))[0] || null;
      }
    } catch (e) {}
    const info = el("div", "bus-handoff-info");
    if (outRec) {
      const ok = outRec.status === "mirrored";
      info.appendChild(el("span", "chip " + (ok ? "ok" : "pending"), ok ? "published" : "queued"));
      info.appendChild(el("p", "hint", "Project seed " + (ok ? "published" : "queued") + " · bundle " + outRec.bundleId + " · " + R.timeAgo(outRec.at) + (outRec.lastError ? " · " + outRec.lastError : "")));
    } else if (hf) {
      info.appendChild(el("span", "chip pending", "queued"));
      info.appendChild(el("p", "hint", "Handoff queued at " + R.fmtStamp(hf.at) + " (bundle " + hf.bundleId + ")."));
    } else {
      info.appendChild(el("p", "hint", "This deal was won before the pipeline bus was watching it — publish it now to hand it off."));
    }
    box.appendChild(info);
    const act = el("div", "bus-handoff-act");
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn " + (outRec && outRec.status === "mirrored" ? "btn-ghost" : "btn-primary") + " btn-sm";
    b.dataset.busHandoff = "1";
    b.textContent = outRec && outRec.status === "mirrored" ? "Re-publish" : (outRec ? "Retry publish" : "Publish project seed");
    b.addEventListener("click", async () => {
      b.disabled = true;
      b.textContent = "Publishing…";
      const res = (outRec && outRec.status === "mirrored") ? await BUS.materialize(store, "projects") : await BUS.publishProjectSeed(store, deal);
      b.disabled = false;
      if (res && (res.ok || res.noop)) {
        window.CRM.toast(res.noop ? "Nothing new to publish." : "Project seed published to the bus.");
      } else {
        window.CRM.toast(BUS.describe(res && res.code) || "Publish failed.");
      }
      window.CRM.rerender();
    });
    act.appendChild(b);
    box.appendChild(act);
    card.appendChild(box);
    return card;
  }

  async function companyCard(store, rec) {
    if (!rec || (rec.isCustomer !== true && !rec.busPayment && !rec.busCustomer)) return null;
    const card = el("section", "card");
    const ttl = el("div", "card-title-row");
    ttl.appendChild(el("h2", null, "Pipeline & payments"));
    ttl.appendChild(el("span", "chip", "bus"));
    card.appendChild(ttl);

    const pub = el("div", "bus-company-block");
    const pubTitle = el("div", null);
    pubTitle.appendChild(el("span", "badge customer", "Customer"));
    pub.appendChild(pubTitle);
    if (rec.busCustomer) {
      const ok = rec.busCustomer.status !== "pending";
      pub.appendChild(el("p", "hint", (ok ? "Published" : "Queued for publishing") + " to the shared pipeline at " + R.fmtStamp(rec.busCustomer.at) + " · bundle " + rec.busCustomer.bundleId + (rec.busCustomer.lastError ? " · " + rec.busCustomer.lastError : "") + "."));
      if (!ok) {
        const rb = document.createElement("button");
        rb.type = "button";
        rb.className = "btn btn-primary btn-sm";
        rb.textContent = "Retry publish";
        rb.addEventListener("click", async () => {
          rb.disabled = true;
          rb.textContent = "Publishing…";
          const res = await BUS.publishCustomer(store, rec);
          rb.disabled = false;
          window.CRM.toast(res && res.noop ? "Already published." : (res && res.ok ? "Customer published to the bus." : BUS.describe(res && res.code) || "Publish failed."));
          window.CRM.rerender();
        });
        pub.appendChild(rb);
      }
    } else if (rec.isCustomer === true) {
      pub.appendChild(el("p", "hint", "This company is a customer but predates the pipeline bus — publish it now to send its record to the ledger and ERP."));
      const rb = document.createElement("button");
      rb.type = "button";
      rb.className = "btn btn-primary btn-sm";
      rb.dataset.busPubCustomer = "1";
      rb.textContent = "Publish as customer";
      rb.addEventListener("click", async () => {
        rb.disabled = true;
        rb.textContent = "Publishing…";
        const res = await BUS.publishCustomer(store, rec);
        rb.disabled = false;
        window.CRM.toast(res && res.noop ? "Already published." : (res && res.ok ? "Customer published to the bus." : BUS.describe(res && res.code) || "Publish failed."));
        window.CRM.rerender();
      });
      pub.appendChild(rb);
    }
    card.appendChild(pub);

    const pay = el("div", "bus-company-block");
    const payTitle = el("div", null);
    payTitle.appendChild(el("span", null, "Payment status"));
    pay.appendChild(payTitle);
    const p = rec.busPayment;
    if (p) {
      const hl = el("div", "bus-pay-line");
      hl.appendChild(el("span", "badge " + (p.status === "paid" ? "customer" : p.status === "overdue" ? "inactive" : "active"), p.label || p.status));
      const bits = [];
      if (p.balance !== null && p.balance !== undefined) bits.push("balance " + U.fmtMoney(p.balance));
      if (p.dueDate) bits.push("due " + R.fmtDate(p.dueDate));
      if (p.amount !== null && p.amount !== undefined) bits.push("of " + U.fmtMoney(p.amount));
      hl.appendChild(el("span", "hint", bits.join(" · ")));
      pay.appendChild(hl);
      pay.appendChild(el("p", "hint", "From " + esc(p.source || "the shared pipeline") + " · bundle " + p.bundleId + " · pulled " + R.timeAgo(p.pulledAt)));
    } else {
      pay.appendChild(el("p", "hint", "No payment data published for this company yet. Connect a receivable source generator in Integrations and pull — or check the ledger's stream file name."));
    }
    const pull = document.createElement("button");
    pull.type = "button";
    pull.className = "btn btn-ghost btn-sm";
    pull.dataset.busRefreshPay = "1";
    pull.textContent = "Refresh payment status";
    pull.addEventListener("click", async () => {
      pull.disabled = true;
      pull.textContent = "Pulling…";
      const res = await BUS.refreshCompanyPayment(store, rec.id);
      pull.disabled = false;
      if (res && res.pull && (res.pull.ok || (res.pull.matched && res.pull.matched.length))) {
        window.CRM.toast("Payment status refreshed.");
      } else {
        window.CRM.toast(BUS.describe(res && res.pull && res.pull.code) || "No receivable data found for this company yet.");
      }
      window.CRM.rerender();
    });
    pay.appendChild(pull);
    card.appendChild(pay);
    return card;
  }

  window.CRM_RENDERERS.bus = function (ctx) {
    return window.CRM_BUSUI ? window.CRM_BUSUI.view(ctx) : null;
  };

  return { view, build, dealCard, companyCard };
})();
