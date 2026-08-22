// SimAI — game engine: state, daily tick, actions, save/load.
import {
  EPOCHS, RESEARCH, RESEARCH_BY, ARCH_BY, HARDWARE_BY, BUILDING_BY, STAFF_BY,
  DATAPACKS, DATAUP_BY, RIVALS, SIZES, NAME_SUFFIXES, PRODUCT_BY, EVENTS, GAME_LOSE_LOGS,
  addLog, productivity, moraleMods, staffTotal, dcRacks, dcSlots,
  energyUse, energyOwn, energyGrid, computeCap, inferenceUse, crawlerUse, freeCompute,
  rawPerDay, processCapacity, dataQuality, researchDays, researchAvailable,
  dailyRevenue, labScore, valuation, epochOf, yearOf, evalsFor, capableOf,
  engineerReduction, trainQuality, incidentChance, contractChance, makeContractOffer,
} from "./defs.js";

let _uid = 0;
function uid() {
  _uid++;
  return "u" + _uid.toString(36) + Math.random().toString(36).slice(2, 6);
}

export class Game {
  constructor() { this.state = null; this.kv = null; }

  newGame() {
    const s = {
      company: "SimAI Labs",
      day: 1, speed: 3,
      cash: 250, equity: 0, rep: 0,
      researchDone: {}, activeResearch: null, researchProgress: 0,
      data: { raw: 0.05, clean: 0.01, pref: 0, quality: 0.3, crawlerOn: true },
      dataup: {},
      hardware: { garage: 1 },
      buildings: {},
      cloud: { on: false },
      staff: {},
      perks: {},
      models: [
        { id: uid(), arch: "rule-chat", name: "Rule-Based Chatbot Mk I", quality: 8, trainedDay: 1, deployed: false, published: false, openSource: false, lora: false, rlhf: false },
      ],
      jobs: [],
      products: [],
      contracts: [],
      contractOffer: null,
      roundsTaken: 0,
      morale: 62,
      pendingEvent: null,
      flags: { winterUntil: 0, shortageUntil: 0, outageUntil: 0, productHaltUntil: 0, lastRogueDay: -99, offerDeclined: 0, flavorNext: 5, openTimer: 0, fineTimer: 0 },
      stats: { trained: 1, published: 0, openSourced: 0, incidents: 0, contracts: 0, revenue: 0, rounds: 0 },
      log: [],
      rivals: RIVALS.map(r => ({ ...r })),
      gameOver: null, finalNote: null,
      saveCounter: 0,
    };
    s.models[0].evals = evalsFor(s.models[0]);
    s.year = yearOf(s);
    s.epoch = epochOf(s);
    addLog(s, "🏁 " + s.company + " founded in a garage. One GPU, one rule-based chatbot, and a dream.");
    return s;
  }

  log(s, text) { addLog(s, text); }

  tick() {
    const s = this.state;
    if (!s || s.pendingEvent || s.gameOver) return;
    s.day++;
    s.year = yearOf(s);
    s.epoch = epochOf(s);

    // morale drifts toward equilibrium
    const target = Math.max(0, Math.min(100, 62 + moraleMods(s)));
    s.morale += (target - s.morale) * 0.05;

    // compute allocation: inference -> crawler -> training jobs
    const cap = computeCap(s);
    const inf = inferenceUse(s);
    const crw = crawlerUse(s);
    let free = Math.max(0, cap - inf - crw);
    for (const j of s.jobs) {
      if (j.finished || j.rate <= 0) continue;
      const give = Math.min(j.rate, free);
      j.hoursAcc += give;
      free -= give;
    }

    // job completion
    for (const j of s.jobs) {
      if (j.finished || j.hoursAcc < j.hoursReq) continue;
      const needPref = j.kind === "rlhf" && s.data.pref < 0.1;
      if (s.data.clean >= j.tokensReq && !needPref) {
        s.data.clean -= j.tokensReq;
        if (j.kind === "train") {
          const arch = ARCH_BY[j.arch];
          const model = {
            id: uid(), arch: j.arch, name: j.name, quality: Math.round(trainQuality(s, arch, j.size) * 10) / 10,
            trainedDay: s.day, deployed: false, published: false, openSource: false, lora: false, rlhf: false,
          };
          model.evals = evalsFor(model);
          s.models.push(model);
          s.stats.trained++;
          j.finished = true;
          this.log(s, "🎉 Trained: " + j.name + " (quality " + Math.round(model.quality) + ", MMLU " + model.evals.mmlu + ")");
        } else if (j.kind === "lora" || j.kind === "rlhf") {
          const m = s.models.find(x => x.id === j.modelId);
          if (m) {
            if (j.kind === "lora") {
              m.lora = true;
              m.quality = Math.min(99, Math.round((m.quality + 6) * 10) / 10);
              this.log(s, "🧵 LoRA complete: " + m.name + " quality +6.");
            } else {
              s.data.pref = Math.max(0, s.data.pref - 0.1);
              m.rlhf = true;
              m.quality = Math.min(99, Math.round((m.quality + 10) * 10) / 10);
              this.log(s, "💬 RLHF complete: " + m.name + " quality +10, chat-capable.");
            }
            m.evals = evalsFor(m);
          }
          j.finished = true;
        }
      } else if (!j.waiting) {
        j.waiting = true;
        this.log(s, "⏳ " + j.name + " is waiting for " + (needPref ? "preference data (buy it in the Data tab)" : "clean tokens") + ".");
      }
    }
    s.jobs = s.jobs.filter(j => !j.finished);

    // data pipeline
    if (!(s.flags.outageUntil > s.day)) s.data.raw += rawPerDay(s);
    const processed = Math.min(s.data.raw, processCapacity(s));
    s.data.raw -= processed;
    s.data.clean += processed;
    if (s.dataup.distill) s.data.clean += 0.05;
    if (s.dataup.flywheel) s.data.clean += 0.01 * s.products.length;
    s.data.quality = dataQuality(s);

    // money: revenue, investor cut, salaries, maintenance, energy, perks, cloud
    const gross = dailyRevenue(s);
    const investorCut = gross * s.equity * 0.35;
    s.cash += gross - investorCut;
    s.stats.revenue += gross;
    for (const c of s.contracts) c.remaining--;
    s.contracts = s.contracts.filter(c => c.remaining > 0);

    let salaries = 0;
    for (const role of Object.values(STAFF_BY)) salaries += (s.staff[role.id] || 0) * role.salary;
    s.cash -= salaries;

    let maint = 0;
    for (const [id, q] of Object.entries(s.hardware)) maint += (HARDWARE_BY[id].maint || 0) * q;
    for (const [id, q] of Object.entries(s.buildings)) maint += (BUILDING_BY[id].maint || 0) * q;
    s.cash -= maint;

    s.cash -= energyGrid(s) * 0.5;
    if (s.perks.snack) s.cash -= 0.5;
    if (s.perks.health) s.cash -= 1;
    if (s.cloud.on) s.cash -= 1.5;

    // research
    if (s.activeResearch) {
      const r = RESEARCH_BY[s.activeResearch];
      s.researchProgress += (1 / researchDays(s, r)) * productivity(s);
      if (s.researchProgress >= 1) {
        const oldEpoch = epochOf(s);
        s.researchDone[s.activeResearch] = true;
        s.activeResearch = null;
        s.researchProgress = 0;
        s.year = yearOf(s);
        s.epoch = epochOf(s);
        this.log(s, "💡 Research complete: " + r.name);
        if (s.epoch > oldEpoch) {
          const ep = EPOCHS[s.epoch];
          this.log(s, "🎉 Welcome to the " + ep.name + " (" + ep.years + ") — " + ep.blurb);
        }
      }
    }

    // agents (auto-behaviors)
    if ((s.staff.shipping || 0) > 0) {
      const sell = Math.min(s.data.clean, 0.5);
      if (sell > 0.05) { s.data.clean -= sell; s.cash += sell * 1.5; }
      const c = computeCap(s);
      const f = freeCompute(s);
      if (f > c * 0.4) s.cash += (f - c * 0.4) * 0.001;
    }
    if ((s.staff.evaluator || 0) > 0) s.rep += 0.8;
    if ((s.staff.finetuner || 0) > 0 && s.researchDone.lora) {
      s.flags.fineTimer++;
      if (s.flags.fineTimer >= 6) {
        s.flags.fineTimer = 0;
        const m = s.models.filter(x => !x.lora).sort((a, b) => b.quality - a.quality)[0];
        if (m && !s.jobs.some(j => j.kind === "lora" && j.modelId === m.id && !j.finished)) {
          const hours = Math.max(50, Math.ceil(ARCH_BY[m.arch].gpu * 0.08));
          s.jobs.push({ id: uid(), kind: "lora", modelId: m.id, name: "LoRA: " + m.name, rate: Math.min(200, freeCompute(s) || 50), hoursAcc: 0, hoursReq: hours, tokensReq: 0.1, waiting: false, finished: false });
          this.log(s, "🧵 Finetuner agent started a LoRA on " + m.name + ".");
        }
      }
    }
    if ((s.staff.opensourcer || 0) > 0 && s.rep > 40) {
      s.flags.openTimer++;
      if (s.flags.openTimer >= 5) {
        const m = s.models.filter(x => !x.published).sort((a, b) => a.quality - b.quality)[0];
        s.flags.openTimer = 0;
        if (m) {
          m.published = true; m.openSource = true;
          s.stats.published++; s.stats.openSourced++;
          s.rep += 12;
          this.log(s, "🌐 Open-Sourcer released " + m.name + " to the community. Rep +12.");
        }
      }
    }

    // quit chance
    for (const role of Object.values(STAFF_BY)) {
      const n = s.staff[role.id] || 0;
      for (let i = 0; i < n; i++) {
        if (Math.random() < 0.0015 * (1 - s.morale / 110)) {
          s.staff[role.id]--;
          this.log(s, "👋 A " + role.name + " left the company. (" + (s.staff[role.id]) + " remaining)");
        }
      }
    }

    // rivals advance
    for (const r of s.rivals) {
      r.score += r.growth * (0.8 + Math.random() * 0.6);
      if (Math.random() < 0.003) {
        const bump = 8 + Math.random() * 15;
        r.score += bump;
        this.log(s, "📡 " + r.name + " claims a new SOTA. Leaderboard score +" + Math.round(bump) + ".");
      }
    }

    // flavor news
    if (s.day >= s.flags.flavorNext) {
      s.flags.flavorNext = s.day + 6 + Math.floor(Math.random() * 6);
      const pool = ["The local GPU scalper has been seen weeping outside your office.", "Your office plant was promoted to Senior Director of Vibes.", "A subreddit called you 'the cozy lab' and it has been growing since.", "Someone taped 'DO NOT PET THE GPUs' to the rack.", "Your youngest intern asked why the GPUs hum like that. Nobody knew.", "The espresso machine unionized. You gave them a raise.", "A delivery drone crash-landed on your roof with pizza meant for a rival.", "The board suggested 'synergy'. You filed it under 'bad ideas'."];
      let pick = Math.floor(Math.random() * pool.length);
      if (pick === s.flags.lastFlavor) pick = (pick + 1) % pool.length;
      s.flags.lastFlavor = pick;
      this.log(s, "☕ " + pool[pick]);
    }

    // random events
    if (!s.pendingEvent && Math.random() < incidentChance(s)) {
      const candidates = EVENTS.filter(e => e.cond(s));
      if (candidates.length) {
        const total = candidates.reduce((a, e) => a + e.weight, 0);
        let r = Math.random() * total;
        let pick = candidates[0];
        for (const e of candidates) { r -= e.weight; if (r <= 0) { pick = e; break; } }
        s.pendingEvent = { id: pick.id, title: pick.title, text: pick.text, choices: pick.choices };
      }
    }

    // enterprise contract offers
    if (!s.pendingEvent && !s.contractOffer && s.contracts.length === 0 && Math.random() < contractChance(s)) {
      const off = makeContractOffer(s);
      s.contractOffer = off;
      s.pendingEvent = {
        id: "contract", title: "🤝 Enterprise deal", text: off.name + " — a " + off.days + "-day deal paying $" + off.total + "K in total (about $" + Math.round(off.total / off.days) + "K/day).",
        choices: [
          { label: "🤝 Accept", apply: st => { st.contracts.push({ id: uid(), name: off.name, total: off.total, perDay: off.total / off.days, remaining: off.days }); st.contractOffer = null; st.stats.contracts++; addLog(st, "🤝 Signed enterprise deal: " + off.name + " ($" + off.total + "K over " + off.days + " days)."); } },
          { label: "🚫 Decline", apply: st => { st.contractOffer = null; addLog(st, "You passed on the " + off.name + " deal."); } },
        ],
      };
    }

    // bankruptcy / rescue
    if (s.cash < -60) {
      if (s.equity >= 0.65) {
        s.gameOver = "bust";
        s.finalNote = "The investors pulled the plug on " + s.company + ". " + GAME_LOSE_LOGS[Math.floor(Math.random() * GAME_LOSE_LOGS.length)];
        this.log(s, "💀 The investors pulled the plug. The garage door closes for the last time.");
      } else {
        s.cash += 150;
        s.equity = Math.min(0.8, s.equity + 0.2);
        this.log(s, "🚨 Emergency rescue round: +$150K for 20% more equity.");
      }
    }

    // autosave every 30 days
    s.saveCounter++;
    if (s.saveCounter >= 30) {
      s.saveCounter = 0;
      this.save(true);
    }
  }

  // ---- actions ----

  startResearch(id) {
    const s = this.state;
    if (s.activeResearch) return "A research project is already running.";
    const r = RESEARCH_BY[id];
    if (!r || s.researchDone[id]) return "Cannot start that research.";
    if (!researchAvailable(s, r)) return "Prerequisites not met.";
    if (s.cash < r.cost) return "Not enough cash ($" + r.cost + "K needed).";
    s.cash -= r.cost;
    s.activeResearch = id;
    s.researchProgress = 0;
    this.log(s, "🔬 Started research: " + r.name + " (about " + researchDays(s, r) + " days).");
    return "ok";
  }

  expediteResearch() {
    const s = this.state;
    if (!s.activeResearch) return "No active research.";
    const r = RESEARCH_BY[s.activeResearch];
    const frac = 1 - s.researchProgress;
    const cost = Math.ceil(r.cost * 1.5 * frac);
    if (s.cash < cost) return "Not enough cash to expedite.";
    s.cash -= cost;
    s.researchProgress = 1;
    this.log(s, "⚡ Expedited: " + r.name + " (paid $" + cost + "K).");
    return "ok";
  }

  cancelResearch() {
    const s = this.state;
    if (!s.activeResearch) return "No active research.";
    s.activeResearch = null;
    s.researchProgress = 0;
    this.log(s, "✂️ Research cancelled. (No refunds.)");
    return "ok";
  }

  toggleCrawler() {
    const s = this.state;
    s.data.crawlerOn = !s.data.crawlerOn;
    this.log(s, s.data.crawlerOn ? "🕷️ Web crawler switched on." : "🕷️ Web crawler paused.");
    return "ok";
  }

  buyData(id) {
    const s = this.state;
    const p = DATAPACKS.find(x => x.id === id);
    if (!p) return "Unknown data pack.";
    if (s.cash < p.cost) return "Not enough cash ($" + p.cost + "K needed).";
    s.cash -= p.cost;
    if (p.raw) s.data.raw += p.raw;
    if (p.clean) s.data.clean += p.clean;
    if (p.pref) s.data.pref += p.pref;
    this.log(s, "📦 Bought data: " + p.name + ".");
    return "ok";
  }

  dataUpgrade(id) {
    const s = this.state;
    if (s.dataup[id]) return "Already owned.";
    const d = DATAUP_BY[id];
    if (!d) return "Unknown upgrade.";
    if (d.req && !s.researchDone[d.req]) return "Requires research: " + RESEARCH_BY[d.req].name + ".";
    if (s.cash < d.cost) return "Not enough cash ($" + d.cost + "K needed).";
    s.cash -= d.cost;
    s.dataup[id] = true;
    this.log(s, "🔧 Data pipeline upgraded: " + d.name + ".");
    return "ok";
  }

  // ---- models & products ----

  train(archId, sizeId) {
    const s = this.state;
    const arch = ARCH_BY[archId];
    if (!arch) return "Unknown architecture.";
    if (arch.req && !s.researchDone[arch.req]) return "Locked — research " + RESEARCH_BY[arch.req].name + " first.";
    if (!SIZES[sizeId]) return "Unknown training size.";
    const size = SIZES[sizeId];
    const hours = Math.max(1, Math.ceil(arch.gpu * size.compute * engineerReduction(s)));
    const tok = arch.tok * size.tokens;
    const name = arch.name + " " + NAME_SUFFIXES[s.stats.trained % NAME_SUFFIXES.length];
    const rate = Math.max(0, Math.round(Math.min(freeCompute(s), Math.max(50, hours / 5))));
    const job = { id: uid(), kind: "train", arch: archId, name, size: sizeId, rate, hoursAcc: 0, hoursReq: hours, tokensReq: tok, waiting: false, finished: false };
    s.jobs.push(job);
    this.log(s, "🏭 Began training " + name + " (" + hours + " GPU-h, " + tok + "G tokens) at " + rate + " GPU-h/day.");
    return "ok";
  }

  setRate(jobId, v) {
    const s = this.state;
    const j = s.jobs.find(x => x.id === jobId);
    if (!j) return "No such job.";
    if (v === "pause") j.rate = 0;
    else if (v === "max") {
      const cap = computeCap(s), inf = inferenceUse(s), crw = crawlerUse(s);
      let used = inf + crw;
      for (const k of s.jobs) {
        if (k.id === j.id || k.finished || k.rate <= 0) continue;
        used += Math.min(k.rate, Math.max(0, cap - used));
      }
      j.rate = Math.max(0, Math.round(cap - used));
    }
    else j.rate = Math.max(0, +v || 0);
    return "ok";
  }

  cancelJob(jobId) {
    const s = this.state;
    const j = s.jobs.find(x => x.id === jobId);
    if (!j) return "No such job.";
    s.jobs = s.jobs.filter(x => x.id !== jobId);
    this.log(s, "🗑️ Cancelled training job: " + j.name + ".");
    return "ok";
  }

  finetune(modelId, kind) {
    const s = this.state;
    const m = s.models.find(x => x.id === modelId);
    if (!m) return "No such model.";
    const arch = ARCH_BY[m.arch];
    if (kind === "lora") {
      if (!s.researchDone.lora) return "Requires research: LoRA Fine-Tuning.";
      if (m.lora) return "Already LoRA-tuned.";
      const hours = Math.max(50, Math.ceil(arch.gpu * 0.08));
      const tok = 0.1;
      s.jobs.push({ id: uid(), kind: "lora", modelId, name: "LoRA: " + m.name, rate: Math.min(200, freeCompute(s) || 50), hoursAcc: 0, hoursReq: hours, tokensReq: tok, waiting: false, finished: false });
      this.log(s, "🧵 Started LoRA fine-tune on " + m.name + ".");
      return "ok";
    }
    if (kind === "rlhf") {
      if (!s.researchDone.rlhf) return "Requires research: RLHF & Chat Alignment.";
      if (m.rlhf) return "Already RLHF-tuned.";
      if (s.data.pref < 0.1) return "Need 0.1G preference data — buy Human Preference Pairs in the Data tab.";
      const hours = Math.max(200, Math.ceil(arch.gpu * 0.3));
      const tok = 2;
      s.jobs.push({ id: uid(), kind: "rlhf", modelId, name: "RLHF: " + m.name, rate: Math.min(400, freeCompute(s) || 100), hoursAcc: 0, hoursReq: hours, tokensReq: tok, waiting: false, finished: false });
      this.log(s, "💬 Started RLHF alignment on " + m.name + ".");
      return "ok";
    }
    return "Unknown tuning kind.";
  }

  publish(modelId) {
    const s = this.state;
    const m = s.models.find(x => x.id === modelId);
    if (!m) return "No such model.";
    if (m.published) return "Already published.";
    if (!s.researchDone.eval) return "Requires research: Eval Harness.";
    m.published = true;
    s.stats.published++;
    const rep = Math.round(8 + 0.1 * m.quality);
    s.rep += rep;
    this.log(s, "🏷️ Published " + m.name + " with benchmarks. Rep +" + rep + ".");
    return "ok";
  }

  openSource(modelId) {
    const s = this.state;
    const m = s.models.find(x => x.id === modelId);
    if (!m) return "No such model.";
    if (m.openSource) return "Already open-sourced.";
    if (!m.published) return "Publish the model first.";
    m.openSource = true;
    s.stats.openSourced++;
    const rep = Math.round(6 + 0.08 * m.quality);
    s.rep += rep;
    this.log(s, "🌐 Released " + m.name + " weights & paper. Rep +" + rep + ". (Product income from it −15%, community loves you.)");
    return "ok";
  }

  archive(modelId) {
    const s = this.state;
    const m = s.models.find(x => x.id === modelId);
    if (!m) return "No such model.";
    s.products = s.products.filter(p => p.modelId !== modelId);
    s.models = s.models.filter(x => x.id !== modelId);
    s.rep += 2;
    this.log(s, "🎉 " + m.name + " retired with a farewell post and a cake. Rep +2.");
    return "ok";
  }

  deploy(type, modelId) {
    const s = this.state;
    const pdef = PRODUCT_BY[type];
    const m = s.models.find(x => x.id === modelId);
    if (!pdef || !m) return "Invalid deployment.";
    if (pdef.reqs.some(r => !s.researchDone[r])) return "Requires research for this product line.";
    if (!capableOf(m, pdef.need)) return m.name + " can't power this product.";
    const existing = s.products.filter(x => x.modelId === modelId).length;
    if (existing >= 2) return m.name + " already powers 2 product lines. Use another model.";
    if (freeCompute(s) < pdef.gpuUse) return "Not enough free compute. Buy more GPUs first.";
    s.products.push({ id: uid(), type, modelId, launched: s.day, name: pdef.emoji + " " + pdef.name });
    m.deployed = true;
    this.log(s, "🚀 Launched " + pdef.name + " powered by " + m.name + ".");
    return "ok";
  }

  shutdown(productId) {
    const s = this.state;
    const p = s.products.find(x => x.id === productId);
    if (!p) return "No such product.";
    s.products = s.products.filter(x => x.id !== productId);
    const m = s.models.find(x => x.id === p.modelId);
    if (m) m.deployed = s.products.some(x => x.modelId === m.id);
    this.log(s, "🔌 Shut down " + p.name + ".");
    return "ok";
  }

  resolveEvent(i) {
    const s = this.state;
    if (!s.pendingEvent) return "No pending event.";
    const ev = s.pendingEvent;
    const ch = ev.choices[i];
    if (ch && ch.apply) ch.apply(s);
    s.pendingEvent = null;
    return "ok";
  }

  sandbox() {
    const s = this.state;
    if (!s.gameOver) return;
    s.gameOver = null;
    s.sandbox = true;
    this.log(s, "🏝️ Sandbox mode: keep building. The game is won, the lab lives on.");
    return "ok";
  }

  // ---- infra & people ----

  buyHardware(id) {
    const s = this.state;
    const h = HARDWARE_BY[id];
    if (!h) return "Unknown hardware.";
    if (h.cost <= 0) return "That's your starting gear.";
    if (h.req && !s.researchDone[h.req]) return "Requires research: " + RESEARCH_BY[h.req].name + ".";
    let cost = h.cost;
    if (s.flags.shortageUntil > s.day) cost *= 2;
    if (s.cash < cost) return "Not enough cash.";
    s.cash -= cost;
    s.hardware[id] = (s.hardware[id] || 0) + 1;
    this.log(s, "🖥️ Purchased: " + h.name + " (+" + h.gpuH + " GPU-h/day).");
    return "ok";
  }

  buyBuilding(id) {
    const s = this.state;
    const b = BUILDING_BY[id];
    if (!b) return "Unknown building.";
    if (b.req && !s.researchDone[b.req]) return "Requires research: " + RESEARCH_BY[b.req].name + ".";
    if (id === "dcrack" && dcRacks(s) >= dcSlots(s)) return "No free data center slots. Build a Cooling Tower first.";
    if (s.cash < b.cost) return "Not enough cash.";
    s.cash -= b.cost;
    s.buildings[id] = (s.buildings[id] || 0) + 1;
    this.log(s, "🏗️ Built: " + b.name + ".");
    return "ok";
  }

  cloudToggle() {
    const s = this.state;
    if (!s.researchDone.spotmarket) return "Requires research: GPU Spot Market.";
    s.cloud.on = !s.cloud.on;
    this.log(s, s.cloud.on ? "☁️ Serverless cloud burst enabled (+1000 GPU-h/day, $1.5K/day)." : "☁️ Cloud burst disabled.");
    return "ok";
  }

  hire(id) {
    const s = this.state;
    const r = STAFF_BY[id];
    if (!r) return "Unknown role.";
    if (r.req && !s.researchDone[r.req]) return "Requires research: " + RESEARCH_BY[r.req].name + ".";
    s.staff[id] = (s.staff[id] || 0) + 1;
    this.log(s, "🤝 Hired a " + r.name + " (salary $" + r.salary.toFixed(2) + "K/day).");
    return "ok";
  }

  fire(id) {
    const s = this.state;
    if (!(s.staff[id] > 0)) return "Nobody to fire.";
    s.staff[id]--;
    const r = STAFF_BY[id];
    this.log(s, "👋 Let a " + (r ? r.name : id) + " go. (Severance? Cozy game says no.)");
    return "ok";
  }

  perk(id) {
    const s = this.state;
    s.perks[id] = !s.perks[id];
    return "ok";
  }

  takeRound() {
    const s = this.state;
    const rounds = [
      { name: "Seed", val: 3, share: 0.10 },
      { name: "Series A", val: 15, share: 0.08 },
      { name: "Series B", val: 60, share: 0.06 },
      { name: "Series C", val: 250, share: 0.05 },
      { name: "Series D", val: 2000, share: 0.04 },
    ];
    const i = s.roundsTaken;
    if (i >= rounds.length) return "All rounds taken. It is IPO time.";
    const rd = rounds[i];
    if (valuation(s) < rd.val) return "Valuation too low. Needs $" + rd.val + "M.";
    const cash = rd.val * rd.share * 1000;
    s.cash += cash;
    s.equity = Math.min(0.9, s.equity + rd.share);
    s.roundsTaken++;
    s.stats.rounds++;
    this.log(s, "💰 Raised " + rd.name + ": +$" + cash + "K for " + Math.round(rd.share * 100) + "% equity.");
    return "ok";
  }

  takeIPO() {
    const s = this.state;
    if (s.roundsTaken < 5) return "Raise all five venture rounds first.";
    if (valuation(s) < 5000) return "Valuation needs to reach $5000M (you have $" + valuation(s) + "M).";
    if (s.equity >= 0.35) return "Investors hold too much equity — keep it under 35%.";
    s.gameOver = "ipo";
    s.finalNote = "You took " + s.company + " public on a wave of hype and tensor math. The bell rings; the lab endures. Valuation: $" + valuation(s) + "M.";
    this.log(s, "🎉 IPO! " + s.company + " is now a public company.");
    return "ok";
  }

  speed(n) { this.state.speed = n; }

  rename(name) {
    if (name && name.trim()) this.state.company = name.trim().slice(0, 24);
  }

  async pressRelease() {
    const s = this.state;
    if (s.cash < 5) return "Not enough cash ($5K needed).";
    s.cash -= 5;
    const g = window.root && window.root.generateText;
    if (!g) { this.log(s, "📰 Press release failed (no text AI available)."); return "ok"; }
    this.log(s, "📰 Writing press release...");
    const best = s.models.slice().sort((a, b) => b.quality - a.quality)[0];
    const news = best ? "a " + best.name + " model scoring " + best.evals.mmlu + " on MMLU" : "the founding of the lab";
    try {
      const text = await g("You are the PR team of a scrappy AI startup called '" + s.company + "', living through the " + EPOCHS[s.epoch].name + " of AI. Write a short, cozy, 2-3 sentence press release announcing " + news + ". Keep it upbeat and a little silly. No markdown, no headers.");
      s.rep += 8;
      this.log(s, "📰 " + text.slice(0, 300));
    } catch (e) {
      this.log(s, "📰 Press release draft lost in a server crash. 😬");
    }
    return "ok";
  }

  // ---- persistence ----

  async save(silent) {
    if (!this.kv || !this.state) return false;
    try {
      await this.kv.simaiSave.set("main", { v: 1, saved: Date.now(), state: this.state });
      if (!silent) this.log(this.state, "💾 Game saved.");
      return true;
    } catch (e) {
      return false;
    }
  }

  async load() {
    if (!this.kv) return null;
    try {
      const d = await this.kv.simaiSave.get("main");
      if (d && d.state) { this.state = d.state; return d; }
    } catch (e) { }
    return null;
  }

  reset() { this.state = this.newGame(); }
}

export const game = new Game();
