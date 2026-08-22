// Tasks #77/#78: UI Screen Transition Animations — smooth fades and slides
// between menus/game screens. DOM-free core: the timing/staging logic is
// testable with injected `wait` and `apply` fns; the default implementation
// drives a fixed overlay element with CSS transitions.

export const TRANSITION_KINDS = Object.freeze({
  FADE: "fade",
  SLIDE: "slide",
  FLASH: "flash",
});

export class ScreenTransitionSystem {
  constructor(opts = {}) {
    this.el = opts.el ?? null;
    this.duration = opts.duration ?? 220; // per phase, ms
    this.color = opts.color ?? "#05060f";
    this.running = false;
    // Injected seam for tests (non-DOM).
    this._wait = opts.wait ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this._apply = opts.apply ?? ((styles) => this._applyDom(styles));
    this.log = [];
  }

  setElement(el) {
    this.el = el;
    return this;
  }

  isRunning() {
    return this.running;
  }

  _ensureEl() {
    if (this.el) return this.el;
    if (typeof document === "undefined") return null;
    let overlay = document.getElementById("ff-screen-transition");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "ff-screen-transition";
      overlay.style.cssText =
        "position:fixed;inset:0;z-index:99999;pointer-events:none;opacity:0;background:" +
        this.color +
        ";transition:opacity " +
        this.duration +
        "ms ease;";
      document.body.appendChild(overlay);
    }
    this.el = overlay;
    return overlay;
  }

  _applyDom(styles) {
    const el = this._ensureEl();
    if (!el) return;
    for (const [k, v] of Object.entries(styles)) el.style[k] = v;
  }

  _record(name, opts) {
    const rec = { name, at: Date.now(), ...opts };
    this.log.push(rec);
    return rec;
  }

  // Fade out, run `mid` (e.g. swap screens), fade back in.
  async transition(fn, opts = {}) {
    if (this.running) return { ok: false, error: "transition already running" };
    this.running = true;
    try {
      await this.fadeOut(opts);
      let midResult = null;
      if (fn) midResult = await fn();
      await this.fadeIn(opts);
      return { ok: true, mid: midResult };
    } finally {
      this.running = false;
    }
  }

  async fadeOut(opts = {}) {
    const d = opts.duration ?? this.duration;
    this._apply({ opacity: "1", pointerEvents: "auto", transition: "opacity " + d + "ms ease" });
    this._record("fadeOut", { duration: d });
    await this._wait(d);
    return { ok: true };
  }

  async fadeIn(opts = {}) {
    const d = opts.duration ?? this.duration;
    this._apply({ opacity: "0", pointerEvents: "none", transition: "opacity " + d + "ms ease" });
    this._record("fadeIn", { duration: d });
    await this._wait(d);
    return { ok: true };
  }

  // Brief colored flash (for impacts, boss phase shifts).
  async flash(color = null, ms = 160) {
    const c = color ?? this.color;
    this._apply({ opacity: "1", background: c, pointerEvents: "none", transition: "opacity 0ms" });
    this._record("flash", { color: c, ms });
    await this._wait(ms);
    this._apply({ opacity: "0", transition: "opacity " + ms + "ms ease" });
    await this._wait(ms);
    return { ok: true };
  }

  // Slide the current screen out in `dir` and back in.
  async slide(dir = "left", opts = {}) {
    const d = opts.duration ?? this.duration;
    const delta = { left: "-100%", right: "100%", up: "0,-100%", down: "0,100%" }[dir] ?? "-100%";
    this._apply({ transform: delta.includes(",") ? "translate(" + delta + ")" : "translateX(" + delta + ")", transition: "transform " + d + "ms ease" });
    this._record("slide", { dir, duration: d });
    await this._wait(d);
    this._apply({ transform: "translate(0,0)", transition: "transform " + d + "ms ease" });
    await this._wait(d);
    return { ok: true };
  }
}
