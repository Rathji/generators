// src/tutorial.test.js — Phase 14 learn-as-you-play onboarding (Task 69).
// Run in-page via ?test=tutorial, or via window.__loadTutorialTests().
// Task 69: the interactive Game-1 tutorial walks setup, first turn and
// first construction using the REAL engine APIs — so every step's action
// must drive a legal engine action and return ok:true.

import { createTutorialGame, createTutorial, TUTORIAL_VERSION, injectTutorialStyles } from "./tutorial.js";
import { serializeGameState, restoreGameState } from "./serialization.js";

export async function runTutorialTests() {
  const results = [];
  const ok = (name, cond, detail = "") => results.push({ name, pass: !!cond, detail });

  // ── every step drives a legal engine action, in the real game loop ──
  const g = createTutorialGame({ seed: 3 });
  const t = createTutorial(g, { container: null });
  ok("tutorial exposes version + steps", TUTORIAL_VERSION === 1 && t.steps.length === 5);
  ok("step order is setup → firstPlace → retrieve → construct → done",
    t.steps.map(s => s.id).join(",") === "setup,firstPlace,retrieve,construct,done");
  ok("tutorial game: P1 is on turn at the start", g.turns.isPlayerOnTurn("P1"));

  for (let i = 0; i < t.steps.length; i++) {
    const res = await t.advance();
    ok("step '" + t.steps[i].id + "' drives a legal engine action (ok)",
      res.ok === true, res.detail || "");
  }
  ok("every tutorial step succeeded", t.log.every(r => r.ok));
  ok("all five results are recorded in order", t.log.map(r => r.id).join(",") === "setup,firstPlace,retrieve,construct,done");
  ok("tutorial reports finished after the final step", t.finished === true);

  // the walkthrough left a real, legal game state behind
  const mine = g.board.constructedBuildings().some(b => b.buildingId === "mine" && b.ownerId === "P1");
  ok("the Mine was constructed on the board by P1", mine === true);
  ok("P1 earned construction VP", g.player("P1").vp >= 5);
  ok("the game still runs (serialize/restore round-trip)", (() => {
    try { const r = restoreGameState(serializeGameState(g)); return r && r.board.constructedBuildings().some(b => b.buildingId === "mine"); }
    catch (e) { return false; }
  })());

  // ── the UI path: render + interact ──
  const div = document.createElement("div");
  div.id = "tutTestHost";
  document.body.appendChild(div);
  injectTutorialStyles();
  const g2 = createTutorialGame({ seed: 5 });
  const t2 = createTutorial(g2, { container: div });
  t2.render();
  const card = div.querySelector(".cs-tutorial");
  ok("tutorial renders an overlay card", !!(card && card.querySelector(".cs-tut-title")));
  const doBtn = card.querySelector(".cs-tut-do");
  ok("the 'Do it' button is present", !!doBtn);
  doBtn.click();
  await new Promise(r => setTimeout(r, 30));
  const resultEl = card.querySelector(".cs-tut-result");
  ok("clicking 'Do it' runs the step and reports success", !!(resultEl && resultEl.textContent.indexOf("✓") === 0));
  const nextBtn = card.querySelector(".cs-tut-do");
  ok("success offers the next step", nextBtn.dataset.mode === "next");
  ok("styles were injected once", document.getElementById("cs-tutorial-styles") !== null);
  div.remove();

  const pass = results.filter(r => r.pass).length;
  const fail = results.filter(r => !r.pass).length;
  return { suite: "tutorial", pass, fail, results };
}
