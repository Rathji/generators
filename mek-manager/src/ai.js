(function () {
  "use strict";
  const M = window.MGM;
  const BT = window.BT || { esc: (s) => String(s) };

  function battSummary(battle) {
    const ls = [];
    for (const l of battle.log) {
      if (l.type === "kill" || l.type === "quote" || l.type === "end" || l.type === "component" || l.type === "trait" || l.type === "injury") ls.push(l.text);
    }
    return ls;
  }

  function templateReport(battle, payout) {
    const P = [];
    const o = battle.outcomeLabel;
    P.push("After-action report — " + battle.missionName + " on " + battle.planet + " (" + battle.employer + "). Result: " + o + ".");
    P.push("Contact was made with " + battle.enemyFlavor + " in " + battle.terrain.name + ". The engagement lasted " + battle.rounds + " rounds of sustained combat. Enemy losses: " + battle.enemyLossDesc + ". Friendly losses: " + battle.ourDeadCount + " machine" + (battle.ourDeadCount === 1 ? "" : "s") + " destroyed.");
    const quotes = battle.log.filter((l) => l.type === "quote").slice(0, 3);
    if (quotes.length) {
      P.push("Notable comms traffic: ");
      for (const q of quotes) P.push("\"" + q.text + "\"");
    }
    if (battle.outcome === "victory") {
      P.push("Objectives were secured and the employer's payment is in the account. Salvage crews are already picking over the wrecks.");
    } else if (battle.outcome === "partial") {
      P.push("The contract is only partially fulfilled. We hold the field, but the employer will want a discount.");
    } else {
      P.push("The operation failed. Repairs will be expensive, and the employer is not pleased. We will rebuild and try again.");
    }
    if (payout) P.push("Settlement: " + Math.round(payout.amt / 1000) + "k C-bills received.");
    return P;
  }

  function narrativePrompt(battle, payout) {
    const summary = battSummary(battle).join("\n");
    const lance = battle.lance.map((l) => (l.tag ? l.tag + (l.dead ? " (KIA machine)" : "") : l.unitName)).join(", ");
    const pilotLine = battle.lance.map((l) => {
      const d = l.personDesc ? " — " + l.personDesc : "";
      return l.tag + d + (l.dead ? " [KIA]" : "");
    }).join(" | ");
    return "You are the executive officer of a BattleTech mercenary company, writing the official after-action report for the commander. "
      + "Write in the clipped, professional, slightly weary voice of a veteran mercenary. Cover the mission, how the fight went, losses, "
      + "individual moments of note, and the outcome. Do not invent fake numbers beyond what is given. " + battle.ourPower + " vs " + Math.round(battle.enemyPower) + " estimated combat power."
      + "\n\nMISSION: " + battle.missionName + " on " + battle.planet + "\nEMPLOYER: " + battle.employer + "\nENEMY: " + battle.enemyFlavor + "\nTERRAIN: " + battle.terrain.name + "\nOUTCOME: " + battle.outcomeLabel
      + "\nROUNDS: " + battle.rounds + "\nLANCE: " + lance
      + "\nPILOTS (callsign — background, personality traits, motivation):\n" + pilotLine
      + "\nENEMY LOSSES: " + battle.enemyLossDesc
      + "\nFRIENDLY MACHINES LOST: " + battle.ourDeadCount + "\n\nKEY EVENTS:\n" + summary
      + "\n\nWrite 3 to 5 paragraphs. Include at least one direct quote from a pilot using their callsign.";
  }

  function battleImagePrompt(battle) {
    const mood = battle.outcome === "victory"
      ? "mercenary battlemechs standing victorious amid burning enemy wrecks, smoke columns, dramatic dusk light"
      : battle.outcome === "partial"
        ? "battered mercenary battlemechs withdrawing through smoke, damaged armor glowing, tense atmosphere"
        : "a defeated mercenary battlemech on its knees, a destroyed lance member burning in the background, somber lighting";
    return "BattleTech-style digital painting, no text, no letters, wide cinematic shot of a 'mech battle on the planet " + battle.planet + " in " + battle.terrain.name + " (" + battle.terrain.desc + "), " + mood + ", painterly, gritty military sci-fi, olive-drab and battle-amber palette with smoky haze, high detail, octane render style";
  }

  function hasAI() {
    return !!(window.root && root.generateText && root.generateImage);
  }

  async function generateReport(opts) {
    const { battle, payout, onChunk, forceTemplate } = opts;
    const fallback = templateReport(battle, payout);
    if (forceTemplate || !hasAI()) {
      if (onChunk) onChunk(fallback.join("\n\n"), true);
      return { text: fallback.join("\n\n"), fallback: true };
    }
    try {
      const res = await root.generateText({
        instruction: narrativePrompt(battle, payout),
        onChunk: (d) => { if (onChunk) onChunk(d.fullTextSoFar, false); }
      });
      let txt = String(res.text || "");
      if (txt.trim().length < 80) { txt = fallback.join("\n\n"); }
      return { text: txt, fallback: false };
    } catch (e) {
      console.warn("ai.report fallback:", e);
      const txt = fallback.join("\n\n");
      if (onChunk) onChunk(txt, true);
      return { text: txt, fallback: true };
    }
  }

  async function generateBattleImage(battle) {
    if (!hasAI()) return null;
    try {
      const res = await root.generateImage({
        prompt: battleImagePrompt(battle), resolution: "768x512", hideGalleryButtons: true, negativePrompt: "text, letters, watermark, blurry"
      });
      return typeof res === "string" || (res && res.dataUrl) ? (res.dataUrl || res) : null;
    } catch (e) {
      console.warn("ai.battleImage failed:", e);
      return null;
    }
  }

  /* ---------- AI portraits — one per person, kv-cached, queued ---------- */
  const portraitCache = new Map();
  const _portraitSeen = new Set();
  const _portraitQueue = [];
  let _portraitBusy = false;

  function getPortrait(pid) { return portraitCache.get(pid) || null; }
  function isPortraitQueued(pid) { return _portraitSeen.has(pid); }

  async function preloadPortraits() {
    if (!hasAI() || !window.root || !root.kv) return;
    try {
      const entries = await root.kv.portraits.entries();
      if (Array.isArray(entries)) for (const [k, v] of entries) portraitCache.set(String(k), v);
    } catch (e) { console.warn("ai.preloadPortraits:", e); }
  }

  function cleanPortrait(url) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const w = img.naturalWidth, h = img.naturalHeight;
          const cropH = Math.max(1, Math.round(h * 0.12));
          const c = document.createElement("canvas");
          c.width = w; c.height = h - cropH;
          const ctx = c.getContext("2d");
          ctx.drawImage(img, 0, 0, w, h - cropH, 0, 0, w, h - cropH);
          resolve(c.toDataURL("image/jpeg", 0.88));
        } catch (e) { resolve(url); }
      };
      img.onerror = () => resolve(url);
      img.src = url;
    });
  }

  function portraitPrompt(person) {    const kit = person.role === "pilot"
      ? "wearing a padded cooling vest with a neurohelmet tucked under one arm, cockpit interior softly glowing behind"
      : person.role === "tech"
        ? "in grease-stained olive work overalls with a tool belt and heavy gloves, a towering 'Mech silhouette looming in the hangar behind"
        : "in a crisp military uniform with rank insignia, a briefing room with a tactical holodisplay glowing behind";
    return "BattleTech-style digital painting, head-and-shoulders portrait of a gritty " + (person.gender === "M" ? "male" : "female") + " " + person.role + ", "
      + (person.age || 30) + " years old, " + (person.build || "lean") + " build, " + (person.hair || "short") + " hair, " + (person.feature || "a weathered face")
      + ", callsign \"" + person.callsign + "\", " + kit
      + ", face lit by a holographic display, muted olive and battle-amber palette, painterly, highly detailed, no text";
  }

  async function generatePortrait(person, force) {
    if (!hasAI() || !window.root || !root.kv) return null;
    try {
      if (force) { portraitCache.delete(person.id); try { await root.kv.portraits.delete(person.id); } catch (e) {} }
      const cached = portraitCache.get(person.id);
      if (cached) return cached;
      const res = await root.generateImage({
        prompt: portraitPrompt(person), resolution: "512x512", hideGalleryButtons: true,
        negativePrompt: "text, letters, numbers, watermark, signature, artist name, logo, caption, extra fingers, deformed face, low quality, blurry"
      });
      const raw = res.dataUrl || String(res);
      if (!raw) return null;
      const url = await cleanPortrait(raw);
      portraitCache.set(person.id, url);
      try { await root.kv.portraits.set(person.id, url); } catch (e) { console.warn("ai.portrait persist:", e); }
      return url;
    } catch (e) {
      console.warn("ai.portrait failed:", e);
      return null;
    }
  }

  function forgetPortrait(pid) {
    portraitCache.delete(pid);
    _portraitSeen.delete(pid);
    if (window.root && root.kv) root.kv.portraits.delete(pid).catch(() => {});
  }

  async function clearPortraits() {
    portraitCache.clear();
    _portraitSeen.clear();
    if (window.root && root.kv) { try { await root.kv.portraits.clear(); } catch (e) { console.warn("ai.clearPortraits:", e); } }
  }

  async function _pumpPortraits() {
    if (_portraitBusy) return;
    _portraitBusy = true;
    while (_portraitQueue.length) {
      const item = _portraitQueue.shift();
      let url = null, ok = false;
      try { url = await generatePortrait(item.person, item.force); ok = !!url; }
      catch (e) { console.warn("ai.portrait queue item:", e); }
      _portraitSeen.delete(item.person.id);
      if (item.onDone) { try { item.onDone(item.person.id, url, ok); } catch (e) { console.warn(e); } }
    }
    _portraitBusy = false;
  }

  function queuePortrait(person, onDone, force) {
    if (!person || _portraitSeen.has(person.id)) return false;
    _portraitSeen.add(person.id);
    _portraitQueue.push({ person, onDone, force });
    _pumpPortraits();
    return true;
  }

  function queuePortraitAll(people, onEach) {
    const items = [];
    for (const p of people) if (!_portraitSeen.has(p.id)) items.push(p);
    const total = items.length;
    let done = 0;
    for (const p of items) {
      queuePortrait(p, (pid, url, ok) => {
        done++;
        if (onEach) onEach({ done, total, pid, url, ok });
      });
    }
    return { total, queued: items.length };
  }

  window.BMGA = { templateReport, narrativePrompt, battleImagePrompt, generateReport, generateBattleImage, generatePortrait, preloadPortraits, getPortrait, isPortraitQueued, forgetPortrait, clearPortraits, queuePortrait, queuePortraitAll, hasAI };
})();
