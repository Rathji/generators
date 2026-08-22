// Task #80: Global Input Remapping — a centralized input handler with
// customizable key bindings. Every action resolves to one or more keys; keys
// can be rebound at runtime and the bindings saved/restored.

export const DEFAULT_ACTIONS = Object.freeze(["up", "down", "left", "right", "confirm", "cancel", "menu", "run"]);

export const DEFAULT_BINDINGS = Object.freeze({
  up: ["ArrowUp", "w"],
  down: ["ArrowDown", "s"],
  left: ["ArrowLeft", "a"],
  right: ["ArrowRight", "d"],
  confirm: ["Enter", " "],
  cancel: ["Escape"],
  menu: ["m", "Tab"],
  run: ["r"],
});

export const ACTION_LABELS = Object.freeze({
  up: "Move Up",
  down: "Move Down",
  left: "Move Left",
  right: "Move Right",
  confirm: "Confirm / Interact",
  cancel: "Cancel / Back",
  menu: "Menu",
  run: "Run",
});

function normalizeKey(key) {
  return typeof key === "string" ? key.toLowerCase() : "";
}

export class InputManager {
  constructor(opts = {}) {
    this.actions = opts.actions ?? [...DEFAULT_ACTIONS];
    this.bindings = {};
    this._loadBindings(opts.bindings ?? DEFAULT_BINDINGS);
    this.pressed = new Set(); // normalized keys currently held
    this.onAction = opts.onAction ?? null; // (action, event) => void
    this.enabled = true;
  }

  _loadBindings(b) {
    for (const action of this.actions) {
      const keys = b[action];
      this.bindings[action] = Array.isArray(keys) ? keys.map(normalizeKey) : keys ? [normalizeKey(keys)] : [];
    }
  }

  setEnabled(on) {
    this.enabled = on;
    return this;
  }

  actionForKey(key) {
    const k = normalizeKey(key);
    for (const action of this.actions) {
      if (this.bindings[action].includes(k)) return action;
    }
    return null;
  }

  keysFor(action) {
    return [...(this.bindings[action] ?? [])];
  }

  // Bind a key to an action (removes it from any other action).
  rebind(action, key) {
    if (!this.actions.includes(action)) return { ok: false, error: "unknown action" };
    const k = normalizeKey(key);
    for (const a of this.actions) {
      this.bindings[a] = this.bindings[a].filter((x) => x !== k);
    }
    this.bindings[action] = [k];
    return { ok: true, action, key: k };
  }

  bindingsSnapshot() {
    const out = {};
    for (const action of this.actions) out[action] = [...this.bindings[action]];
    return out;
  }

  load(snapshot) {
    if (snapshot) this._loadBindings(snapshot);
    return this;
  }

  reset() {
    this._loadBindings(DEFAULT_BINDINGS);
    return this;
  }

  // Central keydown handler: marks the key pressed and fires the action.
  handleKeyDown(e) {
    if (!this.enabled) return null;
    const action = this.actionForKey(e.key);
    if (!action) return null;
    const k = normalizeKey(e.key);
    if (!this.pressed.has(k)) this.pressed.add(k);
    if (this.onAction) this.onAction(action, e);
    return action;
  }

  handleKeyUp(e) {
    const k = normalizeKey(e.key);
    this.pressed.delete(k);
    return this.actionForKey(e.key);
  }

  isDown(action) {
    return this.bindings[action]?.some((k) => this.pressed.has(k)) ?? false;
  }

  clearPressed() {
    this.pressed.clear();
  }

  describe(action) {
    const label = ACTION_LABELS[action] ?? action;
    const keys = this.keysFor(action).map((k) => k.toUpperCase());
    return label + ": " + (keys.length ? keys.join(" / ") : "(unbound)");
  }

  describeAll() {
    return this.actions.map((a) => this.describe(a));
  }
}
