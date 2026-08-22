// Task #127: Combat State Transition Handler — an explicit state machine for
// a battle turn: Waiting for Input -> Executing Action -> Resolving Damage ->
// End of Round -> (back to Waiting for Input), with terminal states for
// Victory / Defeat / Fled. Illegal transitions are rejected, not coerced.

export const COMBAT_STATES = {
  WAITING_INPUT: "waiting_for_input",
  EXECUTING_ACTION: "executing_action",
  RESOLVING_DAMAGE: "resolving_damage",
  END_OF_ROUND: "end_of_round",
  VICTORY: "victory",
  DEFEAT: "defeat",
  FLED: "fled",
};

export const COMBAT_STATE_LIST = Object.freeze(Object.values(COMBAT_STATES));

const ALLOWED = {
  waiting_for_input: ["executing_action", "victory", "defeat", "fled"],
  executing_action: ["resolving_damage"],
  resolving_damage: ["end_of_round", "executing_action", "victory", "defeat", "fled"],
  end_of_round: ["waiting_for_input", "victory", "defeat", "fled"],
  victory: [],
  defeat: [],
  fled: [],
};

export class CombatStateMachine {
  constructor(opts = {}) {
    this.current = opts.initial ?? COMBAT_STATES.WAITING_INPUT;
    this.history = [this.current];
    this.round = 0;
    this.onTransition = opts.onTransition ?? null; // ({from,to,round}) => void
  }

  allowed(from, to) {
    return (ALLOWED[from] ?? []).includes(to);
  }

  canTransition(to) {
    return this.allowed(this.current, to);
  }

  transition(to, meta = {}) {
    if (!COMBAT_STATES[Object.keys(COMBAT_STATES).find((k) => COMBAT_STATES[k] === to)] && !ALLOWED[to]) {
      return { ok: false, error: "unknown state: " + to };
    }
    if (!this.canTransition(to)) {
      return { ok: false, error: "invalid transition: " + this.current + " -> " + to, from: this.current, to };
    }
    const from = this.current;
    this.current = to;
    this.history.push(to);
    if (this.onTransition) this.onTransition({ from, to, round: this.round, ...meta });
    return { ok: true, from, to, round: this.round };
  }

  is(state) {
    return this.current === state;
  }

  get state() {
    return this.current;
  }

  awaitingInput() {
    return this.is(COMBAT_STATES.WAITING_INPUT);
  }

  executing() {
    return this.is(COMBAT_STATES.EXECUTING_ACTION);
  }

  startAction() {
    return this.transition(COMBAT_STATES.EXECUTING_ACTION);
  }

  resolveDamage() {
    return this.transition(COMBAT_STATES.RESOLVING_DAMAGE);
  }

  // Close the current round: resolving -> end_of_round -> waiting_for_input,
  // bumping the round counter. A battle that is already over stays terminal.
  endRound() {
    if (this.current === COMBAT_STATES.RESOLVING_DAMAGE) {
      const r = this.transition(COMBAT_STATES.END_OF_ROUND);
      if (!r.ok) return r;
    } else if (this.current !== COMBAT_STATES.END_OF_ROUND) {
      return { ok: false, error: "endRound requires resolving_damage", from: this.current };
    }
    this.round += 1;
    const next = this.transition(COMBAT_STATES.WAITING_INPUT);
    if (!next.ok) return next;
    return { ok: true, round: this.round, state: this.current };
  }

  finish(outcome) {
    const to = COMBAT_STATES[outcome] ?? outcome;
    const r = this.transition(to);
    if (r.ok) this.round += 1;
    return { ok: r.ok, ...r };
  }

  label() {
    return this.current.replace(/_/g, " ");
  }

  reset() {
    this.current = COMBAT_STATES.WAITING_INPUT;
    this.history = [this.current];
    this.round = 0;
    return this;
  }
}
