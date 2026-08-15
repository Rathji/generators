import { CREATURES, FACTIONS, RES_BY_ID, SPELLS, SKILLS, buildingsFor, HERO_BUY_COST, factionCreatures } from './data.js';
import { S, setScreen } from './app.js';
import * as E from './engine.js';
import { setupBattle, current, reachableStacks, stackAt, moveStack, attack, castSpell,
  validSpellTargets, waitAction, defendAction, endCurrent, processTurn, runAuto, stackInfo, canAttack } from './combat.js';
import { drawBattle, battleLayout } from './render.js';
import { pixelToHex } from './hex.js';
import { toast, renderMapNow, updateTopbar, updateHeroStrip, showModal, hideModal } from './hud.js';

const combatCanvas = () => document.getElementById('combatCanvas');

// ---------- cost formatting ----------
export function costStr(cost) {
  if (!cost) return '';
  const parts = [];
  for (const k in cost) {
    const r = RES_BY_ID[k];
    parts.push(`<span class="res" title="${r.name}"><span class="resIcon" style="background:${r.color}"></span>${cost[k]}</span>`);
  }
  return parts.join(' ');
}

// ---------- town screen ----------
export function openTownScreen(game, town, hero) {
  if (!hero) hero = E.heroAt(game, town.q, town.r);
  if (hero && hero.pid === 0) E.learnTownSpells(hero, town);
  const overlay = document.getElementById('townScreen');
  const faction = FACTIONS[town.faction];
  const ownerColor = town.owner !== null ? (town.owner === 0 ? '#4a7fd6' : '#c6483e') : '#777';
  const income = E.townIncome(town);
  const defs = buildingsFor(town.faction);
  const recruitables = E.townRecruitCosts(town);

  let buildHtml = defs.map(def => {
    const built = town.buildings.includes(def.id);
    const afford = E.canAfford(game, town.owner, def.cost);
    const chk = E.townCanBuild(town, def, game);
    const costHtml = costStr(def.cost);
    const missClass = !afford ? ' miss' : '';
    return `<div class="buildItem ${built ? 'built' : afford && chk.ok ? 'affordable' : 'notaff'}">
      <div>
        <div class="bName">${def.name} ${built ? '<span class="news">✓</span>' : ''}</div>
        <div class="bCost"><span class="${missClass}">${costHtml}</span> · ${def.desc || ''} ${chk.ok ? '' : `<span class="muted">(${chk.reason})</span>`}</div>
      </div>
      ${built ? '' : `<button class="btn bBtn" data-build="${def.id}" ${afford && chk.ok ? '' : 'disabled'}>Build</button>`}
    </div>`;
  }).join('');

  const heroHere = E.heroAt(game, town.q, town.r);
  const visitName = heroHere && heroHere.pid === 0 ? `<div class="muted">${heroHere.name} is visiting</div>` : '<div class="muted">No hero visiting — move a hero here to recruit</div>';

  const tavernBuilt = town.buildings.includes('tavern');
  const myHeroes = game.heroes.filter(h => h.pid === 0).length;

  overlay.innerHTML = `
    <div class="win">
      <div class="townTop">
        <div class="flag" style="background:${ownerColor}"></div>
        <h2>${town.name}</h2>
        <div class="sub" style="margin:0">${faction.name} · Income ${income} gold/day · Growth +${Math.round(E.townGrowthMult(town) * 100)}%</div>
        <div class="tbSpacer" style="flex:1"></div>
        ${tavernBuilt ? `<button class="btn" id="buyHeroBtn">Buy Hero (${HERO_BUY_COST.gold}g)</button>` : ''}
        <button class="btn" id="townCloseBtn">Close</button>
      </div>
      ${visitName}
      <div class="townGrid">
        <div class="buildList">
          <h3>Build</h3>
          ${buildHtml}
        </div>
        <div class="recruitList">
          <h3>Recruit</h3>
          ${recruitables.length ? recruitables.map(r => recruitRow(town, r)).join('') : '<div class="muted">No dwellings built yet.</div>'}
        </div>
      </div>
    </div>`;

  overlay.querySelectorAll('[data-build]').forEach(btn => {
    btn.addEventListener('click', () => {
      E.buildInTown(game, town, btn.dataset.build);
      if (btn.dataset.build.startsWith('mages') && heroHere && heroHere.pid === 0) E.learnTownSpells(heroHere, town);
      openTownScreen(game, town, heroHere);
      updateTopbar(game);
    });
  });
  overlay.querySelectorAll('.recruitRow .buyBtn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tier = +btn.dataset.tier;
      const qty = +overlay.querySelector(`#qty${tier}`).value;
      recruitAtTown(game, town, tier, qty, heroHere);
      openTownScreen(game, town, heroHere);
      updateTopbar(game);
    });
  });
  const buyHeroBtn = overlay.querySelector('#buyHeroBtn');
  if (buyHeroBtn) buyHeroBtn.addEventListener('click', () => {
    if (myHeroes >= 5) { toast('Too many heroes'); return; }
    if (!E.canAfford(game, 0, HERO_BUY_COST)) { toast('Not enough gold'); return; }
    E.spendRes(game, 0, HERO_BUY_COST);
    const army = buildBuyArmy(town.faction);
    const name = pickHeroName(town.faction);
    const hero = E.makeHero(game, 0, town.faction, name, town.q, town.r, army);
    toast(`${name} joins your cause!`);
    openTownScreen(game, town, hero);
    updateHeroStrip(game);
    updateTopbar(game);
  });
  overlay.querySelector('#townCloseBtn').addEventListener('click', () => {
    overlay.hidden = true;
    setScreen('map');
    refreshAll();
  });
  overlay.hidden = false;
}

function buildBuyArmy(faction) {
  const cs = factionCreatures(faction);
  return [{ id: cs[0].id, count: 10 }, { id: cs[1].id, count: 5 }];
}
function pickHeroName(faction) {
  const used = new Set();
  for (const h of S.game.heroes) used.add(h.name);
  const pool = { castle: ['Arielle', 'Valerius', 'Kathleen', 'Edmund', 'Sylvia', 'Rowan'],
    rampart: ['Meriel', 'Corwyn', 'Elowen', 'Thorn', 'Aisling', 'Fenwick'],
    necropolis: ['Morta', 'Vesper', 'Drake', 'Lilith', 'Morbus', 'Nyx'],
    stronghold: ['Gorm', 'Krag', 'Ursa', 'Vanka', 'Brokk', 'Torga'] }[faction];
  return pool.find(n => !used.has(n)) || 'Hero';
}

function recruitRow(town, r) {
  const c = CREATURES[r.id];
  const stockKey = r.upgraded ? 'up' : 'base';
  const stock = (town.stock[r.tier] && town.stock[r.tier][stockKey]) || 0;
  const facColor = FACTIONS[c.faction].color;
  return `<div class="recruitRow">
    <div class="creIcon" style="background:${facColor}">${c.name[0]}</div>
    <div class="rInfo"><b>${c.name}</b> <span class="rStock">stock ${stock}</span> · <span class="rCost">${c.cost.gold}g each</span></div>
    <input id="qty${r.tier}" type="number" min="1" max="${Math.max(stock, 1)}" value="${Math.max(1, Math.min(10, stock))}" style="width:56px">
    <button class="btn buyBtn" data-tier="${r.tier}" ${stock > 0 ? '' : 'disabled'}>Buy</button>
  </div>`;
}

function recruitAtTown(game, town, tier, qty, hero) {
  if (!hero || hero.pid !== 0) { toast('No hero here to receive creatures'); return; }
  const r = E.townRecruitCosts(town).find(x => x.tier === tier);
  if (!r) return;
  const stockKey = r.upgraded ? 'up' : 'base';
  const stock = (town.stock[tier] && town.stock[tier][stockKey]) || 0;
  qty = Math.max(0, Math.min(qty, stock));
  const c = CREATURES[r.id];
  const cost = c.cost.gold * qty;
  if (!E.canAfford(game, 0, { gold: cost })) { toast('Not enough gold'); return; }
  if (qty <= 0) return;
  E.spendRes(game, 0, { gold: cost });
  town.stock[tier][stockKey] -= qty;
  E.addToArmy(hero, r.id, qty);
  toast(`Recruited ${qty} ${c.name}`);
}

// ---------- hero screen ----------
export function openHeroScreen(game, hero) {
  const overlay = document.getElementById('heroScreen');
  const xpNext = E.xpToNext(hero.level);
  const skillHtml = Object.keys(hero.skills).map(k =>
    `<div class="skillCard"><b>${SKILL_NAME[k]}</b> <span class="lvl">${'★'.repeat(hero.skills[k])}${'☆'.repeat(SKILLS[k].max - hero.skills[k])}</span></div>`).join('') || '<div class="muted">No skills yet</div>';
  const spellHtml = hero.spells.length ? hero.spells.map(s => `<span class="spellChip">${SPELLS[s].name} (${SPELLS[s].mana} MP)</span>`).join('') : '<span class="muted">No spells — visit a town with a Mage Guild</span>';
  const armyHtml = hero.army.map((st, i) => {
    if (!st) return `<div class="slot empty"><div class="muted">—</div></div>`;
    const c = CREATURES[st.id];
    return `<div class="slot"><div class="creIcon" style="background:${FACTIONS[c.faction].color};margin:0 auto">${c.name[0]}</div><div class="cName">${c.name}</div><div class="cCount">${st.count}</div></div>`;
  }).join('');
  overlay.innerHTML = `
    <div class="win heroWin">
      <div class="townTop">
        <div class="port" style="width:34px;height:34px;border-radius:50%;background:${hero.pid === 0 ? '#4a7fd6' : '#c6483e'}"></div>
        <h2>${hero.name}</h2>
        <div class="sub" style="margin:0">Level ${hero.level} · ${hero.xp}/${xpNext} XP to next level</div>
        <div class="tbSpacer" style="flex:1"></div>
        <button class="btn" id="heroCloseBtn">Close</button>
      </div>
      <div class="xpbar"><div style="width:${Math.min(100, hero.xp / xpNext * 100)}%"></div></div>
      <div class="heroStats">
        ${[['Attack', hero.atk], ['Defense', hero.def], ['Spell Power', hero.pow], ['Knowledge', hero.know]].map(([k, v]) => `<div class="statBox"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('')}
      </div>
      <div class="muted" style="margin-bottom:4px">Move points ${hero.move}/${E.heroMaxMove(hero)} · Spell points ${hero.mana}/${E.maxMana(hero)}</div>
      <div class="armyGrid">${armyHtml}</div>
      <div class="hr"></div>
      <div class="sub" style="font-weight:bold">Skills</div>
      <div class="skillList">${skillHtml}</div>
      <div class="hr"></div>
      <div class="sub" style="font-weight:bold">Spellbook (${hero.mana}/${E.maxMana(hero)} mana)</div>
      <div class="spellList">${spellHtml}</div>
    </div>`;
  overlay.querySelector('#heroCloseBtn').addEventListener('click', () => { overlay.hidden = true; setScreen('map'); refreshAll(); });
  overlay.hidden = false;
}
const SKILL_NAME = { offense: 'Offense', archery: 'Archery', armorer: 'Armorer', logistics: 'Logistics', sorcery: 'Sorcery', intelligence: 'Intelligence', luck: 'Luck', estates: 'Estates', pathfinding: 'Pathfinding' };

// ---------- dwelling modal ----------
export function openDwellingModal(game, obj, hero) {
  const c = CREATURES[obj.creatureId];
  if (!hero || hero.pid !== 0) { toast('Move a hero here to recruit'); return; }
  if (obj.owner !== 0 && obj.owner !== null) { toast('This dwelling belongs to another player'); return; }
  showModal(`
    <h3>${c.name} Dwelling</h3>
    <div class="muted">${c.name}s — cost ${c.cost.gold} gold each · stock ${obj.stock}</div>
    <div class="hr"></div>
    <div style="display:flex;gap:8px;align-items:center">
      <input id="dwQty" type="number" min="1" value="${Math.max(1, Math.min(5, obj.stock))}" style="width:70px">
      <button class="btn primary" id="dwBuyBtn">Recruit</button>
    </div>
    <div class="modalBtns"><button class="btn" id="dwCloseBtn">Close</button></div>`);
  document.getElementById('dwBuyBtn').addEventListener('click', () => {
    const qty = Math.max(0, Math.min(+document.getElementById('dwQty').value || 0, obj.stock));
    if (qty <= 0) return;
    if (!E.canAfford(game, 0, { gold: c.cost.gold * qty })) { toast('Not enough gold'); hideModal(); return; }
    E.spendRes(game, 0, { gold: c.cost.gold * qty });
    obj.stock -= qty;
    if (obj.owner === null) obj.owner = 0;
    E.addToArmy(hero, c.id, qty);
    toast(`Recruited ${qty} ${c.name}`);
    hideModal();
    refreshAll();
  });
  document.getElementById('dwCloseBtn').addEventListener('click', hideModal);
}

// ---------- level up ----------
export function handleHeroEvent(game, hero, ev) {
  if (ev.type === 'levelup' && hero.pendingLevels > 0) openLevelModal(game, hero);
}

function openLevelModal(game, hero) {
  if (hero.pendingLevels <= 0) return;
  const opts = E.availableSkills(hero, 3);
  if (!opts.length) { hero.pendingLevels = 0; return; }
  showModal(`
    <h3>Level Up! Choose a skill</h3>
    <div class="choiceRow">${opts.map(k => `
      <div class="choice" data-skill="${k}">
        <div class="cT">${SKILL_NAME[k]}</div>
        <div class="cD">${SKILLS[k].desc}</div>
        <div class="cS">Level ${(hero.skills[k] || 0) + 1}/${SKILLS[k].max}</div>
      </div>`).join('')}</div>`);
  document.querySelectorAll('#modalCtn .choice').forEach(el => {
    el.addEventListener('click', () => {
      E.applySkill(hero, el.dataset.skill);
      hero.pendingLevels--;
      hideModal();
      updateTopbar(S.game);
      renderMapNow();
      if (hero.pendingLevels > 0) openLevelModal(game, hero);
    });
  });
}

// ---------- combat ----------
export function startCombat(hero, tq, tr) {
  const game = S.game;
  if (!hero.army.some(Boolean)) { toast('Your hero has no army to fight with'); return; }
  const meta = buildCombatMeta(game, tq, tr);
  if (!meta) return;
  meta.attackerHeroId = hero.id;
  const battle = setupBattle(
    { pid: hero.pid, hero, stacks: hero.army.filter(Boolean), ai: false },
    { pid: meta.defPid, hero: meta.defHero, stacks: meta.stacks, ai: true }
  );
  S.battle = battle;
  S.battleMeta = meta;
  setScreen('combat');
  buildCombatUI();
  processTurn(battle);
  renderCombat();
  if (battle.over) finishBattle();
}

function buildCombatMeta(game, q, r) {
  const town = E.townAt(game, q, r);
  if (town && town.owner !== 0 && town.owner !== null) {
    return { kind: 'town', objId: town.id, defPid: town.owner, defHero: null, stacks: town.guard || [], name: town.name };
  }
  const enemy = E.heroAt(game, q, r);
  if (enemy && enemy.pid !== 0) {
    return { kind: 'hero', objId: enemy.id, defPid: enemy.pid, defHero: enemy, stacks: enemy.army.filter(Boolean), name: enemy.name };
  }
  const o = E.objAt(game, q, r);
  if (o && o.type === 'stack') {
    return { kind: 'stack', objId: o.id, defPid: -1, defHero: null, stacks: o.army, name: 'Monsters' };
  }
  if (o && o.type === 'dwelling' && o.guard) {
    const c = CREATURES[o.creatureId];
    return { kind: 'dwelling', objId: o.id, defPid: -1, defHero: null, stacks: o.guard, name: `${c.name} Guardians` };
  }
  return null;
}

function buildCombatUI() {
  const battle = S.battle;
  const cvs = combatCanvas();
  cvs.width = 760;
  cvs.height = 480;
  if (cvs.__click) cvs.removeEventListener('pointerdown', cvs.__click);
  cvs.__click = onCombatClick;
  cvs.addEventListener('pointerdown', cvs.__click);
  const head = document.getElementById('combatHead');
  const attName = battle.attacker.hero ? battle.attacker.hero.name : 'Monsters';
  const defName = S.battleMeta.name;
  head.innerHTML = `
    <div class="cside"><div class="port" style="background:#4a7fd6"></div>${attName}<span class="armyVal">${E.armyValue(battle.attacker.stacksInput)}</span></div>
    <span class="muted">vs</span>
    <div class="cside"><div class="port" style="background:#c6483e"></div>${defName}<span class="armyVal">${E.armyValue(battle.defender.stacksInput)}</span></div>
    <div class="tbSpacer" style="flex:1"></div>
    <span id="roundEl" class="muted"></span>
    <button class="btn" id="quickBtn">Quick Battle</button>
    <button class="btn danger" id="retreatBtn">Retreat</button>`;
  document.getElementById('quickBtn').addEventListener('click', () => { runAuto(battle); finishBattle(); });
  document.getElementById('retreatBtn').addEventListener('click', retreatBattle);

  const panel = document.getElementById('combatPanel');
  panel.innerHTML = `
    <div class="cpStack" id="cpStack"></div>
    <div class="cpBtns">
      <button class="btn" id="waitBtn">Wait</button>
      <button class="btn" id="defendBtn">Defend</button>
      <button class="btn" id="castBtn">Cast</button>
      <button class="btn" id="cendBtn">End Turn</button>
    </div>
    <div id="combatLog"></div>`;
  document.getElementById('waitBtn').addEventListener('click', () => { const st = current(battle); if (st && !st.acted) { waitAction(battle, st); afterCombatAction(); } });
  document.getElementById('defendBtn').addEventListener('click', () => { const st = current(battle); if (st && !st.acted) { defendAction(battle, st); afterCombatAction(); } });
  document.getElementById('cendBtn').addEventListener('click', () => { endCurrent(battle); processTurn(battle); renderCombat(); if (battle.over) finishBattle(); });
  document.getElementById('castBtn').addEventListener('click', openSpellModal);
}

function onCombatClick(evt) {
  const battle = S.battle;
  if (!battle || battle.over) return;
  const cvs = combatCanvas();
  const rect = cvs.getBoundingClientRect();
  const x = (evt.clientX - rect.left) * (cvs.width / rect.width);
  const y = (evt.clientY - rect.top) * (cvs.height / rect.height);
  const L = battleLayout();
  const h = pixelToHex(x - L.ox, y - L.oy, L.size);
  const tgt = stackAt(battle, h.q, h.r);
  if (S.combatSpell) {
    if (tgt && validSpellTargets(battle, battle.attacker, SPELLS[S.combatSpell]).has(tgt.uid)) {
      const ok = castSpell(battle, battle.attacker, S.combatSpell, tgt);
      S.combatSpell = null;
      if (ok) afterCombatAction();
      else renderCombat();
    }
    return;
  }
  const cur = current(battle);
  if (!cur || cur.acted || cur.side !== battle.attacker) return;
  if (tgt && tgt.side !== cur.side) {
    if (canAttack(battle, cur, tgt)) { attack(battle, cur, tgt); afterCombatAction(); }
  } else if (!tgt) {
    const reach = reachableStacks(battle, cur);
    if (reach.has(h.q + ',' + h.r)) { moveStack(battle, cur, h.q, h.r); afterCombatAction(); }
  }
}

function afterCombatAction() {
  const battle = S.battle;
  endCurrent(battle);
  processTurn(battle);
  renderCombat();
  if (battle.over) finishBattle();
}

function retreatBattle() {
  const battle = S.battle;
  battle.over = true;
  battle.winner = 'def';
  const alive = battle.attacker.stacks.filter(s => s.count > 0).sort((a, b) => a.def.cost.gold - b.def.cost.gold);
  const kept = alive.slice(0, 3).map(s => ({ id: s.id, count: s.count }));
  battle.results = {
    attStacks: kept,
    defStacks: battle.defender.stacks.filter(s => s.count > 0).map(s => ({ id: s.id, count: s.count })),
  };
  toast('You retreat from battle');
  finishBattle();
}

function finishBattle() {
  const battle = S.battle;
  const meta = S.battleMeta;
  const game = S.game;
  const hero = meta.attackerHeroId ? E.findHero(game, meta.attackerHeroId) : null;
  const defHero = meta.defenderHeroId ? E.findHero(game, meta.defenderHeroId) : null;
  E.resolveBattle(game, battle, meta);
  S.battle = null;
  S.battleMeta = null;
  S.combatSpell = null;
  setScreen('map');
  refreshAll();
  if (game.gameOver) {
    showGameOver(game);
    return;
  }
  if (battle.winner === 'att') toast('Victory!', 'news');
  else toast('Defeat — your hero was slain', 'badnews');
  if (hero && hero.pendingLevels > 0) openLevelModal(game, hero);
}

function openSpellModal() {
  const battle = S.battle;
  const hero = battle.attacker.hero;
  if (!hero || !hero.spells.length) { toast('Your hero knows no spells'); return; }
  showModal(`
    <h3>Cast Spell</h3>
    <div class="muted">Mana: ${hero.mana}</div>
    <div class="choiceRow">${hero.spells.map(id => {
      const s = SPELLS[id];
      return `<div class="choice" data-spell="${id}" ${hero.mana >= s.mana ? '' : 'style="opacity:.4"'}>
        <div class="cT">${s.name} (${s.mana} MP)</div>
        <div class="cD">${s.desc}</div>
      </div>`;
    }).join('')}</div>
    <div class="modalBtns"><button class="btn" id="spellCancelBtn">Cancel</button></div>`);
  document.querySelectorAll('#modalCtn .choice').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset.spell;
      if (hero.mana < SPELLS[id].mana) return;
      S.combatSpell = id;
      hideModal();
      renderCombat();
    });
  });
  document.getElementById('spellCancelBtn').addEventListener('click', hideModal);
}

function renderCombat() {
  const battle = S.battle;
  if (!battle) return;
  const ctx = combatCanvas().getContext('2d');
  const cur = current(battle);
  let sel = null, reach = null, targets = null;
  if (S.combatSpell) {
    targets = validSpellTargets(battle, battle.attacker, SPELLS[S.combatSpell]);
  } else if (cur && !cur.acted && cur.side === battle.attacker) {
    sel = cur;
    reach = reachableStacks(battle, cur);
  }
  drawBattle(ctx, battle, sel, reach, targets);
  // head round
  const roundEl = document.getElementById('roundEl');
  if (roundEl) roundEl.textContent = `Round ${battle.round}`;
  // panel
  const cp = document.getElementById('cpStack');
  const log = document.getElementById('combatLog');
  if (battle.over) {
    cp.innerHTML = `<b>${battle.winner === 'att' ? 'Victory!' : 'Defeat'}</b>`;
  } else if (cur) {
    const info = stackInfo(cur);
    const acting = !cur.acted && cur.side === battle.attacker;
    const hpPct = Math.round(info.hp / info.maxHp * 100);
    cp.innerHTML = `<div><b>${info.name}</b> (${info.count}) <span class="cAct">${acting ? '— your turn' : cur.side === battle.attacker ? '(acting)' : '— enemy'}</span></div>
      <div>Atk ${info.atk} · Def ${info.def} · Dmg ${info.dmg[0]}-${info.dmg[1]} · Spd ${info.speed}${info.ranged ? ' · ranged' : ''}${info.fly ? ' · flying' : ''}</div>
      <div>HP ${Math.ceil(info.hp)}/${info.maxHp} <div class="xpbar" style="width:180px;display:inline-block;vertical-align:middle"><div style="width:${hpPct}%"></div></div></div>`;
    const btns = ['waitBtn', 'defendBtn', 'castBtn', 'cendBtn'];
    for (const id of btns) document.getElementById(id).disabled = !acting;
  }
  const entries = battle.log.slice(-30).map(l => `<div>${l}</div>`).join('');
  log.innerHTML = entries;
  log.scrollTop = log.scrollHeight;
}

// ---------- game over ----------
export function showGameOver(game) {
  const won = game.gameOver === 'win';
  showModal(`
    <h3>${won ? 'Victory!' : 'Defeat'}</h3>
    <p class="muted">${won ? 'All enemy heroes are slain and every enemy town is yours. The land is won!' : 'Your last hero has fallen. The realm is lost.'}</p>
    <div class="modalBtns"><button class="btn primary" id="againBtn">New Game</button></div>`);
  document.getElementById('againBtn').addEventListener('click', () => { hideModal(); S.onNewGame && S.onNewGame(); });
}

// ---------- refresh ----------
export function refreshAll() {
  const game = S.game;
  if (!game) return;
  updateTopbar(game);
  updateHeroStrip(game);
  renderMapNow();
}
