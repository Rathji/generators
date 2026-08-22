// Dev demo harness for Tasks #21–#40: town/dungeon systems, enemy AI with
// boss phases + combat rewards, world-map movement scaling, ship/airship
// travel, global overworld encounters, story milestones, side quests, and
// cinematic sequences.
// Launch via window.startRpgDemo() or ?demo=rpg.

import { CombatResolver } from "../engine/combat.js";
import { SpellCastingSystem } from "../engine/spellcasting.js";
import { ShopUI } from "../engine/shop.js";
import { MiniMap } from "../engine/fog-of-war.js";
import { GridEntity, MovementSystem } from "../engine/movement.js";
import { DIRS } from "../engine/grid.js";

const MAP_ID = "caves_of_cornelia";
const START = { x: 7, y: 3 };

let state = null;
let battle = null;
let shopUI = null;
let shopTarget = null;
const movers = {};

function log(msg) {
  if (!state) return;
  const div = document.createElement("div");
  div.textContent = msg;
  state.logEl.appendChild(div);
  state.logEl.scrollTop = state.logEl.scrollHeight;
}

function currentMapId() {
  if (state.inBuilding) return state.inBuilding;
  if (state.inTown) return state.inTown;
  if (state.inCave) return window.ff.dungeons.currentLevel()?.mapId ?? MAP_ID;
  return "overworld";
}

// Battle resolver wired with the extended combat systems (#61/#62/#69/#70).
function makeCombat() {
  return new CombatResolver({
    random: Math.random,
    crits: window.ff.criticals,
    statusSystem: window.ff.status,
    weaponScaling: window.ff.weaponScaling,
    armor: window.ff.armor,
    abilitySystem: window.ff.abilitySystem,
    balance: window.ff.balance,
    // Task #126/#128/#129: turn-order queue (buffs feed speed), buff/debuff
    // modifiers (hit/speed), and multi-target attacks ride every battle.
    turnQueue: new window.systems.TurnOrderQueue({ random: Math.random, buffs: window.ff.buffs }),
    buffs: window.ff.buffs,
    multiTarget: new window.systems.MultiTargetResolver({ weaponScaling: window.ff.weaponScaling }),
  });
}

function flashVisual(spellId) {
  const cue = window.ff.spellVisuals.cueFor(spellId);
  if (!cue) return;
  const panel = state.gridEl.closest(".panel");
  panel.style.transition = "box-shadow 150ms ease-out, border-color 150ms ease-out";
  panel.style.boxShadow = "0 0 26px " + cue.color;
  panel.style.borderColor = cue.color;
  setTimeout(() => {
    panel.style.boxShadow = "";
    panel.style.borderColor = "";
  }, cue.duration + 80);
  log(cue.effect + " (" + cue.name + ")");
}

function moverFor(mapId) {
  if (!movers[mapId]) {
    const def = window.ff.maps.get(mapId);
    const tm = window.ff.maps.buildTileMap(mapId);
    const sys = new MovementSystem(tm);
    sys.setTerrain(window.ff.terrainFor(mapId));
    // Task #136: terrain-based movement speed — grass is fastest, forest/ice
    // halve land speed, mountains are slower still (overworld world-map
    // moves spend their scale as a terrain-cost budget).
    sys.setTerrainSpeed(window.ff.terrainSpeedFor(mapId));
    sys.setScale(def.scale ?? 1);
    sys.setWalkabilityHook((x, y) => window.ff.puzzles.blockedAt(mapId, x, y) || window.ff.boundaries.isBlocked(mapId, x, y));
    // Task #149/#152: revealed secret walls and opened gates become passable
    // through the passability override (secretWalls + worldVisuals).
    sys.setPassabilityOverride((x, y) => {
      const a = window.ff.secretWalls.passabilityOverride(mapId, x, y);
      if (a) return a;
      return window.ff.worldVisuals.passabilityOverride(mapId, x, y);
    });
    movers[mapId] = sys;
  }
  return movers[mapId];
}

function setPlayerAt(mapId, x, y, facing = "S") {
  const old = moverFor(currentMapId());
  if (state.player) old.removeEntity(state.player);
  const sys = moverFor(mapId);
  state.player.x = x;
  state.player.y = y;
  state.player.facing = facing;
  state.px = x;
  state.py = y;
  sys.addEntity(state.player);
}

function hudText() {
  const party = window.game.party;
  const line = party.members.map((m) => m.name + " " + Math.max(0, m.hp) + "/" + m.getStats().maxHp + " MP " + Math.max(0, m.mp) + "/" + (m.getStats().maxMp ?? 0)).join("  ");
  const goal = window.ff.questLog ? window.ff.questLog.activeGoal() : "";
  const cycle = window.ff.ngplus ? window.ff.ngplus.cycle() : 1;
  // Task #138: the game clock (day + hour) rides the HUD.
  const time = window.ff.gameClock ? "  Time: " + window.ff.gameClock.label() : "";
  // Task #162: the lifetime playtime clock rides the HUD.
  const played = window.ff.playtime ? "  Played " + window.ff.playtime.label() : "";
  return "Cycle " + cycle + "  [" + state.mapName + "] (" + state.px + "," + state.py + ") " + (state.player?.travelMode ?? "land") + time + played + "  Steps " + window.ff.encounters.totalSteps + "  Gold " + party.gold + "\n" + line + "\nGoal: " + goal;
}

// Task #73: landmark hint shown on the world map HUD.
function landmarkHint() {
  if (currentMapId() !== "overworld") return "";
  const hint = window.ff.landmarks.nearestHint("overworld", state.px, state.py);
  return hint ? "\n" + hint : "";
}

// Task #102: the crystal HUD — e.g. "◆◇◇◇ 1/4".
function crystalLine() {
  return "\nCrystals: " + window.ff.crystals.hudLine();
}

// Task #103: on the overworld, show which crystal bridges are open and which
// sealed gates remain.
function bridgeLine() {
  if (currentMapId() !== "overworld") return "";
  const open = window.ff.worldState.openBridges();
  const sealed = window.ff.worldState.pendingGates();
  return (
    "\nBridges: " +
    (open.length ? open.map((b) => b.name).join(", ") : "none") +
    " · Sealed gates: " +
    (sealed.length ? sealed.map((g) => g.name).join(", ") : "none")
  );
}

function renderGrid() {
  const mapId = currentMapId();
  const { maps, fog } = window.ff;
  const tm = maps.buildTileMap(mapId);
  const terr = window.ff.terrainFor(mapId);
  const grid = fog.visibilityGrid(mapId, tm.width, tm.height);
  const cells = [];
  for (let y = 0; y < tm.height; y++) {
    for (let x = 0; x < tm.width; x++) {
      const explored = grid[y][x];
      const isP = x === state.px && y === state.py;
      const t = terr ? terr.terrainAt(x, y) : "land";
      let cls = "cell" + (explored ? " on" : "");
      if (isP) cls += " player";
      // Task #148: in dark maps only the lit radius (and the player's own
      // tile) is visible without a light source.
      const lit =
        isP || window.ff.lighting.canSee(mapId, x, y, state.px, state.py);
      if (!lit) {
        cls += " dark";
        cells.push('<div class="' + cls + '">\u00b7</div>');
        continue;
      }
      if (explored && tm.isSolid(x, y)) cls += " wall";
      if (explored && t === "water") cls += " water";
      if (explored && t === "mountain") cls += " mountain";
      if (explored && t === "ice") cls += " ice";
      let char = isP ? "@" : tm.isSolid(x, y) ? "#" : t === "water" ? "~" : t === "mountain" ? "^" : t === "ice" ? "+" : ".";
      // Task #187: waystone glyphs glow on the grid; resident NPCs appear
      // as their sprite letters so they can be talked to.
      // Task #103: open crystal bridges render as "=" over the sea.
      if (explored && !isP && !tm.isSolid(x, y)) {
        if (window.ff.worldState.isBridged(mapId, x, y)) {
          char = "=";
          cls += " bridge";
        } else {
          const ws = window.ff.waystones.waystoneAt(mapId, x, y);
          if (ws) {
            char = "W";
            cls += " waystone";
          } else if (window.ff.maps.get(mapId)?.rows?.[y]?.[x] === "E") {
            // Task #198: the Echo Gate — the New Game+ hollow glows magenta.
            char = "E";
            cls += " echo";
          } else {
            const npc = window.ff.npcs.activeNpcAt(mapId, x, y);
            if (npc) {
              char = npc.sprite ?? "n";
              cls += " npc";
            } else {
              const obj = window.ff.environmentObjects.objectAt(mapId, x, y);
              if (obj) {
                char = obj.sprite ?? "?";
                cls += " object";
              }
            }
          }
        }
      }
      // Task #152: permanent world-state tile patches (opened doors, lit
      // braziers) override the rendered tile once their plot flag is set.
      const patch = window.ff.worldVisuals.activePatchAt(mapId, x, y);
      if (patch) {
        if (patch.solid === false) cls = cls.replace(" wall", "");
        char = patch.char ?? char;
        cls += " " + (patch.cls ?? "");
      }
      cells.push('<div class="' + cls + '">' + char + "</div>");
    }
  }
  state.gridEl.innerHTML = cells.join("");
  state.gridEl.style.gridTemplateColumns = "repeat(" + tm.width + ", 18px)";
  state.statusEl.textContent = hudText() + landmarkHint() + crystalLine() + bridgeLine();
  if (state.miniMap) {
    state.miniMap.setFog(fog, mapId, tm.width, tm.height).render(state.px, state.py);
  }
  refreshForge();
  refreshWaystones();
}

function move(dir) {
  if (battle) return;
  if (window.ff.cinematic.isPlaying) return;
  const mapId = currentMapId();
  const sys = moverFor(mapId);
  const moved = (state.inCave || state.inBuilding) ? sys.move(state.player, dir) : sys.moveScaled(state.player, dir);
  state.px = state.player.x;
  state.py = state.player.y;
  if (moved) {
    // Task #162: every world step counts toward the lifetime step counter.
    window.ff.playtime?.addStep();
    window.ff.ambient.tick();
    if (mapId === "overworld") {
      // Task #137: overworld fog reveals only as the player explores (and is
      // persisted), Task #138: overworld steps move the game clock.
      window.ff.worldFog.reveal(state.px, state.py);
      window.ff.gameClock.advanceSteps(1);
    } else {
      window.ff.fog.discoverRadius(mapId, state.px, state.py, 2);
    }
    // Task #141: NPCs near the player call out lines on approach.
    for (const b of window.ff.npcBarks.tick(mapId, state.px, state.py)) {
      log(b.npc + ": \"" + b.line + "\"");
    }
    // Task #146: hidden traps spring on the tile just stepped onto.
    window.ff.traps.onStep();
    const trapRes = window.ff.traps.check(mapId, state.px, state.py);
    if (trapRes.ok) {
      log(trapRes.line);
      for (const e of trapRes.effects) {
        if (e.type === "damage") log(e.member.name + " takes " + e.amount + " damage from the trap!");
        else if (e.type === "status") log(e.member.name + " is afflicted with " + e.status + "!");
        else if (e.type === "drainGold") log("The trap costs you " + e.amount + " gold.");
      }
    }
    // Task #147: standing on lava/acid burns the party (unless gear protects).
    const hz = window.ff.hazards.step(mapId, state.px, state.py);
    if (hz.ok) {
      if (hz.protected) {
        log("The " + hz.zone.name + " seethes — but your gear holds it at bay.");
      } else {
        log(hz.line);
        for (const e of hz.events) {
          if (e.type === "damage") log(e.member.name + " takes " + e.amount + " damage from the " + hz.zone.name + ".");
          else if (e.type === "status") log(e.member.name + " is afflicted with " + e.status + "!");
        }
      }
    }
    const enc = window.ff.encounters.onStep(mapId, 1);
    if (enc) {
      startBattle(enc);
      return;
    }
    if (checkWorldInteraction()) return;
    // Task #150: the mid-game plot twist can fire on any step once its flags
    // are met — it rewrites the party goal and the quest log headline.
    for (const tw of window.ff.plotTwists.check()) {
      if (tw.type === "fired") log("PLOT TWIST: " + tw.twist.name + " — the party's goal changes!");
      else if (tw.type === "resolved") log("The conspiracy resolves — the quest log returns to the main road.");
    }
    // Task #135: low-probability non-combat events on the overworld.
    const ev = window.ff.randomEvents.roll(mapId);
    if (ev) {
      const r = window.ff.randomEvents.resolve(ev);
      log(r.message);
      if (r.itemId) log("Found: " + r.itemId + " x" + (r.count ?? 1) + ".");
      if (r.amount) log("+" + r.amount + " gold.");
      renderGrid();
      return;
    }
  } else {
    // Task #149: walking INTO a solid tile may reveal a secret wall.
    const d = DIRS[state.player.facing] ?? null;
    if (d) {
      const sec = window.ff.secretWalls.probe(mapId, state.px + d.dx, state.py + d.dy);
      if (sec.ok) {
        log(sec.line);
        for (const e of sec.effects) {
          if (e.type === "path") log("A hidden passage grinds open through the wall!");
          else if (e.type === "chest") {
            log(
              "Hidden cache! " +
                (e.items.length ? e.items.map((i) => i.itemId + " x" + i.count).join(", ") : "") +
                (e.gold ? " +" + e.gold + " gold" : "") +
                (e.xp ? " +" + e.xp + " XP" : "")
            );
          }
        }
        renderGrid();
        return;
      }
    }
  }
  renderGrid();
}

function checkWorldInteraction() {
  const mapId = currentMapId();
  const ff = window.ff;
  // Task #74: overworld event triggers (boss battles, dialogue, travel grants).
  const we = ff.worldEvents.pending(mapId, state.px, state.py, "step");
  if (we) {
    handleWorldEvent(we);
    renderGrid();
    return true;
  }
  // Task #108: stepping on a secret tile reveals a hidden NPC.
  const disc = ff.npcs.tryDiscover(mapId, state.px, state.py);
  if (disc && disc.ok) {
    log("A hidden figure stirs — " + disc.npc.name + "!");
    renderGrid();
    return true;
  }
  // Task #198: gates block movement until their requirement is met — the
  // tide-door, the permafrost mouth, the rift, and the Hall of Trials' door.
  const gate = ff.gates.gateAt(mapId, state.px, state.py);
  if (gate) {
    const pass = ff.gates.canPass(mapId, state.px, state.py);
    if (!pass.allowed) {
      log(pass.reason || "The way is blocked.");
      renderGrid();
      return true;
    }
  }
  // Task #153: narrative pacing gates — "Wait" until mid-game flags are met.
  const pg = ff.pacingGates.gateAt(mapId, state.px, state.py);
  if (pg) {
    const pass = ff.pacingGates.canPass(mapId, state.px, state.py);
    if (!pass.allowed) {
      log(pass.reason || "Wait — the way is not yet open.");
      renderGrid();
      return true;
    }
  }
  // Task #103: the sealed crystal gates of the eastern sea — a message
  // teaches how many crystals are still needed.
  const wsGate = ff.worldState.sealedGateAt(mapId, state.px, state.py);
  if (wsGate) {
    log(wsGate.label);
    renderGrid();
    return true;
  }
  // Task #134: an open shortcut (flag/key met) skips the redundant path.
  const sh = ff.shortcuts.active(mapId, state.px, state.py);
  if (sh) {
    log(sh.flavor);
    moveToMap(sh.to.mapId, sh.to.x, sh.to.y, sh.to.facing);
    return true;
  }
  // Town/dungeon entrances on the world map (transition links).
  const link = ff.transitions.findLink(mapId, state.px, state.py);
  if (link && !state.inCave && !state.inBuilding) {
    const toDungeon = ff.dungeons.dungeonForMap(link.toMap);
    if (toDungeon) {
      log("You descend into " + (ff.maps.get(link.toMap)?.name ?? link.toMap) + ".");
      enterDungeon(link.toMap, link.toX, link.toY);
    } else {
      log("You enter " + (ff.maps.get(link.toMap)?.name ?? link.toMap) + ".");
      state.inTown = link.toMap;
      moveToMap(link.toMap, link.toX, link.toY, link.facing ?? "S");
    }
    return true;
  }
  const sw = ff.puzzles.switchAt(mapId, state.px, state.py);
  if (sw) {
    const r = ff.puzzles.press(mapId, state.px, state.py);
    if (r.ok) log(r.solved ? "A hidden switch clicks — a door grinds open!" : "Switch pressed (" + r.pressed + "/" + r.required + ").");
    else log("Switch: " + r.error);
    renderGrid();
    return true;
  }
  const chest = ff.chests.chestAt(mapId, state.px, state.py);
  if (chest) {
    const r = ff.chests.open(mapId, state.px, state.py);
    if (r.ok) log("Chest opened! " + (r.items.length ? r.items.map((i) => i.itemId + " x" + i.count).join(", ") : "") + (r.gold ? " +" + r.gold + " gold" : "") + (r.xp ? " +" + r.xp + " XP" : ""));
    else log("Chest: " + r.error);
    renderGrid();
    return true;
  }
  const dungeonId = ff.dungeons.dungeonForMap(mapId)?.id;
  if (dungeonId) {
    const stairs = ff.dungeons.useStairs(dungeonId, mapId, state.px, state.py);
    if (stairs) {
      log("Stairs descend into " + ff.dungeons.currentLevelName() + ".");
      moveToMap(stairs.to.mapId, stairs.to.x, stairs.to.y, stairs.to.facing);
      return true;
    }
    const exit = ff.dungeons.exit(dungeonId, mapId, state.px, state.py);
    if (exit) {
      log("You emerge from the caves.");
      state.inCave = false;
      state.leaveBtn.hidden = true;
      state.enterBtn.hidden = false;
      state.travelRow.hidden = false;
      moveToMap(exit.to.mapId, exit.to.x, exit.to.y, exit.to.facing);
      return true;
    }
  }
  if (!state.inCave && !state.inBuilding) {
    const bEnter = ff.buildings.enter(mapId, state.px, state.py);
    if (bEnter) {
      log("You step into the " + bEnter.name + ".");
      state.inBuilding = bEnter.mapId;
      moveToMap(bEnter.mapId, bEnter.x, bEnter.y, bEnter.facing);
      return true;
    }
  }
  if (state.inBuilding) {
    const et = ff.buildings.exitTile(state.inBuilding);
    if (et && et.x === state.px && et.y === state.py) {
      const bExit = ff.buildings.exit(state.inBuilding);
      if (bExit) {
        log("You leave the building.");
        state.inBuilding = null;
        state.mapName = ff.maps.get(bExit.mapId)?.name ?? bExit.mapId;
        moveToMap(bExit.mapId, bExit.x, bExit.y, bExit.facing);
        return true;
      }
    }
  }
  return false;
}

function moveToMap(mapId, x, y, facing = "S") {
  const from = currentMapId();
  if (mapId === "overworld") state.inTown = null;
  setPlayerAt(mapId, x, y, facing);
  state.mapName = (window.ff.maps.get(mapId)?.name) ?? mapId;
  window.game.state.setLocation(mapId, x, y, facing);
  // Task #162/#160: fold the running session into the playtime total, then
  // quick-save on every map-ID change.
  window.ff.playtime?.recordSession();
  const qs = window.ff.autosave?.onTransition(from, mapId, window.game);
  if (qs?.ok) log("(Auto-save: " + from + " → " + mapId + ".)");
  window.ff.fog.resetAll();
  if (mapId === "overworld") {
    // Task #137: re-hydrate the persisted overworld explored set.
    window.ff.worldFog.restore();
  }
  window.ff.fog.discoverRadius(mapId, x, y, 2);
  // Task #226: area music follows the map.
  window.ff.music?.setLocation(mapId);
  renderGrid();
  // Task #120: crossing a region boundary dips the screen (fade out/in) so
  // the new region "arrives" — fire-and-forget, the swap already happened.
  if (window.ff.regionTransitions?.isRegionChange(from, mapId)) {
    const st = window.ff.screenTransitions;
    if (st && !st.isRunning()) st.transition(null, { duration: 160 });
  }
}

function startBattle(enc, onWin = null) {
  battle = { enemies: enc.enemies, groupId: enc.groupId, onWin };
  // Task #127: each battle runs a combat state machine (Waiting for Input
  // -> Executing Action -> Resolving Damage -> End of Round -> ...).
  battle.states = new window.systems.CombatStateMachine();
  for (const e of battle.enemies) window.ff.bossPhases.reset(e);
  // Task #157/#158: the target cursor locks onto the enemy party and the
  // turn-order sidebar lists every combatant.
  window.ff.targetCursor.bind(battle.enemies);
  window.ff.turnQueueView.build([...window.game.party.members, ...battle.enemies], window.game.party.members);
  renderTurnQueue();
  // Task #138: a battle takes an hour of in-game time.
  window.ff.gameClock.advanceBattle();
  window.ff.sounds.trigger("battleStart");
  // Task #226: the battle theme (or boss theme) takes over.
  window.ff.music?.setBattle({ active: true, boss: battle.enemies.some((e) => e.boss) });
  typedLog(["--- A " + enc.groupId.replace(/_/g, " ") + " attacks! ---", enc.enemies.map((e) => e.name).join(", ")]);
  state.actionsEl.hidden = false;
  state.turnQueueEl.hidden = false;
  renderGrid();
  renderEnemies();
}

// Task #158: the turn-order sidebar — upcoming turns, party blue, enemy red.
function renderTurnQueue() {
  if (!battle) return;
  if (!window.ff.turnQueueView.items().length) return;
  const parts = window.ff.turnQueueView
    .items()
    .map((i) => {
      const cls = i.active ? "tq-cur" : i.side === "party" ? "tq-party" : "tq-enemy";
      return '<span class="' + cls + '">' + i.name + "</span>";
    })
    .join(" → ");
  state.turnQueueEl.innerHTML = "Next: " + parts;
}

function renderEnemies() {
  if (!battle) return;
  const alive = battle.enemies.filter((e) => e.hp > 0);
  // Task #157: enemies render as clickable target rows; the selected row is
  // marked ▶ and every enemy the attack will fan out to is highlighted.
  const markers = window.ff.targetCursor.markers(window.game.party.members[0]);
  state.enemyEl.innerHTML = alive.length
    ? markers
        .map((m) => {
          const cls = "target-row" + (m.selected ? " sel" : m.struck ? " struck" : "") + (m.dead ? " dead" : "");
          return (
            '<button class="' + cls + '" data-idx="' + m.index + '">' +
            (m.selected ? "▶ " : "") +
            (m.struck ? "* " : "  ") +
            m.enemy.name +
            " HP " + Math.max(0, m.enemy.hp) +
            (m.enemy.boss ? " [BOSS]" : "") +
            "</button>"
          );
        })
        .join("")
    : "No enemies remaining.";
  state.enemyEl.querySelectorAll(".target-row:not(.dead)").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.idx);
      const cur = window.ff.targetCursor.selected;
      window.ff.targetCursor.bind(battle.enemies);
      while (window.ff.targetCursor.selected !== battle.enemies[idx] && window.ff.targetCursor.aliveCount()) {
        window.ff.targetCursor.next();
      }
      const moved = window.ff.targetCursor.selected !== cur;
      renderEnemies();
      renderTurnQueue();
      if (moved) log("Target: " + window.ff.targetCursor.selected.name + ".");
    });
  });
  state.statusEl.textContent = hudText();
}

function endBattle() {
  const alive = battle.enemies.filter((e) => e.hp > 0);
  const partyAlive = window.game.party.members.filter((m) => m.isAlive()).length;
  if (alive.length === 0) {
    const result = window.ff.rewards.resolve(battle.enemies);
    // Task #127: terminal state on a win.
    battle.states?.finish("victory");
    window.ff.sounds.trigger(result.levelUps.length ? "levelUp" : "victory");
    // Task #226: battle ends, then the victory fanfare plays and area music resumes.
    window.ff.music?.setBattle({ active: false });
    window.ff.music?.victory();
    log("Victory! " + window.ff.rewards.summarize(result));
    if (battle.onWin?.flag) {
      window.game.state.setFlag(battle.onWin.flag, true);
      log("Story flag set: " + battle.onWin.flag);
    }
    // Task #100: the plot chain narrates boss victories; only fall back to the
    // world event's dialogue if no chapter fired (e.g. chain not yet reached).
    const plotFired = advancePlot();
    if (battle.onWin?.dialogueId && !plotFired) sayDialogue(battle.onWin.dialogueId);
    if (battle.onWin?.onVictory) battle.onWin.onVictory();
    advanceStory();
    // Task #102: boss victories restore crystals through the plot chain — the
    // diff fires the world's reaction (flash, lore, bridge/gate updates).
    window.ff.crystals.check();
    // Task #150: boss wins can complete the plot twist's triggers — a fired
    // twist rewrites the party goal and the quest log headline.
    for (const tw of window.ff.plotTwists.check()) {
      if (tw.type === "fired") log("PLOT TWIST: " + tw.twist.name + " — the party's goal changes!");
      else if (tw.type === "resolved") log("The conspiracy resolves — the quest log returns to the main road.");
    }
    // Task #163: beating the story can unlock post-game content (secret
    // bosses, item hunts) — the check fires once per new unlock.
    for (const d of window.ff.postgame.check()) {
      log("POST-GAME: " + d.name + " is now available — " + d.hint);
    }
    // Task #145: after every win, high-tier gear rolls its break chance.
    const wear = window.ff.gearDurability.afterBattleParty(window.game.party.members);
    for (const e of wear) {
      log(e.name + "'s " + e.itemName + (e.broken ? " SHATTERS — it grants no bonuses until repaired!" : " takes a beating (" + e.durability + "/" + e.max + ")."));
    }
    battle = null;
    state.actionsEl.hidden = true;
    state.enemyEl.textContent = "";
    state.turnQueueEl.hidden = true;
    state.turnQueueEl.textContent = "";
  } else if (partyAlive === 0) {
    // Task #127: terminal state on a wipe.
    battle.states?.finish("defeat");
    window.ff.sounds.trigger("defeat");
    // Task #226: the requiem plays once, then area music resumes for the revival.
    window.ff.music?.setBattle({ active: false });
    window.ff.music?.gameOver();
    const go = window.ff.gameOver.handleGameOver();
    if (go.status === "revived") {
      log("The party has fallen... and is revived at the " + go.location.name + " at half strength.");
      log("Gold was halved in the rescue. Rise again, heroes — the quest continues.");
    } else {
      log("The party has fallen... The adventure ends here.");
    }
    battle = null;
    state.actionsEl.hidden = true;
    state.enemyEl.textContent = "";
    state.turnQueueEl.hidden = true;
    state.turnQueueEl.textContent = "";
  }
  renderGrid();
}

function onAttack() {
  const hero = window.game.party.members[0];
  // Task #157: strike the enemy under the target cursor (refresh skips dead).
  const target = window.ff.targetCursor.refresh();
  if (!hero.isAlive() || !target) return;
  window.ff.sounds.trigger("attack");
  // Task #127: Waiting for Input -> Executing Action -> Resolving Damage.
  battle.states.startAction();
  const cr = makeCombat();
  cr.begin(window.game.party.members, battle.enemies);
  // Task #129: attacks fan out to 1-4 enemies by weapon type + level.
  const res = cr.multiAttack(hero, battle.enemies);
  battle.states.resolveDamage();
  window.ff.sounds.trigger(res.allMissed ? "miss" : "hit");
  for (const m of res.messages) log(m);
  if (res.targets.length > 1) log(hero.name + " strikes " + res.targets.length + " enemies at once!");
  // Task #156: every hit becomes a popup spec + a round summary banner.
  res.hits.forEach((h, i) => {
    const ox = state.px + 1 + (i % 3);
    const oy = state.py + 1 + Math.floor(i / 3);
    const spec = window.ff.hitIndicators.popupSpec(h);
    window.ff.damagePopups.add(ox, oy, spec.text, { kind: spec.kind });
  });
  const banner = window.ff.hitIndicators.summarize(res.hits);
  if (banner.dramaticLine) log(banner.dramaticLine);
  enemyTurn();
  renderEnemies();
  renderTurnQueue();
}

function onFiraga() {
  const mage = window.game.party.members.find((m) => m.classId === "blackMage");
  if (!mage || !mage.isAlive()) return log("The mage is unable to act.");
  window.ff.sounds.trigger("spell");
  // Task #127: Waiting for Input -> Executing Action.
  battle.states.startAction();
  const res = window.ff.spellcasting.cast(mage, "firaga", window.game.party.members, battle.enemies, null);
  if (!res.ok) return log("Firaga failed: " + res.error);
  battle.states.resolveDamage();
  flashVisual("firaga");
  // Task #130: each execution line is sync'd to its animation frame.
  const lines = [
    mage.name + " casts Firaga! (" + res.mpCost + " MP)",
    ...res.results.map((r) => r.target.name + " takes " + r.damage + " damage" + (r.weak ? " — weak!" : r.resisted ? " — resisted." : r.immune ? " — immune!" : ".")),
  ];
  for (const s of window.ff.spellAnimationSync.timelineForText("firaga", lines)) {
    log("(frame " + s.frame + ") " + s.text);
  }
  // Task #155: floating damage numbers per target.
  res.results.forEach((r, i) => {
    window.ff.damagePopups.add(state.px + 1 + (i % 3), state.py + 1 + Math.floor(i / 3), "-" + r.damage, { kind: r.weak ? "crit" : "damage" });
  });
  enemyTurn();
  renderEnemies();
}

// Task #63 demo: Water soaks an enemy, then Thunder deals boosted damage.
function onWater() {
  const mage = window.game.party.members.find((m) => m.classId === "blackMage");
  const target = battle.enemies.filter((e) => e.hp > 0)[0];
  if (!mage || !mage.isAlive()) return log("The mage is unable to act.");
  if (!target) return log("No enemy to soak.");
  const res = window.ff.spellcasting.cast(mage, "water", window.game.party.members, battle.enemies, target);
  if (!res.ok) return log("Water failed: " + res.error);
  // Task #127: action executed -> damage resolving.
  battle.states.startAction();
  battle.states.resolveDamage();
  log(mage.name + " casts Water! (" + res.mpCost + " MP)");
  flashVisual("water");
  const r = res.results[0];
  log(target.name + " takes " + r.damage + " damage" + (r.inflicted ? " and is soaked with water!" : "."));
  enemyTurn();
  renderEnemies();
}

function onThunder() {
  const mage = window.game.party.members.find((m) => m.classId === "blackMage");
  const target = battle.enemies.filter((e) => e.hp > 0)[0];
  if (!mage || !mage.isAlive()) return log("The mage is unable to act.");
  if (!target) return log("No enemy to strike.");
  const res = window.ff.spellcasting.cast(mage, "thunder", window.game.party.members, battle.enemies, target);
  if (!res.ok) return log("Thunder failed: " + res.error);
  // Task #127: action executed -> damage resolving.
  battle.states.startAction();
  battle.states.resolveDamage();
  log(mage.name + " casts Thunder! (" + res.mpCost + " MP)");
  flashVisual("thunder");
  const r = res.results[0];
  log(target.name + " takes " + r.damage + " damage" + (r.synergy > 1 ? " — the wet body conducts! (" + r.synergy + "x)" : "."));
  enemyTurn();
  renderEnemies();
}

function onRun() {
  const cr = makeCombat();
  cr.begin(window.game.party.members, battle.enemies);
  const res = cr.tryRun();
  log(res.ok ? "The party fled!" : "Could not escape!");
  if (res.ok) {
    battle = null;
    state.actionsEl.hidden = true;
    state.enemyEl.textContent = "";
    state.turnQueueEl.hidden = true;
    state.turnQueueEl.textContent = "";
    renderGrid();
  } else {
    enemyTurn();
    renderEnemies();
    renderTurnQueue();
  }
}

function enemyTurn() {
  const party = window.game.party.members;
  const cr = makeCombat();
  cr.begin(party, battle.enemies);
  for (const e of battle.enemies) {
    if (e.hp <= 0) continue;
    const ph = window.ff.bossPhases.checkPhase(e);
    if (ph) {
      for (const t of ph.transitions) log("!" + e.name + " " + t.name + "! Its power surges...");
    }
    const t = window.ff.enemyAI.turn(e, party, battle.enemies, { combat: cr });
    if (t.action.blocked) {
      log(e.name + " is " + t.action.status + " and cannot act.");
      continue;
    }
    for (const m of t.result.messages) log(m);
    // Task #156: incoming damage floats over the party via the indicator spec.
    const spec = window.ff.hitIndicators.popupSpec(t.result);
    window.ff.damagePopups.add(state.px, state.py, spec.text, { kind: spec.kind });
    const banner = window.ff.hitIndicators.summarize([t.result]);
    if (banner.dramaticLine) log(banner.dramaticLine);
    if (!party.some((p) => p.isAlive())) break;
  }
  const regen = window.ff.manaRegen.tick(party);
  if (regen.length) log("MP recovers: " + regen.map((r) => r.id + " +" + r.restored).join(", ") + ".");
  const statusEvents = window.ff.status.tickAll([...party, ...battle.enemies]);
  for (const ev of statusEvents) {
    if (ev.type === "damage") log(ev.target.name + " suffers " + ev.amount + " damage from " + ev.name + "!");
    else if (ev.type === "woreOff") log(ev.target.name + "'s " + ev.name + " wore off.");
  }
  // Task #128: buff/debuff timers tick down a turn each round.
  const buffEvents = window.ff.buffs.tickAll([...party, ...battle.enemies]);
  for (const ev of buffEvents) {
    if (ev.type === "woreOff") log(ev.target.name + "'s " + ev.name + " wore off.");
  }
  // Task #127: Resolving Damage -> End of Round -> Waiting for Input.
  if (battle.states) {
    const endR = battle.states.endRound();
    if (endR.ok) log("--- End of round " + endR.round + " ---");
  }
  endBattle();
  // Task #158: after every round the sidebar re-rolls from the survivors.
  renderTurnQueue();
}

function onPotion() {
  window.ff.sounds.trigger("item");
  const res = window.ff.consumables.use("potion");
  if (!res.ok) return log("Potion: " + res.error);
  log("Potion used on " + res.targetId + " — recovers " + (res.healed ?? res.restored ?? "some") + " HP/MP.");
  // Task #155: healing floats up green.
  window.ff.damagePopups.add(state.px, state.py, "+" + (res.healed ?? res.restored ?? 0), { kind: "heal" });
  renderGrid();
}

let statusMenu = null;
function logMemberStats(m) {
  const s = m.getStats();
  const d = window.ff.equipStats.derive(m);
  log(m.name + " (Lv" + m.level + " " + (m.class?.name ?? m.classId) + ") HP " + m.hp + "/" + s.maxHp + " MP " + m.mp + "/" + s.maxMp + " | ATK " + d.attack + " MAG " + d.magicAttack + " DEF " + d.defense + " MDEF " + d.magicDefense + " SPD " + d.speed);
  // Task #143: hidden gear-set bonuses show on the status panel.
  const sets = window.ff.gearSets.activeBonuses(m);
  for (const b of sets) {
    const mods = Object.entries(b.mods).map(([k, v]) => "+" + v + " " + k.toUpperCase()).join(", ");
    log("  " + b.set.name + " bonus (" + b.owned + "/" + b.set.pieces.length + " pieces): " + mods);
  }
}

function onStatus() {
  window.ff.sounds.trigger("menuSelect");
  if (!statusMenu) {
    const members = window.game.party.members;
    statusMenu = new window.systems.MenuSystem({ rememberRoot: true });
    statusMenu.open({
      title: "Status",
      items: members.map((m) => ({ id: m.id, label: m.name, hint: m.class?.name ?? m.classId })),
    });
    log("Status menu open — press W/S or click again to cycle members.");
    if (members[0]) logMemberStats(members[0]);
    return;
  }
  const moved = statusMenu.navigate("down") ?? statusMenu.navigate(0);
  if (!moved) return log("Status menu closed.");
  const m = window.game.party.members.find((x) => x.id === moved.id);
  if (m) logMemberStats(m);
}

function enterDungeon(mapId, toX, toY, facing = "N") {
  state.inBuilding = null;
  state.inCave = true;
  state.mapName = window.ff.maps.get(mapId)?.name ?? mapId;
  window.game.state.setLocation(mapId, toX, toY, facing);
  setPlayerAt(mapId, toX, toY, facing);
  window.ff.fog.resetAll();
  window.ff.fog.discoverRadius(mapId, toX, toY, 2);
  window.ff.encounters.reset();
  state.leaveBtn.hidden = false;
  state.enterBtn.hidden = true;
  state.travelRow.hidden = true;
  renderGrid();
}

function enterCave() {
  const t = window.ff.transitions.transitionTo(MAP_ID, START.x, START.y, "N");
  if (!t) return log("Cannot enter the caves.");
  state.mapName = "Caves of Cornelia";
  enterDungeon(t.to.mapId, t.to.x, t.to.y, "N");
  log("You descend into the Caves of Cornelia (exit remembered: overworld " + t.from.x + "," + t.from.y + ").");
}

function leaveCave() {
  state.inBuilding = null;
  const t = window.ff.transitions.exitInterior();
  if (!t) return;
  state.mapName = "World Map";
  window.game.state.setLocation(t.to.mapId, t.to.x, t.to.y, t.to.facing);
  setPlayerAt(t.to.mapId, t.to.x, t.to.y, t.to.facing);
  state.inCave = false;
  state.leaveBtn.hidden = true;
  state.enterBtn.hidden = false;
  state.travelRow.hidden = false;
  // Task #137: returning to the overworld restores its persisted fog.
  window.ff.worldFog.restore();
  window.ff.fog.discoverRadius("overworld", t.to.x, t.to.y, 2);
  log("You surface at overworld (" + t.to.x + "," + t.to.y + ") — world-map movement is 2 tiles/step (scale " + moverFor("overworld").scale + ").");
  renderGrid();
}

function setTravel(mode) {
  if (state.inCave) return;
  const ff = window.ff;
  if (!ff.travel.canUse(mode)) {
    const req = ff.travel.requirement(mode);
    if (req) log(req.deniedDialogue + " " + req.hint);
    else log("You cannot use that travel mode yet.");
    return;
  }
  state.player.setTravelMode(mode);
  log(
    mode === "ship"
      ? "The party boards the ship — it sails across water!"
      : mode === "air"
      ? "The airship takes flight — terrain no longer blocks you!"
      : "The party travels on foot again."
  );
  renderGrid();
}

function switchShop(id) {
  shopTarget = window.ff.shops[id];
  shopUI.setShop(shopTarget);
  shopUI.render();
}

function refreshForge() {
  const el = document.getElementById("rpgForge");
  if (!el || el.hidden) return;
  const ff = window.ff;
  const recipeSel = document.getElementById("rpgRecipe");
  const itemSel = document.getElementById("rpgItem");
  const enchantSel = document.getElementById("rpgEnchant");
  if (!recipeSel) return;
  const sel = recipeSel.value;
  recipeSel.innerHTML = "";
  for (const r of ff.crafting.all()) {
    const rep = ff.crafting.progressReport(r.id);
    const opt = document.createElement("option");
    opt.value = r.id;
    opt.textContent = r.name + (rep.craftable ? " ✔" : " (" + rep.missing.map((m) => m.name + " x" + (m.needed - m.have)).join(", ") + ")" + (rep.goldCost ? " " + rep.goldCost + "g" : ""));
    recipeSel.appendChild(opt);
  }
  if (sel) recipeSel.value = sel;
  const selItem = itemSel.value;
  itemSel.innerHTML = "";
  for (const e of window.game.inventory.list()) {
    const item = window.game.inventory.item(e.id);
    if (!item || (item.type !== "weapon" && item.type !== "armor" && item.type !== "accessory")) continue;
    const opt = document.createElement("option");
    opt.value = e.id;
    opt.textContent = item.name + (ff.enchanting.isEnchanted(e.id) ? " [ENCHANTED]" : "");
    itemSel.appendChild(opt);
  }
  if (selItem) itemSel.value = selItem;
  const selEn = enchantSel.value;
  enchantSel.innerHTML = "";
  for (const e of ff.enchanting.all()) {
    const opt = document.createElement("option");
    opt.value = e.id;
    const gems = window.game.inventory.count(e.gem);
    opt.textContent = e.name + " (" + gems + " gem" + (gems === 1 ? "" : "s") + ", " + e.goldCost + "g)";
    enchantSel.appendChild(opt);
  }
  if (selEn) enchantSel.value = selEn;
}

function onForgeCraft() {
  const id = document.getElementById("rpgRecipe").value;
  const res = window.ff.crafting.craft(id);
  if (res.ok) log("Forged " + window.game.inventory.item(res.result.item).name + " x" + res.result.count + (res.goldCost ? " for " + res.goldCost + "g" : "") + "!");
  else log("Forge: " + res.error);
  renderGrid();
}

function onForgeEnchant() {
  const itemId = document.getElementById("rpgItem").value;
  const enchId = document.getElementById("rpgEnchant").value;
  const res = window.ff.enchanting.enchant(itemId, enchId);
  if (res.ok) log("The " + window.game.inventory.item(itemId).name + " glows with " + res.name + "!");
  else log("Gem Cutter: " + res.error);
  renderGrid();
}

function mount() {
  if (document.getElementById("rpgDemo")) return;
  const style = document.createElement("style");
  style.textContent = `
    #rpgDemo { position: fixed; inset: 0; display: flex; gap: 16px; align-items: flex-start; justify-content: center; padding: 18px; background: #05060f; z-index: 10; color: #e8eefc; font-family: monospace; }
    #rpgDemo .panel { background: #0a0e1e; border: 2px solid #39456e; padding: 12px; }
    #rpgDemo .hud { font-size: 13px; white-space: pre-line; line-height: 1.5; color: #cfe0ff; margin-bottom: 8px; }
    #rpgDemo .minimap { margin-bottom: 6px; }
    #rpgDemo .minimap canvas { width: 135px; height: 108px; image-rendering: pixelated; }
    #rpgDemo .grid { display: grid; gap: 1px; background: #000; padding: 4px; }
    #rpgDemo .cell { width: 18px; height: 18px; background: #05070f; color: #2a3550; display: flex; align-items: center; justify-content: center; font-size: 9px; }
    #rpgDemo .cell.on { background: #14204a; color: #3d6a3a; }
    #rpgDemo .cell.wall { color: #7a5a2a; }
    #rpgDemo .cell.water { background: #0a2a4a; color: #3d8ac8; }
    #rpgDemo .cell.mountain { background: #2a2010; color: #8a7a4a; }
    #rpgDemo .cell.ice { background: #cfe0ee; color: #4a6a92; }
    #rpgDemo .cell.waystone { background: #16244a; color: #7fd4ff; font-weight: bold; text-shadow: 0 0 4px #3a9fe0; }
    #rpgDemo .cell.echo { background: #2a1240; color: #e07fff; font-weight: bold; text-shadow: 0 0 5px #9a2ac0; }
    #rpgDemo .cell.bridge { background: #2a3320; color: #d8d890; font-weight: bold; text-shadow: 0 0 4px #aab45a; }
    #rpgDemo .cell.dark { background: #020308; color: #0b0f1c; }
    #rpgDemo .cell.door { color: #ffd24a; font-weight: bold; text-shadow: 0 0 4px #a86a1a; }
    #rpgDemo .cell.lit { color: #ff9a3d; font-weight: bold; text-shadow: 0 0 4px #ff6a1a; }
    #rpgDemo .cell.npc { color: #ffd9a0; }
    #rpgDemo .cell.player { color: #ffd24a; font-weight: bold; background: #2a2200; }
    #rpgDemo .log { width: 340px; height: 240px; overflow-y: auto; font-size: 12px; line-height: 1.45; }
    #rpgDemo .log div { margin: 1px 0; }
    #rpgDemo .btns { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
    #rpgDemo button { background: #1b2440; color: #cfe0ff; border: 1px solid #39456e; padding: 5px 10px; cursor: pointer; font-family: monospace; font-size: 12px; }
    #rpgDemo button:hover { background: #2a3b6e; }
    #rpgDemo button.act { background: #4a3a08; color: #ffd24a; border-color: #8a6a1a; }
    #rpgDemo .enemy { color: #ff8a8a; font-size: 12px; min-height: 16px; margin-top: 6px; }
    #rpgDemo .target-row { display: block; width: 100%; text-align: left; background: none; border: 1px solid transparent; color: #ff8a8a; font-family: monospace; font-size: 12px; padding: 2px 4px; cursor: pointer; margin: 1px 0; }
    #rpgDemo .target-row:hover { background: #161f3e; }
    #rpgDemo .target-row.sel { border-color: #ffd24a; color: #ffd24a; }
    #rpgDemo .target-row.struck { color: #ffe9a0; }
    #rpgDemo .target-row.dead { color: #5a4a52; text-decoration: line-through; cursor: default; }
    #rpgDemo .turnqueue { font-size: 11px; color: #8fa8e8; min-height: 15px; margin-top: 4px; padding: 3px 6px; border: 1px dashed #2a3b6e; }
    #rpgDemo .turnqueue .tq-party { color: #7fd4ff; }
    #rpgDemo .turnqueue .tq-enemy { color: #ff8a8a; }
    #rpgDemo .turnqueue .tq-cur { color: #ffd24a; font-weight: 700; }
    #rpgDemo .shopwrap { width: 340px; }
    #rpgDemo .forgewrap { width: 340px; }
    #rpgDemo .waywrap { width: 340px; }
    #rpgDemo .savewrap { width: 340px; }
    #rpgDemo .menuwrap { width: 340px; }
    #rpgDemo .menu-list { max-height: 300px; overflow-y: auto; font-size: 12px; }
    #rpgDemo .menu-row { display: flex; justify-content: space-between; gap: 8px; padding: 4px 6px; border-bottom: 1px solid #141c36; cursor: pointer; }
    #rpgDemo .menu-row:hover { background: #161f3e; }
    #rpgDemo .menu-row.sel { background: #2a3b6e; color: #ffd24a; }
    #rpgDemo .menu-row.dis { opacity: .45; cursor: default; }
    #rpgDemo .menu-row.dis:hover { background: transparent; }
    #rpgDemo .menu-row .menu-hint { color: #8a9ac0; font-size: 11px; text-align: right; }
    #rpgDemo .menu-row.sel .menu-hint { color: #ffd9a0; }
    #rpgDemo .menu-msg { margin-top: 6px; color: #ffd9a0; font-size: 11px; min-height: 14px; }
    #rpgDemo .nowplaying { position: absolute; top: 10px; left: 50%; transform: translateX(-50%); font-size: 11px; color: #8a9ac0; letter-spacing: 1px; pointer-events: none; }
    #rpgDemo .rpgSaveSlot { display: block; width: 100%; text-align: left; margin: 4px 0; }
    #rpgDemo .rpgSaveSlot .rpgSaveLabel { color: #ffd24a; font-weight: 700; }
    #rpgDemo .rpgSaveSlot.empty .rpgSaveLabel { color: #8a9ac0; }
    #rpgDemo .rpgSaveSlot .rpgSaveMeta { color: #cfe0ff; font-size: 11px; }
    #rpgDemo select { background: #141c36; color: #cfe0ff; border: 1px solid #39456e; padding: 4px; font-family: monospace; font-size: 12px; max-width: 220px; }
  `;
  document.head.appendChild(style);
  const el = document.createElement("div");
  el.id = "rpgDemo";
  el.hidden = true;
  el.innerHTML = `
    <div class="panel">
      <div class="hud" id="rpgHud"></div>
      <div class="minimap" id="rpgMiniMap"></div>
      <div class="grid" id="rpgGrid"></div>
      <div class="enemy" id="rpgEnemy"></div>
      <div class="turnqueue" id="rpgTurnQueue" hidden></div>
      <div class="btns">
        <button class="act" id="rpgAttack">Attack</button>
        <button class="act" id="rpgFiraga">Firaga (AoE)</button>
        <button class="act" id="rpgWater">Water</button>
        <button class="act" id="rpgThunder">Thunder</button>
        <button class="act" id="rpgPotion">Potion</button>
        <button class="act" id="rpgStatus">Status</button>
        <button class="act" id="rpgRun">Run</button>
      </div>
      <div class="btns" id="rpgTravel">
        <button id="rpgLand">Walk</button>
        <button id="rpgShip">Board Ship</button>
        <button id="rpgAir">Airship</button>
        <button id="rpgLight">Light: Off</button>
      </div>
      <div class="btns">
        <button id="rpgShopW">Weapon Shop</button>
        <button id="rpgShopI">Item Shop</button>
        <button id="rpgInn">Inn (40g)</button>
        <button id="rpgEnter">Enter Cave</button>
        <button id="rpgLeave">Leave Cave</button>
      </div>
      <div class="btns">
        <button id="rpgSave">Save (K)</button>
        <button id="rpgTitle">Return to Title</button>
      </div>
      <div class="btns">
        <button id="rpgMenuBtn">Menu (M)</button>
        <button id="rpgAudioBtn">Audio: Off</button>
      </div>
      <div class="btns">
        <button id="rpgSettingsBtn">Settings</button>
        <button id="rpgPostgameBtn">Post-Game</button>
        <button id="rpgScoreBtn">Score</button>
        <button id="rpgCreditsBtn">Credits</button>
      </div>
      <div class="nowplaying" id="rpgNowPlaying" hidden></div>
    </div>
    <div class="log panel" id="rpgLog"></div>
    <div class="shopwrap" id="rpgShop"></div>
    <div class="panel forgewrap" id="rpgForge">
      <div class="hud">The Artificer's Forge</div>
      <div class="btns">
        <select id="rpgRecipe"></select>
        <button id="rpgCraftBtn">Craft</button>
      </div>
      <div class="btns">
        <select id="rpgItem"></select>
        <select id="rpgEnchant"></select>
        <button id="rpgEnchantBtn">Enchant</button>
      </div>
    </div>
    <div class="panel waywrap" id="rpgWaystones">
      <div class="hud">Waystone Network</div>
      <div class="btns">
        <select id="rpgWaystoneDest"></select>
        <button id="rpgWaystoneGo">Travel</button>
      </div>
    </div>
    <div class="panel savewrap" id="rpgSavePanel" hidden>
      <div class="hud">Save to slot</div>
      <button class="rpgSaveSlot" data-slot="A"><span class="rpgSaveLabel">Slot A</span> <span class="rpgSaveMeta"></span></button>
      <button class="rpgSaveSlot" data-slot="B"><span class="rpgSaveLabel">Slot B</span> <span class="rpgSaveMeta"></span></button>
      <button class="rpgSaveSlot" data-slot="C"><span class="rpgSaveLabel">Slot C</span> <span class="rpgSaveMeta"></span></button>
      <div class="btns">
        <button id="rpgSaveClose">Back</button>
      </div>
    </div>
    <div class="panel menuwrap" id="rpgMenuPanel" hidden>
      <div class="hud" id="rpgMenuTitle">Command</div>
      <div class="menu-list" id="rpgMenuList"></div>
      <div class="menu-msg" id="rpgMenuMsg"></div>
      <div class="btns">
        <button id="rpgMenuClose">Close (Esc)</button>
      </div>
    </div>
  `;
  document.body.appendChild(el);
  state = {
    gridEl: el.querySelector("#rpgGrid"),
    statusEl: el.querySelector("#rpgHud"),
    logEl: el.querySelector("#rpgLog"),
    enemyEl: el.querySelector("#rpgEnemy"),
    turnQueueEl: el.querySelector("#rpgTurnQueue"),
    miniMapEl: el.querySelector("#rpgMiniMap"),
    actionsEl: el.querySelector("#rpgAttack").parentElement,
    travelRow: el.querySelector("#rpgTravel"),
    enterBtn: el.querySelector("#rpgEnter"),
    leaveBtn: el.querySelector("#rpgLeave"),
    savePanelEl: el.querySelector("#rpgSavePanel"),
    menuPanelEl: el.querySelector("#rpgMenuPanel"),
    menuTitleEl: el.querySelector("#rpgMenuTitle"),
    menuListEl: el.querySelector("#rpgMenuList"),
    menuMsgEl: el.querySelector("#rpgMenuMsg"),
    audioBtnEl: el.querySelector("#rpgAudioBtn"),
    nowPlayingEl: el.querySelector("#rpgNowPlaying"),
    px: 0, py: 0, mapName: "", inCave: false, inBuilding: null, inTown: null, lastWaystoneId: null, player: new GridEntity(0, 0, { facing: "S", id: "hero" }),
  };
  state.miniMap = new MiniMap(state.miniMapEl, { cell: 9 });
  // Task #155: floating combat numbers overlay the map grid.
  window.ff.damagePopups.attach(state.gridEl, { cell: 18 });
  // Task #161: settings' screen size scales the demo UI.
  window.ff.screenScale.bind(el);
  // Task #102: when a crystal is restored the world reacts — a flash of its
  // color, its lore, and the updated bridge/gate state.
  window.ff.crystals.onRestored((d) => {
    window.ff.screenTransitions.flash(d.color, 260);
    log(d.name + " restored — " + d.line);
    log(window.ff.worldState.describe());
  });
  state.actionsEl.hidden = true;
  state.leaveBtn.hidden = true;
  state.travelRow.hidden = true;
  shopUI = new ShopUI(el.querySelector("#rpgShop"), {
    onTrade: (shop, itemId, mode) => {
      const res = mode === "buy" ? shop.buy(itemId, 1) : shop.sell(itemId, 1);
      log(res.ok ? (mode === "buy" ? "Bought " + itemId + " for " + res.cost + "g." : "Sold " + itemId + " for " + res.gained + "g.") : mode + " failed: " + res.error);
      renderGrid();
    },
  });
  el.querySelector("#rpgAttack").addEventListener("click", onAttack);
  el.querySelector("#rpgFiraga").addEventListener("click", onFiraga);
  el.querySelector("#rpgWater").addEventListener("click", onWater);
  el.querySelector("#rpgThunder").addEventListener("click", onThunder);
  el.querySelector("#rpgPotion").addEventListener("click", onPotion);
  el.querySelector("#rpgStatus").addEventListener("click", onStatus);
  el.querySelector("#rpgRun").addEventListener("click", onRun);
  el.querySelector("#rpgShopW").addEventListener("click", () => switchShop("weapon"));
  el.querySelector("#rpgShopI").addEventListener("click", () => switchShop("item"));
  el.querySelector("#rpgLand").addEventListener("click", () => setTravel("land"));
  el.querySelector("#rpgShip").addEventListener("click", () => setTravel("ship"));
  el.querySelector("#rpgAir").addEventListener("click", () => setTravel("air"));
  // Task #148: strike the lantern (or trust the white mage's Light spell) to
  // push back the darkness of the haunted tower and the Time Rift.
  el.querySelector("#rpgLight").addEventListener("click", () => {
    const on = window.ff.lighting.toggleTorch();
    log(on ? "You strike the lantern — light cuts through the dark!" : "You shroud the lantern's flame.");
    el.querySelector("#rpgLight").textContent = "Light: " + (on ? "On" : "Off");
    renderGrid();
  });
  el.querySelector("#rpgInn").addEventListener("click", () => {
    const res = window.ff.inn.rest();
    if (res.ok) {
      log("The party rests. (" + res.cost + "g) HP and MP restored.");
      // Task #145: the inn also mends the party's battered high-tier gear.
      const repairs = window.ff.gearDurability.repairAllParty(window.game.party.members);
      for (const r of repairs) {
        if (r.ok) log("The smith repairs " + r.itemName + " (" + r.cost + "g).");
      }
      // Task #208: resting also autosaves to the active slot, if any.
      const au = window.ff.boot?.autosave();
      if (au?.ok) log("Progress saved to slot " + window.ff.boot.activeSlot + ".");
    } else {
      log("Inn: " + res.error);
    }
    renderGrid();
  });
  el.querySelector("#rpgEnter").addEventListener("click", enterCave);
  el.querySelector("#rpgLeave").addEventListener("click", leaveCave);
  // Task #179: the Artificer's Forge panel — craft recipes and enchant gear
  // straight from the demo.
  el.querySelector("#rpgCraftBtn").addEventListener("click", onForgeCraft);
  el.querySelector("#rpgEnchantBtn").addEventListener("click", onForgeEnchant);
  // Task #187: the Waystone Network panel — travel between lit stones.
  el.querySelector("#rpgWaystoneGo").addEventListener("click", travelToWaystone);
  // Task #208: the Save panel and Return to Title.
  el.querySelector("#rpgSave").addEventListener("click", toggleSavePanel);
  el.querySelector("#rpgSaveClose").addEventListener("click", () => { state.savePanelEl.hidden = true; window.ff.music?.setOverlay(false); });
  el.querySelector("#rpgTitle").addEventListener("click", () => {
    window.ff.boot?.toTitle();
    state.savePanelEl.hidden = true;
    state.menuPanelEl.hidden = true;
    document.getElementById("rpgDemo").hidden = true;
    window.ff.music?.setOverlay(false);
    window.ff.music?.setTitle(true);
    window.ff.titleScreen?.show();
  });
  el.querySelectorAll(".rpgSaveSlot").forEach((btn) => {
    btn.addEventListener("click", () => {
      const slot = btn.dataset.slot;
      // Task #162: fold the session in so the save's playtime is current.
      window.ff.playtime?.recordSession();
      const res = window.ff.boot?.saveCurrent(slot);
      log(res?.ok ? "Saved to " + slot + "." : "Save failed: " + (res?.reason ?? "unknown error"));
      refreshSavePanel();
      renderGrid();
    });
  });
  // Task #218: the Command Menu — Items / Magic / Equip / Status / Formation.
  window.ff.commandMenu.log = (msg) => log(msg);
  el.querySelector("#rpgMenuBtn").addEventListener("click", toggleCommandMenu);
  el.querySelector("#rpgMenuClose").addEventListener("click", closeCommandMenu);
  // Task #226/#227: the audio button is a master toggle for music + SFX,
  // defaulting to OFF; the first gesture also unlocks the audio contexts.
  el.querySelector("#rpgAudioBtn").addEventListener("click", () => {
    window.ff.music?.unlock();
    window.ff.sounds.unlock();
    const next = !window.ff.music.muted;
    window.ff.music.setMuted(next);
    window.ff.sounds.setMuted(next);
    // Task #161: keep the settings store in sync with the master toggle.
    window.ff.settings?.set("muted", next);
    refreshMusicUI();
  });
  // Task #161: the Settings menu (audio volume, text speed, screen size).
  el.querySelector("#rpgSettingsBtn").addEventListener("click", openSettingsMenu);
  // Task #163: post-game content — secret bosses + item hunts.
  el.querySelector("#rpgPostgameBtn").addEventListener("click", onPostgame);
  // Task #164: the final score card.
  el.querySelector("#rpgScoreBtn").addEventListener("click", onScore);
  // Task #165: the credit roll.
  el.querySelector("#rpgCreditsBtn").addEventListener("click", () => {
    log("Credits roll... (Enter/Esc to skip)");
    import("../ui/credits.js").then((m) => m.mountCreditsOverlay(window.ff.data.TEAM_CREDITS));
  });
  document.addEventListener("click", () => {
    window.ff.sounds.unlock();
    window.ff.music?.unlock();
    refreshMusicUI();
  }, { once: true });
  document.addEventListener("keydown", () => {
    window.ff.sounds.unlock();
    window.ff.music?.unlock();
  }, { once: true });
  el.querySelector("#rpgMenuList").addEventListener("click", (e) => {
    const row = e.target.closest(".menu-row");
    if (!row || row.classList.contains("dis")) return;
    const cm = window.ff.commandMenu;
    cm.menu.select(row.dataset.id);
    cm.menu.confirm();
    if (!cm.isOpen) closeCommandMenu();
    else renderCommandMenu();
  });
  document.addEventListener("keydown", (e) => {
    const d = document.getElementById("rpgDemo");
    if (!d || d.hidden) return;
    // Task #218: when the command menu is open it owns the keyboard.
    if (window.ff.commandMenu?.isOpen) {
      handleCommandKey(e);
      return;
    }
    // Task #208: K toggles the in-game save panel.
    if (e.key === "k" || e.key === "K") {
      toggleSavePanel();
      return;
    }
    const action = window.ff.input.actionForKey(e.key);
    if (!action) return;
    e.preventDefault();
    if (action === "confirm") { interact(); return; }
    if (action === "cancel") { window.ff.menu.cancel(); return; }
    if (action === "menu") { toggleCommandMenu(); return; }
    if (action === "run") { if (battle) onRun(); return; }
    const dir = { up: "N", down: "S", left: "W", right: "E" }[action];
    if (dir) {
      state.holdDir = dir;
      state.moveAcc = 0;
      move(dir);
      return;
    }
  });
  document.addEventListener("keyup", (e) => {
    const released = window.ff.input.actionForKey(e.key);
    window.ff.input.handleKeyUp(e);
    if (released && { up: "N", down: "S", left: "W", right: "E" }[released] === state?.holdDir) state.holdDir = null;
  });
  // Task #81: frame-rate independent movement — held keys move the player on
  // a fixed step interval regardless of the tick rate.
  let lastT = performance.now();
  const loop = (t) => {
    const dt = t - lastT;
    lastT = t;
    if (state && state.holdDir && !battle && !window.ff.cinematic.isPlaying && !window.ff.menu.isOpen && !(window.ff.commandMenu?.isOpen)) {
      state.moveAcc = (state.moveAcc ?? 0) + dt;
      const interval = moverFor(currentMapId()).stepInterval;
      if (state.moveAcc >= interval) {
        state.moveAcc -= interval;
        move(state.holdDir);
      }
    } else if (state) {
      state.moveAcc = 0;
    }
    // Task #155: animate the floating damage numbers each frame.
    if (window.ff.damagePopups) {
      window.ff.damagePopups.update(dt);
      window.ff.damagePopups.render();
    }
    // Task #162: the playtime clock ticks with real time; the running
    // session folds into the persisted total every ~10s.
    if (window.ff.playtime) {
      window.ff.playtime.tick(dt);
      if (window.ff.playtime.sessionSecs() > 10) window.ff.playtime.recordSession();
    }
    refreshMusicUI();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  switchShop("item");
}

// Interact with the tile the player stands on (triggers, NPCs, world events).
function interact() {
  const mapId = currentMapId();
  const tr = window.ff.triggers.checkInteract(mapId, state.px, state.py);
  if (tr && window.ff.triggers.isActive(tr)) {
    window.ff.triggers.execute(tr, {}, { dialogue: (id) => sayDialogue(id) });
    return true;
  }
  // Task #187: standing on an NPC's tile starts their dialogue.
  const npc = window.ff.npcs.activeNpcAt(mapId, state.px, state.py);
  if (npc) {
    window.ff.sounds.trigger("menuSelect");
    sayDialogue(npc.dialogueId);
    maybeCompleteWaystoneQuest();
    maybeBeginCycle();
    // Task #151: every conversation deepens the bond — crossing a tier
    // threshold grants the NPC's one-time recognition reward.
    const rel = window.ff.npcRelations.add(npc.id, window.ff.npcRelations.def(npc.id)?.talkGain ?? 1);
    if (rel.ok) {
      for (const rw of rel.rewards ?? []) {
        if (rw.reward?.item) log(npc.name + " acknowledges you — " + (window.game.inventory.item(rw.reward.item)?.name ?? rw.reward.item) + " gained!");
        else if (rw.reward?.gold) log(npc.name + " acknowledges you — " + rw.reward.gold + " gold!");
        else if (rw.reward?.xp) log(npc.name + " acknowledges you — " + rw.reward.xp + " XP!");
      }
      if (rel.tier?.label) log("[" + npc.name + "] affinity " + rel.score + " — " + rel.tier.label + ".");
    }
    // Task #140: after the talk, hand over any items this NPC accepts — the
    // player always gets the exchange when they have what the NPC wants.
    for (const offer of window.ff.npcExchanges.offersFor(npc.id)) {
      const check = window.ff.npcExchanges.canOffer(offer);
      if (check.ok) {
        const r = window.ff.npcExchanges.offer(offer.id);
        if (r.ok) {
          const got = r.granted
            ? " You receive " + (window.game.inventory.item(r.granted.itemId)?.name ?? r.granted.itemId) + " x" + r.granted.count + "."
            : r.gold
            ? " You receive " + r.gold + " gold."
            : "";
          log("You hand over " + (offer.count > 1 ? offer.count + "x " : "") + (window.game.inventory.item(offer.itemId)?.name ?? offer.itemId) + ". " + offer.line + got);
          // Task #151: trades also build the bond.
          const er = window.ff.npcRelations.add(offer.npc, window.ff.npcRelations.def(offer.npc)?.exchangeGain ?? 0);
          for (const rw of er?.rewards ?? []) {
            if (rw.reward?.item) log(offer.npc + " acknowledges you — " + rw.reward.item + " gained!");
            else if (rw.reward?.gold) log(offer.npc + " acknowledges you — " + rw.reward.gold + " gold!");
          }
        }
      } else if (window.game.inventory.count(offer.itemId) > 0) {
        log((window.game.inventory.item(offer.itemId)?.name ?? offer.itemId) + " in hand, but " + npc.name + " needs " + (offer.count - window.game.inventory.count(offer.itemId)) + " more.");
      }
    }
    renderGrid();
    return true;
  }
  // Task #118: interactive environment objects — signs, barrels, doors.
  const obj = window.ff.environmentObjects.interact(mapId, state.px, state.py);
  if (obj && obj.ok) {
    log(obj.label + ": " + obj.flavor);
    if (obj.granted) log("Found: " + obj.granted.itemId + " x" + obj.granted.count + ".");
    if (obj.gold) log("Found " + obj.gold + " gold.");
    window.ff.sounds.trigger("itemFound");
    renderGrid();
    return true;
  }
  const we = window.ff.worldEvents.pending(mapId, state.px, state.py, "interact");
  if (we) {
    handleWorldEvent(we);
    renderGrid();
    return true;
  }
  log("There is nothing to interact with here.");
  return false;
}

function sayDialogue(id) {
  // Task #139: group conversations route through the group engine, which
  // reports every participant in the exchange.
  const res = window.ff.groupConversation.start(id);
  if (!res) return log("(no dialogue: " + id + ")");
  if (res.with?.length) {
    const names = res.with.map((nid) => window.ff.npcs.npcById(nid)?.name ?? nid).join(", ");
    log("A conversation draws in: " + names + ".");
  }
  const page = window.ff.dialogue.getPage();
  if (page && page.text) log((page.speaker ? page.speaker + ": " : "") + page.text);
  else log("(dialogue: " + id + ")");
}

// Task #100: advance the plot-chapter chain, firing every chapter whose
// triggers are met (so a boss win that completes one chapter immediately
// unlocks the next). The demo's dialogue is log-based, so blocking steps
// resolve instantly.
function advancePlot() {
  let fired = false;
  let guard = 0;
  while (guard++ < 12) {
    const r = window.ff.plot.advance();
    if (!r || r.triggered !== true) break;
    fired = true;
    if (r.name) log("Story: " + r.name);
    let g2 = 0;
    while (window.ff.plot.isRunning() && g2++ < 10) window.ff.plot.resume();
  }
  return fired;
}

// Task #100: advance the main-story milestone chain, starting every
// newly-ready milestone and running its sequence.
function advanceStory() {
  let ms = window.ff.director.advanceMilestones();
  let guard = 0;
  while (ms && guard++ < 20) {
    if (ms.name) log("Main story: " + ms.name);
    if (window.ff.director.isRunning()) window.ff.director.advance();
    ms = window.ff.director.advanceMilestones();
  }
  return ms === null ? null : ms;
}

// Fire a world event (Task #74): boss battles, narrative dialogue, travel grants.
function handleWorldEvent(def) {
  const ff = window.ff;
  ff.worldEvents.trigger(def, {
    dialogue: (id) => sayDialogue(id),
    bossBattle: (act) => {
      const enc = ff.encounters.forceEncounter(currentMapId(), act.group);
      if (!enc) return;
      log(act.intro ?? "A foe bars your way!");
      startBattle(enc, { flag: act.onWinFlag, dialogueId: act.onWinDialogue });
    },
    grantTravel: (act) => {
      const granted = ff.travel.grant(act.mode);
      if (act.dialogueId) sayDialogue(act.dialogueId);
      if (granted.ok) log("The party obtains passage on the " + granted.name + "!");
    },
    // Task #166: the Trial Gate — route through the TrialSystem to summon the
    // next echo; record the win (flag + Keeper Tokens) on victory.
    trialBattle: () => {
      const tr = ff.trials;
      const cur = tr.currentTrial();
      if (!cur) {
        log("All trials are complete. The circle stands silent.");
        return { ok: false };
      }
      const enc = tr.buildEncounter(cur.id);
      log(cur.intro);
      startBattle(enc, {
        flag: tr.clearedFlag(cur.id),
        onVictory: () => {
          const r = tr.recordWin(cur.id);
          log(cur.victoryLine);
          log("+" + r.tokens + " Keeper Token" + (r.tokens > 1 ? "s" : "") + " (total " + r.balance + ")");
        },
      });
      return { ok: true, id: cur.id };
    },
    // Task #187: touching a waystone lights it and speaks its flavor.
    waystone: () => {
      const r = ff.waystones.activateAt(currentMapId(), state.px, state.py);
      if (!r.ok) return log("Waystone: " + r.error);
      state.lastWaystoneId = r.id;
      window.ff.sounds.trigger("menuSelect");
      if (r.firstTime) log("A waystone blazes to life: " + r.name + " (" + r.lit + "/6 lit)");
      const w = ff.waystones.byId(r.id);
      if (w) log(w.flavor);
      maybeCompleteWaystoneQuest();
    },
    // Task #198: the Echo of Creation — the New Game+ ultimate boss, scaled
    // to the current cycle. Victory records the kill and grants its hoard.
    echoBattle: () => {
      const ng = ff.ngplus;
      const boss = ng.echoBoss();
      log(ff.data.NGPLUS.echo.intro);
      startBattle({ enemies: [boss], groupId: "echo_creation" }, {
        onVictory: () => {
          const r = ng.recordEchoDefeat();
          if (r.ok) {
            log("The Echo of Creation unravels into silence — the Shattered Blade is yours! (+" + r.gold + "g, +" + r.xp + "xp)");
          }
        },
      });
      return { ok: true, id: boss.id };
    },
  });
}

// Task #198: the Remembrance Sage's offer — when the party asks to begin the
// next cycle (ngplus_begin_requested), wind the world and stand them at the
// new age's start.
function maybeBeginCycle() {
  const ff = window.ff;
  if (!window.game.state.getFlag("ngplus_begin_requested")) return;
  window.game.state.clearFlag("ngplus_begin_requested");
  const r = ff.ngplus.startCycle();
  if (!r.ok) return log("Cycle: " + r.error);
  state.inCave = false;
  state.inBuilding = null;
  state.inTown = null;
  state.lastWaystoneId = null;
  const loc = window.game.state.getLocation();
  state.mapName = (ff.maps.get(loc.mapId)?.name) ?? loc.mapId;
  state.px = loc.x;
  state.py = loc.y;
  setPlayerAt(loc.mapId, loc.x, loc.y, loc.facing);
  ff.fog.resetAll();
  ff.fog.discoverRadius(loc.mapId, loc.x, loc.y, 2);
  ff.encounters.reset();
  ff.screenTransitions.flash("rgba(120,60,20,0.85)", 320);
  ff.sounds.trigger("levelUp");
  log("=== CYCLE " + r.cycle + " BEGINS — the world is reborn, its every foe grown terrible! ===");
  if (r.reward) {
    const name = r.reward.item ? (window.game.inventory.item(r.reward.item)?.name ?? r.reward.item) : null;
    log("Cycle reward: " + (name ? name + " + " : "") + r.reward.gold + "g +" + r.reward.xp + "xp");
  }
  renderGrid();
}

// Task #187: once every stone burns, finish the Waystone Pilgrim quest and
// hand over the Wayfarer's Charm.
function maybeCompleteWaystoneQuest() {
  const ff = window.ff;
  if (!ff.sideQuests.isStarted("the_waystone_pilgrim")) return;
  if (ff.waystones.countLit() < 6) return;
  if (!window.game.state.getFlag("sq_waystone_pilgrim_all")) {
    ff.sideQuests.completeStep("the_waystone_pilgrim", "sq_waystone_pilgrim_all");
    log("All six waystones burn as one — the network is whole!");
  }
  const done = ff.sideQuests.checkComplete("the_waystone_pilgrim");
  if (done.ok) log("Quest complete: " + done.name + " — the Wayfarer's Charm is yours!");
}

// The waystone we're standing on / last touched — the source of a route.
function currentWaystoneId() {
  const here = window.ff.waystones.all().find((w) => w.mapId === currentMapId());
  return here?.id ?? state.lastWaystoneId ?? null;
}

function refreshWaystones() {
  const el = document.getElementById("rpgWaystones");
  if (!el || el.hidden) return;
  const fromId = currentWaystoneId();
  const sel = document.getElementById("rpgWaystoneDest");
  const go = document.getElementById("rpgWaystoneGo");
  if (!sel || !go) return;
  const d = fromId ? window.ff.waystones.destinations(fromId) : null;
  sel.innerHTML = "";
  if (!d || !d.ok || !d.to.length) {
    const opt = document.createElement("option");
    opt.textContent = "Touch a waystone first...";
    opt.disabled = true;
    sel.appendChild(opt);
    go.disabled = true;
  } else {
    for (const t of d.to) {
      const opt = document.createElement("option");
      opt.value = t.id;
      opt.textContent = t.name + " — " + t.region;
      sel.appendChild(opt);
    }
    go.disabled = false;
  }
}

function travelToWaystone() {
  const toId = document.getElementById("rpgWaystoneDest").value;
  const fromId = currentWaystoneId();
  if (battle) return log("The waystone is silent while battle rages.");
  if (!toId || !fromId) return log("Waystones: no route.");
  const res = window.ff.waystones.travel(fromId, toId);
  if (!res.ok) return log("Waystones: " + res.error);
  state.inCave = false;
  state.inBuilding = null;
  state.inTown = res.to.mapId === "overworld" ? null : res.to.mapId;
  state.mapName = (window.ff.maps.get(res.to.mapId)?.name) ?? res.to.mapId;
  state.lastWaystoneId = res.id;
  window.game.state.setLocation(res.to.mapId, res.to.x, res.to.y, res.to.facing);
  setPlayerAt(res.to.mapId, res.to.x, res.to.y, res.to.facing);
  window.ff.fog.resetAll();
  window.ff.fog.discoverRadius(res.to.mapId, res.to.x, res.to.y, 2);
  window.ff.screenTransitions.flash("rgba(46,66,130,0.75)", 220);
  window.ff.sounds.trigger("menuSelect");
  state.leaveBtn.hidden = true;
  state.enterBtn.hidden = false;
  state.travelRow.hidden = false;
  log("The waystone's light sweeps you across the realm to " + res.name + "!");
  renderGrid();
}

// Typewriter log for dramatic lines (Task #79).
function typedLog(lines) {
  if (!state) return;
  let div = null;
  window.ff.textScroller.onLine = () => {
    div = document.createElement("div");
    state.logEl.appendChild(div);
    state.logEl.scrollTop = state.logEl.scrollHeight;
  };
  window.ff.textScroller.onChar = (ch) => {
    if (div) div.textContent += ch;
  };
  window.ff.textScroller.onDone = () => {
    div = null;
  };
  window.ff.textScroller.pushAll(Array.isArray(lines) ? lines : [lines]);
}

function refreshSavePanel() {
  if (!state?.savePanelEl) return;
  state.savePanelEl.querySelectorAll(".rpgSaveSlot").forEach((btn) => {
    const slot = btn.dataset.slot;
    const meta = window.ff?.slots?.meta(slot) ?? null;
    const line = btn.querySelector(".rpgSaveMeta");
    if (meta) {
      btn.classList.remove("empty");
      line.textContent = "Lv " + meta.level + " \u00b7 " + meta.gold + "g \u00b7 " + meta.location + " \u00b7 Cycle " + meta.cycle;
    } else {
      btn.classList.add("empty");
      line.textContent = "Empty";
    }
  });
}

function toggleSavePanel() {
  if (!state) return;
  state.savePanelEl.hidden = !state.savePanelEl.hidden;
  window.ff.music?.setOverlay(!state.savePanelEl.hidden);
  if (!state.savePanelEl.hidden) refreshSavePanel();
}

// Task #161: the Settings menu — audio volume, mute, text speed, screen
// size. Writes through the persisted SettingsStore, which applies the
// values to the live systems.
function openSettingsMenu() {
  const s = window.ff.settings;
  const overlay = document.createElement("div");
  overlay.className = "settingsOverlay";
  overlay.innerHTML = '<div class="settingsPanel"><h3>Settings</h3><div class="settingsRows"></div><div class="btns"><button id="rpgSettingsClose">Close</button></div></div>';
  const panel = overlay.querySelector(".settingsRows");
  for (const item of s.all()) {
    const row = document.createElement("div");
    row.className = "settingsRow";
    const label = document.createElement("label");
    label.textContent = item.def.label;
    row.appendChild(label);
    let input;
    if (item.def.type === "range") {
      input = document.createElement("input");
      input.type = "range";
      input.min = item.def.min;
      input.max = item.def.max;
      input.step = item.def.step ?? 0.01;
      input.value = item.value;
      input.addEventListener("input", () => s.set(item.key, Number(input.value)));
    } else if (item.def.type === "toggle") {
      input = document.createElement("input");
      input.type = "checkbox";
      input.checked = !!item.value;
      input.addEventListener("change", () => s.set(item.key, input.checked));
    } else {
      input = document.createElement("select");
      for (const opt of item.def.options ?? []) {
        const o = document.createElement("option");
        o.value = opt.value;
        o.textContent = opt.label ?? opt.value;
        input.appendChild(o);
      }
      input.value = item.value;
      input.addEventListener("change", () => s.set(item.key, input.value));
    }
    row.appendChild(input);
    panel.appendChild(row);
  }
  overlay.querySelector("#rpgSettingsClose").addEventListener("click", () => { overlay.remove(); style.remove(); });
  document.body.appendChild(overlay);
  const style = document.createElement("style");
  style.textContent = `
    .settingsOverlay { position: fixed; inset: 0; z-index: 55; background: rgba(5,8,18,.78); display: flex; align-items: center; justify-content: center; }
    .settingsPanel { background: #0a0e1e; border: 2px solid #39456e; padding: 16px 20px; min-width: 320px; }
    .settingsPanel h3 { margin: 0 0 10px; color: #ffd24a; letter-spacing: .18em; }
    .settingsRow { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin: 8px 0; color: #cfe0ff; font-size: 13px; }
    .settingsRow select { max-width: 160px; }
  `;
  document.head.appendChild(style);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) { overlay.remove(); style.remove(); } });
}

// Task #163: post-game content — start the next available secret boss, or
// report hunt progress.
function onPostgame() {
  const pg = window.ff.postgame;
  const avail = pg.available();
  if (!avail.length) {
    log(pg.describe());
    if (pg.all().length && pg.all().every((d) => d.done)) log("Every post-game secret has been uncovered. The realm is truly whole.");
    return;
  }
  const boss = avail.find((d) => d.type === "secret_boss");
  if (boss) {
    const enc = pg.encounter(boss.id);
    if (!enc.ok) return log("Post-game: " + enc.error);
    log("Post-game challenge: " + boss.name + "!");
    startBattle(
      { enemies: enc.enemies, groupId: enc.groupId },
      {
        onVictory: () => {
          const done = pg.complete(boss.id);
          if (done.ok) {
            log(boss.name + " defeated!");
            for (const r of done.reward ?? []) {
              if (r.item) log("  Reward: " + r.item + " x" + r.count + ".");
              else if (r.gold) log("  Reward: " + r.gold + " gold.");
              else if (r.xp) log("  Reward: " + r.xp + " XP.");
            }
          }
          for (const d of pg.check()) log("POST-GAME: " + d.name + " is now available — " + d.hint);
        },
      }
    );
    return;
  }
  const hunt = avail.find((d) => d.type === "item_hunt");
  if (hunt) {
    const prog = pg.progress(hunt);
    const lines = prog.targets.map((t) => t.label + " " + t.have + "/" + t.want).join(", ");
    log("Post-game hunt: " + hunt.name + " — " + lines + ".");
    if (prog.done) {
      const done = pg.complete(hunt.id);
      if (done.ok) {
        log(hunt.name + " completed!");
        for (const r of done.reward ?? []) {
          if (r.item) log("  Reward: " + r.item + " x" + r.count + ".");
        }
        for (const d of pg.check()) log("POST-GAME: " + d.name + " is now available — " + d.hint);
      }
    } else {
      log(hunt.hint);
    }
    return;
  }
  log(pg.describe());
}

// Task #164: the final score card.
function onScore() {
  const ev = window.ff.finalScore.evaluate();
  log("FINAL SCORE — " + ev.grade + "-rank: " + ev.gradeLabel + " (" + ev.score + "/100)");
  for (const c of ev.components) log("  " + c.label + ": " + c.points + " (" + c.note + ")");
}

// Task #218: the Command Menu UI — a DOM list rendered from the
// CommandMenuSystem's current view, driven by the same keys as the title.
function escHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Task #226/#227: keep the audio toggle label and the now-playing badge in
// sync with the controllers. Audio is off by default.
function refreshMusicUI() {
  if (!state) return;
  const m = window.ff.music;
  if (!m) return;
  state.audioBtnEl.textContent = (m.muted || window.ff.sounds?.muted) ? "Audio: Off" : "Audio: On";
  const st = m.state;
  const demo = document.getElementById("rpgDemo");
  if (st.playing && st.label && demo && !demo.hidden) {
    state.nowPlayingEl.hidden = false;
    state.nowPlayingEl.textContent = "♪ " + st.label + (st.muted ? " · muted" : "") + (st.ducked ? " · menu" : "");
  } else {
    state.nowPlayingEl.hidden = true;
  }
}

function renderCommandMenu() {
  if (!state) return;
  const info = window.ff.commandMenu.view();  state.menuTitleEl.textContent = info.view?.title ?? "Command";
  state.menuMsgEl.textContent = info.message ?? "";
  state.menuListEl.innerHTML = "";
  for (const item of info.view?.items ?? []) {
    const row = document.createElement("div");
    row.className = "menu-row" + (item.selected ? " sel" : "") + (item.disabled ? " dis" : "");
    row.dataset.id = item.id;
    const label = document.createElement("span");
    label.className = "menu-label";
    label.textContent = item.label;
    row.appendChild(label);
    if (item.hint) {
      const hint = document.createElement("span");
      hint.className = "menu-hint";
      hint.textContent = item.hint;
      row.appendChild(hint);
    }
    state.menuListEl.appendChild(row);
  }
}

function handleCommandKey(e) {
  const cm = window.ff.commandMenu;
  const res = cm.handleKey(e.key);
  if (res === "closed") closeCommandMenu();
  else renderCommandMenu();
}

function toggleCommandMenu() {
  if (battle) return log("Cannot open the menu mid-battle.");
  if (window.ff.cinematic.isPlaying) return log("You cannot open the menu right now.");
  if (!state) return;
  if (state.menuPanelEl.hidden) {
    state.holdDir = null;
    state.menuPanelEl.hidden = false;
    window.ff.music?.setOverlay(true);
    window.ff.commandMenu.open();
  } else {
    closeCommandMenu();
  }
  renderCommandMenu();
}

function closeCommandMenu() {
  if (!state) return;
  state.menuPanelEl.hidden = true;
  window.ff.music?.setOverlay(false);
  window.ff.commandMenu.close();
}

// Task #208: place the player exactly where the loaded game state says they
// are — town, dungeon, building interior, or the overworld.
function placeAtGameState() {
  const l = window.game.state.getLocation();
  if (!l?.mapId) return false;
  if (l.mapId === "overworld") {
    state.inTown = null;
    moveToMap("overworld", l.x, l.y, l.facing ?? "S");
    return true;
  }
  if (l.mapId === "title") return false;
  state.inCave = !!window.ff.dungeons.dungeonForMap(l.mapId);
  state.inBuilding = window.ff.buildings.townOfInterior(l.mapId);
  state.inTown = !state.inCave && !state.inBuilding ? l.mapId : null;
  moveToMap(l.mapId, l.x, l.y, l.facing ?? "S");
  if (state.inCave) {
    state.leaveBtn.hidden = false;
    state.enterBtn.hidden = true;
    state.travelRow.hidden = true;
    window.ff.encounters.reset();
  }
  return true;
}

// Task #208: clean boot path used by the title screen — mounts the game and
// starts play at the CURRENT game state (set by boot.newGame/continue).
export function startGame(opts = {}) {
  const title = document.getElementById("titleScreen");
  if (title) title.hidden = true;
  if (!state) mount();
  document.getElementById("rpgDemo").hidden = false;
  battle = null;
  state.inCave = false;
  state.inBuilding = null;
  state.inTown = null;
  state.savePanelEl.hidden = true;
  state.menuPanelEl.hidden = true;
  // Task #226: leave the title theme, pick the area song.
  window.ff.music?.setTitle(false);
  window.ff.music?.setOverlay(false);
  const activeSlot = window.ff.boot?.activeSlot;
  if (activeSlot) {
    const meta = window.ff.slots.meta(activeSlot);
    if (meta) log("Continuing " + meta.name + " \u2014 Lv " + meta.level + " \u00b7 " + meta.gold + "g \u00b7 Cycle " + meta.cycle + ".");
  }
  window.ff.ambient.spawn("cornelia").spawn("cornelia_inn").spawn("caves_of_cornelia").spawn("trial_hall").spawn("dwarfholm");
  if (opts.fresh) {
    const prologue = window.ff.data?.NEW_GAME?.prologue ?? ["The world once lived in balance, governed by the power of the four Crystals."];
    for (const line of prologue) log(line);
    window.ff.cinematic.play([
      prologue[0],
      { text: prologue[1] ?? "But darkness has swallowed the land...", flag: "prologue_seen" },
      prologue[2] ?? "Four heroes of light set out from the town of Cornelia to restore them.",
    ], {
      headless: true,
      onDone: () => log("Prologue complete."),
    }).skip();
  }
  if (!placeAtGameState()) moveToMap("cornelia", 7, 5, "S");
  const ms = window.ff.director.advanceMilestones();
  if (ms) log("Main story: " + ms.name);
  if (window.ff.director.isRunning()) window.ff.director.advance();
  const sqStart = window.ff.sideQuests.start("herbalists_request");
  if (sqStart.ok) log("Side quest accepted: " + sqStart.name);
  advancePlot();
  advanceStory();
}

window.startGame = startGame;

export function startRpgDemo() {
  const title = document.getElementById("titleScreen");
  if (title) title.hidden = true;
  if (!state) mount();
  document.getElementById("rpgDemo").hidden = false;
  battle = null;
  const mage = window.game.party.members.find((m) => m.classId === "blackMage");
  if (mage) {
    mage.level = 4; // enough to wield Thunder; demo shows the level-lock mechanic
    mage.hp = mage.getStats().maxHp;
    if (!mage.knowsSpell("firaga")) mage.learnSpell("firaga");
    if (!mage.knowsSpell("water")) mage.learnSpell("water");
    mage.mp = 40;
  }
  window.game.inventory.add("potion", 2);
  // Task #148: the party carries a lantern into the dark places.
  window.game.inventory.add("lantern", 1);
  window.ff.gameOver.savepoint("caves_of_cornelia", START.x, START.y, "N", "Cave Entrance");
  window.ff.transitions.start("overworld", 10, 4, "S");
  window.game.state.setLocation("overworld", 10, 4, "S");
  window.ff.ambient.spawn("cornelia").spawn("cornelia_inn").spawn("caves_of_cornelia").spawn("trial_hall").spawn("dwarfholm");
  enterCave();

  window.ff.cinematic.play([
    "The world once lived in balance, governed by the power of the four Crystals.",
    { text: "But darkness has swallowed the land, and the Crystals lie shattered...", flag: "prologue_seen" },
    "Four heroes of light set out from the town of Cornelia to restore them.",
  ], {
    headless: true,
    onDone: () => log("Prologue complete."),
  }).skip();

  const ms = window.ff.director.advanceMilestones();
  if (ms) log("Main story: " + ms.name);
  if (window.ff.director.isRunning()) window.ff.director.advance();
  const sqStart = window.ff.sideQuests.start("herbalists_request");
  if (sqStart.ok) log("Side quest accepted: " + sqStart.name);
  advancePlot();
  advanceStory();
}

window.startRpgDemo = startRpgDemo;
window.rpgDemo = {
  get state() { return state; },
  get battle() { return battle; },
  helpers: { handleWorldEvent, maybeCompleteWaystoneQuest, maybeBeginCycle, travelToWaystone, currentWaystoneId, moveToMap, setPlayerAt, checkWorldInteraction, refreshWaystones, renderGrid, toggleCommandMenu, closeCommandMenu, renderCommandMenu, startBattle, endBattle, toggleSavePanel, refreshMusicUI },
};

if (new URLSearchParams(location.search).get("demo") === "rpg") {
  startRpgDemo();
}
