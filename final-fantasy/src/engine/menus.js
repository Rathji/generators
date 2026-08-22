// Task #46: Dynamic Menu Navigation — a reusable, stack-based menu model
// powering Inventory / Status / Magic / Combat command screens. Pure logic
// (no DOM) so it is fully unit-testable; a small renderer is provided too.

function isScreenDescriptor(x) {
  return !!x && typeof x === "object" && Array.isArray(x.items);
}

export class MenuSystem {
  constructor(opts = {}) {
    this.screens = [];
    this.onChange = opts.onChange ?? null;
    this.rememberRoot = opts.rememberRoot ?? false;
    this._root = null;
  }

  get current() {
    return this.screens[this.screens.length - 1] ?? null;
  }

  get depth() {
    return this.screens.length;
  }

  get isOpen() {
    return this.screens.length > 0;
  }

  // Open a screen (optionally re-selecting an item by id).
  open(screen, selectId = null) {
    const s = this._normalize(screen);
    if (selectId) {
      const idx = s.items.findIndex((i) => i.id === selectId);
      if (idx !== -1) s.selected = idx;
    }
    this.screens.push(s);
    if (this.rememberRoot && this.screens.length === 1) this._root = s;
    this._notify();
    return s;
  }

  // Return to the root menu (close any open submenus).
  root() {
    if (this.rememberRoot && this._root) {
      this.screens = [this._root];
      this._notify();
      return this._root;
    }
    if (this.screens.length > 1) {
      this.screens = this.screens.slice(0, 1);
      this._notify();
      return this.current;
    }
    return this.current;
  }

  // Pop one level of the menu stack.
  close() {
    const popped = this.screens.pop() ?? null;
    this._notify();
    return popped;
  }

  reset() {
    this.screens = [];
    this._root = null;
    this._notify();
    return this;
  }

  itemAt(index) {
    return this.current?.items[index] ?? null;
  }

  selectedItem() {
    return this.itemAt(this.current?.selected ?? 0);
  }

  item(id) {
    return this.current?.items.find((i) => i.id === id) ?? null;
  }

  select(id) {
    const idx = this.current?.items.findIndex((i) => i.id === id) ?? -1;
    if (idx === -1) return false;
    this.current.selected = idx;
    this._notify();
    return true;
  }

  // Move selection; dir may be -1/1 or "up"/"down". Wraps, skipping disabled.
  navigate(dir) {
    const cur = this.current;
    if (!cur) return null;
    const step = dir === "up" ? -1 : dir === "down" ? 1 : (typeof dir === "number" ? dir : 0);
    if (step === 0) return null;
    const enabled = cur.items.map((it, i) => (it.disabled ? null : i)).filter((i) => i !== null);
    if (!enabled.length) return null;
    let idx = enabled.indexOf(cur.selected);
    if (idx === -1) idx = 0;
    idx = (idx + step + enabled.length) % enabled.length;
    cur.selected = enabled[idx];
    this._notify();
    return this.selectedItem();
  }

  // Activate the selected item: run its action, or push a submenu screen.
  confirm() {
    const it = this.selectedItem();
    if (!it || it.disabled) return null;
    if (typeof it.action === "function") return it.action(it, this);
    if (isScreenDescriptor(it.action)) {
      const s = this.open(it.action);
      return { submenu: s.title ?? s.items[0]?.id ?? null };
    }
    return { selected: it.id };
  }

  cancel() {
    if (this.screens.length <= 1) return null;
    return this.close();
  }

  // Map physical keys to menu actions; returns what happened or null.
  handleKey(key) {
    switch (key) {
      case "ArrowDown":
      case "s":
      case "S":
        return this.navigate(1);
      case "ArrowUp":
      case "w":
      case "W":
        return this.navigate(-1);
      case "ArrowLeft":
      case "a":
      case "A":
        return this.navigate(-1);
      case "ArrowRight":
      case "d":
      case "D":
        return this.navigate(1);
      case "Enter":
      case " ":
      case "z":
      case "Z":
        return this.confirm();
      case "Escape":
      case "x":
      case "X":
      case "Backspace":
        return this.cancel();
      default:
        return null;
    }
  }

  // Serializable view of the active screen for any UI renderer.
  render() {
    const cur = this.current;
    if (!cur) return null;
    return {
      title: cur.title,
      depth: this.depth,
      selected: cur.selected,
      items: cur.items.map((it, i) => ({
        id: it.id,
        label: it.label,
        disabled: !!it.disabled,
        hint: it.hint ?? null,
        selected: i === cur.selected,
      })),
    };
  }

  _normalize(screen) {
    return {
      title: screen.title ?? "",
      items: (screen.items ?? []).map((i) => ({ ...i })),
      selected: 0,
    };
  }

  _notify() {
    if (this.onChange) this.onChange(this.render());
  }
}

// Optional DOM renderer for the menu model.
export function renderMenuHtml(view) {
  if (!view) return "";
  return (
    '<div class="menu-screen">' +
    (view.title ? '<div class="menu-title">' + view.title + "</div>" : "") +
    '<ul class="menu-list">' +
    view.items
      .map(
        (it) =>
          '<li class="menu-item' + (it.selected ? " sel" : "") + (it.disabled ? " dis" : "") + '" data-id="' + it.id + '">' +
          it.label +
          (it.hint ? '<span class="menu-hint">' + it.hint + "</span>" : "") +
          "</li>"
      )
      .join("") +
    "</ul></div>"
  );
}
