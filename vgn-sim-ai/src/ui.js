// SimAI — UI: rendering, tab navigation, game loop, modals, toasts.
import { game } from "./game.js";
import {
  EPOCHS, RESEARCH, RESEARCH_BY, ARCHES, ARCH_BY, PRODUCTS, HARDWARE, HARDWARE_BY, BUILDINGS, BUILDING_BY,
  STAFF, STAFF_BY, DATAPACKS, DATA_UPGRADES, DATAUP_BY, ROUNDS,
  staffTotal, computeCap, inferenceUse, crawlerUse, freeCompute, energyUse, energyOwn,
  energyGrid, uptime, rawPerDay, processCapacity, dataQuality, labScore, valuation,
  dailyRevenue, researchAvailable, researchDays, dcSlots, dcRacks, moraleMods,
  capableOf, trainQuality,
} from "./defs.js";

const $ = s => document.querySelector(s);
function setHTML(el, html) {
  if (el.__html === html) return;
  el.__html = html;
  el.innerHTML = html;
}
let tab = "home";
let toastTimer = null;
let blockTicks = false;

const TABS = [
  ["home", "🏠", "HQ"],
  ["research", "💡", "Research"],
  ["data", "🗄️", "Data"],
  ["models", "🔬", "Models"],
  ["infra", "🖥️", "Infra"],
  ["team", "👥", "Team"],
  ["products", "🚀", "Products"],
  ["community", "🏆", "Community"],
  ["money", "💰", "Money"],
];
const SPEEDS = [[0, "⏸"], [1, "1×"], [3, "3×"], [10, "10×"], [30, "30×"]];

// ---- helpers ----
function esc(x) { return String(x).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function fmtMoney(k) {
  if (!isFinite(k)) return "∞";
  if (k >= 1000) return "$" + (k / 1000).toFixed(k >= 10000 ? 0 : 1) + "M";
  if (k >= 10) return "$" + Math.round(k) + "K";
  if (k >= 1) return "$" + k.toFixed(1) + "K";
  return "$" + Math.round(k * 1000);
}
function g(n) {
  if (n >= 1000) return (n / 1000).toFixed(1) + "T";
  return n.toFixed(n >= 100 ? 0 : n >= 10 ? 1 : 2) + "G";
}
function fmtNum(n) {
  if (!isFinite(n)) return "∞";
  if (n >= 10000) return Math.round(n).toLocaleString();
  if (n >= 100) return Math.round(n).toString();
  if (n >= 10) return n.toFixed(1);
  return (+n.toFixed(2)).toString();
}
function pct(x) { return Math.round(x * 100) + "%"; }

export function toast(msg, ms) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), ms || 2600);
}

export function showModal(html) {
  const el = $("#modalRoot");
  setHTML(el, `<div class="box">${html}</div>`);
  el.classList.remove("hidden");
}
export function closeModal() { $("#modalRoot").classList.add("hidden"); }

// ---- boot ----
export async function init() {
  $("#tabs").innerHTML = TABS.map(([id, e, n]) => `<button class="tab${id === tab ? " on" : ""}" data-tab="${id}">${e} ${n}</button>`).join("");
  $("#tabs").addEventListener("click", e => {
    const b = e.target.closest("[data-tab]");
    if (b) { tab = b.dataset.tab; render(); }
  });
  $("#view").addEventListener("click", onAction);
  $("#modalRoot").addEventListener("click", onAction);
  $("#coNameInput").addEventListener("change", e => { game.rename(e.target.value); e.target.value = game.state.company; });
  document.addEventListener("keydown", e => {
    if (e.code === "Space" && !e.target.matches("input,button,textarea")) {
      e.preventDefault();
      const s = game.state;
      if (!s) return;
      if (s.speed === 0) s.speed = 3; else s.speed = 0;
      toast(s.speed === 0 ? "⏸ Paused" : "▶ Playing at " + s.speed + "×");
    }
  });

  game.kv = (window.root && window.root.kv) || null;
  const saved = await game.load();
  if (saved) {
    blockTicks = true;
    showModal(`<h2>📂 Welcome back to ${esc(saved.state.company)}</h2>
      <p>Found a save from <b>${new Date(saved.saved).toLocaleString()}</b> — day ${saved.state.day}, ${fmtMoney(saved.state.cash)} cash, ${staffTotal(saved.state)} staff.</p>
      <div class="modal-btns">
        <button class="acc" data-act="continue">▶ Continue</button>
        <button data-act="fresh">🆕 New game</button>
      </div>`);
  } else {
    game.state = game.newGame();
    blockTicks = true;
    showModal(helpHTML(), false);
  }
  requestAnimationFrame(loop);
}

function helpHTML() {
  return `<div class="help"><h2>🏭 Welcome to SimAI</h2>
    <p class="muted">A cozy AI startup simulator. One tick = one day. Build a lab from a single garage workstation and ride it through every age of AI.</p>
    <h3>🔁 The loop</h3>
    <ul>
      <li><b>Data</b> — run the web crawler, buy datasets, add cleaning upgrades. Clean tokens fuel model training.</li>
      <li><b>Research</b> — unlock new model architectures and tech, from decision trees to transformers.</li>
      <li><b>Infra</b> — buy GPUs, racks, data centers and power. Compute trains models and runs products.</li>
      <li><b>Team</b> — hire annotators, engineers, researchers and agents to multiply everything.</li>
      <li><b>Money</b> — products and contracts bring income; venture rounds bring cash for equity.</li>
    </ul>
    <h3>🎯 Goal</h3>
    <ul><li>Train models, publish, climb the leaderboard past your rivals, and take the company to IPO.</li></ul>
    <h3>⌨️ Tips</h3>
    <ul>
      <li>Space pauses/unpauses. Use the ×30 fast-forward for long grinds.</li>
      <li>Progress autosaves every 30 days — manual Save lives in the Money tab.</li>
      <li>Watch your energy bill. Hydropower and nuclear beat the grid.</li>
    </ul>
    <div class="modal-btns"><button class="acc" data-act="closeModal">▶ Let's go</button></div>
  </div>`;
}

// ---- loop ----
let last = 0, acc = 0;
function loop(ts) {
  const s = game.state;
  if (s && !blockTicks && !s.pendingEvent && !s.gameOver && s.speed > 0) {
    const dt = Math.min(100, ts - (last || ts));
    acc += (dt / 1000) * s.speed;
    let guard = 0;
    while (acc >= 1 && guard < 500) { game.tick(); acc -= 1; guard++; }
    if (guard >= 500) acc = 0;
  } else {
    acc = 0;
  }
  last = ts;
  try {
    render();
  } catch (e) {
    console.error("SimAI render error:", e);
  }
  requestAnimationFrame(loop);
}

// ---- render ----
function render() {
  const s = game.state;
  if (!s) return;
  renderTabs();
  renderChips(s);
  renderSpeed(s);
  renderLog(s);
  renderView(s);
  renderModal(s);
}

function renderTabs() {
  for (const b of document.querySelectorAll("#tabs .tab")) {
    b.classList.toggle("on", b.dataset.tab === tab);
  }
}

function renderModal(s) {
  if (s.pendingEvent) {
    showModal(`<h2>${esc(s.pendingEvent.title)}</h2><p>${esc(s.pendingEvent.text)}</p>
      <div class="modal-btns">${s.pendingEvent.choices.map((c, i) => `<button class="acc" data-act="resolveEvent" data-i="${i}">${esc(c.label)}</button>`).join("")}</div>`);
    return;
  }
  if (s.gameOver && !s.sandbox) {
    const win = s.gameOver !== "bust";
    const ttl = s.gameOver === "ipo" ? "🎉 IPO! You took it public!" : s.gameOver === "acquired" ? "🤝 Acquired!" : "💀 It is over";
    showModal(`<h2>${ttl}</h2><p>${esc(s.finalNote || "")}</p>
      <div class="modal-btns"><button data-act="fresh">🆕 New game</button>${win ? `<button class="acc" data-act="sandbox">🏝️ Keep building</button>` : ""}</div>`);
  }
}

function renderChips(s) {
  $("#coNameInput").value = s.company;
  $("#chipEpoch").textContent = EPOCHS[s.epoch].emoji + " " + EPOCHS[s.epoch].name + " · " + s.year;
  $("#chipDate").textContent = "📅 Day " + s.day;
  const cash = $("#chipCash");
  cash.textContent = "💰 " + fmtMoney(s.cash) + (s.equity > 0 ? " · " + Math.round(s.equity * 100) + "% eq" : "");
  cash.className = "chip" + (s.cash < 0 ? " neg" : "");
  $("#chipGpu").textContent = "⚡ " + fmtNum(computeCap(s)) + " GPU-h/d";
  $("#chipEnergy").textContent = "🔥 " + fmtNum(energyUse(s)) + " / " + fmtNum(energyOwn(s) + energyGrid(s)) + " MW";
  $("#chipData").textContent = "📚 " + g(s.data.clean) + " / " + g(s.data.raw);
  $("#chipStaff").textContent = "👥 " + staffTotal(s);
  const me = labScore(s);
  const all = [...s.rivals.map(r => r.score), me].sort((a, b) => b - a);
  $("#chipRank").textContent = "🏆 #" + (all.indexOf(me) + 1) + "/" + all.length;
}

function renderSpeed(s) {
  setHTML($("#speedCtl"), SPEEDS.map(([v, l]) =>
    `<button class="${s.speed === v ? "acc" : ""}" data-act="speed" data-v="${v}">${l}</button>`).join(""));
}

function renderLog(s) {
  const items = s.log.slice(-8).reverse();
  setHTML($("#log"), items.map(l =>
    `<div class="lg"><span class="d">d${l.day}</span>${esc(l.t)}</div>`).join(""));
}

function renderView(s) {
  const views = { home: viewHome, research: viewResearch, data: viewData, models: viewModels, infra: viewInfra, team: viewTeam, products: viewProducts, community: viewCommunity, money: viewMoney };
  setHTML($("#view"), (views[tab] || viewHome)(s));
}

// ---- tab renderers ----

function panel(title, inner) { return `<div class="panel"><h2>${title}</h2>${inner}</div>`; }
function btn(act, args, label, cls) { return `<button data-act="${act}" data-${Object.entries(args).map(([k, v]) => `${k}="${esc(v)}"`).join(" ")} class="${cls || ""}">${label}</button>`; }
function statCard(k, v, sub) { return `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div>${sub ? `<div class="s">${sub}</div>` : ""}</div>`; }

function viewHome(s) {
  const ep = EPOCHS[s.epoch];
  const repF = 1 + s.rep / 600;
  const gross = dailyRevenue(s);
  const invest = gross * s.equity * 0.35;
  const goals = objectives(s);
  return panel("🛰️ Command Deck", `
    <div class="ep" style="margin-bottom:14px">
      <div class="big">${ep.emoji}</div>
      <div>
        <div class="ttl">${ep.name} · ${s.year}</div>
        <div class="sub">${ep.years} — ${ep.blurb}</div>
      </div>
    </div>
    <div class="grid2" style="margin-bottom:14px">
      ${statCard("Cash", fmtMoney(s.cash), s.cash < 0 ? '<span class="bad">negative!</span>' : "")}
      ${statCard("Revenue / day", fmtMoney(gross), invest > 0 ? "investors take " + fmtMoney(invest) + "/day" : "")}
      ${statCard("Compute", fmtNum(computeCap(s)) + " GPU-h/d", fmtNum(freeCompute(s)) + " free")}
      ${statCard("Clean data", g(s.data.clean), "quality " + dataQuality(s).toFixed(2))}
      ${statCard("Raw data", g(s.data.raw), "crawler " + (s.data.crawlerOn ? "on" : "off"))}
      ${statCard("Energy", fmtNum(energyUse(s)) + " MW", fmtNum(energyOwn(s) + energyGrid(s)) + " supply · " + pct(uptime(s)) + " uptime")}
      ${statCard("Morale", Math.round(s.morale) + "%", "equilibrium " + Math.round(Math.max(0, Math.min(100, 62 + moraleMods(s)))) + "%")}
      ${statCard("Reputation", fmtNum(s.rep), "mindshare")}
      ${statCard("Leaderboard", labScore(s) + " pts", "#" + rankOf(s) + " of " + (s.rivals.length + 1))}
      ${statCard("Valuation", "$" + fmtNum(valuation(s)) + "M", "equity " + Math.round(s.equity * 100) + "%")}
    </div>
    <h3>🎯 Next steps</h3>
    ${goals.map(x => `<div class="row"><span>${x}</span></div>`).join("")}
    <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
      ${btn("press", {}, "📰 Write press release (−$5K)")}
      ${btn("help", {}, "❓ How to play")}
    </div>`);
}

function rankOf(s) {
  const me = labScore(s);
  const all = [...s.rivals.map(r => r.score), me].sort((a, b) => b - a);
  return all.indexOf(me) + 1;
}

function objectives(s) {
  const list = [];
  if (!s.activeResearch && !Object.keys(s.researchDone).length) list.push("🔬 Start your first research in the Research tab.");
  if (!s.dataup.quality) list.push("🧹 Add Quality Filters to your data pipeline (Data tab).");
  if (staffTotal(s) === 0) list.push("👥 Hire a Data Annotator or an ML Engineer (Team tab).");
  if (!s.dataup.crawlfleet) list.push("🕸️ Scale the crawler with a Distributed Crawler Fleet.");
  if (!s.researchDone.perceptron) list.push("🧠 Research toward your first neural network.");
  if (s.researchDone.perceptron && !s.researchDone.transformer) list.push("📚 Push research toward the Transformer era.");
  if (s.data.clean > 0 && !s.activeResearch && list.length <= 2) list.push("💰 Take your first venture round in the Money tab.");
  if (!list.length) list.push("✨ Foundation solid. Train your first real model in the Models tab, then ship an API from Products.");
  return list.slice(0, 4);
}

function viewResearch(s) {
  const epNames = ["📟 Scripted Age", "🧠 Deep Learning Boom", "📚 Transformer Era", "🤖 Agentic Frontier"];
  let out = "";
  if (s.activeResearch) {
    const r = RESEARCH_BY[s.activeResearch];
    const p = s.researchProgress;
    out += panel("🔬 Active research", `
      <div class="row"><span class="lbl">${r.name}</span><span class="val warn">${pct(Math.min(1, p))}</span></div>
      <div class="bar"><i style="width:${pct(Math.min(1, p))}"></i></div>
      <div class="row"><span class="lbl">About ${researchDays(s, r)} days · costs $${
        r.cost}K upfront</span></div>
      <div style="display:flex;gap:8px;margin-top:8px">
        ${btn("expedite", {}, "⚡ Expedite")}
        ${btn("cancelResearch", {}, "✂️ Cancel")}
      </div>`);
  }
  for (let e = 0; e < EPOCHS.length; e++) {
    const items = RESEARCH.filter(r => r.epoch === e);
    if (!items.length) continue;
    out += panel(epNames[e], items.map(r => {
      const done = s.researchDone[r.id];
      const avail = researchAvailable(s, r);
      const miss = r.req.filter(id => !s.researchDone[id]).map(id => RESEARCH_BY[id].name);
      const cheap = r.cost <= s.cash;
      let ctl;
      if (done) ctl = `<span class="tag owned">✓ done</span>`;
      else if (avail) ctl = btn("research", { id: r.id }, "🔬 Research ($" + r.cost + "K)", cheap ? "acc" : "");
      else ctl = `<span class="tag req">needs ${miss.join(", ")}</span>`;
      return `<div class="item">
        <div class="h"><span class="nm">${r.name}</span>${ctl}</div>
        <div class="ds">${esc(r.desc)} · ${r.year} · unlocks: ${esc(r.unlocks)}</div>
        <div class="ds">~${researchDays(s, r)} days ${(s.staff.researcher || 0) ? "(with " + s.staff.researcher + " researcher" + (s.staff.researcher > 1 ? "s" : "") + ")" : ""}</div>
      </div>`;
    }).join(""));
  }
  return out;
}

function viewData(s) {
  const tput = Math.min(rawPerDay(s), processCapacity(s));
  return panel("🗄️ Data pipeline", `
    <div class="grid2" style="margin-bottom:14px">
      ${statCard("Clean tokens", g(s.data.clean), "what models eat")}
      ${statCard("Raw tokens", g(s.data.raw), "awaiting processing")}
      ${statCard("Preference data", g(s.data.pref), "needed for RLHF")}
      ${statCard("Data quality", dataQuality(s).toFixed(2), "out of 1.2")}
      ${statCard("Processing", g(processCapacity(s)) + "/day", g(tput) + " actually cleaned")}
      ${statCard("Crawler yield", g(rawPerDay(s)) + "/day", "uses 10 GPU-h/day")}
    </div>
    <h3>🕷️ Sources</h3>
    <div class="item"><div class="h"><span class="nm">Web crawler</span>
      ${btn("crawler", {}, s.data.crawlerOn ? "⏸ Pause" : "▶ Run", s.data.crawlerOn ? "" : "acc")}</div>
      <div class="ds">Harvests raw web text. Currently ${s.data.crawlerOn ? "running" : "paused"}.</div></div>
    <h3>🔧 Processing upgrades</h3>
    ${DATA_UPGRADES.map(d => {
      const owned = s.dataup[d.id];
      const req = d.req && !s.researchDone[d.req];
      let ctl;
      if (owned) ctl = `<span class="tag owned">✓ owned</span>`;
      else if (req) ctl = `<span class="tag req">needs ${RESEARCH_BY[d.req].name}</span>`;
      else ctl = btn("dataup", { id: d.id }, "🔧 Buy ($" + d.cost + "K)", d.cost <= s.cash ? "acc" : "");
      return `<div class="item"><div class="h"><span class="nm">${d.emoji} ${d.name}</span>${ctl}</div><div class="ds">${esc(d.desc)}</div></div>`;
    }).join("")}
    <h3>📦 Buy data</h3>
    ${DATAPACKS.map(p =>
      `<div class="item"><div class="h"><span class="nm">${p.emoji} ${p.name}</span>
        ${btn("buydata", { id: p.id }, "💰 $" + p.cost + "K", p.cost <= s.cash ? "acc" : "")}</div>
        <div class="ds">${esc(p.desc)}</div></div>`).join("")}
  `);
}

function deployBtns(s, m) {
  const existing = s.products.filter(x => x.modelId === m.id).length;
  if (existing >= 2) return '<span class="tag req">at product cap (2/model)</span>';
  const opts = PRODUCTS.filter(p => p.reqs.every(r => s.researchDone[r]) && capableOf(m, p.need));
  if (!opts.length) return '<span class="tag req">nothing deployable yet</span>';
  return opts.map(p => btn("deploy", { type: p.id, model: m.id }, p.emoji + " " + p.name)).join("");
}

function viewModels(s) {
  const jobs = s.jobs;
  const roster = s.models.slice().sort((a, b) => b.quality - a.quality);
  const bay = jobs.length ? panel("🏭 Training bay", jobs.map(j => {
    const p = Math.min(1, j.hoursAcc / j.hoursReq);
    const wait = j.waiting ? ' <span class="tag req">waiting for data</span>' : "";
    const rates = [["pause", "⏸"], ["100", "100"], ["500", "500"], ["2000", "2k"], ["max", "MAX"]];
    const isActive = v => v === "pause" ? j.rate === 0 : v === "max" ? j.rate >= freeCompute(s) - 1 : j.rate === +v;
    return '<div class="item">' +
      '<div class="h"><span class="nm">' + esc(j.name) + wait + '</span><span class="val warn">' + pct(p) + '</span></div>' +
      '<div class="bar"><i style="width:' + pct(p) + '"></i></div>' +
      '<div class="ds">' + fmtNum(j.hoursAcc) + ' / ' + fmtNum(j.hoursReq) + ' GPU-h · needs ' + g(j.tokensReq) + ' clean · rate ' + fmtNum(j.rate) + ' GPU-h/d</div>' +
      '<div class="btns" style="margin-top:6px">' + rates.map(([v, l]) => btn("setRate", { id: j.id, v }, l, isActive(v) ? "acc" : "")).join("") + btn("cancelJob", { id: j.id }, "✂️ Cancel") + '</div>' +
      '</div>';
  }).join("")) : "";
  const archList = panel("🏗️ Architectures", ARCHES.map(a => {
    const locked = a.req && !s.researchDone[a.req];
    const ctl = locked
      ? '<span class="tag req">needs ' + RESEARCH_BY[a.req].name + '</span>'
      : [["tiny", "Tiny"], ["standard", "Std"], ["massive", "Huge"]].map(([sz, l]) => btn("train", { id: a.id, size: sz }, l, "acc")).join("");
    return '<div class="item"><div class="h"><span class="nm">' + a.emoji + " " + a.name + '</span>' + (locked ? "" : '<span class="val">est Q ' + Math.round(trainQuality(s, a, "standard")) + '</span>') + '</div>' +
      '<div class="ds">' + esc(a.desc) + '</div>' +
      '<div class="ds">' + fmtNum(a.gpu) + " GPU-h · " + g(a.tok) + 'G tokens (std size; Huge = 3×, Tiny = 0.5×)</div>' +
      '<div class="btns" style="margin-top:6px">' + ctl + '</div></div>';
  }).join(""));
  const rosterPanel = panel("🗂️ Model roster", roster.length ? roster.map(m => {
    const a = ARCH_BY[m.arch] || {};
    const tags = [a.emoji, "Q " + Math.round(m.quality), "MMLU " + m.evals.mmlu, m.published ? "🏷 published" : "", m.openSource ? "🌐 open-source" : "", m.rlhf ? "💬 rlhf" : ""].filter(Boolean).map(x => '<span class="tag">' + esc(x) + "</span>").join(" ");
    const acts = [];
    if (!m.lora && s.researchDone.lora) acts.push(btn("lora", { id: m.id }, "🧵 LoRA", "acc"));
    if (!m.rlhf && s.researchDone.rlhf) acts.push(btn("rlhf", { id: m.id }, "💬 RLHF", "acc"));
    if (!m.published && s.researchDone.eval) acts.push(btn("publish", { id: m.id }, "🏷️ Publish", "acc"));
    if (m.published && !m.openSource) acts.push(btn("opensource", { id: m.id }, "🌐 Open-source", "acc"));
    acts.push(btn("archive", { id: m.id }, "🎉 Retire"));
    return '<div class="item"><div class="h"><span class="nm">' + esc(m.name) + '</span><span class="val warn">Q ' + m.quality + '</span></div>' +
      '<div class="ds">' + tags + '</div>' +
      '<div class="ds">MMLU ' + m.evals.mmlu + ' · MATH ' + m.evals.math + (a.code ? " · HumanEval " + m.evals.humaneval : "") + '</div>' +
      '<div class="ds" style="margin-top:4px">Deploy: ' + deployBtns(s, m) + '</div>' +
      '<div class="btns" style="margin-top:6px">' + acts.join("") + '</div></div>';
  }).join("") : '<div class="ds">No models yet.</div>');
  return bay + archList + rosterPanel;
}

function viewInfra(s) {
  const use = energyUse(s), own = energyOwn(s), grid = energyGrid(s);
  const totalCap = computeCap(s);
  const free = freeCompute(s);
  const slots = dcSlots(s), racks = dcRacks(s);
  return panel("🖥️ Compute", `
    <div class="grid2" style="margin-bottom:14px">
      ${statCard("Capacity", fmtNum(totalCap) + " GPU-h/d", fmtNum(free) + " free")}
      ${statCard("Inference", fmtNum(inferenceUse(s)) + " GPU-h/d", s.products.length + " product" + (s.products.length === 1 ? "" : "s"))}
      ${statCard("Crawler", fmtNum(crawlerUse(s)) + " GPU-h/d", s.data.crawlerOn ? "running" : "paused")}
      ${statCard("Energy", fmtNum(use) + " / " + fmtNum(own + grid) + " MW", "grid bill $" + fmtMoney(grid * 0.5) + "/day")}
      ${statCard("Uptime", pct(uptime(s)), s.flags.outageUntil > s.day ? '<span class="bad">power outage!</span>' : "")}
      ${statCard("DC racks", racks + " / " + slots, "build cooling towers for more")}
    </div>
    <h3>🖥️ Hardware</h3>
    ${HARDWARE.filter(h => h.id !== "garage").map(h => {
      const own = s.hardware[h.id] || 0;
      const locked = h.req && !s.researchDone[h.req];
      const shortage = s.flags.shortageUntil > s.day;
      const cost = shortage ? h.cost * 2 : h.cost;
      let ctl;
      if (locked) ctl = `<span class="tag req">needs ${RESEARCH_BY[h.req].name}</span>`;
      else ctl = btn("buyhw", { id: h.id }, "🛒 $" + cost + "K" + (shortage ? " (2×)" : ""), cost <= s.cash ? "acc" : "");
      return `<div class="item"><div class="h"><span class="nm">${h.emoji} ${h.name} <span class="tag">×${own}</span></span>${ctl}</div>
        <div class="ds">${esc(h.desc)} · +${h.gpuH} GPU-h/d · ${h.mw} MW · maint $${fmtMoney(h.maint)}/day</div></div>`;
    }).join("")}
    <div class="item"><div class="h"><span class="nm">☁️ Serverless cloud burst</span>
      ${s.researchDone.spotmarket ? btn("cloud", {}, s.cloud.on ? "Disable" : "Enable", s.cloud.on ? "" : "acc") : `<span class="tag req">needs GPU Spot Market research</span>`}</div>
      <div class="ds">+1000 GPU-h/day for $1.5K/day. No capex. ${s.cloud.on ? "Currently <b>active</b>." : ""}</div></div>
    <h3>🏗️ Buildings & power</h3>
    ${BUILDINGS.map(b => {
      const own = s.buildings[b.id] || 0;
      const locked = b.req && !s.researchDone[b.req];
      let ctl;
      if (locked) ctl = `<span class="tag req">needs ${RESEARCH_BY[b.req].name}</span>`;
      else if (b.slot && racks >= slots) ctl = `<span class="tag req">no free DC slot</span>`;
      else ctl = btn("buybuild", { id: b.id }, "🛒 $" + b.cost + "K", b.cost <= s.cash ? "acc" : "");
      return `<div class="item"><div class="h"><span class="nm">${b.emoji} ${b.name} <span class="tag">×${own}</span></span>${ctl}</div>
        <div class="ds">${esc(b.desc)}</div></div>`;
    }).join("")}
  `);
}

function viewTeam(s) {
  const target = Math.max(0, Math.min(100, 62 + moraleMods(s)));
  return panel("👥 Team & morale", `
    <div class="grid2" style="margin-bottom:14px">
      ${statCard("Morale", Math.round(s.morale) + "%", "equilibrium " + Math.round(target) + "%")}
      ${statCard("Headcount", staffTotal(s), "salaries $" + fmtMoney(STAFF.reduce((a, r) => a + (s.staff[r.id] || 0) * r.salary, 0)) + "/day")}
    </div>
    <div class="bar" style="margin-bottom:14px"><i style="width:${Math.round(s.morale)}%"></i></div>
    ${STAFF.map(r => {
      const n = s.staff[r.id] || 0;
      const locked = r.req && !s.researchDone[r.req];
      const tag = r.agent ? '<span class="tag">🤖 agent</span>' : "";
      return `<div class="item"><div class="h"><span class="nm">${r.emoji} ${r.name} ${tag}</span>
        <span><span class="tag owned">×${n}</span> $${r.salary.toFixed(2)}K/day</span></div>
        <div class="ds">${esc(r.role)}</div>
        <div style="display:flex;gap:6px;margin-top:6px;justify-content:flex-end">
          ${locked ? `<span class="tag req">needs ${RESEARCH_BY[r.req].name}</span>` : btn("hire", { id: r.id }, "➕ Hire", "acc")}
          ${btn("fire", { id: r.id }, "➖ Fire", "")}
        </div></div>`;
    }).join("")}
    <h3>🍪 Perks</h3>
    ${[
      ["snack", "🍿 Snack budget", 0.5, "Morale +6 · $0.5K/day"],
      ["health", "🩺 Health benefits", 1, "Morale +8 · $1K/day"],
      ["stock", "📈 Stock options", 0, "Morale +5 · no dilution (it is cozy)"],
    ].map(([id, nm, c, ds]) => {
      const on = s.perks[id];
      return `<div class="item"><div class="h"><span class="nm">${nm}</span>
        ${btn("perk", { id }, on ? "✅ On" : "Off", on ? "" : "acc")}</div><div class="ds">${ds}${c ? " · $" + c + "K/day" : ""}</div></div>`;
    }).join("")}
  `);
}

function viewProducts(s) {
  const gross = dailyRevenue(s);
  const invest = gross * s.equity * 0.35;
  return panel("🚀 Products & revenue", '<div class="grid2" style="margin-bottom:14px">' +
    statCard("Revenue / day", fmtMoney(gross), invest > 0 ? "investors take " + fmtMoney(invest) + "/day" : "") +
    statCard("Active products", s.products.length, "each uses GPU-h/day") +
    statCard("Inference load", fmtNum(inferenceUse(s)) + " GPU-h/d", "of " + fmtNum(computeCap(s)) + " capacity") +
    statCard("Contracts", s.contracts.length, s.contractOffer ? '<span class="warn">offer on the table!</span>' : "") +
    "</div>" +
    (s.products.length ? s.products.map(p => {
      const m = s.models.find(x => x.id === p.modelId);
      const pd = PRODUCTS.find(x => x.id === p.type);
      return '<div class="item"><div class="h"><span class="nm">' + esc(p.name) + '</span>' +
        btn("shutdown", { id: p.id }, "🔌 Shut down") + '</div>' +
        '<div class="ds">powered by ' + (m ? esc(m.name) : "?") + " · uses " + (pd ? pd.gpuUse : "?") + " GPU-h/day</div></div>";
    }).join("") : '<div class="ds">No products yet. Train a model in the Models tab, then deploy it here.</div>') +
    (s.contracts.length ? panel("🤝 Active contracts", s.contracts.map(c =>
      '<div class="row"><span class="lbl">' + esc(c.name) + '</span><span class="val">' + fmtMoney(c.perDay) + "/day · " + c.remaining + "d left</span></div>").join("")) : "") +
    panel("📱 App store & gateway", '<div class="ds">Ship models to the API gateway and app store. New product lines unlock with research — check the Models tab deploy buttons. ' + (s.products.length ? "Your " + s.products.length + " product" + (s.products.length === 1 ? " is" : "s are") + " earning " + fmtMoney(gross) + "/day." : "") + "</div>")
  );
}
function viewCommunity(s) {
  const me = labScore(s);
  const rows = [...s.rivals.map(r => ({ name: r.name, emoji: r.emoji, score: r.score, you: false })),
    { name: s.company, emoji: "🏭", score: me, you: true }].sort((a, b) => b.score - a.score);
  return panel("🏆 Leaderboard", `
    <div class="grid2" style="margin-bottom:14px">
      ${statCard("Your score", me, "best MMLU + published + open-source")}
      ${statCard("Rank", "#" + rankOf(s) + " / " + (s.rivals.length + 1), "vs 4 rival labs")}
      ${statCard("Reputation", fmtNum(s.rep), "mindshare")}
    </div>
    ${rows.map((r, i) => `<div class="item"><div class="h">
      <span class="nm">${i + 1}. ${r.emoji} ${esc(r.name)} ${r.you ? '<span class="tag">you</span>' : ""}</span>
      <span class="val warn">${fmtNum(r.score)}</span></div></div>`).join("")}
    <h3>🧭 Next build phase</h3>
    <div class="ds">Publishing models for reputation, open-sourcing weights for community goodwill, and retirement parties arrive with model training.</div>
  `);
}

function viewMoney(s) {
  const v = valuation(s);
  const gross = dailyRevenue(s);
  const invest = gross * s.equity * 0.35;
  const roundsLeft = ROUNDS.slice(s.roundsTaken);
  return panel("💰 Money & venture", `
    <div class="grid2" style="margin-bottom:14px">
      ${statCard("Cash", fmtMoney(s.cash), "")}
      ${statCard("Valuation", "$" + fmtNum(v) + "M", "rev·80 + rep·0.5 + quality·0.3")}
      ${statCard("Equity held by investors", Math.round(s.equity * 100) + "%", invest > 0 ? "they take " + fmtMoney(invest) + "/day" : "no cut yet")}
      ${statCard("Revenue / day", fmtMoney(gross), s.contracts.length + " active contract" + (s.contracts.length === 1 ? "" : "s"))}
    </div>
    <h3>💸 Venture rounds</h3>
    ${roundsLeft.length ? roundsLeft.map(rd => {
      const eligible = v >= rd.val;
      return `<div class="item"><div class="h"><span class="nm">${rd.name}</span>
        ${btn("round", {}, "Raise $" + rd.val + "M", eligible && s.equity < 0.6 ? "acc" : "")}</div>
        <div class="ds">${esc(rd.desc)} · needs $${rd.val}M valuation (you have $${fmtNum(v)}M) · gives ${Math.round(rd.share * 100)}% equity</div></div>`;
    }).join("") : `<div class="ds">All rounds taken. On to the IPO.</div>`}
    ${s.roundsTaken >= 5 ? `<h3>🕊️ IPO</h3>
      <div class="item"><div class="h"><span class="nm">Take the company public</span>
        ${btn("ipo", {}, "🕊️ IPO", "acc")}</div>
        <div class="ds">Needs valuation ≥ $5000M (you have ${fmtNum(v)}M) and investor equity under 35% (now ${Math.round(s.equity * 100)}%).</div></div>` : ""}
    <h3>💾 Save / load</h3>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      ${btn("save", {}, "💾 Save now")}
      ${btn("load", {}, "📂 Load")}
      ${btn("newgame", {}, "🆕 New game")}
    </div>
    <div class="ds" style="margin-top:8px">Autosaves every 30 days${game.kv ? "" : " — saving unavailable (no kv plugin)"}.</div>
  `);
}

// ---- actions ----
async function onAction(e) {
  let b = e.target.closest("[data-act]");
  if (!b && e.clientX !== 0 && e.clientY !== 0) {
    const at = document.elementFromPoint(e.clientX, e.clientY);
    b = at ? at.closest("[data-act]") : null;
  }
  if (!b) return;
  const act = b.dataset.act;
  const s = game.state;
  let r = null;
  switch (act) {
    case "continue": blockTicks = false; closeModal(); break;
    case "fresh": game.state = game.newGame(); game.save(true); blockTicks = false; closeModal(); break;
    case "closeModal": blockTicks = false; closeModal(); break;
    case "help": blockTicks = true; showModal(helpHTML(), false); break;
    case "speed": game.speed(+b.dataset.v); break;
    case "press": toast("📰 Drafting press release…"); r = await game.pressRelease(); break;
    case "research": r = game.startResearch(b.dataset.id); break;
    case "expedite": r = game.expediteResearch(); break;
    case "cancelResearch": r = game.cancelResearch(); break;
    case "crawler": r = game.toggleCrawler(); break;
    case "buydata": r = game.buyData(b.dataset.id); break;
    case "dataup": r = game.dataUpgrade(b.dataset.id); break;
    case "buyhw": r = game.buyHardware(b.dataset.id); break;
    case "buybuild": r = game.buyBuilding(b.dataset.id); break;
    case "cloud": r = game.cloudToggle(); break;
    case "hire": r = game.hire(b.dataset.id); break;
    case "fire": r = game.fire(b.dataset.id); break;
    case "perk": r = game.perk(b.dataset.id); break;
    case "round": r = game.takeRound(); break;
    case "ipo": r = game.takeIPO(); break;
    case "train": r = game.train(b.dataset.id, b.dataset.size); break;
    case "setRate": r = game.setRate(b.dataset.id, b.dataset.v); break;
    case "cancelJob": r = game.cancelJob(b.dataset.id); break;
    case "lora": r = game.finetune(b.dataset.id, "lora"); break;
    case "rlhf": r = game.finetune(b.dataset.id, "rlhf"); break;
    case "publish": r = game.publish(b.dataset.id); break;
    case "opensource": r = game.openSource(b.dataset.id); break;
    case "archive": r = game.archive(b.dataset.id); break;
    case "deploy": r = game.deploy(b.dataset.type, b.dataset.model); break;
    case "shutdown": r = game.shutdown(b.dataset.id); break;
    case "resolveEvent": r = game.resolveEvent(+b.dataset.i); closeModal(); break;
    case "sandbox": r = game.sandbox(); closeModal(); break;
    case "save": r = await game.save(); if (r) toast("💾 Saved"); else toast("⚠️ Save failed"); break;
    case "load": {
      const d = await game.load();
      if (d) { tab = "home"; toast("📂 Loaded save from " + new Date(d.saved).toLocaleString()); }
      else toast("No save found.");
      break;
    }
    case "newgame":
      if (confirm("Start a brand new company? Current progress will be overwritten.")) { game.state = game.newGame(); game.save(true); }
      break;
  }
  if (r && r !== "ok") toast(r);
  render();
}

// debug/test hook
window.SimAI = { render, closeModal, showModal, getTab: () => tab, setTab: t => { tab = t; } };
