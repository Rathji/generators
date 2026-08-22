// src/gameUI.test.js — Phase 10 game-UI validation (Tasks 45-52).
// Run in-page via ?test=gameui, or programmatically via window.__loadGameUITests().
// Task 45: the board renders the destination grid, the six Commons buildings
// (readable names + full-card tooltips), and the charters (vision-checked
// separately). Task 46: after a Treasury action the payer's dashboard shows
// -1 clay and +$1 and the general supply shows the deltas. Task 47: a player
// with no workers sees only "retrieve workers"; bump candidates show the
// occupant's owner. Task 48: advancing to an income space flashes the income
// banner for all players. Task 49: construction highlights equal the legal
// adjacency set exactly, and confirming constructs on a legal cell. Task 50:
// the crate-unlock modal reveals the Index-Guide components. Task 51: a
// scripted 20-move game produces a turn log matching the event stream.
// Task 52: layouts reflow with no horizontal scroll at 360/768/1280px.

import { createGameUI, setupDemoGame } from "./gameUI.js";
import { WORKER_ACTIONS } from "./engine.js";

function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function runGameUITests() {
  const results = [];
  const ok = (name, cond, detail = "") => results.push({ name, pass: !!cond, detail });
  const hosts = [];

  function mount(extra = {}) {
    const state = setupDemoGame({ rng: lcg(1) });
    if (extra.prepare) extra.prepare(state);
    const host = document.createElement("div");
    host.id = "uiTestHost";
    document.body.appendChild(host);
    hosts.push(host);
    const ui = createGameUI(state, { container: host });
    ui.render();
    return { state, ui, host };
  }
  function cellKey(state, buildingId) {
    return state.board.commonsBuildings().find(b => b.buildingId === buildingId).cell.key;
  }
  function playerResources(state, pid, r) {
    return state.player(pid).resources()[r] ?? 0;
  }

  // ── Task 45 (DOM portion; visuals are vision-checked) ──
  const m45 = mount();
  ok("the board renders 37 hex cells (commons + ring 1-3)", m45.host.querySelectorAll(".g-cell").length === 37);
  ok("The Commons shows its 6 buildings as readable cells",
    m45.host.querySelectorAll('.g-cell[data-type="commonsBuilding"]').length === 6 &&
    [...m45.host.querySelectorAll('.g-cell[data-type="commonsBuilding"]')]
      .every(g => g.dataset.tooltip && g.dataset.tooltip.length > 5));
  ok("every Commons building's full card text is in its tooltip",
    ["Zeppelin", "Charterstone", "Grandstand", "Treasury", "Market", "Cloud Port"]
      .every(name => [...m45.host.querySelectorAll('.g-cell[data-type="commonsBuilding"]')]
        .some(g => g.dataset.tooltip.includes(name))));
  ok("the destination grid is visible (24 empty plots on rings 2-3)",
    m45.host.querySelectorAll('.g-cell[data-type="destination"]').length === 24);
  ok("the six charter anchors are rendered", m45.host.querySelectorAll('.g-cell[data-type="charter"]').length === 6);
  ok("the three tracks render with positioned tokens",
    !!m45.host.querySelector('[data-track="progress"]') &&
    !!m45.host.querySelector('[data-track="reputation"]') &&
    !!m45.host.querySelector('[data-track="quota"]') &&
    m45.host.querySelector('.g-space-token')?.dataset.space === "2" &&
    m45.host.querySelector('[data-track="reputation"] .g-space-rep:first-child')?.dataset.space === "2");

  // ── Task 46: dashboard + supply deltas after a Treasury action ──
  const m46 = mount({
    prepare(state) {
      state.economy.gain("P1", { clay: 1 });
    },
  });
  const supplyBefore = m46.state.economy.generalItems();
  m46.ui.act("enterPlace");
  m46.ui.act("selectCell", cellKey(m46.state, "treasury"));
  m46.ui.act("chooseOption", "clay");
  const treasuryRes = m46.ui.act("confirm");
  const clayStat = m46.host.querySelector('[data-player-id="P1"] [data-resource="clay"]');
  const coinsStat = m46.host.querySelector('[data-player-id="P1"] [data-stat="coins"]');
  const supply = m46.state.economy.generalItems();
  ok("the Treasury action succeeds", treasuryRes && treasuryRes.ok);
  ok("after the Treasury action the payer's dashboard shows -1 clay and +$1",
    playerResources(m46.state, "P1", "clay") === 0 && m46.state.player("P1").coins() === 5 &&
    clayStat && clayStat.textContent.includes("🧱") && !clayStat.textContent.includes("1") &&
    coinsStat && coinsStat.textContent.includes("🪙 5"));
  ok("the general supply shows the deltas (+1 clay back, -$1 out)",
    supply.clay === supplyBefore.clay + 1 && supply.coins === supplyBefore.coins - 1);
  ok("the turn advances to the next player after the action",
    m46.state.turns.currentPlayerId === "P2");

  // ── Task 47a: no workers → only retrieve ──
  const m47a = mount({
    prepare(state) {
      state.player("P1").spendWorkers(2);
    },
  });
  const placeBtn = m47a.host.querySelector('[data-action="place"]');
  const retBtn = m47a.host.querySelector('[data-action="retrieve"]');
  ok("a player with no workers sees only 'retrieve workers'",
    placeBtn && placeBtn.disabled === true &&
    retBtn && retBtn.disabled === false &&
    m47a.state.engine.legalActions("P1").join(",") === WORKER_ACTIONS.RETRIEVE);

  // ── Task 47b: bump candidates show the occupant's owner ──
  const m47b = mount({
    prepare(state) {
      state.economy.gain("P1", { clay: 1 });
      state.economy.gain("P2", { clay: 1 });
    },
  });
  m47b.ui.act("enterPlace");
  m47b.ui.act("selectCell", cellKey(m47b.state, "treasury"));
  m47b.ui.act("chooseOption", "clay");
  m47b.ui.act("confirm");
  m47b.ui.act("enterPlace");
  m47b.ui.act("selectCell", cellKey(m47b.state, "treasury"));
  m47b.ui.act("chooseOption", "clay");
  const confirmPanel = m47b.host.querySelector("#confirmPanel");
  ok("a bump candidate shows the occupant's owner",
    confirmPanel && confirmPanel.dataset.legal === "1" &&
    confirmPanel.querySelector("[data-bump]")?.dataset.bump === "P1" &&
    confirmPanel.textContent.includes("P1"));

  // ── Task 48: income banner ──
  const m48 = mount();
  m48.state.progress.setIncomeEnabled(true);
  for (let i = 0; i < 8; i++) m48.state.progress.advance("construct");
  m48.ui.render();
  const banner = m48.host.querySelector("#incomeBanner");
  ok("advancing to an income space flashes the income banner for all players",
    !!banner && banner.textContent.includes("INCOME") &&
    m48.state.progress.position === 10);
  const m48b = mount();
  for (let i = 0; i < 3; i++) m48b.state.progress.advance("construct");
  m48b.ui.render();
  ok("no banner flashes on a plain space", !m48b.host.querySelector("#incomeBanner"));
  const m48c = mount();
  for (let i = 0; i < 8; i++) m48c.state.progress.advance("construct");
  m48c.ui.render();
  ok("the income notice shows 'locked' while income is disabled",
    !!m48c.host.querySelector("#incomeNotice") && !m48c.host.querySelector("#incomeBanner") &&
    m48c.state.progress.isIncomeEnabled() === false);

  // ── Task 49: construction UI ──
  const m49 = mount({
    prepare(state) {
      state.player("P1").gainCard("bldg-mine");
    },
  });
  m49.ui.act("enterConstruct", "bldg-mine");
  const legalSet = new Set(m49.state.engine.legalConstructionCellsForPlayer("P1").map(c => c.key));
  const highlighted = new Set(
    [...m49.host.querySelectorAll(".g-hex-construct-legal")]
      .map(g => g.closest(".g-cell").dataset.cell));
  ok("the highlighted construction cells equal the legal adjacency set exactly",
    highlighted.size === legalSet.size && [...legalSet].every(k => highlighted.has(k)),
    [...legalSet].join(",") + " vs " + [...highlighted].join(","));
  const illegalCell = m49.state.board.destinationCells().find(c => !legalSet.has(c.key));
  m49.ui.act("selectCell", illegalCell.key);
  ok("selecting an illegal cell reports the reason",
    m49.host.querySelector("#reasonText")?.dataset.reason === "illegal_construction_cell");
  const legalCell = [...legalSet][0];
  m49.ui.act("selectCell", legalCell);
  const constructRes = (() => {
    m49.state.economy.gain("P1", { coal: 1, wood: 1, grain: 1, pumpkin: 1 });
    return m49.ui.act("confirm");
  })();
  ok("confirming a construction places the building on the legal cell",
    constructRes && constructRes.ok &&
    constructRes.benefit?.buildingId === "mine" &&
    m49.state.board.buildingAt(legalCell) === "mine" &&
    m49.state.board.ownerAt(legalCell) === "P1");
  ok("construction grants +5 VP, consumes the card, spends 3 influence, and advances the progress token",
    m49.state.player("P1").vp === 5 &&
    !m49.state.player("P1").hasCard("bldg-mine") &&
    m49.state.player("P1").hasCard("cbldg-mine") &&
    m49.state.influence.availableOf("P1") === 9 &&
    m49.state.progress.position === 3);
  ok("the turn advances after construction", m49.state.turns.currentPlayerId === "P2");
  const stickerCellG = m49.host.querySelector(`[data-cell="${legalCell}"]`);
  ok("the constructed cell shows the permanence sticker",
    stickerCellG?.dataset.sticker === "1" && !!stickerCellG.querySelector(".g-hex-sticker"));

  // ── Task 50: the crate-unlock modal ──
  const m50 = mount({
    prepare(state) {
      state.player("P1").gainCard("cbldg-1");
    },
  });
  m50.ui.act("enterPlace");
  m50.ui.act("selectCell", cellKey(m50.state, "charterstone"));
  m50.ui.act("chooseOption", "cbldg-1");
  m50.ui.act("confirm");
  const crateModal = m50.host.querySelector(".g-modal");
  const crateBackdrop = m50.host.querySelector(".g-modal-backdrop");
  ok("unlocking a crate opens the Index-Guide reveal modal",
    !!crateModal && !!crateBackdrop && crateBackdrop.dataset.crate === "1" && crateModal.querySelector(".g-modal-title")?.dataset.cardId === "cbldg-1");
  ok("the modal names the card, crate number and cost",
    crateModal.textContent.includes("Crate #1") && crateModal.textContent.includes("$4") && crateModal.textContent.includes("2 influence"));
  ok("the modal lists the crate's Index-Guide components in order",
    [...crateModal.querySelectorAll("[data-component]")].map(e => e.dataset.component).join(",") ===
      "asst-4,spc-friend-2,spc-treasure-2,persona-3,story-2");
  ok("after unlock the card leaves the supply and the crate is unlocked",
    !m50.state.player("P1").hasCard("cbldg-1") && m50.state.crates.isUnlocked("cbldg-1") && m50.state.archive.has("cbldg-1"));
  ok("unlock components land in the correct pools",
    m50.state.personas.of("P1").includes("persona-3") && m50.state.storyPool.has("story-2") &&
    m50.state.advancement.toJSON().deck.includes("asst-4"));
  m50.host.querySelector(".g-modal-close").click();
  ok("closing the modal dismisses it", !m50.host.querySelector(".g-modal"));

  // ── Task 51: turn flow & log — a scripted 20-move game ──
  const m51 = mount();
  const s51 = m51.state;
  const u51 = m51.ui;
  const treasury51 = cellKey(s51, "treasury");
  const charterstone51 = cellKey(s51, "charterstone");
  const grandstand51 = cellKey(s51, "grandstand");
  const legalCell51 = s51.engine.legalConstructionCellsForPlayer("P1")[0].key;
  const grant = (pid, items) => s51.economy.gain(pid, items);
  const placeTreasury = () => {
    u51.act("enterPlace");
    u51.act("selectCell", treasury51);
    u51.act("chooseOption", "clay");
    return u51.act("confirm");
  };
  ok("the turn banner shows the active player with legal actions",
    m51.host.querySelector(".g-turn")?.dataset.currentPlayer === "P1" &&
    !!m51.host.querySelector('[data-action="place"]') && !!m51.host.querySelector('[data-action="retrieve"]'));
  // move 1: P1 → Treasury
  grant("P1", { clay: 1 });
  let r51 = placeTreasury();
  ok("move 1 logs a place on the Treasury by P1", r51.ok && s51.turns.currentPlayerId === "P2");
  // move 2: P2 → Treasury bumps P1
  grant("P2", { clay: 1 });
  r51 = placeTreasury();
  ok("move 2 logs the bump of the occupant", r51.ok && r51.bumped === "P1");
  // move 3: P1 constructs a mine via the Zeppelin
  grant("P1", { coal: 1, wood: 1, grain: 1, pumpkin: 1 });
  s51.player("P1").gainCard("bldg-mine");
  u51.act("enterConstruct", "bldg-mine");
  u51.act("selectCell", legalCell51);
  r51 = u51.act("confirm");
  ok("move 3 constructs on a legal cell", r51.ok && r51.benefit?.cell === legalCell51 && r51.buildingId === "zeppelin");
  // move 4: P2 → Treasury bumps own worker
  grant("P2", { clay: 1 });
  r51 = placeTreasury();
  ok("move 4 self-bump is recorded", r51.ok && r51.bumped === "P2");
  // move 5: P1 → Treasury bumps P2
  grant("P1", { clay: 1 });
  r51 = placeTreasury();
  ok("move 5 bumps P2", r51.ok && r51.bumped === "P2");
  // move 6: P2 unlocks a crate at the Charterstone
  s51.player("P2").gainCard("cbldg-1");
  u51.act("enterPlace");
  u51.act("selectCell", charterstone51);
  u51.act("chooseOption", "cbldg-1");
  r51 = u51.act("confirm");
  ok("move 6 unlocks crate 1", r51.ok && r51.benefit?.crateNumber === 1 && r51.buildingId === "charterstone");
  // move 7: P1 retrieves two workers
  r51 = u51.act("retrieve");
  ok("move 7 retrieves both of P1's workers", r51.ok && r51.retrieved === 2);
  // move 8: P2 → Treasury completes obj-2 (8 coins)
  grant("P2", { clay: 1, coins: 8 });
  r51 = placeTreasury();
  ok("move 8 completes the 8-coin objective for P2", r51.ok && r51.completedObjectives.includes("obj-2"));
  // move 9: P1 → Treasury bumps P2
  grant("P1", { clay: 1 });
  r51 = placeTreasury();
  ok("move 9 bumps P2", r51.ok && r51.bumped === "P2");
  // move 10: P2 scores obj-2 at the Grandstand
  grant("P2", { clay: 1 });
  u51.act("enterPlace");
  u51.act("selectCell", grandstand51);
  u51.act("chooseOption", "obj-2");
  r51 = u51.act("confirm");
  ok("move 10 scores the completed objective", r51.ok && r51.buildingId === "grandstand");
  // moves 11-13: P1, P2 retrieve; P1 places
  r51 = u51.act("retrieve");
  ok("move 11 retrieves P1's worker", r51.ok && r51.retrieved === 1);
  r51 = u51.act("retrieve");
  ok("move 12 retrieves P2's workers", r51.ok && r51.retrieved === 2);
  grant("P1", { clay: 1 });
  r51 = placeTreasury();
  ok("move 13 places on an empty Treasury", r51.ok && r51.bumped === null);
  // moves 14-20: alternating Treasury bumps
  const expectedBumps = [];
  for (let i = 14; i <= 20; i++) {
    const pid = i % 2 === 0 ? "P2" : "P1";
    grant(pid, { clay: 1 });
    r51 = placeTreasury();
    expectedBumps.push(r51.bumped);
  }
  ok("moves 14-20 alternate Treasury bumps", expectedBumps.join(",") === "P1,P2,P1,P2,P1,P2,P1", expectedBumps.join(","));

  const ev = s51.log();
  ok("the log matches the 20-move event stream (21 entries incl. the score)",
    ev.length === 21, "len=" + ev.length);
  ok("place/retrieve entries alternate the players strictly",
    ev.filter(e => e.event === "place" || e.event === "retrieve")
      .every((e, i) => e.playerId === (i % 2 === 0 ? "P1" : "P2")));
  ok("the score entry belongs to the player who scored",
    ev[9].event === "scoreObjective" && ev[9].playerId === "P2" &&
    ev[10].event === "place" && ev[10].playerId === "P2" && ev[10].detail.buildingId === "grandstand");
  ok("log events carry the expected sequence",
    ev.map(e => e.event).join(",") ===
      "place,place,place,place,place,place,retrieve,place,place,scoreObjective,place,retrieve,retrieve,place,place,place,place,place,place,place,place",
    ev.map(e => e.event).join(","));
  ok("the construction entry records the legal cell", ev[2].detail.buildingId === "zeppelin" && ev[2].detail.benefit?.cell === legalCell51);
  ok("the unlock entry records the crate number", ev[5].detail.buildingId === "charterstone" && ev[5].detail.benefit?.crateNumber === 1);
  ok("the bump stream is recorded in detail.bumped",
    ev.map(e => e.detail.bumped ?? "").join(",") ===
      ",P1,,P2,P2,,,,P2,,,,,,P1,P2,P1,P2,P1,P2,P1");
  ok("the score entry records the objective and its VP",
    ev[9].event === "scoreObjective" && ev[9].detail.objectiveId === "obj-2" && ev[9].detail.vp === 5);
  ok("the retrieve entries record their counts",
    ev[6].detail.count === 2 && ev[11].detail.count === 1 && ev[12].detail.count === 2);
  const logEntries = m51.host.querySelectorAll(".g-log-entry");
  ok("the on-screen turn log mirrors the event stream",
    logEntries.length === ev.length && [...logEntries].every((el, i) =>
      el.dataset.event === ev[i].event && el.dataset.playerId === ev[i].playerId));

  // ── Task 52: responsive layouts — no horizontal scroll at 360px ──
  function mountAt(width) {
    const host = document.createElement("div");
    host.style.cssText = `width:${width}px;box-sizing:border-box;overflow:auto;container-type:inline-size;`;
    document.body.appendChild(host);
    hosts.push(host);
    const ui = createGameUI(setupDemoGame({ rng: lcg(1) }), { container: host });
    ui.render();
    return host;
  }
  const h360 = mountAt(360);
  const h768 = mountAt(768);
  const h1280 = mountAt(1280);
  ok("no horizontal scroll at 360px mobile portrait",
    h360.scrollWidth <= h360.clientWidth + 1, `scrollWidth=${h360.scrollWidth} clientWidth=${h360.clientWidth}`);
  ok("no horizontal scroll at 768px mobile landscape / tablet",
    h768.scrollWidth <= h768.clientWidth + 1, `scrollWidth=${h768.scrollWidth} clientWidth=${h768.clientWidth}`);
  ok("no horizontal scroll at desktop width",
    h1280.scrollWidth <= h1280.clientWidth + 1, `scrollWidth=${h1280.scrollWidth} clientWidth=${h1280.clientWidth}`);
  ok("the two-column desktop layout collapses to a single column for narrow containers",
    !getComputedStyle(h360.querySelector(".g-layout")).gridTemplateColumns.includes(" ") &&
    getComputedStyle(h1280.querySelector(".g-layout")).gridTemplateColumns.split(" ").length >= 2,
    getComputedStyle(h360.querySelector(".g-layout")).gridTemplateColumns + " | " + getComputedStyle(h1280.querySelector(".g-layout")).gridTemplateColumns);

  for (const h of hosts) h.remove();
  const pass = results.filter(x => x.pass).length;
  const fail = results.length - pass;
  return { suite: "gameui", pass, fail, results };
}
