// Task #40: Cinematic Text Sequence — full-screen, input-blocking text for
// story intros and plot twists. Each line advances on click/Enter/Space;
// the input lock is reported via onLockChange so movement loops can pause.

export class CinematicSystem {
  constructor(opts = {}) {
    this.container = opts.container ?? (typeof document !== "undefined" ? document.body : null);
    this.onDone = opts.onDone ?? null;
    this.onLockChange = opts.onLockChange ?? null;
    this.state = opts.state ?? null;
    this.handlers = opts.handlers ?? {};
    this.speed = opts.speed ?? 0;
    this.lines = [];
    this.index = 0;
    this.playing = false;
    this.el = null;
    this._keyHandler = null;
    this._clickHandler = null;
  }

  get isPlaying() {
    return this.playing;
  }

  // While playing, player input (movement etc.) should be locked.
  get inputLocked() {
    return this.playing;
  }

  get current() {
    return this.playing ? this.lines[this.index] ?? null : null;
  }

  // lines: strings or { text, flag } objects. Setting `flag` on a line is
  // applied (via ctx.state) when that line is shown.
  play(lines, opts = {}) {
    this.lines = (lines || []).map((l) => (typeof l === "string" ? { text: l } : { ...l }));
    this.index = 0;
    this.playing = true;
    this.onDone = opts.onDone ?? this.onDone ?? null;
    this._setLock(true);
    if (this.container && !opts.headless) this._build(opts);
    this._show();
    const first = this.lines[0];
    if (first?.flag) this._applyLine(first);
    return this;
  }

  advance() {
    if (!this.playing) return { done: true };
    this.index++;
    if (this.index >= this.lines.length) return this.end();
    const line = this.lines[this.index];
    if (line?.flag) this._applyLine(line);
    this._show();
    return { index: this.index, done: false };
  }

  // Skip to the end (applies remaining line flags).
  skip() {
    if (!this.playing) return this.end();
    while (this.index < this.lines.length) {
      const line = this.lines[this.index];
      if (line?.flag) this._applyLine(line);
      this.index++;
    }
    return this.end();
  }

  end() {
    if (!this.playing) return { done: true };
    this.playing = false;
    this._setLock(false);
    if (this.el) {
      this.el.remove();
      this.el = null;
    }
    if (this._keyHandler) {
      document.removeEventListener("keydown", this._keyHandler);
      this._keyHandler = null;
    }
    if (this._clickHandler) {
      this._clickHandler = null;
    }
    const cb = this.onDone;
    this.onDone = null;
    if (cb) cb();
    return { done: true };
  }

  _setLock(locked) {
    if (this.onLockChange) this.onLockChange(locked);
  }

  _applyLine(line) {
    if (line.flag) {
      if (this.state?.setFlag) this.state.setFlag(line.flag, line.value ?? true);
      if (this.handlers.setFlag) this.handlers.setFlag(line.flag, line.value ?? true);
    }
  }

  _show() {
    const line = this.lines[this.index];
    if (this.el) this.el.querySelector(".cin-text").textContent = line?.text ?? "";
  }

  _build(opts) {
    if (this.el) this.el.remove();
    const el = document.createElement("div");
    el.className = "cinematic-overlay";
    el.innerHTML =
      '<div class="cin-box"><div class="cin-text"></div><div class="cin-hint">' +
      (opts.hint ?? "Press Enter, click, or press Space to continue") +
      "</div></div>";
    const style = document.createElement("style");
    style.textContent =
      ".cinematic-overlay{position:fixed;inset:0;z-index:999;background:rgba(3,5,12,.96);display:flex;align-items:center;justify-content:center;cursor:pointer;}" +
      ".cin-box{max-width:640px;padding:2rem;border:2px solid #39456e;background:#0a0e1e;color:#e8eefc;font-family:monospace;font-size:1.05rem;line-height:1.6;text-align:center;}" +
      ".cin-hint{margin-top:1rem;color:#8fa8e8;font-size:.75rem;letter-spacing:.15em;text-transform:uppercase;}";
    style.id = "cinematic-overlay-style";
    if (!document.getElementById("cinematic-overlay-style")) document.head.appendChild(style);
    this._clickHandler = () => this.advance();
    el.addEventListener("click", this._clickHandler);
    this._keyHandler = (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        this.advance();
      } else if (e.key === "Escape") {
        this.skip();
      }
    };
    document.addEventListener("keydown", this._keyHandler);
    this.container.appendChild(el);
    this.el = el;
  }
}
