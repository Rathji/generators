(function () {
  "use strict";
  const M = window.MGM;
  const UI = window.BMUI;
  const AI = window.BMGA;
  const D = M.D;
  let BT = window.BT;
  const esc = (s) => (BT ? BT.esc(s) : String(s));

  const SAVE_KEY = "main";

  const BMG = {
    company: null, screen: "dashboard", _evQueue: [], _toastTimer: null, _saveTimer: null
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
    BMG._saveTimer = setTimeout(() => { storageSet(SAVE_KEY, BMG.company); }, 300);
  }

  function boot() {
    BT = window.BT;
    const body = document.body;
    buildNav();
    bindGlobal();
    (async () => {
      const saved = await storageGet(SAVE_KEY);
      await AI.preloadPortraits();
      if (saved) {
        BMG.company = patchLoaded(saved);
        afterLoad();
        UI.renderAll(BMG.company);
        UI.hud(BMG.company);
        showScreen("dashboard");
      } else {
        UI.renderAll(nullCompany());
        showNewGame(true);
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
    const m = document.getElementById("newGameBack");
    if (m) m.hidden = true;
    const bankr = M.bankruptcyCheck(c);
    if (bankr) showBankrupt(bankr);
  }

  /* ============================ NAV ============================ */
  function buildNav() {
    const nav = document.getElementById("mainNav");
    if (!nav) return;
    const tabs = [
      ["dashboard", "⌂ Command"], ["contracts", "⚔ Contracts"], ["personnel", "◈ Personnel"],
      ["mechbay", "☖ Mechbay"], ["market", "◈ Market"], ["salvage", "⚒ Salvage"],
      ["reports", "▤ Reports"], ["company", "▤ Company"], ["roadmap", "▦ Roadmap"]
    ];
    nav.innerHTML = tabs.map(([id, label]) => '<button class="nav-btn" data-bm="nav" data-screen="' + id + '">' + label + "</button>").join("");
  }

  function showScreen(name) {
    BMG.screen = name;
    document.querySelectorAll(".screen").forEach((s) => { s.hidden = s.dataset.screen !== name; });
    document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.screen === name));
    if (name === "roadmap") { const f = window.BT.refreshFeatures; if (f) f(); }
    const sc = document.getElementById("screen-" + name);
    if (sc && sc.scrollIntoView) sc.scrollIntoView({ block: "start" });
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
      }
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeTop(); });
    window.addEventListener("beforeunload", () => { if (BMG.company) storageSet(SAVE_KEY, BMG.company); });
  }

  function closeTop() {
    const backs = document.querySelectorAll(".modal-back");
    const last = backs[backs.length - 1];
    if (!last) return;
    if (last.id === "newGameBack") last.hidden = true;
    else UI.closeModalEl(last);
  }

  function route(t, action) {
    const c = BMG.company;
    switch (action) {
      case "nav": showScreen(t.dataset.screen); break;
      case "advance": doAdvanceWeek(); break;
      case "loan": loanAction(); break;
      case "repay": repayAction(); break;
      case "hire": hireAction(t.dataset.role); break;
      case "fire": fireAction(t.dataset.person); break;
      case "dossier": showDossier(t.dataset.person); break;
      case "portrait": portraitAction(t.dataset.person); break;
      case "portrait-all": portraitAllAction(); break;
      case "assign": assignAction(t.dataset.person, t.dataset.unit); break;
      case "repair": repairAction(t.dataset.unit, t.dataset.mode); break;
      case "cancel-repair": cancelRepairAction(t.dataset.unit); break;
      case "refit": showRefit(t.dataset.unit); break;
      case "strip": stripAction(t.dataset.unit, Number(t.dataset.wi)); break;
      case "install": installAction(t.dataset.unit, t.dataset.wid); break;
      case "sell-unit": sellUnitAction(t.dataset.unit); break;
      case "buy": buyAction(t.dataset.item); break;
      case "sell-parts": sellPartsAction(t.dataset.wid); break;
      case "salvage": salvageAction(t); break;
      case "deploy-modal": showDeploy(t.dataset.offer); break;
      case "launch": launchBattle(t.dataset.offer); break;
      case "report": showReportByIndex(Number(t.dataset.idx)); break;
      case "newgame": UI.closeTopModal(); showNewGame(false); break;
      case "wipe": wipeAction(); break;
      case "ng-start": newGameSubmit(); break;
      case "ng-cancel": { closeTop(); break; }
      case "close-modal": closeTop(); break;
      case "bk-loan": { closeTop(); M.takeLoan(c); BT.toast("Emergency credit extended", "ok"); saveSoon(); UI.renderAll(c); break; }
      case "bk-sell": { closeTop(); showScreen("mechbay"); break; }
      case "bk-disband": { disbandAction(); break; }
      default: console.warn("unknown action", action);
    }
  }

  /* ============================ ACTIONS ============================ */
  function afterAction(msg) {
    const c = BMG.company;
    saveSoon();
    UI.renderAll(c);
    if (msg) BT.toast(msg, "ok");
  }

  function doAdvanceWeek() {
    const c = BMG.company;
    M.advanceWeek(c);
    const bankr = M.bankruptcyCheck(c);
    saveSoon();
    const evs = M.startCompanyEvents(c, null).filter((e) => e.body(c) !== null && e.body(c) !== undefined);
    if (evs.length) { queueEvents(evs, () => { if (bankr) showBankrupt(bankr); UI.renderAll(c); }); }
    else if (bankr) { UI.renderAll(c); showBankrupt(bankr); }
    else { UI.renderAll(c); BT.toast("A new week begins. Payroll and maintenance settled.", "ok"); }
  }

  function loanAction() {
    const r = M.takeLoan(BMG.company);
    if (r.error) BT.toast("A loan is already outstanding.", "error");
    else { afterAction("Emergency line of credit granted: +200k at 8% weekly interest."); }
  }
  function repayAction() {
    const r = M.repayLoan(BMG.company);
    if (r && r.error === "funds") BT.toast("Not enough cash to repay the loan.", "error");
    else if (r && r.error === "none") BT.toast("No outstanding loan.", "error");
    else afterAction("Loan repaid in full.");
  }

  function hireAction(role) {
    const r = M.hirePerson(BMG.company, role);
    if (r.error) { BT.toast("Not enough funds to hire.", "error"); return; }
    UI.closeTopModal();
    afterAction("Hired " + r.person.name + " \"" + r.person.callsign + "\" (" + role + ").");
    showDossier(r.person.id);
    UI.setPortraitBusy(r.person.id, true);
    AI.queuePortrait(r.person, (pid, url, ok) => {
      UI.setPortraitBusy(pid, false);
      if (url) {
        UI.setPortraitInDom(pid, url);
        const db = document.querySelector('.dossier button[data-bm="portrait"][data-person="' + pid + '"]');
        if (db) db.textContent = "Re-roll portrait";
      }
    });
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
    const back = UI.modal(UI.renderDossier(BMG.company, p));
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
    else afterAction(mode === "rush" ? "Repairs rushed — machine restored." : "Repairs ordered (" + r.days + " days estimated).");
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
    const back = UI.modal(UI.renderRefit(BMG.company, u));
    UI.showModalEl(back);
  }
  function stripAction(uid, wi) {
    const r = M.stripWeapon(BMG.company, uid, wi);
    if (r.ok) afterAction("Weapon returned to parts inventory.");
    UI.closeTopModal();
    const u = M.findUnit(BMG.company, uid);
    if (u) { const b = UI.modal(UI.renderRefit(BMG.company, u)); UI.showModalEl(b); }
  }
  function installAction(uid, wid) {
    const r = M.installPart(BMG.company, uid, wid);
    if (r.error) { BT.toast({ parts: "No parts of that type.", funds: "Can't afford the installation labor.", mass: "Machine can't support that weapon.", busy: "Machine is in the bays.", slots: "No free weapon mounts." }[r.error] || "Cannot install.", "error"); }
    else afterAction(r.type === "replace" ? "Destroyed weapon replaced." : "Weapon installed.");
    UI.closeTopModal();
    const u = M.findUnit(BMG.company, uid);
    if (u) { const b = UI.modal(UI.renderRefit(BMG.company, u)); UI.showModalEl(b); }
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
    if (act === "sellall" || act === "sellparts") {
      let sum = 0, n = 0;
      c.salvageQueue = c.salvageQueue.filter((s) => {
        if (act === "sellall" && s.kind === "scrap") { sum += s.value; return false; }
        if (act === "sellparts" && s.kind === "parts") {
          let v = 0;
          for (const p of s.parts) v += D.WMAP[p.wid] ? Math.round(D.WMAP[p.wid].cost * 0.6) : 1000;
          sum += v; n++;
          return false;
        }
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
      let val = 0;
      if (it.kind === "scrap") val = it.value;
      else if (it.kind === "parts") for (const p of it.parts) val += D.WMAP[p.wid] ? Math.round(D.WMAP[p.wid].cost * 0.6) : 1000;
      else { const mc = D.MECH_MAP[it.chassisId]; val = Math.round(mc.cost * (0.2 + it.cond * 0.2)); }
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
  }

  async function launchBattle(offerId) {
    const c = BMG.company;
    const offer = c.offers.find((o) => o.id === offerId);
    const back = [...document.querySelectorAll(".modal-back")].filter((m) => !m.hidden).pop() || null;
    const rows = back ? back.querySelectorAll(".lance-row.sel") : [];
    const unitIds = Array.from(rows).map((r) => r.dataset.lid);
    if (!offer) { BT.toast("That contract is no longer on the board — refresh and try again.", "error"); return; }
    if (!unitIds.length) return;
    const units = unitIds.map((id) => M.findUnit(c, id)).filter(Boolean);
    const btn = back && back.querySelector("#launchBtn");
    if (btn) btn.disabled = true;
    BT.toast("DropShip launching… rolling the sim dice.", "ok");
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
      saveSoon();
    } catch (err) {
      console.error("battle failed", err);
      BT.toast("Simulation error: " + err.message, "error");
      return;
    }
    const evs = M.startCompanyEvents(c, battle).filter((e) => { const b = e.body(c); return b !== null && b !== undefined; });
    UI.renderAll(c);
    showBattleReport(battle, payout, evs);
  }

  function showBattleReport(battle, payout, evs) {
    const back = UI.modal("", true);
    back.innerHTML = "";
    const m = document.createElement("div");
    m.className = "modal report-modal";
    back.appendChild(m);
    UI.showModalEl(back);
    m.innerHTML = reportShell(battle, payout);
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
      if (evs && evs.length) queueEvents(evs, () => { UI.renderAll(BMG.company); });
      else { UI.renderAll(BMG.company); showScreen("reports"); }
    });
  }

  function reportShell(battle, payout) {
    const outCls = battle.outcome === "victory" ? "ok" : battle.outcome === "partial" ? "warn" : "bad";
    let lanceRows = "";
    for (const l of battle.lance) {
      const st = l.dead ? '<span class="chip tr-neg">destroyed</span>' : '<span class="chip ok-chip">returned</span>';
      lanceRows += '<div class="rep-lance-row"><span>' + esc(l.unitName) + (l.tag ? " · " + esc(l.tag) : "") + "</span>" + st + "</div>";
    }
    let inj = "";
    if (battle.injuries.length) {
      const names = battle.injuries.map((id) => { const p = M.findPerson(BMG.company, id); return p ? p.callsign : "?"; }).join(", ");
      inj = '<div class="alert warn">Injuries: ' + esc(names) + " — out of action for 1-4 weeks.</div>";
    }
    const salvageN = battle.salvageList.length;
    return '<div class="report-head out-' + outCls + '">'
      + '<div class="report-kicker">After-action · ' + esc(battle.missionName) + " · " + esc(battle.planet) + "</div>"
      + '<h2>' + esc(battle.outcomeLabel) + "</h2>"
      + '<div class="muted">vs ' + esc(battle.enemyFactionName) + " · " + battle.rounds + " rounds · est. " + battle.ourPower + " vs " + Math.round(battle.enemyPower) + "</div>"
      + "</div>"
      + '<div class="report-cols"><div class="report-left">'
      + '<div id="reportImage" class="report-img-ctn"></div>'
      + '<div id="reportNarrative" class="narr-ctn"><div class="img-loading">The scribe is composing the report…</div></div>'
      + inj
      + '<div class="report-facts">'
      + '<div class="fact"><span class="fact-k">Enemy destroyed</span><span class="fact-v">' + battle.enemyDeadCount + " / " + battle.enemyTotal + "</span></div>"
      + '<div class="fact"><span class="fact-k">Machines lost</span><span class="fact-v">' + battle.ourDeadCount + "</span></div>"
      + '<div class="fact"><span class="fact-k">Salvage items</span><span class="fact-v">' + salvageN + "</span></div>"
      + '<div class="fact"><span class="fact-k">Payment</span><span class="fact-v">' + UI.fmtC(payout.amt) + "</span></div>"
      + "</div>"
      + '</div><div class="report-right">'
      + '<h4>Lance return</h4><div class="rep-lance">' + lanceRows + "</div>"
      + (battle.mechSalvageCount ? '<div class="chip" style="margin-top:10px">' + battle.mechSalvageCount + " hull(s) recoverable</div>" : "")
      + '<div class="btn-row" style="margin-top:16px"><button class="btn btn-primary btn-block" id="reportClose">Close report</button></div>'
      + "</div></div>";
  }

  function showReportByIndex(idx) {
    const b = BMG.company.activeReports[idx];
    if (!b) return;
    const payout = M.battlePayout(BMG.company, b.offer, b);
    const back = UI.modal(reportShell(b, payout), true);
    const mEl = back.querySelector(".modal");
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
    back.querySelector("#reportClose").addEventListener("click", () => UI.closeModalEl(back));
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
    const back = UI.modal("");
    const m = document.createElement("div");
    m.className = "modal event-modal";
    back.appendChild(m);
    UI.showModalEl(back);
    m.innerHTML = '<div class="event-kicker">' + (ev.kind === "cache" ? "★ LOS-TECH INCIDENT" : "Company Event") + "</div>"
      + "<h2>" + esc(ev.title) + "</h2>"
      + '<p class="event-body">' + esc(bodyTxt) + "</p>"
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
  function showNewGame(first) {
    const back = document.getElementById("newGameBack");
    if (!back) return;
    back.hidden = false;
    const eraSel = document.getElementById("ngEra");
    const diffSel = document.getElementById("ngDiff");
    if (eraSel && !eraSel.options.length) {
      D.ERAS.forEach((e, i) => { const o = document.createElement("option"); o.value = i; o.textContent = e.name + " (" + e.years + ") — " + e.desc; eraSel.appendChild(o); });
    }
    if (diffSel && !diffSel.options.length) {
      [{ v: "recruit", t: "Recruit — generous starting funds, soft contracts (+35% pay)" }, { v: "regular", t: "Regular — the standard mercenary life" }, { v: "veteran", t: "Veteran — thinner margins, harder fights (+pay -18%)" }, { v: "elite", t: "Elite — every C-bill earned in blood (-34% pay)" }]
        .forEach((d) => { const o = document.createElement("option"); o.value = d.v; o.textContent = d.t; diffSel.appendChild(o); });
      diffSel.value = "regular";
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
  }

  function newGameSubmit() {
    const name = (document.getElementById("ngName").value || "").trim();
    const call = (document.getElementById("ngCall").value || "").trim();
    const eraIdx = Number(document.getElementById("ngEra").value || 0);
    const diff = document.getElementById("ngDiff").value || "regular";
    if (name.length < 2) { BT.toast("Give your company a name (2+ characters).", "error"); return; }
    const c = M.newCompany({ name, callsign: call || "AA", eraIdx, difficulty: diff });
    BMG.company = c;
    AI.clearPortraits();
    storageSet(SAVE_KEY, c);
    document.getElementById("newGameBack").hidden = true;
    UI.renderAll(c);
    UI.hud(c);
    showScreen("dashboard");
    BT.toast(UI.fmtMoney(c.funds) + " seed capital. Four machines in the bay. Good hunting, Commander.", "ok");
  }

  function wipeAction() {
    if (!confirm("Erase this company save permanently? There is no undo.")) return;
    storageDel(SAVE_KEY);
    BMG.company = null;
    AI.clearPortraits();
    UI.closeTopModal();
    UI.renderAll(nullCompany());
    showNewGame(false);
    BT.toast("Save erased.", "ok");
  }
  function disbandAction() {
    if (!confirm("Disband the company and start over?")) return;
    storageDel(SAVE_KEY);
    BMG.company = null;
    AI.clearPortraits();
    UI.closeTopModal();
    UI.renderAll(nullCompany());
    showNewGame(false);
  }
  function showBankrupt(bankr) {
    const back = UI.modal('<h2 class="danger-title">COMPANY DISSOLUTION</h2>'
      + "<p>" + esc(bankr.message) + "</p>"
      + '<p class="muted">Sell mechs, liquidate salvage, or take on crushing debt to survive the week.</p>'
      + '<div class="btn-row">'
      + (BMG.company.loan === 0 ? '<button class="btn btn-primary" data-bm="bk-loan">Take emergency credit (+200k)</button>' : "")
      + '<button class="btn btn-ghost" data-bm="bk-sell">Open mechbay & market</button>'
      + '<button class="btn btn-danger" data-bm="bk-disband">Disband company</button>'
      + "</div>");
    UI.showModalEl(back);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
