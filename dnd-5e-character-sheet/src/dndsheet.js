(function () {
  'use strict';
  const LS_KEY = 'rf_dnd_char';

  const ABILITIES = [
    { key: 'str', name: 'Strength', abbr: 'STR' },
    { key: 'dex', name: 'Dexterity', abbr: 'DEX' },
    { key: 'con', name: 'Constitution', abbr: 'CON' },
    { key: 'int', name: 'Intelligence', abbr: 'INT' },
    { key: 'wis', name: 'Wisdom', abbr: 'WIS' },
    { key: 'cha', name: 'Charisma', abbr: 'CHA' }
  ];
  const SKILLS = [
    ['acrobatics', 'Acrobatics', 1], ['animal-handling', 'Animal Handling', 4], ['arcana', 'Arcana', 3],
    ['athletics', 'Athletics', 0], ['deception', 'Deception', 5], ['history', 'History', 3],
    ['insight', 'Insight', 4], ['intimidation', 'Intimidation', 5], ['investigation', 'Investigation', 3],
    ['medicine', 'Medicine', 4], ['nature', 'Nature', 3], ['perception', 'Perception', 4],
    ['performance', 'Performance', 5], ['persuasion', 'Persuasion', 5], ['religion', 'Religion', 3],
    ['sleight-of-hand', 'Sleight of Hand', 1], ['stealth', 'Stealth', 1], ['survival', 'Survival', 4]
  ];
  const XP_TABLE = [0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000, 100000, 120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000];
  const ALIGNMENTS = { 1: 'Lawful Good', 2: 'Neutral Good', 3: 'Chaotic Good', 4: 'Lawful Neutral', 5: 'Neutral', 6: 'Chaotic Neutral', 7: 'Lawful Evil', 8: 'Neutral Evil', 9: 'Chaotic Evil' };
  const SAVE_KEYS = ABILITIES.map(a => a.key);
  const SAVE_FULL = { str: 'strength', dex: 'dexterity', con: 'constitution', int: 'intelligence', wis: 'wisdom', cha: 'charisma' };

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function signed(n) { n = Number(n) || 0; return (n >= 0 ? '+' : '') + n; }
  function modOf(score) { return Math.floor((Number(score) - 10) / 2); }
  function stripHtml(s) {
    if (s == null) return '';
    const d = document.createElement('div');
    d.innerHTML = String(s);
    return (d.textContent || '').replace(/\{\{[^}]*\}\}/g, '').replace(/\[(action|items|condition|spell)\](.*?)\[\/\1\]/g, '$2').replace(/\s+/g, ' ').trim();
  }
  function getLS() { try { const v = localStorage.getItem(LS_KEY); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function setLS(c) { try { localStorage.setItem(LS_KEY, JSON.stringify(c)); } catch (e) { console.error('dnd sheet save', e); } }
  function setStatus(msg) { const s = $('dndImportStatus'); if (s) s.textContent = msg || ''; }

  let char = getLS();

  function freshState(char) {
    const st = {};
    st.statOverride = [null, null, null, null, null, null];
    st.saveProf = {}; SAVE_KEYS.forEach(k => st.saveProf[k] = (char.saveProf && char.saveProf[k]) || 0);
    st.skillProf = {}; SKILLS.forEach(sk => st.skillProf[sk[0]] = (char.skillProf && char.skillProf[sk[0]]) || 0);
    st.hpCurrent = char.hp.max - (char.hp.removed || 0);
    st.hpTemp = char.hp.temp;
    st.hitDiceUsed = {}; (char.hitDice || []).forEach(h => st.hitDiceUsed[h.name] = h.used || 0);
    st.spellUsed = {}; Object.keys(char.spellSlots).forEach(l => st.spellUsed[l] = char.spellSlots[l].used || 0);
    st.pactUsed = {}; Object.keys(char.pact).forEach(l => st.pactUsed[l] = char.pact[l].used || 0);
    st.deathSuccess = 0; st.deathFail = 0;
    st.inspiration = !!char.inspiration;
    st.resources = {}; (char.resources || []).forEach(r => st.resources[r.name] = r.max);
    st.alignment = char.alignment || '';
    st.notes = {}; Object.keys(char.notes).forEach(k => st.notes[k] = char.notes[k] || '');
    return st;
  }

  function parseChar(json) {
    const c = json;
    const allMods = ['race', 'class', 'background', 'feat', 'item'].flatMap(s => (c.modifiers && c.modifiers[s]) || []);
    const classes = (c.classes || []).map(cl => ({
      name: (cl.definition && cl.definition.name) || 'Class',
      subclass: cl.subclassDefinition ? cl.subclassDefinition.name : '',
      level: cl.level || 0,
      hitDice: 'd' + ((cl.definition && cl.definition.hitDice) || 8),
      used: cl.hitDiceUsed || 0,
      id: cl.definition && cl.definition.id
    }));
    const level = classes.reduce((s, cl) => s + cl.level, 0);
    const pb = 2 + Math.floor((level - 1) / 4);
    const byId = arr => { const o = {}; (arr || []).forEach(s => o[s.id] = s.value); return o; };
    const base = byId(c.stats), bonus = byId(c.bonusStats), over = byId(c.overrideStats);
    const stats = [1, 2, 3, 4, 5, 6].map(id => over[id] != null ? over[id] : ((base[id] || 10) + (bonus[id] || 0)));
    const mods = stats.map(modOf);

    const profSet = {}, expSet = {};
    allMods.forEach(m => {
      if (m.type === 'proficiency') profSet[String(m.subType).toLowerCase()] = true;
      if (m.type === 'expertise') expSet[String(m.subType).toLowerCase()] = true;
    });
    const saveProf = {};
    SAVE_KEYS.forEach(k => { if (profSet[SAVE_FULL[k] + '-saving-throws']) saveProf[k] = 1; else saveProf[k] = 0; });
    const skillProf = {};
    SKILLS.forEach(sk => { const k = sk[0]; skillProf[k] = expSet[k] ? 2 : (profSet[k] ? 1 : 0); });

    const languages = allMods.filter(m => m.type === 'language').map(m => m.friendlySubtypeName || m.subType).filter(Boolean);
    const otherProfs = allMods
      .filter(m => m.type === 'proficiency' && !SAVE_KEYS.some(k => m.subType === SAVE_FULL[k] + '-saving-throws') && !SKILLS.some(sk => sk[0] === m.subType))
      .map(m => m.friendlySubtypeName || m.subType)
      .concat(allMods.filter(m => m.type === 'monk-weapon').map(m => m.friendlySubtypeName || m.subType))
      .filter(Boolean)
      .filter((v, i, a) => a.findIndex(x => String(x).toLowerCase() === String(v).toLowerCase()) === i);

    const inv = (c.inventory || []).map(it => ({
      name: (it.definition && it.definition.name) || 'Item',
      qty: it.quantity || 1,
      weight: (it.definition && it.definition.weight) || 0,
      equipped: !!it.equipped,
      type: (it.definition && it.definition.type) || '',
      dmg: (it.definition && it.definition.damage) || null,
      properties: ((it.definition && it.definition.properties) || []).map(p => (typeof p === 'string' ? p : p.name || '')),
      isMonkWeapon: !!(it.definition && it.definition.isMonkWeapon),
      range: (it.definition && it.definition.range) || null,
      longRange: (it.definition && it.definition.longRange) || null
    }));

    const isShield = i => /shield/i.test(i.type) || /shield/i.test(i.name);
    const equipped = inv.filter(i => i.equipped);
    const shield = equipped.find(isShield);
    const armor = equipped.find(i => !isShield(i) && i.dmg == null && /armor|leather|padded|studded|hide|chain|scale|breastplate|half|full|ring|splint/i.test(i.type + ' ' + i.name) && /ac|armor|suit/i.test(i.name + i.type));
    const armorCat = tn => /heavy/i.test(tn) ? 'heavy' : (/medium/i.test(tn) ? 'medium' : (/light/i.test(tn) ? 'light' : null));

    let ac;
    const setArmor = allMods.find(m => m.type === 'set' && /armor-class/.test(m.subType));
    const udDef = allMods.find(m => m.type === 'set' && /unarmored-armor-class/.test(m.subType));
    const monk = classes.find(cl => /monk/i.test(cl.name));
    const barb = classes.find(cl => /barbarian/i.test(cl.name));
    if (armor) {
      const acv = (armor.type.match(/\d+/) || [null])[0] || (armor.name.match(/\d+/) || [null])[0];
      const baseAC = acv ? Number(acv) : 10;
      const cat = armorCat(armor.type + ' ' + armor.name);
      let dexAdd = mods[1];
      if (cat === 'medium') dexAdd = Math.min(mods[1], 2);
      if (cat === 'heavy') dexAdd = 0;
      ac = baseAC + dexAdd;
    } else if (udDef) {
      ac = 10 + mods[1] + (monk ? mods[4] : barb ? mods[2] : 0);
    } else if (setArmor && typeof setArmor.value === 'number') {
      ac = setArmor.value + mods[1];
    } else {
      ac = 10 + mods[1];
    }
    if (shield) ac += 2;
    allMods.forEach(m => { if (m.type === 'bonus' && /armor-class/.test(m.subType) && typeof m.value === 'number') ac += m.value; });
    ac = Math.max(1, Math.round(ac));

    let initiative = mods[1];
    let initiativeFlat = 0;
    allMods.forEach(m => {
      if (m.type === 'bonus' && /initiative/.test(m.subType)) {
        if (typeof m.value === 'number') { initiative += m.value; initiativeFlat += m.value; }
        if ((m.bonusTypes || []).some(b => b === 1)) { initiative += pb; initiativeFlat += pb; }
      }
    });

    let speed = 30;
    if (c.race && c.race.weightSpeeds && c.race.weightSpeeds.normal) speed = c.race.weightSpeeds.normal.walk || 30;
    allMods.forEach(m => { if (m.type === 'bonus' && /unarmored-movement/.test(m.subType) && typeof m.value === 'number') speed += m.value; });

    const spells = [];
    const addSpells = arr => (arr || []).forEach(sp => {
      const d = sp.definition || sp || {};
      const comps = (() => {
        if (typeof d.components === 'string') return d.components;
        if (!d.components) return '';
        const p = [];
        if (d.components.verbal) p.push('V');
        if (d.components.somatic) p.push('S');
        if (d.components.material) p.push('M' + (d.components.materialDescription ? ' (' + stripHtml(d.components.materialDescription) + ')' : ''));
        return p.join(', ');
      })();
      const fmt = x => {
        if (x == null) return '';
        if (typeof x === 'object') return [x.value, x.unit].filter(v => v != null).join(' ');
        return String(x);
      };
      const rng = (() => {
        if (d.range == null) return '';
        if (typeof d.range === 'object') {
          if (d.range.range != null && d.range.longRange != null) return d.range.range + '/' + d.range.longRange + ' ft';
          if (d.range.value != null) return [d.range.value, d.range.unit].filter(v => v != null).join(' ');
          if (d.range.aoeType) return d.range.aoeType;
        }
        return String(d.range);
      })();
      spells.push({
        name: d.name || 'Spell',
        level: d.level != null ? d.level : 0,
        school: (d.school && typeof d.school === 'object' ? (d.school.name || '') : d.school) || '',
        cast: fmt(d.castingTime),
        range: rng,
        comps,
        duration: fmt(d.duration),
        ritual: !!d.ritual,
        conc: !!d.concentration,
        desc: stripHtml(d.description),
        prepared: !!sp.prepared,
        alwaysPrepared: !!sp.alwaysPrepared,
        atWill: sp.usesSpellSlot === false
      });
    });
    if (c.spells) { addSpells(c.spells.race); addSpells(c.spells.class); addSpells(c.spells.item); addSpells(c.spells.feat); }
    (c.classSpells || []).forEach(cs => addSpells(cs.spells));

    const spellSlots = {};
    (c.spellSlots || []).forEach(s => { if (s.available) spellSlots[s.level] = { available: s.available, used: s.used || 0 }; });
    const pact = {};
    (c.pactMagic || []).forEach(s => { if (s.available) pact[s.level] = { available: s.available, used: s.used || 0 }; });
    if (!Object.keys(pact).length) {
      const wlvl = classes.reduce((s, cl) => s + (/warlock/i.test(cl.name) ? cl.level : 0), 0);
      if (wlvl > 0) {
        const count = wlvl >= 17 ? 4 : wlvl >= 11 ? 3 : wlvl >= 2 ? 2 : 1;
        const slotLvl = wlvl >= 9 ? 5 : wlvl >= 7 ? 4 : wlvl >= 5 ? 3 : wlvl >= 3 ? 2 : 1;
        pact[slotLvl] = { available: count, used: 0 };
      }
    }

    const features = [];
    const seenFeatures = new Set();
    const pushFeat = (name, desc, source) => {
      if (!name) return;
      const key = name + '|' + source;
      if (seenFeatures.has(key)) return;
      seenFeatures.add(key);
      features.push({ name, desc, source });
    };
    ((c.race && c.race.racialTraits) || []).forEach(t => { const d = t.definition || {}; pushFeat(d.name, stripHtml(d.description), 'Racial'); });
    (c.classes || []).forEach(rawCl => {
      (rawCl.classFeatures || []).forEach(f => {
        const d = f.definition || {};
        if (d.name && !/core .*traits/i.test(d.name)) pushFeat(d.name, stripHtml(d.description), rawCl.definition.name);
      });
      if (rawCl.subclassDefinition) (rawCl.subclassDefinition.classFeatures || []).forEach(f => {
        const d = f.definition || {};
        if (d.name) pushFeat(d.name, stripHtml(d.description), rawCl.subclassDefinition.name);
      });
    });
    if (c.background && c.background.definition) {
      const bgd = c.background.definition;
      if (bgd.featureName) pushFeat(bgd.featureName, stripHtml(bgd.featureDescription || ''), 'Background');
    }
    (c.feats || []).forEach(f => { const d = f.definition || {}; if (d.name) pushFeat(d.name, stripHtml(d.snippet || d.description), 'Feat'); });

    const resources = [];
    const seenRes = new Set();
    (c.classes || []).forEach(rawCl => {
      const clLvl = rawCl.level || 0;
      (rawCl.classFeatures || []).forEach(f => {
        const d = f.definition || {};
        if (!Array.isArray(d.limitedUse) || !d.limitedUse.length) return;
        const entries = d.limitedUse.filter(e => e && e.uses);
        if (!entries.length) return;
        let max = entries[0].uses;
        const byLevel = entries.filter(e => e.level != null);
        const exact = byLevel.find(e => e.level === clLvl);
        if (exact) max = exact.uses;
        else {
          const below = byLevel.filter(e => e.level <= clLvl).sort((a, b) => b.level - a.level)[0];
          if (below) max = below.uses;
          else {
            const nl = entries.filter(e => e.level == null);
            if (nl.length) max = Math.max.apply(null, nl.map(e => e.uses));
          }
        }
        if (max && (byLevel.length || max > 1) && !seenRes.has(d.name)) { seenRes.add(d.name); resources.push({ name: d.name, max }); }
      });
    });
    (c.feats || []).forEach(f => {
      const d = f.definition || {};
      if (Array.isArray(d.limitedUse) && d.limitedUse.length) {
        const max = Math.max.apply(null, d.limitedUse.map(e => (e && e.uses) || 0));
        if (max && max > 1 && !seenRes.has(d.name)) { seenRes.add(d.name); resources.push({ name: d.name, max }); }
      }
    });

    const weightTotal = inv.reduce((s, i) => s + i.qty * i.weight, 0);
    const t = c.traits || {}, n = c.notes || {};
    const notes = {
      personality: t.personalityTraits, ideals: t.ideals, bonds: t.bonds, flaws: t.flaws,
      appearance: t.appearance, backstory: n.backstory, allies: n.allies, enemies: n.enemies,
      orgs: n.organizations, possessions: n.personalPossessions, holdings: n.otherHoldings, other: n.otherNotes
    };
    const deathSaves = c.deathSaves || {};
    const xp = c.currentXp || 0;

    const char = {
      meta: {
        id: c.id, sourceUrl: '', importedAt: Date.now(),
        name: c.name || 'Unnamed', socialName: c.socialName || '',
        avatar: c.avatarUrl || (c.race && c.race.portraitAvatarUrl) || '',
        race: c.race ? (c.race.fullName || c.race.baseName || '') : '',
        background: c.background && c.background.definition ? c.background.definition.name : '',
        level, pb, xp,
        xpToNext: level < 20 ? Math.max(0, XP_TABLE[level] - xp) : null,
        size: c.race ? c.race.size : '',
        alignment: ALIGNMENTS[c.alignmentId] || ''
      },
      identity: {
        gender: c.gender, age: c.age, height: c.height, weight: c.weight,
        hair: c.hair, eyes: c.eyes, skin: c.skin, faith: c.faith
      },
      classes, stats, mods, level, pb,
      ac, initiative, initiativeFlat, speed,
      hp: { max: c.overrideHitPoints != null ? c.overrideHitPoints : (c.baseHitPoints || 0), removed: c.removedHitPoints || 0, temp: c.temporaryHitPoints || 0 },
      hitDice: classes.map(cl => ({ name: cl.name, die: cl.hitDice, total: cl.level, used: cl.used })),
      saveProf, skillProf,
      profs: { languages, other: otherProfs },
      attacks: [],
      spellSlots, pact, spells,
      features, resources,
      inventory: inv.map(i => ({ name: i.name, qty: i.qty, weight: i.weight, equipped: i.equipped, type: i.type })),
      weightTotal, carryMax: stats[0] * 15,
      currencies: c.currencies || { cp: 0, sp: 0, gp: 0, ep: 0, pp: 0 },
      notes, deathSaves,
      inspiration: !!c.inspiration
    };
    char.attacks = buildAttacks(char, inv);
    char.state = freshState(char);
    return char;
  }

  function buildAttacks(ch, inv) {
    const out = [];
    const pb = ch.pb, mods = ch.mods;
    inv.forEach(it => {
      if (!it.dmg || !it.dmg.diceString) return;
      const props = it.properties;
      let abi = 0;
      if (it.isMonkWeapon) abi = 1;
      else if (props.includes('Finesse')) abi = mods[0] >= mods[1] ? 0 : 1;
      else if (it.range != null && it.longRange != null && !props.includes('Thrown')) abi = 1;
      const am = mods[abi];
      out.push({
        name: it.name,
        toHit: pb + am,
        dmg: it.dmg.diceString + (am >= 0 ? ' + ' : ' ') + am,
        dmgType: it.dmg.damageType || '',
        range: it.longRange ? it.range + '/' + it.longRange + ' ft' : '5 ft',
        note: [props.join(', ')].filter(Boolean).join('')
      });
    });
    const monk = ch.classes.find(cl => /monk/i.test(cl.name));
    if (monk) {
      const lvl = monk.level;
      const die = lvl >= 17 ? '1d12' : lvl >= 11 ? '1d10' : lvl >= 5 ? '1d8' : '1d6';
      out.push({
        name: 'Unarmed Strike',
        toHit: pb + mods[1],
        dmg: die + (mods[1] >= 0 ? ' + ' : ' ') + mods[1],
        dmgType: 'Bludgeoning',
        range: '5 ft',
        note: 'Martial arts'
      });
    }
    return out;
  }

  function liveDerive() {
    const st = char.state;
    const stats = char.stats.map((v, i) => st.statOverride[i] != null ? Number(st.statOverride[i]) : v);
    const mods = stats.map(modOf);
    const saves = SAVE_KEYS.map((k, i) => ({
      key: k, name: ABILITIES[i].name, stat: i,
      prof: st.saveProf[k], mod: mods[i] + (st.saveProf[k] ? char.pb * st.saveProf[k] : 0)
    }));
    const skills = SKILLS.map(sk => ({
      key: sk[0], name: sk[1], stat: sk[2],
      prof: st.skillProf[sk[0]], mod: mods[sk[2]] + (st.skillProf[sk[0]] ? char.pb * st.skillProf[sk[0]] : 0)
    }));
    const passive = {
      perception: 10 + skills.find(s => s.key === 'perception').mod,
      insight: 10 + skills.find(s => s.key === 'insight').mod,
      investigation: 10 + skills.find(s => s.key === 'investigation').mod
    };
    const inv = char.inventory.map(it => it);
    const ac = recomputeAC(mods, inv);
    const initiative = mods[1] + (char.initiativeFlat || 0);
    return { stats, mods, saves, skills, passive, ac, initiative };
  }

  function recomputeAC(mods, inv) {
    let base = 10 + mods[1];
    const shield = inv.find(i => i.equipped && /shield/i.test(i.type + i.name));
    const armor = inv.find(i => i.equipped && !/shield/i.test(i.type + i.name) && /armor|leather|padded|studded|hide|chain|scale|breastplate|splint|ring|half|full/i.test(i.type + ' ' + i.name));
    if (armor) {
      const m = (armor.type + ' ' + armor.name).match(/\d+/);
      let baseAC = m ? Number(m[0]) : 10;
      const tn = armor.type + ' ' + armor.name;
      let dexAdd = mods[1];
      if (/heavy/i.test(tn)) dexAdd = 0; else if (/medium/i.test(tn)) dexAdd = Math.min(mods[1], 2);
      base = baseAC + dexAdd;
    } else if (/monk|barbarian/i.test(char.classes.map(c => c.name).join(' '))) {
      base = 10 + mods[1] + (/monk/i.test(char.classes.map(c => c.name).join(' ')) ? mods[4] : mods[2]);
    }
    if (shield) base += 2;
    return Math.max(1, Math.round(base));
  }

  function render() {
    const wrap = $('dndSheet');
    const empty = $('dndEmpty');
    if (!char) { wrap.style.display = 'none'; if (empty) empty.style.display = 'block'; return; }
    if (empty) empty.style.display = 'none';
    wrap.style.display = 'block';
    wrap.className = 'dnd-sheet';
    const L = liveDerive();
    wrap.innerHTML = headHTML() + '<div class="dnd-grid">' +
      colA(L) + colB(L) + colC() +
      '</div>';
  }

  function headHTML() {
    const m = char.meta;
    const st = char.state;
    const avatar = m.avatar
      ? '<img class="dnd-avatar" src="' + esc(m.avatar) + '" alt="" />'
      : '<div class="dnd-monogram">' + esc((m.name || '?').charAt(0).toUpperCase()) + '</div>';
    const classes = char.classes.map(cl => cl.name + (cl.subclass ? ' (' + cl.subclass + ')' : '') + ' ' + cl.level).join(' · ');
    const ident = [char.identity.gender, char.identity.age ? char.identity.age + ' yo' : '', char.identity.height, char.identity.weight, char.identity.hair, char.identity.eyes, char.identity.skin, char.identity.faith].filter(Boolean);
    return '<div class="dnd-head">' + avatar +
      '<div class="dnd-head-info">' +
      '<div class="dnd-head-name">' + esc(m.name) + (m.socialName ? ' <span style="font-size:.55em;color:#9a7abf;">“' + esc(m.socialName) + '”</span>' : '') + '</div>' +
      '<div class="dnd-head-sub">' + esc(classes) + '</div>' +
      '<div class="dnd-head-meta">' +
      (m.race ? '<span><b>Race</b> ' + esc(m.race) + (m.size ? ' · ' + esc(m.size) : '') + '</span>' : '') +
      (m.background ? '<span><b>Background</b> ' + esc(m.background) + '</span>' : '') +
      '<span><b>Alignment</b> <input class="txt-input" style="width:130px;font-size:.9em;padding:.15em .4em;" data-act="align" value="' + esc(st.alignment) + '" /></span>' +
      (m.xp != null ? '<span><b>XP</b> ' + esc(m.xp) + (m.xpToNext != null ? ' · ' + esc(m.xpToNext) + ' to next' : '') + '</span>' : '') +
      (ident.length ? '<span><b>Details</b> ' + esc(ident.join(', ')) + '</span>' : '') +
      '</div></div>' +
      '<div class="dnd-head-side">' +
      '<span class="dnd-badge">Level ' + char.level + '</span>' +
      '<span class="dnd-badge">PB ' + signed(char.pb) + '</span>' +
      '<span class="dnd-insp" data-act="insp" title="Heroic inspiration"><span class="box">' + (st.inspiration ? '★' : '') + '</span> Inspiration</span>' +
      '</div></div>';
  }

  function profDot(kind, key, val) {
    const cls = val === 2 ? 'exp' : (val === 1 ? 'on' : '');
    const mark = val === 2 ? '◉' : (val === 1 ? '●' : '○');
    return '<span class="dnd-dot ' + cls + '" data-act="prof" data-kind="' + kind + '" data-key="' + key + '" title="Click to cycle proficiency">' + mark + '</span>';
  }

  function colA(L) {
    const abil = char.stats.map((v, i) =>
      '<div class="dnd-abil-row">' +
      '<span class="dnd-abil-label">' + ABILITIES[i].abbr + '</span>' +
      '<input class="dnd-abil-score" type="number" data-act="stat" data-idx="' + i + '" value="' + L.stats[i] + '" title="' + ABILITIES[i].name + '" />' +
      '<span class="dnd-abil-mod">' + signed(L.mods[i]) + '</span>' +
      '</div>').join('');
    const saves = L.saves.map(s =>
      '<div class="dnd-row">' + profDot('save', s.key, s.prof) +
      '<span class="dnd-rname">' + esc(s.name) + '</span>' +
      '<span class="dnd-mod">' + signed(s.mod) + '</span></div>').join('');
    const skills = L.skills.map(s =>
      '<div class="dnd-row">' + profDot('skill', s.key, s.prof) +
      '<span class="dnd-rname">' + esc(s.name) + '</span><span class="dnd-stat">' + ABILITIES[s.stat].abbr + '</span>' +
      '<span class="dnd-mod">' + signed(s.mod) + '</span></div>').join('');
    return '<div class="dnd-col">' +
      '<div class="dnd-card"><h3>Ability Scores</h3>' + abil + '</div>' +
      '<div class="dnd-card"><h3>Saving Throws</h3>' + saves + '</div>' +
      '<div class="dnd-card"><h3>Skills</h3>' + skills + '</div>' +
      '<div class="dnd-card"><h3>Passive</h3><div class="dnd-passive">' +
      '<span>Perception <b>' + L.passive.perception + '</b></span>' +
      '<span>Insight <b>' + L.passive.insight + '</b></span>' +
      '<span>Investigation <b>' + L.passive.investigation + '</b></span>' +
      '</div></div></div>';
  }

  function colB(L) {
    const st = char.state;
    const combat =
      '<div class="dnd-statbox ac"><div class="v">' + L.ac + '</div><div class="l">Armor Class</div></div>' +
      '<div class="dnd-statbox"><div class="v">' + signed(L.initiative) + '</div><div class="l">Initiative</div></div>' +
      '<div class="dnd-statbox"><div class="v">' + char.speed + ' ft</div><div class="l">Speed</div></div>' +
      '<div class="dnd-statbox"><div class="v">' + signed(char.pb) + '</div><div class="l">Prof Bonus</div></div>';

    const hp = '<div class="dnd-hp">' +
      '<span class="hp-num">' + st.hpCurrent + '</span><span class="hp-max">/ ' + char.hp.max + '</span>' +
      '<input class="dnd-hp-input" type="number" data-act="hp" value="' + st.hpCurrent + '" title="Current HP" />' +
      '<div class="dnd-hpquick">' +
      '<button data-act="hpbtn" data-d="-5">−5</button><button data-act="hpbtn" data-d="-1">−1</button>' +
      '<button data-act="hpbtn" data-d="1">+1</button><button data-act="hpbtn" data-d="5">+5</button>' +
      '</div>' +
      '<span style="color:#9a7abf;font-size:.85em;">Temp</span>' +
      '<input class="dnd-hp-input" type="number" data-act="temp" value="' + st.hpTemp + '" title="Temporary HP" style="width:52px;" />' +
      '</div>';

    const hd = char.hitDice.map(h => {
      const used = st.hitDiceUsed[h.name] || 0;
      return '<span class="dnd-hdie-item' + (used >= h.total ? ' used' : '') + '" data-act="hdie" data-name="' + esc(h.name) + '" title="' + h.name + ' hit dice — click to use/restore">' +
        esc(h.name) + ' ' + (h.total - used) + '/' + h.total + ' ' + h.die + '</span>';
    }).join('');

    const ds = '<div class="dnd-ds">' +
      '<span class="ds-kind">❤️ Success</span>' + pips(3, st.deathSuccess, 'ds', 'success') +
      '<span class="ds-kind">💀 Fail</span>' + pips(3, st.deathFail, 'ds', 'fail') +
      '<button class="dnd-ds-reset" data-act="dsreset">reset</button>' +
      '</div>';

    const attacks = char.attacks.length ? '<table class="dnd-table"><thead><tr><th>Attack</th><th>To Hit</th><th>Damage</th><th>Type</th><th>Range</th></tr></thead><tbody>' +
      char.attacks.map(a => '<tr><td>' + esc(a.name) + (a.note ? '<div style="font-size:.7em;color:#8a5abf;">' + esc(a.note) + '</div>' : '') + '</td>' +
        '<td class="w">' + signed(a.toHit) + '</td><td class="w">' + esc(a.dmg) + '</td><td>' + esc(a.dmgType) + '</td><td class="w">' + esc(a.range) + '</td></tr>').join('') +
      '</tbody></table>' : '<div class="dnd-clear-cta">No weapons on this character.</div>';

    const profs = '<div class="dnd-profs">' +
      (char.profs.languages.length ? '<span class="pf-label">Languages: </span> ' + char.profs.languages.map(esc).join(', ') + '<br>' : '') +
      (char.profs.other.length ? '<span class="pf-label">Proficiencies: </span> ' + char.profs.other.map(esc).join(', ') : '') +
      '</div>';

    return '<div class="dnd-col">' +
      '<div class="dnd-card"><h3>Combat</h3><div class="dnd-combat">' + combat + '</div></div>' +
      '<div class="dnd-card"><h3>Hit Points &amp; Hit Dice</h3>' + hp + '<div style="margin-top:.6em;">' + hd + '</div></div>' +
      '<div class="dnd-card"><h3>Death Saves</h3>' + ds + '</div>' +
      '<div class="dnd-card"><h3>⚔ Attacks</h3>' + attacks + '</div>' +
      '<div class="dnd-card"><h3>Proficiencies &amp; Languages</h3>' + profs + '</div>' +
      '</div>';
  }

  function pips(n, filled, act, kind) {
    let out = '';
    for (let i = 0; i < n; i++) {
      const fill = i < filled ? ' fill' : '';
      out += '<span class="dnd-pip ' + kind + fill + '" data-act="' + act + '" data-kind="' + kind + '" data-i="' + i + '"></span>';
    }
    return out;
  }

  function colC() {
    const st = char.state;
    const hasSlots = Object.keys(char.spellSlots).length || Object.keys(char.pact).length;
    const hasSpells = char.spells.length;

    let slotsHTML = '';
    if (hasSlots) {
      const rows = [];
      for (const which of ['spell', 'pact']) {
        const map = which === 'spell' ? char.spellSlots : char.pact;
        for (const lvl of Object.keys(map)) {
          const slot = map[lvl];
          const used = which === 'spell' ? (st.spellUsed[lvl] || 0) : (st.pactUsed[lvl] || 0);
          let dots = '';
          for (let i = 0; i < slot.available; i++) dots += '<span class="dnd-pip' + (i < used ? ' fill' : '') + '" data-act="slot" data-which="' + which + '" data-lvl="' + lvl + '" data-i="' + i + '"></span>';
          rows.push('<div class="dnd-slotlvl"><span class="lv">' + (which === 'pact' ? 'Pact ' : 'L') + lvl + '</span>' + dots + '</div>');
        }
      }
      slotsHTML = '<div class="dnd-slots">' + rows.join('') + '</div>';
    }

    let spellsHTML = '';
    if (hasSpells) {
      const grouped = {};
      char.spells.forEach(s => { const l = s.level; (grouped[l] = grouped[l] || []).push(s); });
      const lvls = Object.keys(grouped).map(Number).sort((a, b) => a - b);
      spellsHTML = lvls.map(l => {
        const hdr = l === 0 ? 'Cantrips' : 'Level ' + l;
        const list = grouped[l].map(s => {
          const badges = [];
          if (s.atWill) badges.push('<span class="sp-badge" title="At-will">∞</span>');
          if (s.ritual) badges.push('<span class="sp-badge">R</span>');
          if (s.conc) badges.push('<span class="sp-badge">C</span>');
          if (s.alwaysPrepared) badges.push('<span class="sp-badge prep">✦ Always prepared</span>');
          else if (s.prepared) badges.push('<span class="sp-badge prep">Prepared</span>');
          const meta = [s.cast, s.range, s.comps, s.duration].filter(Boolean).join(' · ');
          return '<div class="dnd-spell"><span class="sp-name">' + esc(s.name) + '</span>' +
            (s.school ? '<span class="sp-badges">' + esc(s.school) + '</span>' : '') + badges.join('') +
            (meta ? '<div style="font-size:.72em;color:#8a5abf;">' + esc(meta) + '</div>' : '') +
            (s.desc ? '<details><summary>Description</summary><div class="sp-desc">' + esc(s.desc) + '</div></details>' : '') +
            '</div>';
        }).join('');
        return '<div class="dnd-spell-hdr">' + hdr + ' <span class="cnt" style="color:#6a5a88;">' + grouped[l].length + '</span></div>' + list;
      }).join('');
    }

    const spellcard = (hasSlots || hasSpells)
      ? '<div class="dnd-card"><h3>✨ Spellcasting</h3>' + (hasSlots ? slotsHTML : '') + (hasSpells ? '<div class="dnd-spells">' + spellsHTML + '</div>' : '<div class="dnd-clear-cta">No spells listed.</div>') + '</div>'
      : '';

    const resHTML = char.resources.length
      ? '<div class="dnd-card"><h3>Resources</h3>' + char.resources.map(r => {
        const cur = st.resources[r.name] != null ? st.resources[r.name] : r.max;
        let dots = '';
        for (let i = 0; i < r.max; i++) dots += '<span class="dnd-pip' + (i < cur ? ' fill' : '') + '" data-act="res" data-name="' + esc(r.name) + '" data-i="' + i + '"></span>';
        return '<div class="dnd-res"><span class="r-name">' + esc(r.name) + ' <span style="color:#6a5a88;font-size:.75em;">' + cur + '/' + r.max + '</span></span><span class="r-dots">' + dots + '</span></div>';
      }).join('') + '</div>'
      : '';

    const featHTML = '<div class="dnd-card"><h3>Features &amp; Traits <span class="cnt">' + char.features.length + '</span></h3>' +
      char.features.map(f => '<div class="dnd-feature"><span class="f-name">' + esc(f.name) + '</span><span class="f-src">' + esc(f.source) + '</span>' +
        (f.desc ? '<details><summary>Details</summary><div class="f-desc">' + esc(f.desc) + '</div></details>' : '') + '</div>').join('') +
      '</div>';

    const invHTML = '<div class="dnd-card"><h3>Inventory <span class="cnt">' + char.inventory.length + '</span></h3><div class="dnd-inv">' +
      (char.inventory.length ? char.inventory.map(i => '<div class="dnd-inv-row"><span class="qty">' + i.qty + '×</span><span>' + esc(i.name) + (i.equipped ? '<span class="eq">equipped</span>' : '') + '</span><span class="w">' + (i.weight ? i.qty * i.weight + ' lb' : '') + '</span></div>').join('') : '<div class="dnd-clear-cta">Empty.</div>') +
      '</div>' +
      '<div class="dnd-coins" style="margin-top:.6em;">' +
      '<span><b>PP</b> ' + (char.currencies.pp || 0) + '</span><span><b>GP</b> ' + (char.currencies.gp || 0) + '</span>' +
      '<span><b>EP</b> ' + (char.currencies.ep || 0) + '</span><span><b>SP</b> ' + (char.currencies.sp || 0) + '</span>' +
      '<span><b>CP</b> ' + (char.currencies.cp || 0) + '</span>' +
      '<span style="margin-left:auto;color:#8a5abf;">' + char.weightTotal + ' lb / ' + char.carryMax + ' lb</span>' +
      '</div></div>';

    const noteFields = [
      ['personality', 'Personality Traits', false], ['ideals', 'Ideals', false], ['bonds', 'Bonds', false], ['flaws', 'Flaws', false],
      ['appearance', 'Appearance', false], ['backstory', 'Backstory', true], ['allies', 'Allies & Organizations', true],
      ['possessions', 'Other Possessions', true], ['holdings', 'Other Holdings', true], ['other', 'Other Notes', true]
    ];
    const notesHTML = '<div class="dnd-card"><h3>Notes &amp; Backstory</h3>' +
      noteFields.map(([k, label, big]) =>
        '<div style="margin-bottom:.5em;"><div style="color:#9a7abf;font-family:Cinzel,serif;font-size:.68em;letter-spacing:.08em;text-transform:uppercase;margin-bottom:.2em;">' + label + '</div>' +
        '<textarea class="dnd-note' + (big ? '' : ' small') + '" data-act="note" data-field="' + k + '">' + esc(st.notes[k] || '') + '</textarea></div>'
      ).join('') + '</div>';

    return '<div class="dnd-col">' + spellcard + resHTML + featHTML + invHTML + notesHTML + '</div>';
  }

  function save() { setLS(char); }

  function onSheetClick(e) {
    const elT = e.target.closest('[data-act]');
    if (!elT || !char) return;
    const act = elT.dataset.act;
    const st = char.state;
    if (act === 'insp') { st.inspiration = !st.inspiration; }
    else if (act === 'hpbtn') { st.hpCurrent = Math.max(0, (Number(st.hpCurrent) || 0) + Number(elT.dataset.d)); }
    else if (act === 'hdie') {
      const name = elT.dataset.name;
      const h = char.hitDice.find(x => x.name === name);
      if (!h) return;
      let used = st.hitDiceUsed[name] || 0;
      used = used >= h.total ? 0 : used + 1;
      st.hitDiceUsed[name] = used;
    }
    else if (act === 'ds') {
      const kind = elT.dataset.kind;
      const i = Number(elT.dataset.i);
      const cur = kind === 'success' ? st.deathSuccess : st.deathFail;
      const next = cur === i + 1 ? i : i + 1;
      if (kind === 'success') st.deathSuccess = next; else st.deathFail = next;
    }
    else if (act === 'dsreset') { st.deathSuccess = 0; st.deathFail = 0; }
    else if (act === 'slot') {
      const which = elT.dataset.which, lvl = elT.dataset.lvl, i = Number(elT.dataset.i);
      const map = which === 'spell' ? st.spellUsed : st.pactUsed;
      const used = map[lvl] || 0;
      map[lvl] = used === i + 1 ? i : i + 1;
    }
    else if (act === 'res') {
      const name = elT.dataset.name, i = Number(elT.dataset.i);
      const cur = st.resources[name] != null ? st.resources[name] : (char.resources.find(r => r.name === name) || {}).max;
      st.resources[name] = cur === i + 1 ? i : i + 1;
    }
    else if (act === 'prof') {
      const kind = elT.dataset.kind, key = elT.dataset.key;
      const map = kind === 'save' ? st.saveProf : st.skillProf;
      map[key] = ((map[key] || 0) + 1) % 3;
    }
    else return;
    save();
    render();
  }

  function onSheetChange(e) {
    const elT = e.target.closest('[data-act]');
    if (!elT || !char) return;
    const act = elT.dataset.act;
    const st = char.state;
    if (act === 'hp') { st.hpCurrent = Math.max(0, Math.min(char.hp.max + 999, Number(elT.value) || 0)); }
    else if (act === 'temp') { st.hpTemp = Math.max(0, Number(elT.value) || 0); }
    else if (act === 'stat') {
      const i = Number(elT.dataset.idx);
      const v = Number(elT.value);
      if (!isNaN(v) && v >= 1 && v <= 30) st.statOverride[i] = v;
      else st.statOverride[i] = null;
    }
    else if (act === 'align') { st.alignment = elT.value; }
    else if (act === 'note') { st.notes[elT.dataset.field] = elT.value; save(); return; }
    else return;
    save();
    render();
  }

  function extractId(input) {
    let s = String(input || '').trim();
    const m = s.match(/dndbeyond\.com\/(?:character|characters)\/(\d+)/i) || s.match(/(?:^|\/)(\d{4,})(?:\/|$)/);
    if (m) return m[1];
    if (/^\d+$/.test(s)) return s;
    return null;
  }

  async function dndImportFromInput() {
    const input = $('dndUrlInput');
    const id = extractId(input.value);
    const key = (input.value.match(/\/[A-Za-z0-9]{4,}\s*$/) || [null])[0];
    if (!id) { setStatus('Couldn’t find a character ID in that link.'); return; }
    const btn = $('dndImportBtn');
    btn.disabled = true;
    setStatus('Fetching character ' + id + ' from D&D Beyond…');
    try {
      let text = null;
      const url = 'https://www.dndbeyond.com/character/' + id + '/json';
      try { text = await root.superFetch(url).then(r => r.text()); }
      catch (err) {
        if (key) text = await root.superFetch(url + '?sharetoken=' + encodeURIComponent(key.replace(/^\//, ''))).then(r => r.text());
        else throw err;
      }
      let json;
      try { json = JSON.parse(text); } catch (e) { throw new Error('parse'); }
      if (!json || !json.name) throw new Error('shape');
      char = parseChar(json);
      char.meta.sourceUrl = input.value.trim();
      save();
      render();
      setStatus('Imported ' + char.meta.name + ' · Level ' + char.level + ' · ' + char.meta.race);
    } catch (e) {
      console.error(e);
      setStatus('Import failed — this character may be private. On D&D Beyond, set the character’s privacy to Public (or share via a link) and try again.');
    } finally {
      btn.disabled = false;
    }
  }

  function dndClear() {
    if (char && !confirm('Clear the loaded character sheet?')) return;
    char = null;
    try { localStorage.removeItem(LS_KEY); } catch (e) {}
    render();
    setStatus('');
  }

  function dndExportChar() {
    if (!char) { setStatus('Nothing loaded yet.'); return; }
    const a = document.createElement('a');
    a.href = 'data:application/json;base64,' + btoa(unescape(encodeURIComponent(JSON.stringify(char))));
    a.download = (char.meta.name || 'character').replace(/[^\w-]+/g, '_') + '-sheet.json';
    document.body.appendChild(a); a.click(); a.remove();
  }

  function dndImportFile(file) {
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const obj = JSON.parse(rd.result);
        if (!obj || !obj.stats || !obj.state) throw new Error('bad');
        char = obj;
        save();
        render();
        setStatus('Loaded sheet for ' + (char.meta && char.meta.name) + '.');
      } catch (e) { setStatus('That file isn’t a saved Runforge character sheet.'); }
    };
    rd.readAsText(file);
  }

  function init() {
    const wrap = $('dndSheet');
    if (wrap) {
      wrap.addEventListener('click', onSheetClick);
      wrap.addEventListener('change', onSheetChange);
    }
    const _sp = window.showPage;
    if (typeof _sp === 'function') {
      window.showPage = function (id) { _sp(id); if (id === 'pageSheet') render(); };
    }
    render();
  }

  window.dndImportFromInput = dndImportFromInput;
  window.dndClear = dndClear;
  window.dndExportChar = dndExportChar;
  window.dndImportFile = dndImportFile;
  window.dndSheetRefresh = render;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
