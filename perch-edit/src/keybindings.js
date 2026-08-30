import { store, bus } from "./store.js";

export const KB_PATH = "keybindings.json";

let byKey = new Map();
let displayKeys = new Map();
let compileError = null;
let debounceTimer = null;

function parseJSONC(text) {
  let src = String(text || "");
  src = src.replace(/\/\*[\s\S]*?\*\//g, "");
  src = src
    .split("\n")
    .map((line) => {
      const i = line.indexOf("//");
      return i >= 0 ? line.slice(0, i) : line;
    })
    .join("\n");
  src = src.replace(/,\s*([}\]])/g, "$1");
  if (!src.trim()) return [];
  return JSON.parse(src);
}

export function normalizeKeyStr(s) {
  const parts = String(s)
    .trim()
    .toLowerCase()
    .split("+")
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length) return "";
  const hasCtrl = parts.some((p) => p === "ctrl" || p === "control" || p === "meta" || p === "cmd" || p === "super");
  const hasAlt = parts.some((p) => p === "alt" || p === "option");
  const hasShift = parts.some((p) => p === "shift");
  const key = parts.filter((p) => !["ctrl", "control", "meta", "cmd", "super", "alt", "option", "shift"].includes(p))[0];
  const out = [];
  if (hasCtrl) out.push("ctrl");
  if (hasAlt) out.push("alt");
  if (hasShift) out.push("shift");
  if (key) out.push(key);
  return out.join("+");
}

function defaultEntries() {
  const out = [];
  for (const c of store.cmds) {
    const keys = Array.isArray(c.keys) ? c.keys : c.keys ? [c.keys] : [];
    for (const k of keys) out.push({ key: k, command: c.id });
  }
  return out;
}

export function compile() {
  const keyMap = new Map();
  const idKeys = new Map();
  const add = (key, id) => {
    const nk = normalizeKeyStr(key);
    if (!nk || !id) return;
    keyMap.set(nk, id);
    if (!idKeys.has(id)) idKeys.set(id, []);
    if (!idKeys.get(id).includes(nk)) idKeys.get(id).push(nk);
  };
  for (const e of defaultEntries()) add(e.key, e.command);
  compileError = null;
  let list = [];
  try {
    const raw = store.vfs.read(KB_PATH);
    if (raw && raw.trim()) {
      list = parseJSONC(raw);
      if (!Array.isArray(list)) throw new Error("top-level value must be an array");
    }
  } catch (e) {
    compileError = e && e.message ? e.message : String(e);
    list = [];
  }
  for (const entry of list) {
    if (!entry || typeof entry !== "object" || !entry.key) continue;
    const nk = normalizeKeyStr(entry.key);
    if (!nk) continue;
    const cmd = entry.command;
    const removeFromIdKeys = (key) => {
      for (const arr of idKeys.values()) {
        const i = arr.indexOf(key);
        if (i >= 0) arr.splice(i, 1);
      }
    };
    const unbind = typeof cmd !== "string" || cmd === "" || cmd.startsWith("-");
    if (unbind) {
      keyMap.delete(nk);
      removeFromIdKeys(nk);
    } else {
      removeFromIdKeys(nk);
      keyMap.set(nk, cmd);
      if (!idKeys.has(cmd)) idKeys.set(cmd, []);
      if (!idKeys.get(cmd).includes(nk)) idKeys.get(cmd).push(nk);
    }
  }
  byKey = keyMap;
  const disp = new Map();
  for (const c of store.cmds) {
    const arr = idKeys.get(c.id);
    disp.set(c.id, arr ? arr.slice() : Array.isArray(c.keys) ? c.keys.slice() : c.keys ? [c.keys] : []);
  }
  displayKeys = disp;
}

export function getCommandForKey(keyStr) {
  return byKey.get(keyStr) || null;
}

export function effectiveKeys(id) {
  return displayKeys.get(id) || [];
}

export function prettyKey(k) {
  return k
    .split("+")
    .map((t) => (t.length <= 1 ? t.toUpperCase() : t[0].toUpperCase() + t.slice(1)))
    .join("+");
}

export function ensure() {
  if (store.vfs.read(KB_PATH) === null && !store.readOnly) {
    store.vfs.write(KB_PATH, defaultReference());
    store.saved[KB_PATH] = store.vfs.read(KB_PATH);
  }
}

export function openKeybindings() {
  ensure();
  return KB_PATH;
}

export function defaultReference() {
  const lines = [
    "// PerchEdit keybindings.json",
    "// Remap any command listed in the Command Palette (Ctrl+Shift+P).",
    "// Syntax per entry:  { \"key\": \"Ctrl+Shift+R\", \"command\": \"run.active\" }",
    "//   key      one or more modifiers (Ctrl, Alt, Shift) + a key, joined with '+'",
    "//   command  any command id from the palette",
    "// To UNBIND a default shortcut, prefix the command with '-' or omit it:",
    "//   { \"key\": \"Ctrl+B\", \"command\": \"-\" }   (removes the default Ctrl+B)",
    "// Save this file to apply. Invalid entries are ignored.",
    "[",
  ];
  const rows = [];
  for (const c of store.cmds) {
    const keys = Array.isArray(c.keys) ? c.keys : c.keys ? [c.keys] : [];
    for (const k of keys) {
      rows.push(`  // ${k.padEnd(16)} -> ${c.id}`);
    }
  }
  lines.push(...rows, "  // Example: { \"key\": \"Ctrl+Alt+O\", \"command\": \"view.splitRight\" }", "]");
  return lines.join("\n") + "\n";
}

export function init() {
  compile();
  bus.on("docchange", (path) => {
    if (path !== KB_PATH) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(compile, 350);
  });
}

export function getLastError() {
  return compileError;
}
