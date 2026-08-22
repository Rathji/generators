// Validation tests for Task #127: Combat State Transition Handler.

import { CombatStateMachine, COMBAT_STATES } from "../engine/combat-states.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const sm = new CombatStateMachine();
  check("starts waiting for input", sm.state === COMBAT_STATES.WAITING_INPUT && sm.awaitingInput());
  check("history initialized", sm.history.length === 1 && sm.history[0] === COMBAT_STATES.WAITING_INPUT);

  const start = sm.startAction();
  check("startAction ok", start.ok === true && sm.executing());
  check("executing cannot go to end_of_round directly", sm.canTransition(COMBAT_STATES.END_OF_ROUND) === false);

  const bad = sm.transition(COMBAT_STATES.END_OF_ROUND);
  check("illegal transition rejected", bad.ok === false && bad.error.includes("invalid transition"));

  const resolve = sm.resolveDamage();
  check("resolveDamage ok", resolve.ok === true && sm.state === COMBAT_STATES.RESOLVING_DAMAGE);

  const endR = sm.endRound();
  check("endRound returns to waiting", endR.ok === true && endR.round === 1 && sm.state === COMBAT_STATES.WAITING_INPUT);
  check("round increments", sm.round === 1);

  // Two full rounds.
  sm.startAction();
  sm.resolveDamage();
  const endR2 = sm.endRound();
  check("second round", endR2.ok === true && endR2.round === 2 && sm.awaitingInput());

  // Terminal states block further movement.
  const win = sm.finish("victory");
  check("victory terminal", win.ok === true && sm.state === COMBAT_STATES.VICTORY);
  check("no transitions after victory", sm.transition(COMBAT_STATES.WAITING_INPUT).ok === false);
  check("endRound after victory blocked", sm.endRound().ok === false);

  // Defeat terminal.
  const sm2 = new CombatStateMachine();
  sm2.finish("defeat");
  check("defeat terminal", sm2.state === COMBAT_STATES.DEFEAT);
  const sm3 = new CombatStateMachine();
  sm3.finish("fled");
  check("fled terminal", sm3.state === COMBAT_STATES.FLED);

  // onTransition callback records every hop.
  const events = [];
  const sm4 = new CombatStateMachine({ onTransition: (e) => events.push(e.from + "->" + e.to) });
  sm4.startAction();
  sm4.resolveDamage();
  check("onTransition fires", events.length === 2 && events[0] === "waiting_for_input->executing_action");

  check("label humanizes", new CombatStateMachine().label() === "waiting for input");

  const reset = new CombatStateMachine();
  reset.startAction();
  reset.endRound();
  reset.reset();
  check("reset restores initial", reset.state === COMBAT_STATES.WAITING_INPUT && reset.round === 0);

  check("endRound requires resolving", new CombatStateMachine().endRound().ok === false);

  return out;
}
