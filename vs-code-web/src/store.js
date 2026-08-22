export class VFS {
  constructor() {
    this.root = { type: "dir", children: {} };
  }

  parts(path) {
    return String(path).split("/").filter(Boolean);
  }

  get(path) {
    let node = this.root;
    for (const p of this.parts(path)) {
      if (!node || node.type !== "dir") return null;
      node = node.children[p];
    }
    return node || null;
  }

  isDir(path) {
    const n = this.get(path);
    return !!n && n.type === "dir";
  }

  read(path) {
    const n = this.get(path);
    return n && n.type === "file" ? n.content : null;
  }

  write(path, content) {
    const parts = this.parts(path);
    const name = parts.pop();
    const parent = this.ensureDir(parts.join("/"));
    if (!parent) return false;
    const n = parent.children[name] || (parent.children[name] = { type: "file", content: "" });
    if (n.type !== "file") return false;
    n.content = content;
    return true;
  }

  ensureDir(dir) {
    let node = this.root;
    for (const p of this.parts(dir)) {
      if (node.type !== "dir") return null;
      if (!node.children[p]) node.children[p] = { type: "dir", children: {} };
      node = node.children[p];
    }
    return node;
  }

  createFile(path, content = "") {
    const parts = this.parts(path);
    const name = parts.pop();
    const parent = this.ensureDir(parts.join("/"));
    if (!parent || parent.children[name]) return false;
    parent.children[name] = { type: "file", content };
    return true;
  }

  createDir(path) {
    const parts = this.parts(path);
    const name = parts.pop();
    const parent = this.get(parts.join("/"));
    if (!parent || parent.type !== "dir" || parent.children[name]) return false;
    parent.children[name] = { type: "dir", children: {} };
    return true;
  }

  delete(path) {
    const parts = this.parts(path);
    const name = parts.pop();
    const parent = this.get(parts.join("/"));
    if (!parent || parent.type !== "dir" || !parent.children[name]) return false;
    delete parent.children[name];
    return true;
  }

  rename(path, newName) {
    if (!newName || /[\\/]/.test(newName)) return false;
    const parts = this.parts(path);
    const name = parts.pop();
    const parent = this.get(parts.join("/"));
    if (!parent || parent.type !== "dir" || !parent.children[name]) return false;
    if (parent.children[newName]) return false;
    const node = parent.children[name];
    delete parent.children[name];
    parent.children[newName] = node;
    return true;
  }

  listDir(dir) {
    const n = this.get(dir);
    if (!n || n.type !== "dir") return [];
    return Object.entries(n.children)
      .map(([name, node]) => ({ name, node }))
      .sort((a, b) => {
        const ad = a.node.type === "dir" ? 0 : 1;
        const bd = b.node.type === "dir" ? 0 : 1;
        if (ad !== bd) return ad - bd;
        return a.name.localeCompare(b.name);
      });
  }

  walkFiles() {
    const out = [];
    const rec = (dir, prefix) => {
      for (const { name, node } of this.listDir(dir)) {
        const p = prefix ? prefix + "/" + name : name;
        if (node.type === "file") out.push(p);
        else rec(p, p);
      }
    };
    rec("", "");
    return out;
  }

  toJSON() {
    return this.root;
  }

  static fromJSON(root) {
    const v = new VFS();
    v.root = root;
    return v;
  }
}

const listeners = {};
export const bus = {
  on(ev, fn) {
    (listeners[ev] = listeners[ev] || []).push(fn);
    return () => {
      listeners[ev] = (listeners[ev] || []).filter((f) => f !== fn);
    };
  },
  emit(ev, ...args) {
    for (const fn of (listeners[ev] || []).slice()) {
      try {
        fn(...args);
      } catch (e) {
        console.error("[event]", ev, e);
      }
    }
  },
};

export const store = {
  vfs: new VFS(),
  tabs: [],
  activePath: null,
  saved: {},
  dirty: new Set(),
  settings: { theme: "dark", fontSize: 13, wordWrap: false, tabSize: 2 },
  expanded: new Set(),
  cwd: "",
  cmds: [],
  langOverride: {},
  folds: {},
};

export function registerCmd(id, def) {
  def.id = id;
  store.cmds.push(def);
  return def;
}

const STORE_KEY = "state";
let persistTimer = null;

async function persistAll() {
  const payload = {
    root: store.vfs.toJSON(),
    settings: store.settings,
    tabs: store.tabs,
    active: store.activePath,
    expanded: [...store.expanded],
    langOverride: store.langOverride,
    folds: store.folds,
  };
  try {
    const kv = globalThis.root && globalThis.root.kv;
    if (kv) await kv.vscode.set(STORE_KEY, payload);
  } catch (e) {
    console.error("persist failed", e);
  }
}

export function schedulePersist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(persistAll, 500);
}

export async function loadPersisted() {
  try {
    const kv = globalThis.root && globalThis.root.kv;
    if (!kv) return;
    const st = await kv.vscode.get(STORE_KEY);
    if (!st || !st.root) return;
    store.vfs = VFS.fromJSON(st.root);
    if (st.settings) Object.assign(store.settings, st.settings);
    if (Array.isArray(st.tabs)) store.tabs = st.tabs.filter((p) => store.vfs.read(p) !== null);
    store.activePath = store.tabs.includes(st.active) ? st.active : store.tabs[store.tabs.length - 1] || null;
    if (Array.isArray(st.expanded)) {
      store.expanded = new Set(st.expanded.filter((p) => store.vfs.isDir(p)));
    }
    if (st.langOverride && typeof st.langOverride === "object") {
      store.langOverride = { ...st.langOverride };
    }
    if (st.folds && typeof st.folds === "object") {
      store.folds = {};
      for (const [p, arr] of Object.entries(st.folds)) {
        if (store.vfs.read(p) !== null && Array.isArray(arr)) store.folds[p] = arr;
      }
    }
  } catch (e) {
    console.error("load failed", e);
  }
}
