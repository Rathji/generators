import { store, bus, schedulePersist } from "./store.js";
import * as diff from "./diff.js";

export const GEN_DIR = "@gen";
export const GEN_MAIN = GEN_DIR + "/main.pjs";
export const GEN_HTML = GEN_DIR + "/index.html";
export const GEN_README = GEN_DIR + "/README.md";

export function genName() {
  const r = globalThis.root || {};
  const n =
    globalThis.generatorName || r.generatorName || (location.hostname || "").split(".")[0] || "generator";
  return String(n);
}

export function isActive() {
  return !!(store.scratch && store.scratch.name);
}

export function isScratchPath(p) {
  return !!p && p.startsWith(GEN_DIR + "/");
}

export function dirtyMap() {
  return { main: store.dirty.has(GEN_MAIN), html: store.dirty.has(GEN_HTML) };
}

export function changeStats(p) {
  const scr = store.scratch;
  const orig = scr && scr.original ? scr.original[p] : undefined;
  if (orig === undefined) return { added: 0, removed: 0 };
  const cur = store.vfs.read(p) ?? "";
  const rows = diff.buildRows(orig, cur);
  let added = 0;
  let removed = 0;
  for (const r of rows) {
    if (r.t === "add") added++;
    else if (r.t === "del") removed++;
  }
  return { added, removed };
}

async function fetchText(url) {
  const r = globalThis.root || {};
  const f = typeof r.superFetch === "function" ? (u) => r.superFetch(u) : fetch;
  const resp = await f(url);
  if (typeof resp === "string") return resp;
  if (resp && typeof resp.text === "function") return await resp.text();
  return String(resp);
}

function apiUrl(name, kind) {
  return (
    "https://perchance.org/api/" +
    (kind === "html" ? "getGeneratorHtml" : "downloadGenerator") +
    "?generatorName=" +
    encodeURIComponent(name) +
    (kind === "lists" ? "&listsOnly=true" : "")
  );
}

export async function loadScratch() {
  if (isActive()) return { name: store.scratch.name };
  const name = genName();
  let main = "";
  let html = "";
  try {
    const [m, h] = await Promise.all([fetchText(apiUrl(name, "lists")), fetchText(apiUrl(name, "html"))]);
    main = m;
    html = h;
  } catch (e) {
    throw new Error("Could not load this generator's source: " + (e && e.message ? e.message : e));
  }
  if (store.vfs.read(GEN_MAIN) === null) store.vfs.write(GEN_MAIN, main);
  else store.vfs.write(GEN_MAIN, main);
  store.vfs.write(GEN_HTML, html);
  if (store.vfs.read(GEN_README) === null) {
    store.vfs.write(
      GEN_README,
      "# Scratchpad — edit this generator\n\nThis folder contains the real source of your Perchance generator (" +
        name +
        "), loaded from perchance.org.\n\n- Edit `main.pjs` / `index.html` freely — everything is saved in your browser as you type.\n- When you're happy, use **Publish…** (the pencil button in the explorer header) to copy a file to the clipboard, then paste it into the Perchance editor and press Save. That's how your edits reach the live generator.\n- **Reload live** re-fetches the current published source from perchance.org, discarding your local changes.\n"
    );
  }
  store.scratch = {
    name,
    original: { [GEN_MAIN]: main, [GEN_HTML]: html },
    loadedAt: Date.now(),
    published: {},
  };
  store.saved[GEN_MAIN] = main;
  store.saved[GEN_HTML] = html;
  store.dirty.delete(GEN_MAIN);
  store.dirty.delete(GEN_HTML);
  schedulePersist();
  bus.emit("scratch", { type: "loaded" });
  return { name, main, html };
}

export async function reloadScratch() {
  if (!isActive()) return;
  const name = store.scratch.name;
  let main = "";
  let html = "";
  try {
    const [m, h] = await Promise.all([fetchText(apiUrl(name, "lists")), fetchText(apiUrl(name, "html"))]);
    main = m;
    html = h;
  } catch (e) {
    throw new Error("Could not reload live source: " + (e && e.message ? e.message : e));
  }
  store.vfs.write(GEN_MAIN, main);
  store.vfs.write(GEN_HTML, html);
  store.scratch.original = { [GEN_MAIN]: main, [GEN_HTML]: html };
  store.scratch.published = {};
  store.saved[GEN_MAIN] = main;
  store.saved[GEN_HTML] = html;
  store.dirty.delete(GEN_MAIN);
  store.dirty.delete(GEN_HTML);
  schedulePersist();
  bus.emit("scratch", { type: "reloaded" });
  return { main, html };
}

export function exitScratch() {
  if (!isActive()) return false;
  store.vfs.delete(GEN_DIR);
  for (let i = store.tabs.length - 1; i >= 0; i--) {
    if (isScratchPath(store.tabs[i])) store.tabs.splice(i, 1);
  }
  if (store.activePath && isScratchPath(store.activePath)) {
    store.activePath = store.tabs.length ? store.tabs[store.tabs.length - 1] : null;
  }
  for (const p of [...store.dirty]) if (isScratchPath(p)) store.dirty.delete(p);
  for (const p of Object.keys(store.saved)) if (isScratchPath(p)) delete store.saved[p];
  store.scratch = null;
  schedulePersist();
  bus.emit("scratch", { type: "exited" });
  return true;
}

export function markPublished(p) {
  if (!isActive() || !isScratchPath(p)) return;
  store.scratch.published[p] = Date.now();
  store.saved[p] = store.vfs.read(p) ?? "";
  store.dirty.delete(p);
  schedulePersist();
  bus.emit("scratch", { type: "published", path: p });
}

export function restoreScratchState() {
  if (store.scratch || store.vfs.read(GEN_MAIN) === null || store.vfs.read(GEN_HTML) === null) return;
  store.scratch = {
    name: genName(),
    original: { [GEN_MAIN]: store.vfs.read(GEN_MAIN), [GEN_HTML]: store.vfs.read(GEN_HTML) },
    loadedAt: Date.now(),
    published: {},
    restored: true,
  };
  bus.emit("scratch", { type: "restored" });
}
