(function () {
  "use strict";
  const M = window.MGM;
  const D = M.D;
  const esc = (s) => (window.BT ? window.BT.esc(s) : String(s));

  function fmtC(n) {
    n = Math.round(Number(n) || 0);
    const neg = n < 0;
    const a = Math.abs(n);
    let s;
    if (a >= 1e6) s = (a / 1e6).toFixed(2).replace(/\.?0+$/, "") + " M";
    else if (a >= 1e5) s = Math.round(a / 1000) + "k";
    else if (a >= 1e4) s = (a / 1000).toFixed(1).replace(/\.0$/, "") + "k";
    else s = a.toLocaleString("en-US");
    return (neg ? "-" : "") + s;
  }
  const fmtMoney = (n) => fmtC(n) + " C-bills";
  const money = (n) => "<span class=\"mon" + (n < 0 ? " neg" : "") + "\">" + fmtC(n) + "</span>";

  function el(id) { return document.getElementById(id); }
  function barsHtml(pct, cls) {
    const p = Math.round(Math.max(0, Math.min(1, pct)) * 100);
    return '<div class="bar"><div class="bar-fill ' + (cls || "") + '" style="width:' + p + '%"></div></div>';
  }
  function skulls(n) {
    const full = Math.min(5, Math.round(n));
    let s = "";
    for (let i = 0; i < 5; i++) s += i < full ? "☠" : "·";
    return s;
  }
  function chip(text, cls) { return '<span class="chip ' + (cls || "") + '">' + esc(text) + "</span>"; }
  function modPct(v) { const p = Math.round((v || 0) * 100); return (p > 0 ? "+" : "") + p + "%"; }
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ""; }
  function composeFallback(p) {
    const a = (/^[aeiou]/i.test(p.career) || /^hpg/i.test(p.career) ? "an" : "a");
    return cap(a) + " " + p.career + " from " + p.origin + ", " + p.name.split(" ")[0] + " joined up for the pay, the company, and the fighting. Ask about the war stories — they have plenty.";
  }
  function clsOf(mech) { return { light: "Light", medium: "Medium", heavy: "Heavy", assault: "Assault" }[mech.cls] || mech.cls; }
  function originLabel(u) { return { founding: "founding", market: "market buy", salvage: "salvage", cache: "cache find" }[u.origin] || u.origin || "founding"; }
  function compRow(u) {
    if (!u.components) return "";
    const bad = Object.keys(u.components).filter((c) => u.components[c] !== "ok");
    if (!bad.length) return "";
    const chips = bad.map((c) => {
      const info = M.COMP_INFO[c] || { name: c };
      const st = u.components[c];
      return '<span class="wep-chip ' + (st === "destroyed" ? "dead" : "warn") + '" title="' + esc(info.name) + " " + st + '">' + esc(info.name.toUpperCase()) + (st === "destroyed" ? " ✕" : " ⚠") + "</span>";
    }).join("");
    return '<div class="wep-row" title="Damaged internal components">' + chips + "</div>";
  }
  function pStatus(p) {
    if (p.status === "injured") return "INJURED (" + p.injuredWeeks + "w)";
    return String(p.status || "?").toUpperCase();
  }
  function traitChips(p) {
    if (!p.traits) return "";
    return p.traits.map((t) => {
      const td = M.TRAITS[t];
      if (!td) return "";
      return '<span class="chip tr-' + td.tag + '" title="' + esc(td.desc) + '">' + esc(td.name) + "</span>";
    }).join("");
  }
  function mechOf(company, p) { return p.unitId ? M.findUnit(company, p.unitId) : null; }
  function unitReady(u, company) {
    const hp = M.hpPct(u);
    if (hp <= 0.35) return "crippled";
    const pil = u.pilotId ? M.findPerson(company, u.pilotId) : null;
    if (!pil) return "no pilot";
    if (pil.status !== "active") return "pilot down";
    return hp > 0.75 ? "ready" : "damaged";
  }

  const PANEL_NAMES = { dashboard: "Command", contracts: "Contracts", personnel: "Personnel", mechbay: "Mechbay", market: "Market", salvage: "Salvage", reports: "Reports", company: "Company", roadmap: "Roadmap" };

  function hud(company) {
    const f = el("hudFunds"), m = el("hudMorale"), w = el("hudWeek");
    if (f) { f.textContent = fmtC(company.funds); f.title = BT.fmtMoney(company.funds); f.classList.toggle("low", company.funds < 0); }
    if (m) { m.textContent = company.morale + "%"; m.classList.toggle("low", company.morale < 30); }
    if (w) w.textContent = "Week " + company.week;
    const era = M.eraOf(company);
    const e = el("hudEra");
    if (e) { e.textContent = era.name + " · " + era.years; }
    const ct = el("companyNameEl");
    if (ct) ct.textContent = company.name;
  }

  function renderAll(company) {
    hud(company);
    const map = {
      dashboard: renderDashboard, contracts: renderContracts, personnel: renderPersonnel,
      mechbay: renderMechbay, market: renderMarket, salvage: renderSalvage,
      reports: renderReports, company: renderCompany
    };
    for (const k of Object.keys(map)) {
      const c = el("screen-" + k);
      if (c) {
        try { c.innerHTML = map[k](company); }
        catch (err) { console.error("render " + k, err); c.innerHTML = '<p class="lede">Render error: ' + esc(err.message) + "</p>"; }
      }
    }
    if (el("roadmapMatrix")) { const rb = window.BT; if (rb && rb.refreshFeatures) rb.refreshFeatures(); }
  }

  function eraTitle(company) {
    const era = M.eraOf(company);
    return era.name + " (" + era.years + ")";
  }
  function repBadge(company, fid) {
    const r = company.rep[fid] || 0;
    return '<span class="rep-val r' + (r < 0 ? "n" : r > 0 ? "p" : "z") + '">' + (r > 0 ? "+" : "") + r + "</span>";
  }

  /* ============================ COMMAND ============================ */
  function renderDashboard(company) {
    const rating = M.companyRating(company);
    const era = M.eraOf(company);
    const burn = M.totalWeeklyBurn(company);
    const loanNote = company.loan > 0 ? '<div class="alert warn"><b>Outstanding loan:</b> ' + fmtC(company.loan) + ' at 8% weekly interest. ' + '<button class="btn btn-sm btn-ghost" data-bm="repay">Repay now</button></div>' : "";
    const lowNote = company.funds < 0 ? '<div class="alert danger"><b>Account overdrawn.</b> Payroll and morale are at risk. Sell assets or take an emergency loan.</div>' : "";
    const destroyed = company.units.filter((u) => u.status === "destroyed").length;
    const inj = company.people.filter((p) => p.status === "injured").length;
    const offers = company.offers.length;
    let repRows = "";
    const tops = M.eraFactions(company).slice(0, 6).map((f) => ({ f, r: company.rep[f.id] || 0 })).sort((a, b) => b.r - a.r);
    for (const t of tops) {
      repRows += '<div class="rep-row"><span class="rep-name">' + esc(t.f.glyph) + " " + esc(t.f.name) + '</span>' + repBadge(company, t.f.id) + "</div>";
    }
    let news = "";
    for (const l of company.log.slice(0, 7)) news += '<div class="news-row"><span class="news-wk">W' + l.week + '</span><span>' + esc(l.text) + "</span></div>";
    if (!news) news = '<p class="muted">No company news yet. Take a contract to get started.</p>';

    return '<div class="grid-2col">'
      + '<div class="card kpi-card"><h3 class="card-title">Company Status</h3>'
      + '<div class="kpi-strip">'
      + kpi("C-bills", money(company.funds), "funds")
      + kpi("Morale", company.morale + "%", company.morale < 30 ? "bad" : "")
      + kpi("Rating", esc(rating.label), "")
      + kpi("Weekly burn", money(burn), "muted")
      + "</div>"
      + '<div class="statline"><span>' + esc(company.difficulty.label) + ' company · ' + esc(eraTitle(company)) + ' · ' + esc(era.desc) + "</span></div>"
      + '<div class="btn-row">'
      + '<button class="btn btn-primary" data-bm="advance">Advance one week</button>'
      + '<button class="btn btn-ghost" data-bm="nav" data-screen="contracts">Mission board (' + offers + ')</button>'
      + (company.loan ? "" : '<button class="btn btn-ghost" data-bm="loan">Emergency loan</button>')
      + "</div>"
      + loanNote + lowNote
      + "</div>"
      + '<div class="card"><h3 class="card-title">Standing — key employers</h3><div class="rep-list">' + repRows + "</div>"
      + '<p class="muted small">Reputation affects contract pay, availability and salvage terms.</p></div>'
      + "</div>"

      + '<div class="grid-2col" style="margin-top:20px">'
      + '<div class="card"><h3 class="card-title">Company news</h3><div class="news-list">' + news + "</div></div>"
      + '<div class="card"><h3 class="card-title">Order of Battle</h3>'
      + '<div class="statline"><b>' + rating.count + '</b> operational ' + (rating.count === 1 ? "machine" : "machines") + " · " + Math.round(rating.avgTon) + "t average · " + destroyed + ' destroyed · ' + inj + ' injured</div>'
      + '<div class="btn-row">'
      + '<button class="btn btn-sm btn-ghost" data-bm="nav" data-screen="mechbay">Mechbay</button>'
      + '<button class="btn btn-sm btn-ghost" data-bm="nav" data-screen="personnel">Personnel</button>'
      + '<button class="btn btn-sm btn-ghost" data-bm="nav" data-screen="market">Market</button>'
      + '<button class="btn btn-sm btn-ghost" data-bm="nav" data-screen="salvage">Salvage (' + company.salvageQueue.length + ')</button>'
      + "</div></div>"
      + "</div>";
  }
  function kpi(label, value, cls) {
    return '<div class="kpi"><div class="kpi-value ' + (cls || "") + '">' + value + '</div><div class="kpi-label">' + label + "</div></div>";
  }

  /* ============================ CONTRACTS ============================ */
  function renderContracts(company) {
    const avail = M.availUnitsWithPilots(company).length;
    let list = "";
    const offers = company.offers.slice().sort((a, b) => (b.pay - a.pay));
    if (!offers.length) list = '<p class="muted">No contracts on the board. Advance a week to refresh the market.</p>';
    for (const o of offers) {
      const repNote = (company.rep[o.factionId] || 0) < 0 ? '<span class="chip tr-neg">rep low</span>' : "";
      list += '<div class="offer-card card">'
        + '<div class="offer-head">'
        + '<span class="faction-badge" style="background:' + esc(o.fcolor) + '">' + esc(o.glyph) + "</span>"
        + '<div class="offer-title"><strong>' + esc(o.missionName) + '</strong> <span class="muted">for ' + esc(o.employer) + "</span> " + repNote + "</div>"
        + '<div class="offer-threat" title="Threat level">' + skulls(o.threat) + "</div>"
        + "</div>"
        + '<p class="offer-desc">' + esc(o.objDesc) + "</p>"
        + '<p class="muted small"><b>Objective:</b> ' + esc(o.victoryCond) + "</p>"
        + '<p class="muted small"><b>Target:</b> ' + esc(o.targetGlyph) + " " + esc(o.targetName) + " · <b>Planet:</b> " + esc(o.planet) + " · " + '<span class="chip" title="Terrain accuracy modifier">' + esc(o.terrain.name) + " " + modPct(o.terrain.mod) + "</span></p>"
        + '<div class="offer-meta">'
        + '<span class="pay-line">' + money(o.pay) + "</span>"
        + '<span class="chip" title="Salvage rights">☤ salvage ' + o.salvagePct + "%</span>"
        + '<span class="chip">⏱ ' + o.duration + " days</span>"
        + '<span class="chip">⚔ vs ' + esc(o.targetName.split(" ")[0]) + "</span>"
        + "</div>"
        + '<div class="offer-actions">'
        + (avail ? '<button class="btn btn-sm btn-primary" data-bm="deploy-modal" data-offer="' + o.id + '">Brief & deploy</button>'
          : '<button class="btn btn-sm" disabled title="You need at least one operational mech with an available pilot">No mechs ready</button>')
        + "</div></div>";
    }
    const full = M.companyRating(company);
    return '<div class="screen-head"><div><h2>Mission Board</h2><p class="lede">Contracts from across the sphere, offered this week. Difficulty scales with your company rating (' + esc(full.label) + ", est. power " + full.power + "). Build standing with an employer to unlock their higher-value work.</p></div>"
      + '<button class="btn btn-ghost" data-bm="advance">Refresh board (advance week)</button></div>'
      + '<div class="offer-list">' + list + "</div>";
  }

  /* ============================ PERSONNEL ============================ */
  function renderPersonnel(company) {
    const pilots = company.people.filter((p) => p.role === "pilot");
    const techs = company.people.filter((p) => p.role === "tech");
    const support = company.people.filter((p) => p.role === "support");
    const sect = (title, list, renderer) => {
      return '<div class="card roster-card"><h3 class="card-title">' + title + " (" + list.length + ")</h3>"
        + '<div class="roster-grid">' + list.map((p) => renderer(p)).join("") + "</div></div>";
    };
    const staffLine = (p) => {
      const mech = mechOf(company, p);
      const assignTxt = mech ? '<span class="chip">' + esc(mech.name.split(" ")[0]) + " " + esc(mech.name.split(" ")[1] || "") + "</span>" : '<span class="chip muted-chip">unassigned</span>';
      return '<div class="roster-item">' + portraitSlot(p)
        + '<div class="roster-body"><div class="roster-name">' + esc(p.name) + ' <span class="callsign">"' + esc(p.callsign) + '"</span></div>'
        + '<div class="roster-sub muted">' + esc(p.career) + " · " + esc(p.origin) + " · " + (p.age || "?") + " yrs</div>"
        + '<div class="trait-row">' + traitChips(p) + "</div>"
        + '<div class="roster-stats">' + (p.role === "tech" ? "Skill " + p.skill + "/10" : "") + " · Salary " + fmtC(p.salary) + "/wk · " + pStatus(p) + "</div>"
        + "</div>"
        + '<div class="roster-actions">'
        + '<button class="btn btn-sm btn-ghost" data-bm="dossier" data-person="' + p.id + '">Dossier</button>'
        + '<button class="btn btn-sm btn-ghost" data-bm="fire" data-person="' + p.id + '">Release</button>'
        + "</div></div>";
    };
    const pilotLine = (p) => {
      const mech = mechOf(company, p);
      const assignTxt = mech ? '<span class="chip">' + esc(mech.name) + " · " + esc(mech.cls) + "</span>" : '<span class="chip muted-chip">no mech</span>';
      const busy = p.status !== "active" ? '<span class="chip tr-neg">' + pStatus(p) + "</span>" : "";
      return '<div class="roster-item">' + portraitSlot(p)
        + '<div class="roster-body"><div class="roster-name">' + esc(p.name) + ' <span class="callsign">"' + esc(p.callsign) + '"</span></div>'
        + '<div class="roster-sub muted">' + esc(p.career) + " · " + esc(p.origin) + " · " + (p.age || "?") + " yrs</div>"
        + '<div class="trait-row">' + traitChips(p) + "</div>"
        + '<div class="roster-stats">' + pStatus(p) + " · G " + p.gunnery + "/P " + p.piloting + " · XP " + p.xp + " · " + fmtC(p.salary) + "/wk</div>"
        + '<div class="roster-sub">' + assignTxt + " · " + barsHtml(p.morale / 100, "morale") + "</div>"
        + "</div>"
        + '<div class="roster-actions">'
        + '<button class="btn btn-sm btn-ghost" data-bm="dossier" data-person="' + p.id + '">Dossier</button>'
        + '<button class="btn btn-sm btn-ghost" data-bm="fire" data-person="' + p.id + '">Release</button>'
        + "</div></div>";
    };
    let html = '<div class="screen-head"><div><h2>Personnel</h2><p class="lede">The people who keep the company running — and their quirks, vices and talents. Each person gets their own AI portrait — click the ✦ on a card, or paint them all at once.</p></div>'
      + '<div class="btn-row">'
      + '<button class="btn btn-sm btn-ghost" data-bm="portrait-all">Generate all portraits</button>'
      + '<span class="chip portrait-progress" id="portraitProgress" hidden></span>'
      + '<button class="btn btn-sm btn-primary" data-bm="hire" data-role="pilot">Hire pilot (' + fmtC(4000) + ")</button>"
      + '<button class="btn btn-sm btn-ghost" data-bm="hire" data-role="tech">Hire tech (' + fmtC(2500) + ")</button>"
      + '<button class="btn btn-sm btn-ghost" data-bm="hire" data-role="support">Hire support (' + fmtC(1500) + ")</button></div></div>"
      + sect("Pilots", pilots, pilotLine)
      + '<div style="height:16px"></div>'
      + sect("Techs", techs, staffLine)
      + '<div style="height:16px"></div>'
      + sect("Support staff", support, staffLine);
    return html;
  }

  function avatarWrap(svg, kind, extra) {
    return '<div class="avatar ' + (kind || "") + '">' + svg + (extra || "") + "</div>";
  }

  /* ---------- AI portrait slots (image when cached, SVG fallback) ---------- */
  function portraitSlot(p, size, withBtn) {
    const url = window.BMGA.getPortrait(p.id);
    const cls = "avatar person" + (size ? " " + size : "");
    const btn = withBtn === false ? "" : '<button class="avatar-regen" data-bm="portrait" data-person="' + p.id + '" title="Generate or re-roll AI portrait">✦</button>';
    if (url) return '<div class="' + cls + ' has-img" data-pid="' + p.id + '"><img class="ai-avatar" src="' + url + '" alt="' + esc(p.callsign) + '">' + btn + "</div>";
    return '<div class="' + cls + '" data-pid="' + p.id + '">' + M.personAvatar(p) + btn + "</div>";
  }
  function portraitBtnBig(p) {
    const has = window.BMGA.getPortrait(p.id);
    return '<button class="btn btn-sm btn-ghost" data-bm="portrait" data-person="' + p.id + '">' + (has ? "Re-roll portrait" : "Commission portrait") + "</button>";
  }
  function setPortraitBusy(pid, busy) {
    document.querySelectorAll('.avatar.person[data-pid="' + pid + '"]').forEach((box) => {
      box.classList.toggle("busy", busy);
      const b = box.querySelector(".avatar-regen");
      if (b) { b.disabled = busy; b.textContent = busy ? "…" : "✦"; }
    });
    const db = document.querySelector('.dossier button[data-bm="portrait"][data-person="' + pid + '"]');
    if (db) { db.disabled = busy; db.textContent = busy ? "Painting…" : (window.BMGA.getPortrait(pid) ? "Re-roll portrait" : "Commission portrait"); }
  }
  function setPortraitInDom(pid, url) {
    document.querySelectorAll('.avatar.person[data-pid="' + pid + '"]').forEach((box) => {
      box.classList.add("has-img");
      const img = box.querySelector("img.ai-avatar");
      if (img) { img.src = url; return; }
      const svg = box.querySelector("svg");
      if (svg) svg.remove();
      const im = document.createElement("img");
      im.className = "ai-avatar";
      im.alt = "portrait";
      im.src = url;
      box.insertBefore(im, box.querySelector(".avatar-regen") || null);
    });
  }

  function renderBonds(company, person) {
    const bonds = M.findBonds(company, person);
    if (!bonds.length) return '<p class="muted small">No bonds on file yet — keeps to themselves.</p>';
    const items = bonds.map(({ person: q, bond }) => {
      const tone = M.BOND_TYPES[bond.type] ? M.BOND_TYPES[bond.type].tone : "neu";
      const toneTxt = tone === "pos" ? "ok" : tone === "neg" ? "tr-neg" : "tr-warn";
      return '<span class="chip ' + toneTxt + '" title="' + esc(M.BOND_TYPES[bond.type] ? M.BOND_TYPES[bond.type].desc : "") + '">' + esc(q.callsign) + " — " + esc(M.bondLabel(bond)) + " (wk " + bond.sinceWeek + ")</span>";
    });
    return '<p class="muted small">Bonds:</p><div class="wep-row" style="margin-top:6px">' + items.join("") + "</div>";
  }

  function renderDossier(company, person) {
    const mech = mechOf(company, person);
    const units = company.units.filter((u) => u.status === "ok").sort((a, b) => a.ton - b.ton);
    const isPilot = person.role === "pilot";
    let assign = '<p class="muted small">' + (isPilot ? "Assign to an operational machine:" : "Non-pilot personnel are not assigned to mechs.") + "</p>";
    if (isPilot && person.status === "active") {
      assign = '<p class="muted small">Assign to a machine (empty slot available to unassign):</p><div class="assign-list">'
        + '<button class="btn btn-sm btn-ghost' + (!person.unitId ? " sel" : "") + '" data-bm="assign" data-person="' + person.id + '" data-unit="">— no mech —</button>'
        + units.map((u) => {
          const owner = u.pilotId;
          const taken = owner && owner !== person.id;
          return '<button class="btn btn-sm ' + (taken ? "ghost" : u.id === person.unitId ? "primary sel" : "ghost") + '" ' + (taken ? "disabled" : "") + ' data-bm="assign" data-person="' + person.id + '" data-unit="' + u.id + '">' + esc(u.name.split(" ")[0] + " " + (u.name.split(" ")[1] || "")) + (u.id === person.unitId ? " ✓" : taken ? " (assigned)" : "") + "</button>";
        }).join("") + "</div>";
    }
    const portraitBtn = portraitBtnBig(person);
    const traits = person.traits.map((t) => { const td = M.TRAITS[t]; return td ? '<div class="dossier-trait"><b>' + esc(td.name) + "</b> <span class='muted'>" + esc(td.desc) + "</span></div>" : ""; }).join("");
    return '<div class="dossier">'
      + '<div class="dossier-left">' + portraitSlot(person, "big", false)
      + '<div style="margin-top:8px">' + portraitBtn + "</div>"
      + "</div>"
      + '<div class="dossier-right">'
      + '<h3>' + esc(person.name) + ' <span class="callsign">"' + esc(person.callsign) + '"</span></h3>'
      + '<p class="muted">' + esc(person.role.toUpperCase()) + " · " + (person.age || "?") + " · " + esc(person.career) + " · from " + esc(person.origin) + "</p>"
      + '<p class="bio">' + esc(person.backstory || composeFallback(person)) + "</p>"
      + '<p class="bio-sub">' + esc(cap(person.build || "") + " build") + " · " + esc(person.hair || "") + " hair · " + esc(person.feature || "") + "</p>"
      + '<p><i class="muted">"' + esc(person.quirk) + '."</i></p>'
      + "<div class='dossier-traits'>" + (traits || '<p class="muted">No strong traits.</p>') + "</div>"
      + '<div class="dossier-bonds">' + renderBonds(company, person) + "</div>"
      + '<div class="roster-stats">'
      + (isPilot ? "Gunnery <b>" + person.gunnery + "</b> · Piloting <b>" + person.piloting + "</b><br>" : "Skill <b>" + (person.skill || 0) + "</b><br>")
      + "Salary " + fmtC(person.salary) + "/wk · Morale " + person.morale + "% · XP " + person.xp + "</div>"
      + '<div style="height:12px"></div>'
      + assign
      + "</div></div>";
  }

  /* ============================ MECHBAY ============================ */
  function renderMechbay(company) {
    let html = '<div class="screen-head"><div><h2>Mechbay</h2><p class="lede">Repair, refit, sell and rebuild your BattleMechs. Techs speed repairs and cut costs.</p></div>'
      + '<button class="btn btn-ghost" data-bm="nav" data-screen="market">Buy mechs & parts</button></div><div class="bay-grid">';
    const units = company.units.slice().sort((a, b) => a.ton - b.ton || a.status.localeCompare(b.status));
    if (!units.length) html += '<p class="muted">No machines. Buy one from the market.</p>';
    for (const u of units) {
      html += mechCard(company, u);
    }
    return html + "</div>";
  }
  function mechCard(company, u) {
    const hp = M.hpPct(u);
    const pilot = u.pilotId ? M.findPerson(company, u.pilotId) : null;
    const est = M.repairEstimate(u, company);
    const canRepair = company.funds >= est.cost && (est.damagePct > 0.001 || u.status === "destroyed");
    const busy = u.status === "repairing";
    const dmgNote = est.damagePct < 0.001 && u.status !== "destroyed" ? '<span class="chip ok-chip">pristine</span>' : "";
    const repairBlock = busy
      ? '<div class="bay-status"><span class="chip tr-pos">in the bays — ' + M.repairWeeksLeft(company, u) + "wk est</span> <button class='btn btn-sm btn-ghost' data-bm='cancel-repair' data-unit='" + u.id + "'>Cancel (50% refund)</button></div>"
      : est.damagePct > 0.001 || u.status === "destroyed"
        ? '<div class="bay-status"><span class="chip tr-warn">' + (u.status === "destroyed" ? "Wrecked — full rebuild" : "needs repairs") + ' · ' + fmtC(est.cost) + (est.days > 1 ? " · ~" + est.days + "d in bay" : "") + "</span>"
        + '<button class="btn btn-sm ' + (canRepair ? "btn-primary" : "") + '" data-bm="repair" data-unit="' + u.id + '" data-mode="std"' + (canRepair ? "" : " disabled") + ">Repair</button>"
        + '<button class="btn btn-sm btn-ghost" data-bm="repair" data-unit="' + u.id + '" data-mode="rush" ' + (company.funds >= est.cost * 2 ? "" : "disabled") + ">Rush ×2</button>"
        + "</div>"
        : "";
    const weps = u.weapons.map((w, i) => {
      const name = D.WMAP[w.id] ? D.WMAP[w.id].name : w.id;
      return '<span class="wep-chip ' + (w.state === "ok" ? "ok" : "dead") + '" title="' + esc(w.loc) + '">' + esc(name) + (w.state === "ok" ? "" : " ✕") + "</span>";
    }).join("");
    const hpTxt = Math.round(hp * 100) + "%";
    const rd = unitReady(u, company);
    const rdCls = rd === "ready" ? "ok-chip" : rd === "crippled" ? "tr-neg" : "tr-warn";
    let pilotCtl;
    if (u.status === "ok") {
      const availPilots = company.people.filter((p) => p.role === "pilot" && p.status === "active").sort((a, b) => (a.callsign || a.name).localeCompare(b.callsign || b.name));
      if (!availPilots.length && !pilot) {
        pilotCtl = '<span class="muted small">no pilot available — hire one</span>';
      } else {
        let opts = '<option value="">— no pilot —</option>';
        if (pilot && pilot.status !== "active") {
          opts += '<option value="' + pilot.id + '" disabled selected>' + esc(pilot.callsign) + " (" + pStatus(pilot) + ")</option>";
        }
        opts += availPilots.map((p) => '<option value="' + p.id + '"' + (pilot && pilot.id === p.id && pilot.status === "active" ? " selected" : "") + ">" + esc(p.callsign) + " · G" + p.gunnery + " P" + p.piloting + "</option>").join("");
        pilotCtl = '<label class="pilot-ctl"><span class="muted small">Pilot</span><select class="pilot-select input" data-bm="assignsel" data-unit="' + u.id + '" aria-label="Assign pilot">' + opts + "</select></label>";
      }
    } else {
      pilotCtl = pilot
        ? portraitSlot(pilot, "mini", false) + "<span>" + esc(pilot.callsign) + " · G" + pilot.gunnery + " P" + pilot.piloting + "</span>"
        : '<span class="muted small">no pilot assigned</span>';
    }
    return '<div class="mech-card card' + (busy ? " busy" : "") + (u.status === "destroyed" ? " wrecked" : "") + '">'
      + '<div class="mech-head">' + avatarWrap(M.unitAvatar(u), "mech")
      + '<div class="mech-title"><div class="mech-name">' + esc(u.name) + "</div>"
      + '<div class="roster-sub muted">' + esc(clsOf(u)) + " · " + u.ton + "t · " + (u.tech === "Clan" ? "Clan" : "Inner Sphere") + " tech</div></div>"
      + '<div class="mech-side">' + chip(rd.toUpperCase(), rdCls) + chip(originLabel(u), "muted-chip") + dmgNote + "</div></div>"
      + '<div class="mech-hp"><span class="muted small">Hull ' + hpTxt + "</span>" + barsHtml(hp, hp > 0.5 ? "ok" : hp > 0.25 ? "warn" : "bad") + "</div>"
      + '<div class="wep-row">' + (weps || '<span class="muted small">no weapons</span>') + "</div>"
      + compRow(u)
      + '<div class="mech-pilot">' + pilotCtl + "</div>"
      + (repairBlock || "")
      + '<div class="mech-actions btn-row">'
      + (busy ? "" : '<button class="btn btn-sm btn-ghost" data-bm="refit" data-unit="' + u.id + '">Refit</button>')
      + (busy ? "" : '<button class="btn btn-sm btn-ghost" data-bm="sell-unit" data-unit="' + u.id + '">Sell</button>')
      + "</div></div>";
  }

  function renderRefit(company, u) {
    const parts = Object.keys(company.partsInv).filter((w) => company.partsInv[w] > 0);
    const usable = parts.filter((w) => D.WMAP[w]).map((w) => {
      const pw = D.WMAP[w];
      const fits = pw.tech === "Clan" && u.tech === "IS" ? false : u.ton >= 20;
      return { w, pw, fits };
    });
    const rows = usable.filter((x) => x.fits).map((x) => {
      const brokenMatch = u.weapons.find((wp) => wp.state === "destroyed" && wp.id === x.w);
      const tag = brokenMatch ? "replace destroyed" : "install new";
      return '<div class="refit-row"><span>' + esc(x.pw.name) + " ×" + company.partsInv[x.w] + "</span>"
        + '<span class="chip">' + esc(x.pw.cls) + " dmg " + x.pw.dmg + "</span>"
        + '<button class="btn btn-sm btn-ghost" data-bm="install" data-unit="' + u.id + '" data-wid="' + x.w + '">' + tag + "</button></div>";
    }).join("");
    const stripped = u.weapons.map((w, i) => {
      const name = D.WMAP[w.id] ? D.WMAP[w.id].name : w.id;
      return '<span class="wep-chip ' + (w.state === "ok" ? "ok" : "dead") + '">' + esc(name) + (w.state === "ok" ? ' <button class="x-btn" data-bm="strip" data-unit="' + u.id + '" data-wi="' + i + '" title="remove to inventory">✕</button>' : " ✕") + "</span>";
    }).join("");
    return '<div class="refit">'
      + '<h3>Refit bay — ' + esc(u.name) + "</h3>"
      + '<p class="muted small">Installing a weapon costs 25% of its value in labor. Remove weapons with ✕ to return them to parts inventory.</p>'
      + '<div class="refit-current"><b>Mounted:</b><br>' + (stripped || '<span class="muted">none</span>') + "</div>"
      + '<div class="refit-parts"><b>Available parts:</b><br>' + (rows || '<span class="muted small">No compatible parts in inventory. Salvage or buy some.</span>') + "</div>"
      + "</div>";
  }

  /* ============================ MARKET ============================ */
  function renderMarket(company) {
    const m = company.market;
    let mechs = "", parts = "";
    if (!m) return '<p class="muted">Market data missing — advance a week.</p>';
    for (const it of m.stock) {
      if (it.kind === "mech") {
        const mc = D.MECH_MAP[it.chassisId];
        mechs += '<div class="stock-row card">' + avatarWrap(M.unitAvatar({ chassisId: it.chassisId, skin: "#4d5a3c", id: "m" }), "mech mini")
          + '<div class="stock-body"><div class="stock-name">' + esc(mc.name) + "</div>"
          + '<div class="roster-sub muted">' + clsOf(mc) + " · " + mc.ton + "t · " + esc(mc.desc) + "</div>"
          + "</div>"
          + '<div class="stock-meta"><span class="chip">' + (it.fresh ? "new" : Math.round(it.cond * 100) + "% cond") + "</span>"
          + '<span class="pay-line">' + money(it.price) + "</span>"
          + '<button class="btn btn-sm btn-primary" data-bm="buy" data-item="' + it.id + '"' + (company.funds >= it.price ? "" : " disabled") + ">Buy</button></div></div>";
      } else if (it.kind === "weapon") {
        const w = D.WMAP[it.wid];
        parts += '<div class="stock-row card"><div class="stock-body"><div class="stock-name">' + esc(w.name) + " ×" + it.qty + "</div>"
          + '<div class="roster-sub muted">' + esc(w.cls) + " · damage " + w.dmg + " · " + (w.tech === "Clan" ? "Clan" : "IS") + " tech</div></div>"
          + '<div class="stock-meta"><span class="pay-line">' + money(it.price) + "</span>"
          + '<button class="btn btn-sm btn-ghost" data-bm="buy" data-item="' + it.id + '"' + (company.funds >= it.price ? "" : " disabled") + ">Buy</button></div></div>";
      }
    }
    let invParts = "";
    const have = Object.keys(company.partsInv).filter((w) => company.partsInv[w] > 0);
    if (have.length) {
      invParts = "<h3 class='card-title' style='margin-top:22px'>Parts inventory (" + have.reduce((s, w) => s + company.partsInv[w], 0) + ")</h3>"
        + '<div class="inv-grid">' + have.map((w) => {
          const pw = D.WMAP[w];
          return '<div class="card inv-item"><div><b>' + esc(pw.name) + "</b> ×" + company.partsInv[w] + "</div>"
            + '<button class="btn btn-sm btn-ghost" data-bm="sell-parts" data-wid="' + w + '">Sell (' + fmtC(Math.round(Math.round(pw.cost * 0.55 * company.partsInv[w]) / 500) * 500) + ")</button></div>";
        }).join("") + "</div>";
    }
    const mood = m.mood ? m.mood : null;
    const merch = m.merchant || null;
    let moodHtml = "";
    if (mood || merch) {
      const hot = mood ? /War-boom/.test(mood.label) : false;
      const cold = mood ? /Buyer/.test(mood.label) : false;
      let dealerHtml = "";
      if (merch) {
        const mAdj = merch.adj >= 0 ? "+" + merch.adj + "%" : merch.adj + "%";
        dealerHtml = '<div class="mm-row dealer"><span class="mm-ic">' + esc(merch.glyph) + "</span><span>Dealer: <b>" + esc(merch.name) + "</b> · " + esc(merch.label) + " <span class='" + (merch.adj >= 0 ? "ok" : "neg") + "'>(" + mAdj + ")</span></span></div>";
      }
      moodHtml = '<div class="market-mood ' + (hot ? " hot" : cold ? " cold" : "") + '"><div class="mm-row"><span class="mm-ic">' + (hot ? "▲" : cold ? "▼" : "◆") + "</span><b>" + esc(mood ? mood.label : "") + "</b></div>"
        + dealerHtml
        + (mood ? '<div class="muted small">' + esc(mood.eraNote) + "</div>" : "")
        + "</div>";
    }
    return '<div class="screen-head"><div><h2>Black Market & Stock Exchange</h2><p class="lede">Market refreshes every two weeks. Prices vary by era and local demand.</p></div>'
      + '<button class="btn btn-ghost" data-bm="advance">Refresh (advance week)</button></div>'
      + moodHtml
      + '<div class="grid-2col"><div><h3 class="card-title">Mech listings</h3>' + (mechs || '<p class="muted">No mechs for sale this cycle.</p>') + "</div>"
      + '<div><h3 class="card-title">Weapon & parts lots</h3>' + (parts || '<p class="muted">No parts for sale this cycle.</p>') + "</div></div>"
      + invParts;
  }

  /* ============================ SALVAGE ============================ */
  function renderSalvage(company) {
    const q = company.salvageQueue;
    if (!q.length) {
      return '<div class="screen-head"><div><h2>Salvage Bay</h2><p class="lede">Salvage from your last operation is staged here.</p></div></div>'
        + '<p class="muted">Nothing staged right now. Win a contract and bring something back.</p>';
    }
    const scrapAll = q.filter((s) => s.kind === "scrap").reduce((a, s) => a + s.value, 0);
    const rows = q.map((s) => {
      if (s.kind === "scrap") {
        return '<div class="card salvage-row"><span class="salv-ic">⚙</span><div class="salv-body"><b>' + esc(s.label) + "</b>"
          + '<div class="muted small">Salvage scrap — can be liquidated instantly</div></div>'
          + '<span class="pay-line">' + money(s.value) + "</span>"
          + '<div class="btn-row"><button class="btn btn-sm btn-ghost" data-bm="salvage" data-item="' + s.svId + '" data-action="sell">Liquidate</button></div></div>';
      }
      if (s.kind === "parts") {
        const names = s.parts.map((p) => esc(D.WMAP[p.wid] ? D.WMAP[p.wid].name : p.wid)).join(", ");
        return '<div class="card salvage-row"><span class="salv-ic">☄</span><div class="salv-body"><b>' + esc(s.label) + "</b>"
          + '<div class="muted small">' + names + "</div></div>"
          + '<div class="btn-row"><button class="btn btn-sm btn-ghost" data-bm="salvage" data-item="' + s.svId + '" data-action="keep">Keep parts</button>'
          + '<button class="btn btn-sm btn-ghost" data-bm="salvage" data-item="' + s.svId + '" data-action="sell">Sell parts</button></div></div>';
      }
      if (s.kind === "mech") {
        const mc = D.MECH_MAP[s.chassisId];
        if (!mc) return "";
        const restoreCost = Math.round(mc.cost * (0.35 + s.cond * 0.25) / 500) * 500;
        return '<div class="card salvage-row">' + avatarWrap(M.unitAvatar({ chassisId: s.chassisId, skin: "#4d5a3c", id: "s" }), "mech mini")
          + '<div class="salv-body"><b>' + esc(s.label) + "</b>"
          + '<div class="muted small">' + esc(clsOf(mc)) + " · recoverable hull (" + Math.round(s.cond * 100) + "% condition)</div></div>"
          + '<div class="btn-row"><button class="btn btn-sm btn-primary" data-bm="salvage" data-item="' + s.svId + '" data-action="restore"' + (company.funds >= restoreCost ? "" : " disabled") + ">Restore " + fmtC(restoreCost) + "</button>"
          + '<button class="btn btn-sm btn-ghost" data-bm="salvage" data-item="' + s.svId + '" data-action="sell">Sell hull</button>'
          + '<button class="btn btn-sm btn-ghost" data-bm="salvage" data-item="' + s.svId + '" data-action="scrap">Scrap</button></div></div>';
      }
      return "";
    }).join("");
    return '<div class="screen-head"><div><h2>Salvage Bay</h2><p class="lede">Salvage rights from the contract determine what your crews could legally haul off the field.</p></div>'
      + '<div class="btn-row"><button class="btn btn-sm btn-ghost" data-bm="salvage" data-action="sellall">Liquidate all scrap (' + fmtC(scrapAll) + ")</button>"
      + '<button class="btn btn-sm btn-ghost" data-bm="salvage" data-action="sellparts">Sell all parts lots</button></div></div>'
      + '<div class="salv-list">' + rows + "</div>";
  }

  /* ============================ REPORTS ============================ */
  function renderReports(company) {
    const list = company.activeReports;
    if (!list.length) return '<div class="screen-head"><div><h2>After-Action Reports</h2></div></div><p class="muted">No operations yet. The archive fills up with every contract.</p>';
    const rows = list.map((b, i) => {
      const outcomeCls = b.outcome === "victory" ? "ok-chip" : b.outcome === "partial" ? "tr-warn" : "tr-neg";
      return '<div class="card report-row">'
        + '<div class="report-main"><div class="report-title"><strong>' + esc(b.missionName) + " · " + esc(b.planet) + "</strong> "
        + chip(b.outcomeLabel, outcomeCls) + "</div>"
        + '<div class="muted small">vs ' + esc(b.enemyFactionName) + " · " + b.rounds + " rounds · enemy " + b.enemyDeadCount + "/" + b.enemyTotal + " destroyed · losses " + b.ourDeadCount + "</div></div>"
        + '<button class="btn btn-sm btn-ghost" data-bm="report" data-idx="' + i + '">Read report</button></div>';
    }).join("");
    return '<div class="screen-head"><div><h2>After-Action Reports</h2><p class="lede">The full archive of your company\'s operations.</p></div></div>'
      + '<div class="report-list">' + rows + "</div>";
  }

  /* ============================ COMPANY ============================ */
  function logBanner(log) {
    const wearPct = Math.round((log.compMult - 1) * 100);
    const techPct = Math.round(log.techDiscount * 100);
    let maintSub = "base " + fmtC(log.baseUpkeep);
    if (log.techDiscount > 0) maintSub += " · <span class='ok'>−" + techPct + "%</span> " + log.techs + (log.techs === 1 ? " tech" : " techs");
    if (wearPct > 0) maintSub += " · <span class='neg'>+" + wearPct + "%</span> damaged internals";
    return '<div class="led-log"><div class="log-row"><b>Payroll</b><span>' + fmtC(log.payroll) + "/wk</span></div>"
      + '<div class="log-sub muted small">' + log.headcount + " personnel — pilot <b>" + fmtC(log.byRole.pilot || 0) + "</b> · tech <b>" + fmtC(log.byRole.tech || 0) + "</b> · support <b>" + fmtC(log.byRole.support || 0) + "</b></div>"
      + '<div class="log-row"><b>Maintenance & logistics</b><span>' + fmtC(log.upkeep) + "/wk</span></div>"
      + '<div class="log-sub muted small">' + maintSub + "</div>"
      + '<div class="log-row total"><b>Total burn</b><span>' + fmtC(log.total) + "/wk</span></div></div>";
  }
  function renderCompany(company) {
    const era = M.eraOf(company);
    const log = M.logisticsSummary(company);
    const ls = M.ledgerSummary(company);
    const catOrder = ["contract", "bonus", "sale", "start", "refund", "loan", "payroll", "upkeep", "repair", "hire", "severance", "event", "market", "refit", "overdraft"];
    const catTop = catOrder.filter((c) => ls.byCat[c]).map((c) => {
      const v = ls.byCat[c];
      return '<span class="chip ' + (v >= 0 ? "ok-chip" : "muted-chip") + '">' + esc(c) + " " + money(v) + "</span>";
    }).join("");
    const burnWarn = ls.burn > 0 && ls.runway <= 4 ? " <span class='chip tr-neg'>LOW RUNWAY</span>" : "";
    const sign = (n) => (n >= 0 ? "+" : "−");
    let ledger = "";
    for (const t of company.ledger.slice(0, 30)) {
      const catCls = { contract: "ok", bonus: "ok", payroll: "", upkeep: "", repair: "", market: "", sale: "ok", event: "", loan: "tr-warn", hire: "", start: "ok", severance: "", overdraft: "neg", refund: "ok", refit: "" }[t.cat] || "";
      ledger += '<div class="led-row"><span class="chip ' + catCls + '">' + esc(t.cat) + '</span><span class="led-label">' + esc(t.label) + '</span>'
        + '<span class="led-amt">' + money(t.amount) + '</span><span class="led-wk muted">W' + t.week + "</span></div>";
    }
    if (!company.ledger.length) ledger = '<p class="muted">No transactions yet.</p>';
    let rep = "";
    for (const f of M.eraFactions(company)) {
      rep += '<div class="rep-cell"><span class="faction-badge sm" style="background:' + esc(f.color) + '">' + esc(f.glyph) + "</span>"
        + '<span class="rep-name-sm">' + esc(f.name) + "</span>" + repBadge(company, f.id) + "</div>";
    }
    return '<div class="screen-head"><div><h2>Company Command</h2><p class="lede">' + esc(company.name) + " · callsign " + esc(company.callsign) + " · " + esc(company.difficulty.label) + " difficulty · " + esc(era.name) + " (" + era.years + ")</p></div></div>"
      + '<div class="grid-2col">'
      + '<div class="card"><h3 class="card-title">Ledger</h3>'
      + '<div class="led-sum">'
      + '<div class="statline">Cash <b>' + fmtC(company.funds) + "</b> · burn <b>" + fmtC(ls.burn) + "</b>/wk · runway <b>" + (ls.runway >= 999 ? "∞" : "~" + ls.runway + " wk") + "</b>" + burnWarn + "</div>"
      + '<div class="statline small muted">Last 4 weeks: <span class="ok">' + sign(ls.monthIn) + fmtC(ls.monthIn) + "</span> in / <span class='neg'>" + sign(-ls.monthOut) + fmtC(ls.monthOut) + "</span> out · net " + sign(ls.monthNet) + fmtC(Math.abs(ls.monthNet)) + "</div>"
      + '<div class="statline small muted">All-time: ' + sign(ls.income) + fmtC(ls.income) + " in / " + sign(-ls.expense) + fmtC(ls.expense) + " out · net " + sign(ls.net) + fmtC(Math.abs(ls.net)) + "</div>"
      + '<div class="led-cats">' + (catTop || '<span class="muted small">no transactions yet</span>') + "</div>"
      + "</div>"
      + '<div class="led-list">' + ledger + "</div>"
      + logBanner(log)
      + "</div>"
      + '<div><div class="card"><h3 class="card-title">Faction standing</h3><div class="rep-grid">' + rep + "</div></div>"
      + '<div class="card" style="margin-top:16px"><h3 class="card-title">Company records</h3>'
      + '<div class="statline">Contracts run: ' + company.stats.battles + " (" + company.stats.victories + "W / " + company.stats.defeats + "L) · Kills: " + company.stats.kills + " · Machines lost: " + company.stats.lost + "</div>"
      + '<div class="btn-row">'
      + '<button class="btn btn-sm btn-ghost" data-bm="newgame">Start a new company</button>'
      + '<button class="btn btn-sm btn-danger" data-bm="wipe">Erase save</button>'
      + "</div></div></div></div>";
  }

  /* ============================ DEPLOY MODAL ============================ */
  function renderDeployModal(company, offer) {
    const units = M.availUnitsWithPilots(company).sort((a, b) => a.ton - b.ton);
    const list = units.map((u) => {
      const pil = M.findPerson(company, u.pilotId);
      const pw = M.unitPower(u, pil);
      return '<div class="lance-row" data-lid="' + u.id + '">' + avatarWrap(M.unitAvatar(u), "mech mini")
        + '<div class="lance-body"><b>' + esc(u.name) + "</b> <span class='muted'>" + esc(clsOf(u)) + "</span>"
        + '<div class="muted small">Pilot ' + esc(pil.callsign) + " (G" + pil.gunnery + "/P" + pil.piloting + ") · power " + pw + "</div></div>"
        + '<span class="lance-pick">select</span></div>';
    }).join("");
    const noReady = !units.length
      ? '<div class="alert warn">No mechs are combat-ready with an available pilot. Repair, reassign, or wait for injuries to heal.</div>' : "";
    const unpiloted = company.units.filter((u) => u.status === "ok" && !u.pilotId).length;
    const downed = company.units.filter((u) => u.status === "ok" && u.pilotId && M.findPerson(company, u.pilotId) && M.findPerson(company, u.pilotId).status !== "active").length;
    const bayNote = [];
    if (unpiloted) bayNote.push(unpiloted + " ready mech" + (unpiloted > 1 ? "s" : "") + " need" + (unpiloted === 1 ? "s" : "") + " a pilot — assign in Personnel or the Mechbay");
    if (downed) bayNote.push(downed + " mech" + (downed > 1 ? "s" : "") + " grounded — pilot" + (downed > 1 ? "s are" : " is") + " injured or away");
    const bayNoteHtml = bayNote.length ? '<div class="alert warn">' + bayNote.join(" · ") + "</div>" : "";
    const mt = D.MISSION_TYPES.find((t) => t.id === offer.type);
    return '<div class="deploy">'
      + '<div class="screen-head"><div><h2>' + esc(offer.missionName) + " — " + esc(offer.planet) + "</h2>"
      + '<p class="lede">' + esc(offer.employer) + " hires " + esc(company.name) + " to strike against " + esc(offer.targetName) + ".</p></div>"
      + '<button class="btn btn-ghost" data-bm="close-modal">Back</button></div>'
      + '<div class="grid-2col"><div class="card">'
      + '<p>' + esc(offer.objDesc) + "</p>"
      + '<p class="muted small"><b>Victory:</b> ' + esc(offer.victoryCond) + "</p>"
      + '<p class="muted small"><b>Terrain:</b> ' + esc(offer.terrain.name) + " — " + esc(offer.terrain.desc) + '. Accuracy <b>' + modPct(offer.terrain.mod) + "</b>.</p>"
      + '<div class="offer-meta">' + '<span class="pay-line">' + money(offer.pay) + "</span>"
      + '<span class="chip">salvage ' + offer.salvagePct + "%</span>"
      + '<span class="chip">threat ' + skulls(offer.threat) + "</span>"
      + '<span class="chip" title="Terrain accuracy modifier">' + esc(offer.terrain.name) + " " + modPct(offer.terrain.mod) + "</span></div>"
      + '<div class="deploy-sum" style="margin-top:14px"><span>Lance power: <b id="deployPower">0</b></span>'
      + '<span>Estimated enemy: <b id="deployEnemy">—</b></span></div>'
      + '<div class="deploy-risk" id="deployRisk"><span class="risk-note">Select at least one machine to launch.</span></div>'
      + "</div>"
      + '<div class="card"><h3 class="card-title">Select your lance (up to 4)</h3>'
      + noReady
      + bayNoteHtml
      + '<div class="lance-list" id="lanceList">' + list + "</div>"
      + '<div class="btn-row" style="margin-top:12px">'
      + '<button class="btn btn-primary" data-bm="launch" data-offer="' + offer.id + '" id="launchBtn" disabled>Launch drop</button>'
      + "</div></div></div></div>";
  }

  function modal(html, wide) {
    const back = document.createElement("div");
    back.className = "modal-back" + (wide ? " wide" : "");
    back.innerHTML = '<div class="modal"><button class="modal-x" data-bm="close-modal" aria-label="Close">✕</button>' + html + "</div>";
    back.addEventListener("click", (e) => { if (e.target === back) closeModalEl(back); });
    return back;
  }
  function showModalEl(back) { document.body.appendChild(back); }
  function closeModalEl(back) { if (back && back.parentNode) back.parentNode.removeChild(back); }
  function closeTopModal() {
    const backs = document.querySelectorAll(".modal-back");
    const last = backs[backs.length - 1];
    if (!last) return;
    if (last.id === "newGameBack") last.hidden = true;
    else closeModalEl(last);
  }
  function refreshScreen() {
    renderAll(BMG.company);
  }

  window.BMUI = {
    fmtC, fmtMoney, money, esc, el, renderAll, hud, renderDashboard, renderContracts,
    renderPersonnel, renderDossier, renderMechbay, renderRefit, renderMarket, renderSalvage,
    renderReports, renderCompany, renderDeployModal, modal, showModalEl, closeModalEl, closeTopModal,
    mechCard, mechOf, repBadge, traitChips, avatarWrap, skulls, chip, clsOf, pStatus, barsHtml, kpi,
    portraitSlot, portraitBtnBig, setPortraitBusy, setPortraitInDom,
    PANEL_NAMES
  };
})();
