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
  const mixTrait = (kind) => {
    const opts = kind === "pilot" ? TRAIT_LIST : TRAIT_LIST.filter((t) => t.tag !== "neg");
    return pick(opts).key;
  };

  const VOICE_GENERIC = {
    deploy: [
      "{call}, lance in the green. Ready to drop.",
      "All systems nominal. {call} is go for the run-in.",
      "Reading you five-by-five, Command. {call} is ready to earn their pay.",
      "Last one aboard buys the first round. {call}, moving out."
    ],
    brief: [
      "{call} wants the opfor's weight and the extraction corridor. In that order.",
      "Keep it simple and I'll keep it clean, says {call}.",
      "You're paying for a soldier, not a martyr. {call} intends to come back.",
      "{call} studies the map in silence, then nods once."
    ],
    kill: [
      "Target down. Good shooting, {call}.",
      "{call} reports a confirmed kill.",
      "One more ghost for the furnace, says {call}.",
      "Scratch one, {call} calls it in.",
      "The target is off the board. {call} is already re-engaging."
    ],
    hurt: [
      "{call} — I'm hit! Armor's compromised!",
      "{call} grunts as shells find the armor.",
      "Damage report from {call}: they'll live.",
      "{call} takes a hit and keeps the machine upright by will alone.",
      "Armor's peeling off the {call}'s machine — still fighting."
    ],
    injury: [
      "{call} is in the medbay with a cracked rib and a bad attitude.",
      "A medic is up all night with {call}. They'll fly again, eventually.",
      "{call} comes out of the cockpit grinning through a split lip.",
      "{call} waves off the stretcher, then collapses two steps later."
    ],
    loss: [
      "They killed my machine. I felt every bolt of her go.",
      "{call} watched the wreck burn. That one is going to sting for a while.",
      "Nothing left of {call}'s 'mech but scrap and a bad memory.",
      "She was a good machine. {call} will find another. Eventually."
    ],
    dry: [
      "Bin's dry! Somebody get me an ammo truck!",
      "{call} is down to harsh language and harsh language only.",
      "Click. Click. {call} is out.",
      "{call} reports all ammo expended. Falling back to bare knuckles."
    ],
    overheat: [
      "Heat's in the red! Shutting down!",
      "{call} dumps a salvo of coolant and prays.",
      "The cockpit is a sauna and {call} can smell the armor cooking.",
      "{call}: 'She's glowing like a forge in here!'"
    ],
    extraction: [
      "Boots on the deck. Get me out of this tin can.",
      "{call}, down and clear. Somebody else can fly her home.",
      "Bring the DropShip around — {call} is done for today."
    ],
    victory: [
      "We did it. Collect the salvage and let's go home.",
      "Command, this is {call} — objective secure.",
      "That's another contract in the bag.",
      "Field's ours. {call} is already counting the salvage.",
      "Enemy is broken. {call} calls it a good day's work."
    ],
    partial: [
      "Job's done, more or less. Let's not ask too many questions.",
      "We held the field. The employer can keep their bonus.",
      "{call} calls it a draw and pockets the fuel costs.",
      "Partial pay for partial work. {call} has seen worse math."
    ],
    defeat: [
      "Command, we're pulling out. Too hot.",
      "{call} calls the retreat — nobody argues.",
      "They got us. Regroup and count the damage.",
      "We lost this one. {call} is already thinking about the rematch."
    ],
    payday: [
      "Payday! Drinks are on {call}.",
      "C-bills in the account. {call} is already spending them.",
      "{call} eyes the bank transfer like a hawk.",
      "{call} counts the payout twice and grins anyway."
    ],
    salvage: [
      "Dibs on the left arm — that's good myomer, says {call}.",
      "{call} is already tagging the wrecks for the recovery crew.",
      "That's a lot of prime salvage for one little contract.",
      "{call} is measuring the wreckage with a merchant's eye."
    ],
    camp: [
      "{call} has found a card game and a bottle of something illegal.",
      "{call} spends the evening tuning the 'mech by hand. No techs allowed.",
      "{call} is asleep in the cockpit again. Do not wake them.",
      "{call} has adopted a stray from the spaceport. It has opinions.",
      "{call} argues tactics with anyone who will listen, and several who will not."
    ],
    training: [
      "Again. Slower this time, says {call}.",
      "{call} runs the sim until the pattern is muscle memory.",
      "Sweat, cursing, and another dozen repetitions — that is how {call} sharpens.",
      "{call} corrects the rookies with a patience nobody expected."
    ],
    recruit: [
      "Sign me up and I'll earn my keep in the first drop, says {call}.",
      "{call} reads the contract twice and asks about the 'mech, not the pay.",
      "Point me at a cockpit and get out of the way, {call} says."
    ],
    event: [
      "Trouble. There's always trouble, says {call}.",
      "{call} mutters something unprintable about shore leave.",
      "Somebody is going to have to explain this to the employer."
    ]
  };
  const VOICE_SPECIAL = {
    sharpshooter: {
      kill: ["One shot. That's all it took.", "Center mass. Textbook, says {call}."],
      deploy: ["Give me a clear lane and I'll end this in three shots.", "I don't miss. Position me accordingly."],
      dry: ["I don't need more ammo. I need the shot. And I'm out of shots."]
    },
    daredevil: {
      kill: ["Straight through the fire. Ha!", "Who says you can't outrun a PPC?"],
      deploy: ["Let's make it interesting.", "Point me at the middle of them and stand back."],
      hurt: ["That the best they've got? I'm still flying!", "Close one. Do it again!"],
      victory: ["See? I told you the wild way works."]
    },
    ironwill: {
      hurt: ["I'm still standing. Keep the plan.", "Stow the sympathy and give me a target."],
      defeat: ["We lost the field, not the war. Regroup.", "Nobody panics. That is an order."],
      loss: ["They can scrap my machine. They cannot scrap me."],
      deploy: ["I've buried worse odds than this. Let's go."]
    },
    tactician: {
      deploy: ["Feed me the opfor's order of battle and I'll write the fight before it starts.", "Hold the center. Let them come. They will."],
      victory: ["Textbook. Almost boring, really.", "The plan held. That is the whole story."],
      defeat: ["We were out-deployed, not out-fought. Note it for next time."],
      kill: ["That was the keystone. The rest will fold."]
    },
    blooded: {
      victory: ["Been doing this twenty years. Still gets the blood up."],
      deploy: ["I've dropped into worse. Let's go."],
      loss: ["A machine is a machine. I bury friends, not 'mechs."],
      kill: ["Seen it a hundred times. Never gets old."]
    },
    coldblooded: {
      kill: ["Target neutralized. Next.", "He never saw it. That is the point."],
      deploy: ["No theatrics. We go in, we finish it, we leave."],
      victory: ["It's done. Don't celebrate, consolidate."],
      hurt: ["Superficial. Continuing the assault."]
    },
    guardian: {
      hurt: ["It's not my damage that matters — check the rest of the lance!", "I'll hold, get the wounded out first!"],
      victory: ["Everyone came home. That's the only win I count.", "Sound off, lance. ...Good."],
      loss: ["I should have been there faster. I wasn't."],
      deploy: ["I take the exposed flank. You take the kill."]
    },
    natural: {
      victory: ["The machine did most of it. I just held on.", "It's like breathing. You don't think about breathing."],
      deploy: ["I don't think about the controls anymore. Let's fly."],
      kill: ["Didn't even have to aim. It just lined up."]
    },
    hothead: {
      hurt: ["They got me! Fine, I'm fine! Keep shooting!", "I'm hit — never mind, it's just paint."],
      kill: ["Get some! Who's next?!", "That's one — now the rest of you!"],
      dry: ["Out of ammo? Fine! I'LL USE MY FISTS!"],
      defeat: ["We could have taken them! We SHOULD have taken them!"]
    },
    gloryhound: {
      kill: ["THAT one was mine! You all saw that, right?", "Did you get that on the holo-recorder?!"],
      victory: ["They'll write songs about this!"],
      deploy: ["Save the front row for me. I'm going to be magnificent."],
      salvage: ["That kill was all mine. The salvage should be too."]
    },
    thrillseeker: {
      deploy: ["Finally. I was getting bored."],
      hurt: ["Yes! That woke me up!", "Now THAT was a hit. Again!"],
      victory: ["Aw, it's over already?", "Can we do one more? No? Fine."]
    },
    temperamental: {
      defeat: ["I told you this contract was cursed. I TOLD you."],
      deploy: ["I hate this planet. I hate this contract. But I'll fly it."],
      payday: ["I don't care about the money. I care that we WON."],
      kill: ["About time. I was starting to take it personally."]
    },
    paranoid: {
      deploy: ["They're out there. They're ALWAYS out there.", "Nobody touch anything. We do this by the book."],
      victory: ["We got lucky. Check the flanks again. Twice."],
      hurt: ["I KNEW it! I told you! Ambush!"]
    },
    braggart: {
      victory: ["You're welcome, everyone. You're welcome."],
      kill: ["I make this look easy.", "That is how a real pilot does it."],
      training: ["I don't need practice. I need an audience."]
    },
    gambler: {
      victory: ["Pay up, Command. I had even money on us."],
      deploy: ["Fifty says I bag more than the rest of you combined."],
      loss: ["...I don't want to talk about the odds on that one."],
      payday: ["Winnings stay winnings. The house always wins in the long run."]
    },
    jittery: {
      deploy: ["Just... just give me a second. Okay. Okay. Go."],
      hurt: ["I'm hit, I'm hit — okay, okay, I'm still here."],
      victory: ["We're alive. We're actually alive."]
    },
    mystic: {
      kill: ["The omens were correct.", "The ancestors guided that shot."],
      victory: ["I saw this outcome in the smoke this morning."],
      deploy: ["The omens are quiet. That worries me more than screaming ones.", "Do not fly over the black water. I have seen what waits there."],
      loss: ["It was written. It did not have to be. But it was."]
    },
    nobleborn: {
      deploy: ["One does not retreat from rabble. One disassembles them.", "My tutors would despair. Let us get on with it."],
      payday: ["Money is such a common thing. Still, it spends.", "Do send the bill to my estate. If it still stands."],
      kill: ["One does so dislike a fair fight."]
    },
    farmkid: {
      deploy: ["Ground's soft here. We'll bog down if we're not careful.", "Same as fixing a fence line — steady, no wasted motion."],
      salvage: ["Now THAT is a fine piece of equipment. Full tank, nearly new.", "This whole field is one good harvest, by salvage standards."],
      victory: ["Good crop. Load her up before someone takes it."]
    },
    loremaster: {
      kill: ["That was a {enemyMech}. Now it's a crater."],
      deploy: ["That machine out there has a famous service record. I'll spoil the ending.", "They're fielding Star League surplus. Meaning they can't replace it."],
      victory: ["For the record, that engagement was a classic envelopment on the left."]
    },
    spacenut: {
      deploy: ["Feels good to be under a sky again — briefly.", "Reading gravity like a jump plot. I'm ready."],
      victory: ["Nothing beats a drop that goes right. Nothing."],
      kill: ["Clean as a deorbit burn."]
    },
    pyro: {
      kill: ["Burn. Beautiful.", "Look at it GO!"],
      deploy: ["Point me at something that won't stop burning."],
      victory: ["Damn. That was the prettiest thing I've seen all month."]
    },
    arena: {
      kill: ["Crowd, are you not entertained?!", "And THAT is how you close a main event!"],
      deploy: ["Solaris rules, no crowd. Shame, really."],
      victory: ["Five-star performance. Tell the promoter."]
    },
    orphan: {
      deploy: ["I've got nowhere to be but here. That's freedom."],
      loss: ["I've lost homes before. It doesn't get easier."],
      victory: ["We all came home. That's a family thing. You wouldn't get it."]
    },
    packrat: {
      victory: ["I already called dibs on the salvage."],
      salvage: ["Don't you DARE leave that actuator behind. That's worth a month's pay!"],
      deploy: ["I've got a spare of everything. Even spares for the spares."]
    },
    chatterbox: {
      kill: ["—and that's the fourth one this month, and did I mention—", "—did you SEE that, because I saw that, and let me tell you—"],
      deploy: ["Okay so I've been thinking about the terrain, and the weather, and—", "Nobody ever lets me talk during the good parts, so—"],
      victory: ["—and THAT is why I said we should flank, which I did say, remember—"]
    },
    tech_head: {
      deploy: ["I rebuilt half this machine last night. It owes me.", "Gyro's humming a note I don't love. Keep the fight short."],
      hurt: ["That's going to be a rebuild. Note the starboard actuator.", "I felt the heat sink shear. I'll fix it."],
      victory: ["Good. Now I get to take her apart properly."]
    },
    zen: {
      deploy: ["Breathe. Center. Then fly.", "The target will present itself when it is time."],
      kill: ["It is done.", "One less weight in the world."],
      victory: ["Good work, all. Now we rest.", "The field is quiet. That is enough."],
      defeat: ["We are alive. We will train. We will return."]
    }
  };
  function voiceLine(person, scenario, vars) {
    let bank = VOICE_GENERIC[scenario] || VOICE_GENERIC.kill;
    let special = [];
    if (person) {
      for (const t of person.traits) { const s = VOICE_SPECIAL[t] && VOICE_SPECIAL[t][scenario]; if (s) special = special.concat(s); }
      if (special.length && chance(0.55)) bank = special;
    }
    const v = Object.assign({ call: person ? person.callsign : "Unknown", first: person ? person.name.split(" ")[0] : "Unknown", name: person ? person.name : "Unknown" }, vars || {});
    return pick(bank).replace(/\{(\w+)\}/g, (m, k) => (v[k] !== undefined ? v[k] : (k === "enemyMech" ? "enemy machine" : "")));
  }
  function banterLines(persons, scenario, count, vars) {
    const pool = (persons || []).filter((p) => p && p.callsign);
    if (!pool.length) return [];
    const out = [], used = {};
    const n = Math.min(count || 2, pool.length);
    let guard = 0;
    while (out.length < n && guard++ < n * 8) {
      const p = pick(pool);
      if (used[p.id]) continue;
      used[p.id] = true;
      out.push({ personId: p.id, callsign: p.callsign, name: p.name, text: voiceLine(p, scenario, vars) });
    }
    return out;
  }
  function banterText(person, scenario, r) {
    let bank = VOICE_GENERIC[scenario] || VOICE_GENERIC.kill;
    let special = [];
    for (const t of (person.traits || [])) { const s = VOICE_SPECIAL[t] && VOICE_SPECIAL[t][scenario]; if (s) special = special.concat(s); }
    if (special.length && r() < 0.6) bank = special;
    const v = { call: person.callsign, first: person.name.split(" ")[0], name: person.name };
    return bank[Math.floor(r() * bank.length)].replace(/\{(\w+)\}/g, (m, k) => (v[k] !== undefined ? v[k] : (k === "enemyMech" ? "enemy machine" : "")));
  }
  function barracksBanter(company, count) {
    const pool = ((company && company.people) || []).filter((p) => p.status === "active" && (p.role === "pilot" || p.role === "tech" || p.role === "support"));
    if (!pool.length) return [];
    const r = mulberry32(hashStr("banter:" + ((company && company.name) || "") + ":" + ((company && company.week) || 0)));
    const arr = pool.slice();
    for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = arr[i]; arr[i] = arr[j]; arr[j] = t; }
    const scenarios = ["camp", "camp", "payday", "training", "brief", "salvage", "event"];
    const n = Math.min(count || 3, arr.length);
    const out = [];
    for (const p of arr.slice(0, n)) {
      const scenario = scenarios[Math.floor(r() * scenarios.length)];
      out.push({ personId: p.id, callsign: p.callsign, name: p.name, role: p.role, scenario, text: banterText(p, scenario, r) });
    }
    return out;
  }
  function eventVoice(company, scenario) {
    const pool = ((company && company.people) || []).filter((p) => p.status === "active");
    if (!pool.length) return null;
    const p = pick(pool);
    return { personId: p.id, callsign: p.callsign, name: p.name, text: voiceLine(p, scenario || "camp", {}) };
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
    np.bonds.push({ type, otherId: q.id, sinceWeek: company.week, drops: 0, lastWeek: company.week });
    q.bonds = q.bonds || [];
    q.bonds.push({ type, otherId: np.id, sinceWeek: company.week, drops: 0, lastWeek: company.week });
  }

  function bondBetween(a, b) {
    if (!a || !b) return null;
    return (a.bonds || []).find((x) => x.otherId === b.id) || null;
  }
  function bondStrength(bond) { return 1 + Math.min(isFinite(bond && bond.drops) ? bond.drops : 0, 6) * 0.22; }

  function lanceBonds(company, persons) {
    const list = (persons || []).filter((p) => p && p.role === "pilot");
    const ids = {};
    for (const p of list) ids[p.id] = true;
    const out = { mod: {}, pos: [], neg: [], net: 0 };
    for (const p of list) out.mod[p.id] = 0;
    const seen = {};
    for (const p of list) {
      for (const b of p.bonds || []) {
        if (!ids[b.otherId]) continue;
        const key = [p.id, b.otherId].sort().join("|");
        if (seen[key]) continue;
        seen[key] = true;
        const q = list.find((x) => x.id === b.otherId);
        if (!q) continue;
        const t = BOND_TYPES[b.type];
        const s = bondStrength(b);
        if (t && t.tone === "neg") {
          const v = clamp(0.028 * s, 0.012, 0.09);
          out.mod[p.id] -= v; out.mod[q.id] -= v;
          out.neg.push({ a: p, b: q, bond: b, v: v });
        } else {
          const v = clamp(0.022 * s, 0.01, 0.075);
          out.mod[p.id] += v; out.mod[q.id] += v;
          out.pos.push({ a: p, b: q, bond: b, v: v });
        }
      }
    }
    const vals = [];
    for (const id in out.mod) { out.mod[id] = clamp(out.mod[id], -0.16, 0.12); vals.push(out.mod[id]); }
    out.net = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    return out;
  }

  function evolveBonds(company, battle) {
    const changes = [];
    const persons = (battle.lance || []).map((l) => (l.personId ? findPerson(company, l.personId) : null)).filter(Boolean);
    const crew = persons.filter((p) => p.role === "pilot");
    const losses = (battle.lance || []).filter((l) => l.dead).length;
    const victory = battle.outcome === "victory";
    for (let i = 0; i < crew.length; i++) {
      for (let j = i + 1; j < crew.length; j++) {
        const a = crew[i], b = crew[j];
        const ba = bondBetween(a, b), bb = bondBetween(b, a);
        if (ba || bb) {
          const nd = Math.min((isFinite(ba && ba.drops) ? ba.drops : 0) + 1, 12);
          if (ba) { ba.drops = nd; ba.lastWeek = company.week; }
          if (bb) { bb.drops = nd; bb.lastWeek = company.week; }
          if (ba && bb && ba.type === "buddy" && nd >= 4 && chance(0.2)) {
            ba.type = "shipmate"; bb.type = "shipmate";
            changes.push({ kind: "deeper", a: a.callsign, b: b.callsign, type: "shipmate", text: a.callsign + " and " + b.callsign + " are inseparable after " + nd + " drops together." });
            company.log.unshift({ week: company.week, text: a.callsign + " and " + b.callsign + " have become old shipmates" });
          }
          continue;
        }
        let cf = 0.12 + (victory ? 0.1 : 0) - losses * 0.05;
        cf = clamp(cf, 0.03, 0.34);
        if (!chance(cf)) continue;
        const bad = (battle.outcome === "defeat" || losses > 0) && chance(0.6);
        const type = bad ? "rival" : pick(["buddy", "shipmate", "mentor"]);
        const since = company.week, d = 1;
        a.bonds = a.bonds || []; b.bonds = b.bonds || [];
        a.bonds.push({ type, otherId: b.id, sinceWeek: since, drops: d, lastWeek: since });
        b.bonds.push({ type, otherId: a.id, sinceWeek: since, drops: d, lastWeek: since });
        if (type === "rival") {
          changes.push({ kind: "rival", a: a.callsign, b: b.callsign, type: type, text: "A feud is born — " + a.callsign + " and " + b.callsign + " blame each other for " + battle.planet + "." });
          company.log.unshift({ week: company.week, text: "Feud: " + a.callsign + " and " + b.callsign + " stopped speaking after " + battle.planet });
        } else {
          const lbl = type === "shipmate" ? "old shipmates" : type === "mentor" ? "mentor and protege" : "buddies";
          changes.push({ kind: "bond", a: a.callsign, b: b.callsign, type: type, text: a.callsign + " and " + b.callsign + " came back from " + battle.planet + " as " + lbl + "." });
          company.log.unshift({ week: company.week, text: a.callsign + " and " + b.callsign + " bonded on " + battle.planet });
        }
      }
    }
    const coh = lanceBonds(company, crew);
    for (const p of crew) {
      const m = coh.mod[p.id] || 0;
      p.morale = clamp(Math.round((isFinite(p.morale) ? p.morale : 62) + m * 55), 0, 100);
    }
    return changes;
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
    const gun = person ? clamp((6 - effGunnery(person)) * 0.08, -0.2, 0.4) : 0;
    const tired = person ? 1 - clamp(person.fatigue || 0, 0, 100) * 0.0006 : 1;
    const frame = unit.ton * 2.4 * (0.2 + 0.8 * hpPct(unit)) * (unit.crippled ? 0.55 : 1) * componentMult(unit);
    return Math.max(1, Math.round((frame + aliveDmg * 2.5) * (1 + gun) * tired));
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
  const ROLE_INFO = {
    scout: { key: "scout", name: "Scout", role: "scout", desc: "Fast recon — spots for the lance, sharpening everyone's gunnery." },
    trooper: { key: "trooper", name: "Trooper", role: "trooper", desc: "General-purpose line machine — dependable, unremarkable." },
    fire: { key: "fire", name: "Fire Support", role: "fire", desc: "Missile/PPC battery — adds standoff damage to the lance." },
    brawler: { key: "brawler", name: "Brawler", role: "brawler", desc: "Close-assault bruiser — anchors the line and soaks incoming fire." }
  };
  function weaponReach(id) {
    if (!id) return "mid";
    if (/lrm/.test(id)) return "long";
    if (/srm/.test(id)) return "short";
    if (/ppc/.test(id)) return "long";
    if (/gauss/.test(id)) return "long";
    if (id === "llaser" || id === "erll" || id === "c-erll") return "long";
    if (id === "ac2" || id === "ac5" || id === "uac5" || id === "lbx10") return "long";
    if (id === "ac10" || id === "uac10") return "mid";
    if (id === "ac20" || id === "c-ubac20") return "short";
    if (id === "slaser" || id === "mg" || id === "flamer") return "short";
    return "mid";
  }
  function mechRole(chassisId) {
    const c = D.MECH_MAP[chassisId];
    if (!c) return "trooper";
    const ws = (c.weapons || []).map((id) => ({ id, d: D.WMAP[id] })).filter((x) => x.d);
    const total = ws.reduce((s, x) => s + x.d.dmg, 0) || 1;
    const long = ws.filter((x) => weaponReach(x.id) === "long").reduce((s, x) => s + x.d.dmg, 0);
    const short = ws.filter((x) => weaponReach(x.id) === "short").reduce((s, x) => s + x.d.dmg, 0);
    const lrm = ws.filter((x) => /lrm/.test(x.id)).reduce((s, x) => s + x.d.dmg, 0);
    if (lrm >= total * 0.45 && lrm >= 8) return "fire";
    if (long >= total * 0.5 && long >= 8 && c.ton < 60) return "fire";
    if (c.ton <= 35) return "scout";
    if (c.ton >= 60) return "brawler";
    if (short >= total * 0.5 && short >= 8) return "brawler";
    if (c.ton >= 45 && short >= total * 0.35) return "brawler";
    return "trooper";
  }
  function lanceComposition(units) {
    const roles = (units || []).map((u) => mechRole(u && u.chassisId));
    const counts = { scout: 0, trooper: 0, fire: 0, brawler: 0 };
    for (const r of roles) counts[r] = (counts[r] || 0) + 1;
    const n = roles.length || 1;
    let acc = Math.min(counts.scout * 0.04, 0.08);
    let dmg = counts.fire * 0.06 + counts.brawler * 0.02 + counts.trooper * 0.01;
    let def = Math.min(counts.brawler * 0.05, 0.12);
    const distinct = ["scout", "fire", "brawler"].filter((r) => counts[r] > 0).length;
    let synergy = distinct === 3 ? 0.05 : distinct === 2 ? 0.02 : 0;
    let label = distinct === 3 ? "Combined-arms" : distinct === 2 ? "Balanced" : "Unbalanced";
    const notes = [];
    const dominant = ["scout", "fire", "brawler", "trooper"].reduce((a, r) => (counts[r] > counts[a] ? r : a), "trooper");
    if (n >= 2 && counts[dominant] === n && dominant !== "trooper") {
      synergy -= 0.05;
      label = "Specialized";
      notes.push("All-" + ROLE_INFO[dominant].name.toLowerCase() + " lance — no mutual support.");
    }
    if (n >= 2 && !counts.scout) notes.push("No scout — the lance fights blind (no spotting bonus).");
    if (n >= 3 && !counts.fire) notes.push("No fire support — the lance lacks standoff reach.");
    if (n >= 3 && !counts.brawler) notes.push("No brawler — little to anchor the line.");
    return { roles, counts, label, acc, dmg, def, synergy, notes, total: n, unitCount: roles.length };
  }

  const SKILL_XP = 6;
  function injuryPenalty(p) {
    if (!p || p.status !== "injured") return 0;
    return (p.injuredWeeks >= 3) ? 2 : 1;
  }
  function effGunnery(p) { return p ? clamp((p.gunnery || 0) + injuryPenalty(p), 0, 7) : 4; }
  function effPiloting(p) { return p ? clamp((p.piloting || 0) + injuryPenalty(p), 0, 7) : 4; }
  function fatiguePenalty(p) { return p ? clamp(((p.fatigue || 0) - 50) / 500, 0, 0.12) : 0; }
  function pilotTier(p) {
    if (!p) return "Green";
    if (p.role !== "pilot") { const s = p.skill || 0; return s >= 8 ? "Veteran" : s >= 5 ? "Experienced" : "Green"; }
    const avg = ((p.gunnery || 4) + (p.piloting || 4)) / 2;
    return avg <= 2.2 ? "Elite" : avg <= 3.4 ? "Veteran" : avg <= 4.8 ? "Regular" : "Green";
  }
  function xpInfo(p) {
    const cur = Math.max(0, p && isFinite(p.xp) ? p.xp : 0);
    const total = Math.max(cur, p && isFinite(p.xpTotal) ? p.xpTotal : cur);
    return { cur, need: SKILL_XP, pct: cur / SKILL_XP, total, tier: pilotTier(p) };
  }
  const SERVICE_KEYS = ["drops", "missions", "kills", "wounds", "victories", "defeats"];
  function careerOf(p) {
    if (!p) return { drops: 0, missions: 0, kills: 0, wounds: 0, victories: 0, defeats: 0 };
    if (!p.service || typeof p.service !== "object") p.service = {};
    for (const k of SERVICE_KEYS) if (!isFinite(p.service[k])) p.service[k] = 0;
    return p.service;
  }
  function logService(company, p, text, kind) {
    if (!p || !text) return;
    if (!Array.isArray(p.serviceLog)) p.serviceLog = [];
    p.serviceLog.unshift({ week: company.week, text: text, kind: kind || "info" });
    if (p.serviceLog.length > 40) p.serviceLog.length = 40;
  }
  function careerStats(p) {
    const s = careerOf(p);
    const decided = s.victories + s.defeats;
    return {
      drops: s.drops, missions: s.missions, kills: s.kills, wounds: s.wounds,
      victories: s.victories, defeats: s.defeats,
      winRate: decided ? Math.round((s.victories / decided) * 100) : null,
      log: Array.isArray(p && p.serviceLog) ? p.serviceLog : []
    };
  }

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
    const diffRepair = (company && company.difficulty && isFinite(company.difficulty.repairMult)) ? company.difficulty.repairMult : 1;
    const cost = Math.round((mA * 135 + mS * 950 + wCost * 0.85 + compCost) * mult * diffRepair / 500) * 500;
    const days = Math.max(1, Math.ceil((mA / 100 + mS / 25 + wLost.length + cd.destroyed + cd.damaged * 0.5) * clamp(1 - techs.length * 0.1, 0.55, 1)));
    return { cost, days, mA, mS, wLost: wLost.length, compDamaged: cd.damaged, compDestroyed: cd.destroyed, damagePct: clamp(1 - hpPct(unit), 0, 1), supply: repairSupplyNeed(unit), parts: repairWeaponsNeeded(company, unit) };
  }
  function fixUnit(unit) {
    for (const l of D.LOCS) { unit.armor[l].cur = unit.armor[l].max; unit.structure[l].cur = unit.structure[l].max; }
    for (const w of unit.weapons) w.state = "ok";
    unit.crippled = false;
    unit.components = compOk();
    unit.status = "ok";
    unit.repairDaysLeft = 0;
  }
  function repairSupplyNeed(unit) {
    const mA = missingArmor(unit), mS = missingStruct(unit);
    const cd = componentDamage(unit);
    return Math.max(1, Math.ceil(mA / 50) + Math.ceil(mS / 12) + cd.destroyed * 2 + cd.damaged);
  }
  function repairWeaponsNeeded(company, unit) {
    const need = {};
    for (const w of unit.weapons || []) if (w.state === "destroyed") need[w.id] = (need[w.id] || 0) + 1;
    return Object.keys(need).map((wid) => {
      const have = (company && company.partsInv ? company.partsInv[wid] : 0) || 0;
      return { wid: wid, qty: need[wid], have: have, name: D.WMAP[wid] ? D.WMAP[wid].name : wid, ok: have >= need[wid] };
    });
  }
  function repairReadiness(company, unit) {
    const supply = repairSupplyNeed(unit);
    const supplyHave = (company && company.supplies && isFinite(company.supplies.repair)) ? company.supplies.repair : 0;
    const weapons = repairWeaponsNeeded(company, unit);
    const missing = [];
    if (supply > supplyHave) missing.push((supply - supplyHave) + "× repair crate" + (supply - supplyHave > 1 ? "s" : ""));
    for (const w of weapons) if (!w.ok) missing.push((w.qty - w.have) + "× " + w.name);
    return { supply: supply, supplyHave: supplyHave, weapons: weapons, ok: missing.length === 0, missing: missing };
  }
  function repairBays(company) {
    const techs = (company ? company.people : []).filter((p) => p.role === "tech" && p.status === "active").length;
    return Math.max(1, techs) + 1;
  }
  function repairQuality(company) {
    const techs = (company ? company.people : []).filter((p) => p.role === "tech" && p.status === "active");
    const best = techs.length ? Math.max.apply(null, techs.map((t) => t.skill || 0)) : 0;
    const flaw = clamp(0.42 - best * 0.05, 0.02, 0.5);
    let label;
    if (!techs.length) label = "no techs — a rushed patch job";
    else if (best >= 8) label = "master techs — depot-grade work";
    else if (best >= 6) label = "experienced techs — solid work";
    else if (best >= 4) label = "competent techs — serviceable work";
    else label = "green techs — a rough patch job";
    return { best: best, flaw: flaw, label: label };
  }
  function completeRepair(company, unit) {
    for (const l of D.LOCS) { unit.armor[l].cur = unit.armor[l].max; unit.structure[l].cur = unit.structure[l].max; }
    for (const w of unit.weapons) w.state = "ok";
    unit.crippled = false;
    unit.components = compOk();
    const q = repairQuality(company);
    if (chance(q.flaw) && COMPONENTS.length) {
      const c = pick(COMPONENTS);
      unit.components[c] = "damaged";
      unit.repairNote = "field patch — " + (COMP_INFO[c] ? COMP_INFO[c].name : c) + " still running rough";
    } else unit.repairNote = null;
    unit.status = "ok";
    unit.repairDaysLeft = 0;
    unit.repairCostLeft = 0;
    unit.repairQueued = false;
    unit.repairParts = null;
    unit.repairSupply = 0;
    unit.repairQuality = q.label;
    return q;
  }
  function supplyPrice(company) {
    const mult = clamp(1.15 - (company ? company.eraIdx : 0) * 0.03, 0.97, 1.15);
    return Math.round((900 * mult) / 50) * 50;
  }
  function buySupplies(company, qty) {
    qty = qty || 10;
    const cost = supplyPrice(company) * qty;
    if (company.funds < cost) return { error: "funds" };
    if (!company.supplies) company.supplies = { repair: 0 };
    company.supplies.repair = (company.supplies.repair || 0) + qty;
    logTx(company, "market", "Repair crates ×" + qty, -cost);
    return { ok: true, qty: qty, cost: cost };
  }

  function sanitizeCompany(company) {
    if (!company.difficulty || typeof company.difficulty !== "object") company.difficulty = Object.assign({}, DIFFICULTIES.regular);
    const dRef = difficultyByKey(company.difficulty.key);
    if (typeof company.difficulty.key !== "string") company.difficulty.key = dRef.key;
    if (typeof company.difficulty.label !== "string") company.difficulty.label = dRef.label;
    for (const k of ["bonus", "payMult", "threatMult", "funds", "repairMult", "injuryMult", "salvageMult", "upkeepMult"]) {
      if (!isFinite(company.difficulty[k])) company.difficulty[k] = dRef[k];
    }
    if (typeof company.ironman !== "boolean") company.ironman = false;
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
      if (p.status === "injured" && (!isFinite(p.injuredWeeks) || p.injuredWeeks <= 0)) p.status = "active";
      if (p.status === "leave" && (!isFinite(p.leaveWeeks) || p.leaveWeeks <= 0)) p.status = "active";
      if (p.status === "training") {
        const tc = p.training && COURSES[p.training.courseId];
        if (!tc) { p.status = "active"; delete p.training; }
        else {
          if (!isFinite(p.training.weeksLeft) || p.training.weeksLeft <= 0) p.training.weeksLeft = tc.weeks;
          if (!isFinite(p.training.cost)) p.training.cost = 0;
        }
      }
      if (p.status !== "injured" && p.status !== "active" && p.status !== "leave" && p.status !== "training") p.status = "active";
      if (!isFinite(p.morale)) p.morale = 62;
      p.morale = clamp(Math.round(p.morale), 0, 100);
      if (!isFinite(p.xp)) p.xp = 0;
      if (!isFinite(p.xpTotal)) p.xpTotal = p.xp;
      p.xpTotal = Math.max(p.xpTotal, p.xp);
      if (!isFinite(p.fatigue)) p.fatigue = 0;
      p.fatigue = clamp(Math.round(p.fatigue), 0, 100);
      careerOf(p);
      if (!Array.isArray(p.serviceLog)) p.serviceLog = [];
      p.serviceLog = p.serviceLog.filter((e) => e && typeof e.text === "string");
      for (const e of p.serviceLog) { if (!isFinite(e.week)) e.week = company.week; if (!e.kind) e.kind = "info"; }
      if (!isFinite(p.leaveWeeks)) p.leaveWeeks = 0;
      if (!Array.isArray(p.bonds)) p.bonds = [];
      else {
        const seenB = {};
        p.bonds = p.bonds.filter((b) => {
          if (!b || !b.otherId || b.otherId === p.id || seenB[b.otherId]) return false;
          if (!company.people.some((q) => q.id === b.otherId)) return false;
          seenB[b.otherId] = true;
          if (!BOND_TYPES[b.type]) b.type = "buddy";
          if (!isFinite(b.drops)) b.drops = 0;
          b.drops = clamp(Math.round(b.drops), 0, 12);
          if (!isFinite(b.sinceWeek)) b.sinceWeek = company.week;
          if (!isFinite(b.lastWeek)) b.lastWeek = b.sinceWeek;
          return true;
        });
      }
      backfillPersonDetails(p);
    }
    if (!isFinite(company.morale)) company.morale = 62;
    company.morale = clamp(company.morale, 0, 100);
    if (!isFinite(company.funds)) company.funds = 0;
    if (!Array.isArray(company.recruits)) company.recruits = [];
    company.recruits = company.recruits.filter((r) => r && r.id && r.role);
    for (const r of company.recruits) {
      if (!isFinite(r.asking)) r.asking = recruitAsking(company, r);
      if (!r.repLabel) r.repLabel = recruitReputation(r);
      backfillPersonDetails(r);
    }
    if (!company.recruits.length) refreshRecruits(company);
    if (!isFinite(company.recruitsWeek)) company.recruitsWeek = company.week;
    if (Array.isArray(company.offers)) {
      for (const o of company.offers) {
        const t = o.terrain && TERRAINS.find((x) => x.id === o.terrain.id);
        if (t) o.terrain = t;
        else if (!o.terrain || !o.terrain.id || o.terrain.temp === undefined) o.terrain = pickTerrainFor(o.type || "raid");
        if (!o.weather || !o.weather.id || !WEATHERS.some((w) => w.id === o.weather.id)) o.weather = pickWeather(o.terrain);
        const f = factionById(o.targetId) || D.FACTIONS[0];
        if (!o.doctrineId || !DOCTRINES[o.doctrineId]) o.doctrineId = pickDoctrine(f, o.type).id;
        if (!o.enemyCommander || !o.enemyCommander.name) o.enemyCommander = pickEnemyCommander(f);
      }
    }
    if (company.poachPing && (!company.poachPing.personId || !company.people.some((q) => q.id === company.poachPing.personId))) company.poachPing = null;
    if (company.partsInv) {
      for (const k of Object.keys(company.partsInv)) {
        if (!D.WMAP[k] || !isFinite(company.partsInv[k])) delete company.partsInv[k];
      }
    }
    if (!company.supplies || typeof company.supplies !== "object") company.supplies = { repair: 10 };
    if (!isFinite(company.supplies.repair)) company.supplies.repair = 10;
    for (const u of company.units) if (u.repairQueued === undefined) u.repairQueued = false;
    if (!Array.isArray(company.salvageListings)) company.salvageListings = [];
    company.salvageListings = company.salvageListings.filter((l) => l && l.item && isFinite(l.base));
    for (const l of company.salvageListings) {
      if (!isFinite(l.weeksLeft) || l.weeksLeft < 0) l.weeksLeft = 1;
      if (!isFinite(l.mult)) l.mult = 1.35;
      if (l.mode !== "market" && l.mode !== "broker") l.mode = "market";
    }
    if (!isFinite(company.salvageIndex)) company.salvageIndex = 1;
    company.salvageIndex = clamp(company.salvageIndex, 0.7, 1.4);
    if (!Array.isArray(company.loans)) company.loans = [];
    if (isFinite(company.loan) && company.loan > 0 && !company.loans.length) {
      const nid = (company.nextIds && company.nextIds.contract) || 1;
      company.loans.push({ id: "ln" + nid, lender: "Legacy line of credit", lenderGlyph: "⚠", rate: 0.08, term: 0, faction: "pirate", principal: company.loan, balance: company.loan, minPayment: Math.round(company.loan * 0.08), weeksElapsed: 0, missed: 0, openedWeek: company.week });
    }
    company.loan = 0;
    if (!company.credit || typeof company.credit !== "object") company.credit = { score: 55, paid: 0, missed: 0 };
    if (!isFinite(company.credit.score)) company.credit.score = 55;
    company.credit.score = clamp(Math.round(company.credit.score), 0, 100);
    if (!Array.isArray(company.history)) company.history = [];
    company.history = company.history.filter((x) => x && isFinite(x.week));
    if (!company.history.length) {
      company.history.push({
        week: company.week, funds: Math.round(company.funds || 0), income: 0, expense: 0, net: 0,
        debt: Math.round(totalDebt(company)), morale: Math.round(company.morale || 62),
        headcount: company.people.length, units: company.units.filter((u) => u.status !== "destroyed").length,
        wins: company.stats.victories, kills: company.stats.kills
      });
    }
    if (!Array.isArray(company.contractHistory)) company.contractHistory = [];
    company.contractHistory = company.contractHistory.filter((r) => r && isFinite(r.week));
    if (!Array.isArray(company.investments)) company.investments = [];
    company.investments = company.investments.filter((h) => h && isFinite(h.price) && isFinite(h.units) && h.name);
    for (const h of company.investments) {
      if (!isFinite(h.buyPrice)) h.buyPrice = h.price;
      if (!isFinite(h.yield)) h.yield = 0.01;
      if (!isFinite(h.vol)) h.vol = 0.03;
      if (!isFinite(h.weeksHeld)) h.weeksHeld = 0;
      if (!isFinite(h.invested)) h.invested = h.units * h.buyPrice;
    }
    if (!Array.isArray(company.investmentOffers)) company.investmentOffers = [];
    if (!isFinite(company.investmentsWeek)) company.investmentsWeek = company.week;
    if (!company.investmentOffers.length) refreshInvestments(company);
    ensureWorld(company);
    if (!company.location || !worldSystemById(company, company.location)) company.location = "outreach";
    if (!isFinite(company.fuel)) company.fuel = 80;
    company.fuel = clamp(Math.round(company.fuel), 0, 100);
    if (company.transit && (!company.transit.to || !worldSystemById(company, company.transit.to) || !isFinite(company.transit.weeksLeft))) company.transit = null;
    if (!company.story || typeof company.story !== "object") company.story = { seen: {} };
    if (!company.story.seen || typeof company.story.seen !== "object") company.story.seen = {};
    if (!company.stats || typeof company.stats !== "object") company.stats = { battles: 0, victories: 0, defeats: 0, kills: 0, lost: 0 };
    for (const k of ["battles", "victories", "defeats", "kills", "lost", "streak", "bestStreak", "flawless", "salvageTaken"]) {
      if (!isFinite(company.stats[k])) company.stats[k] = 0;
    }
    company.stats.bestStreak = Math.max(company.stats.bestStreak, company.stats.streak);
    if (!company.achievements || typeof company.achievements !== "object" || Array.isArray(company.achievements)) company.achievements = {};
    if (!Array.isArray(company.titles)) company.titles = [];
    company.titles = company.titles.filter((t) => typeof t === "string" && t);
    if (typeof company.scenario !== "string" || !SCENARIOS.some((s) => s.id === company.scenario)) company.scenario = "standard";
    if (company.legacy && typeof company.legacy !== "object") company.legacy = null;
    ensureRival(company);
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
      quirk: pick(D.QUIRKS), traits: [], morale: ri(55, 88), xp: 0, xpTotal: 0, fatigue: 0, leaveWeeks: 0,
      status: "active", injuredWeeks: 0, hiredWeek: company.week, unitId: null, bonds: [],
      service: { drops: 0, missions: 0, kills: 0, wounds: 0, victories: 0, defeats: 0 }, serviceLog: [],
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
  function weeklyPayroll(company) { return company.people.filter((p) => p.status === "active" || p.status === "training").reduce((s, p) => s + p.salary, 0); }
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
  function overheadBreakdown(company) {
    const u = upkeepBreakdown(company);
    const maintenance = Math.round(u.base * (1 - u.techDiscount) * u.compMult);
    const units = u.unitCount;
    const transport = units ? Math.round((3000 + units * 1400) / 100) * 100 : 0;
    let ammoSink = 0;
    for (const unit of maintainedUnits(company)) {
      for (const w of unit.weapons || []) {
        const W = D.WMAP[w.id];
        if (!W || W.cls === "energy") continue;
        ammoSink += 260 + (W.dmg || 4) * 22 * ((W.eraMin >= 1 || W.tech === "Clan") ? 1.4 : 1);
      }
    }
    const ammo = Math.round(ammoSink / 100) * 100;
    const injured = company.people.filter((p) => p.status === "injured").length;
    const leave = company.people.filter((p) => p.status === "leave").length;
    const medical = (injured || leave) ? Math.round((1200 + injured * 2600 + leave * 700) / 100) * 100 : 0;
    const upkeepM = (company.difficulty && isFinite(company.difficulty.upkeepMult)) ? company.difficulty.upkeepMult : 1;
    const upkeep = { maintenance: Math.round(maintenance * upkeepM / 100) * 100, transport: Math.round(transport * upkeepM / 100) * 100, ammo: Math.round(ammo * upkeepM / 100) * 100, medical: medical };
    const sd = standingDiscount(company);
    const standing = sd.pct > 0 ? Math.round((upkeep.maintenance + upkeep.ammo) * sd.pct / 100) * 100 : 0;
    return { maintenance: upkeep.maintenance, transport: upkeep.transport, ammo: upkeep.ammo, medical: upkeep.medical, upkeepMult: upkeepM, injured, leave, units, standing: { pct: Math.round(sd.pct * 100), amt: standing, names: sd.names }, total: upkeep.maintenance + upkeep.transport + upkeep.ammo + upkeep.medical - standing, base: u.base, techDiscount: u.techDiscount, compMult: u.compMult, techs: u.techs, per: u.per };
  }
  function weeklyUpkeep(company) { return overheadBreakdown(company).total; }
  function totalWeeklyBurn(company) { return weeklyPayroll(company) + weeklyUpkeep(company); }
  function logisticsSummary(company) {
    const active = company.people.filter((p) => p.status === "active" || p.status === "training");
    const byRole = { pilot: 0, tech: 0, support: 0 };
    let payroll = 0;
    for (const p of active) { payroll += p.salary; byRole[p.role] = (byRole[p.role] || 0) + p.salary; }
    const b = upkeepBreakdown(company);
    const oh = overheadBreakdown(company);
    return { payroll, byRole, headcount: active.length, techs: b.techs, techDiscount: b.techDiscount, compMult: b.compMult, baseUpkeep: b.base, per: b.per, upkeep: oh.total, overhead: oh, total: payroll + oh.total };
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

  const SCENARIOS = [
    {
      id: "standard", name: "Standard Outfit", glyph: "▲", title: null,
      desc: "The classic founding — a light lance, a handful of pilots and just enough C-bills to make payroll.",
      detail: "4 light 'Mechs · 4 pilots · 1 tech · 1 support officer",
      apply: null
    },
    {
      id: "bondsman", name: "Clan Bondsman", glyph: "✹", title: "Bondsman",
      desc: "You were taken as a bondsman and later released. You brought Clan steel and hard-earned skill out of the Homeworlds — but few friends among the Great Houses.",
      detail: "3 'Mechs (Clan-tech where the era allows) · veteran pilots · lean treasury · House suspicion",
      apply: (c, ctx) => {
        c.funds = Math.round(ctx.difficulty.funds * 0.45);
        const pilots = c.people.filter((p) => p.role === "pilot");
        if (pilots.length > 3) c.people = c.people.filter((p) => p !== pilots[pilots.length - 1]);
        c.units = [];
        const pool = eraMechPool(c).slice();
        const clan = pool.filter((m) => m.tech === "Clan").sort((a, b) => b.ton - a.ton);
        const list = (clan.length ? clan : pool.sort((a, b) => b.ton - a.ton)).slice(0, 3);
        for (const m of list) c.units.push(genUnit(c, m.id, { condition: 0.92 }));
        for (const p of c.people) if (p.role === "pilot") {
          p.gunnery = Math.max(0, (p.gunnery || 5) - 2);
          p.piloting = Math.max(0, (p.piloting || 5) - 2);
          p.xpTotal = (p.xpTotal || 0) + 120;
          p.salary = calcSalary(p);
        }
        for (const f of D.FACTIONS) if (f.type === "house") c.rep[f.id] = -2;
        const clanFacs = D.FACTIONS.filter((f) => f.type === "clan" && f.eraMin <= c.eraIdx && (f.eraMax === undefined || f.eraMax >= c.eraIdx));
        if (clanFacs.length) c.rep[pick(clanFacs).id] = 3;
      }
    },
    {
      id: "noble", name: "Noble Heir", glyph: "♛", title: "Nobleborn",
      desc: "A cadet of a deposed noble house, you sold the family estates to raise the colours. Your name opens doors and your purse buys heavy metal.",
      detail: "Extra treasury · a heavy 'Mech · goodwill with two Great Houses",
      apply: (c, ctx) => {
        c.funds = Math.round(ctx.difficulty.funds * 1.8);
        const houses = D.FACTIONS.filter((f) => f.type === "house" && f.eraMin <= c.eraIdx && (f.eraMax === undefined || f.eraMax >= c.eraIdx));
        for (const f of houses.slice(0, 2)) c.rep[f.id] = 2;
        const pool = eraMechPool(c).slice().sort((a, b) => b.ton - a.ton);
        const heavy = pool.find((m) => m.cls === "heavy" || m.cls === "assault") || pool[0];
        if (heavy) c.units.push(genUnit(c, heavy.id, { condition: 0.95 }));
      }
    },
    {
      id: "broke", name: "Broke Outfit", glyph: "☠", title: "Hardscrabble",
      desc: "You inherited the company the way it always happens — the previous commander died owing everyone. Six battered machines, a veteran crew, and a loan shark counting the days.",
      detail: "6 worn 'Mechs · 6 pilots · almost no cash · a 250k debt",
      apply: (c, ctx) => {
        c.funds = Math.round(ctx.difficulty.funds * 0.15);
        c.morale = 55;
        for (const u of c.units) for (const l of D.LOCS) {
          u.armor[l].cur = Math.max(1, Math.round(u.armor[l].max * rnd(0.5, 0.8)));
          u.structure[l].cur = Math.max(1, Math.round(u.structure[l].max * rnd(0.6, 0.95)));
        }
        const pool = eraMechPool(c).slice();
        for (let i = 0; i < 2; i++) {
          const light = pool.filter((m) => m.cls === "light");
          const m = pick(light.length ? light : pool);
          c.units.push(genUnit(c, m.id, { condition: 0.6 }));
        }
        for (let i = 0; i < 2; i++) { const p = genPerson(c, "pilot"); p.morale = 70; c.people.push(p); }
        c.loans.push({ id: "ln" + (c.nextIds.contract++), lender: "Portside Loan Shark", lenderGlyph: "☠", rate: 0.09, term: 0, faction: "pirate", principal: 250000, balance: 250000, minPayment: 20000, weeksElapsed: 0, missed: 0, openedWeek: 1 });
      }
    },
    {
      id: "newgameplus", name: "New Game+ (Legacy)", glyph: "∞", title: "Legacy",
      desc: "A fresh command built on an old legend. Your previous outfit's fortune, standing and veteran core carry over into a new campaign.",
      detail: "Inherited C-bills · inherited reputation · two veteran pilots · the Legacy title",
      requires: "legacy",
      apply: (c, ctx) => {
        const leg = ctx.legacy;
        if (!leg) return;
        c.funds = (isFinite(c.funds) ? c.funds : ctx.difficulty.funds) + leg.funds;
        c.legacy = { from: leg.from, week: leg.week, victories: leg.victories || 0, kills: leg.kills || 0, funds: leg.funds || 0 };
        if (leg.repId && c.rep[leg.repId] !== undefined) c.rep[leg.repId] = clamp((c.rep[leg.repId] || 0) + 4, -10, 10);
        const pilots = c.people.filter((p) => p.role === "pilot");
        for (const p of pilots.slice(0, 2)) {
          p.gunnery = Math.max(0, (p.gunnery || 5) - 2);
          p.piloting = Math.max(0, (p.piloting || 5) - 2);
          p.xpTotal = (p.xpTotal || 0) + 300;
          p.salary = calcSalary(p);
        }
      }
    }
  ];
  function scenarioById(id) { return SCENARIOS.find((s) => s.id === id) || SCENARIOS[0]; }
  function scenariosFor(legacy) { return SCENARIOS.filter((s) => s.requires !== "legacy" || legacy); }

  function assignLance(company) {
    for (const u of company.units) u.pilotId = null;
    for (const p of company.people) p.unitId = null;
    const pilots = company.people.filter((p) => p.role === "pilot");
    pilots.forEach((p, i) => { const u = company.units[i]; if (u) { p.unitId = u.id; u.pilotId = p.id; } });
  }

  const DIFFICULTIES = {
    recruit: { key: "recruit", label: "Recruit", blurb: "Generous starting funds, soft contracts and forgiving attrition.", bonus: 1, payMult: 1.35, threatMult: 0.62, funds: 900000, repairMult: 0.8, injuryMult: 0.7, salvageMult: 1.25, upkeepMult: 0.85 },
    regular: { key: "regular", label: "Regular", blurb: "The standard mercenary life — balanced risk and reward.", bonus: 0, payMult: 1, threatMult: 0.9, funds: 600000, repairMult: 1, injuryMult: 1, salvageMult: 1, upkeepMult: 1 },
    veteran: { key: "veteran", label: "Veteran", blurb: "Thinner margins and harder fights; repairs and wounds bite deeper.", bonus: -1, payMult: 0.82, threatMult: 1.18, funds: 400000, repairMult: 1.2, injuryMult: 1.25, salvageMult: 0.85, upkeepMult: 1.12 },
    elite: { key: "elite", label: "Elite", blurb: "Every C-bill earned in blood — brutal contracts and punishing attrition.", bonus: -2, payMult: 0.66, threatMult: 1.5, funds: 260000, repairMult: 1.45, injuryMult: 1.6, salvageMult: 0.7, upkeepMult: 1.3 }
  };
  function difficultyByKey(dk) { return DIFFICULTIES[dk] || DIFFICULTIES.regular; }
  function difficultyTable() { return Object.keys(DIFFICULTIES).map((k) => DIFFICULTIES[k]); }

  function newCompany(opts) {
    opts = opts || {};
    const dk = opts.difficulty || "regular";
    const difficulty = Object.assign({}, difficultyByKey(dk));
    const company = {
      schema: 4, createdAt: Date.now(), name: opts.name || "Black Aegis", callsign: (opts.callsign || "BA").toUpperCase().slice(0, 12),
      difficulty, ironman: !!opts.ironman, eraIdx: clamp(opts.eraIdx !== undefined ? opts.eraIdx : 0, 0, D.ERAS.length - 1),
      week: 1, funds: 0, morale: 62, loan: 0, loans: [], credit: { score: 55, paid: 0, missed: 0 },
      rep: Object.fromEntries(D.FACTIONS.map((f) => [f.id, 0])),
      people: [], units: [], partsInv: {}, supplies: { repair: 18 },
      nextIds: { person: 1, unit: 1, contract: 1, report: 1, tx: 1 },
      ledger: [], market: null, offers: [], activeReports: [], salvageQueue: [], salvageListings: [], salvageIndex: 1,
      investments: [], investmentOffers: [], investmentsWeek: 0,
      stats: { battles: 0, victories: 0, defeats: 0, kills: 0, lost: 0, streak: 0, bestStreak: 0, flawless: 0, salvageTaken: 0 },
      log: [], pendingEvents: [], cacheChance: 0, recruits: [], recruitsWeek: 0, poachPing: null,
      location: "outreach", world: null, fuel: 80, transit: null, story: { seen: {} },
      history: [], contractHistory: [], achievements: {}, titles: []
    };
    company.funds = difficulty.funds;
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
    const scen = scenarioById(opts.scenario);
    company.scenario = scen.id;
    if (scen.apply) scen.apply(company, { difficulty, dk, legacy: opts.legacy || null });
    const grant = isFinite(company.funds) && company.funds >= 0 ? Math.round(company.funds) : difficulty.funds;
    company.funds = 0;
    assignLance(company);
    company.rival = makeRival(company);
    logTx(company, "start", "Company founding grant", grant, 0);
    if (scen.id !== "standard") company.log.unshift({ week: 1, text: "Company founded as " + scen.name + (scen.detail ? " — " + scen.detail : "") });
    refreshMarket(company);
    refreshOffers(company);
    refreshRecruits(company);
    refreshInvestments(company);
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
    const sLots = 1 + (chance(0.5) ? 1 : 0);
    for (let i = 0; i < sLots; i++) {
      const q = pick([20, 30, 50]);
      stock.push({ id: "sp" + i, kind: "supply", qty: q, price: Math.round(supplyPrice(company) * q * rnd(0.88, 1.04) / 500) * 500 });
    }
    const fLots = 1 + (chance(0.5) ? 1 : 0);
    for (let i = 0; i < fLots; i++) {
      const q = pick([25, 40, 60]);
      stock.push({ id: "fl" + i, kind: "fuel", qty: q, price: Math.round(q * 900 * rnd(0.9, 1.1) / 500) * 500 });
    }
    company.market = { refreshedWeek: company.week, stock, merchant, mood: { label: moodLabel, eraNote, techMult, demandK } };
  }

  const TERRAINS = [
    { id: "urban", name: "Urban sprawl", biome: "Urban", mod: -0.05, temp: 0.06, sensor: -0.03, desc: "canyons of ferrocrete and shattered glass towers" },
    { id: "forest", name: "Dense forest", biome: "Woodland", mod: -0.1, temp: 0, sensor: -0.02, desc: "ancient trees that swallow autocannon fire" },
    { id: "jungle", name: "Jungle", biome: "Jungle", mod: -0.12, temp: 0.1, sensor: -0.03, desc: "steaming canopy and rivers of mud" },
    { id: "mountain", name: "Highlands", biome: "Highland", mod: -0.08, temp: -0.06, sensor: -0.01, desc: "razorback ridges and switchback passes" },
    { id: "desert", name: "Desert basin", biome: "Desert", mod: 0.03, temp: 0.2, sensor: 0, desc: "open dunes, heat shimmer, and no cover" },
    { id: "tundra", name: "Frozen tundra", biome: "Polar", mod: -0.03, temp: -0.2, sensor: 0, desc: "pack ice and endless white" },
    { id: "plains", name: "Open plains", biome: "Plains", mod: 0.06, temp: 0.02, sensor: 0.01, desc: "flat grassland with nowhere to hide" },
    { id: "swamp", name: "Lowland swamp", biome: "Wetland", mod: -0.15, temp: 0.06, sensor: -0.02, desc: "chest-deep muck that grabs every leg actuator" },
    { id: "canyon", name: "Badlands canyon", biome: "Canyon", mod: -0.07, temp: 0.04, sensor: -0.03, desc: "red rock walls that echo every shot" },
    { id: "lunar", name: "Lunar basin", biome: "Vacuum", mod: 0.02, temp: -0.12, sensor: 0.02, desc: "fine grey dust under a black sky" },
    { id: "ruins", name: "Star League ruins", biome: "Ruins", mod: -0.06, temp: 0.02, sensor: -0.03, desc: "collapsed ferrocrete arches older than the Houses" },
    { id: "coastal", name: "Coastal shelf", biome: "Coastal", mod: 0, temp: -0.03, sensor: 0, desc: "salt spray and pounding surf" }
  ];
  const WEATHERS = [
    { id: "clear", name: "Clear skies", glyph: "☀", acc: 0, heat: 0, sensors: 0.01, biomes: "*", weight: 3, desc: "visibility is perfect and the sensors read clean" },
    { id: "overcast", name: "Overcast", glyph: "☁", acc: -0.01, heat: -0.02, sensors: 0, biomes: "*", weight: 3, desc: "a low grey ceiling flattens the light" },
    { id: "rain", name: "Driving rain", glyph: "☂", acc: -0.04, heat: -0.05, sensors: -0.02, biomes: ["Woodland", "Jungle", "Wetland", "Plains", "Coastal", "Urban", "Ruins", "Canyon", "Highland"], weight: 2, desc: "sheets of rain smear optics and turn the ground to slurry" },
    { id: "storm", name: "Electrical storm", glyph: "⚡", acc: -0.07, heat: -0.04, sensors: -0.06, biomes: ["Woodland", "Jungle", "Wetland", "Plains", "Coastal", "Highland"], weight: 1, desc: "lightning strobes blind optics and static drowns the comms" },
    { id: "fog", name: "Dense fog", glyph: "▒", acc: -0.06, heat: -0.02, sensors: -0.05, biomes: ["Wetland", "Coastal", "Woodland", "Jungle", "Plains", "Urban", "Highland"], weight: 2, desc: "a grey wall swallows the horizon past a few hundred metres" },
    { id: "snow", name: "Snowfall", glyph: "❄", acc: -0.05, heat: -0.09, sensors: -0.02, biomes: ["Polar", "Highland", "Woodland", "Ruins"], weight: 2, desc: "wet snow clings to sensors and hides every heat signature" },
    { id: "blizzard", name: "Blizzard", glyph: "♒", acc: -0.1, heat: -0.12, sensors: -0.05, biomes: ["Polar", "Highland"], weight: 1, desc: "a white-out howls across the field, cutting visibility to nothing" },
    { id: "heatwave", name: "Heat wave", glyph: "♨", acc: -0.03, heat: 0.16, sensors: 0, biomes: ["Desert", "Plains", "Urban", "Ruins", "Canyon", "Jungle"], weight: 2, desc: "shimmering air and brutal heat that no heat sink can beat" },
    { id: "sandstorm", name: "Sandstorm", glyph: "≋", acc: -0.08, heat: 0.1, sensors: -0.08, biomes: ["Desert", "Canyon"], weight: 1.5, desc: "a wall of grit strips paint and clogs every intake" },
    { id: "night", name: "Night operation", glyph: "☾", acc: -0.05, heat: -0.03, sensors: -0.04, biomes: "*", weight: 2, desc: "the fight runs on thermal optics and muzzle flash" }
  ];
  const pickWeather = (terrain) => {
    const b = terrain && terrain.biome ? terrain.biome : "";
    const pool = WEATHERS.filter((w) => w.biomes === "*" || w.biomes.indexOf(b) >= 0);
    return pickW(pool.length ? pool : WEATHERS, (x) => x.weight || 1);
  };
  function conditionsFor(offer) {
    const tr = (offer && offer.terrain) || TERRAINS[0];
    const wx = (offer && offer.weather) || WEATHERS[0];
    return {
      terrain: tr, weather: wx,
      acc: (tr.mod || 0) + (wx.acc || 0),
      sensors: (tr.sensor || 0) + (wx.sensors || 0),
      heat: (tr.temp || 0) + (wx.heat || 0)
    };
  }
  function energyFrac(list) {
    let e = 0, t = 0;
    for (const it of list || []) {
      const id = typeof it === "string" ? it : (it.state === "ok" ? it.id : null);
      if (!id) continue;
      const w = D.WMAP[id];
      const dmg = w ? w.dmg : 4;
      t += dmg;
      if (w && w.cls === "energy") e += dmg;
    }
    return t > 0 ? e / t : 0.3;
  }
  const HEAT_PER_DMG = { energy: 1.5, missile: 0.6, ballistic: 0.25 };
  function weaponHeat(w) {
    const wp = typeof w === "string" ? D.WMAP[w] : w;
    if (!wp) return 2;
    return (wp.dmg || 4) * (HEAT_PER_DMG[wp.cls] || 0.5);
  }
  function weaponAmmo(id) {
    const w = typeof id === "string" ? D.WMAP[id] : id;
    if (!w || w.cls === "energy") return Infinity;
    const losTech = (w.eraMin >= 1 || w.tech === "Clan") ? 0.72 : 1;
    return clamp(Math.round((48 / Math.sqrt(Math.max(2, w.dmg))) * losTech), 4, 40);
  }
  function heatDissipation(unit) { return 8 + (unit && unit.ton ? unit.ton : 40) * 0.28; }
  function heatCapacity(unit) { return Math.round(heatDissipation(unit) * 1.15); }
  function makeFireProfile(ton, weapons) {
    const fire = (weapons || []).map((w, i) => {
      const id = typeof w === "string" ? w : w.id;
      const W = D.WMAP[id] || {};
      const ammo = weaponAmmo(W);
      return { i, id, cls: W.cls || "energy", dmg: W.dmg || 4, ammoLeft: ammo, ammoMax: ammo, heat: weaponHeat(W), _hold: false };
    });
    return { fire, heatCap: heatCapacity({ ton }), sink: heatDissipation({ ton }), heat: 0, heatPeak: 0, dry: [], overheats: 0, heldPeak: 0, shots: 0, ammoShots: 0 };
  }
  function planFire(x, isOk) {
    const ready = x.fire.filter((f) => f.ammoLeft > 0 && (!isOk || isOk(f.i)));
    const byHeat = ready.slice().sort((a, b) => (b.heat / Math.max(1, b.dmg)) - (a.heat / Math.max(1, a.dmg)) || b.heat - a.heat);
    let alphaHeat = ready.reduce((s, f) => s + f.heat, 0);
    const frac = alphaHeat > x.heatCap ? clamp(x.heatCap / alphaHeat, 0.4, 1) : 1;
    let held = 0;
    if (frac < 0.999 && byHeat.length > 1) {
      const want = Math.min(byHeat.length - 1, Math.max(1, Math.round(byHeat.length * (1 - frac))));
      for (let k = 0; k < want; k++) { byHeat[k]._hold = true; held++; alphaHeat -= byHeat[k].heat; }
      if (held > x.heldPeak) x.heldPeak = held;
    }
    let dmg = 0;
    const dryNow = [];
    for (const f of ready) {
      if (f._hold) { f._hold = false; continue; }
      dmg += f.dmg; x.shots++;
      if (f.ammoMax !== Infinity) { x.ammoShots++; f.ammoLeft--; if (f.ammoLeft <= 0) { dryNow.push(f); x.dry.push(f.id); } }
    }
    x.heat = clamp(x.heat + alphaHeat - x.sink, 0, x.heatCap * 1.6);
    if (x.heat > x.heatPeak) x.heatPeak = x.heat;
    let overheat = false;
    if (x.heat > x.heatCap) { overheat = true; x.overheats++; x.heat = Math.round(x.heatCap * 0.72); }
    return { dmg, held, dryNow, overheat, ready: ready.length };
  }
  function ordnanceProfile(unit) {
    const prof = makeFireProfile(unit.ton, (unit.weapons || []).filter((w) => w.state === "ok"));
    const ammoWeapons = prof.fire.filter((f) => f.ammoMax !== Infinity);
    const alphaHeat = prof.fire.reduce((s, f) => s + f.heat, 0);
    return {
      ammoCount: ammoWeapons.length, ammoNames: ammoWeapons.map((f) => D.WMAP[f.id] ? D.WMAP[f.id].name : f.id),
      alphaHeat: Math.round(alphaHeat), heatCap: prof.heatCap, sink: Math.round(prof.sink),
      overheats: alphaHeat > prof.heatCap, energyFrac: energyFrac((unit.weapons || []).filter((w) => w.state === "ok"))
    };
  }
  const DOCTRINES = {
    aggressive: { id: "aggressive", name: "Aggressive", glyph: "⚔", tone: "neg", gun: 0.6, dmg: 1.12, taken: 1.04, breakFrac: 0.28, poolBreak: 0.3, withdrawFrac: 0.5, target: "finish", desc: "presses the attack without pause, massing fire on the wounded" },
    cautious: { id: "cautious", name: "Cautious", glyph: "⛨", tone: "neu", gun: -0.3, dmg: 0.9, taken: 0.9, breakFrac: 0.55, poolBreak: 0.55, withdrawFrac: 0.78, target: "threat", desc: "fights from cover, husbanding its machines and withdrawing before ruin" },
    attrition: { id: "attrition", name: "Attritional", glyph: "♜", tone: "neu", gun: 0.1, dmg: 1.0, taken: 0.92, breakFrac: 0.34, poolBreak: 0.38, withdrawFrac: 0.6, target: "focus", desc: "grinds forward methodically, trading fire and never over-committing" },
    berserker: { id: "berserker", name: "Berserker", glyph: "☠", tone: "neg", gun: 0.3, dmg: 1.25, taken: 1.14, breakFrac: 0.12, poolBreak: 0.16, withdrawFrac: 0.35, target: "finish", desc: "throws everything into the assault and will not disengage while a machine still stands" },
    zellbrigen: { id: "zellbrigen", name: "Zellbrigen", glyph: "☯", tone: "neu", gun: 0.7, dmg: 1.08, taken: 1.0, breakFrac: 0.3, poolBreak: 0.3, withdrawFrac: 0.5, target: "duel", clanOnly: true, desc: "fights by the honor code of single combat — each warrior seeks their own opponent" }
  };
  const DOCTRINE_LIST = Object.keys(DOCTRINES).map((k) => DOCTRINES[k]);
  function pickDoctrine(faction, mtId) {
    const clan = faction && faction.type === "clan";
    if (mtId === "clantrial") return DOCTRINES.zellbrigen;
    let pool;
    if (clan) pool = [DOCTRINES.zellbrigen, DOCTRINES.zellbrigen, DOCTRINES.aggressive, DOCTRINES.attrition];
    else if (faction && faction.type === "pirate") pool = [DOCTRINES.berserker, DOCTRINES.berserker, DOCTRINES.aggressive, DOCTRINES.attrition];
    else if (mtId === "defense" || mtId === "garrison") pool = [DOCTRINES.cautious, DOCTRINES.attrition, DOCTRINES.aggressive];
    else pool = [DOCTRINES.aggressive, DOCTRINES.cautious, DOCTRINES.attrition, DOCTRINES.berserker];
    return pick(pool);
  }
  const doctrineOf = (offer) => (offer && offer.doctrineId && DOCTRINES[offer.doctrineId]) || DOCTRINES.aggressive;
  function pickEnemyCommander(faction) {
    const type = faction ? faction.type : "house";
    const ranks = type === "clan" ? ["Star Colonel", "Star Captain", "Galaxy Commander"]
      : type === "pirate" ? ["Captain", "Warlord", "Boss"]
      : type === "comstar" ? ["Precentor", "Adept", "Demi-Precentor"]
      : type === "periphery" ? ["Colonel", "Major", "Brigadier"]
      : ["Colonel", "Leftenant-General", "Major", "General"];
    return { name: pick(D.FIRST) + " " + pick(D.LAST), rank: pick(ranks) };
  }
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
  const REP_TIERS = [
    { min: 8, name: "Trusted ally", short: "Allied", glyph: "★★★" },
    { min: 5, name: "Honored", short: "Honored", glyph: "★★" },
    { min: 2, name: "Respected", short: "Respected", glyph: "★" },
    { min: 1, name: "Known", short: "Known", glyph: "·" },
    { min: 0, name: "Neutral", short: "Neutral", glyph: "·" },
    { min: -1, name: "Cold", short: "Cold", glyph: "▽" },
    { min: -4, name: "Disliked", short: "Cool", glyph: "▽" },
    { min: -7, name: "Hated", short: "Hostile", glyph: "☠" },
    { min: -Infinity, name: "Sworn enemy", short: "Enemy", glyph: "☠☠" }
  ];
  function repTier(r) {
    for (const t of REP_TIERS) if (r >= t.min) return t;
    return REP_TIERS[REP_TIERS.length - 1];
  }
  function repLabel(r) { return repTier(r).name; }
  function standingDiscount(company) {
    let pct = 0; const names = [];
    for (const f of D.FACTIONS) {
      if (f.type === "clan") continue;
      const r = company.rep[f.id] || 0;
      if (r >= 5) { pct += 0.03; names.push(f.name); }
      else if (r >= 2) { pct += 0.015; names.push(f.name); }
    }
    return { pct: clamp(pct, 0, 0.18), names: names };
  }
  function merchantFor(company) {
    const cand = D.FACTIONS.filter((f) => f.eraMin <= company.eraIdx && (f.eraMax === undefined || f.eraMax >= company.eraIdx) && f.type !== "clan");
    const f = pick(cand.length ? cand : eraFactions(company));
    const rep = company.rep[f.id] || 0;
    const mult = clamp(1 + rep * 0.006, 0.94, 1.06);
    return { id: f.id, name: f.name, glyph: f.glyph, rep, mult, adj: Math.round((mult - 1) * 100), label: repLabel(rep) };
  }

  /* ============================ WORLD MAP (f37) ============================ */
  const WORLD_SYSTEMS = [
    { id: "strana", name: "Strana Mechty", x: 74, y: 4, base: "wolf", clan: "wolf", clanHome: true },
    { id: "huntress", name: "Huntress", x: 88, y: 6, base: "smoke-jaguar", clan: "smoke-jaguar", clanHome: true },
    { id: "tamaron", name: "Tamaron", x: 65, y: 5, base: "diamond-shark", clan: "diamond-shark", clanHome: true },
    { id: "eden", name: "Eden", x: 84, y: 13, base: "jade-falcon", clan: "jade-falcon", clanHome: true },
    { id: "york", name: "York", x: 59, y: 10, base: "ghost-bear", clan: "ghost-bear", clanHome: true },
    { id: "circe", name: "Circe", x: 92, y: 15, base: "nova-cat", clan: "nova-cat", clanHome: true },
    { id: "glengarry", name: "Glengarry", x: 22, y: 15, base: "steiner" },
    { id: "sudeten", name: "Sudeten", x: 44, y: 13, base: "steiner" },
    { id: "wotan", name: "Wotan", x: 42, y: 19, base: "steiner" },
    { id: "tharkad", name: "Tharkad", x: 28, y: 21, base: "steiner" },
    { id: "coventry", name: "Coventry", x: 37, y: 23, base: "steiner" },
    { id: "tamarind", name: "Twycross", x: 46, y: 25, base: "steiner" },
    { id: "alarion", name: "Alarion", x: 20, y: 28, base: "steiner" },
    { id: "donegal", name: "Donegal", x: 30, y: 29, base: "steiner" },
    { id: "hesperus", name: "Hesperus II", x: 17, y: 34, base: "steiner" },
    { id: "skye", name: "Skye", x: 38, y: 34, base: "steiner" },
    { id: "solaris", name: "Solaris VII", x: 45, y: 37, base: "independent", hub: true },
    { id: "wolcott", name: "Wolcott", x: 68, y: 22, base: "kurita" },
    { id: "benjamin", name: "Benjamin", x: 64, y: 28, base: "kurita" },
    { id: "luthien", name: "Luthien", x: 72, y: 34, base: "kurita" },
    { id: "hachiman", name: "Hachiman", x: 79, y: 28, base: "kurita" },
    { id: "galedon", name: "Galedon", x: 83, y: 35, base: "kurita" },
    { id: "pesht", name: "Pesht", x: 87, y: 29, base: "kurita" },
    { id: "dieron", name: "Dieron", x: 56, y: 39, base: "kurita" },
    { id: "portmoseby", name: "Port Moseby", x: 20, y: 41, base: "davion" },
    { id: "robinson", name: "Robinson", x: 27, y: 44, base: "davion" },
    { id: "newavalon", name: "New Avalon", x: 16, y: 50, base: "davion" },
    { id: "kentares", name: "Kentares", x: 22, y: 56, base: "davion" },
    { id: "marduk", name: "Marduk", x: 30, y: 58, base: "davion" },
    { id: "newsyrtis", name: "New Syrtis", x: 11, y: 66, base: "davion" },
    { id: "helm", name: "Helm", x: 44, y: 45, base: "marik" },
    { id: "stewart", name: "Stewart", x: 41, y: 59, base: "marik" },
    { id: "atreus", name: "Atreus", x: 39, y: 67, base: "marik" },
    { id: "gibson", name: "Gibson", x: 35, y: 73, base: "marik" },
    { id: "oriente", name: "Oriente", x: 38, y: 76, base: "marik" },
    { id: "andurien", name: "Andurien", x: 26, y: 81, base: "marik" },
    { id: "outreach", name: "Outreach", x: 33, y: 59, base: "independent", hub: true },
    { id: "terra", name: "Terra", x: 55, y: 52, base: "comstar" },
    { id: "procyon", name: "Procyon", x: 62, y: 51, base: "comstar" },
    { id: "keid", name: "Keid", x: 60, y: 56, base: "comstar" },
    { id: "newdallas", name: "New Dallas", x: 49, y: 58, base: "comstar" },
    { id: "tikonov", name: "Tikonov", x: 59, y: 61, base: "liao" },
    { id: "sarna", name: "Sarna", x: 61, y: 69, base: "liao" },
    { id: "capella", name: "Capella", x: 62, y: 75, base: "liao" },
    { id: "sian", name: "Sian", x: 58, y: 82, base: "liao" },
    { id: "stives", name: "St. Ives", x: 66, y: 83, base: "liao" },
    { id: "menke", name: "Menke", x: 68, y: 89, base: "liao" },
    { id: "victoria", name: "Victoria", x: 63, y: 93, base: "liao" },
    { id: "herotitus", name: "Herotitus", x: 50, y: 94, base: "canopus" },
    { id: "canopus", name: "Canopus IV", x: 43, y: 96, base: "canopus" },
    { id: "taurus", name: "Taurus", x: 33, y: 92, base: "taurian" }
  ];

  const INVASION = {
    1: { sudeten: "jade-falcon", tamarind: "jade-falcon", wotan: "wolf", alarion: "ghost-bear", wolcott: "smoke-jaguar" },
    2: { sudeten: "jade-falcon", tamarind: "jade-falcon", wotan: "wolf", alarion: "ghost-bear", wolcott: "smoke-jaguar", coventry: "jade-falcon", glengarry: "wolf" },
    3: { sudeten: "jade-falcon", tamarind: "jade-falcon", wotan: "wolf", alarion: "ghost-bear", wolcott: "smoke-jaguar", coventry: "jade-falcon", glengarry: "wolf", gibson: "wob", terra: "wob" },
    4: { sudeten: "jade-falcon", tamarind: "jade-falcon", wotan: "wolf", alarion: "ghost-bear", wolcott: "smoke-jaguar", coventry: "jade-falcon", glengarry: "wolf", terra: "comstar" }
  };
  function worldInit(company) {
    const era = company.eraIdx || 0;
    const list = WORLD_SYSTEMS.map((s) => {
      const owner = s.clanHome ? (era >= 1 ? s.clan : "independent") : s.base;
      return {
        id: s.id, name: s.name, x: s.x, y: s.y, hub: !!s.hub, clanHome: !!s.clanHome,
        owner: owner, control: 55 + ri(0, 22), heat: 0, attacker: null, contested: false, frontWeeks: 0, changedWeek: company.week
      };
    });
    if (era >= 1) {
      const grabs = INVASION[Math.min(era, 4)] || INVASION[1];
      for (const s of list) if (grabs[s.id]) { s.owner = grabs[s.id]; s.control = 52 + ri(0, 14); }
    }
    return { systems: list, week: company.week };
  }
  function ensureWorld(company) {
    if (!company.world || !Array.isArray(company.world.systems) || !company.world.systems.length) company.world = worldInit(company);
    return company.world;
  }
  const FAC_TYPE_STR = { house: 1, clan: 1.25, periphery: 0.85, pirate: 0.6, comstar: 0.95 };
  function factionStr(fid) { const f = factionById(fid); return f ? (FAC_TYPE_STR[f.type] || 0.9) : 0.8; }
  function hostilePair(a, b) { return !!(a && b && a !== b && a !== "independent" && b !== "independent"); }
  function worldSystemById(company, id) { return ensureWorld(company).systems.find((s) => s.id === id) || null; }
  function worldHotspots(company) { return ensureWorld(company).systems.filter((s) => s.heat > 0).sort((a, b) => b.heat - a.heat); }
  function nearbySystem(company, s) {
    const w = ensureWorld(company);
    let best = null, bd = 26;
    for (const o of w.systems) {
      if (o === s || o.hub || !o.owner || o.owner === s.owner || !hostilePair(s.owner, o.owner)) continue;
      const d = Math.hypot(s.x - o.x, s.y - o.y);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }
  function processWorld(company) {
    const w = ensureWorld(company);
    w.week = company.week;
    const events = [];
    for (const s of w.systems) {
      if (s.contested) s.heat = Math.max(1, s.heat - 1);
      else if (s.heat > 0) s.heat = Math.max(0, s.heat - 1);
    }
    const contestedCount = w.systems.filter((s) => s.contested).length;
    if (contestedCount < 4 && chance(0.8)) {
      const fronts = [];
      for (const s of w.systems) {
        if (s.hub || s.contested || s.heat > 0) continue;
        const nb = nearbySystem(company, s);
        if (nb) fronts.push({ s: s, nb: nb });
      }
      if (fronts.length) {
        const f = fronts.splice(Math.floor(Math.random() * fronts.length), 1)[0];
        const s = f.s;
        s.attacker = f.nb.owner;
        s.heat = ri(3, 5);
        s.contested = true;
        s.frontWeeks = 0;
        s.control = clamp(s.control - ri(3, 8), 30, 85);
        const on = factionById(s.owner), an = factionById(s.attacker);
        if (on && an) events.push(an.name + " forces probe " + s.name + " — the border heats up");
      }
    }
    for (const s of w.systems) {
      if (!s.contested || s.hub) continue;
      s.frontWeeks = (s.frontWeeks || 0) + 1;
      const on = factionById(s.owner), an = factionById(s.attacker);
      const atk = factionStr(s.attacker);
      const def = factionStr(s.owner) * 1.12;
      const pAtk = atk / (atk + def);
      if (Math.random() < 0.34 || s.frontWeeks >= 6) {
        if (Math.random() < pAtk && an) {
          s.owner = s.attacker;
          s.attacker = null;
          s.contested = false;
          s.frontWeeks = 0;
          s.control = 52 + ri(0, 12);
          s.heat = Math.max(2, s.heat);
          s.changedWeek = company.week;
          if (on) events.push(an.name + " has taken " + s.name + " from " + on.name);
        } else {
          s.contested = false;
          s.attacker = null;
          s.frontWeeks = 0;
          s.control = clamp(Math.max(62, s.control + ri(2, 8)), 62, 92);
          s.heat = 0;
          if (on) events.push(on.name + " has thrown back the assault on " + s.name);
        }
      } else if (Math.random() < pAtk) {
        s.control = clamp(s.control - ri(3, 8), 10, 90);
      } else {
        s.control = clamp(s.control + ri(3, 8), 10, 90);
      }
    }
    return events;
  }
  function worldControlLabel(s) {
    if (!s) return "Unknown";
    if (s.contested) return s.attacker ? "Contested — " + (factionById(s.attacker) ? factionById(s.attacker).name : s.attacker) + " pressing" : "Contested";
    if (s.heat > 0) return "Unsettled border";
    return "Firm control";
  }
  function pickOfferSystem(company, employer, target) {
    const w = ensureWorld(company);
    const systems = w.systems.filter((s) => !s.hub);
    const targetId = target ? target.id : null;
    const loc = company.location ? w.systems.find((s) => s.id === company.location) : null;
    const near = (s) => (loc ? Math.hypot(s.x - loc.x, s.y - loc.y) : 0);
    const hot = systems.filter((s) => s.heat > 0 && (s.owner === targetId || s.attacker === targetId));
    if (hot.length && chance(0.6)) return pickW(hot, (s) => 1 + s.heat);
    const owned = systems.filter((s) => s.owner === targetId);
    if (owned.length) {
      const scored = owned.map((s) => ({ s: s, wgt: 1 / (1 + near(s) / 28) + (s.heat > 0 ? 1.5 : 0) }));
      return pickW(scored, (x) => x.wgt).s;
    }
    const any = systems.filter((s) => s.owner && s.owner !== (employer && employer.id));
    return any.length ? pickW(any, (s) => 1 / (1 + near(s) / 28)).s : systems[0];
  }

  const TRANSIT_FUEL_PER_DIST = 0.5;
  const TRANSIT_WEEKS_PER_DIST = 24;
  function systemDistance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function travelQuote(company, destId) {
    const w = ensureWorld(company);
    const from = company.location ? w.systems.find((s) => s.id === company.location) : null;
    const to = w.systems.find((s) => s.id === destId);
    if (!to) return { error: "unknown" };
    if (company.transit) return { error: "transit" };
    if (from && from.id === to.id) return { error: "same" };
    const dist = from ? systemDistance(from, to) : 0;
    const weeks = clamp(Math.round(dist / TRANSIT_WEEKS_PER_DIST), 1, 4);
    const fuel = Math.max(4, Math.round(dist * TRANSIT_FUEL_PER_DIST));
    return { ok: true, from: from, to: to, dist: dist, weeks: weeks, fuel: fuel, canFuel: (company.fuel || 0) >= fuel };
  }
  function startTravel(company, destId) {
    const q = travelQuote(company, destId);
    if (q.error === "same") return { error: "same" };
    if (q.error === "transit") return { error: "transit" };
    if (q.error) return { error: "unknown" };
    if (!q.canFuel) return { error: "fuel", need: q.fuel, have: company.fuel || 0 };
    company.fuel = clamp((company.fuel || 0) - q.fuel, 0, 100);
    company.transit = { from: q.from ? q.from.id : null, to: q.to.id, toName: q.to.name, weeksLeft: q.weeks, totalWeeks: q.weeks, fuel: q.fuel };
    company.log.unshift({ week: company.week, text: "DropShip departs for " + q.to.name + " — " + q.weeks + " week" + (q.weeks > 1 ? "s" : "") + " in transit, " + q.fuel + " fuel burned" });
    return { ok: true, transit: company.transit, quote: q };
  }
  function processTransit(company) {
    const t = company.transit;
    if (!t) return null;
    t.weeksLeft = (t.weeksLeft || 0) - 1;
    if (t.weeksLeft > 0) return null;
    company.location = t.to;
    company.transit = null;
    const text = "DropShip arrives at " + (t.toName || t.to) + " — the company is on station";
    company.log.unshift({ week: company.week, text: text });
    return text;
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
    const honored = fact.filter((f) => (company.rep[f.id] || 0) >= 5 && (f.type === "house" || f.type === "clan" || f.type === "comstar"));
    for (let i = 0; i < n; i++) {
      const faction = (i === 0 && honored.length) ? pick(honored) : pick(fact);
      const r = company.rep[faction.id] || 0;
      let pool = D.MISSION_TYPES.filter((mt) => {
        if (mt.clanOnly && faction.type !== "clan") return false;
        if (mt.repMin !== undefined && r < mt.repMin) return false;
        if (!mt.clanOnly && faction.type === "clan" && company.eraIdx > 0 && chance(0.6)) return false;
        return true;
      });
      if (faction.type === "pirate") pool = pool.filter((mt) => !mt.clanOnly);
      const mtWeight = (t) => (t.favor && t.favor.indexOf(faction.id) >= 0 ? 3 : 1);
      const mt = pool.length ? pickW(pool, mtWeight) : pickW(D.MISSION_TYPES.filter((x) => !x.clanOnly), mtWeight);
      if (!mt) { console.warn("refreshOffers: no eligible type for", faction.id, "rep", r, "pool", pool.length); continue; }
      let target;
      if (faction.type === "clan" && mt.clanOnly) target = faction;
      else {
        const cand = eraFactions(company).filter((f2) => f2.id !== faction.id && f2.type !== "clan" && f2.type !== "pirate");
        target = pick(cand.length ? cand : D.FACTIONS.filter((f) => f.type === "pirate"));
      }
      const tonF = 0.75 + our.avgTon / 160;
      const sys = pickOfferSystem(company, faction, target);
      const heat = sys && sys.heat ? sys.heat : 0;
      const threat = clamp(company.difficulty.threatMult * rnd(0.8, 1.22) * tonF * rnd(0.85, 1.15) * (1 + heat * 0.05), 0.3, 3);
      const power = Math.max(1, our.power);
      const pay = Math.round(power * 190 * mt.payMult * factionMult(company, faction.id) * company.difficulty.payMult * rivalMult(company) * (0.55 + threat) * (1 + heat * 0.11) * rnd(0.92, 1.1) / 500) * 500;
      const salvMult = isFinite(company.difficulty.salvageMult) ? company.difficulty.salvageMult : 1;
      const salvagePct = mt.salvageMult <= 0.7 ? 0 : clamp(Math.round((rnd(35, 60) + (mt.salvageMult - 1) * 40 + (faction.type === "clan" ? 15 : 0) + (company.rep[faction.id] || 0) * 2.5) * salvMult), 0, 100);
      const terrain = pickTerrainFor(mt.id);
      const dt = pickDoctrine(target, mt.id);
      const isHouse = honored.some((h) => h.id === faction.id);
      const offer = {
        id: "c" + (company.nextIds.contract++),
        factionId: faction.id, employer: faction.name, glyph: faction.glyph, fcolor: faction.color,
        type: mt.id, missionName: mt.name, objDesc: mt.desc, victoryCond: mt.obj,
        pay, salvagePct, duration: mt.id === "garrison" || mt.id === "defense" ? ri(20, 40) : ri(9, 26),
        systemId: sys ? sys.id : null, hotspot: heat > 0, heat: heat,
        planet: sys ? sys.name : pickPlanet(), terrain, weather: pickWeather(terrain), threat: clamp(threat, 0.3, 3),
        doctrineId: dt.id, enemyCommander: pickEnemyCommander(target),
        targetId: target.id, targetName: target.name, targetGlyph: target.glyph, targetColor: target.color,
        enemyMult: clamp(threat * rnd(0.85, 1.25) * (target.type === "clan" ? 1.3 : 1), 0.35, 2.6),
        rivalInterest: !!(company.rival && chance(0.35)),
        expiresWeek: company.week + 5, offeredWeek: company.week
      };
      if (isHouse) {
        offer.house = true;
        offer.clanHouse = faction.type === "clan";
        offer.tier = repTier(r).short;
        offer.missionName = (faction.type === "clan" ? "Clan Contract — " : "House Contract — ") + offer.missionName;
        offer.pay = Math.round(offer.pay * 1.55 / 500) * 500;
        offer.salvagePct = Math.max(offer.salvagePct, 60);
        offer.threat = clamp(offer.threat * 1.2, 0.3, 3);
        offer.enemyMult = clamp(offer.enemyMult * 1.15, 0.35, 2.8);
        offer.duration = Math.max(offer.duration, ri(30, 55));
        offer.expiresWeek = company.week + 6;
      }
      offers.push(offer);
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
    const cond = conditionsFor(offer);
    const condAcc = cond.acc + cond.sensors * 0.7 + cond.heat * -0.06;
    const heatDmgMult = (ef) => (cond.heat > 0 ? 1 - cond.heat * ef * 0.35 : cond.heat < 0 ? 1 + -cond.heat * ef * 0.12 : 1);
    const doctrine = doctrineOf(offer);

    const us = lance.map((u) => {
      const clone = JSON.parse(JSON.stringify(u));
      const person = u.pilotId ? findPerson(company, u.pilotId) : null;
      const tag = person ? person.callsign : u.name;
      return { unit: clone, person, side: "us", dead: false, tag, power: unitPower(u, person), isVip: false, role: mechRole(u.chassisId) };
    });
    const ourPower = us.reduce((a, x) => a + x.power, 0);
    for (const x of us) Object.assign(x, makeFireProfile(x.unit.ton, x.unit.weapons));
    const cohesion = lanceBonds(company, us.map((x) => x.person));
    const cohMod = (p) => (p && cohesion.mod[p.id] !== undefined ? cohesion.mod[p.id] : 0);
    const enemyFaction = factionById(offer.targetId) || D.FACTIONS[0];
    const ePool = eraMechPool(company, enemyFaction.id);
    const ePoolAny = D.MECHS.filter((m) => m.eraMin <= company.eraIdx);
    const enemyCount = clamp(Math.ceil(lance.length * r2(0.8, 1.25)), 1, 8);
    const avgTon = lance.reduce((a, u) => a + u.ton, 0) / Math.max(1, lance.length);
    const ourTon = lance.reduce((a, u) => a + u.ton, 0);
    const ourEnergy = lance.reduce((a, u) => a + energyFrac(u.weapons), 0) / Math.max(1, lance.length);
    const eUnits = [];
    const spawnEnemy = (band) => {
      const m = p2(ePool.length ? ePool : ePoolAny.filter((x) => Math.abs(x.ton - band) < 30));
      const u = { m, dead: false, crippled: false, hp: 0, maxHp: 0, isCommander: false };
      Object.assign(u, makeFireProfile(m.ton, m.weapons));
      for (const f of u.fire) if (f.ammoMax !== Infinity) f.ammoLeft = Math.round(f.ammoMax * 1.6);
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
    eUnits.forEach((u, i) => { u.duelId = us[i % us.length].unit.id; });

    const enemyTon = eUnits.reduce((a, u) => a + u.m.ton, 0);
    const comp = lanceComposition(lance);
    const tonAdv = clamp((ourTon - enemyTon) / Math.max(1, enemyTon), -0.5, 0.5);
    let weightAcc = 0, weightDmg = 0, weightDef = 0;
    if (tonAdv > 0.08) { weightDmg = clamp(tonAdv * 0.14, 0, 0.06); weightDef = clamp(tonAdv * 0.16, 0, 0.07); }
    else if (tonAdv < -0.08) { weightAcc = clamp(-tonAdv * 0.14, 0, 0.06); }
    const lanceAcc = comp.acc + comp.synergy + weightAcc;
    const lanceDmg = comp.dmg + comp.synergy + weightDmg;
    const lanceDef = comp.def + weightDef;

    let vipIdx = Math.floor(R() * us.length);
    us[vipIdx].isVip = true;
    const log = [];
    let curRound = 0;
    const logE = (side, text, extra) => { log.push(Object.assign({ side, text, t: log.length, round: curRound }, extra || {})); };

    const enName = UNIT_FLAVOR[enemyFaction.id] || enemyFaction.name + " forces";
    logE("world", "Drop complete. " + lance.length + " machines of " + company.name + " (" + us.map((x) => x.tag).join(", ") + ") touch down on " + offer.planet + ".");
    logE("world", "Contract: " + offer.missionName + " for " + offer.employer + " — enemy: " + enName + " (" + enemyFaction.name + ").");
    logE("world", "Terrain: " + offer.terrain.name + " — " + offer.terrain.desc + ".");
    logE("world", "Weather: " + cond.weather.name + " — " + cond.weather.desc + ".", { type: "cond" });
    {
      const bits = [];
      if (Math.abs(condAcc) > 0.004) bits.push("gunnery " + (condAcc > 0 ? "+" : "") + Math.round(condAcc * 100) + "%");
      if (cond.sensors < -0.02) bits.push("sensors degraded (−" + Math.round(-cond.sensors * 100) + "%)");
      else if (cond.sensors > 0.01) bits.push("sensors clean");
      if (cond.heat > 0.05) bits.push("heat stress saps energy weapons (−" + Math.round(cond.heat * 0.35 * ourEnergy * 100) + "% lance damage)");
      else if (cond.heat < -0.05) bits.push("cold air keeps heat sinks clean (+" + Math.round(-cond.heat * 0.12 * ourEnergy * 100) + "% lance damage)");
      if (bits.length) logE("world", "Conditions (" + cond.weather.name + ", " + cond.terrain.name + "): " + bits.join(" · ") + ".", { type: "cond", tone: condAcc < -0.02 || cond.sensors < -0.02 || cond.heat > 0.05 ? "neg" : "neu" });
    }
    {
      const cmdr = offer.enemyCommander;
      const who = cmdr ? cmdr.rank + " " + cmdr.name + ", " : "";
      logE("world", "Opposing commander: " + who + doctrine.name + " doctrine — " + doctrine.desc + ".", { type: "doctrine", tone: doctrine.tone });
      if (doctrine.id === "zellbrigen") logE("world", "The Clan commander bids down and calls out single challenges. Zellbrigen is in effect — their warriors will seek their own opponents.", { type: "doctrine", tone: "neu" });
      if (doctrine.id === "berserker") logE("world", "The enemy commander is not interested in preserving anything. They come straight at the lance.", { type: "doctrine", tone: "neg" });
      if (doctrine.id === "cautious") logE("world", "The enemy sets up at range and digs in — they will not be drawn into a knife fight.", { type: "doctrine", tone: "neu" });
    }
    if (mt.id === "clantrial") logE("world", "A Clan warrior challenges you over the comms. A Trial of Possession has been declared. Honor demands single combat — the Clans are known to stretch that definition.");
    if (cohesion.neg.length) {
      const pr = cohesion.neg[0];
      logE("world", "Comms discipline is poor — " + pr.a.callsign + " and " + pr.b.callsign + " are feuding, and it shows in the lance's fire discipline.", { type: "bond", tone: "neg" });
    }
    if (cohesion.pos.length) {
      const pr = cohesion.pos[0];
      logE("world", pr.a.callsign + " and " + pr.b.callsign + " fight like they share a brain — the lance moves as one.", { type: "bond", tone: "pos" });
    }
    const roleSummary = Object.keys(comp.counts).filter((r) => comp.counts[r] > 0).map((r) => comp.counts[r] + " " + ROLE_INFO[r].name.toLowerCase()).join(", ");
    logE("world", "Lance composition — " + roleSummary + " (" + comp.label + ").", { type: "comp", tone: comp.synergy + lanceDmg >= 0.04 ? "pos" : comp.label === "Specialized" ? "neg" : "neu" });
    if (comp.label === "Combined-arms") logE("world", "Each weight class covers another's weakness — the lance fights as a whole.", { type: "comp", tone: "pos" });
    for (const note of comp.notes) logE("world", note, { type: "comp", tone: "neg" });
    if (lanceDmg > 0.02 || lanceAcc > 0.02 || lanceDef > 0.02) logE("world", "Composition and weight of metal tell: the lance works together (" + (lanceAcc > 0 ? "+" + Math.round(lanceAcc * 100) + "% gunnery" : "") + (lanceDmg > 0 ? (lanceAcc > 0 ? ", " : "") + "+" + Math.round(lanceDmg * 100) + "% damage" : "") + (lanceDef > 0 ? (lanceAcc > 0 || lanceDmg > 0 ? ", " : "") + "+" + Math.round(lanceDef * 100) + "% protection" : "") + ").", { type: "comp", tone: "pos" });

    const moraleMod = clamp((company.morale - 62) / 400, -0.09, 0.11);
    const enGun = clamp(4 + company.difficulty.bonus + doctrine.gun, 1, 8);
    const injuryMult = isFinite(company.difficulty.injuryMult) ? company.difficulty.injuryMult : 1;
    const defenseTarget = mt.id === "defense" || mt.id === "garrison";
    const state = { round: 0, ourDead: 0, enDead: 0, enStart: eUnits.length, injuries: [], killsByPilot: {}, lastNarr: 0, lastTrait: 0, assassinKilled: false, vipDead: false, ambushed: false };

    const orderPool = ["LT", "LA", "RT", "RA", "LL", "RL", "CT", "HEAD"];
    function hitChance(attPerson) {
      const gun = attPerson ? effGunnery(attPerson) : enGun;
      const tired = attPerson ? fatiguePenalty(attPerson) : 0;
      return clamp(0.52 + (6 - gun) * 0.07 + moraleMod + condAcc - tired + (attPerson ? cohMod(attPerson) + lanceAcc : 0), 0.14, 0.96);
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
        const plan = planFire(att, (i) => !!(att.unit.weapons[i] && att.unit.weapons[i].state === "ok"));
        if (plan.dryNow.length) {
          logE("us", att.tag + "'s " + plan.dryNow.map((f) => (D.WMAP[f.id] ? D.WMAP[f.id].name : "weapon")).join(" and ") + (plan.dryNow.length > 1 ? " run" : " runs") + " dry — the ammo bins are empty.", { type: "dry", tone: "neg", unitId: att.unit.id });
        }
        if (plan.held && chance(0.28)) {
          logE("us", att.tag + " holds fire on " + plan.held + " weapon" + (plan.held > 1 ? "s" : "") + " — the heat gauge is deep in the red.", { type: "heat", tone: "neg", unitId: att.unit.id });
        }
        let target;
        if (mt.id === "assassination" && state.assassinKilled === false) {
          const cmdr = eUnits.find((x) => x.isCommander && !x.dead);
          target = cmdr && chance(0.5) ? cmdr : pickTarget(EN.alive(), att.person);
        } else if (mt.id === "capture" && !att.isVip && chance(0.3)) {
          target = pickTarget(EN.alive(), att.person);
        } else target = pickTarget(EN.alive(), att.person);
        if (!target) break;
        if (plan.overheat && chance(0.35)) {
          logE("us", att.tag + " redlines — the " + att.unit.name + "'s heat spikes and it staggers under the thermal load.", { type: "heat", tone: "neg", unitId: att.unit.id });
          if (chance(0.05) && att.fire.some((f) => f.ammoMax !== Infinity)) {
            logE("us", "An ammo bin cooks off inside the " + att.unit.name + "!", { type: "heat", tone: "neg", unitId: att.unit.id });
            const hr = dmgOurUnit(att, Math.max(1, att.unit.ton * 0.4));
            if (hr.fatal) { destroyOurUnit(att); continue; }
          }
        }
        if (plan.dmg <= 0) continue;
        if (R() < hitChance(att.person)) {
          let dmg = plan.dmg * r2(0.7, 1.35) * BAL.ourDmgK * (target.m.ton > att.unit.ton ? 0.85 : 1.05);
          if (att.unit.crippled) dmg *= 0.7;
          if (att.unit.components && att.unit.components.engine === "destroyed") dmg *= 0.5;
          dmg *= 1 + (att.person ? cohMod(att.person) : 0) * 0.8;
          dmg *= 1 + lanceDmg;
          dmg *= heatDmgMult(energyFrac(att.unit.weapons));
          dmg *= doctrine.taken;
          if (plan.overheat) dmg *= 0.9;
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
        else if (doctrine.target === "duel") {
          const dt2 = us.find((x) => x.unit.id === att.duelId && !x.dead);
          target = dt2 || pickTarget(tlist, null);
        } else if (doctrine.target === "finish") target = tlist.slice().sort((a, b) => hpPct(a.unit) - hpPct(b.unit))[0];
        else if (doctrine.target === "threat") target = tlist.slice().sort((a, b) => unitPower(b.unit, b.person) - unitPower(a.unit, a.person))[0];
        else target = pickTarget(tlist, null);
        if (!target) return;
        const eplan = planFire(att);
        if (eplan.overheat && chance(0.3)) {
          logE("world", "The " + att.m.name + " overheats, its heat sinks unable to keep pace.", { type: "heat", tone: "neg" });
          if (chance(0.05) && att.fire.some((f) => f.ammoMax !== Infinity)) {
            att.boom = true;
            destroyEnemyUnit(att, null);
            continue;
          }
        }
        if (eplan.dmg <= 0) continue;
        if (R() < hitChance(null)) {
          let dmg = eplan.dmg * r2(0.55, 1.2) * BAL.enDmgK * clamp(scaleF, 0.55, 1.9);
          dmg *= 1 - lanceDef;
          if (att.m.ton > target.unit.ton * 1.15) dmg *= 1.2;
          dmg *= heatDmgMult(energyFrac(att.m.weapons));
          dmg *= doctrine.dmg;
          const res = dmgOurUnit(target, Math.max(1, dmg));
          if (res.fatal) { destroyOurUnit(target); continue; }
          if (chance(0.04 * injuryMult) && target.person) {
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

    if (cond.sensors < -0.02 && chance(clamp(-cond.sensors * 2.6, 0, 0.5))) {
      state.ambushed = true;
      logE("world", "Ambush! Degraded sensors and poor visibility let the enemy spring an opening volley before the lance can shake out.", { type: "cond", tone: "neg" });
      const volleys = cond.sensors < -0.06 ? 2 : 1;
      for (let k = 0; k < volleys; k++) {
        const tlist = us.filter((x) => !x.dead);
        if (!tlist.length) break;
        const tgt = tlist[Math.floor(R() * tlist.length)];
        const dmg = (tgt.unit.ton * 1.4 + 10) * BAL.enDmgK * r2(0.6, 1.1);
        const res = dmgOurUnit(tgt, Math.max(1, dmg));
        if (res.fatal) destroyOurUnit(tgt);
      }
      logE("world", "The lance answers the first shots, but the enemy had the drop on them.", { type: "cond", tone: "neg" });
    }

    let breaksUs = false, breaksEn = false;
    const maxRounds = ri2(BAL.minRounds, BAL.maxRounds) + (defenseTarget ? 8 : 0);
    const startUsPool = us.reduce((a, x) => a + totalHp(x.unit), 0) || 1;
    const enPoolFrac = () => eUnits.reduce((a, u) => a + Math.max(0, u.hp), 0) / Math.max(1, eUnits.reduce((a, u) => a + u.maxHp, 0));
    const usPoolFrac = () => us.filter((x) => !x.dead).reduce((a, x) => a + totalHp(x.unit), 0) / startUsPool;

    for (let r = 1; r <= maxRounds; r++) {
      state.round = r;
      curRound = r;
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
        if (enAliveFrac <= doctrine.breakFrac || enPoolFrac() <= doctrine.poolBreak) {
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
      } else if (enF <= doctrine.withdrawFrac) {
        logE("world", "The enemy, mauled and out of patience, pulls back from the field.", { type: "end" });
        breaksEn = true;
      } else {
        logE("world", "Neither side gives ground. The exchange ends only with the light.", { type: "end" });
      }
    }
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
    const scenario = outcome === "victory" ? "victory" : outcome === "partial" ? "partial" : "defeat";
    const unscathedPilots = survivors.filter((x) => x.person && state.injuries.indexOf(x.person.id) < 0);
    const killLeaders = unscathedPilots.filter((x) => state.killsByPilot[x.person.id]);
    const postSpeaker = (killLeaders.length ? killLeaders : unscathedPilots.length ? unscathedPilots : survivors.filter((x) => x.person))[0];
    if (postSpeaker && postSpeaker.person) {
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

    let banter = [];
    const speakerPool = survivors.filter((x) => x.person).map((x) => x.person);
    banter = banter.concat(banterLines(speakerPool, scenario, 2, {}));
    const lostPersons = us.filter((x) => x.dead && x.person).map((x) => x.person);
    if (lostPersons.length) banter = banter.concat(banterLines(lostPersons, "loss", 1, {}));
    const hurtPersons = state.injuries.map((id) => company.people.find((p) => p.id === id)).filter(Boolean);
    if (hurtPersons.length) banter = banter.concat(banterLines(hurtPersons, "injury", 1, {}));
    if (salvageList.length) banter = banter.concat(banterLines(speakerPool, "salvage", 1, {}));
    const seenVoice = {};
    const banterFinal = banter.filter((b) => { const k = b.text; if (seenVoice[k]) return false; seenVoice[k] = true; return true; }).slice(0, 5);

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
      doctrine: { id: doctrine.id, name: doctrine.name, glyph: doctrine.glyph, desc: doctrine.desc, gun: doctrine.gun, dmg: doctrine.dmg, taken: doctrine.taken, target: doctrine.target },
      enemyCommander: offer.enemyCommander || null,
      conditions: {
        terrain: { id: cond.terrain.id, name: cond.terrain.name, desc: cond.terrain.desc, mod: cond.terrain.mod, temp: cond.terrain.temp, sensor: cond.terrain.sensor, biome: cond.terrain.biome },
        weather: { id: cond.weather.id, name: cond.weather.name, glyph: cond.weather.glyph, desc: cond.weather.desc, acc: cond.weather.acc, heat: cond.weather.heat, sensors: cond.weather.sensors },
        acc: cond.acc, sensors: cond.sensors, heat: cond.heat, condAcc: condAcc, ourEnergy: ourEnergy, ambushed: !!state.ambushed
      },
      composition: { label: comp.label, counts: comp.counts, roles: comp.roles, notes: comp.notes, synergy: comp.synergy, acc: lanceAcc, dmg: lanceDmg, def: lanceDef, weightAcc: weightAcc, weightDmg: weightDmg, weightDef: weightDef, tonAdv: tonAdv, ourTon: ourTon, enemyTon: enemyTon },
      ordnance: us.map((x) => ({
        unitId: x.unit.id, unitName: x.unit.name, tag: x.tag, dead: x.dead, role: x.role,
        shots: x.shots, ammoShots: x.ammoShots, heatPeak: Math.round(x.heatPeak), heatCap: x.heatCap, sink: Math.round(x.sink),
        overheats: x.overheats, heldPeak: x.heldPeak,
        dry: x.dry.filter((id, i, a) => a.indexOf(id) === i).map((id) => (D.WMAP[id] ? D.WMAP[id].name : id)),
        ammoWeapons: x.fire.filter((f) => f.ammoMax !== Infinity).map((f) => (D.WMAP[f.id] ? D.WMAP[f.id].name : f.id))
      })),
      enemyOrdnance: { dry: eUnits.filter((u) => u.dry && u.dry.length).length, overheats: eUnits.reduce((a, u) => a + (u.overheats || 0), 0) },
      lance: us.map((x) => ({ unitId: x.unit.id, unitName: x.unit.name, chassisId: x.unit.chassisId, personId: x.person ? x.person.id : null, tag: x.tag, dead: x.dead, isVip: x.isVip, role: x.role,
        personDesc: x.person ? (x.person.career || "veteran") + (x.person.traits && x.person.traits.length ? ", " + x.person.traits.map((t) => { const ti = TRAIT_LIST.find((q) => q.key === t); return ti ? ti.name : t; }).join(" & ") : "") + (x.person.motivation ? "; " + x.person.motivation : "") : null,
        post: x.dead ? null : { armor: x.unit.armor, structure: x.unit.structure, weapons: x.unit.weapons, crippled: x.unit.crippled, components: x.unit.components } })),
      destroyedUnitIds: destroyedIds,
      enemyUnits: eUnits.map((x) => ({ name: x.m.name, dead: x.dead, isCommander: x.isCommander })),
      ourDeadCount: state.ourDead, enemyDeadCount: enDeadAll, enemyTotal: state.enStart,
      enemyLossDesc, log, injuries: state.injuries, killsByPilot: state.killsByPilot,
      xpGains: survivors.filter((s) => s.person).map((s) => ({ personId: s.person.id, xp: s.xpGain })),
      lanceBonds: {
        pos: cohesion.pos.map((x) => ({ a: x.a.callsign, b: x.b.callsign, type: x.bond.type, drops: x.bond.drops || 0, v: x.v })),
        neg: cohesion.neg.map((x) => ({ a: x.a.callsign, b: x.b.callsign, type: x.bond.type, drops: x.bond.drops || 0, v: x.v })),
        net: cohesion.net
      },
      moraleShift: companyMoraleShift, salvageList, scrapTotal, mechSalvageCount, partsTotal,
      banter: banterFinal,
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
    company.stats.streak = battle.outcome === "victory" ? (company.stats.streak || 0) + 1 : 0;
    company.stats.bestStreak = Math.max(company.stats.bestStreak || 0, company.stats.streak);
    if (battle.outcome === "victory" && !(battle.injuries && battle.injuries.length) && !battle.ourDeadCount) company.stats.flawless = (company.stats.flawless || 0) + 1;
    company.stats.salvageTaken = (company.stats.salvageTaken || 0) + ((battle.salvageList && battle.salvageList.length) || 0);
    if (offer.rivalInterest) resolveRivalContract(company, offer, battle);

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
    for (const l of battle.lance) {
      if (!l.personId) continue;
      const p = findPerson(company, l.personId);
      if (!p) continue;
      let f = 10 + (battle.rounds || 0) * 0.7;
      if (l.dead) f += 8;
      if (battle.injuries.indexOf(l.personId) >= 0) f += 6;
      p.fatigue = clamp(Math.round((isFinite(p.fatigue) ? p.fatigue : 0) + f), 0, 100);
    }
    const bondChanges = evolveBonds(company, battle);
    battle.bondChanges = bondChanges;
    for (const g of battle.xpGains) {
      const p = findPerson(company, g.personId);
      if (!p) continue;
      p.xp += g.xp;
      p.xpTotal = (isFinite(p.xpTotal) ? p.xpTotal : 0) + g.xp;
      let improved = null;
      while (p.xp >= SKILL_XP) {
        p.xp -= SKILL_XP;
        if (p.role === "pilot") {
          if (chance(0.55) && p.gunnery > 0) { p.gunnery--; improved = "Gunnery " + p.gunnery; }
          else if (p.piloting > 0) { p.piloting--; improved = "Piloting " + p.piloting; }
          else if (p.gunnery > 0) { p.gunnery--; improved = "Gunnery " + p.gunnery; }
        } else if (p.skill < 10) { p.skill++; improved = "Skill " + p.skill; }
      }
      if (improved) {
        company.log.unshift({ week: company.week, text: p.callsign + " improved " + improved + " in the field" });
        logService(company, p, "Improved " + improved + " in the field", "gain");
      }
      p.salary = calcSalary(p);
    }
    for (const l of battle.lance) {
      if (!l.personId) continue;
      const p = findPerson(company, l.personId);
      if (!p) continue;
      const s = careerOf(p);
      const kills = (battle.killsByPilot && battle.killsByPilot[p.id]) || 0;
      s.drops++; s.missions++;
      if (battle.outcome === "victory") s.victories++;
      else if (battle.outcome === "defeat") s.defeats++;
      s.kills += kills;
      const hurt = battle.injuries.indexOf(p.id) >= 0;
      if (hurt) s.wounds++;
      let entry = battle.missionName + " on " + battle.planet + " — " + battle.outcomeLabel;
      if (kills) entry += " · " + kills + " kill" + (kills === 1 ? "" : "s");
      if (hurt) entry += " · wounded in action";
      if (l.dead) entry += " · machine destroyed";
      logService(company, p, entry, battle.outcome === "victory" ? "win" : battle.outcome === "defeat" ? "loss" : "neutral");
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
    if (!Array.isArray(company.contractHistory)) company.contractHistory = [];
    company.contractHistory.unshift({
      week: company.week, missionName: offer.missionName, missionType: offer.missionType || offer.type,
      planet: offer.planet, employer: offer.employer, outcome: battle.outcome, outcomeLabel: battle.outcomeLabel,
      pay: Math.round((payout.amt || 0) + (payout.bonus || 0)), kills: battle.enemyDeadCount || 0,
      ourDead: battle.ourDeadCount || 0, enemyDead: battle.enemyDeadCount || 0, enemyTotal: battle.enemyTotal || 0,
      salvage: (battle.salvageList || []).length, rival: !!offer.rivalInterest
    });
    if (company.contractHistory.length > 100) company.contractHistory.length = 100;
    return { payout, repDelta, repNew: newRep, battle };
  }

  function startRepair(company, unitId, mode) {
    const u = findUnit(company, unitId);
    if (!u || u.status === "repairing") return { error: u ? "already" : "notfound" };
    const est = repairEstimate(u, company);
    if (est.damagePct < 0.005 && u.status !== "destroyed") return { error: "nodamage" };
    const ready = repairReadiness(company, u);
    if (!ready.ok) return { error: "parts", missing: ready.missing };
    const cost = mode === "rush" ? Math.round(est.cost * 2) : est.cost;
    if (company.funds < cost) return { error: "funds" };
    if (!company.supplies) company.supplies = { repair: 0 };
    company.supplies.repair -= est.supply;
    for (const w of ready.weapons) company.partsInv[w.wid] = (company.partsInv[w.wid] || 0) - w.qty;
    u.repairParts = ready.weapons.map((w) => ({ wid: w.wid, qty: w.qty }));
    u.repairSupply = est.supply;
    logTx(company, "repair", (u.status === "destroyed" ? "Rebuild — " : "Repairs — ") + u.name + (mode === "rush" ? " (rush)" : ""), -cost);
    if (mode === "rush") { completeRepair(company, u); company.log.unshift({ week: company.week, text: u.name + " rushed back to readiness (" + u.repairQuality + ")" }); return { ok: true, cost, days: 0, quality: u.repairQuality }; }
    const activeJobs = company.units.filter((x) => x.status === "repairing" && !x.repairQueued).length;
    u.status = "repairing";
    u.repairDaysLeft = est.days;
    u.repairCostLeft = cost;
    u.repairQueued = activeJobs >= repairBays(company);
    return { ok: true, cost, days: est.days, queued: u.repairQueued, supply: est.supply };
  }
  function cancelRepair(company, unitId) {
    const u = findUnit(company, unitId);
    if (!u || u.status !== "repairing") return;
    logTx(company, "refund", "Cancelled repairs — " + u.name, Math.round(u.repairCostLeft * 0.5));
    if (u.repairParts) for (const w of u.repairParts) company.partsInv[w.wid] = (company.partsInv[w.wid] || 0) + w.qty;
    if (u.repairSupply && company.supplies) company.supplies.repair = (company.supplies.repair || 0) + u.repairSupply;
    u.repairParts = null; u.repairSupply = 0; u.repairQueued = false;
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
    } else if (it.kind === "supply") {
      if (!company.supplies) company.supplies = { repair: 0 };
      company.supplies.repair = (company.supplies.repair || 0) + it.qty;
      logTx(company, "market", "Purchased " + it.qty + " repair crates", -it.price);
    } else if (it.kind === "fuel") {
      company.fuel = clamp((company.fuel || 0) + it.qty, 0, 100);
      logTx(company, "market", "Purchased " + it.qty + " units of DropShip fuel", -it.price);
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

  function salvageIndexOf(company) { return (company && isFinite(company.salvageIndex)) ? company.salvageIndex : 1; }
  function salvageBaseValue(item) {
    if (!item) return 0;
    if (item.kind === "scrap") return item.value || 0;
    if (item.kind === "parts") { let v = 0; for (const p of item.parts || []) v += D.WMAP[p.wid] ? Math.round(D.WMAP[p.wid].cost * 0.6) : 1000; return v; }
    if (item.kind === "mech") { const mc = D.MECH_MAP[item.chassisId]; return mc ? Math.round(mc.cost * (0.2 + item.cond * 0.2)) : 0; }
    return 0;
  }
  function salvageInstantValue(company, item) { return Math.round(salvageBaseValue(item) * salvageIndexOf(company)); }
  function salvageListQuote(company, item, mode) {
    const base = salvageBaseValue(item);
    const isMech = item.kind === "mech";
    if (mode === "broker" && !isMech) return null;
    const mult = mode === "broker" ? 1.5 : 1.35;
    const weeks = mode === "broker" ? 2 : (item.kind === "scrap" ? 3 : 2);
    return { base: base, mult: mult, weeks: weeks, expected: Math.round(base * mult * salvageIndexOf(company)), instant: Math.round(base * salvageIndexOf(company)) };
  }
  function listSalvage(company, svId, mode) {
    if (!Array.isArray(company.salvageListings)) company.salvageListings = [];
    if (company.salvageListings.length >= 6) return { error: "full" };
    const it = company.salvageQueue.find((s) => s.svId === svId);
    if (!it) return { error: "gone" };
    const q = salvageListQuote(company, it, mode);
    if (!q) return { error: "kind" };
    company.salvageQueue = company.salvageQueue.filter((s) => s !== it);
    const listing = {
      id: "sl" + (company.nextIds.contract++), label: it.label, kind: it.kind, mode: mode,
      base: q.base, mult: q.mult, weeksLeft: q.weeks, weeksTotal: q.weeks, listedWeek: company.week,
      ask: q.expected, item: JSON.parse(JSON.stringify(it))
    };
    company.salvageListings.push(listing);
    return { ok: true, listing: listing, quote: q };
  }
  function cancelSalvageListing(company, id) {
    if (!Array.isArray(company.salvageListings)) return { error: "none" };
    const l = company.salvageListings.find((x) => x.id === id);
    if (!l) return { error: "none" };
    company.salvageListings = company.salvageListings.filter((x) => x.id !== id);
    const it = Object.assign({}, l.item);
    it.svId = "sv" + (company.nextIds.contract++);
    company.salvageQueue.push(it);
    return { ok: true };
  }
  function processSalvageListings(company) {
    if (!Array.isArray(company.salvageListings)) company.salvageListings = [];
    company.salvageIndex = clamp(salvageIndexOf(company) + rnd(-0.06, 0.07), 0.7, 1.4);
    const sold = [];
    for (const l of company.salvageListings.slice()) {
      l.weeksLeft--;
      if (l.weeksLeft > 0) continue;
      if (isFinite(salvageIndexOf(company))) l.ask = Math.round(l.base * l.mult * salvageIndexOf(company));
      let mult = l.mult, note = "";
      if (l.mode === "broker" && chance(0.15)) { mult -= 0.25; note = " — the buyer haggled the price down"; }
      const payout = Math.round(l.base * mult * salvageIndexOf(company));
      logTx(company, "sale", "Salvage sale — " + l.label + (l.mode === "broker" ? " (brokered)" : ""), payout);
      company.log.unshift({ week: company.week, text: l.label + " sold on the salvage market for " + Math.round(payout / 1000) + "k" + note });
      company.salvageListings = company.salvageListings.filter((x) => x !== l);
      sold.push({ id: l.id, label: l.label, payout: payout, mode: l.mode });
    }
    return sold;
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
  function recruitReputation(p) {
    let s;
    if (p.role === "pilot") s = (7 - p.gunnery) + (7 - p.piloting) * 0.6;
    else s = (p.skill || 0) * 0.9;
    if (p.role === "pilot") {
      if (s >= 7.5) return "Elite gun — courted by every House";
      if (s >= 5.5) return "Veteran with a solid record";
      if (s >= 3.8) return "Steady regular";
      return "Green recruit, something to prove";
    }
    if (s >= 7) return "Master technician";
    if (s >= 5) return "Experienced hand";
    if (s >= 3.2) return "Competent";
    return "Apprentice — cheap and eager";
  }
  function recruitAsking(company, p) {
    const base = p.role === "pilot" ? 4000 : p.role === "tech" ? 2500 : 1500;
    const mult = p.role === "pilot" ? 0.6 + (7 - p.gunnery) * 0.3 + (7 - p.piloting) * 0.15 : 0.6 + (p.skill || 0) * 0.24;
    const prestige = 1 + clamp((company.rep ? Object.values(company.rep).reduce((a, b) => a + b, 0) : 0) * 0.006, -0.06, 0.12);
    return Math.max(500, Math.round(base * mult * prestige / 100) * 100);
  }
  function refreshRecruits(company) {
    const roles = ["pilot", "pilot", "pilot", "tech", "tech", "support"];
    const n = 4 + Math.floor(Math.random() * 3);
    const out = [];
    for (let i = 0; i < n; i++) {
      const p = genPerson(company, pick(roles));
      p.asking = recruitAsking(company, p);
      p.repLabel = recruitReputation(p);
      out.push(p);
    }
    company.recruits = out;
    company.recruitsWeek = company.week;
    return out;
  }
  function hireRecruit(company, id) {
    const list = company.recruits || [];
    const p = list.find((x) => x.id === id);
    if (!p) return { error: "gone" };
    const fee = isFinite(p.asking) ? p.asking : 0;
    if (company.funds < fee) return { error: "funds" };
    delete p.asking; delete p.repLabel;
    p.hiredWeek = company.week;
    company.people.push(p);
    tryFormBond(company, p);
    logService(company, p, "Signed with the company", "join");
    company.recruits = list.filter((x) => x.id !== id);
    logTx(company, "hire", "Signed " + p.name + " (" + p.callsign + ", " + p.role + ") — signing fee", -fee);
    return { ok: true, person: p, fee };
  }
  function poachTarget(company) {
    const pool = company.people.filter((p) => p.status === "active" && (p.role === "pilot" || p.role === "tech"));
    if (!pool.length) return null;
    let best = null, bestRisk = 0;
    for (const p of pool) {
      const talent = p.role === "pilot" ? (7 - p.gunnery) + (7 - p.piloting) * 0.6 : (p.skill || 0);
      const morale = isFinite(p.morale) ? p.morale : 62;
      const risk = clamp((58 - morale) / 320 + talent * 0.006, 0, 0.2);
      if (risk > bestRisk) { bestRisk = risk; best = p; }
    }
    return best ? { person: best, risk: bestRisk } : null;
  }
  const COURSES = {
    gunnery: { id: "gunnery", name: "Gunnery Sim-Pod Intensive", role: "pilot", weeks: 2, stat: "gunnery", desc: "two weeks locked in the gunnery pods, drilling tracking and lead until the shot is pure muscle memory" },
    piloting: { id: "piloting", name: "Piloting & Terrain Course", role: "pilot", weeks: 2, stat: "piloting", desc: "two weeks of jump-jet drills, slope work and deadfall navigation" },
    simboot: { id: "simboot", name: "Full Combat Simulator Boot Camp", role: "pilot", weeks: 3, stat: "both", desc: "a brutal three-week simulator rotation that sharpens both hand and eye" },
    techcert: { id: "techcert", name: "Senior Technician Certification", role: "tech", weeks: 3, stat: "skill", desc: "three weeks of depot-level coursework on engines, myomer and cooling systems" },
    supporttrain: { id: "supporttrain", name: "Support & Logistics Course", role: "support", weeks: 2, stat: "skill", desc: "two weeks of supply-chain, medical and dropship-handling training" }
  };
  function coursesFor(role) { return Object.keys(COURSES).filter((k) => COURSES[k].role === role); }
  function trainingCost(company, p, courseId) {
    const c = COURSES[courseId];
    if (!c || !p) return 0;
    const base = c.role === "pilot" ? 9000 : c.role === "tech" ? 7000 : 4500;
    let mult;
    if (c.stat === "gunnery") mult = 0.7 + p.gunnery * 0.28;
    else if (c.stat === "piloting") mult = 0.7 + p.piloting * 0.28;
    else if (c.stat === "both") mult = 0.9 + (p.gunnery + p.piloting) * 0.16;
    else mult = 0.7 + (p.skill || 0) * 0.22;
    if (c.weeks > 2) mult *= 1.4;
    return Math.round(base * mult / 500) * 500;
  }
  function trainingBlocked(p, courseId) {
    const c = COURSES[courseId];
    if (!p || !c) return "That course is not available.";
    if (p.role !== c.role) return "Wrong role for that course.";
    if (p.status === "training") return "Already in a course.";
    if (p.status !== "active") return "Only active personnel can enroll.";
    if (c.stat === "gunnery" && p.gunnery <= 1) return "Gunnery is already maxed out.";
    if (c.stat === "piloting" && p.piloting <= 1) return "Piloting is already maxed out.";
    if (c.stat === "both" && p.gunnery <= 1 && p.piloting <= 1) return "No headroom left to train.";
    if (c.stat === "skill" && (p.skill || 0) >= 10) return "Skill is already maxed out.";
    return null;
  }
  function startTraining(company, personId, courseId) {
    const p = findPerson(company, personId);
    const c = COURSES[courseId];
    const blocked = trainingBlocked(p, courseId);
    if (blocked) return { error: blocked };
    const cost = trainingCost(company, p, courseId);
    if (company.funds < cost) return { error: "Not enough C-bills for tuition." };
    logTx(company, "training", "Tuition — " + p.callsign + " · " + c.name, -cost);
    p.status = "training";
    p.training = { courseId: courseId, weeksLeft: c.weeks, cost: cost };
    company.log.unshift({ week: company.week, text: p.callsign + " enrolled in " + c.name + " (" + c.weeks + " weeks)" });
    logService(company, p, "Enrolled in " + c.name, "info");
    return { ok: true, cost: cost, weeks: c.weeks, course: c };
  }
  function cancelTraining(company, personId) {
    const p = findPerson(company, personId);
    if (!p || p.status !== "training" || !p.training) return { error: "none" };
    const refund = Math.round((p.training.cost || 0) * 0.5);
    logTx(company, "refund", "Cancelled training — " + p.callsign, refund);
    p.status = "active";
    delete p.training;
    company.log.unshift({ week: company.week, text: p.callsign + " washed out of training and returned to the roster" });
    logService(company, p, "Washed out of training and returned to the roster", "neutral");
    return { ok: true, refund: refund };
  }
  function finishTraining(company, p) {
    const c = COURSES[p.training && p.training.courseId];
    const gains = [];
    if (c) {
      if (c.stat === "gunnery") { if (p.gunnery > 1) { p.gunnery--; gains.push("Gunnery " + p.gunnery); } }
      else if (c.stat === "piloting") { if (p.piloting > 1) { p.piloting--; gains.push("Piloting " + p.piloting); } }
      else if (c.stat === "both") { if (p.gunnery > 1) { p.gunnery--; gains.push("Gunnery " + p.gunnery); } if (p.piloting > 1) { p.piloting--; gains.push("Piloting " + p.piloting); } }
      else if ((p.skill || 0) < 10) { p.skill = (p.skill || 0) + 1; gains.push("Skill " + p.skill); }
    }
    if (p.role === "pilot") p.xpTotal = (isFinite(p.xpTotal) ? p.xpTotal : 0) + 4;
    p.status = "active";
    delete p.training;
    p.salary = calcSalary(p);
    company.log.unshift({ week: company.week, text: p.callsign + " completed training" + (gains.length ? " — " + gains.join(" & ") : "") });
    logService(company, p, "Completed " + (c ? c.name : "training") + (gains.length ? " — " + gains.join(" & ") : ""), "gain");
    return gains;
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
  const HARDPOINT_LOCS = ["LT", "CT", "RT", "LA", "RA"];
  const HARDPOINT_SLOTS = { LT: 4, CT: 5, RT: 4, LA: 4, RA: 4 };
  const HARDPOINT_NAMES = { LT: "Left torso", CT: "Center torso", RT: "Right torso", LA: "Left arm", RA: "Right arm" };
  function weaponSlots(w) { return !w ? 1 : w.cls === "ballistic" ? 3 : w.cls === "missile" ? 2 : 1; }
  function hardpointMap(unit) {
    const map = {};
    for (const l of HARDPOINT_LOCS) map[l] = { loc: l, name: HARDPOINT_NAMES[l], cap: HARDPOINT_SLOTS[l], used: 0, mounted: [] };
    for (const wp of (unit.weapons || [])) {
      const w = D.WMAP[wp.id];
      const loc = map[wp.loc] ? wp.loc : "CT";
      const slots = weaponSlots(w);
      map[loc].used += slots;
      map[loc].mounted.push({ wp, slots, name: w ? w.name : wp.id, cls: w ? w.cls : "?" });
    }
    return map;
  }
  function hardpointFit(unit, loc, wid) {
    const map = hardpointMap(unit);
    const cell = map[loc];
    if (!cell) return { ok: false, reason: "loc" };
    const need = weaponSlots(D.WMAP[wid]);
    const free = cell.cap - cell.used;
    if (need > free) return { ok: false, reason: "space", free, need };
    return { ok: true, free, need };
  }
  function freeHardpoints(unit, wid) { return HARDPOINT_LOCS.filter((l) => hardpointFit(unit, l, wid).ok); }
  function installCost(wid) { return Math.round((D.WMAP[wid] ? D.WMAP[wid].cost : 20000) * 0.25); }
  function refitPreview(unit, wid) {
    const w = D.WMAP[wid];
    if (!w) return null;
    const before = { dmg: sumWeaponDmg(unit), heat: ordnanceProfile(unit).alphaHeat, power: unitPower(unit), sink: Math.round(heatDissipation(unit)) };
    const mock = Object.assign({}, unit, { weapons: (unit.weapons || []).concat([{ id: wid, loc: "CT", state: "ok" }]) });
    const after = { dmg: sumWeaponDmg(mock), heat: ordnanceProfile(mock).alphaHeat, power: unitPower(mock) };
    return { w, before, after, dmg: after.dmg - before.dmg, heat: after.heat - before.heat, power: after.power - before.power };
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
    if (u.weapons.length >= 12) return { error: "slots" };
    const w = D.WMAP[wid];
    if (w && u.ton < (w.cls === "ballistic" ? w.dmg >= 15 ? 60 : w.dmg >= 10 ? 40 : 20 : w.cls === "missile" ? (w.dmg >= 15 ? 55 : 20) : 20)) return { error: "mass" };
    let loc = slotLoc && HARDPOINT_LOCS.indexOf(slotLoc) >= 0 ? slotLoc : null;
    if (loc) {
      const fit = hardpointFit(u, loc, wid);
      if (!fit.ok) return { error: "space", loc, free: fit.free, need: fit.need };
    } else {
      const free = freeHardpoints(u, wid);
      if (!free.length) return { error: "space" };
      loc = free[0];
    }
    const fee = installCost(wid);
    if (company.funds < fee) return { error: "funds" };
    company.partsInv[wid]--;
    u.weapons.push({ id: wid, loc, state: "ok" });
    logTx(company, "refit", "Installed " + (w ? w.name : wid) + " (" + HARDPOINT_NAMES[loc] + ") on " + u.name, -fee);
    return { ok: true, type: "install", fee, loc };
  }
  function moveWeapon(company, unitId, wi, loc) {
    const u = findUnit(company, unitId);
    if (!u) return { error: "notfound" };
    const wp = u.weapons[wi];
    if (!wp) return { error: "notfound" };
    if (u.status !== "ok") return { error: "busy" };
    if (HARDPOINT_LOCS.indexOf(loc) < 0) return { error: "loc" };
    if (wp.loc === loc) return { ok: true, loc };
    const cell = hardpointMap(u)[loc];
    const need = weaponSlots(D.WMAP[wp.id]);
    if (cell.used + need > cell.cap) return { error: "space" };
    const from = wp.loc;
    wp.loc = loc;
    return { ok: true, loc, from };
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
    const worldEvents = processWorld(company);
    for (const ev of worldEvents) company.log.unshift({ week: company.week, text: ev });
    processTransit(company);
    const payroll = weeklyPayroll(company);
    if (payroll) logTx(company, "payroll", "Weekly payroll — " + company.people.filter((p) => p.status === "active").length + " personnel", -payroll);
    const oh = overheadBreakdown(company);
    if (oh.maintenance) logTx(company, "upkeep", "Mech maintenance & storage", -oh.maintenance);
    if (oh.transport) logTx(company, "transport", "DropShip lease & transport", -oh.transport);
    if (oh.ammo) logTx(company, "ammo", "Ammo & consumables resupply", -oh.ammo);
    if (oh.medical) logTx(company, "medical", "Medical & infirmary", -oh.medical);
    const upkeep = oh.total;
    if (!Array.isArray(company.loans)) company.loans = [];
    if (!company.credit || typeof company.credit !== "object") company.credit = { score: 55, paid: 0, missed: 0 };
    const loanEvents = [];
    for (const loan of company.loans.slice()) {
      loan.weeksElapsed = (loan.weeksElapsed || 0) + 1;
      const interest = Math.round(loan.balance * loan.rate / 500) * 500;
      if (interest) loan.balance += interest;
      const due = Math.max(loan.minPayment || 0, interest);
      if (company.funds >= due) {
        logTx(company, "loan", "Loan payment — " + loan.lender, -due);
        loan.balance -= due;
        if (loan.balance <= 0) {
          company.loans = company.loans.filter((l) => l !== loan);
          company.credit.score = clamp(company.credit.score + 6, 0, 100);
          company.credit.paid = (company.credit.paid || 0) + 1;
          company.log.unshift({ week: company.week, text: "Loan with " + loan.lender + " repaid in full" });
          continue;
        }
      } else {
        loan.missed = (loan.missed || 0) + 1;
        company.credit.score = clamp(company.credit.score - 8, 0, 100);
        company.credit.missed = (company.credit.missed || 0) + 1;
        const f = loan.faction;
        if (f && company.rep[f] !== undefined) company.rep[f] = clamp(company.rep[f] - 1, -10, 10);
        company.log.unshift({ week: company.week, text: "Missed a payment to " + loan.lender + " — credit and reputation suffer" });
        loanEvents.push({ id: loan.id, lender: loan.lender, missed: loan.missed });
        if (loan.missed >= 3) {
          const owned = company.units.slice().sort((a, b) => (a.cost || 0) - (b.cost || 0));
          const seized = owned[0];
          if (seized) {
            if (seized.pilotId) { const p = findPerson(company, seized.pilotId); if (p) p.unitId = null; }
            company.units = company.units.filter((u) => u !== seized);
            company.stats.lost = (company.stats.lost || 0) + 1;
            company.log.unshift({ week: company.week, text: loan.lender + " seized " + seized.name + " against the unpaid debt" });
          }
          company.loans = company.loans.filter((l) => l !== loan);
          company.credit.score = clamp(company.credit.score - 15, 0, 100);
          loanEvents.push({ id: loan.id, lender: loan.lender, defaulted: true, seized: seized ? seized.name : null });
        }
      }
    }
    for (const p of company.people) {
      if (p.injuredWeeks > 0) {
        p.injuredWeeks--;
        if (p.injuredWeeks <= 0) { p.status = "active"; p.injuredWeeks = 0; company.log.unshift({ week: company.week, text: p.callsign + " returns to duty from the infirmary" }); }
      }
    }
    for (const p of company.people) {
      if (p.leaveWeeks > 0) {
        p.leaveWeeks--;
        if (p.leaveWeeks <= 0) { p.status = "active"; p.leaveWeeks = 0; company.log.unshift({ week: company.week, text: p.callsign + " returns from leave, rested" }); }
      }
    }
    for (const p of company.people) {
      if (p.status === "training" && p.training) {
        p.training.weeksLeft--;
        if (p.training.weeksLeft <= 0) finishTraining(company, p);
      }
    }
    for (const p of company.people) {
      const drop = p.status === "leave" ? 30 : 16;
      p.fatigue = clamp(Math.round((isFinite(p.fatigue) ? p.fatigue : 0) - drop), 0, 100);
    }
    const quits = [];
    for (const p of company.people.slice()) {
      if (p.role !== "pilot" || p.status === "leave") continue;
      const risk = p.morale <= 18 ? 0.3 : (p.morale <= 28 && (p.fatigue || 0) >= 75) ? 0.22 : 0;
      if (risk && chance(risk)) {
        if (p.unitId) { const u = findUnit(company, p.unitId); if (u) u.pilotId = null; }
        for (const q of company.people) if (q.bonds) q.bonds = q.bonds.filter((b) => b.otherId !== p.id);
        company.people = company.people.filter((x) => x.id !== p.id);
        company.morale = clamp(company.morale - 4, 0, 100);
        company.log.unshift({ week: company.week, text: p.callsign + " quit the company and walked off the DropShip at the last port" });
        quits.push({ id: p.id, callsign: p.callsign });
      }
    }
    const techCount = company.people.filter((p) => p.role === "tech" && p.status === "active").length;
    const bays = repairBays(company);
    const baySpeed = 7 * (1 + techCount * 0.5);
    let activeJobs = 0;
    for (const u of company.units) {
      if (u.status !== "repairing") continue;
      if (u.repairQueued) {
        if (activeJobs >= bays) continue;
        u.repairQueued = false;
        company.log.unshift({ week: company.week, text: u.name + " moved into a repair bay" });
      }
      activeJobs++;
      u.repairDaysLeft -= baySpeed;
      if (u.repairDaysLeft <= 0) {
        const q = completeRepair(company, u);
        activeJobs--;
        company.log.unshift({ week: company.week, text: u.name + " returned to the mechbay roster (" + q.label + ")" });
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
    if (!company.investmentOffers || !company.investmentOffers.length || company.week - (company.investmentsWeek || 0) >= 4) refreshInvestments(company);
    const investmentEvents = processInvestments(company);
    if (company.offers.length < 2) refreshOffers(company);
    const rivalEvents = processRival(company);
    for (const ev of rivalEvents) company.log.unshift({ week: company.week, text: ev });
    if (!company.recruits || !company.recruits.length || company.week - (company.recruitsWeek || 0) >= 1) refreshRecruits(company);
    let poach = null;
    const pt = poachTarget(company);
    if (pt && !company.poachPing && chance(pt.risk)) {
      company.poachPing = { personId: pt.person.id, week: company.week, queued: false };
      poach = { personId: pt.person.id, callsign: pt.person.callsign };
    } else if (company.poachPing && company.poachPing.week < company.week - 3) {
      delete company.poachPing;
    }
    const payrollN = weeklyPayroll(company);
    if (payrollN > company.funds && company.funds >= 0 && chance(0.4)) company.morale = clamp(company.morale - 1, 0, 100);
    const salvageSales = processSalvageListings(company);
    recordHistory(company);
    return { payroll, upkeep, quits, poach, salvageSales, loanEvents, investmentEvents, worldEvents: worldEvents.concat(rivalEvents) };
  }
  function totalDebt(company) { return (company.loans || []).reduce((s, l) => s + Math.max(0, l.balance), 0); }

  function recordHistory(company) {
    if (!Array.isArray(company.history)) company.history = [];
    let income = 0, expense = 0;
    for (const t of company.ledger) {
      if (t.week !== company.week) continue;
      const amt = t.amount || 0;
      if (amt >= 0) income += amt; else expense += -amt;
    }
    company.history.push({
      week: company.week, funds: Math.round(company.funds), income: Math.round(income), expense: Math.round(expense),
      net: Math.round(income - expense), debt: Math.round(totalDebt(company)), morale: Math.round(company.morale),
      headcount: company.people.length, units: company.units.filter((u) => u.status !== "destroyed").length,
      wins: company.stats.victories, kills: company.stats.kills
    });
    if (company.history.length > 120) company.history.shift();
  }
  function almanacStats(company) {
    const h = company.contractHistory || [];
    let wins = 0, losses = 0, partials = 0, payout = 0, kills = 0, lost = 0;
    for (const r of h) {
      if (r.outcome === "victory") wins++; else if (r.outcome === "defeat") losses++; else partials++;
      payout += r.pay || 0; kills += r.kills || 0; lost += r.ourDead || 0;
    }
    const decided = wins + losses;
    const best = h.reduce((m, r) => ((r.pay || 0) > (m ? m.pay : 0) ? r : m), null);
    return {
      contracts: h.length, wins, losses, partials, decided,
      winRate: decided ? Math.round((wins / decided) * 100) : null,
      payout: Math.round(payout), kills, lost, best,
      weeks: Math.max(1, company.week - 1), history: company.history || []
    };
  }
  function weeklyDebtService(company) { return (company.loans || []).reduce((s, l) => s + Math.round(l.balance * l.rate), 0); }
  function creditScore(company) { return clamp(Math.round(company && company.credit && isFinite(company.credit.score) ? company.credit.score : 55), 0, 100); }
  function creditLabel(company) {
    const s = creditScore(company);
    if (s >= 85) return "Prime";
    if (s >= 70) return "Good";
    if (s >= 55) return "Fair";
    if (s >= 35) return "Poor";
    return "Distressed";
  }
  const LENDERS = [
    { id: "comstar", name: "ComStar Credit Union", glyph: "❋", rate: 0.03, term: 14, base: 180000, creditMin: 60, faction: "comstar", blurb: "The safest money in the Sphere — modest sums, gentle terms and a credit check." },
    { id: "house", name: "House Mercantile Bank", glyph: "◈", rate: 0.05, term: 16, base: 320000, creditMin: 40, faction: "steiner", blurb: "House-backed credit for a company with a record. Interest bites, but the terms are fair." },
    { id: "shark", name: "Portside Loan Shark", glyph: "☠", rate: 0.09, term: 0, base: 460000, creditMin: 0, faction: "pirate", blurb: "No questions, no credit check, ruinous interest. Miss a payment and they come collecting." }
  ];
  function loanOffers(company) {
    const score = creditScore(company);
    const rating = companyRating(company);
    return LENDERS.map((L) => {
      if (score < L.creditMin) return { id: L.id, name: L.name, glyph: L.glyph, rate: L.rate, term: L.term, faction: L.faction, blurb: L.blurb, locked: true, reason: "Credit rating " + creditLabel(company) + " (" + score + ") is below their minimum of " + L.creditMin + "." };
      const scale = 1 + (score - 50) / 140 + rating.count * 0.12;
      const principal = Math.round((L.base * clamp(scale, 0.4, 2.2)) / 5000) * 5000;
      const minPayment = Math.round(principal * (L.rate + 1 / Math.max(6, L.term || 10)));
      return { id: L.id, name: L.name, glyph: L.glyph, rate: L.rate, term: L.term, faction: L.faction, blurb: L.blurb, principal: principal, minPayment: minPayment, locked: false };
    });
  }
  function takeCredit(company, offerId) {
    const offer = loanOffers(company).find((o) => o.id === offerId);
    if (!offer) return { error: "notfound" };
    if (offer.locked) return { error: "credit", reason: offer.reason };
    if ((company.loans || []).length >= 4) return { error: "max" };
    if (!company.loans) company.loans = [];
    if (!isFinite(company.nextIds.contract)) company.nextIds.contract = 1;
    const loan = { id: "ln" + (company.nextIds.contract++), lender: offer.name, lenderGlyph: offer.glyph, rate: offer.rate, term: offer.term, faction: offer.faction, principal: offer.principal, balance: offer.principal, minPayment: offer.minPayment, weeksElapsed: 0, missed: 0, openedWeek: company.week };
    company.loans.push(loan);
    logTx(company, "loan", "Loan drawdown — " + offer.name, offer.principal);
    return { ok: true, loan: loan };
  }
  function loanPayment(company, loanId, amount) {
    const loan = (company.loans || []).find((l) => l.id === loanId);
    if (!loan) return { error: "notfound" };
    if (amount === undefined || amount === null) amount = loan.balance;
    amount = Math.min(amount, loan.balance);
    if (amount <= 0) return { error: "none" };
    if (company.funds < amount) return { error: "funds" };
    logTx(company, "loan", "Loan payment — " + loan.lender, -amount);
    loan.balance -= amount;
    if (loan.balance <= 0) {
      company.loans = company.loans.filter((l) => l !== loan);
      if (company.credit) { company.credit.score = clamp(company.credit.score + 6, 0, 100); company.credit.paid = (company.credit.paid || 0) + 1; }
      company.log.unshift({ week: company.week, text: "Loan with " + loan.lender + " cleared in full" });
      return { ok: true, cleared: true };
    }
    return { ok: true, balance: loan.balance };
  }
  function repayLoan(company, loanId) {
    if (!company.loans || !company.loans.length) return { error: "none" };
    const loan = loanId ? company.loans.find((l) => l.id === loanId) : company.loans.slice().sort((a, b) => b.rate - a.rate)[0];
    if (!loan) return { error: "notfound" };
    if (company.funds < loan.balance) return { error: "funds" };
    return loanPayment(company, loan.id, loan.balance);
  }
  function takeLoan(company) {
    if (!company.loans) company.loans = [];
    if (company.loans.length >= 4) return { error: "max" };
    if (!isFinite(company.nextIds.contract)) company.nextIds.contract = 1;
    const principal = 200000;
    const loan = { id: "ln" + (company.nextIds.contract++), lender: "Emergency line of credit", lenderGlyph: "⚠", rate: 0.08, term: 0, faction: "pirate", principal: principal, balance: principal, minPayment: Math.round(principal * 0.08), weeksElapsed: 0, missed: 0, openedWeek: company.week };
    company.loans.push(loan);
    logTx(company, "loan", "Emergency line of credit", principal);
    return { ok: true, loan: loan };
  }
  const INVESTMENT_TYPES = [
    { id: "bonds", name: "ComStar bearer bonds", glyph: "❋", kind: "bond", price: 25000, yield: 0.006, vol: 0.01, blurb: "Rock-steady HPG-backed paper — small, reliable returns." },
    { id: "landhold", name: "Agri-combine landhold", glyph: "◈", kind: "landhold", price: 120000, yield: 0.012, vol: 0.02, blurb: "Tenanted farmland on a breadbasket world. Slow, dependable income." },
    { id: "defense", name: "Defense contractor stock", glyph: "⚔", kind: "stock", price: 80000, yield: 0.018, vol: 0.06, blurb: "Wartime industry — pays well when the shooting starts, swings with the market." },
    { id: "shipping", name: "DropShip shipping line", glyph: "➤", kind: "stock", price: 160000, yield: 0.016, vol: 0.05, blurb: "Freight and passenger haulage across the region." },
    { id: "prospect", name: "LosTech prospecting venture", glyph: "☄", kind: "venture", price: 300000, yield: 0.03, vol: 0.14, blurb: "High-stakes Star League salvage hunt — fortunes made and lost." },
    { id: "solaris", name: "Solaris arena franchise", glyph: "★", kind: "venture", price: 220000, yield: 0.025, vol: 0.11, blurb: "Game-world gladiator circuit. Gate receipts and betting take." }
  ];
  function refreshInvestments(company) {
    const picks = INVESTMENT_TYPES.slice().sort(() => Math.random() - 0.5).slice(0, 3 + Math.floor(Math.random() * 3));
    const eraMult = clamp(1.1 - (company.eraIdx || 0) * 0.02, 0.95, 1.1);
    company.investmentOffers = picks.map((t, i) => ({
      id: "iv" + company.week + "_" + i, tid: t.id, name: t.name, glyph: t.glyph, kind: t.kind,
      price: Math.round(t.price * rnd(0.85, 1.15) * eraMult / 100) * 100,
      yield: t.yield, vol: t.vol, blurb: t.blurb
    }));
    company.investmentsWeek = company.week;
    return company.investmentOffers;
  }
  function buyInvestment(company, offerId, units) {
    units = Math.max(1, Math.round(units || 1));
    const o = (company.investmentOffers || []).find((x) => x.id === offerId);
    if (!o) return { error: "gone" };
    const cost = o.price * units;
    if (company.funds < cost) return { error: "funds" };
    if (!company.investments) company.investments = [];
    if (company.investments.length >= 8) return { error: "max" };
    if (!isFinite(company.nextIds.contract)) company.nextIds.contract = 1;
    const holding = { id: "ih" + (company.nextIds.contract++), assetId: o.id, tid: o.tid, name: o.name, glyph: o.glyph, kind: o.kind, units: units, buyPrice: o.price, price: o.price, yield: o.yield, vol: o.vol, weeksHeld: 0, invested: cost };
    company.investments.push(holding);
    logTx(company, "investment", "Bought " + units + "× " + o.name, -cost);
    return { ok: true, cost: cost, holding: holding };
  }
  function sellInvestment(company, id) {
    const h = (company.investments || []).find((x) => x.id === id);
    if (!h) return { error: "notfound" };
    const gross = Math.round(h.units * h.price);
    const fee = Math.round(gross * 0.02);
    const net = gross - fee;
    logTx(company, "investment", "Sold " + h.units + "× " + h.name + " (2% brokerage)", net);
    company.investments = company.investments.filter((x) => x !== h);
    return { ok: true, net: net, fee: fee, profit: net - h.invested };
  }
  function investmentValue(company) { return (company.investments || []).reduce((s, h) => s + h.units * h.price, 0); }
  function weeklyInvestmentIncome(company) { return (company.investments || []).reduce((s, h) => s + Math.round(h.units * h.price * h.yield), 0); }
  function processInvestments(company) {
    if (!Array.isArray(company.investments)) company.investments = [];
    const events = [];
    for (const h of company.investments.slice()) {
      h.weeksHeld = (h.weeksHeld || 0) + 1;
      h.price = Math.max(1, Math.round(h.price * (1 + h.yield * 0.4 + rnd(-h.vol, h.vol * 1.1))));
      const income = Math.round(h.units * h.price * h.yield);
      if (income) logTx(company, "investment", "Dividend — " + h.name, income);
      if (chance(h.vol * 0.55)) {
        const up = chance(0.5);
        const mag = rnd(0.08, 0.28) * (up ? 1 : -1);
        h.price = Math.max(1, Math.round(h.price * (1 + mag)));
        company.log.unshift({ week: company.week, text: h.name + (up ? " surged " : " slumped ") + Math.round(Math.abs(mag) * 100) + "% on the market" });
        events.push({ id: h.id, name: h.name, dir: up ? "up" : "down", mag: mag });
      }
    }
    return events;
  }
  function bankruptcyCheck(company) {
    if (company.funds >= -120000) return null;
    return { type: "bankrupt", message: "Creditors have seized the company accounts. " + company.name + " owes more than its DropShip is worth." };
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
        { label: "Order a joint two-week simulator program", hint: "-15k, may bury the hatchet", run: (c) => { EVT.money(c, -15000, "Rivalry reconciliation program"); const a = pick(c.people.filter((p) => p.status === "active" && (p.bonds || []).some((b) => b.type === "rival"))); if (!a) { EVT.morale(c, 1); return "There is no active feud to heal just now, but the sim pods get some use."; } const bnd = a.bonds.find((b) => b.type === "rival"); const b = c.people.find((q) => q.id === (bnd || {}).otherId); if (!b) return "The program runs; the pilots involved have since moved on."; if (chance(0.55)) { for (const p of [a, b]) p.bonds = (p.bonds || []).filter((x) => x.otherId !== (p === a ? b.id : a.id)); a.bonds.push({ type: "buddy", otherId: b.id, sinceWeek: c.week, drops: 1, lastWeek: c.week }); b.bonds.push({ type: "buddy", otherId: a.id, sinceWeek: c.week, drops: 1, lastWeek: c.week }); a.morale = clamp(a.morale + 8, 0, 100); b.morale = clamp(b.morale + 8, 0, 100); return "Two weeks of forced cooperation in the sim pods, and something clicks. " + a.callsign + " and " + b.callsign + " walk out trading insults that no longer sound like threats. The feud is over."; } EVT.morale(c, -2); return "Two weeks of sim-fighting only sharpens the grudge. " + a.callsign + " and " + b.callsign + " are worse than before — now they have formalized it."; } },
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
    },
    {
      id: "poach", title: "Poaching Offer", eraMin: 0,
      body: (c) => {
        const p = c.poachPing ? findPerson(c, c.poachPing.personId) : null;
        if (!p) return null;
        const slot = p.role === "pilot" ? "a cockpit with their name already stencilled on it" : "a senior berth in a rival's tech bay";
        const tier = pilotTier(p);
        return "A recruiter for a rival outfit has been working the port bars, and " + p.name + " (\"" + p.callsign + "\", rated " + tier + ") came back with an offer: better pay, a signing bonus, " + slot + ". " + voiceLine(p, "payday", {}) + " They have not said yes. Yet.";
      },
      choices: [
        { label: "Match the offer — raise their salary", hint: "Signing cost, salary +35%", run: (c) => { const p = c.poachPing ? findPerson(c, c.poachPing.personId) : null; if (!p) { delete c.poachPing; return "The offer lapses — they have already moved on."; } const fee = Math.round(p.salary * 2 / 100) * 100; EVT.money(c, -fee, "Retention — matched offer for " + p.callsign); p.salary = Math.round(p.salary * 1.35 / 50) * 50; p.morale = clamp(p.morale + 10, 0, 100); delete c.poachPing; return p.callsign + " signs the counter-offer at " + calcSalary(p) + " a week. The rival recruiter leaves empty-handed — for now."; } },
        { label: "Pay a one-time retention bonus", hint: "-30k, morale +6", run: (c) => { const p = c.poachPing ? findPerson(c, c.poachPing.personId) : null; EVT.money(c, -30000, "Retention bonus for " + (p ? p.callsign : "crew")); if (p) p.morale = clamp(p.morale + 6, 0, 100); delete c.poachPing; return (p ? p.callsign : "They") + " pockets the bonus and stays on — though the pay gap has not gone anywhere."; } },
        { label: "Wish them well", hint: "They leave the company", run: (c) => { const p = c.poachPing ? findPerson(c, c.poachPing.personId) : null; delete c.poachPing; if (!p) return "The offer resolves itself."; if (p.unitId) { const u = findUnit(c, p.unitId); if (u) u.pilotId = null; } for (const q of c.people) if (q.bonds) q.bonds = q.bonds.filter((b) => b.otherId !== p.id); c.people = c.people.filter((x) => x.id !== p.id); c.morale = clamp(c.morale - 4, 0, 100); c.log.unshift({ week: c.week, text: p.callsign + " took a rival's offer and left " + c.name }); return p.callsign + " packs a footlocker and ships out on the next freighter. The company feels the loss."; } }
      ]
    },
    {
      id: "leave", title: "Leave Request", eraMin: 0,
      body: (c) => {
        const p = pick(c.people.filter((x) => x.role === "pilot" && x.status === "active" && (x.fatigue || 0) >= 68));
        if (!p) return null;
        return p.name + " ('" + p.callsign + "') has flown back-to-back drops and is running on stims and stubbornness — fatigue is at " + Math.round(p.fatigue || 0) + "%. " + voiceLine(p, "payday", {}) + " They are asking for a week on the ground before someone gets hurt.";
      },
      choices: [
        { label: "Approve a week's leave", hint: "Pilot stands down 1 week, fatigue clears", run: (c, p) => { if (!p) return "Leave approved."; p.status = "leave"; p.leaveWeeks = 1; p.fatigue = 8; p.morale = clamp(p.morale + 6, 0, 100); return p.callsign + " stands down for a week. The machine sits idle, but the pilot comes back sharp."; } },
        { label: "Rotate them to a desk posting", hint: "-6k, quicker recovery", run: (c, p) => { EVT.money(c, -6000, "Ground rotation stipend"); if (p) { p.status = "leave"; p.leaveWeeks = 1; p.fatigue = 20; p.morale = clamp(p.morale + 3, 0, 100); } return "You keep them on the roster but off the line, running sims and paperwork for a week. Cheaper on the airframe, easier on the pilot."; } },
        { label: "Deny it — we need every cockpit", hint: "Morale -3, pilot morale -10, walkout risk", run: (c, p) => { EVT.morale(c, -3); if (p) { p.morale = clamp(p.morale - 10, 0, 100); return p.callsign + " nods, says nothing, and climbs back into the cockpit. The look they give you says they're updating their resume."; } return "The request is denied."; } }
      ]
    },
    {
      id: "rival-clash", title: "A Rival Outfit Calls You Out", eraMin: 0,
      body: (c) => {
        const r = c.rival;
        if (!r) return null;
        return r.name + " — " + r.activity + " — has been badmouthing " + c.name + " in every hiring hall on the planet, undercutting your bids and telling anyone who will listen that your last contract 'barely counted'. A formal challenge has arrived: a head-to-head exhibition trial, winner takes the loser's standing on this world.";
      },
      choices: [
        { label: "Accept the trial by combat", hint: "Stake your reputation against theirs", run: (c) => { const r = c.rival; if (!r) return "The challenge fizzles out."; const our = Math.max(1, companyRating(c).power); const pWin = clamp(0.5 + (our - r.power) / (our + r.power) * 0.5, 0.15, 0.85); if (chance(pWin)) { r.losses++; r.power = Math.max(10, r.power - ri(4, 9)); r.rep = clamp(r.rep - 2, 0, 20); r.activity = "lost a public trial to us and has gone quiet"; EVT.money(c, 40000, "Trial stakes won from " + r.name); EVT.morale(c, 6); return "The trial is brutal and short. Your lance breaks " + r.name + "'s line by the third exchange, and every broker on the planet saw it happen."; } r.wins++; r.power += ri(3, 7); r.rep = clamp(r.rep + 2, 0, 20); r.activity = "beat us in a public trial and is crowing about it"; EVT.money(c, -20000, "Trial stakes lost to " + r.name); EVT.morale(c, -5); return "It goes badly. " + r.name + " takes the field, the stakes and the bragging rights. The crew will not soon forget it."; } },
        { label: "Outbid them with a show of force", hint: "-35k, morale +2, rival standing −1", run: (c) => { const r = c.rival; if (!r) return "Nothing to prove."; EVT.money(c, -35000, "Show-of-force exercise"); r.rep = clamp(r.rep - 1, 0, 20); EVT.morale(c, 2); return "You stage a full lance exercise on the edge of town, invite every broker on the planet, and let the hardware do the talking. " + r.name + "'s recruiters quietly leave."; } },
        { label: "Ignore the challenge", hint: "Morale −2, rival standing +1", run: (c) => { const r = c.rival; if (!r) return "Nothing happens."; r.rep = clamp(r.rep + 1, 0, 20); EVT.morale(c, -2); return "You let it lie. " + r.name + " claims victory by default, and a few brokers start taking them seriously."; } }
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

  function worldOpenFront(company, attackerId, ownerId) {
    const w = ensureWorld(company);
    const cands = w.systems.filter((s) => !s.hub && !s.contested && s.owner && s.owner !== attackerId && (!ownerId || s.owner === ownerId) && hostilePair(attackerId, s.owner));
    if (!cands.length) return null;
    const s = pick(cands);
    s.attacker = attackerId;
    s.heat = Math.max(s.heat, 4);
    s.contested = true;
    s.frontWeeks = 0;
    s.control = clamp(s.control - ri(4, 10), 30, 85);
    return s;
  }
  function worldSeize(company, systemId, newOwner) {
    const s = worldSystemById(company, systemId);
    if (!s || !newOwner) return null;
    s.owner = newOwner;
    s.attacker = null;
    s.contested = false;
    s.heat = Math.max(2, s.heat);
    s.control = 52 + ri(0, 12);
    s.changedWeek = company.week;
    return s;
  }
  function relocateCompany(company, systemId) {
    const s = worldSystemById(company, systemId);
    if (!s) return null;
    company.location = s.id;
    company.transit = null;
    company.log.unshift({ week: company.week, text: "The company relocates to " + s.name });
    return s;
  }
  const STORY_EVENTS = [
    {
      id: "succession-offensive", eraMin: 0, eraMax: 0, atWeek: 6,
      title: "A House Offensive Stirs", kicker: "★ CAMPAIGN EVENT",
      body: (c) => { const f = pick(eraFactions(c).filter((x) => x.type === "house")) || D.FACTIONS[0]; return "Intelligence out of " + f.name + " command says a major offensive is massing on the border — massed armour, fresh regiments, and a short list of mercenary outfits invited to join the second wave. A staff officer offers " + c.name + " a place in it."; },
      choices: [
        { label: "Join the offensive", hint: "Signing bonus, +2 rep, the front flares", run: (c) => { const f = pick(eraFactions(c).filter((x) => x.type === "house")) || D.FACTIONS[0]; EVT.money(c, 90000, "Offensive signing bonus — " + f.name); EVT.rep(c, f.id, 2); const s = worldOpenFront(c, f.id); EVT.morale(c, 3); return "The advance jumps off at dawn. " + (s ? s.name + " becomes a flashpoint as " + f.name + " drives into the border." : "The border lights up with fighting.") + " The signing bonus clears the same day."; } },
        { label: "Sell them supplies instead", hint: "+35k, no obligation", run: (c) => { EVT.money(c, 35000, "Wartime supply sale"); return "You keep your mechs in the bay and your accounts in the black. Quartermasters pay handsomely for a war they are about to start."; } },
        { label: "Stay out of it entirely", hint: "Morale +2", run: (c) => { EVT.morale(c, 2); return "You decline politely. The crew gets a quiet month and a commander who does not spend their lives cheaply."; } }
      ]
    },
    {
      id: "clan-invasion", eraMin: 1, eraMax: 1, atWeek: 6,
      title: "The Clans Cross the Periphery", kicker: "★ CAMPAIGN EVENT",
      body: (c) => { const clan = pick(eraFactions(c).filter((x) => x.type === "clan")) || D.FACTIONS[0]; return "Reports flood in from the Periphery: unknown OmniMechs, batchall challenges on open channels, and whole worlds falling in days. " + (clan ? clan.name + " " : "") + "forces are driving toward the Inner Sphere, and every House in their path is scrambling to hire anyone with a working lance."; },
      choices: [
        { label: "Take a defensive contract", hint: "Hazard pay, +2 rep, Clans press a front", run: (c) => { const clan = pick(eraFactions(c).filter((x) => x.type === "clan")); const house = pick(eraFactions(c).filter((x) => x.type === "house")); EVT.money(c, 130000, "Defensive contract — " + (house ? house.name : "the Inner Sphere")); if (house) EVT.rep(c, house.id, 2); if (clan) { EVT.rep(c, clan.id, -2); worldOpenFront(c, clan.id); } EVT.morale(c, 2); return "You sign on to hold the line. " + (clan ? clan.name + " forces sharpen their knives for your drop zone." : "The invaders are coming.") + " The hazard pay is excellent, and the casualty lists are worse."; } },
        { label: "Sell the invaders star charts", hint: "+80k, +2 Clan rep, −2 House rep", run: (c) => { const clan = pick(eraFactions(c).filter((x) => x.type === "clan")); const house = pick(eraFactions(c).filter((x) => x.type === "house")); EVT.money(c, 80000, "Sold navigation data"); if (clan) EVT.rep(c, clan.id, 2); if (house) EVT.rep(c, house.id, -2); EVT.morale(c, -2); return "The Clans pay in flawless germanium for navigation data you should not be selling. The Houses would call it treason. The Clans call it a bargain."; } },
        { label: "Withdraw to the Periphery", hint: "Relocate to safer space, morale +3", run: (c) => { const w = ensureWorld(c); const per = w.systems.filter((s) => s.owner === "canopus" || s.owner === "taurian"); const s = per.length ? relocateCompany(c, pick(per).id) : null; EVT.morale(c, 3); return "You take the long jump rimward, out of the invaders' path." + (s ? " The company is now stationed at " + s.name + "." : "") + " The crew exhales."; } }
      ]
    },
    {
      id: "civil-war", eraMin: 2, eraMax: 2, atWeek: 6,
      title: "A Commonwealth Torn", kicker: "★ CAMPAIGN EVENT",
      body: (c) => "The Federated Commonwealth is coming apart at the seams. Both halves are scouring the hiring halls for loyal guns, and both are calling the other traitors. Sooner or later, every mercenary on the border is going to have to pick a side.",
      choices: [
        { label: "Side with the Lyran half", hint: "+2 Steiner rep, −2 Davion rep", run: (c) => { EVT.rep(c, "steiner", 2); EVT.rep(c, "davion", -2); EVT.money(c, 60000, "Lyran retainer"); worldOpenFront(c, "steiner", "davion"); return "You take the Lyran coin and the Lyran side. Davion recruiters cross your name off their lists in red ink."; } },
        { label: "Side with the Federated Suns", hint: "+2 Davion rep, −2 Steiner rep", run: (c) => { EVT.rep(c, "davion", 2); EVT.rep(c, "steiner", -2); EVT.money(c, 60000, "Davion retainer"); worldOpenFront(c, "davion", "steiner"); return "You sign with New Avalon. The Lyrans, who had you on retainer, take it personally."; } },
        { label: "Declare neutrality", hint: "Morale +2, reputation unchanged", run: (c) => { EVT.morale(c, 2); return "You declare the company a neutral asset and refuse every retainer. Both sides call you a coward. The crew calls you sensible."; } }
      ]
    },
    {
      id: "jihad", eraMin: 3, eraMax: 3, atWeek: 6,
      title: "The Word of Blake Strikes", kicker: "★ CAMPAIGN EVENT",
      body: (c) => "The Word of Blake has declared a holy war on the Inner Sphere. HPG stations are burning, ComStar is fighting for its life, and the Blakists are hiring every gun they can find. The chaos is either a catastrophe or an opportunity — depending on who is paying.",
      choices: [
        { label: "Defend the HPG network", hint: "+2 ComStar rep, −2 WoB rep, front flares", run: (c) => { EVT.money(c, 110000, "ComStar defense contract"); EVT.rep(c, "comstar", 2); EVT.rep(c, "wob", -2); const s = worldOpenFront(c, "wob", "comstar"); EVT.morale(c, -1); return "Your lance holds a burning HPG compound for nine days. ComStar remembers its friends." + (s ? " " + s.name + " is now a war zone." : ""); } },
        { label: "Take Blakist coin", hint: "+2 WoB rep, −3 ComStar rep, +140k", run: (c) => { EVT.money(c, 140000, "Word of Blake contract"); EVT.rep(c, "wob", 2); EVT.rep(c, "comstar", -3); worldOpenFront(c, "wob", "comstar"); EVT.morale(c, -3); return "The Blakists pay in ComStar script and pray over your mechs. Some of the crew will not look the chaplains in the eye — but the money is very, very good."; } },
        { label: "Sit out the holy war", hint: "Morale +3, no contracts for a while", run: (c) => { EVT.morale(c, 3); return "You ground the company and refuse every approach. There is no profit in a war of faith, only funerals."; } }
      ]
    },
    {
      id: "dark-age", eraMin: 4, eraMax: 4, atWeek: 6,
      title: "The HPG Blackout", kicker: "★ CAMPAIGN EVENT",
      body: (c) => "Every Hyperpulse Generator in the Inner Sphere has gone dark. The network that held civilisation together for centuries has simply stopped, and with it every contract, payment and order that travelled by HPG. Nobody knows who is in charge anymore. Everybody needs guns.",
      choices: [
        { label: "Go fully independent", hint: "Flexible: +funds, morale +4, no House ties", run: (c) => { EVT.money(c, 75000, "Cash contracts, no questions"); EVT.morale(c, 4); return "You take payment in germanium and spare parts, from anyone, on the spot. In a galaxy without a network, the mercenary who answers only to the gun in the room is king."; } },
        { label: "Back a reborn ComStar", hint: "+2 ComStar rep, slower money", run: (c) => { EVT.money(c, 40000, "HPG restoration contract"); EVT.rep(c, "comstar", 2); return "You put your mechs to work guarding relay technicians stringing cable between dead stations. It pays less than war — and matters a great deal more."; } },
        { label: "Sell the chaos", hint: "+120k, −3 rep with ComStar", run: (c) => { EVT.money(c, 120000, "Sold blackout intel"); EVT.rep(c, "comstar", -3); return "Merchants pay fortunes for word of what is still standing. You sell it to everyone, and the blackout lasts a little longer for a little more coin."; } }
      ]
    },
    {
      id: "defectors", atWeek: 14,
      title: "Survivors of a Broken Outfit",
      kicker: "★ CAMPAIGN EVENT",
      body: (c) => "A battered Union-class DropShip limps into the port with a dozen souls aboard — the last survivors of a mercenary company that bought a contract it could not survive. Their commander is dead, their paymaster has vanished, and they are offering their mechs and their loyalty to whoever will take them in.",
      choices: [
        { label: "Take in the survivors", hint: "Gain 1–2 pilots/techs, morale +4", run: (c) => { const n = ri(1, 2); const names = []; for (let i = 0; i < n; i++) { const role = chance(0.7) ? "pilot" : "tech"; const p = genPerson(c, role); c.people.push(p); names.push(p.callsign); } EVT.morale(c, 4); EVT.money(c, -10000, "Billeting survivors"); return "You find bunks and rations for all of them. " + names.join(" and ") + " sign on by nightfall, grateful and dangerous."; } },
        { label: "Buy their mechs, not their people", hint: "Cheap mech, −8 morale", run: (c) => { const pool = eraMechPool(c); const m = pick(pool); c.units.push(genUnit(c, m.id, { condition: rnd(0.55, 0.8), origin: "salvage" })); EVT.money(c, -30000, "Hull purchase"); EVT.morale(c, -8); return "You take the hardware and leave the humans to fend for themselves. The techs have a name for commanders like you, and they use it behind your back."; } },
        { label: "Send them on with supplies", hint: "−15k, morale +6", run: (c) => { EVT.money(c, -15000, "Relief supplies for survivors"); EVT.morale(c, 6); return "You load them with food, crates and a line of credit. They will remember it. Word gets around, and the word is good."; } }
      ]
    },
    {
      id: "mrb-audit", atWeek: 26,
      title: "Mercenary Review Board Audit", kicker: "★ CAMPAIGN EVENT",
      body: (c) => "A team of MRB auditors arrives without warning to review " + c.name + "'s contract records, salvage declarations and payroll filings. Their lead accountant has the expression of someone who already knows where the bodies are buried.",
      choices: [
        { label: "Open the books", hint: "Honest: credit +8, small fine", run: (c) => { EVT.money(c, -8000, "MRB filing fee"); if (c.credit) c.credit.score = clamp(c.credit.score + 8, 0, 100); EVT.rep(c, "comstar", 1); return "Everything is filed, if not tidy. The auditors leave a clean rating and a mild lecture about double-entry bookkeeping."; } },
        { label: "Offer the auditors a retainer", hint: "−45k, credit +12, small risk", run: (c) => { EVT.money(c, -45000, "MRB compliance retainer"); if (c.credit) c.credit.score = clamp(c.credit.score + 12, 0, 100); if (chance(0.3)) { EVT.rep(c, "comstar", -2); return "The audit clears, but one auditor takes the retainer and reports it anyway. ComStar is not amused."; } return "The audit clears with a glowing recommendation. Some doors simply require oil."; } },
        { label: "Refuse the audit", hint: "credit −10, reputation −1 ComStar", run: (c) => { if (c.credit) c.credit.score = clamp(c.credit.score - 10, 0, 100); EVT.rep(c, "comstar", -1); return "You escort the auditors to the DropShip ramp and hand back their clipboards. The MRB stamps your file 'non-cooperative' and lenders take note."; } }
      ]
    }
  ];
  function startStoryEvents(company) {
    if (!company.story || typeof company.story !== "object") company.story = { seen: {} };
    if (!company.story.seen) company.story.seen = {};
    const out = [];
    for (const ev of STORY_EVENTS) {
      if (company.story.seen[ev.id]) continue;
      if (ev.eraMin !== undefined && company.eraIdx < ev.eraMin) continue;
      if (ev.eraMax !== undefined && company.eraIdx > ev.eraMax) continue;
      if (ev.atWeek !== undefined && company.week < ev.atWeek) continue;
      if (ev.when && !ev.when(company)) continue;
      const b = ev.body(company);
      if (b === null || b === undefined) continue;
      company.story.seen[ev.id] = company.week;
      out.push(Object.assign({ kind: "story" }, ev));
      break;
    }
    return out;
  }

  const RIVAL_NAMES = ["Grim Determination", "Iron Bounty", "The Steel Covenant", "Crimson Lance", "Wolf's Own", "Black Sun Irregulars", "The Broken Compass", "Sable Company", "Redtail Syndicate", "The Gilded Fist", "Hammerfall", "Kestrel Free Company"];
  const RIVAL_GLYPHS = ["◆", "▲", "✦", "☠", "✚", "❖", "◈", "✜"];
  const RIVAL_COLORS = ["#c0554f", "#5f8fd0", "#b07f3a", "#7a9a4a", "#9a6fb0", "#4aa0a0"];
  const RIVAL_TRAITS = [
    { id: "aggressive", name: "Aggressive", desc: "bids low and fights hard", steal: 0.24, growth: 1.35, poach: 0.6 },
    { id: "connected", name: "Well-connected", desc: "wins work through favours and politics", steal: 0.2, growth: 1.1, poach: 0.9 },
    { id: "scrappy", name: "Scrappy", desc: "cheap, hungry and everywhere", steal: 0.18, growth: 0.95, poach: 0.4 },
    { id: "elite", name: "Elite", desc: "expensive and deadly", steal: 0.26, growth: 1.2, poach: 0.5 }
  ];
  function makeRival(company) {
    const rating = companyRating(company);
    const trait = pick(RIVAL_TRAITS);
    const base = Math.max(20, rating.power);
    return {
      name: pick(RIVAL_NAMES), glyph: pick(RIVAL_GLYPHS), color: pick(RIVAL_COLORS),
      traitId: trait.id, power: Math.max(15, Math.round(base * rnd(0.6, 0.95))),
      rep: ri(0, 1), wins: 0, losses: 0, contracts: 0, foundedWeek: company.week,
      activity: "a new outfit on the circuit, hungry for work"
    };
  }
  function ensureRival(company) {
    if (!company.rival || !company.rival.name || !isFinite(company.rival.power)) company.rival = makeRival(company);
    return company.rival;
  }
  function rivalTrait(company) { const r = ensureRival(company); return RIVAL_TRAITS.find((t) => t.id === r.traitId) || RIVAL_TRAITS[0]; }
  function rivalRating(company) {
    const r = ensureRival(company);
    const our = Math.max(1, companyRating(company).power);
    const rel = r.power / our;
    let label = "Minor outfit";
    if (rel > 2) label = "Major outfit";
    else if (rel > 1.3) label = "Serious rival";
    else if (rel > 0.8) label = "Even match";
    else if (rel > 0.5) label = "Small-timer";
    return { rel: rel, label: label, power: r.power, rep: r.rep };
  }
  function processRival(company) {
    const r = ensureRival(company);
    const our = Math.max(1, companyRating(company).power);
    const trait = rivalTrait(company);
    const events = [];
    const target = our * (0.75 + r.rep * 0.03);
    r.power = Math.max(10, Math.round(r.power + (target - r.power) * 0.12));
    const rel = clamp(r.power / our, 0.4, 1.8);
    if ((company.offers || []).length > 1 && chance(trait.steal * rel)) {
      const victim = company.offers.slice().sort((a, b) => a.pay - b.pay)[0];
      company.offers = company.offers.filter((o) => o !== victim);
      r.contracts++; r.wins++;
      r.power += ri(2, 6);
      r.rep = clamp(r.rep + 1, 0, 20);
      r.activity = "snatched the " + victim.missionName + " on " + victim.planet + " out from under us";
      events.push("Rival outfit " + r.name + " has taken the " + victim.missionName + " contract on " + victim.planet + " — the board is one job lighter");
    } else if (chance(0.18)) {
      r.power = Math.max(10, r.power - ri(1, 4));
      if (chance(0.5)) r.rep = clamp(r.rep - 1, 0, 20);
      r.activity = "had a rough week — a contract went sideways";
    }
    return events;
  }
  function resolveRivalContract(company, offer, battle) {
    const r = company.rival;
    if (!r) return;
    if (battle.outcome === "victory") {
      r.losses++;
      r.power = Math.max(10, r.power - ri(3, 7));
      r.rep = clamp(r.rep - 1, 0, 20);
      r.activity = "lost a bid to us on " + offer.planet + " and is licking its wounds";
      company.log.unshift({ week: company.week, text: "Your lance beat " + r.name + " to the " + offer.missionName + " contract on " + offer.planet });
    } else {
      r.wins++;
      r.power += ri(2, 5);
      r.rep = clamp(r.rep + 1, 0, 20);
      r.activity = "took the " + offer.missionName + " work we could not hold on " + offer.planet;
      company.log.unshift({ week: company.week, text: r.name + " is claiming the " + offer.planet + " job went better for them than for us" });
    }
  }
  function rivalMult(company) {
    const r = company.rival;
    if (!r || !isFinite(r.power)) return 1;
    const our = Math.max(1, companyRating(company).power);
    return clamp(1 - (r.power / our - 1) * 0.06, 0.86, 1.04);
  }

  function startCompanyEvents(company, battleRef) {
    const out = [];
    if (!battleRef) { for (const se of startStoryEvents(company)) out.push(se); }
    const cache = rollCacheChance(company, battleRef);
    if (cache) { const ev = pick(CACHE_EVENTS); out.push(Object.assign({ kind: "cache", battleRef }, ev)); }
    const pool = COMPANY_EVENTS.filter((e) => (e.eraMin === undefined || e.eraMin <= company.eraIdx) && (e.eraMax === undefined || e.eraMax >= company.eraIdx));
    const poachEv = COMPANY_EVENTS.find((e) => e.id === "poach");
    if (company.poachPing && !company.poachPing.queued && poachEv) {
      const pp = company.people.find((p) => p.id === company.poachPing.personId);
      if (pp) { company.poachPing.queued = true; out.push(Object.assign({ kind: "company" }, poachEv)); }
      else delete company.poachPing;
    }
    const tired = company.people.some((p) => p.role === "pilot" && p.status === "active" && (p.fatigue || 0) >= 70);
    const leaveEv = COMPANY_EVENTS.find((e) => e.id === "leave");
    if (tired && leaveEv && chance(0.6)) {
      out.push(Object.assign({ kind: "company" }, leaveEv));
    } else if (chance(0.5) && pool.length) {
      let ev = pick(pool);
      let tries = 0;
      while (ev.body(company) === null && tries++ < 8) ev = pick(pool);
      out.push(Object.assign({ kind: "company" }, ev));
    }
    return out;
  }

  const ACHIEVEMENTS = [
    { id: "firstblood", cat: "Combat", glyph: "✦", title: "Blooded", name: "First Blood", desc: "Win your first contract.", goal: 1, flavor: "The company has drawn blood and won — the paperwork calls you a real mercenary outfit now.", metric: (c) => (c.stats || {}).victories || 0 },
    { id: "gainfully", cat: "Combat", glyph: "◇", name: "Gainfully Employed", desc: "Complete five contracts.", goal: 5, flavor: "Five contracts in the ledger. The hiring halls are starting to recognise the colours.", metric: (c) => (c.contractHistory || []).length },
    { id: "hardcase", cat: "Combat", glyph: "✚", name: "Hard Case", desc: "Survive a lost contract and keep the company alive.", goal: 1, flavor: "You've been beaten in the field and didn't fold. Reputation is built on what you do after a loss.", metric: (c) => (c.stats || {}).defeats || 0 },
    { id: "streak5", cat: "Combat", glyph: "⚡", name: "Winning Streak", desc: "Win five contracts in a row.", goal: 5, flavor: "Five straight victories. The lance is operating like a well-oiled machine.", metric: (c) => (c.stats || {}).bestStreak || 0 },
    { id: "scarred", cat: "Combat", glyph: "☠", name: "Scarred but Standing", desc: "Lose three machines and soldier on.", goal: 3, flavor: "Three cockpits lost, and the company still takes the field. Every scratch is a story.", metric: (c) => (c.stats || {}).lost || 0 },
    { id: "kills25", cat: "Combat", glyph: "◎", name: "Mech Hunter", desc: "Confirm twenty-five kills.", goal: 25, flavor: "Twenty-five confirmed kills painted on the DropShip hull.", metric: (c) => (c.stats || {}).kills || 0 },
    { id: "flawless", cat: "Combat", glyph: "❖", title: "Spotless", name: "Flawless Drop", desc: "Win a contract with no injuries and no losses.", goal: 1, flavor: "A textbook drop: every machine home, every pilot unhurt. The debrief was almost boring.", metric: (c) => (c.stats || {}).flawless || 0 },
    { id: "undefeated", cat: "Combat", glyph: "★", title: "The Undefeated", name: "The Undefeated", desc: "Win ten contracts back to back.", goal: 10, flavor: "Ten consecutive victories. Somewhere, a rival outfit is quietly updating its intelligence file.", metric: (c) => (c.stats || {}).bestStreak || 0 },
    { id: "warlord", cat: "Combat", glyph: "⚔", title: "Warlord", name: "Warlord", desc: "Win twenty-five contracts.", goal: 25, flavor: "A quarter-century of victories. Your name is spoken in the same breath as the great commands.", metric: (c) => (c.stats || {}).victories || 0 },
    { id: "ironrain", cat: "Combat", glyph: "☄", title: "Iron Rain", name: "Iron Rain", desc: "Confirm one hundred kills.", goal: 100, flavor: "A hundred enemy machines broken. The salvage crews have named a crater after you.", metric: (c) => (c.stats || {}).kills || 0 },
    { id: "year", cat: "Command", glyph: "▦", title: "Veteran Command", name: "A Year Under Arms", desc: "Keep the company running for a full year.", goal: 52, flavor: "Fifty-two weeks in the black. Most outfits don't last a season — you've built something that endures.", metric: (c) => c.week || 0 },
    { id: "roster", cat: "Command", glyph: "◈", name: "Full Roster", desc: "Grow the company to twelve personnel.", goal: 12, flavor: "Twelve names on the payroll — pilots, techs and support. A proper little army.", metric: (c) => (c.people || []).length },
    { id: "bonded", cat: "Command", glyph: "✧", title: "Band of Brothers", name: "Band of Brothers", desc: "Forge six bonds in the ranks.", goal: 6, flavor: "The lance has become a family. Bonds forged in the field are worth more than any contract bonus.", metric: (c) => bondPairCount(c) },
    { id: "elite", cat: "Command", glyph: "✜", title: "Cockpit Elite", name: "Cockpit Elite", desc: "Cultivate a pilot at Gunnery 2 / Piloting 2 or better.", goal: 1, flavor: "You've trained a pilot to the edge of human capability. The simulator logs read like poetry.", metric: (c) => (c.people || []).filter((p) => p.role === "pilot" && (p.gunnery || 7) <= 2 && (p.piloting || 7) <= 2).length },
    { id: "housefavourite", cat: "Command", glyph: "❋", title: "House Favourite", name: "House Favourite", desc: "Reach reputation 8 with any faction.", goal: 8, flavor: "One of the Great Houses now counts you among its trusted instruments. Doors open before you knock.", metric: (c) => maxRep(c) },
    { id: "black", cat: "Finance", glyph: "₡", title: "Deep Pockets", name: "In the Black", desc: "Build a treasury of 1.5 million C-bills.", goal: 1500000, flavor: "A vault of C-bills and no one shooting at it. The quartermaster sleeps soundly.", metric: (c) => peakFunds(c) },
    { id: "debtfree", cat: "Finance", glyph: "✓", title: "Debt Free", name: "Debt Free", desc: "Reach week ten solvent and owing no lender anything.", goal: 1, flavor: "Not a single creditor left on the books. Your credit rating — and your blood pressure — improve.", metric: (c) => (totalDebt(c) <= 0 && (c.week || 0) >= 10 && (c.funds || 0) > 0 ? 1 : 0) },
    { id: "primecredit", cat: "Finance", glyph: "◈", name: "Prime Credit", desc: "Raise your credit score to 85.", goal: 85, flavor: "Prime credit — banks now compete to lend you money instead of the other way around.", metric: (c) => creditScore(c) },
    { id: "profiteer", cat: "Finance", glyph: "▲", title: "War Profiteer", name: "War Profiteer", desc: "Earn three million C-bills in contract pay.", goal: 3000000, flavor: "Three million C-bills earned the hard way. The merc trade, it turns out, pays.", metric: (c) => almanacStats(c).payout },
    { id: "bigscore", cat: "Finance", glyph: "✦", name: "The Big Score", desc: "Take a single contract worth 300k C-bills.", goal: 300000, flavor: "One contract, a small fortune. Drinks are on the house at the DropShip bar tonight.", metric: (c) => bestContractPay(c) },
    { id: "fullbay", cat: "Logistics", glyph: "☖", name: "Full Mechbay", desc: "Field eight operational machines at once.", goal: 8, flavor: "Eight battlemechs parked in a row, all combat-ready. Few sights are finer.", metric: (c) => (c.units || []).filter((u) => u.status !== "destroyed").length },
    { id: "scavenger", cat: "Logistics", glyph: "⚒", title: "Scavenger Lord", name: "Scavenger Lord", desc: "Recover twenty pieces of salvage from the field.", goal: 20, flavor: "Nothing goes to waste — twenty tons of battlefield scrap turned into profit.", metric: (c) => (c.stats || {}).salvageTaken || 0 },
    { id: "newera", cat: "Campaign", glyph: "◍", title: "Timeline Traveler", name: "New Era", desc: "Fight on into a new era of the timeline.", goal: 1, flavor: "The company has outlived its own founding era and marched into the next chapter of history.", metric: (c) => c.eraIdx || 0 },
    { id: "rivalslayer", cat: "Campaign", glyph: "⚔", name: "Rival Slayer", desc: "Beat the rival outfit three times.", goal: 3, flavor: "Three times the rival has crossed you, three times they've come off worse. They're learning.", metric: (c) => (c.rival || {}).losses || 0 }
  ];

  function bondPairCount(company) {
    const seen = {};
    let n = 0;
    for (const p of company.people || []) {
      for (const b of p.bonds || []) {
        if (b.type === "rival" || !b.otherId) continue;
        const key = [p.id, b.otherId].sort().join("|");
        if (seen[key]) continue;
        seen[key] = true; n++;
      }
    }
    return n;
  }
  function peakFunds(company) {
    let m = company.funds || 0;
    for (const h of company.history || []) if (h.funds > m) m = h.funds;
    return m;
  }
  function maxRep(company) {
    let m = -99;
    for (const k in company.rep || {}) m = Math.max(m, company.rep[k] || 0);
    return m;
  }
  function bestContractPay(company) {
    return (company.contractHistory || []).reduce((m, r) => Math.max(m, r.pay || 0), 0);
  }
  function achievementProgress(company, a) {
    let value = 0;
    try { value = a.metric(company) || 0; } catch (e) { value = 0; }
    value = Math.max(0, value);
    const goal = a.goal || 1;
    const unlocked = !!(company.achievements && company.achievements[a.id]);
    return { value, goal, unlocked, ratio: unlocked ? 1 : Math.max(0, Math.min(1, value / goal)) };
  }
  function achievementsSummary(company) {
    const rows = ACHIEVEMENTS.map((a) => ({ a, p: achievementProgress(company, a) }));
    const unlocked = rows.filter((r) => r.p.unlocked);
    const locked = rows.filter((r) => !r.p.unlocked);
    const recent = unlocked.slice().sort((x, y) => ((company.achievements[y.a.id] || {}).week || 0) - ((company.achievements[x.a.id] || {}).week || 0)).slice(0, 5);
    const next = locked.filter((r) => r.p.ratio > 0).sort((x, y) => y.p.ratio - x.p.ratio).slice(0, 3);
    return { total: ACHIEVEMENTS.length, unlocked, locked, recent, next, titles: (company.titles || []).slice() };
  }
  function checkAchievements(company) {
    if (!company.achievements || typeof company.achievements !== "object" || Array.isArray(company.achievements)) company.achievements = {};
    if (!Array.isArray(company.titles)) company.titles = [];
    const newly = [];
    for (const a of ACHIEVEMENTS) {
      if (company.achievements[a.id]) continue;
      let value = 0;
      try { value = a.metric(company) || 0; } catch (e) { value = 0; }
      if (value >= a.goal) {
        company.achievements[a.id] = { week: company.week || 0 };
        if (a.title && company.titles.indexOf(a.title) < 0) company.titles.push(a.title);
        if (!Array.isArray(company.log)) company.log = [];
        company.log.unshift({ week: company.week || 0, text: "Milestone unlocked — " + a.name + (a.title ? " · title “" + a.title + "”" : "") });
        if (company.log.length > 60) company.log.length = 60;
        newly.push(a);
      }
    }
    return newly;
  }

  const ARENA_CLASSES = [
    { key: "light", name: "Light Circuit", glyph: "▲", purseK: 1, powerK: 1, desc: "Fast, cheap and vicious — the entry rung of the Games." },
    { key: "medium", name: "Medium Circuit", glyph: "◆", purseK: 1.5, powerK: 1.4, desc: "The workhorse division where most arena careers are made." },
    { key: "heavy", name: "Heavy Circuit", glyph: "■", purseK: 2.2, powerK: 1.9, desc: "Big guns and thicker hides — the crowd's favourite weight." },
    { key: "assault", name: "Assault Circuit", glyph: "★", purseK: 3.2, powerK: 2.5, desc: "The heavyweight championship of Solaris VII." }
  ];
  const ARENA_VENUES = [
    { id: "factory", name: "The Factory", glyph: "⚙", fameReq: 0, purseMult: 1, powerMult: 1, desc: "A converted industrial complex on the Solaris backstreets — sweat, sparks and no cameras." },
    { id: "boreal", name: "Boreal Reach", glyph: "❄", fameReq: 20, purseMult: 1.2, powerMult: 1.12, desc: "A refrigerated arena of ice and steam; heat management wins or loses fights here." },
    { id: "reaches", name: "The Reaches", glyph: "☢", fameReq: 45, purseMult: 1.45, powerMult: 1.28, desc: "A labyrinth of tunnels and deadfalls where ambush is a way of life." },
    { id: "ishiyama", name: "Ishiyama", glyph: "⛩", fameReq: 75, purseMult: 1.75, powerMult: 1.5, desc: "The Draconis Combine's fortress arena — a mountain of traps and honour." },
    { id: "coliseum", name: "Steiner Coliseum", glyph: "♛", fameReq: 120, purseMult: 2.1, powerMult: 1.75, desc: "The grandest stage on Solaris VII — championship grounds, and the purse to match." }
  ];
  const ARENA_SPONSORS = [
    { id: "none", name: "No sponsor", glyph: "—", fameReq: 0, weekly: 0, winFame: 0, desc: "Fight for the purse alone — every C-bill is earned in the ring." },
    { id: "defiance", name: "Defiance Industries", glyph: "⚙", fameReq: 15, weekly: 14000, winFame: 1, desc: "Lyran arms money — a steady stipend and a little reflected glory." },
    { id: "cavalry", name: "Cavalry Securities", glyph: "☄", fameReq: 40, weekly: 32000, winFame: 1, desc: "A mercenary underwriter that advertises through your victories." },
    { id: "comstar", name: "ComStar Media", glyph: "☸", fameReq: 80, weekly: 65000, winFame: 1, desc: "The Order broadcasts your bouts across the HPG net — and pays for the privilege." },
    { id: "starlight", name: "Starlight Broadcasting", glyph: "★", fameReq: 140, weekly: 110000, winFame: 1, desc: "Interstellar sports media makes you a household name and a very rich one." }
  ];
  const ARENA_UPGRADES = [
    { key: "harness", name: "Pilot Harness Bay", glyph: "⛨", cost: 130000, desc: "Crash couches and gel restraints — gladiators are far less likely to be hurt.", effects: { injuryMult: 0.6 } },
    { key: "medbay", name: "Stable Med-bay", glyph: "✚", cost: 95000, desc: "A proper infirmary: wounded gladiators heal twice as fast between bouts.", effects: { heal: 2 } },
    { key: "cradle", name: "Repair Cradle", glyph: "⚒", cost: 150000, desc: "A dedicated tech bay — after-bout repairs cost half as much.", effects: { repairMult: 0.5 } },
    { key: "publicist", name: "Publicity Office", glyph: "✦", cost: 120000, desc: "A press agent keeps your name in the feeds — every win earns more fame.", effects: { fameMult: 1.5 } },
    { key: "barracks", name: "Expanded Quarters", glyph: "⌂", cost: 170000, desc: "Room to stable one more gladiator and sign one more pilot.", effects: { cap: 1 } },
    { key: "suite", name: "Corporate Suite", glyph: "₡", cost: 210000, desc: "Hospitality for the money men — sponsor stipends rise by half.", effects: { stipend: 1.5 } }
  ];
  const ARENA_RANKS = [
    { fame: 0, name: "Unknown", glyph: "·" },
    { fame: 15, name: "Contender", glyph: "◇" },
    { fame: 40, name: "Crowd Favourite", glyph: "◆" },
    { fame: 75, name: "Ranked", glyph: "◈" },
    { fame: 120, name: "Arena Star", glyph: "★" },
    { fame: 180, name: "Solaris Champion", glyph: "♛" }
  ];
  function arenaClass(key) { return ARENA_CLASSES.find((c) => c.key === key) || ARENA_CLASSES[0]; }
  function arenaVenue(id) { return ARENA_VENUES.find((v) => v.id === id) || ARENA_VENUES[0]; }
  function arenaUpgrade(key) { return ARENA_UPGRADES.find((u) => u.key === key); }
  function arenaSponsorDef(id) { return ARENA_SPONSORS.find((s) => s.id === id) || ARENA_SPONSORS[0]; }
  function arenaRank(stable) { let r = ARENA_RANKS[0]; for (const x of ARENA_RANKS) if ((stable.fame || 0) >= x.fame) r = x; return r; }
  function arenaSponsor(stable) { return arenaSponsorDef(stable.sponsor); }
  function arenaUpgradeOwned(stable, key) { return !!(stable.upgrades && stable.upgrades[key]); }
  function arenaCap(stable) { return 6 + (arenaUpgradeOwned(stable, "barracks") ? 1 : 0) + (arenaUpgradeOwned(stable, "suite") ? 1 : 0); }
  function arenaLiveUnits(stable) { return (stable.units || []).filter((u) => u.status !== "destroyed"); }
  function arenaReady(stable, cls) {
    return arenaLiveUnits(stable).filter((u) => {
      if (cls && u.cls !== cls) return false;
      if (u.crippled || hpPct(u) <= 0.3) return false;
      const p = u.pilotId ? findPerson(stable, u.pilotId) : null;
      return p && p.status === "active";
    });
  }

  function newStable(opts) {
    opts = opts || {};
    const stable = {
      schema: 1, isStable: true, createdAt: Date.now(),
      name: opts.name || "The Blood Circus", callsign: (opts.callsign || "BLOOD").toUpperCase().slice(0, 12),
      eraIdx: clamp(opts.eraIdx !== undefined ? opts.eraIdx : 0, 0, D.ERAS.length - 1),
      week: 1, funds: 0, fame: 0,
      difficulty: { key: "regular", label: "Regular", bonus: 0, repairMult: 1, injuryMult: 1, upkeepMult: 1 },
      nextIds: { person: 1, unit: 1 },
      people: [], units: [], partsInv: {}, supplies: { repair: 12 },
      upgrades: {}, sponsor: "none", bouts: [], boutsWeek: 0, market: null, marketWeek: 0,
      record: { bouts: 0, wins: 0, losses: 0, streak: 0, bestStreak: 0, kills: 0 },
      circuits: { light: 0, medium: 0, heavy: 0, assault: 0 },
      purseTotal: 0, famePeak: 0, log: [], history: []
    };
    stable.funds = isFinite(opts.funds) ? opts.funds : 300000;
    const pool = D.MECHS.filter((m) => m.eraMin <= stable.eraIdx);
    const wantCls = opts.cls || "light";
    const clsPool = pool.filter((m) => m.cls === wantCls);
    const m = pick(clsPool.length ? clsPool : pool);
    const unit = genUnit(stable, m.id, { condition: 0.94 });
    const gladiator = genPerson(stable, "pilot");
    gladiator.unitId = unit.id; unit.pilotId = gladiator.id;
    stable.units.push(unit); stable.people.push(gladiator);
    const lightPool = pool.filter((x) => x.cls === "light");
    const spare = pick(lightPool.length ? lightPool : pool);
    const spareUnit = genUnit(stable, spare.id, { condition: 0.85 });
    const sparePilot = genPerson(stable, "pilot");
    sparePilot.unitId = spareUnit.id; spareUnit.pilotId = sparePilot.id;
    stable.units.push(spareUnit); stable.people.push(sparePilot);
    const tech = genPerson(stable, "tech");
    tech.skill = Math.max(tech.skill || 0, 6);
    tech.salary = calcSalary(tech);
    stable.people.push(tech);
    refreshArenaMarket(stable);
    refreshBouts(stable);
    stable.log.unshift({ week: 1, text: "Stable founded at " + stable.name + " — two gladiators under contract." });
    return stable;
  }

  function refreshArenaMarket(stable) {
    const pool = D.MECHS.filter((m) => m.eraMin <= stable.eraIdx);
    const mechs = [];
    const order = ["light", "light", "medium", "heavy"];
    for (let i = 0; i < order.length; i++) {
      const clsPool = pool.filter((m) => m.cls === order[i]);
      const m = pick(clsPool.length ? clsPool : pool);
      const cond = rnd(0.6, 0.98);
      mechs.push({ id: "am" + i, chassisId: m.id, clsKey: m.cls, cond: cond, price: Math.round(m.cost * (0.06 + cond * 0.1) * rnd(0.9, 1.1) / 1000) * 1000 });
    }
    const pilots = [];
    for (let i = 0; i < 3; i++) {
      const p = genPerson(stable, "pilot");
      p.fee = Math.round((1400 + (7 - p.gunnery) * 1100 + (7 - p.piloting) * 600) * rnd(0.9, 1.2) / 100) * 100;
      pilots.push(p);
    }
    stable.market = { week: stable.week, mechs: mechs, pilots: pilots };
    stable.marketWeek = stable.week;
  }

  function refreshBouts(stable) {
    const bouts = [];
    const unlocked = ARENA_VENUES.filter((v) => (stable.fame || 0) >= v.fameReq);
    const usable = unlocked.length ? unlocked : [ARENA_VENUES[0]];
    const classes = ARENA_CLASSES.filter((c) => arenaLiveUnits(stable).some((u) => u.cls === c.key));
    let n = 0;
    for (const cls of classes) {
      const venue = pickW(usable, (v) => 1 + v.fameReq / 25);
      const sample = pick(D.MECHS.filter((m) => m.eraMin <= stable.eraIdx && m.cls === cls.key));
      const base = sample ? mechPowerFor(sample.id) : 60;
      const power = Math.max(20, Math.round(base * cls.powerK * venue.powerMult * (1 + Math.min(stable.fame || 0, 200) * 0.0012) * rnd(0.86, 1.14)));
      const pursed = (sample ? sample.cost : 1800000) * 0.055 * cls.purseK * venue.purseMult * rnd(0.9, 1.1);
      const fameGain = Math.max(1, Math.round((2 + venue.fameReq / 12) * rnd(0.8, 1.2)));
      bouts.push({
        id: "bo" + stable.week + "-" + (n++),
        classKey: cls.key, className: cls.name, venueId: venue.id, venueName: venue.name, venueGlyph: venue.glyph, venueFameReq: venue.fameReq,
        opponent: pick(D.FIRST) + " " + pick(D.LAST), opponentCall: pick(D.CALLSIGNS), opponentMech: sample ? sample.name : "Unknown",
        power: power, purse: Math.round(pursed / 500) * 500, fameGain: fameGain
      });
    }
    stable.bouts = bouts;
    stable.boutsWeek = stable.week;
  }

  function damageArenaUnit(unit, pct, wrecked) {
    if (wrecked) {
      for (const l of D.LOCS) { unit.armor[l].cur = 0; unit.structure[l].cur = 0; }
      for (const w of unit.weapons) w.state = "destroyed";
      for (const c of COMPONENTS) unit.components[c] = "destroyed";
      unit.crippled = true;
      return;
    }
    let budget = Math.round(maxHp(unit) * pct);
    const locs = D.LOCS.slice().sort(() => Math.random() - 0.5);
    for (const l of locs) {
      if (budget <= 0) break;
      const takeA = Math.min(unit.armor[l].cur, budget);
      unit.armor[l].cur -= takeA; budget -= takeA;
      if (budget <= 0) break;
      const takeS = Math.min(unit.structure[l].cur, budget);
      unit.structure[l].cur -= takeS; budget -= takeS;
    }
    const okW = unit.weapons.filter((w) => w.state === "ok");
    if (okW.length && pct > 0.35 && chance(pct * 0.9)) pick(okW).state = "destroyed";
    if (pct > 0.5 && chance(pct * 0.5)) unit.components[pick(COMPONENTS)] = chance(0.5) ? "damaged" : "destroyed";
    if (hpPct(unit) <= 0.3) unit.crippled = true;
  }

  function arenaBout(stable, boutId, gladiatorId) {
    const bout = (stable.bouts || []).find((b) => b.id === boutId);
    if (!bout) return { error: "nobout" };
    const unit = findUnit(stable, gladiatorId);
    if (!unit) return { error: "nounit" };
    if (unit.status === "destroyed") return { error: "wrecked" };
    if (unit.cls !== bout.classKey) return { error: "class" };
    const pilot = unit.pilotId ? findPerson(stable, unit.pilotId) : null;
    if (!pilot || pilot.status !== "active") return { error: "nopilot" };

    const seed = (Math.random() * 1e9) >>> 0;
    const R = mulberry32(seed);
    const r2 = (a, b) => a + R() * (b - a);
    const ourPower = Math.max(1, Math.round(unitPower(unit, pilot) * (1 + Math.min(stable.fame || 0, 200) * 0.0008)));
    const oppPower = Math.max(1, Math.round(bout.power * r2(0.94, 1.06)));
    const ratio = ourPower / (ourPower + oppPower);
    let hpU = ourPower, hpE = oppPower, round = 0;
    const log = [];
    while (hpU > 0 && hpE > 0 && round < 15) {
      round++;
      if (R() < clamp(ratio * 1.08, 0.28, 0.82)) {
        const dmg = Math.max(1, Math.round(oppPower * r2(0.2, 0.36)));
        hpE -= dmg;
        log.push({ round: round, side: "us", text: (R() < 0.12 ? "Critical hit — " : "") + pilot.callsign + " hits " + bout.opponentCall + " for " + dmg + (hpE <= 0 ? " and the machine buckles." : ".") });
      } else if (R() < 0.5) {
        log.push({ round: round, side: "us", text: pilot.callsign + " trades fire but the shots go wide." });
      }
      if (hpE > 0 && R() < clamp((1 - ratio) * 1.08, 0.28, 0.82)) {
        const dmg = Math.max(1, Math.round(ourPower * r2(0.18, 0.34)));
        hpU -= dmg;
        log.push({ round: round, side: "enemy", text: bout.opponentCall + "'s " + (bout.opponentMech.split(" ")[0] || "machine") + " lands " + dmg + " on the " + (unit.name.split(" ")[0]) + (hpU <= 0 ? " — systems fail." : ".") });
      }
      if (hpU > 0 && hpE > 0 && R() < 0.22) log.push({ round: round, side: "crowd", text: pick(["The crowd roars as armour spalls across the arena floor.", "Heat warnings flare in both cockpits.", "A spotlight tracks the pair around a pillar of rubble.", "The announcer calls the exchange for the feeds."]) });
    }
    let outcome;
    if (hpE <= 0 && hpU > 0) outcome = "victory";
    else if (hpU <= 0) outcome = "defeat";
    else outcome = hpU / ourPower >= hpE / oppPower ? "victory" : "defeat";
    const win = outcome === "victory";
    const machineLost = hpU <= 0;
    const injuryMult = (arenaUpgradeOwned(stable, "harness") ? 0.6 : 1) * (stable.difficulty.injuryMult || 1);
    let damagePct = win ? r2(0.08, 0.32) : r2(0.32, 0.7);
    if (machineLost) damagePct = 1;
    damagePct = clamp(damagePct, 0.05, 1);
    const hurt = machineLost || R() < clamp(damagePct * 0.4 * injuryMult + (win ? 0 : 0.08), 0, 0.72);
    const fameMult = arenaUpgradeOwned(stable, "publicist") ? 1.5 : 1;
    const purse = win ? bout.purse : Math.round(bout.purse * 0.25 / 100) * 100;
    const fameGain = win ? Math.round(bout.fameGain * fameMult) : 0;
    const quote = voiceLine(pilot, win ? "victory" : machineLost ? "loss" : "defeat", { enemyMech: bout.opponentMech });
    return {
      error: null, seed: seed, bout: bout, unitId: unit.id, pilotId: pilot.id, pilotCall: pilot.callsign, unitName: unit.name,
      outcome: outcome, outcomeLabel: win ? "Victory" : "Defeat", ourPower: ourPower, oppPower: oppPower,
      rounds: round, log: log, damagePct: damagePct, machineLost: machineLost, injured: hurt,
      purse: purse, fameGain: fameGain, quote: quote, win: win
    };
  }

  function applyBout(stable, result) {
    const bout = result.bout;
    const unit = findUnit(stable, result.unitId);
    if (!unit) return { error: "nounit" };
    const pilot = result.pilotId ? findPerson(stable, result.pilotId) : null;
    const win = result.outcome === "victory";
    damageArenaUnit(unit, result.damagePct, result.machineLost);
    if (result.machineLost) unit.status = "destroyed";
    if (pilot) {
      if (result.machineLost) { pilot.status = "injured"; pilot.injuredWeeks = ri(1, 3); }
      else if (result.injured) { pilot.status = "injured"; pilot.injuredWeeks = ri(1, 2); }
      const fat = 12 + result.rounds * 1.5 + (result.machineLost ? 10 : 0);
      pilot.fatigue = clamp(Math.round((isFinite(pilot.fatigue) ? pilot.fatigue : 0) + fat), 0, 100);
      const xp = 2 + result.rounds + (win ? 3 : 0);
      pilot.xp = (isFinite(pilot.xp) ? pilot.xp : 0) + xp;
      pilot.xpTotal = (isFinite(pilot.xpTotal) ? pilot.xpTotal : 0) + xp;
      while (pilot.xp >= SKILL_XP) {
        pilot.xp -= SKILL_XP;
        if (pilot.gunnery > 0 && (pilot.piloting <= 0 || chance(0.5))) pilot.gunnery--;
        else if (pilot.piloting > 0) pilot.piloting--;
      }
      pilot.salary = calcSalary(pilot);
      const svc = careerOf(pilot);
      svc.drops++; svc.missions++;
      if (win) { svc.victories++; svc.kills++; } else svc.defeats++;
      if (result.injured || result.machineLost) svc.wounds++;
      logService(stable, pilot, "Arena bout at " + bout.venueName + " vs " + bout.opponent + " — " + result.outcomeLabel + (result.machineLost ? " · machine destroyed" : ""), win ? "win" : "loss");
    }
    const rec = stable.record;
    rec.bouts++;
    if (win) { rec.wins++; rec.streak = (rec.streak || 0) + 1; rec.kills++; } else { rec.losses++; rec.streak = 0; }
    rec.bestStreak = Math.max(rec.bestStreak || 0, rec.streak);
    if (win) stable.circuits[bout.classKey] = (stable.circuits[bout.classKey] || 0) + 1;
    stable.funds += result.purse;
    stable.purseTotal = (stable.purseTotal || 0) + result.purse;
    stable.fame = Math.max(0, (stable.fame || 0) + (result.fameGain || 0));
    const sp = arenaSponsor(stable);
    if (win && sp.winFame) stable.fame += sp.winFame;
    stable.famePeak = Math.max(stable.famePeak || 0, stable.fame);
    stable.bouts = (stable.bouts || []).filter((b) => b.id !== bout.id);
    stable.history.unshift({
      week: stable.week, venue: bout.venueName, className: bout.className, opponent: bout.opponent,
      opponentMech: bout.opponentMech, gladiator: pilot ? pilot.callsign : unit.name, unitName: unit.name,
      outcome: result.outcome, outcomeLabel: result.outcomeLabel, purse: result.purse, fame: result.fameGain,
      rounds: result.rounds, machineLost: !!result.machineLost, injured: !!(result.injured || result.machineLost)
    });
    if (stable.history.length > 80) stable.history.length = 80;
    stable.log.unshift({ week: stable.week, text: (pilot ? pilot.callsign : unit.name) + (win ? " wins at " : " loses at ") + bout.venueName + " against " + bout.opponent + " — " + Math.round(result.purse / 1000) + "k purse" + (result.machineLost ? ", machine destroyed" : result.injured ? ", pilot injured" : "") });
    if (stable.log.length > 60) stable.log.length = 60;
    return { error: null, purse: result.purse, fameGain: (result.fameGain || 0) + (win && sp.winFame ? sp.winFame : 0), win: win };
  }

  function arenaRepairCost(stable, unit) {
    const est = repairEstimate(unit, stable);
    const mult = arenaUpgradeOwned(stable, "cradle") ? 0.5 : 1;
    return Math.round(est.cost * mult / 100) * 100;
  }
  function arenaRepair(stable, unitId) {
    const u = findUnit(stable, unitId);
    if (!u) return { error: "notfound" };
    const cd = componentDamage(u);
    const damaged = u.status === "destroyed" || hpPct(u) < 0.999 || u.weapons.some((w) => w.state !== "ok") || cd.damaged || cd.destroyed;
    if (!damaged) return { error: "nodamage" };
    const cost = arenaRepairCost(stable, u);
    if (stable.funds < cost) return { error: "funds", cost: cost };
    stable.funds -= cost;
    fixUnit(u);
    u.status = "ok";
    stable.log.unshift({ week: stable.week, text: "Repaired " + u.name + " for " + Math.round(cost / 1000) + "k C-bills." });
    if (stable.log.length > 60) stable.log.length = 60;
    return { error: null, cost: cost, unit: u };
  }
  function arenaBuyUpgrade(stable, key) {
    const up = arenaUpgrade(key);
    if (!up) return { error: "notfound" };
    if (arenaUpgradeOwned(stable, key)) return { error: "owned" };
    if (stable.funds < up.cost) return { error: "funds", cost: up.cost };
    stable.funds -= up.cost;
    stable.upgrades[key] = true;
    stable.log.unshift({ week: stable.week, text: "Installed " + up.name + " for " + Math.round(up.cost / 1000) + "k C-bills." });
    if (stable.log.length > 60) stable.log.length = 60;
    return { error: null, upgrade: up };
  }
  function arenaSetSponsor(stable, id) {
    const sp = arenaSponsorDef(id);
    if (!sp) return { error: "notfound" };
    if ((stable.fame || 0) < sp.fameReq) return { error: "fame", need: sp.fameReq };
    stable.sponsor = sp.id;
    stable.log.unshift({ week: stable.week, text: sp.id === "none" ? "Sponsorship ended." : "Signed a sponsorship with " + sp.name + "." });
    if (stable.log.length > 60) stable.log.length = 60;
    return { error: null, sponsor: sp };
  }
  function arenaBuyMech(stable, itemId) {
    const market = stable.market;
    if (!market) return { error: "nomarket" };
    const item = market.mechs.find((m) => m.id === itemId);
    if (!item) return { error: "notfound" };
    if (arenaLiveUnits(stable).length >= arenaCap(stable)) return { error: "cap" };
    if (stable.funds < item.price) return { error: "funds", cost: item.price };
    stable.funds -= item.price;
    const unit = genUnit(stable, item.chassisId, { condition: item.cond, origin: "market" });
    stable.units.push(unit);
    market.mechs = market.mechs.filter((m) => m.id !== itemId);
    stable.log.unshift({ week: stable.week, text: "Bought " + unit.name + " for " + Math.round(item.price / 1000) + "k C-bills." });
    if (stable.log.length > 60) stable.log.length = 60;
    return { error: null, unit: unit, cost: item.price };
  }
  function arenaHirePilot(stable, pilotId) {
    const market = stable.market;
    if (!market) return { error: "nomarket" };
    const p = market.pilots.find((x) => x.id === pilotId);
    if (!p) return { error: "notfound" };
    if ((stable.people || []).filter((x) => x.role === "pilot").length >= arenaCap(stable)) return { error: "cap" };
    if (stable.funds < p.fee) return { error: "funds", cost: p.fee };
    stable.funds -= p.fee;
    market.pilots = market.pilots.filter((x) => x.id !== pilotId);
    stable.people.push(p);
    stable.log.unshift({ week: stable.week, text: "Signed gladiator " + p.callsign + " for " + Math.round(p.fee / 1000) + "k C-bills." });
    if (stable.log.length > 60) stable.log.length = 60;
    return { error: null, person: p, cost: p.fee };
  }
  function arenaUnitValue(stable, unit) {
    const base = D.MECH_MAP[unit.chassisId] ? D.MECH_MAP[unit.chassisId].cost : 1000000;
    return Math.max(0, Math.round(base * (0.05 + 0.1 * hpPct(unit)) / 1000) * 1000);
  }
  function arenaSellUnit(stable, unitId) {
    const u = findUnit(stable, unitId);
    if (!u) return { error: "notfound" };
    if (arenaLiveUnits(stable).length <= 1 && u.status !== "destroyed") return { error: "last" };
    const val = arenaUnitValue(stable, u);
    stable.units = stable.units.filter((x) => x.id !== unitId);
    if (u.pilotId) { const p = findPerson(stable, u.pilotId); if (p) p.unitId = null; }
    stable.funds += val;
    stable.log.unshift({ week: stable.week, text: "Sold " + u.name + " for " + Math.round(val / 1000) + "k C-bills." });
    if (stable.log.length > 60) stable.log.length = 60;
    return { error: null, value: val };
  }
  function arenaWeek(stable) {
    stable.week++;
    const sp = arenaSponsor(stable);
    let stipend = sp.weekly || 0;
    if (stipend && arenaUpgradeOwned(stable, "suite")) stipend = Math.round(stipend * 1.5 / 100) * 100;
    let upkeep = 0;
    for (const u of stable.units) upkeep += Math.round(220 + u.ton * 16);
    upkeep = Math.round(upkeep * (stable.difficulty.upkeepMult || 1));
    stable.funds += stipend - upkeep;
    const heal = arenaUpgradeOwned(stable, "medbay") ? 2 : 1;
    let healed = 0;
    for (const p of stable.people) {
      if (p.status === "injured") { p.injuredWeeks -= heal; if (p.injuredWeeks <= 0) { p.status = "active"; p.injuredWeeks = 0; healed++; } }
      p.fatigue = clamp(Math.round((p.fatigue || 0) - 22), 0, 100);
    }
    stable.fame = Math.max(0, (stable.fame || 0) - 1);
    let forced = null;
    if (stable.funds < 0) {
      const candidates = arenaLiveUnits(stable).sort((a, b) => arenaUnitValue(stable, a) - arenaUnitValue(stable, b));
      for (const u of candidates) {
        if (stable.funds >= 0) break;
        const val = arenaUnitValue(stable, u);
        stable.funds += val;
        forced = u.name;
        if (u.pilotId) { const p = findPerson(stable, u.pilotId); if (p) p.unitId = null; }
        stable.units = stable.units.filter((x) => x.id !== u.id);
        stable.log.unshift({ week: stable.week, text: "Debts forced the sale of " + u.name + " for " + Math.round(val / 1000) + "k C-bills." });
      }
    }
    refreshArenaMarket(stable);
    refreshBouts(stable);
    if (stable.log.length > 60) stable.log.length = 60;
    return { stipend: stipend, upkeep: upkeep, healed: healed, forced: forced };
  }

  window.MGM = {
    BAL, TRAITS, TRAIT_LIST, COMPONENTS, COMP_INFO, componentDamage, D, mulberry32, hashStr, clamp, pick, rnd, ri, chance,
    voiceLine, banterLines, barracksBanter, eventVoice, genPerson, calcSalary, findPerson, findUnit, findBonds, bondLabel, BOND_TYPES,
    bondBetween, bondStrength, lanceBonds, evolveBonds,
    SKILL_XP, injuryPenalty, effGunnery, effPiloting, fatiguePenalty, pilotTier, xpInfo,
    careerOf, careerStats, logService, SERVICE_KEYS,
    weeklyPayroll, weeklyUpkeep, overheadBreakdown, upkeepBreakdown, totalWeeklyBurn, logTx, ledgerSummary, logisticsSummary,
    newCompany, genUnit, unitPower, mechPowerFor, sumWeaponDmg, hpPct, armorPct, missingArmor,
    DIFFICULTIES, difficultyByKey, difficultyTable,
    HEAT_PER_DMG, weaponHeat, weaponAmmo, heatDissipation, heatCapacity, ordnanceProfile,
    ROLE_INFO, mechRole, lanceComposition,
    sanitizeCompany,
    companyRating, eraOf, eraFactions, eraMechPool, eraWeaponPool, factionById, repLabel, repTier, REP_TIERS, standingDiscount, merchantFor,
    refreshMarket, refreshOffers, battle, applyBattle, battlePayout, repairEstimate,
    startRepair, cancelRepair, sellUnit, fixUnit, buyMarketItem, sellPartStock,
    repairSupplyNeed, repairWeaponsNeeded, repairReadiness, repairBays, repairQuality, completeRepair,
    supplyPrice, buySupplies,
    salvageIndexOf, salvageBaseValue, salvageInstantValue, salvageListQuote, listSalvage, cancelSalvageListing, processSalvageListings,
    unitSellValue, repairWeeksLeft,
    hirePerson, firePerson, assignPilot, installPart, stripWeapon,
    HARDPOINT_LOCS, HARDPOINT_NAMES, HARDPOINT_SLOTS, weaponSlots, hardpointMap, hardpointFit, freeHardpoints, installCost, refitPreview, moveWeapon,
    refreshRecruits, hireRecruit, poachTarget, recruitAsking, recruitReputation,
    COURSES, coursesFor, trainingCost, trainingBlocked, startTraining, cancelTraining, finishTraining,
    advanceWeek, takeLoan, repayLoan, bankruptcyCheck,
    recordHistory, almanacStats,
    totalDebt, weeklyDebtService, creditScore, creditLabel, loanOffers, takeCredit, loanPayment, LENDERS,
    refreshInvestments, buyInvestment, sellInvestment, investmentValue, weeklyInvestmentIncome, processInvestments, INVESTMENT_TYPES,
    WORLD_SYSTEMS, worldInit, ensureWorld, worldSystemById, worldHotspots, processWorld, pickOfferSystem, worldControlLabel, factionStr,
    systemDistance, travelQuote, startTravel, processTransit,
    avatarSvg, personAvatar, unitAvatar,
    startCompanyEvents, COMPANY_EVENTS, CACHE_EVENTS, STORY_EVENTS, startStoryEvents, worldOpenFront, worldSeize, relocateCompany,
    makeRival, ensureRival, processRival, resolveRivalContract, rivalRating, rivalTrait, RIVAL_TRAITS, RIVAL_NAMES,
    TERRAINS, TERRAIN_AFFIN, pickTerrainFor, WEATHERS, pickWeather, conditionsFor, energyFrac,
    DOCTRINES, DOCTRINE_LIST, pickDoctrine, doctrineOf, pickEnemyCommander,
    ACHIEVEMENTS, checkAchievements, achievementProgress, achievementsSummary,
    SCENARIOS, scenarioById, scenariosFor,
    ARENA_CLASSES, ARENA_VENUES, ARENA_SPONSORS, ARENA_UPGRADES, ARENA_RANKS,
    arenaClass, arenaVenue, arenaUpgrade, arenaSponsorDef, arenaRank, arenaSponsor, arenaUpgradeOwned, arenaCap, arenaLiveUnits, arenaReady,
    newStable, refreshArenaMarket, refreshBouts, arenaBout, applyBout,
    arenaRepairCost, arenaRepair, arenaBuyUpgrade, arenaSetSponsor, arenaBuyMech, arenaHirePilot, arenaSellUnit, arenaUnitValue, arenaWeek,
    availPilots: (company) => company.people.filter((p) => p.role === "pilot" && p.status === "active"),
    availUnits: (company) => company.units.filter((u) => u.status === "ok"),
    availUnitsWithPilots: (company) => company.units.filter((u) => u.status === "ok" && u.pilotId && findPerson(company, u.pilotId) && findPerson(company, u.pilotId).status === "active")
  };
})();
