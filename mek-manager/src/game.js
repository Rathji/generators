(function () {
  "use strict";
  const M = window.MGM;
  const UI = window.BMUI;
  const AI = window.BMGA;
  const D = M.D;
  let BT = window.BT;
  const esc = (s) => (BT ? BT.esc(s) : String(s));

  const DEFAULT_SLOT = "main";
  const SLOTS_KEY = "slots";
  const PORTS_MARKER_KEY = "ports-active";
  const ARENA_KEY = "arena";
  const BACKUP_LIMIT = 8;
  const SAVE_FORMAT = "btmm-save";
  const SAVE_VERSION = 1;

  const BMG = {
    company: null, stable: null, screen: "dashboard", _evQueue: [], _toastTimer: null, _saveTimer: null, _stableTimer: null, _backups: [],
    activeSlot: DEFAULT_SLOT, slots: []
  };
  window.BMG = BMG;

  async function storageGet(key) {
    try {
      if (window.root && root.kv) {
        const v = await root.kv.saves.get(key);
        if (v !== undefined) return v;
      }
    } catch (e) { console.warn("kv get failed", e); }
    try { const s = localStorage.getItem("bmg-save-" + key); return s ? JSON.parse(s) : null; } catch (e) { return null; }
  }
  async function storageSet(key, val) {
    try {
      if (window.root && root.kv) { await root.kv.saves.set(key, val); return; }
    } catch (e) { console.warn("kv set failed", e); }
    try { localStorage.setItem("bmg-save-" + key, JSON.stringify(val)); } catch (e) { console.warn("localStorage failed", e); }
  }
  async function storageDel(key) {
    try { if (window.root && root.kv) { await root.kv.saves.delete(key); } } catch (e) { }
    try { localStorage.removeItem("bmg-save-" + key); } catch (e) { }
  }

  function saveKeyFor(id) { return id === DEFAULT_SLOT ? "main" : "slot-" + id; }
  async function backupsDel(id) {
    try { if (window.root && root.kv) await root.kv.backups.delete(backupKeyFor(id)); } catch (e) { }
    try { localStorage.removeItem(backupLsKey(id)); } catch (e) { }
  }
  function portsKeyFor(id) { return "ports-" + id; }
  function backupKeyFor(id) { return id === DEFAULT_SLOT ? "list" : "list-" + id; }
  function backupLsKey(id) { return id === DEFAULT_SLOT ? "bmg-backups" : "bmg-backups-" + id; }
  function newSlotId() { return "s" + Date.now().toString(36) + Math.floor(Math.random() * 46656).toString(36); }

  async function backupsLoad() {
    const key = backupKeyFor(BMG.activeSlot);
    try {
      if (window.root && root.kv) {
        const v = await root.kv.backups.get(key);
        if (Array.isArray(v)) return v;
      }
    } catch (e) { console.warn("backups load failed", e); }
    try { const s = localStorage.getItem(backupLsKey(BMG.activeSlot)); return s ? JSON.parse(s) : []; } catch (e) { return []; }
  }
  async function backupsSave(list) {
    const key = backupKeyFor(BMG.activeSlot);
    try { if (window.root && root.kv) { await root.kv.backups.set(key, list); return; } } catch (e) { console.warn("backups save failed", e); }
    try { localStorage.setItem(backupLsKey(BMG.activeSlot), JSON.stringify(list)); } catch (e) { console.warn("backups localStorage failed", e); }
  }

  /* ── save slots: several companies kept side by side ── */
  async function slotsLoad() {
    try {
      if (window.root && root.kv) {
        const v = await root.kv.saves.get(SLOTS_KEY);
        if (v && Array.isArray(v.slots)) return v;
      }
    } catch (e) { console.warn("slots load failed", e); }
    try { const s = localStorage.getItem("bmg-slots"); if (s) { const p = JSON.parse(s); if (p && Array.isArray(p.slots)) return p; } } catch (e) { }
    return { active: DEFAULT_SLOT, slots: [] };
  }
  async function slotsSave(reg) {
    try { if (window.root && root.kv) { await root.kv.saves.set(SLOTS_KEY, reg); return; } } catch (e) { console.warn("slots save failed", e); }
    try { localStorage.setItem("bmg-slots", JSON.stringify(reg)); } catch (e) { console.warn("slots localStorage failed", e); }
  }
  function slotMeta(c, id) {
    const era = M.eraOf(c);
    return {
      id: id, name: c.name, callsign: c.callsign, week: c.week, funds: c.funds,
      era: era.name, eraIdx: c.eraIdx, difficulty: (c.difficulty && c.difficulty.label) || "Regular",
      pilots: (c.people || []).filter((p) => p.role === "pilot").length, units: (c.units || []).length,
      updated: Date.now()
    };
  }
  async function refreshSlotMeta() {
    if (!BMG.company) return;
    const reg = await slotsLoad();
    const meta = slotMeta(BMG.company, BMG.activeSlot);
    const i = reg.slots.findIndex((s) => s.id === BMG.activeSlot);
    if (i >= 0) reg.slots[i] = meta; else reg.slots.push(meta);
    reg.active = BMG.activeSlot;
    await slotsSave(reg);
    BMG.slots = reg.slots;
  }
  async function persistCompany() {
    if (!BMG.company) return;
    await storageSet(saveKeyFor(BMG.activeSlot), BMG.company);
    await refreshSlotMeta();
  }

  function snapshot(company, label) {
    const c = company || BMG.company;
    if (!c) return null;
    return {
      key: "bk" + Date.now() + "-" + Math.floor(Math.random() * 1e6),
      ts: Date.now(),
      label: label || "Snapshot",
      name: c.name, week: c.week, funds: c.funds,
      portraits: AI.exportPortraits(),
      company: JSON.parse(JSON.stringify(c))
    };
  }

  async function makeBackup(label, company) {
    const cc = company || BMG.company;
    if (cc && cc.ironman) return null;
    const snap = snapshot(company, label);
    if (!snap) return null;
    const list = await backupsLoad();
    list.unshift(snap);
    while (list.length > BACKUP_LIMIT) list.pop();
    await backupsSave(list);
    BMG._backups = list;
    return snap;
  }
  function autoBackup(label, company) { makeBackup(label, company).catch((e) => console.warn("autoBackup", e)); }

  function patchLoaded(c) {
    c.schema = 4;
    if (!c.stats) c.stats = { battles: 0, victories: 0, defeats: 0, kills: 0, lost: 0 };
    if (!c.log) c.log = [];
    if (!c.partsInv) c.partsInv = {};
    if (!c.activeReports) c.activeReports = [];
    if (!c.salvageQueue) c.salvageQueue = [];
    if (!c.nextIds) c.nextIds = { person: 1, unit: 1, contract: 1, report: 1, tx: 1 };
    if (!c.market) { M.refreshMarket(c); }
    if (!c.offers) M.refreshOffers(c);
    for (const u of c.units) { if (!u.structure) { for (const l of D.LOCS) { u.structure[l] = { max: u.armor[l].max, cur: u.armor[l].cur }; } } }
    M.sanitizeCompany(c);
    return c;
  }

  function saveSoon() {
    if (!BMG.company) return;
    clearTimeout(BMG._saveTimer);
    BMG._saveTimer = setTimeout(() => { persistCompany().catch((e) => console.warn("autosave", e)); }, 300);
  }

  /* ============================ SAVE / EXPORT / IMPORT / RESTORE ============================ */
  async function saveAction() {
    const c = BMG.company;
    if (!c) return;
    await persistCompany();
    if (c.ironman) {
      UI.renderAll(c);
      BT.toast("Ironman — company saved. Snapshots are disabled for this command.", "ok");
      return;
    }
    await makeBackup("Manual save");
    UI.renderAll(c);
    BT.toast("Company saved — snapshot added to the timeline.", "ok");
  }

  async function exportAction() {
    const c = BMG.company;
    if (!c) return;
    await persistCompany();
    const bundle = {
      format: SAVE_FORMAT, version: SAVE_VERSION,
      savedAt: new Date().toISOString(),
      generator: window.generatorName || null,
      company: c,
      portraits: AI.exportPortraits()
    };
    let json;
    try { json = JSON.stringify(bundle); } catch (e) { BT.toast("Export failed: " + e.message, "error"); return; }
    const safe = (c.name || "company").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "company";
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = safe + "-wk" + c.week + ".btmm.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 8000);
    BT.toast("Exported " + a.download + " (~" + Math.round(json.length / 1024) + " KB).", "ok");
  }

  function shareAction() {
    const c = BMG.company;
    if (!c) return;
    let url;
    try { url = UI.buildRosterCard(c).toDataURL("image/png"); }
    catch (e) { BT.toast("Could not render the roster card: " + e.message, "error"); return; }
    const safe = (c.name || "company").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "company";
    const back = UI.modal('<h3 class="card-title">Roster card</h3>'
      + '<p class="muted small">A poster of your command record — download it as a PNG, or copy a short text summary to post anywhere.</p>'
      + '<div class="share-wrap"><img class="share-card" alt="' + esc(c.name) + ' roster card" src="' + url + '"></div>'
      + '<div class="btn-row">'
      + '<a class="btn btn-sm btn-primary" id="shareDl" download="' + safe + '-roster.png" href="' + url + '">Download PNG</a>'
      + '<button class="btn btn-sm btn-ghost" data-bm="share-copy">Copy summary</button>'
      + '<button class="btn btn-sm btn-ghost" data-bm="close-modal">Close</button>'
      + '</div>'
      + '<div id="shareNote" class="muted small" style="margin-top:10px"></div>', true);
    UI.showModalEl(back);
  }

  function shareCopyAction() {
    const c = BMG.company;
    if (!c) return;
    const txt = UI.rosterSummary(c);
    const note = document.getElementById("shareNote");
    const done = () => { if (note) { note.classList.add("muted"); note.textContent = "Summary copied to the clipboard."; } BT.toast("Company summary copied.", "ok"); };
    const fallback = () => { if (note) { note.classList.remove("muted"); note.textContent = txt; } BT.toast("Clipboard unavailable — summary shown to copy manually.", "error"); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done, fallback);
    else fallback();
  }

  async function enableIronmanAction() {
    const c = BMG.company;
    if (!c || c.ironman) return;
    if (!confirm("Commit " + c.name + " to Ironman?\n\nSnapshots, restore and save import will be permanently disabled for this company. There is no way back. Continue?")) return;
    c.ironman = true;
    BMG._backups = [];
    await backupsSave([]);
    await persistCompany();
    UI.closeTopModal();
    afterAction("Ironman engaged — no more reloads. Every week is on the record now.");
  }

  function importAction() {
    let inp = document.getElementById("importFileInput");
    if (!inp) {
      inp = document.createElement("input");
      inp.type = "file";
      inp.id = "importFileInput";
      inp.accept = ".json,application/json";
      inp.style.display = "none";
      inp.addEventListener("change", importFileChosen);
      document.body.appendChild(inp);
    }
    inp.value = "";
    inp.click();
  }

  function parseBundle(raw) {
    const c = raw && raw.company ? raw.company : (raw && raw.units && raw.people && raw.name ? raw : null);
    if (!c || !Array.isArray(c.units) || !Array.isArray(c.people)) return null;
    return { company: c, portraits: raw.portraits || null };
  }

  async function importFileChosen(e) {
    const file = e.target && e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    if (BMG.company && BMG.company.ironman) { BT.toast("Ironman — importing a save is disabled for this command.", "error"); return; }
    let parsed;
    try { parsed = parseBundle(JSON.parse(await file.text())); }
    catch (err) { console.error("import parse failed", err); BT.toast("That file isn't valid JSON.", "error"); return; }
    if (!parsed) { BT.toast("That file isn't a Merc Manager save.", "error"); return; }
    if (BMG.company && !confirm("Importing replaces your current company (" + BMG.company.name + ", week " + BMG.company.week + ").\n\nYour current state will be snapshotted first. Continue?")) return;
    if (BMG.company) await makeBackup("Before import — " + BMG.company.name, BMG.company);
    try {
      const loaded = patchLoaded(JSON.parse(JSON.stringify(parsed.company)));
      BMG.company = loaded;
      if (parsed.portraits) await AI.importPortraits(parsed.portraits, { clear: true });
      else await AI.clearPortraits();
      await storageSet(saveKeyFor(BMG.activeSlot), loaded);
      await storageSet(PORTS_MARKER_KEY, BMG.activeSlot);
      await refreshSlotMeta();
      UI.renderAll(loaded);
      UI.hud(loaded);
      showScreen("company");
      BT.toast("Imported " + loaded.name + " — week " + loaded.week + ".", "ok");
    } catch (err) {
      console.error("import failed", err);
      BT.toast("Import failed: " + err.message, "error");
    }
  }

  async function restoreAction(key) {
    if (BMG.company && BMG.company.ironman) { BT.toast("Ironman — restoring snapshots is disabled for this command.", "error"); return; }
    const list = BMG._backups.length ? BMG._backups : await backupsLoad();
    const snap = list.find((s) => s.key === key);
    if (!snap) { BT.toast("That snapshot is no longer available.", "error"); return; }
    if (!confirm("Restore the snapshot from " + new Date(snap.ts).toLocaleString() + "?\n\n" + snap.name + " · week " + snap.week + " · " + UI.fmtC(snap.funds) + "\n\nYour current company will be replaced.")) return;
    if (BMG.company) await makeBackup("Before restore — " + BMG.company.name, BMG.company);
    try {
      const loaded = patchLoaded(JSON.parse(JSON.stringify(snap.company)));
      BMG.company = loaded;
      if (snap.portraits) await AI.importPortraits(snap.portraits, { clear: true });
      await storageSet(saveKeyFor(BMG.activeSlot), loaded);
      await storageSet(PORTS_MARKER_KEY, BMG.activeSlot);
      await refreshSlotMeta();
      UI.renderAll(loaded);
      UI.hud(loaded);
      showScreen("company");
      BT.toast("Restored snapshot from " + new Date(snap.ts).toLocaleString() + ".", "ok");
    } catch (err) {
      console.error("restore failed", err);
      BT.toast("Restore failed: " + err.message, "error");
    }
  }

  async function deleteBackupAction(key) {
    const list = await backupsLoad();
    const snap = list.find((s) => s.key === key);
    if (!snap) return;
    if (!confirm("Delete the snapshot from " + new Date(snap.ts).toLocaleString() + "?")) return;
    const next = list.filter((s) => s.key !== key);
    await backupsSave(next);
    BMG._backups = next;
    UI.renderAll(BMG.company);
    BT.toast("Snapshot deleted.", "ok");
  }

  function boot() {
    BT = window.BT;
    const body = document.body;
    buildNav();
    bindGlobal();
    (async () => {
      const reg = await slotsLoad();
      BMG.slots = reg.slots;
      let active = reg.active || DEFAULT_SLOT;
      if (!(await storageGet(saveKeyFor(active)))) {
        if (!reg.slots.some((s) => s.id === active)) {
          if (await storageGet(saveKeyFor(DEFAULT_SLOT))) active = DEFAULT_SLOT;
          else if (reg.slots.length) active = reg.slots.slice().sort((a, b) => (b.updated || 0) - (a.updated || 0))[0].id;
        }
      }
      BMG.activeSlot = active;
      const saved = await storageGet(saveKeyFor(active));
      BMG.stable = await storageGet(ARENA_KEY);
      await AI.preloadPortraits();
      BMG._backups = await backupsLoad();
      const portsMarker = await storageGet(PORTS_MARKER_KEY);
      if (saved) {
        BMG.company = patchLoaded(saved);
        if (portsMarker !== active) {
          const ports = await storageGet(portsKeyFor(active));
          if (ports) { try { await AI.importPortraits(ports, { clear: true }); } catch (e) { console.warn("portrait restore", e); } }
        }
        await storageSet(PORTS_MARKER_KEY, active);
        await refreshSlotMeta();
        afterLoad();
        UI.renderAll(BMG.company);
        UI.hud(BMG.company);
        showScreen("dashboard");
        playMenuMusic();
      } else {
        UI.renderAll(nullCompany());
        showNewGame();
      }
    })();
  }

  function nullCompany() {
    return {
      name: "—", callsign: "", morale: 0, funds: 0, week: 0, eraIdx: 0, schema: 4, loan: 0,
      difficulty: { label: "Regular", bonus: 0, payMult: 1, funds: 600000, key: "regular" },
      rep: {}, log: [], salvageQueue: [], offers: [], units: [], people: [], partsInv: {},
      nextIds: { person: 1, unit: 1, contract: 1, report: 1, tx: 1 },
      market: { stock: [] }, activeReports: [],
      stats: { battles: 0, victories: 0, defeats: 0, kills: 0, lost: 0 },
      ledger: []
    };
  }

  function afterLoad() {
    const c = BMG.company;
    document.querySelectorAll(".need-save").forEach((x) => x.classList.remove("need-save"));
    hideNewGameModal();
    M.checkAchievements(c);
    const bankr = M.bankruptcyCheck(c);
    if (bankr) showBankrupt(bankr);
  }

  /* ============================ NAV ============================ */
  function buildNav() {
    const nav = document.getElementById("mainNav");
    if (!nav) return;
    const tabs = [
      ["dashboard", "⌂ Command"], ["contracts", "⚔ Contracts"], ["world", "◍ Known Space"], ["personnel", "◈ Personnel"],
      ["mechbay", "☖ Mechbay"], ["market", "◈ Market"], ["salvage", "⚒ Salvage"],
      ["reports", "▤ Reports"], ["company", "▤ Company"], ["arena", "☼ Solaris"], ["roadmap", "▦ Roadmap"]
    ];
    nav.innerHTML = tabs.map(([id, label]) => '<button class="nav-btn" data-bm="nav" data-screen="' + id + '">' + label + "</button>").join("");
  }

  function showScreen(name) {
    BMG.screen = name;
    document.querySelectorAll(".screen").forEach((s) => { s.hidden = s.dataset.screen !== name; });
    document.querySelectorAll(".nav-btn").forEach((b) => {
      const on = b.dataset.screen === name;
      b.classList.toggle("active", on);
      if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    });
    if (name === "roadmap") { const f = window.BT.refreshFeatures; if (f) f(); }
    if (name === "arena") renderArenaScreen();
    const sc = document.getElementById("screen-" + name);
    if (sc && sc.scrollIntoView) sc.scrollIntoView({ block: "start" });
  }
  function renderArenaScreen() {
    const el = document.getElementById("screen-arena");
    if (el) el.innerHTML = UI.renderArena(BMG.stable);
  }

  /* ============================ CLICK ROUTER ============================ */
  function bindGlobal() {
    document.addEventListener("click", (e) => {
      const t = e.target.closest("[data-bm]");
      if (!t) return;
      e.preventDefault();
      const action = t.dataset.bm;
      try { route(t, action, e); }
      catch (err) { console.error("action " + action, err); BT.toast("Something went wrong: " + err.message, "error"); }
    });
    document.addEventListener("change", (e) => {
      const t = e.target.closest("[data-bm]");
      if (!t) return;
      if (t.dataset.bm === "assignsel") {
        try { assignSelAction(t.dataset.unit, t.value); }
        catch (err) { console.error("action assignsel", err); BT.toast("Something went wrong: " + err.message, "error"); }
      } else if (t.dataset.bm === "refitloc") {
        try { UI.refitPreviewText(t); } catch (err) { console.error("action refitloc", err); }
      } else if (t.dataset.bm === "refitmove") {
        try { moveRefitAction(t.dataset.unit, Number(t.dataset.wi), t.value); }
        catch (err) { console.error("action refitmove", err); BT.toast("Something went wrong: " + err.message, "error"); }
      }
    });
    window.addEventListener("beforeunload", () => { if (BMG.company) storageSet(saveKeyFor(BMG.activeSlot), BMG.company); if (BMG.stable) storageSet(ARENA_KEY, BMG.stable); });
  }

  function closeTop() {
    UI.closeTopModal();
  }

  function route(t, action) {
    const c = BMG.company;
    switch (action) {
      case "nav": showScreen(t.dataset.screen); break;
      case "advance": doAdvanceWeek(); break;
      case "loan": loanAction(); break;
      case "repay": repayAction(); break;
      case "take-credit": { const r = M.takeCredit(c, t.dataset.lender); if (r.error === "credit") BT.toast(r.reason, "error"); else if (r.error === "max") BT.toast("You already carry four loans.", "error"); else if (r.error) BT.toast("Cannot draw credit.", "error"); else afterAction("Drew " + UI.fmtC(r.loan.principal) + " from " + r.loan.lender + " — " + Math.round(r.loan.rate * 100) + "% weekly."); break; }
      case "loan-pay": { const l = (c.loans || []).find((x) => x.id === t.dataset.loan); const amt = l ? Math.min(l.minPayment, l.balance) : 0; const r = M.loanPayment(c, t.dataset.loan, amt); if (r.error === "funds") BT.toast("Not enough cash for the payment.", "error"); else if (r.error) BT.toast("Loan not found.", "error"); else afterAction(r.cleared ? "Loan cleared in full." : "Payment made — " + UI.fmtC(r.balance) + " outstanding."); break; }
      case "loan-repay": { const r = M.repayLoan(c, t.dataset.loan); if (r.error === "funds") BT.toast("Not enough cash to clear that loan.", "error"); else if (r.error) BT.toast("Loan not found.", "error"); else afterAction("Loan cleared in full."); break; }
      case "save-now": saveAction(); break;
      case "slot-switch": switchSlot(t.dataset.slot); break;
      case "slot-delete": deleteSlotAction(t.dataset.slot); break;
      case "ironman": enableIronmanAction(); break;
      case "share": shareAction(); break;
      case "share-copy": shareCopyAction(); break;
      case "export-save": exportAction(); break;
      case "import-save": importAction(); break;
      case "restore": restoreAction(t.dataset.backup); break;
      case "delete-backup": deleteBackupAction(t.dataset.backup); break;
      case "sign": signAction(t.dataset.recruit); break;
      case "recruit-refresh": refreshRecruitsAction(); break;
      case "train": trainAction(t.dataset.person, t.dataset.course); break;
      case "cancel-train": cancelTrainAction(t.dataset.person); break;
      case "fire": fireAction(t.dataset.person); break;
      case "dossier": showDossier(t.dataset.person); break;
      case "portrait": portraitAction(t.dataset.person); break;
      case "portrait-all": portraitAllAction(); break;
      case "assign": assignAction(t.dataset.person, t.dataset.unit); break;
      case "repair": repairAction(t.dataset.unit, t.dataset.mode); break;
      case "cancel-repair": cancelRepairAction(t.dataset.unit); break;
      case "refit": showRefit(t.dataset.unit); break;
      case "strip": stripAction(t.dataset.unit, Number(t.dataset.wi)); break;
      case "install": { const rowEl = t.closest(".refit-row"); const locSel = rowEl ? rowEl.querySelector(".refit-loc") : null; installAction(t.dataset.unit, t.dataset.wid, locSel ? locSel.value : null); break; }
      case "sell-unit": sellUnitAction(t.dataset.unit); break;
      case "buy": buyAction(t.dataset.item); break;
      case "buy-supplies": { const r = M.buySupplies(c, Number(t.dataset.qty) || 10); if (r.error) BT.toast("Not enough C-bills.", "error"); else afterAction("Bought " + r.qty + " repair crates for " + UI.fmtC(r.cost) + "."); break; }
      case "invest-buy": { const r = M.buyInvestment(c, t.dataset.offer, 1); if (r.error === "funds") BT.toast("Not enough C-bills.", "error"); else if (r.error === "max") BT.toast("Portfolio is full (8 holdings).", "error"); else if (r.error) BT.toast("That offer is gone.", "error"); else afterAction("Bought " + r.holding.name + " for " + UI.fmtC(r.cost) + "."); break; }
      case "invest-sell": { const r = M.sellInvestment(c, t.dataset.holding); if (r.error) BT.toast("That holding is gone.", "error"); else afterAction("Sold for " + UI.fmtC(r.net) + " (" + (r.profit >= 0 ? "+" : "") + UI.fmtC(r.profit) + " vs cost)."); break; }
      case "sell-parts": sellPartsAction(t.dataset.wid); break;
      case "salvage": salvageAction(t); break;
      case "world-system": showWorldSystem(t.dataset.system); break;
      case "travel": travelAction(t.dataset.system); break;
      case "deploy-modal": showDeploy(t.dataset.offer); break;
      case "launch": launchBattle(t.dataset.offer); break;
      case "report": showReportByIndex(Number(t.dataset.idx)); break;
      case "newgame": UI.closeTopModal(); showNewGame(); break;
      case "wipe": wipeAction(); break;
      case "ng-start": newGameSubmit(); break;
      case "ng-cancel": { closeTop(); break; }
      case "close-modal": closeTop(); break;
      case "bk-loan": { closeTop(); M.takeLoan(c); BT.toast("Emergency credit extended", "ok"); saveSoon(); UI.renderAll(c); break; }
      case "bk-sell": { closeTop(); showScreen("mechbay"); break; }
      case "bk-disband": { disbandAction(); break; }
      case "arena-found": { showArenaFound(); break; }
      case "arena-start": { arenaStartSubmit(); break; }
      case "arena-week": { arenaWeekAction(); break; }
      case "arena-fight": { arenaFightAction(t.dataset.bout, t.dataset.unit); break; }
      case "arena-repair": { arenaRepairAction(t.dataset.unit); break; }
      case "arena-sell-unit": { arenaSellAction(t.dataset.unit); break; }
      case "arena-buy-mech": { arenaBuyMechAction(t.dataset.item); break; }
      case "arena-hire": { arenaHireAction(t.dataset.pilot); break; }
      case "arena-upgrade": { arenaUpgradeAction(t.dataset.key); break; }
      case "arena-sponsor": { arenaSponsorAction(t.dataset.sponsor); break; }
      case "arena-abandon": { arenaAbandonAction(); break; }
      default: console.warn("unknown action", action);
    }
  }

  /* ============================ ACTIONS ============================ */
  function grantAchievements(c) {
    const newly = M.checkAchievements(c);
    if (!newly.length) return newly;
    if (newly.length <= 3) {
      for (const a of newly) BT.toast("Milestone unlocked — " + a.name + (a.title ? " (“" + a.title + "”)" : ""), "ok");
    } else {
      BT.toast(newly.length + " milestones unlocked — see the Company screen.", "ok");
    }
    return newly;
  }

  function afterAction(msg) {
    const c = BMG.company;
    saveSoon();
    grantAchievements(c);
    UI.renderAll(c);
    if (msg) BT.toast(msg, "ok");
  }

  function doAdvanceWeek() {
    const c = BMG.company;
    autoBackup("Week " + c.week + " — checkpoint");
    const wk = M.advanceWeek(c);
    grantAchievements(c);
    const bankr = M.bankruptcyCheck(c);
    const quits = wk && wk.quits && wk.quits.length ? wk.quits : null;
    if (quits) for (const q of quits) AI.forgetPortrait(q.id);
    saveSoon();
    const evs = M.startCompanyEvents(c, null).filter((e) => e.body(c) !== null && e.body(c) !== undefined);
    const finish = () => {
      UI.renderAll(c);
      if (quits) BT.toast(quits.map((q) => q.callsign).join(", ") + " quit the company overnight.", "error");
    };
    if (evs.length) { queueEvents(evs, () => { if (bankr) showBankrupt(bankr); else finish(); }); }
    else if (bankr) { UI.renderAll(c); showBankrupt(bankr); }
    else if (quits) { finish(); }
    else { UI.renderAll(c); BT.toast("A new week begins. Payroll and maintenance settled.", "ok"); }
  }

  function loanAction() {
    const r = M.takeLoan(BMG.company);
    if (r.error) BT.toast("You already carry the maximum number of loans.", "error");
    else { afterAction("Emergency line of credit granted: +200k at 8% weekly interest."); }
  }
  function repayAction() {
    const r = M.repayLoan(BMG.company);
    if (r && r.error === "funds") BT.toast("Not enough cash to repay the loan.", "error");
    else if (r && r.error === "none") BT.toast("No outstanding loan.", "error");
    else afterAction("Loan repaid in full.");
  }

  function signAction(rid) {
    const r = M.hireRecruit(BMG.company, rid);
    if (r.error === "funds") { BT.toast("Not enough C-bills for the signing fee.", "error"); return; }
    if (r.error) { BT.toast("That candidate is no longer on the board.", "error"); afterAction(""); return; }
    UI.closeTopModal();
    afterAction("Signed " + r.person.name + " \"" + r.person.callsign + "\" (" + r.person.role + ") for " + UI.fmtC(r.fee) + ".");
    showDossier(r.person.id);
    UI.setPortraitBusy(r.person.id, true);
    AI.queuePortrait(r.person, (pid, url) => {
      UI.setPortraitBusy(pid, false);
      if (url) {
        UI.setPortraitInDom(pid, url);
        const db = document.querySelector('.dossier button[data-bm="portrait"][data-person="' + pid + '"]');
        if (db) db.textContent = "Re-roll portrait";
      }
    });
  }
  function refreshRecruitsAction() {
    const c = BMG.company;
    const cost = (c.recruits && c.recruits.length) ? 5000 : 0;
    if (c.funds < cost) { BT.toast("Not enough C-bills to refresh the market.", "error"); return; }
    if (cost) M.logTx(c, "hire", "Recruitment market refresh", -cost);
    M.refreshRecruits(c);
    afterAction("A fresh pool of candidates is up on the hiring-hall boards.");
  }
  function trainAction(pid, courseId) {
    const c = BMG.company;
    const p = M.findPerson(c, pid);
    const r = M.startTraining(c, pid, courseId);
    if (r.error) { BT.toast(r.error, "error"); return; }
    UI.closeTopModal();
    afterAction((p ? p.callsign : "They") + " enrolled in " + r.course.name + " — " + UI.fmtC(r.cost) + " tuition, " + r.weeks + " weeks.");
    showDossier(pid);
  }
  function cancelTrainAction(pid) {
    const c = BMG.company;
    const p = M.findPerson(c, pid);
    const r = M.cancelTraining(c, pid);
    if (r.error) { BT.toast("Nobody is in training.", "error"); return; }
    UI.closeTopModal();
    afterAction((p ? p.callsign : "They") + " withdrew from training — " + UI.fmtC(r.refund) + " refunded.");
    showDossier(pid);
  }
  function fireAction(pid) {
    const p = M.findPerson(BMG.company, pid);
    if (!p) return;
    if (!confirm("Release " + p.name + " (\"" + p.callsign + "\") from the company? You'll pay 4 weeks of severance.")) return;
    M.firePerson(BMG.company, pid);
    AI.forgetPortrait(pid);
    afterAction(p.name + " released.");
  }
  function showDossier(pid) {
    const p = M.findPerson(BMG.company, pid);
    if (!p) return;
    const back = UI.modal(UI.renderDossier(BMG.company, p), true);
    UI.showModalEl(back);
  }
  function portraitAction(pid) {
    const p = M.findPerson(BMG.company, pid);
    if (!p) return;
    const force = !!AI.getPortrait(p.id);
    UI.setPortraitBusy(pid, true);
    AI.queuePortrait(p, (id, url, ok) => {
      UI.setPortraitBusy(id, false);
      if (url) UI.setPortraitInDom(id, url);
      BT.toast(url ? (force ? "Portrait re-rolled." : "Portrait painted.") : "Portrait generation failed — try again.", url ? "ok" : "error");
    }, force);
  }
  function portraitAllAction() {
    const c = BMG.company;
    const missing = c.people.filter((p) => !AI.getPortrait(p.id) && !AI.isPortraitQueued(p.id));
    if (!missing.length) { BT.toast("All personnel already have portraits — use ✦ on a card to re-roll.", "ok"); return; }
    const btn = document.querySelector('[data-bm="portrait-all"]');
    if (btn) btn.disabled = true;
    for (const p of missing) UI.setPortraitBusy(p.id, true);
    const prog = document.getElementById("portraitProgress");
    if (prog) { prog.hidden = false; prog.textContent = "Painting 0/" + missing.length + "…"; }
    AI.queuePortraitAll(missing, (s) => {
      UI.setPortraitInDom(s.pid, s.url);
      UI.setPortraitBusy(s.pid, false);
      if (prog) prog.textContent = "Painting " + s.done + "/" + s.total + "…";
      if (s.done >= s.total) {
        if (btn) btn.disabled = false;
        if (prog) { prog.textContent = "Portraits complete."; setTimeout(() => { if (prog) { prog.hidden = true; prog.textContent = ""; } }, 4000); }
        BT.toast(s.url ? "All portraits painted." : "Portrait run finished (some failed — click their ✦ to retry).", s.url ? "ok" : "error");
      }
    });
  }
  function assignAction(pid, uid) {
    const r = M.assignPilot(BMG.company, pid, uid || null);
    if (r.error) BT.toast("Cannot assign.", "error");
    afterAction("Assignment updated.");
    const p = M.findPerson(BMG.company, pid);
    if (p) { UI.closeTopModal(); showDossier(pid); }
  }

  function assignSelAction(uid, pid) {
    const c = BMG.company;
    const u = M.findUnit(c, uid);
    if (!pid) {
      if (u && u.pilotId) M.assignPilot(c, u.pilotId, null);
      afterAction(u && u.pilotId ? "Pilot unassigned." : "No pilot to unassign.");
      return;
    }
    const r = M.assignPilot(c, pid, uid);
    if (r.error === "unavailable") BT.toast("That pilot is unavailable.", "error");
    else if (r.error === "role") BT.toast("Only pilots can be assigned.", "error");
    else afterAction("Pilot reassigned.");
  }

  function repairAction(uid, mode) {
    const r = M.startRepair(BMG.company, uid, mode);
    if (r.error === "funds") BT.toast("Not enough C-bills.", "error");
    else if (r.error === "nodamage") BT.toast("That machine is pristine.", "error");
    else if (r.error === "already") BT.toast("Already in the bays.", "error");
    else if (r.error === "parts") BT.toast("Missing repair parts: " + (r.missing || []).join(", ") + ".", "error");
    else if (mode === "rush") afterAction("Repairs rushed — machine restored (" + (r.quality || "field work") + ").");
    else afterAction(r.queued ? "Repairs ordered — queued for a free bay (" + r.days + " days estimated)." : "Repairs ordered (" + r.days + " days estimated).");
  }
  function cancelRepairAction(uid) {
    M.cancelRepair(BMG.company, uid);
    afterAction("Repairs cancelled — 50% refunded.");
  }
  function sellUnitAction(uid) {
    const u = M.findUnit(BMG.company, uid);
    if (!u) return;
    if (!confirm("Sell " + u.name + "? You'll get roughly " + UI.fmtC(M.unitSellValue(u)) + " C-bills.")) return;
    const r = M.sellUnit(BMG.company, uid);
    afterAction("Sold " + u.name + " for " + UI.fmtMoney(r.value) + ".");
  }
  function showRefit(uid) {
    const u = M.findUnit(BMG.company, uid);
    if (!u) return;
    const back = UI.modal(UI.renderRefit(BMG.company, u), true);
    UI.showModalEl(back);
  }
  function stripAction(uid, wi) {
    const r = M.stripWeapon(BMG.company, uid, wi);
    if (r.ok) afterAction("Weapon returned to parts inventory.");
    UI.closeTopModal();
    const u = M.findUnit(BMG.company, uid);
    if (u) { const b = UI.modal(UI.renderRefit(BMG.company, u), true); UI.showModalEl(b); }
  }
  function installAction(uid, wid, loc) {
    const r = M.installPart(BMG.company, uid, wid, loc || null);
    if (r.error === "space") {
      const names = { LT: "left torso", CT: "center torso", RT: "right torso", LA: "left arm", RA: "right arm" };
      BT.toast("Not enough hardpoint slots in the " + (names[r.loc] || "chosen location") + " (" + (r.free || 0) + "/" + (r.need || 0) + " free).", "error");
    } else if (r.error) {
      BT.toast({ parts: "No parts of that type.", funds: "Can't afford the installation labor.", mass: "Machine can't support that weapon.", busy: "Machine is in the bays.", slots: "No free weapon mounts." }[r.error] || "Cannot install.", "error");
    } else afterAction(r.type === "replace" ? "Destroyed weapon replaced." : "Weapon installed in the " + (M.HARDPOINT_NAMES[r.loc] || "mount") + ".");
    UI.closeTopModal();
    const u = M.findUnit(BMG.company, uid);
    if (u) { const b = UI.modal(UI.renderRefit(BMG.company, u), true); UI.showModalEl(b); }
  }
  function moveRefitAction(uid, wi, loc) {
    const r = M.moveWeapon(BMG.company, uid, wi, loc);
    if (r.error) { BT.toast(r.error === "space" ? "No room in that hardpoint." : "Cannot move that weapon.", "error"); }
    else afterAction("Weapon moved to the " + (M.HARDPOINT_NAMES[r.loc] || "mount") + ".");
    UI.closeTopModal();
    const u = M.findUnit(BMG.company, uid);
    if (u) { const b = UI.modal(UI.renderRefit(BMG.company, u), true); UI.showModalEl(b); }
  }
  function buyAction(itemId) {
    const r = M.buyMarketItem(BMG.company, itemId);
    if (r.error) BT.toast("Purchase failed.", "error");
    else afterAction("Purchase complete.");
  }
  function sellPartsAction(wid) {
    const r = M.sellPartStock(BMG.company, wid);
    if (r.ok) afterAction("Parts sold for " + UI.fmtMoney(r.value) + ".");
  }
  function salvageAction(t) {
    const act = t.dataset.action;
    const c = BMG.company;
    if (act === "list" || act === "broker") {
      const r = M.listSalvage(c, t.dataset.item, act === "broker" ? "broker" : "market");
      if (r.error) BT.toast({ full: "The salvage market is full (6 listings max).", gone: "That lot is gone.", kind: "Brokers only take whole mech hulls." }[r.error] || "Cannot list that lot.", "error");
      else afterAction(r.listing.label + " listed — asking " + UI.fmtMoney(r.listing.ask) + " in ~" + r.listing.weeksLeft + " weeks (salvage index " + Math.round(M.salvageIndexOf(c) * 100) + "%).");
      return;
    }
    if (act === "cancel-listing") {
      const r = M.cancelSalvageListing(c, t.dataset.listing);
      afterAction(r.ok ? "Listing withdrawn — the lot is back in the salvage bay." : "That listing is gone.");
      return;
    }
    if (act === "sellall" || act === "sellparts") {
      let sum = 0, n = 0;
      c.salvageQueue = c.salvageQueue.filter((s) => {
        if (act === "sellall" && s.kind === "scrap") { sum += M.salvageInstantValue(c, s); return false; }
        if (act === "sellparts" && s.kind === "parts") { sum += M.salvageInstantValue(c, s); n++; return false; }
        return true;
      });
      if (sum) { M.logTx(c, "sale", act === "sellall" ? "Liquidated salvage scrap" : "Sold salvaged parts", sum); }
      afterAction(act === "sellall" ? "Scrap liquidated for " + UI.fmtMoney(sum) + "." : "Parts lots sold for " + UI.fmtMoney(sum) + ".");
      return;
    }
    const it = c.salvageQueue.find((s) => s.svId === t.dataset.item);
    if (!it) return;
    c.salvageQueue = c.salvageQueue.filter((s) => s !== it);
    if (act === "sell") {
      const val = M.salvageInstantValue(c, it);
      M.logTx(c, "sale", "Sold " + it.label, val);
      afterAction("Sold for " + UI.fmtMoney(val) + ".");
    } else if (act === "keep") {
      for (const p of it.parts) c.partsInv[p.wid] = (c.partsInv[p.wid] || 0) + 1;
      afterAction("Parts added to inventory.");
    } else if (act === "scrap") {
      const mc = D.MECH_MAP[it.chassisId];
      const val = mc ? Math.round(mc.cost * (0.06 + it.cond * 0.05)) : 3000;
      M.logTx(c, "sale", "Scrapped " + it.label, val);
      afterAction("Hull scrapped for " + UI.fmtMoney(val) + ".");
    } else if (act === "restore") {
      const mc = D.MECH_MAP[it.chassisId];
      const cost = Math.round(mc.cost * (0.35 + it.cond * 0.25) / 500) * 500;
      if (c.funds < cost) { BT.toast("Not enough funds.", "error"); afterAction(); return; }
      M.logTx(c, "market", "Restored " + mc.name + " from salvage", -cost);
      const u = M.genUnit(c, it.chassisId, { condition: it.cond, structDamage: 0.4, origin: "salvage" });
      c.units.push(u);
      afterAction(mc.name + " restored to the mechbay (" + UI.fmtC(cost) + ").");
    }
  }

  /* ============================ DEPLOY + BATTLE ============================ */
  function showWorldSystem(sid) {
    const c = BMG.company;
    const sys = M.worldSystemById(c, sid);
    if (!sys) return;
    const back = UI.modal(UI.renderWorldSystem(c, sys));
    UI.showModalEl(back);
  }
  function travelAction(destId) {
    const c = BMG.company;
    const r = M.startTravel(c, destId);
    if (r.error === "same") { BT.toast("The company is already stationed there.", "ok"); return; }
    if (r.error === "transit") { BT.toast("The DropShip is already in transit.", "error"); return; }
    if (r.error === "fuel") { BT.toast("Not enough fuel — need " + r.need + ", have " + r.have + ". Buy fuel at the market.", "error"); return; }
    if (r.error) { BT.toast("Cannot plot a course there.", "error"); return; }
    UI.closeTopModal();
    afterAction("Course laid in for " + r.transit.toName + " — " + r.transit.totalWeeks + " week" + (r.transit.totalWeeks > 1 ? "s" : "") + " in transit.");
  }
  function showDeploy(offerId) {
    const c = BMG.company;
    const offer = c.offers.find((o) => o.id === offerId);
    if (!offer) { BT.toast("That contract is no longer on the board.", "error"); return; }
    const back = UI.modal(UI.renderDeployModal(c, offer), true);
    UI.showModalEl(back);
    const list = back.querySelector("#lanceList");
    if (list) {
      list.addEventListener("click", (e) => {
        const row = e.target.closest(".lance-row");
        if (!row) return;
        const chosen = back.querySelectorAll(".lance-row.sel").length;
        if (row.classList.contains("sel")) row.classList.remove("sel");
        else if (chosen >= 4) { BT.toast("Lance limit is 4 machines.", "error"); return; }
        else row.classList.add("sel");
        updateDeployPower(back, offer);
      });
    }
    updateDeployPower(back, offer);
  }
  function updateDeployPower(back, offer) {
    const rows = back.querySelectorAll(".lance-row.sel");
    const powerEl = back.querySelector("#deployPower");
    const btn = back.querySelector("#launchBtn");
    let selPower = 0;
    if (powerEl) {
      rows.forEach((r) => {
        const u = M.findUnit(BMG.company, r.dataset.lid);
        const pil = u && u.pilotId ? M.findPerson(BMG.company, u.pilotId) : null;
        if (u) selPower += M.unitPower(u, pil);
      });
      powerEl.textContent = selPower;
    }
    if (btn) btn.disabled = rows.length === 0;
    const enemyEl = back.querySelector("#deployEnemy");
    if (enemyEl) enemyEl.textContent = rows.length ? Math.round(selPower * (offer ? offer.enemyMult : 1)) : "—";
    const riskEl = back.querySelector("#deployRisk");
    if (riskEl) {
      if (!rows.length) riskEl.innerHTML = '<span class="risk-note">Select at least one machine to launch.</span>';
      else {
        const enemy = Math.round(selPower * (offer ? offer.enemyMult : 1));
        const ratio = selPower > 0 ? enemy / selPower : 99;
        if (ratio <= 0.9) riskEl.innerHTML = '<span class="risk-ok">⛨ Lance outguns the enemy — expect a comfortable fight.</span>';
        else if (ratio <= 1.35) riskEl.innerHTML = '<span class="risk-mid">⚖ Roughly even odds. Expect heavy fighting.</span>';
        else riskEl.innerHTML = '<span class="risk-bad">☠ Enemy outguns your lance — casualties are likely.</span>';
      }
    }
    const cohEl = back.querySelector("#deployCohesion");
    if (cohEl) {
      const persons = [];
      rows.forEach((r) => { const u = M.findUnit(BMG.company, r.dataset.lid); const pil = u && u.pilotId ? M.findPerson(BMG.company, u.pilotId) : null; if (pil) persons.push(pil); });
      const coh = M.lanceBonds(BMG.company, persons);
      if (persons.length < 2 || (!coh.pos.length && !coh.neg.length)) {
        cohEl.innerHTML = persons.length >= 2 ? '<span class="risk-note">No history between these pilots — cohesion is neutral.</span>' : "";
      } else {
        const cls = coh.net > 0.005 ? "risk-ok" : coh.net < -0.005 ? "risk-bad" : "risk-note";
        const bits = [];
        if (coh.pos.length) bits.push("✦ " + coh.pos.length + " bonded pair" + (coh.pos.length > 1 ? "s" : ""));
        if (coh.neg.length) bits.push("⚔ " + coh.neg.length + " feud" + (coh.neg.length > 1 ? "s" : ""));
        const netPct = coh.net * 100;
        cohEl.innerHTML = '<span class="' + cls + '">Lance cohesion: ' + bits.join(" · ") + " → " + (netPct >= 0 ? "+" : "") + netPct.toFixed(1) + "% accuracy</span>";
      }
    }
    const compEl = back.querySelector("#deployComp");
    if (compEl) {
      const units = [];
      rows.forEach((r) => { const u = M.findUnit(BMG.company, r.dataset.lid); if (u) units.push(u); });
      if (!units.length) compEl.innerHTML = "";
      else {
        const comp = M.lanceComposition(units);
        const roleList = Object.keys(comp.counts).filter((rk) => comp.counts[rk] > 0).map((rk) => comp.counts[rk] + "× " + M.ROLE_INFO[rk].name).join(" · ");
        const acc = comp.acc + comp.synergy, dmg = comp.dmg + comp.synergy, def = comp.def;
        const eff = [];
        if (acc > 0.004) eff.push("+" + Math.round(acc * 100) + "% gunnery");
        if (dmg > 0.004) eff.push("+" + Math.round(dmg * 100) + "% damage");
        if (def > 0.004) eff.push("+" + Math.round(def * 100) + "% protection");
        const cls = comp.label === "Combined-arms" || comp.label === "Balanced" ? "risk-ok" : comp.label === "Specialized" ? "risk-bad" : "risk-note";
        compEl.innerHTML = '<span class="' + cls + '">Composition: ' + roleList + " — " + comp.label + (eff.length ? " (" + eff.join(", ") + ")" : "") + "</span>"
          + comp.notes.map((n) => '<div class="risk-note" style="font-weight:500">' + n + "</div>").join("");
      }
    }
    const ordEl = back.querySelector("#deployOrdnance");
    if (ordEl) {
      const units = [];
      rows.forEach((r) => { const u = M.findUnit(BMG.company, r.dataset.lid); if (u) units.push(u); });
      if (!units.length) ordEl.innerHTML = "";
      else {
        const profs = units.map((u) => M.ordnanceProfile(u));
        const ammoW = profs.reduce((a, p) => a + p.ammoCount, 0);
        const alphaHeat = profs.reduce((a, p) => a + p.alphaHeat, 0);
        const cap = profs.reduce((a, p) => a + p.heatCap, 0);
        const sink = profs.reduce((a, p) => a + p.sink, 0);
        const overloaded = profs.filter((p) => p.overheats).length;
        const cls = overloaded ? "risk-bad" : alphaHeat > sink * 0.85 ? "risk-note" : "risk-ok";
        ordEl.innerHTML = '<span class="' + cls + '">Ordnance: ' + alphaHeat + " alpha heat vs " + sink + " dissipation (" + cap + " capacity)"
          + (ammoW ? " · " + ammoW + " ammo-dependent weapon" + (ammoW > 1 ? "s" : "") : "")
          + (overloaded ? " · " + overloaded + " machine" + (overloaded > 1 ? "s" : "") + " must stagger fire to manage heat" : "") + "</span>";
      }
    }
  }

  async function launchBattle(offerId) {
    const c = BMG.company;
    const offer = c.offers.find((o) => o.id === offerId);
    const back = [...document.querySelectorAll(".modal-back")].filter((m) => !m.hidden).pop() || null;
    const rows = back ? back.querySelectorAll(".lance-row.sel") : [];
    const unitIds = Array.from(rows).map((r) => r.dataset.lid);
    if (!offer) { BT.toast("That contract is no longer on the board — refresh and try again.", "error"); return; }
    if (offer.systemId && c.location !== offer.systemId) { BT.toast("The company isn't on station for that contract.", "error"); return; }
    if (!unitIds.length) return;
    const units = unitIds.map((id) => M.findUnit(c, id)).filter(Boolean);
    const btn = back && back.querySelector("#launchBtn");
    if (btn) btn.disabled = true;
    BT.toast("DropShip launching… rolling the sim dice.", "ok");
    if (window.BMS) BMS.play("battle");
    setTimeout(() => {
      UI.closeTopModal();
      runContract(c, offer, units);
    }, 350);
  }

  function runContract(c, offer, units) {
    let battle, payout;
    try {
      battle = M.battle(c, offer, units);
      payout = M.applyBattle(c, offer, battle);
      grantAchievements(c);
      saveSoon();
      autoBackup("After " + offer.missionName);
    } catch (err) {
      console.error("battle failed", err);
      BT.toast("Simulation error: " + err.message, "error");
      return;
    }
    const evs = M.startCompanyEvents(c, battle).filter((e) => { const b = e.body(c); return b !== null && b !== undefined; });
    UI.renderAll(c);
    showBattleReport(battle, payout, evs);
  }

  function playMenuMusic() {
    if (!window.BMS) return;
    const c = BMG.company;
    const rate = c ? 0.95 + (Number(c.eraIdx) || 0) * 0.02 : 1;
    BMS.play("menu", { rate });
  }

  function showBattleReport(battle, payout, evs) {
    const back = UI.modal("", true);
    back.innerHTML = "";
    const m = document.createElement("div");
    m.className = "modal report-modal";
    back.appendChild(m);
    UI.showModalEl(back);
    m.innerHTML = reportShell(battle, payout);
    if (window.BMS) {
      if (battle.outcome === "victory") BMS.stinger("victory");
      else if (battle.outcome === "defeat") BMS.stinger("defeat");
    }
    const narrEl = m.querySelector("#reportNarrative");
    const imgEl = m.querySelector("#reportImage");
    if (imgEl) {
      imgEl.innerHTML = '<div class="img-loading">Generating battle scene…</div>';
      AI.generateBattleImage(battle).then((url) => {
        if (!url) { imgEl.innerHTML = '<div class="muted small" style="padding:14px">No image available.</div>'; return; }
        battle.reportImage = url;
        saveSoon();
        imgEl.innerHTML = "";
        const im = document.createElement("img");
        im.src = url; im.alt = "After-action scene"; im.className = "report-img";
        imgEl.appendChild(im);
      });
    }
    let done = false;
    AI.generateReport({
      battle, payout,
      onChunk: (txt, isFallback) => {
        if (!narrEl) return;
        narrEl.innerHTML = "";
        const div = document.createElement("div");
        div.className = "narr-body";
        div.textContent = txt;
        narrEl.appendChild(div);
        if (isFallback && !done) { done = true; narrEl.insertAdjacentHTML("beforeend", '<div class="muted small" style="margin-top:8px">— narrative draft (AI scribe unavailable).</div>'); }
      }
    }).then((res) => {
      if (res && res.text) { battle._narrativeText = res.text; saveSoon(); }
    }).catch(() => {});
    m.querySelector("#reportClose").addEventListener("click", () => {
      UI.closeModalEl(back);
      playMenuMusic();
      if (evs && evs.length) queueEvents(evs, () => { UI.renderAll(BMG.company); });
      else { UI.renderAll(BMG.company); showScreen("reports"); }
    });
  }

  function reportShell(battle, payout) {
    const outCls = battle.outcome === "victory" ? "ok" : battle.outcome === "partial" ? "warn" : "bad";
    let lanceRows = "";
    for (const l of battle.lance) {
      const st = l.dead ? '<span class="chip tr-neg">destroyed</span>' : '<span class="chip ok-chip">returned</span>';
      const r = l.role ? M.ROLE_INFO[l.role] : null;
      lanceRows += '<div class="rep-lance-row"><span>' + esc(l.unitName) + (l.tag ? " · " + esc(l.tag) : "") + (r ? ' <span class="chip role-' + r.key + '">' + esc(r.name) + "</span>" : "") + "</span>" + st + "</div>";
    }
    let inj = "";
    if (battle.injuries.length) {
      const names = battle.injuries.map((id) => { const p = M.findPerson(BMG.company, id); return p ? p.callsign : "?"; }).join(", ");
      inj = '<div class="alert warn">Injuries: ' + esc(names) + " — out of action for 1-4 weeks.</div>";
    }
    const salvageN = battle.salvageList.length;
    let bondHtml = "";
    const lb = battle.lanceBonds;
    if (lb && (lb.pos.length || lb.neg.length)) {
      const bRows = [];
      for (const p of lb.pos) bRows.push('<div class="rep-bond pos">✦ ' + esc(p.a) + " &amp; " + esc(p.b) + " — " + esc(M.bondLabel(p)) + " · +" + Math.round(p.v * 100) + "% together</div>");
      for (const p of lb.neg) bRows.push('<div class="rep-bond neg">⚔ ' + esc(p.a) + " &amp; " + esc(p.b) + " — " + esc(M.bondLabel(p)) + " · -" + Math.round(p.v * 100) + "% together</div>");
      bondHtml = '<h4 style="margin-top:14px">Lance cohesion</h4><div class="rep-lance">' + bRows.join("") + "</div>";
    }
    let voiceHtml = "";
    if (battle.banter && battle.banter.length) {
      const vs = battle.banter.map((b) => '<div class="rep-voice"><span class="rep-voice-call">' + esc(b.callsign) + '</span><span class="rep-voice-line">“' + esc(b.text) + '”</span></div>').join("");
      voiceHtml = '<h4 style="margin-top:14px">Voices from the lance</h4><div class="rep-lance rep-voices">' + vs + "</div>";
    }
    let changeHtml = "";
    if (battle.bondChanges && battle.bondChanges.length) {
      const anyRival = battle.bondChanges.some((c) => c.kind === "rival");
      changeHtml = '<div class="alert ' + (anyRival ? "warn" : "ok") + '" style="margin-top:10px">' + battle.bondChanges.map((c) => esc(c.text)).join(" ") + "</div>";
    }
    let compHtml = "";
    const cp = battle.composition;
    if (cp) {
      const roleList = Object.keys(cp.counts).filter((rk) => cp.counts[rk] > 0).map((rk) => cp.counts[rk] + "× " + M.ROLE_INFO[rk].name).join(" · ");
      const eff = [];
      if (cp.acc > 0.004) eff.push("+" + Math.round(cp.acc * 100) + "% gunnery");
      if (cp.dmg > 0.004) eff.push("+" + Math.round(cp.dmg * 100) + "% damage");
      if (cp.def > 0.004) eff.push("+" + Math.round(cp.def * 100) + "% protection");
      const weightNote = cp.tonAdv > 0.08 ? "Weight of metal — the lance out-masses the opfor and brawls accordingly." : cp.tonAdv < -0.08 ? "Out-massed but nimble — the lance trades armour for speed." : "Tonnage roughly matched against the opfor.";
      const cls = cp.label === "Combined-arms" || cp.label === "Balanced" ? "pos" : cp.label === "Specialized" ? "neg" : "";
      compHtml = '<h4 style="margin-top:14px">Lance composition</h4><div class="rep-lance">'
        + '<div class="rep-bond ' + cls + '"><b>' + esc(cp.label) + "</b> — " + esc(roleList) + (eff.length ? " · " + esc(eff.join(", ")) : "") + "</div>"
        + '<div class="rep-bond">' + esc(weightNote) + "</div>"
        + cp.notes.map((n) => '<div class="rep-bond neg">' + esc(n) + "</div>").join("")
        + "</div>";
    }
    let condHtml = "";
    const wc = battle.conditions;
    let docHtml = "";
    const dc = battle.doctrine;
    if (dc) {
      const cmdr = battle.enemyCommander;
      docHtml = '<h4 style="margin-top:14px">Opposing commander</h4><div class="rep-lance">'
        + '<div class="rep-bond"><b>' + esc(dc.glyph || "") + " " + esc(dc.name) + "</b> doctrine" + (cmdr ? " — " + esc(cmdr.rank) + " " + esc(cmdr.name) : "") + "</div>"
        + '<div class="rep-bond">' + esc(dc.desc.charAt(0).toUpperCase() + dc.desc.slice(1)) + ".</div>"
        + "</div>";
    }
    if (wc) {
      const acc = wc.condAcc !== undefined ? wc.condAcc : (wc.acc || 0) + (wc.sensors || 0) * 0.7 + (wc.heat || 0) * -0.06;
      const bits = ["gunnery " + (acc > 0 ? "+" : "") + Math.round(acc * 100) + "%"];
      if (wc.sensors < -0.02) bits.push("sensors " + Math.round(wc.sensors * 100) + "%");
      else if (wc.sensors > 0.01) bits.push("sensors clean");
      if (wc.heat > 0.05) bits.push("heat stress on energy weapons");
      else if (wc.heat < -0.05) bits.push("cold sinks run clean");
      const wx = wc.weather || {};
      condHtml = '<h4 style="margin-top:14px">Conditions</h4><div class="rep-lance">'
        + '<div class="rep-bond"><b>' + esc(wx.glyph || "") + " " + esc(wx.name || "—") + "</b> over " + esc((wc.terrain && wc.terrain.name) || "the field") + " · " + esc(bits.join(", ")) + "</div>"
        + (wc.ambushed ? '<div class="rep-bond neg">Ambushed — degraded sensors let the enemy fire first.</div>' : "")
        + "</div>";
    }
    let ordHtml = "";
    if (battle.ordnance && battle.ordnance.length) {
      const rows = battle.ordnance.map((o) => {
        const l = battle.lance.find((x) => x.unitId === o.unitId);
        let arm = "";
        if (l && l.post) {
          const ap = Math.round(M.armorPct({ armor: l.post.armor }) * 100);
          let s = 0, sm = 0;
          for (const k of D.LOCS) { s += l.post.structure[k].cur; sm += l.post.structure[k].max; }
          const sp = sm ? Math.round((s / sm) * 100) : 100;
          const breached = D.LOCS.filter((k) => l.post.structure[k].cur <= 0).length;
          arm = " · armour " + ap + "% · structure " + sp + "%" + (breached ? " · " + breached + " location" + (breached > 1 ? "s" : "") + " breached" : "");
        }
        const bits = [];
        if (o.ammoWeapons.length) bits.push(o.ammoShots + " salvo" + (o.ammoShots === 1 ? "" : "es") + " fired");
        if (o.dry.length) bits.push("ran dry: " + o.dry.join(", "));
        if (o.heldPeak) bits.push("held fire on up to " + o.heldPeak);
        bits.push("heat peak " + o.heatPeak + "/" + o.heatCap);
        if (o.overheats) bits.push(o.overheats + " overheat" + (o.overheats > 1 ? "s" : ""));
        if (o.dead) bits.push("machine lost");
        return '<div class="rep-bond' + (o.dead ? " neg" : "") + '"><b>' + esc(o.unitName) + (o.tag ? " · " + esc(o.tag) : "") + "</b> — " + esc(bits.join(" · ")) + esc(arm) + "</div>";
      }).join("");
      const eo = battle.enemyOrdnance;
      const eoNote = eo && (eo.dry || eo.overheats) ? '<div class="rep-bond">' + esc(eo.dry + " enemy machine" + (eo.dry === 1 ? " ran" : "s ran") + " dry, " + eo.overheats + " overheat event" + (eo.overheats === 1 ? "" : "s") + ".") + "</div>" : "";
      ordHtml = '<h4 style="margin-top:14px">Ordnance &amp; armour</h4><div class="rep-lance">' + rows + eoNote + "</div>";
    }
    let reelHtml = "";
    const rmap = {};
    for (const e of battle.log) {
      if (!e.round || e.round < 1) continue;
      (rmap[e.round] = rmap[e.round] || []).push(e);
    }
    const rkeys = Object.keys(rmap).map(Number).sort((a, b) => a - b);
    if (rkeys.length >= 2) {
      const prio = { kill: 0, end: 0, injury: 1, component: 1, dry: 1, heat: 1, trait: 2, quote: 2, doctrine: 2, cond: 2, round: 9 };
      const rrows = rkeys.map((rk) => {
        const evs = rmap[rk].slice().sort((a, b) => (prio[a.type] !== undefined ? prio[a.type] : 5) - (prio[b.type] !== undefined ? prio[b.type] : 5));
        const items = evs.slice(0, 3).map((e) => '<div class="reel-item ' + esc(e.tone || "") + '">' + esc(e.text) + "</div>").join("");
        return '<div class="reel-round"><div class="reel-head">Round ' + rk + "</div>" + items + "</div>";
      }).join("");
      reelHtml = '<details class="reel"><summary>Round-by-round highlight reel · ' + rkeys.length + " rounds</summary>" + rrows + "</details>";
    }
    return '<div class="report-head out-' + outCls + '">'
      + '<div class="report-kicker">After-action · ' + esc(battle.missionName) + " · " + esc(battle.planet) + "</div>"
      + '<h2>' + esc(battle.outcomeLabel) + "</h2>"
      + '<div class="muted">vs ' + esc(battle.enemyFactionName) + " · " + battle.rounds + " rounds · est. " + battle.ourPower + " vs " + Math.round(battle.enemyPower) + "</div>"
      + "</div>"
      + '<div class="report-cols"><div class="report-left">'
      + '<div id="reportImage" class="report-img-ctn"></div>'
      + '<div id="reportNarrative" class="narr-ctn"><div class="img-loading">The scribe is composing the report…</div></div>'
      + inj
      + reelHtml
      + '<div class="report-facts">'
      + '<div class="fact"><span class="fact-k">Enemy destroyed</span><span class="fact-v">' + battle.enemyDeadCount + " / " + battle.enemyTotal + "</span></div>"
      + '<div class="fact"><span class="fact-k">Machines lost</span><span class="fact-v">' + battle.ourDeadCount + "</span></div>"
      + '<div class="fact"><span class="fact-k">Salvage items</span><span class="fact-v">' + salvageN + "</span></div>"
      + '<div class="fact"><span class="fact-k">Payment</span><span class="fact-v">' + UI.fmtC(payout.amt) + "</span></div>"
      + "</div>"
      + '</div><div class="report-right">'
      + '<h4>Lance return</h4><div class="rep-lance">' + lanceRows + "</div>"
      + bondHtml + voiceHtml + compHtml + docHtml + condHtml + ordHtml + changeHtml
      + (battle.mechSalvageCount ? '<div class="chip" style="margin-top:10px">' + battle.mechSalvageCount + " hull(s) recoverable</div>" : "")
      + '<div class="btn-row" style="margin-top:16px"><button class="btn btn-primary btn-block" id="reportClose">Close report</button></div>'
      + "</div></div>";
  }

  function showReportByIndex(idx) {
    const b = BMG.company.activeReports[idx];
    if (!b) return;
    const payout = M.battlePayout(BMG.company, b.offer, b);
    const back = UI.modal(reportShell(b, payout), true);
    UI.showModalEl(back);
    const narrEl = back.querySelector("#reportNarrative");
    narrEl.innerHTML = "";
    const div = document.createElement("div");
    div.className = "narr-body";
    div.textContent = (b._narrativeText || AI.templateReport(b, payout).join("\n\n"));
    narrEl.appendChild(div);
    const imgEl = back.querySelector("#reportImage");
    if (b.reportImage) { imgEl.innerHTML = ""; const im = document.createElement("img"); im.src = b.reportImage; im.className = "report-img"; imgEl.appendChild(im); }
    else imgEl.innerHTML = '<div class="muted small" style="padding:14px">No scene image stored for this report.</div>';
    back.querySelector("#reportClose").addEventListener("click", () => { UI.closeModalEl(back); playMenuMusic(); });
  }

  /* ============================ EVENTS ============================ */
  function queueEvents(list, done) {
    BMG._evQueue = BMG._evQueue.concat(list.map((e) => ({ ev: e, done })));
    if (![...document.querySelectorAll(".modal-back")].some((m) => !m.hidden)) showNextEvent();
  }
  function showNextEvent() {
    const item = BMG._evQueue.shift();
    if (!item) return;
    const { ev, done } = item;
    const bodyTxt = ev.body(BMG.company);
    const evVoice = ev.voice ? ev.voice(BMG.company) : M.eventVoice(BMG.company, ev.kind === "story" ? "brief" : ev.kind === "cache" ? "salvage" : "camp");
    const back = UI.modal("");
    const m = document.createElement("div");
    m.className = "modal event-modal";
    back.appendChild(m);
    UI.showModalEl(back);
    const kicker = ev.kicker ? ev.kicker : (ev.kind === "cache" ? "★ LOS-TECH INCIDENT" : "Company Event");
    m.innerHTML = '<div class="event-kicker' + (ev.kind === "story" ? " story" : "") + '">' + esc(kicker) + "</div>"
      + "<h2>" + esc(ev.title) + "</h2>"
      + '<p class="event-body">' + esc(bodyTxt) + "</p>"
      + (evVoice ? '<div class="event-voice"><span class="ev-voice-call">' + esc(evVoice.callsign) + '</span>“' + esc(evVoice.text) + '”</div>' : "")
      + '<div class="event-choices">'
      + ev.choices.map((ch, i) => '<button class="btn btn-ghost event-choice" data-idx="' + i + '"><span class="ec-label">' + esc(ch.label) + "</span><span class='ec-hint'>" + esc(ch.hint) + "</span></button>").join("")
      + "</div>";
    const finish = () => {
      UI.closeModalEl(back);
      if (BMG._evQueue.length) showNextEvent();
      else if (done) done();
      else { saveSoon(); UI.renderAll(BMG.company); }
    };
    m.querySelectorAll(".event-choice").forEach((btn) => {
      btn.addEventListener("click", () => {
        const ch = ev.choices[Number(btn.dataset.idx)];
        if (!ch) { finish(); return; }
        let outcome = "";
        try { outcome = ch.run(BMG.company) || ""; }
        catch (err) { console.error("event run", err); outcome = "The event fizzles out."; }
        m.querySelector(".event-choices").innerHTML = '<div class="event-outcome">' + esc(outcome) + "</div>"
          + '<button class="btn btn-primary" id="evDone">Continue</button>';
        m.querySelector("#evDone").addEventListener("click", finish);
      });
    });
  }

  /* ============================ NEW GAME / WIPE / BANKRUPT ============================ */
  function computeLegacy(c) {
    if (!c || !c.stats) return null;
    if ((c.stats.battles || 0) < 1 && (c.week || 1) < 8) return null;
    const weeks = Math.max(1, (c.week || 1) - 1);
    let repId = null, repBest = -99;
    for (const f of D.FACTIONS) {
      const r = (c.rep && c.rep[f.id]) || 0;
      if (r > repBest) { repBest = r; repId = f.id; }
    }
    if (repBest <= 0) repId = null;
    return {
      from: c.name, week: c.week || 1, victories: c.stats.victories || 0, kills: c.stats.kills || 0,
      funds: Math.min(1200000, Math.round(weeks * 6000 + (c.stats.victories || 0) * 15000)),
      repId
    };
  }

  function showNewGame() {
    const back = document.getElementById("newGameBack");
    if (!back) return;
    if (window.BT && BT.rememberFocus) BT.rememberFocus(back);
    back.hidden = false;
    const eraSel = document.getElementById("ngEra");
    const diffSel = document.getElementById("ngDiff");
    if (eraSel && !eraSel.options.length) {
      D.ERAS.forEach((e, i) => { const o = document.createElement("option"); o.value = i; o.textContent = e.name + " (" + e.years + ") — " + e.desc; eraSel.appendChild(o); });
    }
    if (diffSel && !diffSel.options.length) {
      M.difficultyTable().forEach((d) => { const o = document.createElement("option"); o.value = d.key; o.textContent = d.label + " — " + d.blurb; diffSel.appendChild(o); });
      diffSel.value = "regular";
    }
    const diffDesc = document.getElementById("ngDiffDesc");
    const showDiffDesc = () => {
      const d = M.difficultyByKey(diffSel ? diffSel.value : "regular");
      if (diffDesc) diffDesc.textContent = "Payout ×" + d.payMult + " · enemy threat ×" + d.threatMult + " · repairs ×" + d.repairMult + " · wounds ×" + d.injuryMult + " · salvage ×" + d.salvageMult + " · upkeep ×" + d.upkeepMult;
    };
    if (diffSel) { diffSel.onchange = showDiffDesc; showDiffDesc(); }
    const ironChk = document.getElementById("ngIronman");
    if (ironChk) ironChk.checked = false;
    const scenSel = document.getElementById("ngScenario");
    if (scenSel) {
      const legacy = computeLegacy(BMG.company);
      const list = M.scenariosFor(legacy);
      const cur = scenSel.value;
      scenSel.innerHTML = "";
      for (const s of list) { const o = document.createElement("option"); o.value = s.id; o.textContent = s.glyph + " " + s.name; scenSel.appendChild(o); }
      scenSel.value = list.some((s) => s.id === cur) ? cur : "standard";
      const scenDesc = document.getElementById("ngScenarioDesc");
      const showScenDesc = () => {
        const s = M.scenarioById(scenSel.value);
        if (scenDesc) scenDesc.textContent = s.desc + " " + s.detail + ".";
      };
      scenSel.onchange = showScenDesc;
      showScenDesc();
    }
    const eraDesc = document.getElementById("ngEraDesc");
    const eraStats = document.getElementById("ngEraStats");
    const eraDossier = (i) => {
      const e = D.ERAS[i];
      const mechPool = D.MECHS.filter((m) => m.eraMin <= i);
      const wpnPool = D.WEAPONS.filter((w) => w.eraMin <= i);
      const clanMechs = mechPool.filter((m) => m.tech === "Clan").length;
      const clanWpns = wpnPool.filter((w) => w.tech === "Clan").length;
      const facs = D.FACTIONS.filter((f) => f.eraMin <= i && (f.eraMax === undefined || f.eraMax >= i));
      const clanFacs = facs.filter((f) => f.type === "clan").length;
      const tier = i === 0 ? "IntroTech only" : i === 1 ? "Clan Invasion" : i === 2 ? "Advanced IS" : i === 3 ? "War economy" : "Post-Clan abundance";
      const chip = (s) => '<span class="chip">' + s + "</span>";
      return chip("Tech tier: " + tier)
        + chip("Star League cache: ~" + Math.round(e.losTech * 100) + "%/battle")
        + chip(clanMechs ? clanMechs + " Clan 'Mechs" : "No Clan 'Mechs")
        + chip(clanWpns ? clanWpns + " Clan weapons" : "No Clan weapons")
        + chip(facs.length + " factions" + (clanFacs ? " (" + clanFacs + " Clan)" : ""))
        + chip(mechPool.length + " 'Mech chassis");
    };
    if (eraDesc) {
      if (!eraSel.dataset.wired) {
        eraSel.dataset.wired = "1";
        eraSel.addEventListener("change", () => {
          const e = D.ERAS[Number(eraSel.value)];
          eraDesc.textContent = e ? e.desc : "";
          if (eraStats) eraStats.innerHTML = eraDossier(Number(eraSel.value));
        });
      }
      const e = D.ERAS[Number(eraSel.value)];
      eraDesc.textContent = e ? e.desc : "";
      if (eraStats) eraStats.innerHTML = eraDossier(Number(eraSel.value));
    }
    if (window.BT && BT.focusModal) BT.focusModal(back);
  }

  function hideNewGameModal() {
    const back = document.getElementById("newGameBack");
    if (!back || back.hidden) return;
    back.hidden = true;
    if (window.BT && BT.restoreFocus) BT.restoreFocus(back);
  }

  async function newGameSubmit() {
    const name = (document.getElementById("ngName").value || "").trim();
    const call = (document.getElementById("ngCall").value || "").trim();
    const eraIdx = Number(document.getElementById("ngEra").value || 0);
    const diff = document.getElementById("ngDiff").value || "regular";
    const scenEl = document.getElementById("ngScenario");
    const scenario = scenEl ? scenEl.value || "standard" : "standard";
    const ironChk = document.getElementById("ngIronman");
    const ironman = !!(ironChk && ironChk.checked);
    if (name.length < 2) { BT.toast("Give your company a name (2+ characters).", "error"); return; }
    const legacy = computeLegacy(BMG.company);
    const c = M.newCompany({ name, callsign: call || "AA", eraIdx, difficulty: diff, scenario, legacy, ironman });
    const first = !BMG.company && !(BMG.slots && BMG.slots.length);
    if (BMG.company) {
      await makeBackup("Before new company — " + BMG.company.name, BMG.company);
      await persistCompany();
      await storageSet(portsKeyFor(BMG.activeSlot), AI.exportPortraits());
    }
    const slotId = first ? DEFAULT_SLOT : newSlotId();
    BMG.activeSlot = slotId;
    BMG.company = c;
    BMG._evQueue = [];
    AI.clearPortraits();
    await storageSet(PORTS_MARKER_KEY, slotId);
    await storageSet(saveKeyFor(slotId), c);
    BMG._backups = [];
    await backupsSave([]);
    await refreshSlotMeta();
    hideNewGameModal();
    UI.renderAll(c);
    UI.hud(c);
    showScreen("dashboard");
    playMenuMusic();
    BT.toast(UI.fmtMoney(c.funds) + " seed capital and " + c.units.length + " machines in the bay. Good hunting, Commander.", "ok");
  }

  async function loadSlot(id) {
    const raw = await storageGet(saveKeyFor(id));
    if (!raw) return false;
    BMG.activeSlot = id;
    BMG.company = patchLoaded(JSON.parse(JSON.stringify(raw)));
    BMG._evQueue = [];
    try {
      const ports = await storageGet(portsKeyFor(id));
      await AI.importPortraits(ports || {}, { clear: true });
    } catch (e) { console.warn("slot portraits", e); }
    await storageSet(PORTS_MARKER_KEY, id);
    BMG._backups = await backupsLoad();
    await refreshSlotMeta();
    afterLoad();
    UI.renderAll(BMG.company);
    UI.hud(BMG.company);
    showScreen("dashboard");
    playMenuMusic();
    return true;
  }

  async function switchSlot(id) {
    if (!id || id === BMG.activeSlot) return;
    if (!(await storageGet(saveKeyFor(id)))) { BT.toast("That company slot is empty.", "error"); return; }
    if (BMG.company) {
      await persistCompany();
      await storageSet(portsKeyFor(BMG.activeSlot), AI.exportPortraits());
    }
    try { await loadSlot(id); }
    catch (e) { console.error("switch slot failed", e); BT.toast("Could not switch company: " + e.message, "error"); return; }
    BT.toast("You have taken command of " + BMG.company.name + " — week " + BMG.company.week + ".", "ok");
  }

  async function deleteSlotAction(id) {
    const reg = await slotsLoad();
    const meta = reg.slots.find((s) => s.id === id);
    if (!meta) return;
    if (!confirm("Forget " + meta.name + " permanently? Its save and portraits are deleted — this cannot be undone.")) return;
    await storageDel(saveKeyFor(id));
    await storageDel(portsKeyFor(id));
    await backupsDel(id);
    reg.slots = reg.slots.filter((s) => s.id !== id);
    await slotsSave(reg);
    BMG.slots = reg.slots;
    if (id === BMG.activeSlot) {
      if (reg.slots.length) {
        const next = reg.slots.slice().sort((a, b) => (b.updated || 0) - (a.updated || 0))[0].id;
        await loadSlot(next);
        BT.toast(meta.name + " erased — command switched to " + BMG.company.name + ".", "ok");
      } else {
        BMG.company = null;
        BMG.activeSlot = DEFAULT_SLOT;
        reg.active = DEFAULT_SLOT;
        await slotsSave(reg);
        AI.clearPortraits();
        await storageSet(PORTS_MARKER_KEY, DEFAULT_SLOT);
        BMG._backups = [];
        await backupsSave([]);
        UI.renderAll(nullCompany());
        showNewGame();
        BT.toast(meta.name + " erased.", "ok");
      }
    } else {
      UI.renderAll(BMG.company);
      BT.toast(meta.name + " forgotten.", "ok");
    }
  }

  async function wipeActiveSlot(label) {
    const id = BMG.activeSlot;
    const name = BMG.company ? BMG.company.name : "Command";
    await storageDel(saveKeyFor(id));
    await storageDel(portsKeyFor(id));
    await backupsDel(id);
    const reg = await slotsLoad();
    reg.slots = reg.slots.filter((s) => s.id !== id);
    await slotsSave(reg);
    BMG.slots = reg.slots;
    AI.clearPortraits();
    BMG._backups = [];
    await storageSet(PORTS_MARKER_KEY, DEFAULT_SLOT);
    if (reg.slots.length) {
      const next = reg.slots.slice().sort((a, b) => (b.updated || 0) - (a.updated || 0))[0].id;
      await loadSlot(next);
      BT.toast(name + " " + label + " — command switched to " + BMG.company.name + ".", "ok");
    } else {
      BMG.company = null;
      BMG.activeSlot = DEFAULT_SLOT;
      await backupsSave([]);
      UI.renderAll(nullCompany());
      showNewGame();
      BT.toast(name + " " + label + ".", "ok");
    }
  }

  async function wipeAction() {
    if (!confirm("Erase this company save permanently, along with all its snapshots? There is no undo.")) return;
    UI.closeTopModal();
    await wipeActiveSlot("erased");
  }
  async function disbandAction() {
    if (!confirm("Disband the company, erase its save and all snapshots, and start over?")) return;
    UI.closeTopModal();
    await wipeActiveSlot("disbanded");
  }
  /* ============================ SOLARIS ARENA ============================ */
  async function persistStable() { if (BMG.stable) await storageSet(ARENA_KEY, BMG.stable); }
  function saveStableSoon() {
    if (!BMG.stable) return;
    clearTimeout(BMG._stableTimer);
    BMG._stableTimer = setTimeout(() => { persistStable().catch((e) => console.warn("arena autosave", e)); }, 300);
  }
  function afterArena(msg) {
    saveStableSoon();
    renderArenaScreen();
    if (msg) BT.toast(msg, "ok");
  }
  function showArenaFound() {
    const eras = D.ERAS.map((e, i) => '<option value="' + i + '"' + (i === 0 ? " selected" : "") + ">" + esc(e.name) + " (" + e.years + ")</option>").join("");
    const back = UI.modal('<h3 class="card-title">Found an arena stable</h3>'
      + '<p class="muted small">A Solaris VII stable is a separate career from your mercenary company — its own C-bills, gladiators and fame, kept in its own save.</p>'
      + '<div class="field"><label for="arName">Stable name</label><input class="input" id="arName" maxlength="30" placeholder="e.g. The Blood Circus"></div>'
      + '<div class="field"><label for="arCall">Stable callsign</label><input class="input" id="arCall" maxlength="12" placeholder="e.g. BLOOD"></div>'
      + '<div class="field"><label for="arCls">Starting circuit</label><select class="input" id="arCls">'
      + M.ARENA_CLASSES.map((c) => '<option value="' + c.key + '">' + esc(c.name) + " — " + esc(c.desc) + "</option>").join("")
      + '</select><div class="hint">Your first gladiator fights in this weight class; heavier circuits mean bigger purses and tougher opponents.</div></div>'
      + '<div class="field"><label for="arEra">Tech era</label><select class="input" id="arEra">' + eras + "</select></div>"
      + '<div class="btn-row"><button class="btn btn-primary" data-bm="arena-start">Open the stable</button><button class="btn btn-ghost" data-bm="close-modal">Dismiss</button></div>');
    UI.showModalEl(back);
  }
  async function arenaStartSubmit() {
    const val = (id, def) => { const e = document.getElementById(id); return e ? e.value : def; };
    const name = (val("arName", "") || "").trim();
    const call = (val("arCall", "") || "").trim();
    const cls = val("arCls", "light") || "light";
    const eraIdx = Number(val("arEra", "0")) || 0;
    const stable = M.newStable({ name: name || undefined, callsign: call || undefined, cls: cls, eraIdx: eraIdx });
    BMG.stable = stable;
    await persistStable();
    UI.closeTopModal();
    showScreen("arena");
    BT.toast("Stable opened — " + stable.name + " enters the Games.", "ok");
  }
  async function arenaAbandonAction() {
    if (!BMG.stable) return;
    if (!confirm("Close the stable permanently and erase its save? There is no undo.")) return;
    await storageDel(ARENA_KEY);
    BMG.stable = null;
    renderArenaScreen();
    BT.toast("Stable closed.", "ok");
  }
  function arenaWeekAction() {
    const s = BMG.stable;
    if (!s) return;
    const wk = M.arenaWeek(s);
    saveStableSoon();
    renderArenaScreen();
    const bits = ["Week " + s.week];
    if (wk.stipend) bits.push("sponsor " + UI.fmtC(wk.stipend));
    bits.push("upkeep " + UI.fmtC(wk.upkeep));
    if (wk.healed) bits.push(wk.healed + " gladiator" + (wk.healed > 1 ? "s" : "") + " healed");
    if (wk.forced) bits.push("FORCED SALE: " + wk.forced);
    BT.toast(bits.join(" · ") + ".", wk.forced ? "error" : "ok");
  }
  function arenaFightAction(boutId, unitId) {
    const s = BMG.stable;
    if (!s) return;
    const r = M.arenaBout(s, boutId, unitId);
    if (r.error) {
      const msgs = { nobout: "That bout is off the card.", nounit: "No such gladiator.", wrecked: "That machine is wrecked — repair it first.", class: "That gladiator does not fight in this circuit.", nopilot: "That gladiator has no active pilot." };
      BT.toast(msgs[r.error] || "Cannot stage that bout.", "error");
      renderArenaScreen();
      return;
    }
    const ap = M.applyBout(s, r);
    saveStableSoon();
    renderArenaScreen();
    showBoutReport(r, ap);
  }
  function showBoutReport(r, ap) {
    const lines = r.log.map((l) => '<div class="bout-log-line ' + (l.side || "") + '">' + (l.round ? '<span class="bout-round">R' + l.round + "</span>" : "") + esc(l.text) + "</div>").join("");
    const back = UI.modal('<h3 class="card-title">' + (r.win ? "Victory" : "Defeat") + " at " + esc(r.bout.venueName) + "</h3>"
      + '<p class="muted small">' + esc(r.pilotCall) + " (" + esc(r.unitName) + ") vs " + esc(r.bout.opponent) + " — " + esc(r.bout.opponentMech) + "</p>"
      + '<div class="kpis arena-kpis">'
      + UI.kpi("Result", esc(r.outcomeLabel))
      + UI.kpi("Purse", UI.fmtC(ap.purse))
      + UI.kpi("Fame", "+" + ap.fameGain)
      + UI.kpi("Rounds", String(r.rounds)) + "</div>"
      + (r.quote ? '<blockquote class="bout-quote">&ldquo;' + esc(r.quote) + '&rdquo;<span class="muted small"> — ' + esc(r.pilotCall) + "</span></blockquote>" : "")
      + '<div class="bout-notes"><span class="chip ' + (r.win ? "ok-chip" : "tr-neg") + '">' + esc(r.outcomeLabel) + "</span>"
      + '<span class="chip">Hull −' + Math.round(r.damagePct * 100) + "%</span>"
      + (r.machineLost ? '<span class="chip tr-neg">machine destroyed</span>' : r.injured ? '<span class="chip tr-warn">pilot injured</span>' : '<span class="chip ok-chip">pilot unhurt</span>') + "</div>"
      + '<div class="bout-log">' + lines + "</div>"
      + '<div class="btn-row"><button class="btn btn-primary" data-bm="close-modal">Close</button></div>');
    UI.showModalEl(back);
  }
  function arenaRepairAction(unitId) {
    const s = BMG.stable;
    if (!s) return;
    const r = M.arenaRepair(s, unitId);
    if (r.error === "funds") { BT.toast("Not enough C-bills — repair costs " + UI.fmtC(r.cost) + ".", "error"); return; }
    if (r.error === "nodamage") { BT.toast("That machine is already pristine.", "error"); return; }
    if (r.error) { BT.toast("Cannot repair that machine.", "error"); return; }
    afterArena(r.unit.name + " repaired for " + UI.fmtC(r.cost) + ".");
  }
  function arenaSellAction(unitId) {
    const s = BMG.stable;
    if (!s) return;
    const u = M.findUnit(s, unitId);
    if (!u) return;
    if (!confirm("Sell " + u.name + " to another stable?")) return;
    const r = M.arenaSellUnit(s, unitId);
    if (r.error === "last") { BT.toast("You must keep at least one gladiator.", "error"); return; }
    if (r.error) { BT.toast("Cannot sell that machine.", "error"); return; }
    afterArena(u.name + " sold for " + UI.fmtC(r.value) + ".");
  }
  function arenaBuyMechAction(itemId) {
    const s = BMG.stable;
    if (!s) return;
    const r = M.arenaBuyMech(s, itemId);
    if (r.error === "funds") { BT.toast("Not enough C-bills — that machine costs " + UI.fmtC(r.cost) + ".", "error"); return; }
    if (r.error === "cap") { BT.toast("The stable is full — build Expanded Quarters or sell a machine.", "error"); return; }
    if (r.error) { BT.toast("That machine is no longer for sale.", "error"); return; }
    afterArena(r.unit.name + " joins the stable for " + UI.fmtC(r.cost) + ".");
  }
  function arenaHireAction(pilotId) {
    const s = BMG.stable;
    if (!s) return;
    const r = M.arenaHirePilot(s, pilotId);
    if (r.error === "funds") { BT.toast("Not enough C-bills — signing fee is " + UI.fmtC(r.cost) + ".", "error"); return; }
    if (r.error === "cap") { BT.toast("The stable is full — build Expanded Quarters.", "error"); return; }
    if (r.error) { BT.toast("That gladiator is no longer available.", "error"); return; }
    afterArena(r.person.name + " \u201c" + r.person.callsign + "\u201d signed for " + UI.fmtC(r.cost) + ".");
  }
  function arenaUpgradeAction(key) {
    const s = BMG.stable;
    if (!s) return;
    const r = M.arenaBuyUpgrade(s, key);
    if (r.error === "funds") { BT.toast("Not enough C-bills — that upgrade costs " + UI.fmtC(r.cost) + ".", "error"); return; }
    if (r.error === "owned") { BT.toast("Already built.", "error"); return; }
    if (r.error) { BT.toast("Cannot install that upgrade.", "error"); return; }
    afterArena(r.upgrade.name + " installed.");
  }
  function arenaSponsorAction(id) {
    const s = BMG.stable;
    if (!s) return;
    const r = M.arenaSetSponsor(s, id);
    if (r.error === "fame") { BT.toast("That sponsor wants fame " + r.need + " first.", "error"); return; }
    if (r.error) { BT.toast("Cannot sign with that sponsor.", "error"); return; }
    afterArena(r.sponsor.id === "none" ? "Sponsorship ended." : "Signed with " + r.sponsor.name + ".");
  }

  function showBankrupt(bankr) {
    const back = UI.modal('<h2 class="danger-title">COMPANY DISSOLUTION</h2>'
      + "<p>" + esc(bankr.message) + "</p>"
      + '<p class="muted">Sell mechs, liquidate salvage, or take on crushing debt to survive the week.</p>'
      + '<div class="btn-row">'
      + ((BMG.company.loans || []).length < 4 ? '<button class="btn btn-primary" data-bm="bk-loan">Take emergency credit (+200k)</button>' : "")
      + '<button class="btn btn-ghost" data-bm="bk-sell">Open mechbay & market</button>'
      + '<button class="btn btn-danger" data-bm="bk-disband">Disband company</button>'
      + "</div>");
    UI.showModalEl(back);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
