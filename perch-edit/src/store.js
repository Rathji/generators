export class VFS {
  constructor() {
    this.root = { type: "dir", children: {} };
    this.order = {};
  }

  parts(path) {
    return String(path).split("/").filter(Boolean);
  }

  parentDir(path) {
    const parts = this.parts(path);
    parts.pop();
    return parts.join("/");
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
    this.orderAdd(parts.join("/"), name);
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
    this.orderAdd(parts.join("/"), name);
    return true;
  }

  createDir(path) {
    const parts = this.parts(path);
    const name = parts.pop();
    const parent = this.get(parts.join("/"));
    if (!parent || parent.type !== "dir" || parent.children[name]) return false;
    parent.children[name] = { type: "dir", children: {} };
    this.orderAdd(parts.join("/"), name);
    return true;
  }

  delete(path) {
    const parts = this.parts(path);
    const name = parts.pop();
    const parent = this.get(parts.join("/"));
    if (!parent || parent.type !== "dir" || !parent.children[name]) return false;
    delete parent.children[name];
    this.orderRemove(parts.join("/"), name);
    if (this.get(path) && this.get(path).type === "dir") {
      for (const k of Object.keys(this.order)) {
        if (k === path || k.startsWith(path + "/")) delete this.order[k];
      }
    }
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
    this.orderRename(parts.join("/"), name, newName);
    if (node.type === "dir") this.relocateOrder(path, parts.join("/") + "/" + newName);
    return true;
  }

  listDir(dir) {
    const n = this.get(dir);
    if (!n || n.type !== "dir") return [];
    const order = this.order[dir || ""] || [];
    const rank = (name) => {
      const i = order.indexOf(name);
      return i === -1 ? order.length + 1000 : i;
    };
    return Object.entries(n.children)
      .map(([name, node]) => ({ name, node }))
      .sort((a, b) => {
        const ad = a.node.type === "dir" ? 0 : 1;
        const bd = b.node.type === "dir" ? 0 : 1;
        if (ad !== bd) return ad - bd;
        return rank(a.name) - rank(b.name);
      });
  }

  orderAdd(dir, name) {
    const arr = (this.order[dir || ""] = this.order[dir || ""] || []);
    if (!arr.includes(name)) arr.push(name);
  }

  orderRemove(dir, name) {
    const arr = this.order[dir || ""];
    if (arr) {
      const i = arr.indexOf(name);
      if (i > -1) arr.splice(i, 1);
      if (!arr.length) delete this.order[dir || ""];
    }
  }

  orderRename(dir, oldName, newName) {
    const arr = this.order[dir || ""];
    if (arr) {
      const i = arr.indexOf(oldName);
      if (i > -1) arr[i] = newName;
      else this.orderAdd(dir, newName);
    }
  }

  reorder(dir, name, toIndex) {
    const arr = this.order[dir || ""];
    if (!arr || !arr.includes(name)) return false;
    const from = arr.indexOf(name);
    arr.splice(from, 1);
    arr.splice(Math.max(0, Math.min(toIndex, arr.length)), 0, name);
    return true;
  }

  move(path, newDir) {
    const parts = this.parts(path);
    const name = parts.pop();
    const fromParent = parts.join("/");
    const target = this.get(newDir);
    if (!target || target.type !== "dir") return { error: "target is not a folder" };
    if (!this.get(path)) return { error: "no such file: " + path };
    if (newDir === fromParent) return { ok: true, path };
    if (path === newDir || (newDir && newDir.startsWith(path + "/"))) return { error: "cannot move a folder into itself" };
    if (target.children[name]) return { error: name + " already exists in " + (newDir || "/") };
    const isDir = this.get(path).type === "dir";
    target.children[name] = this.get(path);
    delete this.get(fromParent).children[name];
    this.orderRemove(fromParent, name);
    this.orderAdd(newDir, name);
    if (isDir) this.relocateOrder(path, newDir + "/" + name);
    return { ok: true, path: newDir + "/" + name, isDir };
  }

  relocateOrder(oldDir, newDir) {
    const pending = Object.keys(this.order).filter((d) => d === oldDir || d.startsWith(oldDir + "/"));
    for (const d of pending) {
      const nd = newDir + d.slice(oldDir.length);
      this.order[nd] = this.order[d];
      delete this.order[d];
    }
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

  walkNodes() {
    const out = [];
    const rec = (dir, prefix) => {
      for (const { name, node } of this.listDir(dir)) {
        const p = prefix ? prefix + "/" + name : name;
        out.push(p);
        if (node.type === "dir") rec(p, p);
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
  settings: {
    theme: "dark",
    accent: "#007acc",
    fontSize: 13,
    wordWrap: false,
    tabSize: 2,
    minimap: true,
    sidebarVisible: true,
    splitWidth: 45,
    ai: { provider: "perchance", model: "", key: "", baseUrl: "" },
  },
  expanded: new Set(),
  cwd: "",
  cmds: [],
  langOverride: {},
  folds: {},
  problems: {},
  snapshots: {},
  readOnly: false,
  scratch: null,
  split: null,
};

export function problemsCount() {
  let n = 0;
  for (const arr of Object.values(store.problems)) n += arr ? arr.length : 0;
  return n;
}

export function registerCmd(id, def) {
  def.id = id;
  store.cmds.push(def);
  return def;
}

const STORE_KEY = "state";
const SNAPSHOTS_KEY = "snapshots";
let persistTimer = null;
let snapTimer = null;

export function scheduleSnapshotPersist() {
  clearTimeout(snapTimer);
  snapTimer = setTimeout(persistSnapshots, 400);
}

async function persistSnapshots() {
  try {
    const kv = globalThis.root && globalThis.root.kv;
    if (kv) await kv.vscode.set(SNAPSHOTS_KEY, store.snapshots);
  } catch (e) {
    console.error("snapshot persist failed", e);
  }
}

async function persistAll() {
  const payload = {
    root: store.vfs.toJSON(),
    order: store.vfs.order,
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
    const [st, snaps] = await Promise.all([kv.vscode.get(STORE_KEY), kv.vscode.get(SNAPSHOTS_KEY)]);
    if (!st || !st.root) return;
    store.vfs = VFS.fromJSON(st.root);
    store.vfs.order = st.order && typeof st.order === "object" ? st.order : {};
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
    if (snaps && typeof snaps === "object") {
      store.snapshots = {};
      for (const [p, arr] of Object.entries(snaps)) {
        if (store.vfs.read(p) !== null && Array.isArray(arr)) {
          store.snapshots[p] = arr.filter((s) => s && typeof s.content === "string").slice(-50);
        }
      }
    }
  } catch (e) {
    console.error("load failed", e);
  }
}
