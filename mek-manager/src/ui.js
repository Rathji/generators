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
  function roleBadge(unit) {
    const r = M.ROLE_INFO[M.mechRole(unit.chassisId)];
    if (!r) return "";
    return '<span class="chip role-' + r.key + '" title="' + esc(r.desc) + '">' + esc(r.name) + "</span>";
  }
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
    if (p.status === "leave") return "ON LEAVE (" + (p.leaveWeeks || 0) + "w)";
    if (p.status === "training") return "TRAINING (" + ((p.training && p.training.weeksLeft) || 0) + "w)";
    return String(p.status || "?").toUpperCase();
  }
  function skillCell(p, val, eff) {
    if (!M.injuryPenalty(p) || eff === val) return String(val);
    return '<span class="skill-hurt" title="Wounded — skill reduced until recovered">' + val + "→" + eff + "</span>";
  }
  function fatigueChip(p) {
    const f = Math.round(p.fatigue || 0);
    if (f < 50) return "";
    return ' <span class="chip ' + (f >= 75 ? "tr-neg" : "tr-warn") + '" title="Fatigue cuts accuracy and risks a leave request">fatigue ' + f + "%</span>";
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

  const PANEL_NAMES = { dashboard: "Command", contracts: "Contracts", world: "Known Space", personnel: "Personnel", mechbay: "Mechbay", market: "Market", salvage: "Salvage", reports: "Reports", company: "Company", arena: "Solaris", roadmap: "Roadmap" };

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
    const ttl = el("companyTitleEl");
    if (ttl) {
      const parts = [];
      const sc = M.scenarioById(company.scenario);
      if (sc && sc.title) parts.push(sc.title);
      const titles = company.titles || [];
      if (titles.length) parts.push(titles[titles.length - 1]);
      ttl.textContent = parts.length ? "“" + parts.join("” · “") + "”" : "";
      ttl.hidden = !parts.length;
    }
    const im = el("ironmanEl");
    if (im) im.hidden = !company.ironman;
  }

  function renderAll(company) {
    hud(company);
    const map = {
      dashboard: renderDashboard, contracts: renderContracts, world: renderWorld, personnel: renderPersonnel,
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
    const tier = M.repTier(r);
    return '<span class="rep-val r' + (r < 0 ? "n" : r > 0 ? "p" : "z") + '" title="' + esc(tier.name) + '">' + (r > 0 ? "+" : "") + r + "</span>";
  }

  /* ============================ COMMAND ============================ */
  function renderDashboard(company) {
    const rating = M.companyRating(company);
    const era = M.eraOf(company);
    const burn = M.totalWeeklyBurn(company);
    const debt = M.totalDebt(company);
    const loanNote = debt > 0 ? '<div class="alert warn"><b>Outstanding debt:</b> ' + fmtC(debt) + " across " + company.loans.length + " loan" + (company.loans.length > 1 ? "s" : "") + " — interest runs " + fmtC(M.weeklyDebtService(company)) + '/wk. ' + '<button class="btn btn-sm btn-ghost" data-bm="nav" data-screen="company">Manage credit</button></div>' : "";
    const lowNote = company.funds < 0 ? '<div class="alert danger"><b>Account overdrawn.</b> Payroll and morale are at risk. Sell assets or take an emergency loan.</div>' : "";
    const hot = company.people.filter((p) => p.role === "pilot" && p.status === "active" && (p.fatigue || 0) >= 70);
    const fatigueNote = hot.length ? '<div class="alert warn"><b>' + hot.length + " pilot" + (hot.length > 1 ? "s" : "") + " running hot.</b> High fatigue cuts accuracy and risks a leave request or a walkout. Stand them down for a week to let them recover.</div>" : "";
    const transit = company.transit;
    const transitNote = transit ? '<div class="alert"><b>In transit:</b> the DropShip is ' + Math.max(0, transit.weeksLeft) + " week" + (transit.weeksLeft === 1 ? "" : "s") + " out from " + esc(transit.toName || transit.to) + ". Contracts can only be deployed once the company arrives.</div>" : "";
    const feuds = [], seenF = {};
    for (const p of company.people) {
      for (const b of p.bonds || []) {
        if (b.type !== "rival") continue;
        const key = [p.id, b.otherId].sort().join("|");
        if (seenF[key]) continue;
        seenF[key] = true;
        const q = M.findPerson(company, b.otherId);
        if (q) feuds.push(p.callsign + " ⚔ " + q.callsign);
      }
    }
    const feudNote = feuds.length ? '<div class="alert warn"><b>Rivalry on the roster:</b> ' + esc(feuds.slice(0, 3).join(", ")) + (feuds.length > 3 ? " and " + (feuds.length - 3) + " more" : "") + ". Feuding pilots deployed in the same lance lose accuracy and morale; bonded pairs fight better. A joint simulator program can bury the hatchet.</div>" : "";
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
      + (company.loans && company.loans.length ? "" : '<button class="btn btn-ghost" data-bm="loan">Emergency loan</button>')
      + "</div>"
      + loanNote + lowNote + transitNote + fatigueNote + feudNote
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
      + "</div>"
      + '<div style="margin-top:20px"></div>'
      + almanacCard(company)
      + banterCard(company)
      + achievementsCard(company);
  }
  function kpi(label, value, cls) {
    return '<div class="kpi"><div class="kpi-value ' + (cls || "") + '">' + value + '</div><div class="kpi-label">' + label + "</div></div>";
  }
  function svgLine(values, opts) {
    opts = opts || {};
    const w = opts.w || 600, h = opts.h || 120, pad = 6;
    if (!values.length) values = [0];
    const min = Math.min.apply(null, values), max = Math.max.apply(null, values);
    const span = (max - min) || 1;
    const x = (i) => pad + (values.length === 1 ? (w - pad * 2) / 2 : (i / (values.length - 1)) * (w - pad * 2));
    const y = (v) => h - pad - ((v - min) / span) * (h - pad * 2);
    const pts = values.map((v, i) => x(i).toFixed(1) + "," + y(v).toFixed(1)).join(" ");
    const area = pts + " " + x(values.length - 1).toFixed(1) + "," + (h - pad) + " " + x(0).toFixed(1) + "," + (h - pad);
    const zeroY = min <= 0 && max >= 0 ? y(0) : null;
    return '<svg class="chart" viewBox="0 0 ' + w + " " + h + '" preserveAspectRatio="none" role="img">'
      + (zeroY !== null ? '<line class="chart-zero" x1="' + pad + '" y1="' + zeroY.toFixed(1) + '" x2="' + (w - pad) + '" y2="' + zeroY.toFixed(1) + '"/>' : "")
      + '<polygon class="chart-area" points="' + area + '"/>'
      + '<polyline class="chart-line" points="' + pts + '"/></svg>';
  }
  function svgBars(values, opts) {
    opts = opts || {};
    const w = opts.w || 600, h = opts.h || 80, pad = 2;
    if (!values.length) return '<p class="muted small">No weekly data yet.</p>';
    const max = Math.max.apply(null, values.map(Math.abs)) || 1;
    const bw = (w - pad * 2) / values.length;
    const zero = h / 2;
    let bars = "";
    values.forEach((v, i) => {
      const bh = Math.max(1, (Math.abs(v) / max) * (h / 2 - 3));
      const y = v >= 0 ? zero - bh : zero;
      bars += '<rect class="chart-bar ' + (v >= 0 ? "pos" : "neg") + '" x="' + (pad + i * bw).toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + Math.max(1, bw - 2).toFixed(1) + '" height="' + bh.toFixed(1) + '"/>';
    });
    return '<svg class="chart" viewBox="0 0 ' + w + " " + h + '" preserveAspectRatio="none" role="img"><line class="chart-zero" x1="0" y1="' + zero + '" x2="' + w + '" y2="' + zero + '"/>' + bars + "</svg>";
  }
  function almanacCard(company) {
    const a = M.almanacStats(company);
    const hist = company.history || [];
    const funds = hist.map((h) => h.funds);
    const nets = hist.map((h) => h.net);
    const firstW = hist.length ? hist[0].week : company.week;
    const lastW = hist.length ? hist[hist.length - 1].week : company.week;
    const stats = '<div class="kpi-strip">'
      + kpi("Weeks active", a.weeks, "muted")
      + kpi("Contracts", a.contracts, "muted")
      + kpi("Win rate", a.winRate === null ? "—" : a.winRate + "%", a.winRate !== null && a.winRate < 50 ? "bad" : "")
      + kpi("Confirmed kills", a.kills, "muted")
      + kpi("Total payout", money(a.payout), "muted")
      + kpi("Machines lost", a.lost, a.lost > 0 ? "bad" : "")
      + "</div>";
    const best = a.best ? '<p class="muted small">Best contract: <b>' + esc(a.best.missionName) + "</b> on " + esc(a.best.planet) + " — " + fmtC(a.best.pay) + " C-bills (" + esc(a.best.outcomeLabel) + ", week " + a.best.week + ").</p>" : "";
    const chart1 = '<div class="chart-block"><div class="chart-head"><span>Company funds</span><span>wk ' + firstW + " → " + lastW + '</span></div>' + svgLine(funds) + "</div>";
    const chart2 = '<div class="chart-block"><div class="chart-head"><span>Weekly net cash</span><span>income − outgoings</span></div>' + svgBars(nets) + "</div>";
    const rows = (company.contractHistory || []).slice(0, 12).map((r) => {
      const cls = r.outcome === "victory" ? "tr-pos" : r.outcome === "defeat" ? "tr-neg" : "tr-warn";
      return '<div class="hist-row"><span class="hist-wk">W' + r.week + '</span><span class="hist-name">' + esc(r.missionName) + (r.planet ? ' <span class="muted small">· ' + esc(r.planet) + "</span>" : "") + '</span><span class="chip ' + cls + '">' + esc(r.outcomeLabel) + '</span><span class="hist-pay">' + money(r.pay) + '</span><span class="muted small">' + r.kills + " kill" + (r.kills === 1 ? "" : "s") + (r.ourDead ? " · " + r.ourDead + " lost" : "") + "</span></div>";
    }).join("") || '<p class="muted small">No contracts yet.</p>';
    return '<div class="card almanac"><h3 class="card-title">Company almanac</h3>'
      + stats + best
      + '<div class="almanac-charts">' + chart1 + chart2 + "</div>"
      + '<h4 class="service-head">Contract history</h4><div class="hist-list">' + rows + "</div>"
      + "</div>";
  }
  function banterCard(company) {
    const lines = M.barracksBanter(company, 4);
    if (!lines.length) return "";
    const rows = lines.map((l) => '<div class="banter-row"><span class="banter-call">' + esc(l.callsign) + '</span><span class="banter-line">“' + esc(l.text) + '”</span></div>').join("");
    return '<div class="card banter-card" style="margin-top:20px"><h3 class="card-title">Barracks chatter</h3><div class="banter-list">' + rows + "</div>"
      + '<p class="muted small">What the lance is saying this week.</p></div>';
  }

  function achTitleChip(a) {
    return a.title ? ' <span class="ach-title">“' + esc(a.title) + '”</span>' : "";
  }
  function achievementsCard(company) {
    const s = M.achievementsSummary(company);
    const recent = s.recent.length
      ? s.recent.map((r) => '<div class="ach-row done"><span class="ach-gl">' + esc(r.a.glyph) + '</span><div class="ach-body">'
        + '<div class="ach-name">' + esc(r.a.name) + achTitleChip(r.a) + '</div><div class="ach-desc muted">' + esc(r.a.flavor) + '</div></div></div>').join("")
      : '<p class="muted small">No milestones unlocked yet — win a contract, grow the roster, or build the treasury to earn your first.</p>';
    const next = s.next.map((r) => '<div class="ach-prog"><div class="ach-prog-head"><span>' + esc(r.a.glyph) + " " + esc(r.a.name) + '</span><span class="muted small">' + r.p.value.toLocaleString("en-US") + " / " + r.p.goal.toLocaleString("en-US") + '</span></div>' + barsHtml(r.p.ratio, "warn") + "</div>").join("");
    return '<div class="card ach-card" style="margin-top:20px"><div class="ach-head"><h3 class="card-title">Milestones</h3><span class="chip">' + s.unlocked.length + " / " + s.total + " unlocked</span></div>"
      + '<h4 class="service-head">Recently earned</h4><div class="ach-list">' + recent + "</div>"
      + (next ? '<h4 class="service-head">In progress</h4><div class="ach-progs">' + next + "</div>" : "")
      + '<div class="btn-row" style="margin-top:12px"><button class="btn btn-sm btn-ghost" data-bm="nav" data-screen="company">View all milestones</button></div></div>';
  }
  function achievementsFull(company) {
    const s = M.achievementsSummary(company);
    const cats = ["Combat", "Command", "Finance", "Logistics", "Campaign"];
    let groups = "";
    for (const cat of cats) {
      const cells = M.ACHIEVEMENTS.filter((a) => a.cat === cat).map((a) => {
        const p = M.achievementProgress(company, a);
        const when = (company.achievements[a.id] || {}).week;
        const right = p.unlocked ? '<span class="chip ok-chip">W' + when + "</span>" : '<span class="muted small">' + p.value.toLocaleString("en-US") + " / " + p.goal.toLocaleString("en-US") + "</span>";
        return '<div class="ach-cell ' + (p.unlocked ? "done" : "locked") + '"><span class="ach-gl">' + esc(a.glyph) + '</span><div class="ach-body">'
          + '<div class="ach-name">' + esc(a.name) + achTitleChip(a) + "</div><div class=\"ach-desc\">" + esc(a.desc) + "</div>"
          + (p.unlocked ? '<div class="ach-desc ach-flavor">' + esc(a.flavor) + "</div>" : '<div class="ach-bar">' + barsHtml(p.ratio, p.ratio >= 0.66 ? "ok" : "warn") + "</div>")
          + "</div>" + right + "</div>";
      }).join("");
      groups += '<div class="ach-group"><h4 class="service-head">' + esc(cat) + '</h4><div class="ach-grid">' + cells + "</div></div>";
    }
    const titleRow = s.titles.length ? '<div class="title-row">' + s.titles.map((t) => '<span class="chip ach-title-chip">✦ ' + esc(t) + "</span>").join("") + "</div>" : "";
    return '<div class="card ach-card" style="margin-top:16px"><div class="ach-head"><h3 class="card-title">Milestones &amp; commendations</h3><span class="chip">' + s.unlocked.length + " / " + s.total + '</span></div>'
      + '<p class="muted small">Goals earned across the campaign. Each milestone unlocked is a small piece of company history, and some grant a working title worn on the roster.</p>'
      + titleRow + groups + "</div>";
  }

  /* ============================ CONTRACTS ============================ */
  function renderContracts(company) {
    const avail = M.availUnitsWithPilots(company).length;
    let list = "";
    const offers = company.offers.slice().sort((a, b) => (b.pay - a.pay));
    if (!offers.length) list = '<p class="muted">No contracts on the board. Advance a week to refresh the market.</p>';
    for (const o of offers) {
      const repNote = (company.rep[o.factionId] || 0) < 0 ? '<span class="chip tr-neg">rep low</span>' : "";
      const doc = M.doctrineOf(o);
      let locChip = "";
      if (o.systemId) {
        if (company.location === o.systemId) locChip = '<span class="chip tr-pos" title="This contract is on your current world">◎ on station</span>';
        else {
          const q = M.travelQuote(company, o.systemId);
          if (q.ok) locChip = '<span class="chip tr-warn" title="Transit time to reach this contract">✈ ' + q.weeks + " wk · " + q.fuel + " fuel</span>";
          else if (q.error === "transit") locChip = '<span class="chip tr-warn" title="Company is in transit">✈ in transit</span>';
        }
      }
      const houseBadge = o.house ? '<span class="chip house-badge" title="Exclusive contract — your standing with this employer unlocked it">★ ' + (o.clanHouse ? "Clan" : "House") + " Contract · " + esc(o.tier || "") + "</span>" : "";
      list += '<div class="offer-card card' + (o.house ? " house-offer" : "") + '">'
        + '<div class="offer-head">'
        + '<span class="faction-badge" style="background:' + esc(o.fcolor) + '">' + esc(o.glyph) + "</span>"
        + '<div class="offer-title"><strong>' + esc(o.missionName) + '</strong> <span class="muted">for ' + esc(o.employer) + "</span> " + repNote + " " + houseBadge + "</div>"
        + '<div class="offer-threat" title="Threat level">' + skulls(o.threat) + "</div>"
        + "</div>"
        + '<p class="offer-desc">' + esc(o.objDesc) + "</p>"
        + '<p class="muted small"><b>Objective:</b> ' + esc(o.victoryCond) + "</p>"
        + '<p class="muted small"><b>Target:</b> ' + esc(o.targetGlyph) + " " + esc(o.targetName) + " · <b>Planet:</b> " + esc(o.planet) + " · " + '<span class="chip" title="Terrain accuracy modifier">' + esc(o.terrain.name) + " " + modPct(o.terrain.mod) + "</span>" + (o.weather ? ' <span class="chip wx-chip" title="Weather conditions">' + esc(o.weather.glyph) + " " + esc(o.weather.name) + "</span>" : "") + "</p>"
        + (o.enemyCommander ? '<p class="muted small"><b>Commander:</b> ' + esc(o.enemyCommander.rank) + " " + esc(o.enemyCommander.name) + ' — <span class="chip doc-chip doc-' + esc(doc.id) + '" title="' + esc(doc.desc) + '">' + esc(doc.glyph) + " " + esc(doc.name) + "</span></p>" : "")
        + '<div class="offer-meta">'
        + '<span class="pay-line">' + money(o.pay) + "</span>"
        + '<span class="chip" title="Salvage rights">☤ salvage ' + o.salvagePct + "%</span>"
        + '<span class="chip">⏱ ' + o.duration + " days</span>"
        + '<span class="chip">⚔ vs ' + esc(o.targetName.split(" ")[0]) + "</span>"
        + (o.rivalInterest ? '<span class="chip rival-chip" title="A rival outfit is eyeing this contract — win it and you cost them standing">◆ rival eyeing</span>' : "")
        + locChip
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

  /* ============================ WORLD ============================ */
  function ownerColor(fid) {
    const f = M.factionById(fid);
    return f && f.color ? f.color : "#6b7280";
  }
  function ownerName(fid) {
    const f = M.factionById(fid);
    return f ? f.name : "Independent";
  }
  function ownerGlyph(fid) {
    const f = M.factionById(fid);
    return f ? f.glyph : "○";
  }
  function renderWorld(company) {
    const w = M.ensureWorld(company);
    const loc = company.location ? M.worldSystemById(company, company.location) : null;
    const offersBySys = {};
    for (const o of company.offers) if (o.systemId) offersBySys[o.systemId] = (offersBySys[o.systemId] || 0) + 1;
    const hot = M.worldHotspots(company);
    const hotCount = {};
    for (const h of hot) hotCount[h.id] = true;
    let nodes = "";
    for (const s of w.systems) {
      const cls = ["world-node"];
      if (s.hub) cls.push("hub");
      if (s.clanHome) cls.push("clanhome");
      if (s.heat > 0) cls.push("hot");
      if (s.contested) cls.push("contested");
      if (loc && loc.id === s.id) cls.push("mine");
      const labelWorthy = s.hub || s.clanHome || s.heat > 0 || (loc && loc.id === s.id) || (offersBySys[s.id] || 0) > 0;
      if (labelWorthy) cls.push("lbl");
      const nCont = offersBySys[s.id] || 0;
      nodes += '<button class="' + cls.join(" ") + '" style="left:' + s.x + "%;top:" + s.y + '%;--fcol:' + esc(ownerColor(s.owner)) + '" data-bm="world-system" data-system="' + s.id + '" title="' + esc(s.name + " — " + ownerName(s.owner)) + '">'
        + '<span class="wn-dot"></span>'
        + (s.hub ? '<span class="wn-hub" title="Trade hub">◈</span>' : "")
        + (s.heat > 0 ? '<span class="wn-heat" title="Border heat">' + s.heat + "</span>" : "")
        + (nCont ? '<span class="wn-contract" title="' + nCont + ' contract' + (nCont > 1 ? "s" : "") + ' available here">⚔' + nCont + "</span>" : "")
        + (labelWorthy ? '<span class="wn-label">' + esc(s.name) + "</span>" : "")
        + "</button>";
    }
    const owners = {};
    for (const s of w.systems) owners[s.owner] = (owners[s.owner] || 0) + 1;
    const ownerList = Object.keys(owners).map((id) => ({ id: id, n: owners[id] }));
    ownerList.sort((a, b) => b.n - a.n);
    let legend = "";
    for (const o of ownerList) {
      legend += '<span class="world-leg-item"><span class="world-leg-dot" style="background:' + esc(ownerColor(o.id)) + '"></span>' + esc(ownerGlyph(o.id)) + " " + esc(ownerName(o.id)) + " <b>" + o.n + "</b></span>";
    }
    let hotRows = "";
    for (const s of hot.slice(0, 8)) {
      const att = s.attacker ? ownerName(s.attacker) : null;
      const nCont = offersBySys[s.id] || 0;
      hotRows += '<div class="world-hot-row" data-bm="world-system" data-system="' + s.id + '">'
        + '<span class="whr-dot" style="background:' + esc(ownerColor(s.owner)) + '"></span>'
        + '<span class="whr-name">' + esc(s.name) + "</span>"
        + '<span class="whr-own">' + (att ? esc(ownerName(s.owner)) + " ⚔ " + esc(att) : esc(ownerName(s.owner))) + "</span>"
        + '<span class="whr-bar">' + barsHtml(s.control / 100, "ctrl") + "</span>"
        + '<span class="whr-heat" title="Border heat">' + (s.heat > 0 ? "🔥" + s.heat : "—") + "</span>"
        + '<span class="whr-cont">' + (nCont ? nCont + " ⚔" : "—") + "</span>"
        + "</div>";
    }
    if (!hotRows) hotRows = '<p class="muted small">The borders are quiet this week. Fronts flare as powers test each other — check back after advancing a week.</p>';
    const t = company.transit;
    let station;
    if (t) station = '<div class="world-here"><b>In transit</b> to ' + esc(t.toName || t.to) + " — " + Math.max(0, t.weeksLeft) + " week" + (t.weeksLeft === 1 ? "" : "s") + " to arrival</div>";
    else if (loc) station = '<div class="world-here">Current station: <b>' + esc(loc.name) + "</b> — " + esc(ownerName(loc.owner)) + "</div>";
    else station = '<div class="world-here">Current station: unknown</div>';
    const fuelLine = '<div class="world-fuel" title="Jump fuel — spent travelling between systems">⛽ Fuel ' + Math.round(company.fuel || 0) + "/100" + barsHtml((company.fuel || 0) / 100, "fuel") + "</div>";
    const mine = station + fuelLine;
    return '<div class="screen-head"><div><h2>Known Space</h2><p class="lede">The Inner Sphere shifts week to week as the Great Houses, Clans and Periphery powers press their borders. Hot systems draw mercenary work — and pay a premium — but the fighting out there is heavier. Contracts on the board are tied to the worlds below.</p></div>'
      + '<button class="btn btn-ghost" data-bm="advance">Advance week</button></div>'
      + '<div class="world-wrap">'
      + '<div class="world-map">' + nodes + "</div>"
      + '<div class="card world-side">'
      + '<h3 class="card-title">Powers this era</h3><div class="world-legend">' + legend + "</div>"
      + mine
      + '</div></div>'
      + '<div class="card" style="margin-top:16px"><h3 class="card-title">Flashpoints</h3>'
      + '<div class="world-hot-head"><span></span><span>System</span><span>Control</span><span></span><span>Heat</span><span>Work</span></div>'
      + '<div class="world-hot-list">' + hotRows + "</div></div>";
  }

  function travelBanner(company, sysId) {
    const sys = M.worldSystemById(company, sysId);
    if (!sys) return "";
    if (company.transit) return '<div class="world-travel transit"><span class="chip tr-warn">✈ In transit to ' + esc(company.transit.toName || company.transit.to) + " — " + Math.max(0, company.transit.weeksLeft) + " wk out</span></div>";
    if (company.location === sys.id) return '<div class="world-travel"><span class="chip tr-pos">◎ Company is on station here</span></div>';
    const q = M.travelQuote(company, sys.id);
    if (!q.ok) return "";
    return '<div class="world-travel"><span class="muted small">Transit:</span> <span class="chip">✈ ' + q.weeks + " week" + (q.weeks > 1 ? "s" : "") + " · " + q.fuel + " fuel</span>"
      + '<button class="btn btn-sm ' + (q.canFuel ? "btn-primary" : "") + '" data-bm="travel" data-system="' + sys.id + '"' + (q.canFuel ? "" : " disabled") + ">" + (q.canFuel ? "Jump here" : "Low fuel (" + Math.round(company.fuel || 0) + "/" + q.fuel + ")") + "</button></div>";
  }

  function renderWorldSystem(company, sys) {
    if (!sys) return '<p class="lede">Unknown system.</p>';
    const offers = company.offers.filter((o) => o.systemId === sys.id);
    let offerHtml = "";
    if (offers.length) {
      offerHtml = '<div class="world-sys-offers">' + offers.map((o) => '<div class="world-sys-offer"><span class="faction-badge" style="background:' + esc(ownerColor(o.factionId)) + '">' + esc(o.glyph) + '</span><div><b>' + esc(o.missionName) + '</b> <span class="muted">for ' + esc(o.employer) + '</span><div class="muted small">' + money(o.pay) + " · threat " + skulls(o.threat) + " · vs " + esc(o.targetName) + "</div></div>"
        + '<button class="btn btn-sm btn-primary" data-bm="deploy-modal" data-offer="' + o.id + '">Brief</button></div>').join("") + "</div>";
    } else offerHtml = '<p class="muted small">No contracts on the board are tied to this world right now.</p>';
    const att = sys.attacker ? ownerName(sys.attacker) : null;
    return '<div class="deploy"><div class="screen-head"><div><h2>' + esc(sys.name) + "</h2>"
      + '<p class="lede">' + esc(ownerGlyph(sys.owner)) + " Held by " + esc(ownerName(sys.owner)) + " · " + esc(M.worldControlLabel(sys)) + "</p></div>"
      + '<button class="btn btn-ghost" data-bm="close-modal">Back</button></div>'
      + '<div class="grid-2col"><div class="card">'
      + '<div class="world-sys-stat"><span>Owner</span><b style="color:' + esc(ownerColor(sys.owner)) + '">' + esc(ownerGlyph(sys.owner)) + " " + esc(ownerName(sys.owner)) + "</b></div>"
      + '<div class="world-sys-stat"><span>Control</span><b>' + sys.control + "%</b>" + barsHtml(sys.control / 100, "ctrl") + "</div>"
      + (att ? '<div class="world-sys-stat"><span>Attacker</span><b style="color:' + esc(ownerColor(sys.attacker)) + '">' + esc(ownerGlyph(sys.attacker)) + " " + esc(att) + "</b></div>" : "")
      + '<div class="world-sys-stat"><span>Status</span><b>' + esc(M.worldControlLabel(sys)) + "</b></div>"
      + '<div class="world-sys-stat"><span>Border heat</span><b>' + (sys.heat > 0 ? "🔥 " + sys.heat : "quiet") + "</b></div>"
      + (sys.hub ? '<p class="muted small">A major trade hub — hiring halls and brokers cluster here.</p>' : "")
      + travelBanner(company, sys.id)
      + "</div>"
      + '<div class="card"><h3 class="card-title">Contracts here</h3>' + offerHtml + "</div></div></div>";
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
        + '<div class="roster-stats">' + pStatus(p) + " · G " + skillCell(p, p.gunnery, M.effGunnery(p)) + "/P " + skillCell(p, p.piloting, M.effPiloting(p)) + " · " + esc(M.pilotTier(p)) + " · XP " + p.xp + "/" + M.SKILL_XP + " · " + fmtC(p.salary) + "/wk</div>"
        + '<div class="roster-sub">' + assignTxt + " · " + barsHtml(p.morale / 100, "morale") + fatigueChip(p) + bondChip(company, p) + "</div>"
        + "</div>"
        + '<div class="roster-actions">'
        + '<button class="btn btn-sm btn-ghost" data-bm="dossier" data-person="' + p.id + '">Dossier</button>'
        + '<button class="btn btn-sm btn-ghost" data-bm="fire" data-person="' + p.id + '">Release</button>'
        + "</div></div>";
    };
    const recruitLine = (p) => {
      const stats = p.role === "pilot" ? "Gunnery " + p.gunnery + " · Piloting " + p.piloting : "Skill " + p.skill + "/10";
      const tier = M.pilotTier(p);
      const fee = p.asking || 0;
      return '<div class="roster-item recruit-item">' + portraitSlot(p, "", false)
        + '<div class="roster-body"><div class="roster-name">' + esc(p.name) + ' <span class="callsign">"' + esc(p.callsign) + '"</span></div>'
        + '<div class="roster-sub muted">' + esc(String(p.role).toUpperCase()) + " · " + esc(p.career) + " · " + esc(p.origin) + " · " + (p.age || "?") + " yrs</div>"
        + '<div class="trait-row">' + traitChips(p) + '<span class="chip tr-warn" title="Scout report">' + esc(p.repLabel || "") + "</span></div>"
        + '<div class="roster-stats">' + stats + " · " + esc(tier) + " · asking <b>" + fmtC(fee) + "</b></div>"
        + '<div class="roster-sub"><i class="muted">"' + esc(p.quirk) + '."</i></div></div>'
        + '<div class="roster-actions"><button class="btn btn-sm btn-primary" data-bm="sign" data-recruit="' + p.id + '"' + (company.funds < fee ? " disabled" : "") + ">Sign</button></div></div>";
    };
    const recruits = company.recruits || [];
    let html = '<div class="screen-head"><div><h2>Personnel</h2><p class="lede">The people who keep the company running — and their quirks, vices and talents. Each person gets their own AI portrait — click the ✦ on a card, or paint them all at once.</p></div>'
      + '<div class="btn-row">'
      + '<button class="btn btn-sm btn-ghost" data-bm="portrait-all">Generate all portraits</button>'
      + '<span class="chip portrait-progress" id="portraitProgress" hidden></span>'
      + '<button class="btn btn-sm btn-ghost" data-bm="recruit-refresh">' + (recruits.length ? "Refresh market (" + fmtC(5000) + ")" : "Pull a fresh pool (free)") + "</button></div></div>"
      + '<div class="card roster-card"><h3 class="card-title">Recruitment market (' + recruits.length + ")</h3>"
      + '<p class="lede" style="margin-top:0">A rotating pool of hireable pilots and staff, with scout reports and asking fees. New candidates appear each week — or pay to pull a fresh pool now. Stronger hands cost more.</p>'
      + (recruits.length ? '<div class="roster-grid">' + recruits.map(recruitLine).join("") + "</div>" : '<p class="muted">No candidates this week. Refresh to pull a new pool.</p>')
      + "</div>"
      + '<div style="height:16px"></div>'
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
    if (!bonds.length) return '<p class="muted small">No bonds on file yet — keeps to themselves. Deploying pilots together forges bonds and grudges.</p>';
    const items = bonds.map(({ person: q, bond }) => {
      const t = M.BOND_TYPES[bond.type];
      const tone = t ? t.tone : "neu";
      const toneTxt = tone === "pos" ? "tr-pos" : tone === "neg" ? "tr-neg" : "tr-warn";
      const drops = isFinite(bond.drops) ? bond.drops : 0;
      const s = M.bondStrength(bond);
      const eff = Math.round((tone === "neg" ? 0.028 : 0.022) * s * 100);
      return '<span class="chip ' + toneTxt + '" title="' + esc(t ? t.desc : "") + '">' + esc(q.callsign) + " — " + esc(M.bondLabel(bond)) + " · wk " + bond.sinceWeek + " · " + drops + " drop" + (drops === 1 ? "" : "s") + " · " + (tone === "neg" ? "-" : "+") + eff + "%</span>";
    });
    return '<p class="muted small">Bonds (shaped by shared deployments):</p><div class="wep-row" style="margin-top:6px">' + items.join("") + "</div>";
  }

  function bondChip(company, p) {
    const bonds = M.findBonds(company, p);
    if (!bonds.length) return "";
    let pos = 0, neg = 0;
    for (const x of bonds) { const t = M.BOND_TYPES[x.bond.type]; if (t && t.tone === "neg") neg++; else pos++; }
    const parts = [];
    if (pos) parts.push("✦" + pos);
    if (neg) parts.push("⚔" + neg);
    const tone = neg && !pos ? "tr-neg" : neg ? "tr-warn" : "tr-pos";
    return '<span class="chip ' + tone + '" title="' + pos + ' positive bond(s), ' + neg + ' feud(s) — bonds shape lance accuracy">' + parts.join(" ") + "</span>";
  }

  function renderTraining(company, person) {
    if (person.status === "training" && person.training) {
      const c = M.COURSES[person.training.courseId];
      const wk = person.training.weeksLeft;
      return '<div class="train-block"><span class="muted small">In training — <b>' + esc(c ? c.name : "course") + "</b> · " + wk + " week" + (wk === 1 ? "" : "s") + " remaining</span>"
        + '<button class="btn btn-sm btn-ghost" data-bm="cancel-train" data-person="' + person.id + '">Cancel (50% refund)</button></div>';
    }
    const ids = M.coursesFor(person.role);
    if (!ids.length) return "";
    const rows = ids.map((id) => {
      const c = M.COURSES[id];
      const blocked = M.trainingBlocked(person, id);
      const cost = M.trainingCost(company, person, id);
      const afford = company.funds >= cost;
      const disabled = !!blocked || !afford;
      const title = blocked || (!afford ? "Not enough C-bills for tuition." : c.desc);
      return '<div class="train-row"' + (disabled ? ' title="' + esc(title) + '"' : "") + '>'
        + '<span class="train-name"><b>' + esc(c.name) + '</b> <span class="muted small">' + c.weeks + "w · " + esc(c.desc) + "</span></span>"
        + '<span class="train-cost">' + fmtC(cost) + "</span>"
        + '<button class="btn btn-sm ' + (disabled ? "btn-ghost" : "btn-primary") + '" data-bm="train" data-person="' + person.id + '" data-course="' + id + '"' + (disabled ? " disabled" : "") + ">Enroll</button></div>";
    });
    return '<div class="train-block"><span class="muted small">Training courses (unavailable while enrolled):</span><div class="train-list">' + rows.join("") + "</div></div>";
  }

  function careerBio(company, p) {
    const s = M.careerStats(p);
    const first = p.name.split(" ")[0];
    const bits = [];
    bits.push(cap(first) + " signed on with " + company.name + " in week " + (p.hiredWeek || 1));
    if (s.missions) {
      let m = "has flown " + s.missions + " contract" + (s.missions === 1 ? "" : "s") + " since then";
      const decided = s.victories + s.defeats;
      if (decided) m += " (" + s.victories + "W / " + s.defeats + "L)";
      bits.push(m);
    }
    if (s.kills) bits.push("claiming " + s.kills + " confirmed kill" + (s.kills === 1 ? "" : "s"));
    if (s.wounds) bits.push("wounded " + s.wounds + " time" + (s.wounds === 1 ? "" : "s") + " in the line of duty");
    if (!s.missions && !s.kills && !s.wounds) bits.push("and is waiting for a first deployment");
    let out = bits.join(", ") + ".";
    const bond = M.findBonds(company, p);
    if (bond.length) {
      const names = bond.slice(0, 2).map((x) => x.person.callsign).join(" and ");
      out += " Known in the bays for " + (bond[0].bond.type ? M.BOND_TYPES[bond[0].bond.type].tone === "neg" ? "a running feud with " : "a steady bond with " : "working closely alongside ") + names + ".";
    }
    return out;
  }
  function serviceLogHtml(p) {
    const s = M.careerStats(p);
    if (!s.log.length) return '<p class="muted small">No entries yet — this file fills as the contracts are fought.</p>';
    const rows = s.log.slice(0, 14).map((e) => {
      const tone = e.kind === "win" ? "tr-pos" : e.kind === "loss" ? "tr-neg" : e.kind === "gain" ? "tr-warn" : "";
      return '<div class="slog-row ' + tone + '"><span class="slog-wk">Wk ' + e.week + '</span><span class="slog-txt">' + esc(e.text) + "</span></div>";
    }).join("");
    return '<div class="service-log">' + rows + (s.log.length > 14 ? '<p class="muted small">…and ' + (s.log.length - 14) + " earlier entries.</p>" : "") + "</div>";
  }
  function serviceRecord(company, p) {
    const s = M.careerStats(p);
    const isPilot = p.role === "pilot";
    const cells = [
      ["Contracts", isFinite(s.missions) ? s.missions : 0, "Missions deployed to"],
      ["Kills", s.kills, "Confirmed enemy machines destroyed"],
      ["Victories", s.victories, "Contracts won"],
      ["Defeats", s.defeats, "Contracts lost"],
      ["Wounds", s.wounds, "Times injured in action"],
      ["Drops", s.drops, "Total combat deployments"]
    ];
    const grid = cells.map((c) => '<div class="career-stat" title="' + esc(c[2]) + '"><b>' + c[1] + "</b><span>" + esc(c[0]) + "</span></div>").join("");
    return '<div class="dossier-service"><h4 class="service-head">Service record</h4>'
      + '<p class="bio">' + esc(careerBio(company, p)) + "</p>"
      + '<div class="career-grid">' + grid + "</div>"
      + (s.winRate === null ? "" : '<p class="muted small">Career win rate ' + s.winRate + "% across " + (s.victories + s.defeats) + " decided engagement" + (s.victories + s.defeats === 1 ? "" : "s") + ".</p>")
      + '<h4 class="service-head">Career log</h4>' + serviceLogHtml(p) + "</div>";
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
    const xp = M.xpInfo(person);
    const fat = Math.round(person.fatigue || 0);
    const wounded = M.injuryPenalty(person) > 0;
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
      + (isPilot ? "Gunnery <b>" + skillCell(person, person.gunnery, M.effGunnery(person)) + "</b> · Piloting <b>" + skillCell(person, person.piloting, M.effPiloting(person)) + "</b><br>" : "Skill <b>" + (person.skill || 0) + "</b><br>")
      + "Salary " + fmtC(person.salary) + "/wk · Morale " + person.morale + "%"
      + (wounded ? ' · <span class="skill-hurt">wounded — skills reduced</span>' : "") + "</div>"
      + '<div class="dev-block"><span class="muted small">' + esc(xp.tier) + " · " + xp.cur + "/" + xp.need + " XP to next skill-up · " + xp.total + " career XP · Fatigue " + fat + "%</span>"
      + '<div class="dev-bars"><span class="dev-label muted">XP</span>' + barsHtml(xp.pct, "xp")
      + '<span class="dev-label muted">Fatigue</span>' + barsHtml(fat / 100, fat >= 75 ? "bad" : fat >= 50 ? "warn" : "ok") + "</div></div>"
      + '<div style="height:12px"></div>'
      + serviceRecord(company, person)
      + '<div style="height:12px"></div>'
      + assign
      + renderTraining(company, person)
      + "</div></div>";
  }

  /* ============================ MECHBAY ============================ */
  function renderMechbay(company) {
    const supplies = (company.supplies && company.supplies.repair) || 0;
    const bays = M.repairBays(company);
    const repairing = company.units.filter((u) => u.status === "repairing");
    let queue = "";
    if (repairing.length) {
      const rows = repairing.map((u) => {
        const active = !u.repairQueued;
        return '<div class="rq-row"><span class="rq-name">' + esc(u.name) + "</span>"
          + '<span class="chip ' + (active ? "tr-pos" : "tr-warn") + '">' + (active ? "in the bay" : "queued") + "</span>"
          + '<span class="muted small">' + (active ? "~" + M.repairWeeksLeft(company, u) + " wk to go" : "waiting for a free bay") + "</span>"
          + '<button class="btn btn-sm btn-ghost" data-bm="cancel-repair" data-unit="' + u.id + '">Cancel</button></div>';
      }).join("");
      queue = '<div class="card repair-queue"><h3 class="card-title">Repair queue · ' + repairing.length + " job" + (repairing.length > 1 ? "s" : "") + "</h3>"
        + '<p class="muted small">' + bays + " repair bay" + (bays > 1 ? "s" : "") + " on line · " + esc(M.repairQuality(company).label) + ".</p>" + rows + "</div>";
    }
    let html = '<div class="screen-head"><div><h2>Mechbay</h2><p class="lede">Repair, refit, sell and rebuild your BattleMechs. Repairs consume repair crates and any specific weapon parts needed; techs speed the work and improve its quality.</p></div>'
      + '<div class="btn-row"><span class="chip" title="Repair crates in stock — consumed by repairs">⚒ ' + supplies + " repair crate" + (supplies === 1 ? "" : "s") + "</span>"
      + '<button class="btn btn-ghost" data-bm="nav" data-screen="market">Buy mechs &amp; parts</button></div></div>'
      + queue + '<div class="bay-grid">';
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
    const ready = M.repairReadiness(company, u);
    const canRepair = ready.ok && company.funds >= est.cost && (est.damagePct > 0.001 || u.status === "destroyed");
    const busy = u.status === "repairing";
    const dmgNote = est.damagePct < 0.001 && u.status !== "destroyed" ? '<span class="chip ok-chip">pristine</span>' : "";
    const repairBlock = busy
      ? '<div class="bay-status"><span class="chip ' + (u.repairQueued ? "tr-warn" : "tr-pos") + '">' + (u.repairQueued ? "queued — waiting for a bay" : "in the bays — " + M.repairWeeksLeft(company, u) + "wk est") + " · " + (u.repairSupply || 0) + " crates committed</span> <button class='btn btn-sm btn-ghost' data-bm='cancel-repair' data-unit='" + u.id + "'>Cancel (50% refund)</button></div>"
      : est.damagePct > 0.001 || u.status === "destroyed"
        ? '<div class="bay-status"><span class="chip tr-warn">' + (u.status === "destroyed" ? "Wrecked — full rebuild" : "needs repairs") + ' · ' + fmtC(est.cost) + (est.days > 1 ? " · ~" + est.days + "d in bay" : "") + " · " + est.supply + " crate" + (est.supply > 1 ? "s" : "") + "</span>"
        + '<button class="btn btn-sm ' + (canRepair ? "btn-primary" : "") + '" data-bm="repair" data-unit="' + u.id + '" data-mode="std"' + (canRepair ? "" : " disabled") + ">Repair</button>"
        + '<button class="btn btn-sm btn-ghost" data-bm="repair" data-unit="' + u.id + '" data-mode="rush" ' + (ready.ok && company.funds >= est.cost * 2 ? "" : "disabled") + ">Rush ×2</button>"
        + (est.parts.length ? '<div class="repair-parts muted small">Parts: ' + est.parts.map((p) => '<span class="chip ' + (p.ok ? "ok-chip" : "tr-neg") + '">' + esc(p.name) + " ×" + p.qty + " (have " + p.have + ")</span>").join("") + "</div>" : "")
        + (!ready.ok ? '<div class="repair-missing muted small">Missing: ' + esc(ready.missing.join(", ")) + " — buy repair crates on the market or salvage parts</div>" : "")
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
      + '<div class="roster-sub muted">' + esc(clsOf(u)) + " · " + u.ton + "t · " + (u.tech === "Clan" ? "Clan" : "Inner Sphere") + " tech " + roleBadge(u) + "</div></div>"
      + '<div class="mech-side">' + chip(rd.toUpperCase(), rdCls) + chip(originLabel(u), "muted-chip") + dmgNote + "</div></div>"
      + '<div class="mech-hp"><span class="muted small">Hull ' + hpTxt + "</span>" + barsHtml(hp, hp > 0.5 ? "ok" : hp > 0.25 ? "warn" : "bad") + "</div>"
      + '<div class="wep-row">' + (weps || '<span class="muted small">no weapons</span>') + "</div>"
      + compRow(u)
      + (u.repairNote ? '<div class="repair-note chip tr-warn" title="A lasting flaw from the repair job">' + esc(u.repairNote) + "</div>" : "")
      + '<div class="mech-pilot">' + pilotCtl + "</div>"
      + (repairBlock || "")
      + '<div class="mech-actions btn-row">'
      + (busy ? "" : '<button class="btn btn-sm btn-ghost" data-bm="refit" data-unit="' + u.id + '">Refit</button>')
      + (busy ? "" : '<button class="btn btn-sm btn-ghost" data-bm="sell-unit" data-unit="' + u.id + '">Sell</button>')
      + "</div></div>";
  }

  function renderRefit(company, u) {
    const parts = Object.keys(company.partsInv).filter((w) => company.partsInv[w] > 0 && D.WMAP[w]);
    const ord = M.ordnanceProfile(u);
    const dmg = M.sumWeaponDmg(u);
    const power = M.unitPower(u);
    const cells = M.hardpointMap(u);
    const overheat = ord.alphaHeat > ord.sink;
    const canEdit = u.status === "ok";
    const head = '<div class="refit-stats">'
      + chip("firepower " + dmg, "muted-chip")
      + chip("alpha heat " + ord.alphaHeat + " / " + ord.sink + " sinks", overheat ? "tr-neg" : "tr-pos")
      + chip("power " + power, "muted-chip")
      + (canEdit ? "" : chip("in the bays — refit locked", "tr-warn"))
      + "</div>";
    const hpGrid = M.HARDPOINT_LOCS.map((l) => {
      const c = cells[l];
      const over = c.used > c.cap;
      const mounted = c.mounted.map((m) => {
        const idx = u.weapons.indexOf(m.wp);
        let move = "";
        if (canEdit) {
          const opts = M.HARDPOINT_LOCS.map((to) => {
            if (to === l) return '<option value="' + to + '" selected>' + esc(M.HARDPOINT_NAMES[to]) + "</option>";
            return M.hardpointFit(u, to, m.wp.id).ok ? '<option value="' + to + '">' + esc(M.HARDPOINT_NAMES[to]) + "</option>" : "";
          }).join("");
          move = '<select class="input hp-move" data-bm="refitmove" data-unit="' + u.id + '" data-wi="' + idx + '" title="Move to another hardpoint">' + opts + "</select>";
        }
        const strip = canEdit && m.wp.state === "ok" ? '<button class="x-btn" data-bm="strip" data-unit="' + u.id + '" data-wi="' + idx + '" title="Remove to parts inventory">✕</button>' : "";
        return '<div class="hp-wep' + (m.wp.state === "ok" ? "" : " dead") + '"><span class="hp-wep-name">' + esc(m.name) + (m.wp.state === "ok" ? "" : " ✕") + "</span>" + move + strip + "</div>";
      }).join("") || '<span class="muted small">empty</span>';
      return '<div class="hp-cell' + (over ? " over" : "") + '"><div class="hp-head"><span class="hp-name">' + esc(c.name) + '</span><span class="hp-slots">' + c.used + "/" + c.cap + ' slots</span></div><div class="hp-weapons">' + mounted + "</div></div>";
    }).join("");
    const rows = parts.map((w) => {
      const pw = D.WMAP[w];
      const preview = M.refitPreview(u, w);
      const brokenMatch = u.weapons.find((wp) => wp.state === "destroyed" && wp.id === w);
      const fee = M.installCost(w);
      const afford = company.funds >= fee;
      if (brokenMatch) {
        return '<div class="refit-row"><span class="refit-part"><b>' + esc(pw.name) + "</b> ×" + company.partsInv[w] + ' <span class="muted small">' + esc(pw.cls) + " · " + pw.dmg + " dmg · " + M.weaponSlots(pw) + " slots</span></span>"
          + '<span class="refit-preview muted small">replaces a destroyed mount in place</span>'
          + '<button class="btn btn-sm ' + (canEdit && afford ? "btn-primary" : "btn-ghost") + '" data-bm="install" data-unit="' + u.id + '" data-wid="' + w + '"' + (canEdit && afford ? "" : " disabled") + ">Replace</button></div>";
      }
      const free = M.freeHardpoints(u, w);
      const opts = free.map((l) => '<option value="' + l + '" data-free="' + (cells[l].cap - cells[l].used - M.weaponSlots(pw)) + '">' + esc(M.HARDPOINT_NAMES[l]) + "</option>").join("");
      const installable = canEdit && free.length && afford;
      const sel = free.length
        ? '<select class="input refit-loc" data-bm="refitloc" data-unit="' + u.id + '" data-wid="' + w + '" data-before-dmg="' + preview.before.dmg + '" data-before-heat="' + preview.before.heat + '" data-before-power="' + preview.before.power + '" data-sink="' + preview.before.sink + '" data-dmg="' + preview.dmg + '" data-heat="' + preview.heat + '" data-power="' + preview.power + '">' + opts + "</select>"
        : '<span class="muted small">no free hardpoint</span>';
      return '<div class="refit-row"><span class="refit-part"><b>' + esc(pw.name) + "</b> ×" + company.partsInv[w] + ' <span class="muted small">' + esc(pw.cls) + " · " + pw.dmg + " dmg · " + M.weaponSlots(pw) + " slots · +" + preview.heat + " heat</span></span>"
        + sel
        + '<span class="refit-preview muted small"></span>'
        + '<button class="btn btn-sm ' + (installable ? "btn-primary" : "btn-ghost") + '" data-bm="install" data-unit="' + u.id + '" data-wid="' + w + '"' + (installable ? "" : " disabled") + ">Install</button></div>";
    }).join("");
    return '<div class="refit">'
      + "<h3>Refit bay — " + esc(u.name) + ' <span class="muted small">' + esc(clsOf(u)) + " · " + u.ton + "t</span></h3>"
      + "<p class=\"muted small\">Assign weapons to hardpoints. Each location holds a limited number of slots — energy 1, missile 2, ballistic 3. Installing costs 25% of the weapon's value in labour, and changes preview live before you commit.</p>"
      + head
      + '<div class="hardpoint-grid">' + hpGrid + "</div>"
      + '<div class="refit-parts"><b>Parts inventory</b>' + (rows || '<p class="muted small">No compatible parts in inventory. Salvage or buy some.</p>') + "</div>"
      + "</div>";
  }

  function refitPreviewText(sel) {
    const row = sel.closest(".refit-row");
    if (!row) return;
    const out = row.querySelector(".refit-preview");
    if (!out) return;
    const bd = Number(sel.dataset.beforeDmg), bh = Number(sel.dataset.beforeHeat), bk = Number(sel.dataset.beforePower);
    const dd = Number(sel.dataset.dmg), dh = Number(sel.dataset.heat), dp = Number(sel.dataset.power), sink = Number(sel.dataset.sink);
    const opt = sel.selectedOptions && sel.selectedOptions[0];
    const free = opt ? Number(opt.dataset.free) : NaN;
    const heatAfter = bh + dh;
    out.innerHTML = "in <b>" + esc(opt ? opt.textContent : "—") + "</b> (" + free + " slot" + (free === 1 ? "" : "s") + " free): firepower <b>" + bd + "→" + (bd + dd) + "</b>, heat <b>" + bh + "→" + heatAfter + "</b> vs " + sink + " sinks "
      + (heatAfter > sink ? '<span class="tr-neg">(runs hot)</span>' : '<span class="tr-pos">(runs cool)</span>') + ", power <b>" + bk + "→" + (bk + dp) + "</b>";
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
      } else if (it.kind === "supply") {
        parts += '<div class="stock-row card"><div class="stock-body"><div class="stock-name">⚒ Repair crates ×' + it.qty + "</div>"
          + '<div class="roster-sub muted">Armour, structure and component stock — consumed by mechbay repairs</div></div>'
          + '<div class="stock-meta"><span class="pay-line">' + money(it.price) + "</span>"
          + '<button class="btn btn-sm btn-ghost" data-bm="buy" data-item="' + it.id + '"' + (company.funds >= it.price ? "" : " disabled") + ">Buy</button></div></div>";
      } else if (it.kind === "fuel") {
        parts += '<div class="stock-row card"><div class="stock-body"><div class="stock-name">⛽ DropShip fuel ×' + it.qty + "</div>"
          + '<div class="roster-sub muted">Jump fuel — one full tank (100) is consumed by long transits between systems</div></div>'
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
    const crates = (company.supplies && company.supplies.repair) || 0;
    const cratePrice = M.supplyPrice(company);
    invParts += "<h3 class='card-title' style='margin-top:22px'>Repair depot</h3>"
      + '<div class="card repair-depot"><div><b>⚒ Repair crates in stock: ' + crates + "</b>"
      + '<div class="muted small">Consumed when the mechbay repairs armour, structure, weapons and internals. Buy in lots of 10 at ' + fmtC(cratePrice) + " each.</div>"
      + '<div class="muted small" style="margin-top:6px">⛽ DropShip fuel: <b>' + Math.round(company.fuel || 0) + "/100</b> — burned making jumps between systems.</div></div>"
      + '<div class="btn-row">'
      + '<button class="btn btn-sm btn-ghost" data-bm="buy-supplies" data-qty="10"' + (company.funds >= cratePrice * 10 ? "" : " disabled") + ">Buy 10 (" + fmtC(cratePrice * 10) + ")</button>"
      + '<button class="btn btn-sm btn-ghost" data-bm="buy-supplies" data-qty="25"' + (company.funds >= cratePrice * 25 ? "" : " disabled") + ">Buy 25 (" + fmtC(cratePrice * 25) + ")</button>"
      + "</div></div>";
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
      + invParts
      + renderInvestments(company);
  }

  function renderInvestments(company) {
    const offers = company.investmentOffers || [];
    const holdings = company.investments || [];
    const value = M.investmentValue(company);
    const income = M.weeklyInvestmentIncome(company);
    const offerRows = offers.map((o) => '<div class="stock-row card"><div class="stock-body"><div class="stock-name">' + esc((o.glyph || "") + " " + o.name) + "</div>"
      + '<div class="roster-sub muted">' + esc(o.blurb || "") + "</div></div>"
      + '<div class="stock-meta"><span class="chip" title="Weekly dividend yield">' + (o.yield * 100).toFixed(1) + "%/wk</span>"
      + '<span class="pay-line">' + money(o.price) + "</span>"
      + '<button class="btn btn-sm btn-primary" data-bm="invest-buy" data-offer="' + o.id + '"' + (company.funds >= o.price ? "" : " disabled") + ">Buy</button></div></div>").join("");
    const holdRows = holdings.map((h) => {
      const val = Math.round(h.units * h.price);
      const pl = val - h.invested;
      const plCls = pl >= 0 ? "ok" : "neg";
      return '<div class="rq-row"><span class="rq-name">' + esc((h.glyph || "") + " " + h.name) + " ×" + h.units + "</span>"
        + '<span class="muted small">' + fmtC(val) + ' · <span class="' + plCls + '">' + (pl >= 0 ? "+" : "") + fmtC(pl) + "</span> · " + fmtC(Math.round(h.units * h.price * h.yield)) + "/wk</span>"
        + '<button class="btn btn-sm btn-ghost" data-bm="invest-sell" data-holding="' + h.id + '">Sell ' + fmtC(val) + "</button></div>";
    }).join("");
    return "<h3 class='card-title' style='margin-top:22px'>Investment exchange</h3>"
      + '<div class="card"><div class="statline">Portfolio value <b>' + fmtC(value) + "</b> · passive income <b>" + fmtC(income) + "/wk</b>" + (holdings.length ? "" : " · no holdings yet") + "</div>"
      + '<p class="muted small">Late-game capital can be parked in bonds, landholds, stocks and ventures. Each pays a weekly dividend while its price drifts — riskier assets swing harder, and a 2% brokerage applies when you sell.</p>'
      + (holdings.length ? '<div class="repair-queue">' + holdRows + "</div>" : "")
      + "<h4 class='muted small' style='margin:12px 0 4px'>Offers this cycle</h4>"
      + '<div class="grid-2col">' + (offerRows || '<p class="muted small">No investment offers this cycle — advance a week.</p>') + "</div>"
      + "</div>";
  }

  /* ============================ SALVAGE ============================ */
  function renderSalvage(company) {
    const q = company.salvageQueue;
    const listings = company.salvageListings || [];
    const idx = M.salvageIndexOf(company);
    const idxPct = Math.round(idx * 100);
    const idxNote = idx >= 1.15 ? "Salvage is fetching top prices — a good week to sell or list." : idx <= 0.9 ? "The salvage market is soft; hold lots or broker for a premium." : "Steady demand for salvage on the local boards.";
    if (!q.length && !listings.length) {
      return '<div class="screen-head"><div><h2>Salvage Bay</h2><p class="lede">Salvage from your last operation is staged here.</p></div></div>'
        + '<p class="muted">Nothing staged right now. Win a contract and bring something back.</p>';
    }
    const scrapAll = q.filter((s) => s.kind === "scrap").reduce((a, s) => a + M.salvageInstantValue(company, s), 0);
    const rows = q.map((s) => {
      const instant = M.salvageInstantValue(company, s);
      const mq = M.salvageListQuote(company, s, "market");
      const bq = M.salvageListQuote(company, s, "broker");
      const listBtn = mq ? '<button class="btn btn-sm btn-ghost" data-bm="salvage" data-item="' + s.svId + '" data-action="list" title="Hold for a better price (~' + mq.weeks + ' wk)">List ' + fmtC(mq.expected) + "</button>" : "";
      const brokBtn = bq ? '<button class="btn btn-sm btn-ghost" data-bm="salvage" data-item="' + s.svId + '" data-action="broker" title="Broker to a dealer (~' + bq.weeks + ' wk, may haggle)">Broker ' + fmtC(bq.expected) + "</button>" : "";
      if (s.kind === "scrap") {
        return '<div class="card salvage-row"><span class="salv-ic">⚙</span><div class="salv-body"><b>' + esc(s.label) + "</b>"
          + '<div class="muted small">Salvage scrap — liquidate now, or list it for a better price</div></div>'
          + '<span class="pay-line">' + money(instant) + "</span>"
          + '<div class="btn-row"><button class="btn btn-sm btn-ghost" data-bm="salvage" data-item="' + s.svId + '" data-action="sell">Liquidate</button>' + listBtn + "</div></div>";
      }
      if (s.kind === "parts") {
        const names = s.parts.map((p) => esc(D.WMAP[p.wid] ? D.WMAP[p.wid].name : p.wid)).join(", ");
        return '<div class="card salvage-row"><span class="salv-ic">☄</span><div class="salv-body"><b>' + esc(s.label) + "</b>"
          + '<div class="muted small">' + names + "</div></div>"
          + '<span class="pay-line">' + money(instant) + "</span>"
          + '<div class="btn-row"><button class="btn btn-sm btn-ghost" data-bm="salvage" data-item="' + s.svId + '" data-action="keep">Keep parts</button>'
          + '<button class="btn btn-sm btn-ghost" data-bm="salvage" data-item="' + s.svId + '" data-action="sell">Sell ' + fmtC(instant) + "</button>" + listBtn + "</div></div>";
      }
      if (s.kind === "mech") {
        const mc = D.MECH_MAP[s.chassisId];
        if (!mc) return "";
        const restoreCost = Math.round(mc.cost * (0.35 + s.cond * 0.25) / 500) * 500;
        return '<div class="card salvage-row">' + avatarWrap(M.unitAvatar({ chassisId: s.chassisId, skin: "#4d5a3c", id: "s" }), "mech mini")
          + '<div class="salv-body"><b>' + esc(s.label) + "</b>"
          + '<div class="muted small">' + esc(clsOf(mc)) + " · recoverable hull (" + Math.round(s.cond * 100) + "% condition)</div></div>"
          + '<span class="pay-line">' + money(instant) + "</span>"
          + '<div class="btn-row"><button class="btn btn-sm btn-primary" data-bm="salvage" data-item="' + s.svId + '" data-action="restore"' + (company.funds >= restoreCost ? "" : " disabled") + ">Restore " + fmtC(restoreCost) + "</button>"
          + '<button class="btn btn-sm btn-ghost" data-bm="salvage" data-item="' + s.svId + '" data-action="sell">Sell hull</button>'
          + brokBtn
          + '<button class="btn btn-sm btn-ghost" data-bm="salvage" data-item="' + s.svId + '" data-action="scrap">Scrap</button></div></div>';
      }
      return "";
    }).join("");
    const listRows = listings.map((l) => {
      return '<div class="rq-row"><span class="rq-name">' + esc(l.label) + "</span>"
        + '<span class="chip ' + (l.mode === "broker" ? "tr-warn" : "") + '">' + (l.mode === "broker" ? "brokered" : "listed") + "</span>"
        + '<span class="muted small">asking ' + fmtC(l.ask) + " · ~" + Math.max(0, l.weeksLeft) + " wk left</span>"
        + '<button class="btn btn-sm btn-ghost" data-bm="salvage" data-action="cancel-listing" data-listing="' + l.id + '">Withdraw</button></div>';
    }).join("");
    const listingsHtml = listings.length ? '<div class="card repair-queue" style="margin-bottom:16px"><h3 class="card-title">Salvage market · ' + listings.length + " listing" + (listings.length > 1 ? "s" : "") + "</h3>"
      + '<p class="muted small">Lots held for a better price. The salvage index drifts each week, so a soft market can eat into the premium.</p>' + listRows + "</div>" : "";
    return '<div class="screen-head"><div><h2>Salvage Bay</h2><p class="lede">Salvage rights from the contract determine what your crews could legally haul off the field. Liquidate a lot now, list it on the salvage market for a premium, or broker a whole hull to a dealer.</p></div>'
      + '<div class="btn-row"><span class="chip" title="Weekly salvage price index — scales all salvage values">Salvage index ' + idxPct + "%</span>"
      + '<button class="btn btn-sm btn-ghost" data-bm="salvage" data-action="sellall">Liquidate all scrap (' + fmtC(scrapAll) + ")</button>"
      + '<button class="btn btn-sm btn-ghost" data-bm="salvage" data-action="sellparts">Sell all parts lots</button></div></div>'
      + '<p class="muted small" style="margin-top:-6px">' + esc(idxNote) + "</p>"
      + listingsHtml
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
    const oh = log.overhead || {};
    let maintSub = "base " + fmtC(log.baseUpkeep);
    if (log.techDiscount > 0) maintSub += " · <span class='ok'>−" + techPct + "%</span> " + log.techs + (log.techs === 1 ? " tech" : " techs");
    if (wearPct > 0) maintSub += " · <span class='neg'>+" + wearPct + "%</span> damaged internals";
    let rows = '<div class="log-row"><b>Payroll</b><span>' + fmtC(log.payroll) + "/wk</span></div>"
      + '<div class="log-sub muted small">' + log.headcount + " personnel — pilot <b>" + fmtC(log.byRole.pilot || 0) + "</b> · tech <b>" + fmtC(log.byRole.tech || 0) + "</b> · support <b>" + fmtC(log.byRole.support || 0) + "</b></div>"
      + '<div class="log-row"><b>Mech maintenance</b><span>' + fmtC(oh.maintenance || 0) + "/wk</span></div>"
      + '<div class="log-sub muted small">' + maintSub + "</div>";
    if (oh.transport) rows += '<div class="log-row"><b>DropShip lease &amp; transport</b><span>' + fmtC(oh.transport) + "/wk</span></div>"
      + '<div class="log-sub muted small">' + (oh.units || 0) + " machine" + ((oh.units || 0) === 1 ? "" : "s") + " under maintenance</div>";
    if (oh.ammo) rows += '<div class="log-row"><b>Ammo &amp; consumables resupply</b><span>' + fmtC(oh.ammo) + "/wk</span></div>";
    if (oh.medical) rows += '<div class="log-row"><b>Medical &amp; infirmary</b><span>' + fmtC(oh.medical) + "/wk</span></div>"
      + '<div class="log-sub muted small">' + (oh.injured || 0) + " injured · " + (oh.leave || 0) + " on leave</div>";
    if (oh.standing && oh.standing.amt > 0) rows += '<div class="log-row"><b>House logistics discount</b><span class="ok">−' + fmtC(oh.standing.amt) + "/wk</span></div>"
      + '<div class="log-sub muted small">−' + oh.standing.pct + "% maintenance &amp; ammo support from " + esc((oh.standing.names || []).join(", ")) + "</div>";
    rows += '<div class="log-row total"><b>Total burn</b><span>' + fmtC(log.total) + "/wk</span></div>";
    return '<div class="led-log">' + rows + "</div>";
  }
  function fmtWhen(ts) {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  function renderBackups() {
    const list = (window.BMG && window.BMG._backups) || [];
    if (!list.length) return '<p class="muted small" style="margin-top:12px">No snapshots yet — click <b>Save now</b> to capture one, or they build automatically as you play.</p>';
    return '<div class="backup-list">' + list.map((s) => {
      return '<div class="backup-row"><div class="backup-info">'
        + '<span class="backup-label">' + esc(s.label || "Snapshot") + "</span>"
        + '<span class="backup-meta muted">' + esc(s.name || "—") + " · Wk " + (s.week != null ? s.week : "?") + " · " + fmtC(s.funds || 0) + " · " + esc(fmtWhen(s.ts)) + "</span>"
        + '</div><div class="btn-row">'
        + '<button class="btn btn-sm btn-ghost" data-bm="restore" data-backup="' + esc(s.key) + '">Restore</button>'
        + '<button class="btn btn-sm btn-ghost" data-bm="delete-backup" data-backup="' + esc(s.key) + '" title="Delete snapshot">✕</button>'
        + "</div></div>";
    }).join("") + "</div>";
  }

  function renderCredit(company) {
    const loans = company.loans || [];
    const score = M.creditScore(company);
    const label = M.creditLabel(company);
    let loanRows = "";
    for (const l of loans) {
      loanRows += '<div class="rq-row"><span class="rq-name">' + esc((l.lenderGlyph || "") + " " + l.lender) + "</span>"
        + '<span class="muted small">' + fmtC(l.balance) + " owed · " + Math.round(l.rate * 100) + "%/wk" + (l.missed ? ' · <span class="neg">' + l.missed + " missed</span>" : "") + "</span>"
        + '<div class="btn-row"><button class="btn btn-sm btn-ghost" data-bm="loan-pay" data-loan="' + l.id + '">Pay ' + fmtC(l.minPayment) + "</button>"
        + '<button class="btn btn-sm btn-ghost" data-bm="loan-repay" data-loan="' + l.id + '"' + (company.funds >= l.balance ? "" : " disabled") + ">Clear " + fmtC(l.balance) + "</button></div></div>";
    }
    const offers = M.loanOffers(company).map((o) => {
      if (o.locked) return '<div class="rq-row"><span class="rq-name">' + esc((o.glyph || "") + " " + o.name) + '</span><span class="muted small">' + esc(o.reason) + "</span></div>";
      return '<div class="rq-row"><span class="rq-name">' + esc((o.glyph || "") + " " + o.name) + "</span>"
        + '<span class="muted small">up to ' + fmtC(o.principal) + " · " + Math.round(o.rate * 100) + "%/wk · " + (o.term ? o.term + " wk term" : "open-ended") + "</span>"
        + '<button class="btn btn-sm btn-primary" data-bm="take-credit" data-lender="' + o.id + '">Borrow ' + fmtC(o.principal) + "</button></div>";
    }).join("");
    return '<div class="card" style="margin-top:16px"><h3 class="card-title">Credit &amp; loans <span class="chip" title="Credit rating — a better score unlocks larger, cheaper loans">' + label + " (" + score + ")</span></h3>"
      + (loans.length ? '<div class="repair-queue">' + loanRows + "</div>" : '<p class="muted small">No outstanding debt. Lenders are willing to extend credit.</p>')
      + "<h4 class='muted small' style='margin:12px 0 4px'>Available credit</h4>"
      + '<div class="repair-queue">' + offers + "</div>"
      + '<p class="muted small">Interest capitalises weekly and a minimum payment is drawn automatically. A missed payment cuts your credit rating and reputation; three misses lets a lender seize a machine against the debt.</p>'
      + "</div>";
  }

  function rivalCard(company) {
    const r = M.ensureRival(company);
    const rr = M.rivalRating(company);
    const trait = M.rivalTrait(company);
    const our = Math.max(1, M.companyRating(company).power);
    return '<div class="card" style="margin-top:16px"><h3 class="card-title">Rival outfit</h3>'
      + '<div class="rival-head"><span class="faction-badge" style="background:' + esc(r.color) + '">' + esc(r.glyph) + "</span>"
      + '<div class="rival-id"><div class="rival-name">' + esc(r.name) + '</div><div class="muted small">' + esc(trait.name) + " — " + esc(trait.desc) + "</div></div>"
      + '<span class="chip">' + esc(rr.label) + "</span></div>"
      + '<div class="statline small">Power <b>' + r.power + "</b> vs our <b>" + our + "</b> · record <b>" + r.wins + "W / " + r.losses + "L</b> · " + r.contracts + " jobs won</div>"
      + '<div class="rival-bar">' + barsHtml(Math.min(1, r.rep / 15), "warn") + "</div>"
      + '<p class="muted small">Latest: ' + esc(r.activity) + ".</p>"
      + '<p class="muted small">A persistent rival competes for the same board — higher standing lets it snatch contracts and undercut your pay. Beat it in the field or outbid it to keep it small.</p></div>';
  }

  function storyCard(company) {
    const seen = (company.story && company.story.seen) || {};
    const done = M.STORY_EVENTS.filter((ev) => seen[ev.id] !== undefined);
    const upcoming = M.STORY_EVENTS.filter((ev) => seen[ev.id] === undefined && (ev.eraMin === undefined || ev.eraMin <= company.eraIdx) && (ev.eraMax === undefined || ev.eraMax >= company.eraIdx));
    let rows = done.map((ev) => '<div class="story-row"><span class="story-wk">W' + seen[ev.id] + '</span><span>' + esc(ev.title) + "</span></div>").join("");
    if (!rows) rows = '<p class="muted small">No campaign milestones yet — major era events unfold as the weeks pass.</p>';
    const era = M.eraOf(company);
    return '<div class="card" style="margin-top:16px"><h3 class="card-title">Campaign</h3><div class="story-list">' + rows + "</div>"
      + '<p class="muted small">' + esc(era.name) + ' · ' + upcoming.length + " more era event" + (upcoming.length === 1 ? "" : "s") + " may lie ahead.</p></div>";
  }

  function renderCompany(company) {
    const era = M.eraOf(company);
    const log = M.logisticsSummary(company);
    const ls = M.ledgerSummary(company);
    const catOrder = ["contract", "bonus", "sale", "start", "refund", "loan", "investment", "payroll", "upkeep", "transport", "ammo", "medical", "repair", "hire", "severance", "event", "market", "refit", "overdraft"];
    const catTop = catOrder.filter((c) => ls.byCat[c]).map((c) => {
      const v = ls.byCat[c];
      return '<span class="chip ' + (v >= 0 ? "ok-chip" : "muted-chip") + '">' + esc(c) + " " + money(v) + "</span>";
    }).join("");
    const burnWarn = ls.burn > 0 && ls.runway <= 4 ? " <span class='chip tr-neg'>LOW RUNWAY</span>" : "";
    const sign = (n) => (n >= 0 ? "+" : "−");
    let ledger = "";
    for (const t of company.ledger.slice(0, 30)) {
      const catCls = { contract: "ok", bonus: "ok", payroll: "", upkeep: "", transport: "", ammo: "", medical: "", repair: "", market: "", sale: "ok", event: "", loan: "tr-warn", investment: "ok", hire: "", start: "ok", severance: "", overdraft: "neg", refund: "ok", refit: "" }[t.cat] || "";
      ledger += '<div class="led-row"><span class="chip ' + catCls + '">' + esc(t.cat) + '</span><span class="led-label">' + esc(t.label) + '</span>'
        + '<span class="led-amt">' + money(t.amount) + '</span><span class="led-wk muted">W' + t.week + "</span></div>";
    }
    if (!company.ledger.length) ledger = '<p class="muted">No transactions yet.</p>';
    let rep = "";
    for (const f of M.eraFactions(company)) {
      const r = company.rep[f.id] || 0;
      const tier = M.repTier(r);
      rep += '<div class="rep-cell"><span class="faction-badge sm" style="background:' + esc(f.color) + '">' + esc(f.glyph) + "</span>"
        + '<span class="rep-name-sm">' + esc(f.name) + "</span>"
        + '<span class="rep-tier-chip' + (r >= 5 ? " hi" : r >= 2 ? " mid" : r < 0 ? " low" : "") + '" title="' + esc(tier.name) + '">' + esc(tier.glyph) + " " + esc(tier.short) + "</span>"
        + repBadge(company, f.id) + "</div>";
    }
    const scen = M.scenarioById(company.scenario);
    return '<div class="screen-head"><div><h2>Company Command</h2><p class="lede">' + esc(company.name) + " · callsign " + esc(company.callsign) + " · " + esc(company.difficulty.label) + " difficulty · " + esc(era.name) + " (" + era.years + ") · founded as " + esc(scen.name) + "</p></div></div>"
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
      + (company.legacy ? '<div class="statline small">Legacy: this command was raised on the record of <b>' + esc(company.legacy.from) + '</b> — week ' + company.legacy.week + ", " + company.legacy.victories + " victories, " + company.legacy.kills + " kills.</div>" : "")
      + '<div class="btn-row">'
      + '<button class="btn btn-sm btn-ghost" data-bm="newgame">Start a new company</button>'
      + '<button class="btn btn-sm btn-danger" data-bm="wipe">Erase save</button>'
      + "</div></div>"
      + renderCredit(company)
      + difficultyCard(company)
      + rivalCard(company)
      + storyCard(company)
      + achievementsFull(company)
      + companiesCard(company)
      + shareCard()
      + '<div class="card" style="margin-top:16px"><h3 class="card-title">Save & backups' + (company.ironman ? ' <span class="chip ironman-chip">Ironman</span>' : "") + "</h3>"
      + (company.ironman
        ? '<p class="muted small">Ironman company — it autosaves to this browser after every action, but snapshots, restore and save import are disabled. Export a file for safekeeping if you wish, but it cannot be loaded back into this command.</p>'
        : '<p class="muted small">Your company autosaves to this browser. <b>Save now</b> adds a snapshot you can rewind to; snapshots also build automatically after battles and at the start of each week. Export a file to back up or move the company to another device, and import one to restore it (portraits included).</p>')
      + '<div class="btn-row">'
      + '<button class="btn btn-sm btn-primary" data-bm="save-now">Save now</button>'
      + '<button class="btn btn-sm btn-ghost" data-bm="export-save">Export file</button>'
      + (company.ironman ? "" : '<button class="btn btn-sm btn-ghost" data-bm="import-save">Import file</button>')
      + "</div>"
      + (company.ironman ? "" : renderBackups())
      + "</div></div></div>";
  }

  /* ============================ DEPLOY MODAL ============================ */
  function renderDeployModal(company, offer) {
    const units = M.availUnitsWithPilots(company).sort((a, b) => a.ton - b.ton);
    const list = units.map((u) => {
      const pil = M.findPerson(company, u.pilotId);
      const pw = M.unitPower(u, pil);
      const op = M.ordnanceProfile(u);
      return '<div class="lance-row" data-lid="' + u.id + '">' + avatarWrap(M.unitAvatar(u), "mech mini")
        + '<div class="lance-body"><b>' + esc(u.name) + "</b> <span class='muted'>" + esc(clsOf(u)) + "</span> " + roleBadge(u)
        + '<div class="muted small">Pilot ' + esc(pil.callsign) + " (G" + pil.gunnery + "/P" + pil.piloting + ") · power " + pw + " · heat " + op.alphaHeat + "/" + op.heatCap + (op.ammoCount ? " · " + op.ammoCount + " ammo weapon" + (op.ammoCount > 1 ? "s" : "") : "") + "</div></div>"
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
    const cond = M.conditionsFor(offer);
    const doc = M.doctrineOf(offer);
    const condPct = cond.acc + cond.sensors * 0.7 + cond.heat * -0.06;
    const condBits = ["gunnery " + modPct(condPct)];
    if (cond.sensors < -0.02) condBits.push("sensors " + modPct(cond.sensors));
    else if (cond.sensors > 0.01) condBits.push("sensors clear");
    if (cond.heat > 0.05) condBits.push("heat stress on energy weapons");
    else if (cond.heat < -0.05) condBits.push("cold sinks run clean");
    const condCls = condPct < -0.03 || cond.sensors < -0.02 || cond.heat > 0.05 ? "risk-note" : "risk-ok";
    const onStation = !offer.systemId || company.location === offer.systemId;
    let travelNote = "";
    if (!onStation) {
      if (company.transit) travelNote = '<div class="alert warn"><b>In transit.</b> The company is en route to ' + esc(company.transit.toName || company.transit.to) + " (" + Math.max(0, company.transit.weeksLeft) + " week" + (company.transit.weeksLeft === 1 ? "" : "s") + " out). This contract is on " + esc(offer.planet) + " — you cannot deploy until you arrive.</div>";
      else travelNote = '<div class="alert warn"><b>Not on station.</b> This contract is on ' + esc(offer.planet) + ", but the company is at " + esc((M.worldSystemById(company, company.location) || {}).name || "elsewhere") + ". Move there before you can deploy." + travelBanner(company, offer.systemId) + "</div>";
    }
    return '<div class="deploy">'
      + '<div class="screen-head"><div><h2>' + esc(offer.missionName) + " — " + esc(offer.planet) + "</h2>"
      + '<p class="lede">' + esc(offer.employer) + " hires " + esc(company.name) + " to strike against " + esc(offer.targetName) + ".</p></div>"
      + '<button class="btn btn-ghost" data-bm="close-modal">Back</button></div>'
      + (offer.house ? '<div class="alert"><b>★ ' + (offer.clanHouse ? "Clan" : "House") + " Contract.</b> " + esc(offer.employer) + " offers this work exclusively to your company on the strength of your standing. It pays well above market and the enemy is correspondingly heavier.</div>" : "")
      + travelNote
      + '<div class="grid-2col"><div class="card">'
      + '<p>' + esc(offer.objDesc) + "</p>"
      + '<p class="muted small"><b>Victory:</b> ' + esc(offer.victoryCond) + "</p>"
      + '<p class="muted small"><b>Terrain:</b> ' + esc(offer.terrain.name) + (offer.terrain.biome ? " (" + esc(offer.terrain.biome) + ")" : "") + " — " + esc(offer.terrain.desc) + ". Accuracy <b>" + modPct(offer.terrain.mod) + "</b>.</p>"
      + (offer.weather ? '<p class="muted small"><b>Weather:</b> ' + esc(offer.weather.glyph) + " " + esc(offer.weather.name) + " — " + esc(offer.weather.desc) + ".</p>" : "")
      + '<p class="muted small"><b>Enemy commander:</b> ' + (offer.enemyCommander ? esc(offer.enemyCommander.rank) + " " + esc(offer.enemyCommander.name) + " — " : "") + '<span class="chip doc-chip doc-' + esc(doc.id) + '" title="' + esc(doc.desc) + '">' + esc(doc.glyph) + " " + esc(doc.name) + "</span> doctrine: " + esc(doc.desc) + ".</p>"
      + '<div class="deploy-cond"><span class="' + condCls + '">Conditions: ' + esc(condBits.join(" · ")) + "</span></div>"
      + '<div class="offer-meta">' + '<span class="pay-line">' + money(offer.pay) + "</span>"
      + '<span class="chip">salvage ' + offer.salvagePct + "%</span>"
      + '<span class="chip">threat ' + skulls(offer.threat) + "</span>"
      + '<span class="chip" title="Terrain accuracy modifier">' + esc(offer.terrain.name) + " " + modPct(offer.terrain.mod) + "</span>"
      + (offer.weather ? '<span class="chip wx-chip" title="Weather conditions">' + esc(offer.weather.glyph) + " " + esc(offer.weather.name) + "</span>" : "") + "</div>"
      + '<div class="deploy-sum" style="margin-top:14px"><span>Lance power: <b id="deployPower">0</b></span>'
      + '<span>Estimated enemy: <b id="deployEnemy">—</b></span></div>'
      + '<div class="deploy-risk" id="deployRisk"><span class="risk-note">Select at least one machine to launch.</span></div>'
      + '<div class="deploy-comp" id="deployComp"></div>'
      + '<div class="deploy-ordnance" id="deployOrdnance"></div>'
      + '<div class="deploy-cohesion" id="deployCohesion"></div>'
      + "</div>"
      + '<div class="card"><h3 class="card-title">Select your lance (up to 4)</h3>'
      + noReady
      + bayNoteHtml
      + '<div class="lance-list" id="lanceList">' + list + "</div>"
      + '<div class="btn-row" style="margin-top:12px">'
      + (onStation
        ? '<button class="btn btn-primary" data-bm="launch" data-offer="' + offer.id + '" id="launchBtn" disabled>Launch drop</button>'
        : '<button class="btn btn-primary" disabled title="Travel to ' + esc(offer.planet) + ' before deploying">Not on station</button>')
      + "</div></div></div></div>";
  }

  let modalSeq = 0;
  function modal(html, wide) {
    const back = document.createElement("div");
    back.className = "modal-back" + (wide ? " wide" : "");
    back.setAttribute("role", "dialog");
    back.setAttribute("aria-modal", "true");
    back.innerHTML = '<div class="modal" tabindex="-1"><button class="modal-x" data-bm="close-modal" aria-label="Close">✕</button>' + html + "</div>";
    const titleEl = back.querySelector(".modal-title, .card-title, h2, h3");
    if (titleEl) {
      if (!titleEl.id) titleEl.id = "bm-modal-title-" + (++modalSeq);
      back.setAttribute("aria-labelledby", titleEl.id);
    } else {
      back.setAttribute("aria-label", "Dialog");
    }
    back.addEventListener("click", (e) => { if (e.target === back) closeModalEl(back); });
    return back;
  }
  function showModalEl(back) {
    if (window.BT && BT.rememberFocus) BT.rememberFocus(back);
    document.body.appendChild(back);
    if (window.BT && BT.focusModal) BT.focusModal(back);
  }
  function closeModalEl(back) {
    if (!back || !back.parentNode) return;
    back.parentNode.removeChild(back);
    if (window.BT && BT.restoreFocus) BT.restoreFocus(back);
  }
  function closeTopModal() {
    const backs = [...document.querySelectorAll(".modal-back")].filter((m) => !m.hidden);
    const last = backs[backs.length - 1];
    if (!last) return;
    if (last.dataset.modalStatic === "1") {
      last.hidden = true;
      if (window.BT && BT.restoreFocus) BT.restoreFocus(last);
    } else {
      closeModalEl(last);
    }
  }
  /* ============================ SHARE CARD ============================ */
  function rr(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }
  function truncC(s, n) { s = String(s || ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; }
  function shareTitles(company) {
    const out = [];
    const sc = M.scenarioById(company.scenario);
    if (sc && sc.title) out.push(sc.title);
    for (const t of company.titles || []) if (out.indexOf(t) < 0) out.push(t);
    return out;
  }
  function buildRosterCard(company) {
    const a = M.almanacStats(company);
    const rating = M.companyRating(company);
    const era = M.eraOf(company);
    const scen = M.scenarioById(company.scenario);
    const titles = shareTitles(company);
    const pilots = company.people.filter((p) => p.role === "pilot").slice(0, 8);
    const mechs = company.units.filter((u) => u.status !== "destroyed").slice(0, 10);
    const rep = M.eraFactions(company).map((f) => ({ f, r: company.rep[f.id] || 0 })).sort((x, y) => y.r - x.r).slice(0, 3);
    const ach = M.achievementsSummary(company);

    const W = 1080, pad = 56, rowH = 48;
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = 3200;
    const g = cv.getContext("2d");
    const col = { accent: "#e2a63b", text: "#e7e1ce", muted: "#968e74", panel: "#161a11", panel2: "#1e2317", bg: "#0f120b", line: "rgba(231,225,206,0.14)", ok: "#5cb87a", danger: "#d0654f" };
    const F = (size, weight) => (weight || 600) + " " + size + "px Rajdhani, 'Segoe UI', system-ui, sans-serif";
    const FM = (size, weight) => (weight || 500) + " " + size + "px 'JetBrains Mono', ui-monospace, Menlo, monospace";
    const line = (yy) => { g.strokeStyle = col.line; g.lineWidth = 1; g.beginPath(); g.moveTo(pad, yy); g.lineTo(W - pad, yy); g.stroke(); };
    const sectionHead = (title, yy) => {
      g.fillStyle = col.accent; g.font = FM(13, 700);
      g.fillText(title, pad, yy);
      line(yy + 12);
      return yy + 34;
    };
    g.fillStyle = col.bg; g.fillRect(0, 0, W, cv.height);
    g.fillStyle = col.accent; g.fillRect(0, 0, W, 10);
    let y = 56;

    const logoS = 76;
    g.fillStyle = col.panel2; g.beginPath(); g.arc(pad + logoS / 2, y + logoS / 2, logoS / 2, 0, Math.PI * 2); g.fill();
    g.strokeStyle = col.accent; g.lineWidth = 3; g.stroke();
    g.fillStyle = col.accent; g.font = F(38, 700); g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(truncC((company.callsign || "?").toUpperCase(), 2), pad + logoS / 2, y + logoS / 2 + 2);
    g.textAlign = "left"; g.textBaseline = "alphabetic";
    const x0 = pad + logoS + 26;
    g.fillStyle = col.text; g.font = F(44, 700);
    g.fillText(truncC(company.name, 28), x0, y + 34);
    g.fillStyle = col.muted; g.font = F(17, 600);
    g.fillText("CALLSIGN " + (company.callsign || "—"), x0, y + 62);
    if (titles.length) { g.fillStyle = col.accent; g.font = F(19, 600); g.fillText("“" + truncC(titles.join("” · “"), 44) + "”", x0, y + 92); }
    g.fillStyle = col.muted; g.font = F(16, 500);
    g.fillText(truncC(era.name + " (" + era.years + ")  ·  " + company.difficulty.label + "  ·  founded as " + scen.name + "  ·  week " + company.week, 78), x0, y + 122);
    y += 150;
    line(y); y += 30;

    const kpis = [
      { k: "Company rating", v: rating.label },
      { k: "Contracts run", v: String(a.contracts) + "  (" + a.wins + "W / " + a.losses + "L)" },
      { k: "Win rate", v: a.winRate === null ? "—" : a.winRate + "%" },
      { k: "Confirmed kills", v: String(a.kills) }
    ];
    const gap = 18, bw = (W - pad * 2 - gap * 3) / 4, bh = 96;
    kpis.forEach((kp, i) => {
      const bx = pad + i * (bw + gap);
      g.fillStyle = col.panel; rr(g, bx, y, bw, bh, 12); g.fill();
      g.strokeStyle = col.line; g.lineWidth = 1; rr(g, bx, y, bw, bh, 12); g.stroke();
      g.fillStyle = col.accent; g.font = F(25, 700);
      g.fillText(truncC(kp.v, 18), bx + 16, y + 44);
      g.fillStyle = col.muted; g.font = FM(11, 600);
      g.fillText(kp.k.toUpperCase(), bx + 16, y + 70);
    });
    y += bh + 44;

    y = sectionHead("SERVICE RECORD", y);
    const rec = [
      ["Weeks active", String(a.weeks)],
      ["Total payout", fmtC(a.payout) + " C-bills"],
      ["Salvage recovered", String((company.stats || {}).salvageTaken || 0)],
      ["Machines in service", String(mechs.length) + " / " + company.units.length],
      ["Best contract", a.best ? fmtC(a.best.pay) + " C-bills" : "—"],
      ["Milestones", ach.unlocked.length + " / " + ach.total],
      ["Personnel", String(company.people.length) + " (" + pilots.length + " pilots)"],
      ["Treasury", fmtC(company.funds) + " C-bills"]
    ];
    const cw = (W - pad * 2) / 4;
    rec.forEach((r, i) => {
      const cx = pad + (i % 4) * cw;
      const cy = y + Math.floor(i / 4) * 58;
      g.fillStyle = col.muted; g.font = FM(11, 600);
      g.fillText(r[0].toUpperCase(), cx, cy);
      g.fillStyle = col.text; g.font = F(22, 600);
      g.fillText(truncC(r[1], 18), cx, cy + 28);
    });
    y += 2 * 58 + 8;
    line(y); y += 30;

    y = sectionHead("STANDING — KEY EMPLOYERS", y);
    g.font = F(20, 600);
    rep.forEach((r, i) => {
      const cy = y + i * 34;
      g.fillStyle = col.text;
      g.fillText(truncC(r.f.glyph + " " + r.f.name, 34), pad, cy);
      const tier = M.repTier(r.r);
      g.fillStyle = r.r > 0 ? col.ok : r.r < 0 ? col.danger : col.muted;
      g.font = FM(18, 700);
      g.textAlign = "right";
      g.fillText((r.r > 0 ? "+" : "") + r.r + "  " + tier.name, W - pad, cy);
      g.textAlign = "left";
      g.font = F(20, 600);
    });
    y += Math.max(1, rep.length) * 34 + 10;
    line(y); y += 30;

    y = sectionHead("PILOTS", y);
    if (!pilots.length) { g.fillStyle = col.muted; g.font = F(18, 500); g.fillText("No pilots on the roster.", pad, y + 4); }
    pilots.forEach((p, i) => {
      const cy = y + i * rowH + 30;
      if (i) { g.strokeStyle = "rgba(231,225,206,0.07)"; g.beginPath(); g.moveTo(pad, cy - rowH + 8); g.lineTo(W - pad, cy - rowH + 8); g.stroke(); }
      g.fillStyle = col.text; g.font = F(21, 700);
      g.fillText(truncC(p.callsign || p.name, 16), pad, cy);
      g.fillStyle = col.muted; g.font = F(15, 500);
      g.fillText(truncC(p.name, 24), pad + 170, cy);
      const s = M.careerOf(p);
      g.fillStyle = col.accent; g.font = FM(16, 600);
      g.fillText("G" + p.gunnery + " / P" + p.piloting, pad + 470, cy);
      g.fillStyle = col.muted; g.font = FM(15, 500);
      g.fillText(s.kills + " kills · " + s.victories + "W/" + s.defeats + "L", pad + 610, cy);
      const st = p.status === "active" ? "ready" : p.status;
      g.fillStyle = p.status === "active" ? col.ok : col.danger; g.font = F(15, 600);
      g.fillText(st, W - pad - 90, cy);
    });
    y += Math.max(1, pilots.length) * rowH + 4;
    line(y); y += 30;

    y = sectionHead("BATTLEMECH LANCE", y);
    if (!mechs.length) { g.fillStyle = col.muted; g.font = F(18, 500); g.fillText("No operational machines.", pad, y + 4); }
    mechs.forEach((u, i) => {
      const cy = y + i * rowH + 30;
      if (i) { g.strokeStyle = "rgba(231,225,206,0.07)"; g.beginPath(); g.moveTo(pad, cy - rowH + 8); g.lineTo(W - pad, cy - rowH + 8); g.stroke(); }
      g.fillStyle = col.text; g.font = F(21, 700);
      g.fillText(truncC(u.name, 22), pad, cy);
      g.fillStyle = col.muted; g.font = F(15, 500);
      g.fillText(clsOf(u) + " · " + u.ton + "t" + (u.tech ? " · " + u.tech : ""), pad + 320, cy);
      const pil = u.pilotId ? M.findPerson(company, u.pilotId) : null;
      g.fillStyle = col.muted; g.font = F(15, 500);
      g.fillText(pil ? truncC(pil.callsign, 16) : "no pilot", pad + 560, cy);
      const hp = Math.round(M.hpPct(u) * 100);
      g.fillStyle = hp > 75 ? col.ok : hp > 40 ? col.accent : col.danger; g.font = FM(16, 600);
      g.fillText(hp + "%", W - pad - 90, cy);
    });
    y += Math.max(1, mechs.length) * rowH + 4;

    const footTop = y + 24;
    line(footTop);
    g.fillStyle = col.muted; g.font = FM(13, 500);
    g.fillText("BATTLETECH MERCENARY MANAGER  ·  an AI-narrated mercenary command sim", pad, footTop + 30);
    g.textAlign = "right";
    g.fillStyle = col.accent; g.font = FM(13, 600);
    g.fillText("WEEK " + company.week + "  ·  " + era.years, W - pad, footTop + 30);
    g.textAlign = "left";
    const H = Math.round(footTop + 52);
    const out = document.createElement("canvas");
    out.width = W; out.height = H;
    out.getContext("2d").drawImage(cv, 0, 0, W, H, 0, 0, W, H);
    return out;
  }
  function rosterSummary(company) {
    const a = M.almanacStats(company);
    const rating = M.companyRating(company);
    const era = M.eraOf(company);
    const titles = shareTitles(company);
    let url = "perchance.org";
    try { url = location.host + location.pathname; } catch (e) { /* noop */ }
    return company.name + (titles.length ? " — “" + titles.join("” · “") + "”" : "") + "\n"
      + rating.label + " · " + era.name + " (" + era.years + ") · " + company.difficulty.label + " command\n"
      + "Week " + company.week + " · " + a.contracts + " contracts (" + a.wins + "W/" + a.losses + "L) · "
      + a.kills + " confirmed kills · " + fmtC(a.payout) + " C-bills earned\n"
      + "Personnel " + company.people.length + " · operational 'Mechs " + company.units.filter((u) => u.status !== "destroyed").length
      + " · milestones " + M.achievementsSummary(company).unlocked.length + "/" + M.achievementsSummary(company).total + "\n"
      + url;
  }
  function shareCard() {
    return '<div class="card" style="margin-top:16px"><h3 class="card-title">Share the company</h3>'
      + '<p class="muted small">Render your outfit as a roster card — a poster of your command record, pilots, lance and standing — to download or post.</p>'
      + '<div class="btn-row"><button class="btn btn-sm btn-ghost" data-bm="share">Generate roster card</button></div></div>';
  }
  function difficultyCard(company) {
    const ref = M.difficultyByKey((company.difficulty && company.difficulty.key) || "regular");
    const d = Object.assign({}, ref, company.difficulty || {});
    const chip = (k, v) => '<span class="chip">' + k + " " + v + "</span>";
    const pct = (n) => "×" + n;
    const mods = [
      chip("Payout", pct(d.payMult)),
      chip("Enemy threat", pct(d.threatMult)),
      chip("Repairs", pct(d.repairMult)),
      chip("Wounds", pct(d.injuryMult)),
      chip("Salvage", pct(d.salvageMult)),
      chip("Upkeep", pct(d.upkeepMult)),
      chip("Enemy gunnery", (d.bonus >= 0 ? "+" : "") + d.bonus)
    ].join("");
    return '<div class="card" style="margin-top:16px"><h3 class="card-title">Difficulty &amp; rules <span class="chip">' + esc(d.label) + "</span>"
      + (company.ironman ? ' <span class="chip ironman-chip">Ironman</span>' : "") + "</h3>"
      + '<p class="muted small">' + esc(ref.blurb) + "</p>"
      + '<div class="title-row">' + mods + "</div>"
      + (company.ironman
        ? '<p class="muted small">Ironman is active — snapshots, restore and save import are disabled for this company, so every decision stands.</p>'
        : '<div class="btn-row"><button class="btn btn-sm btn-danger" data-bm="ironman">Commit to Ironman</button></div>'
          + '<p class="muted small">Ironman disables snapshots, restore and save import for good — a run with no second chances. It cannot be undone.</p>')
      + "</div>";
  }
  function companiesCard(company) {
    const slots = (window.BMG && window.BMG.slots) ? window.BMG.slots.slice() : [];
    const active = window.BMG ? window.BMG.activeSlot : "main";
    slots.sort((a, b) => (b.updated || 0) - (a.updated || 0));
    const rows = slots.map((s) => {
      const isAct = s.id === active;
      return '<div class="slot-row' + (isAct ? " active" : "") + '">'
        + '<div class="slot-main"><div class="slot-name">' + esc(s.name || "—") + (isAct ? ' <span class="chip">active</span>' : "") + "</div>"
        + '<div class="muted small">' + esc(s.era || "") + " · " + esc(s.difficulty || "Regular") + " · week " + (s.week || 0)
        + " · " + fmtC(s.funds || 0) + " C-bills · " + (s.pilots || 0) + " pilots, " + (s.units || 0) + " machines</div>"
        + '<div class="muted small">' + (s.updated ? "Updated " + new Date(s.updated).toLocaleString() : "") + "</div></div>"
        + '<div class="slot-btns">'
        + (isAct ? "" : '<button class="btn btn-sm btn-ghost" data-bm="slot-switch" data-slot="' + s.id + '">Take command</button>')
        + (slots.length > 1 ? '<button class="btn btn-sm btn-danger" data-bm="slot-delete" data-slot="' + s.id + '">Forget</button>' : "")
        + "</div></div>";
    }).join("");
    return '<div class="card" style="margin-top:16px"><h3 class="card-title">Mercenary commands</h3>'
      + '<p class="muted small">Every company is kept in its own save slot with its own pilots, machines, portraits, ledger and snapshots. Take command of another outfit to switch between them.</p>'
      + '<div class="slot-list">' + (rows || '<div class="muted small">No commands on file yet.</div>') + "</div>"
      + '<div class="btn-row"><button class="btn btn-sm btn-primary" data-bm="newgame">Found a new company</button></div></div>';
  }

  function arenaNoStable() {
    return '<div class="screen-head"><div><h2>Solaris VII — Arena Career</h2>'
      + '<p class="lede">The Game World crowns its own champions. Run a stable of gladiator BattleMechs on the arenas of Solaris VII — a career entirely separate from your mercenary company, with its own C-bills, pilots, circuits and fame.</p></div></div>'
      + '<div class="card arena-intro"><h3 class="card-title">Open a stable</h3>'
      + '<p class="muted small">Sign gladiators, fight weight-class circuits, buy stable upgrades and chase sponsorships up the ranks of the Games. Nothing here touches your mercenary company&rsquo;s save, ledger or roster.</p>'
      + '<div class="btn-row"><button class="btn btn-primary" data-bm="arena-found">Found an arena stable</button></div></div>';
  }
  function arenaReadLabel(best) {
    return best === "favoured" ? "ok-chip" : best === "underdog" ? "tr-warn" : "";
  }
  function renderArena(stable) {
    if (!stable) return arenaNoStable();
    const rank = M.arenaRank(stable);
    const sp = M.arenaSponsor(stable);
    const rec = stable.record || {};
    const wins = rec.wins || 0, losses = rec.losses || 0;
    const rate = (wins + losses) ? Math.round((wins / (wins + losses)) * 100) : 0;
    const live = M.arenaLiveUnits(stable).length;
    let html = '<div class="screen-head"><div><h2>' + esc(stable.name) + '</h2>'
      + '<p class="lede">Solaris VII stable · ' + esc(rank.name) + ' · week ' + stable.week + ' · ' + esc(M.eraOf(stable).name) + ' era' + (sp.id !== "none" ? ' · sponsored by ' + esc(sp.name) : "") + '</p></div>'
      + '<div class="btn-row"><span class="chip arena-funds" title="Stable treasury">₡ ' + esc(fmtC(stable.funds)) + '</span>'
      + '<span class="chip">Fame ' + (stable.fame || 0) + '</span>'
      + '<button class="btn btn-sm btn-ghost" data-bm="arena-abandon">Abandon stable</button>'
      + '<button class="btn btn-primary" data-bm="arena-week">Advance week &rsaquo;</button></div></div>';

    html += '<div class="kpis arena-kpis">' + kpi("Bout record", wins + "W / " + losses + "L")
      + kpi("Win rate", rate + "%")
      + kpi("Fame", (stable.fame || 0) + ' <span class="muted small">' + esc(rank.name) + "</span>")
      + kpi("Purses earned", fmtC(stable.purseTotal || 0)) + "</div>";

    html += '<div class="arena-grid"><div class="card"><h3 class="card-title">Circuits</h3><div class="venue-list">';
    for (const c of M.ARENA_CLASSES) {
      const have = M.arenaLiveUnits(stable).filter((u) => u.cls === c.key).length;
      const cw = stable.circuits[c.key] || 0;
      html += '<div class="arena-line"><span class="arena-glyph">' + c.glyph + '</span><div class="arena-line-main"><div class="arena-line-name">' + esc(c.name)
        + (have ? ' <span class="chip">' + have + " machine" + (have > 1 ? "s" : "") + "</span>" : ' <span class="chip muted-chip">none</span>') + "</div>"
        + '<div class="muted small">' + esc(c.desc) + " · " + cw + " circuit win" + (cw === 1 ? "" : "s") + "</div></div></div>";
    }
    html += "</div></div>";

    html += '<div class="card"><h3 class="card-title">Venues</h3><div class="venue-list">';
    for (const v of M.ARENA_VENUES) {
      const open = (stable.fame || 0) >= v.fameReq;
      html += '<div class="arena-line' + (open ? "" : " locked") + '"><span class="arena-glyph">' + v.glyph + '</span><div class="arena-line-main"><div class="arena-line-name">' + esc(v.name) + " "
        + (open ? '<span class="chip ok-chip">open</span>' : '<span class="chip tr-warn">fame ' + v.fameReq + "</span>") + "</div>"
        + '<div class="muted small">' + esc(v.desc) + " · purses ×" + v.purseMult + "</div></div></div>";
    }
    html += "</div></div></div>";

    html += '<div class="card arena-bouts"><h3 class="card-title">This week&rsquo;s card</h3>';
    if (!stable.bouts || !stable.bouts.length) {
      html += '<p class="muted small">No bouts on the card. Buy a gladiator machine or mend the ones you have, then advance the week.</p>';
    } else {
      for (const b of stable.bouts) {
        const eligible = M.arenaReady(stable, b.classKey);
        const best = eligible.length ? Math.max.apply(null, eligible.map((u) => M.unitPower(u, M.findPerson(stable, u.pilotId)))) : 0;
        const read = !eligible.length ? "no gladiator" : best > b.power * 1.15 ? "favoured" : best > b.power * 0.9 ? "even odds" : "underdog";
        html += '<div class="bout-card"><div class="bout-head"><span class="arena-glyph">' + b.venueGlyph + '</span><div><div class="bout-venue">' + esc(b.venueName)
          + ' <span class="chip">' + esc(b.className) + "</span></div>"
          + '<div class="muted small">' + esc(b.opponent) + " &ldquo;" + esc(b.opponentCall) + "&rdquo; · " + esc(b.opponentMech) + "</div></div>"
          + '<div class="bout-purse"><div class="bout-purse-val">' + fmtC(b.purse) + '</div><div class="muted small">purse · +' + b.fameGain + " fame</div></div></div>"
          + '<div class="bout-body"><span class="chip">Opponent power ' + b.power + "</span>"
          + '<span class="chip">' + (eligible.length ? "your best " + best : "no eligible gladiator") + "</span>"
          + '<span class="chip ' + arenaReadLabel(read) + '">' + read + "</span></div>"
          + (eligible.length
            ? '<div class="btn-row">' + eligible.map((u) => { const p = M.findPerson(stable, u.pilotId); return '<button class="btn btn-sm btn-primary" data-bm="arena-fight" data-bout="' + b.id + '" data-unit="' + u.id + '">Send ' + esc(p.callsign) + "</button>"; }).join("") + "</div>"
            : '<p class="muted small">No ready gladiator in this circuit — assign an active pilot and repair the machine.</p>')
          + "</div>";
      }
    }
    html += "</div>";

    html += '<div class="card"><h3 class="card-title">Gladiators <span class="chip">' + live + " / " + M.arenaCap(stable) + "</span></h3>";
    if (!stable.units.length) html += '<p class="muted small">No machines in the stable — buy one from the market.</p>';
    for (const u of stable.units) {
      const p = u.pilotId ? M.findPerson(stable, u.pilotId) : null;
      const hp = M.hpPct(u);
      const cost = M.arenaRepairCost(stable, u);
      const wrecked = u.status === "destroyed";
      const dmg = wrecked || hp < 0.999;
      html += '<div class="glad-card' + (wrecked ? " wrecked" : "") + '">' + avatarWrap(M.unitAvatar(u), "mech")
        + '<div class="glad-main"><div class="glad-name">' + esc(u.name) + ' <span class="chip">' + esc(clsOf(u)) + " · " + u.ton + "t</span></div>"
        + '<div class="muted small">' + esc(p ? (p.callsign + " · " + M.pilotTier(p) + (p.status === "injured" ? " · INJURED " + p.injuredWeeks + "w" : "")) : "no pilot assigned") + "</div>"
        + '<div class="glad-hp">' + barsHtml(hp, hp > 0.5 ? "ok" : hp > 0.25 ? "warn" : "bad") + '<span class="muted small">' + Math.round(hp * 100) + "% hull</span></div></div>"
        + '<div class="glad-btns">'
        + '<button class="btn btn-sm btn-ghost" data-bm="arena-repair" data-unit="' + u.id + '"' + (dmg ? "" : " disabled") + ">Repair " + fmtC(cost) + "</button>"
        + '<button class="btn btn-sm btn-danger" data-bm="arena-sell-unit" data-unit="' + u.id + '">Sell ' + fmtC(M.arenaUnitValue(stable, u)) + "</button>"
        + "</div></div>";
    }
    html += "</div>";

    html += '<div class="card"><h3 class="card-title">Gladiator market</h3>';
    if (!stable.market) {
      html += '<p class="muted small">The market refreshes next week.</p>';
    } else {
      html += '<div class="muted small market-sub">Machines for sale</div>';
      html += stable.market.mechs.map((m) => { const mech = D.MECH_MAP[m.chassisId]; return '<div class="arena-line"><span class="arena-glyph">' + M.arenaClass(m.clsKey).glyph + '</span><div class="arena-line-main"><div class="arena-line-name">' + esc(mech.name) + "</div>"
        + '<div class="muted small">' + esc(clsOf(mech)) + " · " + mech.ton + "t · condition " + Math.round(m.cond * 100) + "% · " + fmtC(m.price) + "</div></div>"
        + '<button class="btn btn-sm btn-ghost" data-bm="arena-buy-mech" data-item="' + m.id + '">Buy</button></div>'; }).join("");
      html += '<div class="muted small market-sub">Free gladiators</div>';
      html += stable.market.pilots.map((p) => '<div class="arena-line"><span class="arena-glyph">✦</span><div class="arena-line-main"><div class="arena-line-name">' + esc(p.callsign) + ' <span class="muted small">' + esc(p.name) + "</span></div>"
        + '<div class="muted small">G' + p.gunnery + " P" + p.piloting + " · signing fee " + fmtC(p.fee) + "</div></div>"
        + '<button class="btn btn-sm btn-ghost" data-bm="arena-hire" data-pilot="' + p.id + '">Sign</button></div>').join("");
    }
    html += "</div>";

    html += '<div class="arena-grid"><div class="card"><h3 class="card-title">Stable upgrades</h3><div class="venue-list">';
    html += M.ARENA_UPGRADES.map((up) => {
      const own = M.arenaUpgradeOwned(stable, up.key);
      return '<div class="arena-line' + (own ? " owned" : "") + '"><span class="arena-glyph">' + up.glyph + '</span><div class="arena-line-main"><div class="arena-line-name">' + esc(up.name) + (own ? ' <span class="chip ok-chip">built</span>' : "") + "</div>"
        + '<div class="muted small">' + esc(up.desc) + "</div></div>"
        + (own ? "" : '<button class="btn btn-sm btn-ghost" data-bm="arena-upgrade" data-key="' + up.key + '"' + (stable.funds >= up.cost ? "" : " disabled") + ">" + fmtC(up.cost) + "</button>") + "</div>";
    }).join("");
    html += "</div></div>";

    html += '<div class="card"><h3 class="card-title">Sponsorship</h3><p class="muted small">Active: <b>' + esc(sp.name) + "</b>" + (sp.weekly ? " · " + fmtC(sp.weekly) + "/week" : "") + "</p><div class=\"venue-list\">";
    html += M.ARENA_SPONSORS.map((s) => {
      const open = (stable.fame || 0) >= s.fameReq;
      const active = stable.sponsor === s.id;
      return '<div class="arena-line' + (active ? " owned" : "") + '"><span class="arena-glyph">' + s.glyph + '</span><div class="arena-line-main"><div class="arena-line-name">' + esc(s.name)
        + (active ? ' <span class="chip ok-chip">active</span>' : (open ? "" : ' <span class="chip tr-warn">fame ' + s.fameReq + "</span>")) + "</div>"
        + '<div class="muted small">' + esc(s.desc) + (s.weekly ? " · " + fmtC(s.weekly) + "/wk" : "") + "</div></div></div>";
    }).join("");
    html += "</div></div></div>";

    html += '<div class="arena-grid"><div class="card"><h3 class="card-title">Fight record</h3><div class="venue-list">';
    html += (stable.history && stable.history.length)
      ? stable.history.slice(0, 12).map((h) => '<div class="arena-line"><span class="arena-glyph ' + (h.outcome === "victory" ? "ok" : "bad") + '">' + (h.outcome === "victory" ? "W" : "L") + '</span><div class="arena-line-main"><div class="arena-line-name">' + esc(h.gladiator) + " vs " + esc(h.opponent) + "</div>"
        + '<div class="muted small">Week ' + h.week + " · " + esc(h.venue) + " · " + esc(h.className) + " · " + esc(h.outcomeLabel) + " · " + fmtC(h.purse) + (h.machineLost ? " · machine lost" : "") + (h.injured && !h.machineLost ? " · injured" : "") + "</div></div></div>").join("")
      : '<p class="muted small">No bouts fought yet.</p>';
    html += "</div></div>";

    html += '<div class="card"><h3 class="card-title">Stable log</h3><div class="venue-list">';
    html += (stable.log && stable.log.length)
      ? stable.log.slice(0, 14).map((l) => '<div class="arena-line"><span class="chip">W' + l.week + '</span><div class="arena-line-main"><div class="small">' + esc(l.text) + "</div></div></div>").join("")
      : '<p class="muted small">Quiet week.</p>';
    html += "</div></div></div>";
    return html;
  }

  window.BMUI = {
    fmtC, fmtMoney, money, esc, el, renderAll, hud, renderDashboard, renderContracts,
    renderWorld, renderWorldSystem, ownerColor, ownerName, ownerGlyph,
    renderPersonnel, renderDossier, renderMechbay, renderRefit, refitPreviewText, renderMarket, renderSalvage,
    renderReports, renderCompany, storyCard, rivalCard, renderDeployModal, modal, showModalEl, closeModalEl, closeTopModal,
    renderArena,
    achievementsCard, achievementsFull,
    buildRosterCard, rosterSummary, shareCard, companiesCard, difficultyCard,
    mechCard, mechOf, repBadge, traitChips, avatarWrap, skulls, chip, clsOf, roleBadge, pStatus, barsHtml, kpi,
    portraitSlot, portraitBtnBig, setPortraitBusy, setPortraitInDom, careerBio, serviceRecord,
    PANEL_NAMES
  };
})();
