// ============================================================================
//  src/input.js — keyboard input for the VGN shell
//  ----------------------------------------------------------------------------
//  Uses e.code (physical key *positions*, not the printed character), so it
//  works on any keyboard layout — QWERTY, AZERTY, Dvorak, ...
//  Physical keys are mapped to *named actions* (left / right / jump / start /
//  pause / ...). Your game code should only ever read those named actions,
//  never raw key codes:
//      ctx.input.isDown('right')   → true while held (continuous motion)
//      ctx.input.pressed('jump')   → true once per press (edge-triggered)
//  Menu-level actions (start / pause / confirm) are consumed by the shell in
//  src/main.js — a game module reads only movement + action keys.
//  ============================================================================

// Map: action name → list of physical key codes that trigger it.
const ACTION_KEYS = {
  left:    ['ArrowLeft', 'KeyA'],
  right:   ['ArrowRight', 'KeyD'],
  up:      ['ArrowUp', 'KeyW'],
  down:    ['ArrowDown', 'KeyS'],
  jump:    ['Space', 'KeyZ', 'ArrowUp', 'KeyW'],
  start:   ['Enter', 'Space'],
  confirm: ['Enter', 'Space'],
  pause:   ['KeyP', 'Escape'],
};

export class Input {
  constructor(target = window) {
    this.target = target;
    this._held = new Set();          // physical codes currently held down
    this._edges = new Set();         // actions with a fresh press this frame
    this._codeToActions = {};        // reverse lookup code → [actions]
    for (const [action, codes] of Object.entries(ACTION_KEYS)) {
      for (const code of codes) {
        (this._codeToActions[code] ||= []).push(action);
      }
    }
    this._attached = false;
  }

  attach() {
    if (this._attached) return;
    this._attached = true;
    this.target.addEventListener('keydown', this._onKeyDown, { passive: false });
    this.target.addEventListener('keyup', this._onKeyUp);
  }

  detach() {
    if (!this._attached) return;
    this._attached = false;
    this.target.removeEventListener('keydown', this._onKeyDown);
    this.target.removeEventListener('keyup', this._onKeyUp);
  }

  _onKeyDown = (e) => {
    const actions = this._codeToActions[e.code];
    if (!actions) return;
    e.preventDefault();              // stop page scroll / button double-trigger
    if (e.repeat) return;            // ignore key auto-repeat
    this._held.add(e.code);
    for (const a of actions) this._edges.add(a);
  };

  _onKeyUp = (e) => {
    this._held.delete(e.code);
  };

  // True while an action's key is held down (use for continuous motion).
  isDown(action) {
    const codes = ACTION_KEYS[action];
    if (!codes) return false;
    for (const c of codes) if (this._held.has(c)) return true;
    return false;
  }

  // True exactly once per key press, then consumed — a quick tap can't fire
  // twice (e.g. one Space press can't cause a double-jump).
  pressed(action) {
    return this._edges.delete(action);
  }

  // Drop all pending presses. Called after menu transitions so the key that
  // started a run doesn't leak into gameplay (e.g. Space both starts and jumps).
  clearEdges() {
    this._edges.clear();
  }

  // Forget all held keys — call on window blur so keys don't get stuck.
  clear() {
    this._held.clear();
    this._edges.clear();
  }

  // Called by the engine once per animation frame.
  endFrame() {
    this._edges.clear();
  }
}
