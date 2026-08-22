// Task #155: Damage Number Pop-ups — short-lived floating damage/heal/status
// numbers above map targets. The core system is pure data (spawn + age +
// expire, no DOM) so it is unit-testable; `attach()` binds a thin absolute-
// positioned layer over a tile grid, and the game loop drives `update()` +
// `render()`.

const KIND_COLORS = {
  damage: "#ff8a8a",
  heal: "#7dffa6",
  miss: "#9aa4c0",
  crit: "#ffe14d",
  status: "#c9a2ff",
  gold: "#ffd24a",
  xp: "#7fd4ff",
};

const KIND_DURATION = {
  damage: 900,
  heal: 1100,
  miss: 700,
  crit: 1100,
  status: 900,
  gold: 1000,
  xp: 1000,
};

export class DamagePopupSystem {
  constructor(opts = {}) {
    this.random = opts.random ?? Math.random;
    this.max = opts.max ?? 60;
    this.popups = [];
    this.idSeq = 0;
    this.container = null;
    this.cell = opts.cell ?? 18;
    this._host = null;
  }

  // Spawn a popup at tile (x, y). `opts.kind` picks color/duration; `text`
  // is what floats up (e.g. "-12", "MISS", "Poison!").
  add(x, y, text, opts = {}) {
    const kind = opts.kind ?? "damage";
    const popup = {
      id: ++this.idSeq,
      x,
      y,
      text: String(text),
      kind,
      color: opts.color ?? KIND_COLORS[kind] ?? "#ffffff",
      age: 0,
      duration: opts.duration ?? KIND_DURATION[kind] ?? 900,
      rise: opts.rise ?? 42,
      dx: opts.dx ?? 0,
    };
    if (this.popups.length >= this.max) this.popups.shift();
    this.popups.push(popup);
    return popup;
  }

  active() {
    return [...this.popups];
  }

  count() {
    return this.popups.length;
  }

  // Advance every popup's age; drop the expired ones. Returns removal stats.
  update(dtMs) {
    const before = this.popups.length;
    for (const p of this.popups) p.age += dtMs;
    this.popups = this.popups.filter((p) => p.age < p.duration);
    return { removed: before - this.popups.length, remaining: this.popups.length };
  }

  clear() {
    this.popups = [];
    return this;
  }

  // Bind an overlay host over `container` (must be position:relative or the
  // absolute host is positioned against the nearest positioned ancestor).
  attach(container, opts = {}) {
    this.container = container;
    this.cell = opts.cell ?? this.cell;
    if (!container) return this;
    if (!this._host || !this._host.isConnected) {
      const host = document.createElement("div");
      host.className = "ff-popups";
      host.style.cssText =
        "position:absolute;inset:0;pointer-events:none;overflow:visible;font-family:monospace;";
      container.appendChild(host);
      this._host = host;
    }
    return this;
  }

  // Re-render the active popups onto the host (absolute floats rising and
  // fading out over their life). No-op without an attached container.
  render() {
    if (!this._host) return;
    this._host.innerHTML = "";
    for (const p of this.popups) {
      const t = Math.min(1, p.age / p.duration);
      const risePx = Math.round(p.rise * t);
      const xPx = Math.round(p.x * this.cell + this.cell / 2 + p.dx * t);
      const yPx = Math.round(p.y * this.cell - risePx);
      const opacity = p.duration - p.age < 260 ? (p.duration - p.age) / 260 : 1;
      const el = document.createElement("div");
      el.className = "ff-popup ff-popup-" + p.kind;
      el.textContent = p.text;
      el.style.cssText =
        "position:absolute;left:" + xPx + "px;top:" + yPx + "px;transform:translate(-50%,-50%);" +
        "color:" + p.color + ";font-size:12px;font-weight:bold;text-shadow:0 1px 2px #000;" +
        "opacity:" + opacity.toFixed(2) + ";white-space:nowrap;pointer-events:none;";
      this._host.appendChild(el);
    }
    return this;
  }
}
