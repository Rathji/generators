(function () {
  "use strict";
  const D = window.BTD;

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const pickW = (arr, w) => {
    let total = 0;
    const ws = [];
    for (const x of arr) { const wi = w(x); ws.push(wi); total += wi; }
    if (total <= 0) return arr[Math.floor(Math.random() * arr.length)];
    let r = Math.random() * total;
    for (let i = 0; i < arr.length; i++) { r -= ws[i]; if (r <= 0) return arr[i]; }
    return arr[arr.length - 1];
  };
  const rnd = (a, b) => a + Math.random() * (b - a);
  const ri = (a, b) => Math.floor(rnd(a, b + 1));
  const chance = (p) => Math.random() < p;

  const BAL = { enemyHpK: 1.65, ourDmgK: 1.5, enDmgK: 1.25, minRounds: 10, maxRounds: 18 };

  const COMPONENTS = ["gyro", "engine", "cockpit", "sensors", "heatSinks", "jumpJets"];
  const COMP_INFO = {
    gyro: { name: "Gyro" }, engine: { name: "Engine" }, cockpit: { name: "Cockpit" },
    sensors: { name: "Sensors" }, heatSinks: { name: "Heat Sinks" }, jumpJets: { name: "Jump Jets" }
  };
  const compOk = () => Object.fromEntries(COMPONENTS.map((c) => [c, "ok"]));
  function componentDamage(unit) {
    const out = { damaged: 0, destroyed: 0 };
    if (!unit.components) return out;
    for (const c of COMPONENTS) { if (unit.components[c] === "destroyed") out.destroyed++; else if (unit.components[c] === "damaged") out.damaged++; }
    return out;
  }
  function componentMult(unit) {
    if (!unit.components) return 1;
    let m = 1;
    const s = unit.components;
    if (s.engine === "destroyed") m *= 0.45; else if (s.engine === "damaged") m *= 0.8;
    if (s.gyro === "destroyed") m *= 0.7; else if (s.gyro === "damaged") m *= 0.9;
    if (s.sensors === "destroyed") m *= 0.85;
    if (s.cockpit === "destroyed") m *= 0.05;
    if (s.heatSinks === "destroyed") m *= 0.85;
    if (s.jumpJets === "destroyed") m *= 0.9;
    return m;
  }

  const TRAITS = {
    sharpshooter: { name: "Sharpshooter", tag: "pos", desc: "Rarely misses a called shot." },
    daredevil: { name: "Daredevil", tag: "pos", desc: "Thrives on suicidal maneuvers." },
    ironwill: { name: "Iron Will", tag: "pos", desc: "Unshakeable under fire." },
    tactician: { name: "Tactician", tag: "pos", desc: "Reads the battlefield like a board." },
    blooded: { name: "Blooded", tag: "pos", desc: "A veteran of a hundred fights." },
    coldblooded: { name: "Cold-Blooded", tag: "pos", desc: "No hesitation, no mercy, no fear." },
    guardian: { name: "Guardian", tag: "pos", desc: "Fights to protect the lance." },
    natural: { name: "Natural", tag: "pos", desc: "Born for the cockpit." },
    hothead: { name: "Hothead", tag: "neg", desc: "Rushes in, gets everyone shot at." },
    gloryhound: { name: "Gloryhound", tag: "neg", desc: "Wants the kill for the headlines." },
    thrillseeker: { name: "Thrill-Seeker", tag: "neg", desc: "Bored without incoming fire." },
    temperamental: { name: "Temperamental", tag: "neg", desc: "A mood that changes with the weather." },
    paranoid: { name: "Paranoid", tag: "neg", desc: "Sees ambushes everywhere." },
    braggart: { name: "Braggart", tag: "neg", desc: "Talks a better game than they play." },
    gambler: { name: "Compulsive Gambler", tag: "neg", desc: "Runs debts across the Inner Sphere." },
    jittery: { name: "Jittery", tag: "neg", desc: "Hands shake in the cockpit." },
    mystic: { name: "Mystic", tag: "neu", desc: "Reads omens before every drop." },
    nobleborn: { name: "Noble-Born", tag: "neu", desc: "Once titled; now just a soldier." },
    farmkid: { name: "Farm Kid", tag: "neu", desc: "Practical, frugal, and tough." },
    loremaster: { name: "Loremaster", tag: "neu", desc: "Knows every mech ever built." },
    spacenut: { name: "Spacenut", tag: "neu", desc: "Dreams in zero-G and jump coordinates." },
    pyro: { name: "Pyromaniac", tag: "neu", desc: "An unhealthy love of fire." },
    arena: { name: "Arena Brawler", tag: "neu", desc: "Bought their way out of Solaris." },
    orphan: { name: "War Orphan", tag: "neu", desc: "The regiment is the only family they've known." },
    packrat: { name: "Packrat", tag: "neu", desc: "Salvages everything, throws away nothing." },
    chatterbox: { name: "Chatterbox", tag: "neu", desc: "Talks through every battle." },
    tech_head: { name: "Tech-Head", tag: "neu", desc: "Understands the machine better than the pilot." },
    zen: { name: "Zen", tag: "neu", desc: "Calm as a still lake." }
  };
  const TRAIT_LIST = Object.keys(TRAITS).map((k) => ({ key: k, name: TRAITS[k].name, tag: TRAITS[k].tag, desc: TRAITS[k].desc }));
  const posTraitKeys = () => TRAIT_LIST.filter((t) => t.tag === "pos").map((t) => t.key);
  const negTraitKeys = () => TRAIT_LIST.filter((t) => t.tag === "neg").map((t) => t.key);
  const neuTraitKeys = () => TRAIT_LIST.filter((t) => t.tag === "neu").map((t) => t.key);
  const mixTrait = (kind) => {
    const opts = kind === "pilot" ? TRAIT_LIST : TRAIT_LIST.filter((t) => t.tag !== "neg");
    return pick(opts).key;
  };

  const VOICE_GENERIC = {
    kill: ["Target down. Good shooting, {call}.", "{call} reports a confirmed kill.", "One more ghost for the furnace, says {call}."],
    hurt: ["{call} — I'm hit! Armor's compromised!", "{call} grunts as shells find the armor.", "Damage report from {call}: they'll live."],
    victory: ["We did it. Collect the salvage and let's go home.", "Command, this is {call} — objective secure.", "That's another contract in the bag."],
    partial: ["Job's done, more or less. Let's not ask too many questions.", "We held the field. The employer can keep their bonus.", "{call} calls it a draw and pockets the fuel costs."],
    defeat: ["Command, we're pulling out. Too hot.", "{call} calls the retreat — nobody argues.", "They got us. Regroup and count the damage."],
    payday: ["Payday! Drinks are on {call}.", "C-bills in the account. {call} is already spending them.", "{call} eyes the bank transfer like a hawk."]
  };
  const VOICE_SPECIAL = {
    sharpshooter: { kill: ["One shot. That's all it took.", "Center mass. Textbook, says {call}."] },
    daredevil: { kill: ["Straight through the fire. Ha!", "Who says you can't outrun a PPC?"] },
    hothead: { hurt: ["They got me! Fine, I'm fine! Keep shooting!", "I'm hit — never mind, it's just paint."] },
    gloryhound: { kill: ["THAT one was mine! You all saw that, right?", "Did you get that on the holo-recorder?!"], victory: ["They'll write songs about this!"] },
    mystic: { kill: ["The omens were correct.", "The ancestors guided that shot."], victory: ["I saw this outcome in the smoke this morning."] },
    loremaster: { kill: ["That was a {enemyMech}. Now it's a crater."] },
    gambler: { victory: ["Pay up, Command. I had even money on us."] },
    temperamental: { defeat: ["I told you this contract was cursed. I TOLD you."] },
    braggart: { victory: ["You're welcome, everyone. You're welcome."] },
    chatterbox: { kill: ["—and that's the fourth one this month, and did I mention—"] },
    packrat: { victory: ["I already called dibs on the salvage."] }
  };
  function voiceLine(person, scenario, vars) {
    let bank = VOICE_GENERIC[scenario] || VOICE_GENERIC.kill;
    let special = [];
    if (person) {
      for (const t of person.traits) { const s = VOICE_SPECIAL[t] && VOICE_SPECIAL[t][scenario]; if (s) special = special.concat(s); }
      if (special.length && chance(0.55)) bank = special;
    }
    const v = Object.assign({ call: person ? person.callsign : "Unknown", first: person ? person.name.split(" ")[0] : "Unknown", name: person ? person.name : "Unknown" }, vars || {});
    return pick(bank).replace(/\{(\w+)\}/g, (m, k) => (v[k] !== undefined ? v[k] : m));
  }

  const TRAIT_FLAVOR = {
    hothead: ["{call} charges ahead of the lance, daring the enemy to shoot first.", "{call} curses the slow pace and kicks the throttle up.", "{call} snaps a shot off before the fire plan, angry at the world."],
    daredevil: ["{call} threads the machine through the fire, laughing on the comms.", "{call} cuts an impossible angle between two burning wrecks.", "{call} pulls a stunt that should not have worked. It worked."],
    paranoid: ["{call} reports movement on the flank that nobody else sees.", "{call} calls a phantom contact — then double-checks the sensors twice.", "{call} refuses to advance past the ridgeline, citing 'ambush country'."],
    jittery: ["{call}'s hands shake on the triggers; the first salvo goes wide.", "{call} flinches at the first incoming round, then settles into the rhythm.", "{call} mutters a countdown over the comms to keep steady."],
    gloryhound: ["{call} breaks formation, hunting the kill for the after-action photo.", "{call} angles the machine for the shot that will make the reports.", "{call} is already planning the headline."],
    thrillseeker: ["{call} whoops as the rounds start coming in — finally, something interesting.", "{call} complains the fight is 'too slow' over the lance channel.", "{call} pushes deeper into the engagement, grinning."],
    temperamental: ["{call} is in a foul mood and takes it out on the controls.", "{call} snaps at the comms before going quiet and effective.", "{call} either loves or hates this contract. No middle ground."],
    zen: ["{call}'s voice over the comms is calm as a still lake.", "{call} picks targets with the patience of a hunter.", "{call} breathes slowly between salvos, unbothered."],
    sharpshooter: ["{call} lines up a careful shot, waiting for the armor to open.", "{call} picks the damaged seam in the enemy's plating.", "{call} walks fire across the target in a measured cadence."],
    tactician: ["{call} calls a fire plan over the lance channel.", "{call} redirects two lances with a few clipped words.", "{call} reads the enemy's spacing and finds the gap."],
    blooded: ["{call} reads the fight like an old friend.", "{call} has seen this exact field a hundred times before.", "{call} moves without hurry — the veteran's economy of motion."],
    natural: ["{call} moves the machine like it is part of them.", "{call} makes the heavy frame dance through the terrain.", "The machine obeys {call} without a wasted input."],
    coldblooded: ["{call} closes range without a word.", "{call} crosses into the kill zone with flat, steady breathing.", "{call} does not blink when the armor starts to glow."],
    guardian: ["{call} moves to cover the wounded flank.", "{call} plants the machine between the enemy and the downed lancemate.", "{call} holds the line long after the rest have pulled back."],
    mystic: ["{call} mutters something about omens before the next salvo.", "{call} claims the smoke said this would be a good day.", "{call} touches the lucky charm before engaging."],
    spacenut: ["{call} is reading the terrain like a jump plot, already planning the next move.", "{call} calls out a vector no one else considered.", "{call} hums a drop-reentry shanty over the comms."],
    pyro: ["{call} eyes the burning wrecks with unconcealed delight.", "{call} angles for the part of the field where things are on fire.", "{call} asks if the ammunition dump is 'still smoking'."],
    arena: ["{call} treats the battlefield like the Solaris games — showmanship and all.", "{call} bows theatrically to the enemy line before engaging.", "{call} narrates their own fight like a ringside announcer."],
    chatterbox: ["{call} narrates every exchange over the lance channel.", "{call} fills the comms with commentary, opinions, and anecdotes.", "{call} is still talking — the enemy has not been spared the details either."],
    loremaster: ["{call} identifies the enemy chassis and lists its weak points in real time.", "{call} remarks on the machine's lineage mid-battle.", "{call} calls out the exact production year of the enemy's engine."],
    packrat: ["{call} is already eyeing the enemy wrecks for salvage.", "{call} fires while calculating what the wreckage is worth.", "{call} saves every spent shell casing on principle."],
    farmkid: ["{call} works the terrain like a field they've plowed, thrifty and sure.", "{call} calls a target and makes the ammunition count.", "{call} treats the battlefield with the patience of harvest."]
  };
  function traitMoment(person) {
    if (!person || !person.traits || !person.traits.length) return null;
    const pool = person.traits.filter((t) => TRAIT_FLAVOR[t]);
    if (!pool.length) return null;
    const line = pick(pool.map((t) => pick(TRAIT_FLAVOR[t])));
    return line.replace(/\{(\w+)\}/g, (m, k) => (k === "call" ? person.callsign : person.name));
  }

  const BOND_TYPES = {
    rival: { name: "Rivalry", tone: "neg", desc: "old scores from a previous unit that neither has let go of" },
    buddy: { name: "Buddy", tone: "pos", desc: "drink together whenever pay arrives" },
    shipmate: { name: "Old Shipmate", tone: "pos", desc: "shared a DropShip through worse" },
    mentor: { name: "Mentor", tone: "pos", desc: "runs drills after hours and takes the younger one under their wing" }
  };
  function bondLabel(b) { const t = BOND_TYPES[b.type]; return t ? t.name : b.type; }
  function findBonds(company, p) {
    if (!p || !company) return [];
    const out = [];
    for (const q of company.people) {
      if (q.id === p.id) continue;
      for (const b of q.bonds || []) {
        if (b.otherId === p.id) out.push({ person: q, bond: b });
      }
    }
    return out;
  }
  function tryFormBond(company, np) {
    const others = company.people.filter((q) => q.id !== np.id && q.status === "active");
    if (!others.length || !chance(0.4)) return;
    const q = pick(others);
    const types = np.role === "pilot" || q.role === "pilot" ? ["rival", "buddy", "shipmate", "mentor"] : ["buddy", "shipmate", "mentor"];
    const type = pick(types);
    np.bonds = np.bonds || [];
    np.bonds.push({ type, otherId: q.id, sinceWeek: company.week });
    q.bonds = q.bonds || [];
    q.bonds.push({ type, otherId: np.id, sinceWeek: company.week });
  }

  const ARMOR_W = { HEAD: 0.035, LT: 0.14, CT: 0.155, RT: 0.14, LA: 0.125, RA: 0.125, LL: 0.14, RL: 0.14 };

  function makeLocState(aMax, sMax, cond, R) {
    const rr = R || Math.random;
    return {
      armor: { max: aMax, cur: Math.max(1, Math.round(aMax * clamp(cond, 0.15, 1) * (0.94 + rr() * 0.12))) },
      structure: { max: sMax, cur: sMax }
    };
  }

  function totalHp(unit) { let hp = 0; for (const l of D.LOCS) hp += unit.armor[l].cur + unit.structure[l].cur; return hp; }
  function maxHp(unit) { let hp = 0; for (const l of D.LOCS) hp += unit.armor[l].max + unit.structure[l].max; return hp; }
  function hpPct(unit) { return maxHp(unit) ? totalHp(unit) / maxHp(unit) : 0; }
  function armorPct(unit) {
    let a = 0, m = 0;
    for (const l of D.LOCS) { a += unit.armor[l].cur; m += unit.armor[l].max; }
    return m ? a / m : 0;
  }
  function unitPower(unit, person) {
    const aliveDmg = unit.weapons.filter((w) => w.state === "ok").reduce((s, w) => s + (D.WMAP[w.id] ? D.WMAP[w.id].dmg : 4), 0);
    const gun = person ? clamp((6 - person.gunnery) * 0.08, -0.2, 0.4) : 0;
    const frame = unit.ton * 2.4 * (0.2 + 0.8 * hpPct(unit)) * (unit.crippled ? 0.55 : 1) * componentMult(unit);
    return Math.max(1, Math.round((frame + aliveDmg * 2.5) * (1 + gun)));
  }
  function mechPowerFor(chassisId) {
    const c = D.MECH_MAP[chassisId];
    const w = (c.weapons || []).reduce((s, id) => s + (D.WMAP[id] ? D.WMAP[id].dmg : 4) * 2.5, 0);
    return Math.round(c.ton * 2.4 + w);
  }
  function sumWeaponDmg(unit) {
    let d = 0;
    for (const wp of unit.weapons) if (wp.state === "ok") d += D.WMAP[wp.id] ? D.WMAP[wp.id].dmg : 4;
    return d;
  }
  function gunStat(person) { return person ? person.gunnery : 4; }

  function genUnit(company, chassisId, opts) {
    opts = opts || {};
    const c = D.MECH_MAP[chassisId];
    const unit = {
      id: "u" + (company.nextIds.unit++), chassisId, name: c.name, ton: c.ton, cls: c.cls, tech: c.tech,
      cost: Math.round(c.cost * (opts.costMult || 1)), armor: {}, structure: {},
      weapons: [], crippled: false, pilotId: null, status: "ok",
      repairDaysLeft: 0, repairCostLeft: 0, components: compOk(),
      origin: opts.origin || "founding",
      skin: pick(["#8b3a2f", "#2f5e4a", "#33425e", "#5e4a33", "#4a3f5e", "#3a4a5e", "#5e332f", "#3d3d3d"]),
      boughtAtWeek: company.week
    };
    const cond = opts.condition !== undefined ? clamp(opts.condition, 0.15, 1) : 1;
    for (const l of D.LOCS) {
      const aMax = Math.max(2, Math.round(c.armor * ARMOR_W[l]));
      const sMax = Math.max(1, Math.round(aMax * 0.44));
      const st = makeLocState(aMax, sMax, cond);
      unit.armor[l] = st.armor; unit.structure[l] = st.structure;
      if (opts.structDamage && chance(opts.structDamage)) unit.structure[l].cur = Math.max(0, Math.round(sMax * rnd(0.2, 0.7)));
    }
    const slots = ["LT", "CT", "RT", "LA", "RA"];
    const wpool = c.weapons.slice().sort(() => Math.random() - 0.5);
    for (const wid of wpool) {
      const loc = slots[Math.floor(Math.random() * slots.length)];
      const broken = opts.structDamage && chance(Math.min(0.5, opts.structDamage));
      unit.weapons.push({ id: wid, loc, state: broken ? "destroyed" : "ok" });
    }
    if (opts.structDamage) {
      for (const c of COMPONENTS) { if (chance(Math.min(0.5, opts.structDamage * 0.8))) unit.components[c] = chance(0.5) ? "damaged" : "destroyed"; }
    }
    return unit;
  }

  function missingArmor(unit) { let m = 0; for (const l of D.LOCS) m += Math.max(0, unit.armor[l].max - unit.armor[l].cur); return m; }
  function missingStruct(unit) { let m = 0; for (const l of D.LOCS) m += Math.max(0, unit.structure[l].max - unit.structure[l].cur); return m; }
  function repairEstimate(unit, company) {
    const techs = (company ? company.people : []).filter((p) => p.role === "tech" && p.status === "active");
    let mult = 1;
    if (techs.length) { const best = Math.max(...techs.map((t) => t.skill)); mult = clamp(1 - best * 0.032, 0.52, 1); }
    const mA = missingArmor(unit), mS = missingStruct(unit);
    const wLost = unit.weapons.filter((w) => w.state === "destroyed");
    const wCost = wLost.reduce((s, w) => s + (D.WMAP[w.id] ? D.WMAP[w.id].cost : 20000), 0);
    const cd = componentDamage(unit);
    const compCost = cd.destroyed * (3500 + unit.ton * 90) + cd.damaged * (1600 + unit.ton * 40);
    const cost = Math.round((mA * 135 + mS * 950 + wCost * 0.85 + compCost) * mult / 500) * 500;
    const days = Math.max(1, Math.ceil((mA / 100 + mS / 25 + wLost.length + cd.destroyed + cd.damaged * 0.5) * clamp(1 - techs.length * 0.1, 0.55, 1)));
    return { cost, days, mA, mS, wLost: wLost.length, compDamaged: cd.damaged, compDestroyed: cd.destroyed, damagePct: clamp(1 - hpPct(unit), 0, 1) };
  }
  function fixUnit(unit) {
    for (const l of D.LOCS) { unit.armor[l].cur = unit.armor[l].max; unit.structure[l].cur = unit.structure[l].max; }
    for (const w of unit.weapons) w.state = "ok";
    unit.crippled = false;
    unit.components = compOk();
    unit.status = "ok";
    unit.repairDaysLeft = 0;
  }

  function sanitizeCompany(company) {
    for (const u of company.units) {
      const mc = D.MECH_MAP[u.chassisId];
      if (!mc) continue;
      if (!u.armor || typeof u.armor !== "object") u.armor = {};
      if (!u.structure || typeof u.structure !== "object") u.structure = {};
      if (!u.components) u.components = compOk();
      for (const c of COMPONENTS) if (!u.components[c]) u.components[c] = "ok";
      if (!u.origin) u.origin = "founding";
      if (u.status !== "repairing" && u.status !== "destroyed") u.status = "ok";
      for (const l of D.LOCS) {
        let a = u.armor[l], s = u.structure[l];
        if (!a || typeof a !== "object" || !isFinite(a.max) || a.max <= 0) {
          const aMax = Math.max(2, Math.round(mc.armor * ARMOR_W[l]));
          a = u.armor[l] = { max: aMax, cur: aMax };
        }
        if (!s || typeof s !== "object" || !isFinite(s.max) || s.max <= 0) {
          const sMax = Math.max(1, Math.round(a.max * 0.44));
          s = u.structure[l] = { max: sMax, cur: sMax };
        }
        if (!isFinite(a.cur) || a.cur < 0 || a.cur > a.max) a.cur = a.max;
        if (!isFinite(s.cur) || s.cur < 0 || s.cur > s.max) s.cur = s.max;
      }
      if (!Array.isArray(u.weapons)) u.weapons = [];
      for (const w of u.weapons) if (w.state !== "destroyed") w.state = "ok";
      if (!u.weapons.length) {
        u.weapons = (mc.weapons || []).map((wid) => ({ id: wid, loc: "CT", state: "ok" }));
      }
      if (u.status === "destroyed") {
        u.crippled = true;
        for (const l of D.LOCS) { u.armor[l].cur = 0; u.structure[l].cur = 0; }
      }
    }
    for (const p of company.people) {
      if (p.status !== "injured" && p.status !== "active") p.status = "active";
      if (p.status === "injured" && (!isFinite(p.injuredWeeks) || p.injuredWeeks <= 0)) p.status = "active";
      if (!isFinite(p.morale)) p.morale = 62;
      p.morale = clamp(Math.round(p.morale), 0, 100);
      if (!Array.isArray(p.bonds)) p.bonds = [];
      else p.bonds = p.bonds.filter((b) => b && b.otherId && b.otherId !== p.id && company.people.some((q) => q.id === b.otherId));
      backfillPersonDetails(p);
    }
    if (!isFinite(company.morale)) company.morale = 62;
    company.morale = clamp(company.morale, 0, 100);
    if (!isFinite(company.funds)) company.funds = 0;
    if (company.partsInv) {
      for (const k of Object.keys(company.partsInv)) {
        if (!D.WMAP[k] || !isFinite(company.partsInv[k])) delete company.partsInv[k];
      }
    }
    return company;
  }

  function calcSalary(p) {
    if (p.role === "pilot") return Math.round(1300 + (7 - p.gunnery) * 240 + (7 - p.piloting) * 120);
    if (p.role === "tech") return Math.round(850 + p.skill * 220);
    return Math.round(500 + p.skill * 120);
  }
  const article = (w) => (/^[aeiou]/i.test(w) || /^hpg/i.test(w) ? "an" : "a");
  function composeBackstory(p) {
    const first = p.name.split(" ")[0];
    const r = mulberry32(hashStr(p.id + ":" + p.name + ":" + (p.avatarSeed || p.origin)));
    const pickR = (arr) => arr[Math.floor(r() * arr.length)];
    const tpls = [
      article(p.career) + " " + p.career + " from " + p.origin + ", " + first + " signed on the first day the recruiting officer waved a contract",
      "The " + p.career + " years on " + p.origin + " ended the way they always do — with " + first + " picking a side and a paycheck",
      "After " + p.career + " work on " + p.origin + " went sideways, " + first + " took a DropShip berth and never bought a return ticket",
      "Recruited off " + p.origin + " mid-" + p.career + ", " + first + " has been a mercenary ever since",
      "There is not much call for " + article(p.career) + " " + p.career + " on " + p.origin + " anymore, so " + first + " came to where the guns are"
    ];
    const bio = pickR(tpls);
    const full = bio + ". " + (p.role === "pilot" ? "In the cockpit" : "On the ground") + ", " + (p.motivation || "doing the work they were born for") + ".";
    return full.charAt(0).toUpperCase() + full.slice(1);
  }
  function backfillPersonDetails(p) {
    const r = mulberry32(hashStr(p.id + ":" + p.name));
    const pickR = (arr) => arr[Math.floor(r() * arr.length)];
    if (!p.age) p.age = p.role === "tech" ? ri(24, 62) : p.role === "support" ? ri(20, 58) : (chance(0.5) ? ri(22, 34) : ri(27, 49));
    if (!p.build) p.build = pickR(D.BUILDS);
    if (!p.hair) p.hair = pickR(D.HAIR);
    if (!p.feature) p.feature = pickR(D.FEATURES);
    if (!p.motivation || !D.MOTIVATIONS.includes(p.motivation)) p.motivation = pickR(D.MOTIVATIONS);
    p.backstory = composeBackstory(p);
    return p;
  }
  function genPerson(company, role) {
    const takenNames = new Set(company.people.map((p) => p.name));
    const takenCalls = new Set(company.people.map((p) => p.callsign));
    let name = pick(D.FIRST) + " " + pick(D.LAST), callsign = pick(D.CALLSIGNS), guard = 0;
    while ((takenNames.has(name) || takenCalls.has(callsign)) && guard++ < 24) {
      name = pick(D.FIRST) + " " + pick(D.LAST);
      callsign = pick(D.CALLSIGNS);
    }
    const p = {
      id: "p" + (company.nextIds.person++), name, callsign,
      role, gender: chance(0.5) ? "M" : "F", origin: pick(D.HOME_WORLDS), career: pick(D.CAREERS),
      quirk: pick(D.QUIRKS), traits: [], morale: ri(55, 88), xp: 0,
      status: "active", injuredWeeks: 0, hiredWeek: company.week, unitId: null, bonds: [],
      avatarSeed: hashStr(company.name + company.nextIds.person + role + Math.random())
    };
    p.age = role === "tech" ? ri(24, 62) : role === "support" ? ri(20, 58) : (chance(0.5) ? ri(22, 34) : ri(27, 49));
    p.build = pick(D.BUILDS);
    p.hair = pick(D.HAIR);
    p.feature = pick(D.FEATURES);
    p.motivation = pick(D.MOTIVATIONS);
    if (role === "pilot") {
      p.gunnery = clamp(7 - (company.difficulty.bonus || 0) - Math.round(rnd(-0.5, 2)), 1, 7);
      p.piloting = clamp(7 - Math.round(rnd(-0.5, 2)) + Math.round((company.difficulty.bonus || 0) * 0.5), 1, 7);
      p.gunnery = clamp(Math.round(p.gunnery), 1, 7);
      p.piloting = clamp(Math.round(p.piloting), 1, 7);
      const nTraits = 1 + Math.floor(Math.random() * 2);
      p.traits = [mixTrait("pilot")];
      for (let i = 1; i < nTraits; i++) p.traits.push(mixTrait("pilot"));
    } else {
      p.skill = role === "tech" ? ri(3, 8) : ri(2, 6);
      p.traits = [mixTrait("staff")];
      if (chance(0.5)) p.traits.push(mixTrait("staff"));
    }
    p.salary = calcSalary(p);
    p.backstory = composeBackstory(p);
    return p;
  }
  function findPerson(company, id) { return (company.people || []).find((p) => p.id === id); }
  function findUnit(company, id) { return (company.units || []).find((u) => u.id === id); }
  function weeklyPayroll(company) { return company.people.filter((p) => p.status === "active").reduce((s, p) => s + p.salary, 0); }
  function maintainedUnits(company) { return company.units.filter((u) => u.status === "ok" || u.status === "repairing" || u.status === "destroyed"); }
  function unitUpkeep(unit) { return Math.max(50, Math.round(unit.cost * 0.0007 * (0.35 + 0.65 * armorPct(unit)))); }
  function componentWear(unit) {
    if (!unit.components) return 0;
    let s = 0;
    for (const c of COMPONENTS) { if (unit.components[c] === "destroyed") s += 1; else if (unit.components[c] === "damaged") s += 0.5; }
    return s / COMPONENTS.length;
  }
  function upkeepBreakdown(company) {
    const units = maintainedUnits(company);
    let base = 0, wear = 0;
    const per = [];
    for (const u of units) { const uu = unitUpkeep(u); base += uu; const w = componentWear(u); wear += w; per.push({ name: u.name, upkeep: uu, wear: w }); }
    const techs = company.people.filter((p) => p.role === "tech" && p.status === "active").length;
    const techDiscount = clamp(techs * 0.03, 0, 0.3);
    const compMult = units.length ? 1 + (wear / units.length) * 0.4 : 1;
    return { base, techs, techDiscount, compMult, per, unitCount: units.length };
  }
  function weeklyUpkeep(company) {
    const b = upkeepBreakdown(company);
    return Math.round(b.base * (1 - b.techDiscount) * b.compMult);
  }
  function totalWeeklyBurn(company) { return weeklyPayroll(company) + weeklyUpkeep(company); }
  function logisticsSummary(company) {
    const active = company.people.filter((p) => p.status === "active");
    const byRole = { pilot: 0, tech: 0, support: 0 };
    let payroll = 0;
    for (const p of active) { payroll += p.salary; byRole[p.role] = (byRole[p.role] || 0) + p.salary; }
    const b = upkeepBreakdown(company);
    const upkeep = Math.round(b.base * (1 - b.techDiscount) * b.compMult);
    return { payroll, byRole, headcount: active.length, techs: b.techs, techDiscount: b.techDiscount, compMult: b.compMult, baseUpkeep: b.base, per: b.per, upkeep, total: payroll + upkeep };
  }
  function logTx(company, cat, label, amount, week) {
    company.ledger.unshift({ id: "tx" + (company.nextIds.tx++), cat, label, amount, week: week === undefined ? company.week : week });
    if (company.ledger.length > 400) company.ledger.length = 400;
    if (amount) company.funds += amount;
  }
  function ledgerSummary(company) {
    const out = { income: 0, expense: 0, byCat: {}, monthIn: 0, monthOut: 0, monthNet: 0 };
    const cutoff = company.week - 4;
    for (const t of company.ledger) {
      const amt = t.amount || 0;
      if (amt >= 0) out.income += amt; else out.expense += -amt;
      out.byCat[t.cat] = (out.byCat[t.cat] || 0) + amt;
      if (t.week > cutoff) {
        if (amt >= 0) out.monthIn += amt; else out.monthOut += -amt;
      }
    }
    out.monthNet = out.monthIn - out.monthOut;
    out.net = out.income - out.expense;
    const burn = weeklyPayroll(company) + weeklyUpkeep(company);
    out.burn = burn;
    out.runway = burn > 0 ? Math.floor(company.funds / burn) : 999;
    return out;
  }
  function companyRating(company) {
    const deployed = company.units.filter((u) => u.status === "ok" || u.status === "repairing");
    if (!deployed.length) return { label: "Disbanded", power: 0, avgTon: 0, count: 0 };
    let power = 0, ton = 0;
    for (const u of deployed) { const pil = u.pilotId ? findPerson(company, u.pilotId) : null; power += unitPower(u, pil); ton += u.ton; }
    const avgTon = ton / deployed.length;
    const label = avgTon < 40 ? "Light Company" : avgTon < 60 ? "Medium Company" : avgTon < 80 ? "Heavy Company" : "Assault Company";
    return { label, power, avgTon, count: deployed.length };
  }
  function eraOf(company) { return D.ERAS[company.eraIdx]; }
  function eraFactions(company) {
    return D.FACTIONS.filter((f) => f.eraMin <= company.eraIdx && (f.eraMax === undefined || f.eraMax >= company.eraIdx));
  }
  function eraMechPool(company, factionId) {
    return D.MECHS.filter((m) => m.eraMin <= company.eraIdx && (!factionId || (m.fac || []).indexOf(factionId) >= 0));
  }
  function eraWeaponPool(company) { return D.WEAPONS.filter((w) => w.eraMin <= company.eraIdx); }
  function factionById(id) { return D.FACTIONS.find((f) => f.id === id); }

  function newCompany(opts) {
    opts = opts || {};
    const dk = opts.difficulty || "regular";
    const difficulty = {
      key: dk,
      label: { recruit: "Recruit", regular: "Regular", veteran: "Veteran", elite: "Elite" }[dk] || "Regular",
      bonus: { recruit: 1, regular: 0, veteran: -1, elite: -2 }[dk] || 0,
      payMult: { recruit: 1.35, regular: 1, veteran: 0.82, elite: 0.66 }[dk] || 1,
      threatMult: { recruit: 0.62, regular: 0.9, veteran: 1.18, elite: 1.5 }[dk] || 0.9,
      funds: { recruit: 900000, regular: 600000, veteran: 400000, elite: 260000 }[dk] || 600000
    };
    const company = {
      schema: 4, createdAt: Date.now(), name: opts.name || "Black Aegis", callsign: (opts.callsign || "BA").toUpperCase().slice(0, 12),
      difficulty, eraIdx: clamp(opts.eraIdx !== undefined ? opts.eraIdx : 0, 0, D.ERAS.length - 1),
      week: 1, funds: 0, morale: 62, loan: 0,
      rep: Object.fromEntries(D.FACTIONS.map((f) => [f.id, 0])),
      people: [], units: [], partsInv: {},
      nextIds: { person: 1, unit: 1, contract: 1, report: 1, tx: 1 },
      ledger: [], market: null, offers: [], activeReports: [], salvageQueue: [],
      stats: { battles: 0, victories: 0, defeats: 0, kills: 0, lost: 0 },
      log: [], pendingEvents: [], cacheChance: 0
    };
    for (let i = 0; i < 4; i++) company.people.push(genPerson(company, "pilot"));
    company.people.push(genPerson(company, "tech"));
    company.people.push(genPerson(company, "support"));
    const start = { recruit: ["locust", "stinger", "wasp", "commando"], regular: ["wasp", "stinger", "commando", "locust"], veteran: ["commando", "stinger", "jenner", "locust"], elite: ["jenner", "commando", "stinger", "wasp"] };
    const ids = start[dk] || start.regular;
    for (const cid of ids) {
      const pool = eraMechPool(company);
      const use = pool.find((m) => m.id === cid) || pick(pool);
      company.units.push(genUnit(company, use.id, { condition: dk === "elite" ? 0.95 : rnd(0.7, 0.95) }));
    }
    company.people.filter((p) => p.role === "pilot").forEach((p, i) => { if (company.units[i]) { p.unitId = company.units[i].id; company.units[i].pilotId = p.id; } });
    logTx(company, "start", "Company founding grant", difficulty.funds, 0);
    refreshMarket(company);
    refreshOffers(company);
    return company;
  }

  function refreshMarket(company) {
    const era = D.ERAS[company.eraIdx];
    const merchant = merchantFor(company);
    const techMult = clamp(1.15 - company.eraIdx * 0.03, 0.97, 1.15);
    const mechEraMult = clamp(1.06 - company.eraIdx * 0.02, 0.97, 1.06);
    const demandK = rnd(0.9, 1.14);
    const demandPct = Math.round((demandK - 1) * 100);
    let moodLabel;
    if (demandK > 1.07) moodLabel = "War-boom prices — a sellers' market (+" + demandPct + "%)";
    else if (demandK < 0.94) moodLabel = "Buyer's market — dealers are discounting (" + demandPct + "%)";
    else moodLabel = "Steady trade (" + (demandPct >= 0 ? "+" : "") + demandPct + "%)";
    const eraNote = era.techScarcity || (company.eraIdx === 0 ? "Succession Wars scarcity — advanced hardware commands a premium" : "Post-Clan tech is more common on the market");
    const stock = [];
    const mechPool = eraMechPool(company);
    const n = 3 + Math.floor(Math.random() * 2);
    const seen = {};
    for (let i = 0; i < n; i++) {
      let m = pick(mechPool); let guard = 0;
      while (seen[m.id] && guard++ < 6) m = pick(mechPool);
      seen[m.id] = true;
      const isNew = chance(0.1);
      const cond = isNew ? 1 : rnd(0.55, 0.95);
      const priceK = (isNew ? 1.16 : (0.5 + cond * 0.5)) * rnd(0.85, 1.05) * demandK * mechEraMult * merchant.mult;
      stock.push({ id: "mk" + i, kind: "mech", chassisId: m.id, cond, fresh: isNew, price: Math.round(m.cost * priceK / 500) * 500 });
    }
    const wpnPool = eraWeaponPool(company);
    const wcount = 6 + Math.floor(Math.random() * 5);
    for (let i = 0; i < wcount; i++) {
      const w = pick(wpnPool);
      const priceK = rnd(0.88, 1.25) * demandK * techMult * merchant.mult;
      stock.push({ id: "wk" + i, kind: "weapon", wid: w.id, qty: ri(1, 3), price: Math.round(w.cost * priceK / 500) * 500 });
    }
    company.market = { refreshedWeek: company.week, stock, merchant, mood: { label: moodLabel, eraNote, techMult, demandK } };
  }

  const TERRAINS = [
    { id: "urban", name: "Urban sprawl", mod: -0.05, desc: "canyons of ferrocrete and shattered glass towers" },
    { id: "forest", name: "Dense forest", mod: -0.1, desc: "ancient trees that swallow autocannon fire" },
    { id: "jungle", name: "Jungle", mod: -0.12, desc: "steaming canopy and rivers of mud" },
    { id: "mountain", name: "Highlands", mod: -0.08, desc: "razorback ridges and switchback passes" },
    { id: "desert", name: "Desert basin", mod: 0.03, desc: "open dunes, heat shimmer, and no cover" },
    { id: "tundra", name: "Frozen tundra", mod: -0.03, desc: "pack ice and endless white" },
    { id: "plains", name: "Open plains", mod: 0.06, desc: "flat grassland with nowhere to hide" },
    { id: "swamp", name: "Lowland swamp", mod: -0.15, desc: "chest-deep muck that grabs every leg actuator" },
    { id: "canyon", name: "Badlands canyon", mod: -0.07, desc: "red rock walls that echo every shot" },
    { id: "lunar", name: "Lunar basin", mod: 0.02, desc: "fine grey dust under a black sky" },
    { id: "ruins", name: "Star League ruins", mod: -0.06, desc: "collapsed ferrocrete arches older than the Houses" },
    { id: "coastal", name: "Coastal shelf", mod: 0, desc: "salt spray and pounding surf" }
  ];
  const TERRAIN_AFFIN = {
    recon: { plains: 4, desert: 3, tundra: 2, coastal: 3, lunar: 2, canyon: 1.5 },
    defense: { urban: 4, ruins: 3, mountain: 2, forest: 2, swamp: 1.5, canyon: 1.5 },
    garrison: { urban: 4, ruins: 3, mountain: 2, plains: 1.5, forest: 1.5 },
    assassination: { urban: 4, ruins: 3.5, canyon: 2, forest: 1.5, mountain: 1.5 },
    raid: { urban: 3, ruins: 2.5, canyon: 2, desert: 1.5, plains: 1.5 },
    objraid: { urban: 3.5, ruins: 3, canyon: 2, mountain: 1.5, desert: 1.5 },
    capture: { plains: 2.5, forest: 2, coastal: 2.5, urban: 1.5, canyon: 1.5, ruins: 1.5 },
    clantrial: { plains: 3.5, desert: 3, tundra: 2.5, lunar: 2, forest: 1.5, canyon: 1.5 }
  };
  const pickTerrainFor = (mtId) => {
    const aff = TERRAIN_AFFIN[mtId] || {};
    return pickW(TERRAINS, (t) => aff[t.id] || 1);
  };
  const UNIT_FLAVOR = {
    steiner: "Lyran Guards", davion: "Davion March Militia", kurita: "DCMS Regulars", liao: "Capellan Reserves",
    marik: "FWL Fusiliers", taurian: "Concordat Grenadiers", canopus: "Magistracy Light Horse",
    pirate: "Outlaw gang", comstar: "ComGuards", wob: "Word of Blake Militia",
    "jade-falcon": "Jade Falcon Galaxy", wolf: "Wolf Clan forces", "ghost-bear": "Ghost Bear Touman",
    "smoke-jaguar": "Smoke Jaguar Pouncers", "nova-cat": "Nova Cat Strikers", "diamond-shark": "Diamond Shark traders"
  };

  function factionMult(company, fid) { return clamp(1 + (company.rep[fid] || 0) * 0.04, 0.7, 1.5); }
  function repLabel(r) {
    if (r >= 8) return "Trusted ally";
    if (r >= 5) return "Honored";
    if (r >= 2) return "Respected";
    if (r >= 1) return "Known";
    if (r <= -8) return "Sworn enemy";
    if (r <= -5) return "Hated";
    if (r <= -2) return "Disliked";
    if (r <= -1) return "Cold";
    return "Neutral";
  }
  function merchantFor(company) {
    const cand = D.FACTIONS.filter((f) => f.eraMin <= company.eraIdx && (f.eraMax === undefined || f.eraMax >= company.eraIdx) && f.type !== "clan");
    const f = pick(cand.length ? cand : eraFactions(company));
    const rep = company.rep[f.id] || 0;
    const mult = clamp(1 + rep * 0.006, 0.94, 1.06);
    return { id: f.id, name: f.name, glyph: f.glyph, rep, mult, adj: Math.round((mult - 1) * 100), label: repLabel(rep) };
  }

  function refreshOffers(company) {
    const fact = eraFactions(company).filter((f) => {
      const r = company.rep[f.id] || 0;
      if (f.id === "pirate") return true;
      return r >= (f.type === "clan" ? -2 : -4);
    });
    const our = companyRating(company);
    const offers = [];
    const n = Math.max(2, Math.min(5, 2 + Math.floor(company.week / 4)));
    const seenTypes = {};
    for (let i = 0; i < n; i++) {
      const faction = pick(fact);
      const r = company.rep[faction.id] || 0;
      let pool = D.MISSION_TYPES.filter((mt) => {
        if (mt.clanOnly && faction.type !== "clan") return false;
        if (mt.repMin !== undefined && r < mt.repMin) return false;
        if (!mt.clanOnly && faction.type === "clan" && company.eraIdx > 0 && chance(0.6)) return false;
        return true;
      });
      if (faction.type === "pirate") pool = pool.filter((mt) => !mt.clanOnly);
      const mtWeight = (t) => (t.favor && t.favor.indexOf(faction.id) >= 0 ? 3 : 1);
      const mt = pool.length ? pickW(pool, mtWeight) : pickW(D.MISSION_TYPES.filter((x) => !x.clanOnly && (x.repMin === undefined || r >= x.repMin)), mtWeight);
      if (!mt) { console.warn("refreshOffers: no eligible type for", faction.id, "rep", r, "pool", pool.length); continue; }
      let target;
      if (faction.type === "clan" && mt.clanOnly) target = faction;
      else {
        const cand = eraFactions(company).filter((f2) => f2.id !== faction.id && f2.type !== "clan" && f2.type !== "pirate");
        target = pick(cand.length ? cand : D.FACTIONS.filter((f) => f.type === "pirate"));
      }
      const tonF = 0.75 + our.avgTon / 160;
      const threat = clamp(company.difficulty.threatMult * rnd(0.8, 1.22) * tonF * rnd(0.85, 1.15), 0.3, 3);
      const power = Math.max(1, our.power);
      const pay = Math.round(power * 190 * mt.payMult * factionMult(company, faction.id) * company.difficulty.payMult * (0.55 + threat) * rnd(0.92, 1.1) / 500) * 500;
      const salvagePct = mt.salvageMult <= 0.7 ? 0 : clamp(Math.round(rnd(35, 60) + (mt.salvageMult - 1) * 40 + (faction.type === "clan" ? 15 : 0) + (company.rep[faction.id] || 0) * 2.5), 0, 100);
      offers.push({
        id: "c" + (company.nextIds.contract++),
        factionId: faction.id, employer: faction.name, glyph: faction.glyph, fcolor: faction.color,
        type: mt.id, missionName: mt.name, objDesc: mt.desc, victoryCond: mt.obj,
        pay, salvagePct, duration: mt.id === "garrison" || mt.id === "defense" ? ri(20, 40) : ri(9, 26),
        planet: pickPlanet(), terrain: pickTerrainFor(mt.id), threat: clamp(threat, 0.3, 3),
        targetId: target.id, targetName: target.name, targetGlyph: target.glyph, targetColor: target.color,
        enemyMult: clamp(threat * rnd(0.85, 1.25) * (target.type === "clan" ? 1.3 : 1), 0.35, 2.6),
        expiresWeek: company.week + 4, offeredWeek: company.week
      });
    }
    company.offers = offers;
  }

  function pickPlanet() {
    const x = pick(D.HOME_WORLDS), y = pick(D.HOME_WORLDS);
    const r = Math.random();
    if (r < 0.35) return x + " " + (ri(2, 6) === 3 ? "III" : ri(2, 9));
    if (r < 0.6) return "New " + x;
    if (r < 0.8) return x + "-" + pick(["Prime", "Major", "Minor", "Alpha", "Station"]);
    return x + " " + y;
  }

  function battle(company, offer, lance) {
    const seed = (Math.random() * 1e9) >>> 0;
    const R = mulberry32(seed);
    const r2 = (a, b) => a + R() * (b - a);
    const ri2 = (a, b) => a + Math.floor(R() * (b - a + 1));
    const p2 = (arr) => arr[Math.floor(R() * arr.length)];
    const mt = D.MISSION_TYPES.find((t) => t.id === offer.type) || D.MISSION_TYPES[0];

    const us = lance.map((u) => {
      const clone = JSON.parse(JSON.stringify(u));
      const person = u.pilotId ? findPerson(company, u.pilotId) : null;
      const tag = person ? person.callsign : u.name;
      return { unit: clone, person, side: "us", dead: false, tag, power: unitPower(u, person), isVip: false };
    });
    const ourPower = us.reduce((a, x) => a + x.power, 0);
    const enemyFaction = factionById(offer.targetId) || D.FACTIONS[0];
    const ePool = eraMechPool(company, enemyFaction.id);
    const ePoolAny = D.MECHS.filter((m) => m.eraMin <= company.eraIdx);
    const enemyCount = clamp(Math.ceil(lance.length * r2(0.8, 1.25)), 1, 8);
    const avgTon = lance.reduce((a, u) => a + u.ton, 0) / Math.max(1, lance.length);
    const eUnits = [];
    const spawnEnemy = (band) => {
      const m = p2(ePool.length ? ePool : ePoolAny.filter((x) => Math.abs(x.ton - band) < 30));
      const u = { m, dead: false, crippled: false, hp: 0, maxHp: 0, isCommander: false };
      eUnits.push(u);
      return u;
    };
    for (let i = 0; i < enemyCount; i++) spawnEnemy(avgTon * r2(0.6, 1.3));
    const rawTotal = eUnits.reduce((a, u) => a + mechPowerFor(u.m.id), 0) || 1;
    const wantPower = Math.max(1, ourPower * clamp(offer.enemyMult, 0.35, 2.6));
    const scaleF = clamp(wantPower / rawTotal, 0.35, 2.4);
    let remaining = wantPower;
    eUnits.forEach((u, i) => {
      const p = i === eUnits.length - 1 ? Math.max(1, remaining) : mechPowerFor(u.m.id) * scaleF * r2(0.8, 1.25);
      u.hp = Math.max(1, Math.round(p * BAL.enemyHpK));
      u.maxHp = u.hp;
      remaining -= p;
    });
    const enemyPower = eUnits.reduce((a, u) => a + u.maxHp / BAL.enemyHpK, 0);
    const cmdrIdx = eUnits.reduce((bi, u, i, arr) => (u.maxHp > arr[bi].maxHp ? i : bi), 0);
    eUnits[cmdrIdx].isCommander = true;

    let vipIdx = Math.floor(R() * us.length);
    us[vipIdx].isVip = true;
    const log = [];
    const logE = (side, text, extra) => { log.push(Object.assign({ side, text, t: log.length }, extra || {})); };

    const enName = UNIT_FLAVOR[enemyFaction.id] || enemyFaction.name + " forces";
    logE("world", "Drop complete. " + lance.length + " machines of " + company.name + " (" + us.map((x) => x.tag).join(", ") + ") touch down on " + offer.planet + ".");
    logE("world", "Contract: " + offer.missionName + " for " + offer.employer + " — enemy: " + enName + " (" + enemyFaction.name + ").");
    logE("world", "Terrain: " + offer.terrain.name + " — " + offer.terrain.desc + ".");
    if (mt.id === "clantrial") logE("world", "A Clan warrior challenges you over the comms. A Trial of Possession has been declared. Honor demands single combat — the Clans are known to stretch that definition.");

    const moraleMod = clamp((company.morale - 62) / 400, -0.09, 0.11);
    const enGun = clamp(4 + company.difficulty.bonus, 1, 7);
    const defenseTarget = mt.id === "defense" || mt.id === "garrison";
    const state = { round: 0, ourDead: 0, enDead: 0, enStart: eUnits.length, injuries: [], killsByPilot: {}, lastNarr: 0, lastTrait: 0, assassinKilled: false, vipDead: false };

    const orderPool = ["LT", "LA", "RT", "RA", "LL", "RL", "CT", "HEAD"];
    function hitChance(attPerson) {
      return clamp(0.52 + (6 - (attPerson ? attPerson.gunnery : enGun)) * 0.07 + moraleMod + offer.terrain.mod, 0.14, 0.96);
    }
    function pickTarget(list, person) {
      let tot = 0;
      const ws = list.map((x) => { const w = x.dead ? 0 : (x.unit ? Math.max(1, unitPower(x.unit, x.person)) : x.hp / BAL.enemyHpK); tot += w; return w; });
      if (!tot) return null;
      let rr = R() * tot;
      for (let i = 0; i < list.length; i++) { rr -= ws[i]; if (rr <= 0) return list[i]; }
      return list[list.length - 1];
    }

    function dmgOurUnit(target, dmg) {
      const u = target.unit;
      let left = dmg;
      const order = orderPool.slice().sort(() => R() - 0.5);
      let fatal = false, locHit = null;
      for (const l of order) {
        if (left <= 0.4) break;
        if (u.armor[l].cur > 0) {
          const h = Math.min(left, u.armor[l].cur);
          u.armor[l].cur -= h; left -= h;
          locHit = l;
        }
        if (left > 0.4 && u.armor[l].cur <= 0 && u.structure[l].cur > 0) {
          const h = Math.min(left, u.structure[l].cur);
          u.structure[l].cur -= h; left -= h;
          locHit = l;
          if (u.structure[l].cur <= 0) {
            for (const w of u.weapons) if (w.loc === l && w.state === "ok" && chance(0.6)) w.state = "destroyed";
            const compHits = l === "CT" ? ["engine", "gyro", "sensors"] : l === "LT" || l === "RT" ? ["heatSinks", "engine"] : l === "HEAD" ? ["cockpit", "sensors"] : l === "LL" || l === "RL" ? ["jumpJets"] : [];
            for (const cname of compHits) {
              if (u.components[cname] === "ok" && chance(0.55)) {
                u.components[cname] = chance(0.4) ? "destroyed" : "damaged";
                if (u.components[cname] === "destroyed" && (cname === "cockpit" || cname === "engine")) fatal = true;
                logE("enemy", p2([
                  "The " + u.name + "'s " + COMP_INFO[cname].name.toLowerCase() + " takes a direct hit — the machine staggers and smoke pours from the " + l + ".",
                  "Internal explosions rock the " + u.name + " as its " + COMP_INFO[cname].name.toLowerCase() + " fails.",
                  "A " + (u.components[cname] === "destroyed" ? "devastating" : "jarring") + " blow ruins the " + u.name + "'s " + COMP_INFO[cname].name.toLowerCase() + "."
                ]), { type: "component", unitId: u.id, comp: cname, state: u.components[cname] });
              }
            }
            if (l === "LL" || l === "RL") u.crippled = true;
            if (l === "CT") { fatal = true; break; }
          }
        }
      }
      return { fatal, loc: locHit };
    }
    function destroyOurUnit(target) {
      target.dead = true; state.ourDead++;
      const u = target.unit;
      logE("enemy", u.name + " takes a killing blow and goes down in flames" + (target.person ? ". " + target.person.callsign + " punches out at the last instant." : "."), { type: "kill", unitId: u.id });
      if (target.isVip) state.vipDead = true;
      if (target.person) {
        state.injuries.push(target.person.id);
        company.morale = clamp(company.morale - (6 + u.ton * 0.04), 0, 100);
        company.stats.lost++;
      }
      if (chance(0.3) && target.person) logE("us", voiceLine(target.person, "hurt", {}), { type: "quote", personId: target.person.id });
    }
    function destroyEnemyUnit(target, killer) {
      target.dead = true; state.enDead++;
      const boom = chance(0.35);
      target.boom = boom;
      const deathTxt = boom ? p2([
        target.m.name + " brews up — its ammo detonates in a tower of fire.",
        target.m.name + " is blown apart, wreckage scattering across the field.",
        target.m.name + " core vents catastrophically, gutting the machine."
      ]) : p2([
        target.m.name + " staggers, vents plasma, and crashes to the ground.",
        target.m.name + " falls, its cockpit armor holed and silent.",
        target.m.name + " topples, armor still smoldering but mostly intact."
      ]);
      logE("us", deathTxt, { type: "kill", enemyChassis: target.m.id });
      if (target.isCommander) state.assassinKilled = true;
      if (killer) {
        state.killsByPilot[killer.id] = (state.killsByPilot[killer.id] || 0) + 1;
        if (chance(0.5)) logE("us", voiceLine(killer, "kill", { enemyMech: target.m.name }), { type: "quote", personId: killer.id });
      }
    }

    function ourAttackRound() {
      const alive = us.filter((x) => !x.dead);
      for (const att of alive) {
        if (EN.alive().length === 0) break;
        let target;
        if (mt.id === "assassination" && state.assassinKilled === false) {
          const cmdr = eUnits.find((x) => x.isCommander && !x.dead);
          target = cmdr && chance(0.5) ? cmdr : pickTarget(EN.alive(), att.person);
        } else if (mt.id === "capture" && !att.isVip && chance(0.3)) {
          target = pickTarget(EN.alive(), att.person);
        } else target = pickTarget(EN.alive(), att.person);
        if (!target) break;
        if (R() < hitChance(att.person)) {
          let dmg = sumWeaponDmg(att.unit) * r2(0.7, 1.35) * BAL.ourDmgK * (target.m.ton > att.unit.ton ? 0.85 : 1.05);
          if (att.unit.crippled) dmg *= 0.7;
          if (att.unit.components && att.unit.components.engine === "destroyed") dmg *= 0.5;
          target.hp -= Math.max(1, dmg);
          if (target.hp <= 0) { destroyEnemyUnit(target, att.person); continue; }
          if (log.length - state.lastNarr > 2 && chance(0.5)) {
            const w = p2(target.m.weapons.length ? target.m.weapons : ["mlaser"]);
            const who = att.person ? att.person.callsign + " (" + att.unit.name + ")" : att.unit.name;
            logE("us", p2([
              who + " hammers " + target.m.name + " with " + (D.WMAP[w] ? D.WMAP[w].name : "weapons") + " fire.",
              (D.WMAP[w] ? D.WMAP[w].name : "Fire") + " from " + who + " strips armor from the " + target.m.name + ".",
              target.m.name + " reels as " + who + " walks fire across its frame."
            ]));
            state.lastNarr = log.length;
          }
        } else if (log.length - state.lastNarr > 4 && chance(0.15)) {
          logE("us", p2(["Laser fire burns past, scoring the terrain.", "A storm of autocannon shells throws up dirt — no hits.", "Missiles corkscrew and detonate harmlessly.", "PPC bolts howl overhead into the sky."]));
          state.lastNarr = log.length;
        }
        if (att.person && log.length - state.lastTrait > 3 && chance(0.09)) {
          const fm = traitMoment(att.person);
          if (fm) { logE("us", fm, { type: "trait", personId: att.person.id }); state.lastTrait = log.length; }
        }
      }
    }
    function enemyAttackRound() {
      const alive = EN.alive();
      for (const att of alive) {
        const tlist = us.filter((x) => !x.dead);
        if (!tlist.length) return;
        let target;
        const vip = us.find((x) => x.isVip && !x.dead);
        if (mt.id === "capture" && vip && chance(0.5)) target = vip;
        else target = pickTarget(tlist, null);
        if (!target) return;
        if (R() < hitChance(null)) {
          const wSum = att.m.weapons.reduce((s, id) => s + (D.WMAP[id] ? D.WMAP[id].dmg : 4), 0) || 10;
          let dmg = wSum * r2(0.55, 1.2) * BAL.enDmgK * clamp(scaleF, 0.55, 1.9);
          if (att.m.ton > target.unit.ton * 1.15) dmg *= 1.2;
          const res = dmgOurUnit(target, Math.max(1, dmg));
          if (res.fatal) { destroyOurUnit(target); continue; }
          if (chance(0.04) && target.person) {
            state.injuries.push(target.person.id);
            logE("world", target.person.callsign + " takes cockpit shrapnel — wounded but fighting.", { type: "injury", personId: target.person.id });
          }
          if (log.length - state.lastNarr > 2 && chance(0.55)) {
            const w = p2(att.m.weapons.length ? att.m.weapons : ["mlaser"]);
            logE("enemy", p2([
              att.m.name + " answers with " + (D.WMAP[w] ? D.WMAP[w].name : "weapons") + " fire — " + target.unit.name + " shudders under the impact.",
              target.unit.name + " takes a punishing hit from the enemy " + att.m.name + ".",
              "Incoming! " + (D.WMAP[w] ? D.WMAP[w].name : "Heavy") + " rounds slam into " + target.unit.name + "."
            ]));
            state.lastNarr = log.length;
          }
        }
      }
    }
    const EN = { units: eUnits, alive: () => eUnits.filter((x) => !x.dead) };

    let breaksUs = false, breaksEn = false;
    const maxRounds = ri2(BAL.minRounds, BAL.maxRounds) + (defenseTarget ? 8 : 0);
    const startUsPool = us.reduce((a, x) => a + totalHp(x.unit), 0) || 1;
    const enPoolFrac = () => eUnits.reduce((a, u) => a + Math.max(0, u.hp), 0) / Math.max(1, eUnits.reduce((a, u) => a + u.maxHp, 0));
    const usPoolFrac = () => us.filter((x) => !x.dead).reduce((a, x) => a + totalHp(x.unit), 0) / startUsPool;

    for (let r = 1; r <= maxRounds; r++) {
      state.round = r;
      if (r % 5 === 0 && defenseTarget && state.enDead > 0 && eUnits.length < 9 && chance(0.5)) {
        const ren = spawnEnemy(avgTon * r2(0.7, 1.3));
        ren.hp = Math.max(1, Math.round(mechPowerFor(ren.m.id) * scaleF * r2(0.8, 1.25) * BAL.enemyHpK));
        ren.maxHp = ren.hp;
        logE("world", "Reinforcements arrive — the assault is not over.", { type: "round" });
      }
      ourAttackRound();
      enemyAttackRound();
      const noUs = !us.some((x) => !x.dead);
      const noEn = !eUnits.some((x) => !x.dead);
      if (noUs || noEn) break;
      const deadFracUs = state.ourDead / us.length;
      const enAliveFrac = eUnits.filter((x) => !x.dead).length / Math.max(1, state.enStart);
      if (!defenseTarget) {
        if (deadFracUs >= (mt.id === "assassination" || mt.id === "clantrial" ? 0.5 : 0.55)) {
          breaksUs = true;
          logE("world", "The lance is battered past endurance — " + company.name + " calls the retreat.", { type: "end" });
          break;
        }
        if (enAliveFrac <= 0.4 || enPoolFrac() <= 0.4) {
          breaksEn = true;
          logE("world", "Enemy resistance collapses; their survivors break contact.", { type: "end" });
          break;
        }
        if (mt.id === "recon" && r >= 6) {
          const ourHpAvg = us.filter((x) => !x.dead).reduce((a, x) => a + hpPct(x.unit), 0) / Math.max(1, us.filter((x) => !x.dead).length);
          if (ourHpAvg > 0.55 && chance(0.5)) {
            breaksEn = true;
            logE("world", "Recon objective complete — the lance withdraws with full sensor data.", { type: "end" });
            break;
          }
        }
        if (mt.id === "assassination" && state.assassinKilled) {
          breaksEn = true;
          logE("world", "The target is down. With the contract fulfilled, the lance breaks contact.", { type: "end" });
          break;
        }
        if (mt.id === "capture" && state.vipDead) {
          breaksUs = true;
          logE("world", "The charge is lost. Without it, holding the field is pointless.", { type: "end" });
          break;
        }
      } else if (deadFracUs >= 0.55 || usPoolFrac() <= 0.45) {
        breaksUs = true;
        logE("world", "The position is untenable. Withdrawal order given.", { type: "end" });
        break;
      }
      if (r % 4 === 0 && chance(0.55) && !noUs && !noEn) logE("world", "Round " + r + ": the two forces grind at each other, heat and fury rising.", { type: "round" });
    }

    if (!breaksUs && !breaksEn && us.some((x) => !x.dead) && eUnits.some((x) => !x.dead)) {
      const enF = enPoolFrac(), usF = usPoolFrac();
      if (defenseTarget && usF >= 0.55) {
        logE("world", "The attack spent itself against the position. Enemy forces withdraw.", { type: "end" });
        breaksEn = true;
      } else if (state.ourDead / us.length > 0.4 || (usF < enF && usF < 0.6)) {
        logE("world", "With heavy losses and firepower spent, the engagement grinds to a stalemate.", { type: "end" });
      } else if (enF <= 0.62) {
        logE("world", "The enemy, mauled and out of patience, pulls back from the field.", { type: "end" });
        breaksEn = true;
      } else {
        logE("world", "Neither side gives ground. The exchange ends only with the light.", { type: "end" });
      }
    }
    if (breaksUs && !us.some((x) => !x.dead)) breaksUs = true;

    let outcome = "defeat";
    const enDeadAll = state.enDead;
    const ourLossRatio = state.ourDead / us.length;
    const enemyGone = !eUnits.some((x) => !x.dead);
    const enF = enPoolFrac(), usF = usPoolFrac();
    if (breaksUs || ourLossRatio >= 1) {
      if (mt.id === "recon" && !(ourLossRatio >= 1)) outcome = state.enDead >= Math.ceil(state.enStart * 0.3) ? "partial" : "defeat";
      else outcome = "defeat";
    } else if (breaksEn || enemyGone) {
      if (mt.id === "assassination") outcome = state.assassinKilled ? "victory" : enDeadAll >= Math.ceil(state.enStart * 0.7) ? "victory" : "partial";
      else if (mt.id === "recon") outcome = "victory";
      else if (mt.id === "capture") outcome = state.vipDead ? "partial" : "victory";
      else if (mt.id === "defense" || mt.id === "garrison") outcome = ourLossRatio > 0.4 ? "partial" : "victory";
      else outcome = "victory";
    } else {
      if (mt.id === "defense" || mt.id === "garrison") outcome = ourLossRatio > 0.35 ? "defeat" : ourLossRatio > 0.15 ? "partial" : "victory";
      else if (mt.id === "recon") outcome = ourLossRatio < 0.3 ? "victory" : "partial";
      else if (usF - enF > 0.18) outcome = "victory";
      else if (enDeadAll >= Math.ceil(state.enStart * 0.35) || enF <= 0.6 || (mt.id === "assassination" && state.assassinKilled)) outcome = "partial";
      else outcome = "defeat";
    }

    const survivors = us.filter((x) => !x.dead);
    for (const s of survivors) {
      if (s.person) {
        s.xpGain = Math.max(2, Math.round(3 + state.round * 0.35 + (state.killsByPilot[s.person.id] || 0) * 2));
      }
    }
    const unscathedPilots = survivors.filter((x) => x.person && state.injuries.indexOf(x.person.id) < 0);
    const killLeaders = unscathedPilots.filter((x) => state.killsByPilot[x.person.id]);
    const postSpeaker = (killLeaders.length ? killLeaders : unscathedPilots.length ? unscathedPilots : survivors.filter((x) => x.person))[0];
    if (postSpeaker && postSpeaker.person) {
      const scenario = outcome === "victory" ? "victory" : outcome === "partial" ? "partial" : "defeat";
      logE("us", voiceLine(postSpeaker.person, scenario, {}), { type: "quote", personId: postSpeaker.person.id });
    }
    const companyMoraleShift = clamp((outcome === "victory" ? 8 : outcome === "partial" ? 2 : -8) - state.ourDead * 3, -24, 24);
    company.morale = clamp(company.morale + companyMoraleShift, 0, 100);

    const salvageList = [];
    for (const e of eUnits) {
      if (!e.dead) continue;
      const hullK = e.boom ? 0.55 : 1;
      if (R() > (offer.salvagePct / 100) * (e.m.tech === "Clan" ? 0.9 : 1) * hullK) {
        salvageList.push({ kind: "scrap", label: (e.boom ? "Scorched scrap from " : "Scrap from ") + e.m.name, value: Math.round(e.m.cost * r2(0.012, 0.028)) });
        continue;
      }
      const roll = R();
      if (roll < 0.4) {
        const weps = e.m.weapons.slice().sort(() => R() - 0.5).slice(0, 1 + Math.floor(R() * 3));
        salvageList.push({ kind: "parts", label: "Recovered weapons from " + e.m.name, parts: weps.map((wid) => ({ wid })) });
      } else if (roll < 0.68) {
        salvageList.push({ kind: "mech", label: "Salvageable " + e.m.name, chassisId: e.m.id, cond: (e.boom ? 0.12 : 0.3) + R() * 0.3 });
      } else {
        salvageList.push({ kind: "scrap", label: "Scrap from " + e.m.name, value: Math.round(e.m.cost * r2(0.02, 0.04)) });
      }
    }
    const scrapTotal = salvageList.filter((s) => s.kind === "scrap").reduce((a, s) => a + s.value, 0);
    const mechSalvageCount = salvageList.filter((s) => s.kind === "mech").length;
    const partsTotal = salvageList.filter((s) => s.kind === "parts").reduce((a, s) => a + s.parts.length, 0);

    const survivorDmg = {};
    for (const s of survivors) {
      survivorDmg[s.unit.id] = {
        armorLeft: s.unit.armor, structureLeft: s.unit.structure, weapons: s.unit.weapons, crippled: s.unit.crippled
      };
    }
    const destroyedIds = us.filter((x) => x.dead).map((x) => x.unit.id);

    let enemyLossDesc;
    const deadNames = eUnits.filter((x) => x.dead).map((x) => x.m.name);
    if (enDeadAll === 0) enemyLossDesc = "no enemy machines were confirmed destroyed";
    else if (deadNames.length <= 3) enemyLossDesc = deadNames.join(", ");
    else enemyLossDesc = deadNames.length + " enemy machines (" + deadNames.slice(0, 3).join(", ") + ", among others)";

    return {
      seed, offer, outcome, outcomeLabel: outcome === "victory" ? "Victory" : outcome === "partial" ? "Partial Success" : "Defeat",
      missionName: mt.name, missionType: mt.id, planet: offer.planet, terrain: offer.terrain,
      employer: offer.employer, enemyFactionName: enemyFaction.name, enemyFlavor: enName,
      ourPower, enemyPower, rounds: state.round,
      lance: us.map((x) => ({ unitId: x.unit.id, unitName: x.unit.name, chassisId: x.unit.chassisId, personId: x.person ? x.person.id : null, tag: x.tag, dead: x.dead, isVip: x.isVip,
        personDesc: x.person ? (x.person.career || "veteran") + (x.person.traits && x.person.traits.length ? ", " + x.person.traits.map((t) => { const ti = TRAIT_LIST.find((q) => q.key === t); return ti ? ti.name : t; }).join(" & ") : "") + (x.person.motivation ? "; " + x.person.motivation : "") : null,
        post: x.dead ? null : { armor: x.unit.armor, structure: x.unit.structure, weapons: x.unit.weapons, crippled: x.unit.crippled, components: x.unit.components } })),
      destroyedUnitIds: destroyedIds,
      enemyUnits: eUnits.map((x) => ({ name: x.m.name, dead: x.dead, isCommander: x.isCommander })),
      ourDeadCount: state.ourDead, enemyDeadCount: enDeadAll, enemyTotal: state.enStart,
      enemyLossDesc, log, injuries: state.injuries, killsByPilot: state.killsByPilot,
      xpGains: survivors.filter((s) => s.person).map((s) => ({ personId: s.person.id, xp: s.xpGain })),
      moraleShift: companyMoraleShift, salvageList, scrapTotal, mechSalvageCount, partsTotal,
      companyName: company.name
    };
  }

  function battlePayout(company, offer, battle) {
    const pay = offer.pay;
    let amt = 0, label = "";
    if (battle.outcome === "victory") { amt = Math.round(pay); label = "Contract complete — " + offer.missionName + " on " + offer.planet; }
    else if (battle.outcome === "partial") { amt = Math.round(pay * 0.4); label = "Partial fulfillment — " + offer.missionName + " on " + offer.planet; }
    else { amt = Math.round(pay * 0.12); label = "Failed contract (transport fee) — " + offer.missionName; }
    const bonus = battle.outcome === "victory" ? Math.round(pay * rnd(0.05, 0.12)) : 0;
    if (bonus) { label += " + objective bonus"; amt += bonus; }
    return { amt, bonus, label };
  }

  function applyBattle(company, offer, battle) {
    company.activeReports.unshift(battle);
    if (company.activeReports.length > 100) company.activeReports.length = 100;
    const oi = company.offers.findIndex((o) => o.id === offer.id);
    if (oi >= 0) company.offers.splice(oi, 1);
    company.stats.battles++;
    if (battle.outcome === "victory") company.stats.victories++;
    else if (battle.outcome === "defeat") company.stats.defeats++;
    company.stats.kills += battle.enemyDeadCount;

    for (const l of battle.lance) {
      const u = findUnit(company, l.unitId);
      if (!u) continue;
      if (l.dead) {
        u.status = "destroyed";
        u.pilotId = null;
        for (const loc of D.LOCS) { u.armor[loc].cur = 0; u.structure[loc].cur = 0; }
        for (const w of u.weapons) w.state = "destroyed";
        for (const c of COMPONENTS) u.components[c] = "destroyed";
        u.crippled = true;
        const p = findPerson(company, l.personId);
        if (p) p.unitId = null;
        continue;
      }
      if (l.post) {
        for (const loc of D.LOCS) {
          u.armor[loc].cur = l.post.armor[loc].cur;
          u.structure[loc].cur = l.post.structure[loc].cur;
        }
        u.weapons = l.post.weapons;
        u.crippled = l.post.crippled;
        if (l.post.components) u.components = l.post.components;
      }
    }
    for (const i of battle.injuries) {
      const p = findPerson(company, i);
      if (!p) continue;
      p.injuredWeeks = ri(1, 4);
      p.status = "injured";
      p.morale = clamp((isFinite(p.morale) ? p.morale : 62) - 12, 0, 100);
    }
    for (const l of battle.lance) {
      if (l.dead || !l.personId) continue;
      const p = findPerson(company, l.personId);
      if (!p) continue;
      const d = battle.outcome === "victory" ? 3 : battle.outcome === "defeat" ? -3 : 1;
      p.morale = clamp((isFinite(p.morale) ? p.morale : 62) + d, 0, 100);
    }
    for (const g of battle.xpGains) {
      const p = findPerson(company, g.personId);
      if (!p) continue;
      p.xp += g.xp;
      let improved = false;
      while (p.xp >= 6) {
        p.xp -= 6;
        if (p.role === "pilot") {
          if (chance(0.55) && p.gunnery > 0) { p.gunnery--; improved = true; }
          else if (p.piloting > 0) { p.piloting--; improved = true; }
          else if (p.gunnery > 0) { p.gunnery--; improved = true; }
        } else if (p.skill < 10) { p.skill++; improved = true; }
      }
      if (improved) company.log.unshift({ week: company.week, text: p.callsign + " (" + p.role + ") improved a skill in the field" });
      p.salary = calcSalary(p);
    }
    const payout = battlePayout(company, offer, battle);
    if (payout.amt > 0) logTx(company, "contract", payout.label, payout.amt);
    if (payout.bonus) logTx(company, "bonus", "Objective bonus — " + offer.missionName, payout.bonus);
    const repDelta = battle.outcome === "victory" ? 3 : battle.outcome === "partial" ? 1 : -3;
    const newRep = clamp((company.rep[offer.factionId] || 0) + repDelta, -10, 10);
    company.rep[offer.factionId] = newRep;
    if (battle.outcome === "victory" && offer.factionId !== offer.targetId) {
      const tgt = factionById(offer.targetId);
      if (tgt && tgt.type === "house") company.rep[offer.targetId] = clamp((company.rep[offer.targetId] || 0) - 1, -10, 10);
    }
    for (const s of battle.salvageList) {
      const item = Object.assign({}, s);
      item.svId = "sv" + (company.nextIds.contract++);
      company.salvageQueue.push(item);
    }
    company.lastBattle = { offerId: offer.id, battle };
    company.log.unshift({ week: company.week, text: offer.missionName + " on " + offer.planet + ": " + battle.outcomeLabel + " — paid " + Math.round(payout.amt / 1000) + "k C-bills" });
    if (company.log.length > 60) company.log.length = 60;
    return { payout, repDelta, repNew: newRep, battle };
  }

  function startRepair(company, unitId, mode) {
    const u = findUnit(company, unitId);
    if (!u || u.status === "repairing") return { error: u ? "already" : "notfound" };
    const est = repairEstimate(u, company);
    if (est.damagePct < 0.005 && u.status !== "destroyed") return { error: "nodamage" };
    const cost = mode === "rush" ? Math.round(est.cost * 2) : est.cost;
    if (company.funds < cost) return { error: "funds" };
    logTx(company, "repair", (u.status === "destroyed" ? "Rebuild — " : "Repairs — ") + u.name + (mode === "rush" ? " (rush)" : ""), -cost);
    if (mode === "rush") { fixUnit(u); company.log.unshift({ week: company.week, text: u.name + " rushed back to readiness" }); return { ok: true, cost }; }
    u.status = "repairing";
    u.repairDaysLeft = est.days;
    u.repairCostLeft = cost;
    return { ok: true, cost, days: est.days };
  }
  function cancelRepair(company, unitId) {
    const u = findUnit(company, unitId);
    if (!u || u.status !== "repairing") return;
    logTx(company, "refund", "Cancelled repairs — " + u.name, Math.round(u.repairCostLeft * 0.5));
    u.status = "ok"; u.repairDaysLeft = 0; u.repairCostLeft = 0;
  }
  function unitSellValue(unit) {
    return Math.round(unit.cost * (0.35 + 0.3 * armorPct(unit)) * (unit.status === "destroyed" ? 0.35 : 1) / 500) * 500;
  }
  function repairWeeksLeft(company, unit) {
    const techCount = (company ? company.people : []).filter((p) => p.role === "tech" && p.status === "active").length;
    const weekly = 7 * (1 + techCount * 0.5);
    return Math.max(1, Math.ceil((unit.repairDaysLeft || 0) / weekly));
  }
  function sellUnit(company, unitId) {
    const u = findUnit(company, unitId);
    if (!u) return { error: "notfound" };
    const value = unitSellValue(u);
    if (u.pilotId) { const p = findPerson(company, u.pilotId); if (p) p.unitId = null; }
    company.units = company.units.filter((x) => x.id !== u.id);
    logTx(company, "sale", "Sold " + u.name, value);
    return { ok: true, value };
  }

  function buyMarketItem(company, itemId) {
    const m = company.market;
    const it = m.stock.find((s) => s.id === itemId);
    if (!it) return { error: "gone" };
    if (company.funds < it.price) return { error: "funds" };
    if (it.kind === "mech") {
      company.units.push(genUnit(company, it.chassisId, { condition: it.cond, origin: "market" }));
      logTx(company, "market", "Purchased " + D.MECH_MAP[it.chassisId].name, -it.price);
    } else if (it.kind === "weapon") {
      company.partsInv[it.wid] = (company.partsInv[it.wid] || 0) + it.qty;
      logTx(company, "market", "Purchased " + it.qty + "× " + (D.WMAP[it.wid] ? D.WMAP[it.wid].name : it.wid), -it.price);
    }
    m.stock = m.stock.filter((s) => s.id !== itemId);
    return { ok: true };
  }
  function sellPartStock(company, wid) {
    const n = company.partsInv[wid] || 0;
    if (!n) return { error: "none" };
    const w = D.WMAP[wid];
    const mMult = company.market && company.market.merchant ? company.market.merchant.mult : 1;
    const val = Math.round(w.cost * 0.55 * mMult * n / 500) * 500;
    delete company.partsInv[wid];
    logTx(company, "sale", "Sold parts stock — " + n + "× " + w.name, val);
    return { ok: true, value: val };
  }

  function hirePerson(company, role) {
    const cost = role === "pilot" ? 4000 : role === "tech" ? 2500 : 1500;
    if (company.funds < cost) return { error: "funds" };
    const p = genPerson(company, role);
    company.people.push(p);
    tryFormBond(company, p);
    logTx(company, "hire", "Hired " + p.name + " (" + p.callsign + ", " + role + ")", -cost);
    return { ok: true, person: p };
  }
  function firePerson(company, personId) {
    const p = findPerson(company, personId);
    if (!p) return { error: "notfound" };
    const severance = Math.round(p.salary * 4);
    if (p.unitId) { const u = findUnit(company, p.unitId); if (u) u.pilotId = null; }
    for (const q of company.people) if (q.bonds) q.bonds = q.bonds.filter((b) => b.otherId !== p.id);
    company.people = company.people.filter((x) => x.id !== p.id);
    if (p.status === "active") logTx(company, "severance", "Severance — " + p.name, -severance);
    company.morale = clamp(company.morale - (p.role === "pilot" ? 4 : 2), 0, 100);
    return { ok: true };
  }
  function assignPilot(company, pilotId, unitId) {
    const p = findPerson(company, pilotId);
    const u = unitId ? findUnit(company, unitId) : null;
    if (!p) return { error: "notfound" };
    if (p.role !== "pilot") return { error: "role" };
    if (p.status !== "active") return { error: "unavailable" };
    if (u && u.status !== "ok") return { error: "unavailable" };
    const prev = p.unitId ? findUnit(company, p.unitId) : null;
    if (prev) prev.pilotId = null;
    if (u) {
      if (u.pilotId) { const old = findPerson(company, u.pilotId); if (old) old.unitId = null; }
      u.pilotId = p.id;
      p.unitId = u.id;
    } else p.unitId = null;
    return { ok: true };
  }
  function installPart(company, unitId, wid, slotLoc) {
    const u = findUnit(company, unitId);
    if (!u) return { error: "notfound" };
    if ((company.partsInv[wid] || 0) <= 0) return { error: "parts" };
    if (u.status !== "ok") return { error: "busy" };
    const broken = u.weapons.find((w) => w.state === "destroyed" && w.id === wid);
    if (broken) {
      company.partsInv[wid]--;
      broken.state = "ok";
      logTx(company, "refit", "Replaced destroyed " + (D.WMAP[wid] ? D.WMAP[wid].name : wid) + " on " + u.name, 0);
      return { ok: true, type: "replace" };
    }
    const freeSlots = u.weapons.length;
    if (freeSlots >= 12) return { error: "slots" };
    const w = D.WMAP[wid];
    if (w && u.ton < (w.cls === "ballistic" ? w.dmg >= 15 ? 60 : w.dmg >= 10 ? 40 : 20 : w.cls === "missile" ? (w.dmg >= 15 ? 55 : 20) : 20)) return { error: "mass" };
    const locs = ["LT", "CT", "RT", "LA", "RA"];
    const loc = slotLoc || locs[Math.floor(Math.random() * locs.length)];
    const fee = w ? Math.round(w.cost * 0.25) : 5000;
    if (company.funds < fee) return { error: "funds" };
    company.partsInv[wid]--;
    u.weapons.push({ id: wid, loc, state: "ok" });
    logTx(company, "refit", "Installed " + w.name + " on " + u.name, -fee);
    return { ok: true, type: "install", fee };
  }
  function stripWeapon(company, unitId, wi) {
    const u = findUnit(company, unitId);
    if (!u) return { error: "notfound" };
    const w = u.weapons[wi];
    if (!w) return { error: "notfound" };
    if (u.status !== "ok") return { error: "busy" };
    u.weapons.splice(wi, 1);
    company.partsInv[w.id] = (company.partsInv[w.id] || 0) + 1;
    return { ok: true };
  }

  function advanceWeek(company) {
    company.week++;
    for (const fid in company.rep) {
      const r = company.rep[fid];
      if (r !== 0 && chance(0.25)) company.rep[fid] = clamp(r + (r < 0 ? 1 : -1), -10, 10);
    }
    const payroll = weeklyPayroll(company);
    if (payroll) logTx(company, "payroll", "Weekly payroll — " + company.people.filter((p) => p.status === "active").length + " personnel", -payroll);
    const upkeep = weeklyUpkeep(company);
    if (upkeep) logTx(company, "upkeep", "Mech maintenance & storage", -upkeep);
    if (company.loan > 0) {
      const interest = Math.round(company.loan * 0.08 / 500) * 500;
      logTx(company, "loan", "Loan interest (8% weekly)", -interest);
    }
    for (const p of company.people) {
      if (p.injuredWeeks > 0) {
        p.injuredWeeks--;
        if (p.injuredWeeks <= 0) { p.status = "active"; p.injuredWeeks = 0; company.log.unshift({ week: company.week, text: p.callsign + " returns to duty from the infirmary" }); }
      }
    }
    const techCount = company.people.filter((p) => p.role === "tech" && p.status === "active").length;
    for (const u of company.units) {
      if (u.status === "repairing") {
        u.repairDaysLeft -= 7 * (1 + techCount * 0.5);
        if (u.repairDaysLeft <= 0) {
          fixUnit(u);
          company.log.unshift({ week: company.week, text: u.name + " returned to the mechbay roster" });
        }
      }
    }
    const afterPay = company.funds;
    company.morale = clamp(company.morale + (Math.random() < 0.5 ? 1 : -1) + (afterPay < 0 ? -4 : 1), 0, 100);
    if (company.funds < 0) {
      company.morale = clamp(company.morale - 3, 0, 100);
      logTx(company, "overdraft", "Overdraft penalty", -1500);
    }
    company.offers = company.offers.filter((o) => o.expiresWeek > company.week);
    if (!company.market || company.week - company.market.refreshedWeek >= 2) refreshMarket(company);
    if (company.offers.length < 2) refreshOffers(company);
    const payrollN = weeklyPayroll(company);
    if (payrollN > company.funds && company.funds >= 0 && chance(0.4)) company.morale = clamp(company.morale - 1, 0, 100);
    return { payroll, upkeep };
  }
  function takeLoan(company) {
    if (company.loan > 0) return { error: "already" };
    company.loan = 200000;
    logTx(company, "loan", "Emergency line of credit", 200000);
    return { ok: true };
  }
  function repayLoan(company) {
    if (company.loan <= 0) return { error: "none" };
    if (company.funds < company.loan) return { error: "funds" };
    logTx(company, "loan", "Loan repaid in full", -company.loan);
    company.loan = 0;
    return { ok: true };
  }
  function bankruptcyCheck(company) {
    if (company.funds >= -120000) return null;
    return { type: "bankrupt", message: "Creditors have seized the company accounts. " + company.name + " owes more than its DropShip is worth." };
  }
  function companyStanding(company) {
    const out = {};
    for (const f of D.FACTIONS) out[f.id] = company.rep[f.id] || 0;
    return out;
  }

  function avatarSvg(seed, size) {
    const r = mulberry32(seed || 1);
    const pal = [
      ["#b8452f", "#1c3f5e"], ["#2f7a4f", "#54331f"], ["#3a5f9e", "#4d2f52"], ["#c99a2e", "#24374e"],
      ["#8a5fbf", "#2e3b2f"], ["#3f9ea8", "#4d3030"], ["#b0663a", "#293b52"], ["#6e7f8a", "#5c2838"]
    ];
    const [c1, c2] = pal[Math.floor(r() * pal.length)];
    const visor = r() < 0.5 ? "#7fd4ff" : "#ffd27f";
    const horns = r() < 0.35;
    const s = [];
    s.push('<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">');
    s.push('<rect width="120" height="120" rx="10" fill="' + c2 + '"/>');
    s.push('<path d="M22 98 Q20 120 46 120 L74 120 Q100 120 98 98 L94 90 Q84 106 60 106 Q36 106 26 90 Z" fill="' + c1 + '"/>');
    s.push('<circle cx="60" cy="70" r="30" fill="' + c1 + '"/>');
    s.push('<path d="M60 42 L78 58 L72 74 L60 82 L48 74 L42 58 Z" fill="' + visor + '" opacity="0.92"/>');
    if (horns) { s.push('<path d="M36 44 L26 20 L46 32 Z" fill="' + c1 + '"/>'); s.push('<path d="M84 44 L94 20 L74 32 Z" fill="' + c1 + '"/>'); }
    s.push('<rect x="14" y="14" width="92" height="3" rx="1.5" fill="#ffffff" opacity="0.35"/>');
    s.push('<circle cx="26" cy="60" r="1.8" fill="#ffffff" opacity="0.4"/><circle cx="96" cy="26" r="2.4" fill="#ffffff" opacity="0.4"/>');
    s.push("</svg>");
    return s.join("");
  }
  function personAvatar(p) { return avatarSvg(p.avatarSeed || hashStr(p.id + ":" + p.name)); }
  function unitAvatar(unit) {
    const c = D.MECH_MAP[unit.chassisId] || { tech: "IS" };
    const base = unit.skin || (c.tech === "Clan" ? "#5a7d4a" : "#4d5a3c");
    const s = [];
    s.push('<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">');
    s.push('<rect width="120" height="120" rx="10" fill="#1a1f14"/>');
    s.push('<rect x="8" y="8" width="104" height="5" rx="2.5" fill="#e2a63b" opacity="0.9"/>');
    s.push('<path d="M60 98 L30 80 L30 46 Q30 20 60 15 Q90 20 90 46 L90 80 Z" fill="' + base + '" stroke="#0a0d08" stroke-width="2"/>');
    s.push('<circle cx="60" cy="54" r="12" fill="#e2a63b" opacity="0.35"/><circle cx="60" cy="54" r="5.5" fill="#ffedc4" opacity="0.9"/>');
    if (c.weapons && c.weapons.length) {
      const w = D.WMAP[c.weapons[0]];
      if (w) {
        const gl = w.cls === "missile" ? "M28 44 L8 30 M92 44 L112 30" : w.cls === "ballistic" ? "M36 52 L14 62 M84 52 L106 62" : "M36 58 L12 58 M84 58 L108 58";
        s.push('<path d="' + gl + '" stroke="#e2a63b" stroke-width="5" stroke-linecap="round" opacity="0.95"/>');
      }
    }
    s.push('<path d="M60 98 L47 76 L73 76 Z" fill="#0a0d08"/>');
    s.push("</svg>");
    return s.join("");
  }

  const EVT = {
    person: (company, role) => pick(company.people.filter((p) => p.role === role && p.status === "active")) || null,
    pilot: (company) => EVT.person(company, "pilot"),
    tech: (company) => EVT.person(company, "tech"),
    support: (company) => EVT.person(company, "support"),
    unit: (company) => pick(company.units.filter((u) => u.status === "ok")) || null,
    rep: (company, fid, d) => { company.rep[fid] = clamp((company.rep[fid] || 0) + d, -10, 10); },
    morale: (company, d) => { company.morale = clamp(company.morale + d, 0, 100); },
    money: (company, amt, label) => { logTx(company, "event", label, amt); }
  };

  const COMPANY_EVENTS = [
    {
      id: "barfight", title: "Bar Fight on the Dropship Pad", eraMin: 0,
      body: (c) => { const p = EVT.pilot(c); return p ? p.name + " (\"" + p.callsign + "\") picked a fight with a local militia squad in a dive bar near the spaceport. Word reached the employer before you could pay the damages. " + voiceLine(p, "payday", {}) : "A shore-leave brawl outside the hiring hall has become an incident."; },
      choices: [
        { label: "Pay the damages quietly", hint: "-12k C-bills, no reputation loss", run: (c, p) => { EVT.money(c, -12000, "Bar fight damages"); EVT.morale(c, 2); return "The bar owner is paid, the militia looks the other way, and " + (p ? p.callsign : "the crew") + " is grounded for a week."; } },
        { label: "Bail them out with hard words", hint: "Rep -1 with employer", run: (c, p) => { EVT.money(c, -3000, "Bar fight fine"); EVT.rep(c, "steiner", -1); EVT.morale(c, 3); return "You refuse to be shaken down. The militia remembers it — but the crew loves you for it."; } },
        { label: "Let the local lockup have them", hint: "Morale -6, no cost", run: (c, p) => { EVT.morale(c, -6); if (p) { p.morale = clamp(p.morale - 10, 0, 100); } return (p ? p.callsign : "The crew") + " cools off in a militia holding cell for three days and comes back humbled and angry."; } }
      ]
    },
    {
      id: "techmiracle", title: "A Tech's Pet Project", eraMin: 0,
      body: (c) => { const t = EVT.tech(c); const u = EVT.unit(c); return (t ? t.name : "One of the techs") + " has spent off-hours coaxing the ancient cooling system of " + (u ? u.name : "a mech in the bay") + " back to life. It needs a rare part — and a bribe to a quartermaster."; },
      choices: [
        { label: "Fund the project", hint: "-18k, small combat bonus", run: (c, p) => { EVT.money(c, -18000, "Tech project parts"); const u = EVT.unit(c); if (u) { const bonus = Math.round(u.ton * 6); } EVT.morale(c, 3); return "Two weeks later " + (u ? u.name : "the machine") + " runs noticeably cooler. The techs have a small shrine to you now."; } },
        { label: "Sell the part instead", hint: "+12k", run: (c) => { EVT.money(c, 12000, "Sold rare coolant part"); EVT.morale(c, -3); return "The part fetches a good price. The tech stops speaking to you at breakfast."; } }
      ]
    },
    {
      id: "feud", title: "Personality Clash in the Mess Hall", eraMin: 0,
      body: (c) => { const a = EVT.pilot(c); let b = null; let tries = 0; while (tries++ < 10) { const x = pick(c.people.filter((p) => p.role === "pilot")); if (x && x.id !== (a && a.id)) { b = x; break; } } if (!a || !b) return "Two crew members can barely stand to share a table anymore."; return a.callsign + " and " + b.callsign + " have stopped speaking — something about a poker game, a borrowed neurohelmet, and who 'stole' the last kill on the last contract."; },
      choices: [
        { label: "Force them to train together", hint: "Both get XP, morale -3", run: (c) => { const ps = c.people.filter((p) => p.role === "pilot" && p.status === "active"); for (const p of ps.slice(0, 2)) p.xp += 2; EVT.morale(c, -3); return "Ten laps around the mechbay in full cooling vests. They still glare, but they stop bickering over the comms."; } },
        { label: "Let them sort it out", hint: "No effect", run: (c) => { return "It blows over by the next payroll. Mercenaries hold grudges about as long as they hold cash."; } },
        { label: "Make them bet on a sparring match", hint: "Winner +morale, loser pays", run: (c) => { EVT.money(c, 5000, "Sparring match pot"); EVT.morale(c, 2); return "The 'mech hangar becomes a boxing ring for one night. Someone wins, someone pays, everyone drinks."; } }
      ]
    },
    {
      id: "rivalry", title: "Old Grudges, New Fire", eraMin: 0,
      body: (c) => {
        const a = pick(c.people.filter((p) => p.status === "active" && (p.bonds || []).some((b) => b.type === "rival")));
        if (!a) return null;
        const bnd = a.bonds.find((b) => b.type === "rival");
        const b = c.people.find((q) => q.id === (bnd || {}).otherId);
        if (!b) return null;
        return a.callsign + " and " + b.callsign + " dragged their old rivalry onto the flight deck — mud, paint, and a reckoning over who owns the last kill on the last drop. The whole company is watching.";
      },
      choices: [
        { label: "Let them settle it in the ring", hint: "+morale, small pot", run: (c) => { EVT.money(c, 6000, "Rivalry fight pot"); EVT.morale(c, 3); return "A ring is chalked on the hangar floor. The fight is short, ugly, and extremely popular. One walks away richer; the other, wiser."; } },
        { label: "Split them up to opposite ends of the roster", hint: "Morale -1", run: (c) => { EVT.morale(c, -1); return "You separate them to opposite ends of the roster. The animosity cools to a simmer. Mostly."; } },
        { label: "Forfeit both their shore leaves", hint: "Morale -3", run: (c) => { EVT.morale(c, -3); return "No leave, no drama. They glare at you instead of each other, which is a measurable improvement."; } }
      ]
    },
    {
      id: "buddyprank", title: "Shipmates' Revenge", eraMin: 0,
      body: (c) => {
        const a = pick(c.people.filter((p) => p.status === "active" && (p.bonds || []).some((b) => b.type === "buddy" || b.type === "shipmate")));
        if (!a) return null;
        const bnd = a.bonds.find((b) => b.type === "buddy" || b.type === "shipmate");
        const b = c.people.find((q) => q.id === (bnd || {}).otherId);
        if (!b) return null;
        return "The mess hall smells faintly of fish. " + a.callsign + " and " + b.callsign + " are trying very hard not to laugh, and the cook is trying very hard to find out who 'borrowed' the commissary's frozen rations overnight.";
      },
      choices: [
        { label: "Play it straight — deny all knowledge", hint: "+morale, no cost", run: (c) => { EVT.morale(c, 3); return "You inspect the mess with a perfectly straight face, declare it a mystery, and quietly cover the cook's tab at the next port. The crew loves a good prank."; } },
        { label: "Confiscate the evidence", hint: "+1k, morale -2", run: (c) => { EVT.money(c, 1000, "Contraband ration auction"); EVT.morale(c, -2); return "The fish is confiscated and quietly auctioned back to the commissary at a profit. The shipmates are docked a day's pay and remain entirely unrepentant."; } }
      ]
    },
    {
      id: "gambling", title: "A Debt Comes Due", eraMin: 0,
      body: (c) => { const p = pick(c.people.filter((x) => x.traits.indexOf("gambler") >= 0)); if (!p) return null; return p.name + " (" + p.callsign + ") owes 20,000 C-bills to a loan shark who has just found the DropShip. The collector is polite. His security team is not."; },
      choices: [
        { label: "Cover the debt", hint: "-22k, +morale", run: (c, p) => { EVT.money(c, -22000, "Gambling debt paid"); EVT.morale(c, 3); if (p) p.morale = clamp(p.morale + 8, 0, 100); return "The debt is paid. " + (p ? p.callsign : "The gambler") + " promises it's the last time. It is not, but everyone already knows that."; } },
        { label: "Offer the collector a job instead", hint: "Hire a support, -8k", run: (c) => { EVT.money(c, -8000, "Buyout of gambling debt"); const np = genPerson(c, "support"); c.people.push(np); return "The 'collector' turns out to be a retired sergeant who wants out of the leg-breaking business. " + np.name + " signs on as support staff."; } },
        { label: "Pay half, send them packing", hint: "Rep -1 pirates, +10k debt remains", run: (c, p) => { EVT.money(c, -10000, "Partial debt payment"); EVT.rep(c, "pirate", -1); EVT.morale(c, -2); if (p) p.morale = clamp(p.morale - 6, 0, 100); return "You pay half and promise the rest after the next contract. The collector smiles. You're fairly sure that smile is a threat."; } }
      ]
    },
    {
      id: "orphan", title: "A Stowaway in the Mech Bay", eraMin: 0,
      body: (c) => { const p = EVT.unit(c); return "A grimy teenager is found sleeping inside the actuator housing of " + (p ? p.name : "a mech") + ". They claim they can fix anything and are not leaving."; },
      choices: [
        { label: "Take them on as support", hint: "Hire a support (free)", run: (c) => { const np = genPerson(c, "support"); np.traits = np.traits.filter((t) => t !== "nobleborn"); np.traits.push("orphan"); np.age = 17; c.people.push(np); EVT.morale(c, 4); return "You hand them a wrench and a cot. " + np.name + " is the youngest member of the company and possibly the most loyal."; } },
        { label: "Send them to the local orphanage", hint: "Morale -2", run: (c) => { EVT.morale(c, -2); return "The kid is handed over with a bag of food and 500 C-bills. Nobody looks happy about it."; } }
      ]
    },
    {
      id: "lostech", title: "A Farmer's Basement", eraMin: 0,
      body: (c) => { return "A nervous planetary official approaches you off the record. A farmer's cellar on the far continent has turned up 'something old' — and the official is afraid of who might hear about it before you can get there."; },
      choices: [
        { label: "Investigate immediately", hint: "Possible LosTech find", run: (c) => { if (chance(0.5)) { EVT.money(c, -15000, "Expedition costs"); const pool = ["gauss", "erppc", "erll", "erml", "ssrm2", "uac5"]; const w = pick(pool); c.partsInv[w] = (c.partsInv[w] || 0) + 1; return "A week of dusty hiking finds a sealed Star League munitions case. Inside: one functional " + (D.WMAP[w] ? D.WMAP[w].name : w) + ". The techs weep with joy."; } EVT.money(c, -15000, "Expedition costs"); EVT.morale(c, -3); return "The 'cache' turns out to be a defunct agri-commune's irrigation pumps. You bought 2,000 meters of rusted pipe."; } },
        { label: "Sell the coordinates", hint: "+8k, nothing found", run: (c) => { EVT.money(c, 8000, "Sold cache coordinates"); return "A ComStar archivist pays for the coordinates and thanks you for your 'patriotism'. You feel vaguely robbed."; } },
        { label: "Ignore it — too risky", hint: "Nothing happens", run: (c) => { return "Some things are more trouble than they're worth. The official finds someone braver."; } }
      ]
    },
    {
      id: "piratefeint", title: "Pirate Intel for Sale", eraMin: 0,
      body: (c) => { return "A scarred man in the hiring hall claims to know where a pirate band is keeping a stockpile of weapons — and offers to sell you the raid coordinates. The pirates, he says, are 'between commanders' right now.'"; },
      choices: [
        { label: "Buy the intel and raid them", hint: "-25k, then a parts windfall", run: (c) => { EVT.money(c, -25000, "Intel purchase"); const n = 3 + Math.floor(Math.random() * 4); const pool = eraWeaponPool(c); for (let i = 0; i < n; i++) { const w = pick(pool); c.partsInv[w.id] = (c.partsInv[w.id] || 0) + 1; } EVT.rep(c, "pirate", -2); EVT.morale(c, 3); return "Your lance hits the pirate cache before dawn. " + n + " functional weapon systems are loaded onto the DropShip, plus enough spare parts to make the techs giddy."; } },
        { label: "Walk away", hint: "No effect", run: () => { return "You've seen too many 'too good to be true' deals end in an ambush."; } }
      ]
    },
    {
      id: "morale", title: "Crew Morale Slump", eraMin: 0,
      body: (c) => { return "The mess hall is quiet. Payroll was thin, repairs are backed up, and everyone is staring at their rations like they're a court-martial. Something has to change."; },
      choices: [
        { label: "Buy out the local tavern for a night", hint: "-10k, +8 morale", run: (c) => { EVT.money(c, -10000, "Crew night out"); EVT.morale(c, 8); return "For one night, the company is a family again. The next morning, nobody remembers who paid — but everyone remembers the night."; } },
        { label: "Order a morale-boosting address", hint: "Free, small effect", run: (c) => { EVT.morale(c, 3); return "You give a speech about the next big contract. It works about as well as most speeches — which is to say, somewhat."; } },
        { label: "Let them grumble", hint: "Nothing happens", run: () => { return "Grumblers gonna grumble. It passes."; } }
      ]
    },
    {
      id: "comstar", title: "An Odd ComStar Request", eraMin: 0, eraMax: 1,
      body: () => { return "A ComStar adept requests a 'quiet conversation' about a shipment that needs an armed escort between HPG stations. The pay is generous; the paperwork is... unusual. You are asked to sign in triplicate that you will not ask questions."; },
      choices: [
        { label: "Accept the escort work", hint: "+60k, rep +2 ComStar", run: (c) => { EVT.money(c, 60000, "ComStar escort retainer"); EVT.rep(c, "comstar", 2); return "The shipment is a sealed container the size of a commode. You deliver it, you are paid, and you do not ask questions. Ever."; } },
        { label: "Decline politely", hint: "No effect", run: () => { return "Some clients you don't owe favors to. The adept nods as if expecting exactly that."; } }
      ]
    }
  ];
  const CACHE_EVENTS = [
    {
      id: "cache", title: "Star League Cache Discovered", eraMin: 1,
      body: (c, battle) => { return "While sweeping the battlefield, a tech's proximity alarm screams. Buried under a collapsed ferrocrete bunker is a sealed Star League depot — untouched since the fall of the League. The find is worth a fortune... if you can get it out before anyone else notices."; },
      choices: [
        { label: "Call in a formal excavation (2 weeks)", hint: "Safe but slow — 40% chance hostiles arrive", run: (c) => { if (chance(0.6)) { return grantCache(c, 1); } EVT.money(c, -20000, "Cache extraction costs"); EVT.morale(c, -3); return "Halfway through the excavation, a rival merc unit arrives with a signed 'claim'. You leave with a single case of ER medium lasers and a grudge."; } },
        { label: "Fast extraction tonight", hint: "Risky — better prize if it works", run: (c) => { if (chance(0.4)) { return grantCache(c, 2); } const n = ri(1, 2); for (let i = 0; i < n; i++) { const w = pick(["erml", "ssrm2", "erppc", "uac5"]); c.partsInv[w] = (c.partsInv[w] || 0) + 1; } EVT.rep(c, "pirate", -1); return "You blow the vault at 2 a.m. and grab what you can — " + n + " solid weapon systems — before the perimeter sensors light up. The DropShip lifts with pirate fire chasing the ramp."; } },
        { label: "Sell the coordinates to ComStar", hint: "+80k, no hardware", run: (c) => { EVT.money(c, 80000, "Sold cache coordinates to ComStar"); return "A ComStar recovery team arrives within the week. The check clears. You have chosen the quiet life."; } }
      ]
    }
  ];
  function grantCache(c, tier) {
    const rare = ["gauss", "erppc", "erll", "uac10", "lbx10"];
    const rolls = tier === 2 ? 3 : 2;
    const got = [];
    for (let i = 0; i < rolls; i++) {
      const w = chance(0.5) ? pick(rare) : pick(eraWeaponPool(c)).id;
      c.partsInv[w] = (c.partsInv[w] || 0) + 1;
      got.push(D.WMAP[w] ? D.WMAP[w].name : w);
    }
    EVT.morale(c, 6);
    return "The vault opens to reveal pristine Star League engineering. Recovered: " + got.join(", ") + ". Your techs look like they might kiss the ground." + (tier === 2 ? " The risk was worth it." : "");
  }
  function rollCacheChance(company, battle) {
    const era = eraOf(company);
    let chanceBase = era.losTech;
    if (battle && (battle.missionType === "objraid" || battle.missionType === "clantrial")) chanceBase += 0.04;
    return chance(chanceBase);
  }

  function startCompanyEvents(company, battleRef) {
    const out = [];
    const cache = rollCacheChance(company, battleRef);
    if (cache) { const ev = pick(CACHE_EVENTS); out.push(Object.assign({ kind: "cache", battleRef }, ev)); }
    const pool = COMPANY_EVENTS.filter((e) => (e.eraMin === undefined || e.eraMin <= company.eraIdx) && (e.eraMax === undefined || e.eraMax >= company.eraIdx));
    if (chance(0.5) && pool.length) {
      let ev = pick(pool);
      let tries = 0;
      while (ev.body(company) === null && tries++ < 8) ev = pick(pool);
      out.push(Object.assign({ kind: "company" }, ev));
    }
    return out;
  }

  window.MGM = {
    BAL, TRAITS, TRAIT_LIST, COMPONENTS, COMP_INFO, componentDamage, D, mulberry32, hashStr, clamp, pick, rnd, ri, chance,
    voiceLine, genPerson, calcSalary, findPerson, findUnit, findBonds, bondLabel, BOND_TYPES,
    weeklyPayroll, weeklyUpkeep, totalWeeklyBurn, logTx, ledgerSummary, logisticsSummary,
    newCompany, genUnit, unitPower, mechPowerFor, sumWeaponDmg, hpPct, armorPct, missingArmor,
    sanitizeCompany,
    companyRating, eraOf, eraFactions, eraMechPool, eraWeaponPool, factionById, repLabel, merchantFor,
    refreshMarket, refreshOffers, battle, applyBattle, battlePayout, repairEstimate,
    startRepair, cancelRepair, sellUnit, fixUnit, buyMarketItem, sellPartStock,
    unitSellValue, repairWeeksLeft,
    hirePerson, firePerson, assignPilot, installPart, stripWeapon,
    advanceWeek, takeLoan, repayLoan, bankruptcyCheck,
    avatarSvg, personAvatar, unitAvatar,
    startCompanyEvents, COMPANY_EVENTS, CACHE_EVENTS, TERRAINS, TERRAIN_AFFIN, pickTerrainFor,
    availPilots: (company) => company.people.filter((p) => p.role === "pilot" && p.status === "active"),
    availUnits: (company) => company.units.filter((u) => u.status === "ok"),
    availUnitsWithPilots: (company) => company.units.filter((u) => u.status === "ok" && u.pilotId && findPerson(company, u.pilotId) && findPerson(company, u.pilotId).status === "active")
  };
})();
