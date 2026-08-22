import { EditorView, basicSetup } from "https://esm.sh/codemirror@6.0.1";
import { EditorState, StateEffect } from "https://esm.sh/@codemirror/state@6.7.1";
import { oneDark } from "https://esm.sh/@codemirror/theme-one-dark@6.1.2";
import { languages } from "https://esm.sh/@codemirror/language-data@6.5.1";
import { foldState, foldEffect } from "https://esm.sh/@codemirror/language@%5E6.0.0?target=es2022";
import { startCompletion } from "https://esm.sh/@codemirror/autocomplete@%5E6.0.0?target=es2022";
import { snippetExtension, initSnippets } from "./snippets.js";
import { store, bus, schedulePersist } from "./store.js";

globalThis.__store = store;

let view = null;
let openToken = 0;

function matchLang(path) {
  const name = String(path).split("/").pop().toLowerCase();
  const ext = name.includes(".") ? name.split(".").pop() : "";
  if (!ext) return null;
  return (
    languages.find((l) => {
      const filenames = Array.isArray(l.filename) ? l.filename : [l.filename];
      return (
        (l.extensions || []).some((e) => e.toLowerCase() === ext) ||
        (l.alias || []).some((a) => a.toLowerCase() === ext) ||
        filenames.some((f) => f && name.endsWith(String(f).toLowerCase()))
      );
    }) || null
  );
}

function overrideLang(path) {
  const name = store.langOverride && store.langOverride[path];
  if (!name || name === "auto") return null;
  if (name === "Plain Text") return { name: "Plain Text" };
  return languages.find((l) => l.name.toLowerCase() === name.toLowerCase()) || null;
}

function resolveLang(path) {
  return overrideLang(path) || matchLang(path) || null;
}

export function getLanguageOverride(path) {
  return (store.langOverride && store.langOverride[path]) || null;
}

export function languageList() {
  const seen = new Set();
  const out = [];
  for (const l of languages) {
    if (!seen.has(l.name)) {
      seen.add(l.name);
      out.push(l.name);
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
}

export function langNameFor(path) {
  const d = resolveLang(path);
  return d ? d.name : "Plain Text";
}

export function setLanguageOverride(path, name) {
  if (!path) return;
  if (store.langOverride) delete store.langOverride[path];
  if (name && name !== "auto") store.langOverride[path] = name;
  schedulePersist();
  if (path === store.activePath) applyLangToView();
}

let langToken = 0;

async function applyLangToView() {
  const token = ++langToken;
  const path = store.activePath;
  let lang = null;
  try {
    const d = resolveLang(path);
    if (d && d.load) lang = (await d.load()) ?? null;
  } catch {
    lang = null;
  }
  if (!view || store.activePath !== path || token !== langToken) return;
  view.dispatch({ effects: StateEffect.reconfigure.of(makeExts(path, lang)) });
  bus.emit("open", path);
}

const chrome = EditorView.theme({
  "&": { height: "100%", fontSize: "var(--edfont)" },
  ".cm-scroller": { fontFamily: "var(--mono)", overflow: "auto" },
  "&.cm-focused": { outline: "none" },
  ".cm-gutters": { backgroundColor: "var(--bg)", color: "var(--fg-dim)", border: "none" },
  ".cm-activeLineGutter": { color: "var(--fg2)" },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 8px 0 4px" },
});

const lightTheme = EditorView.theme({
  "&": { backgroundColor: "#ffffff", color: "#24292f" },
  ".cm-activeLine": { backgroundColor: "rgba(0,0,0,.03)" },
});

function makeExts(path, lang) {
  const exts = [basicSetup, snippetExtension(), chrome];
  if (store.settings.theme === "dark") exts.push(oneDark);
  else exts.push(lightTheme);
  if (store.settings.wordWrap) exts.push(EditorView.lineWrapping);
  if (lang) exts.push(lang);
  exts.push(EditorView.updateListener.of(onUpdate));
  return exts;
}

let typeTimer = null;

function onUpdate(update) {
  const path = store.activePath;
  if (!path) return;
  if (update.docChanged) {
    const doc = update.state.doc.toString();
    store.vfs.write(path, doc);
    const dirty = doc !== (store.saved[path] ?? "");
    if (dirty) store.dirty.add(path);
    else store.dirty.delete(path);
    schedulePersist();
    bus.emit("docchange", path, dirty);
    if (update.transactions.some((tr) => tr.isUserEvent("input.type"))) {
      clearTimeout(typeTimer);
      typeTimer = setTimeout(() => {
        if (view && !view.dom.querySelector(".cm-tooltip-autocomplete")) startCompletion(view);
      }, 120);
    }
  }
  if (update.selectionSet || update.docChanged) {
    const { head } = update.state.selection.main;
    const line = update.state.doc.lineAt(head);
    bus.emit("cursor", { line: line.number, col: head - line.from + 1 });
  }
  const fldA = update.startState.field(foldState, false) || null;
  const fldB = update.state.field(foldState, false) || null;
  if (fldA !== fldB) {
    const arrA = [];
    if (fldA) fldA.between(0, update.startState.doc.length, (a, b) => arrA.push(a, b));
    const arrB = [];
    if (fldB) fldB.between(0, update.state.doc.length, (a, b) => arrB.push(a, b));
    if (JSON.stringify(arrA) !== JSON.stringify(arrB)) {
      if (arrB.length) store.folds[path] = arrB;
      else delete store.folds[path];
      schedulePersist();
    }
  }
}

export function initEditor(host) {
  initSnippets();
  view = new EditorView({
    parent: host,
    state: EditorState.create({ doc: "", extensions: makeExts("", null) }),
  });
  globalThis.__editorView = view;
  return view;
}

export async function openFile(path) {
  const token = ++openToken;
  store.activePath = path;
  if (!(path in store.saved)) store.saved[path] = store.vfs.read(path) || "";
  let lang = null;
  try {
    const d = resolveLang(path);
    if (d && d.load) lang = (await d.load()) ?? null;
  } catch {
    lang = null;
  }
  if (token !== openToken || !view) return;
  const content = store.vfs.read(path) || "";
  const dirty = content !== (store.saved[path] ?? "");
  if (dirty) store.dirty.add(path);
  else store.dirty.delete(path);
  view.setState(EditorState.create({ doc: content, extensions: makeExts(path, lang) }));
  const saved = store.folds && store.folds[path];
  if (saved && Array.isArray(saved) && saved.length >= 2) {
    const effects = [];
    const len = content.length;
    for (let i = 0; i + 1 < saved.length; i += 2) {
      const from = Math.max(0, Math.min(saved[i], len));
      const to = Math.max(from, Math.min(saved[i + 1], len));
      if (to > from) effects.push(foldEffect.of({ from, to }));
    }
    if (effects.length) view.dispatch({ effects });
  }
  if (view.scrollDOM) view.scrollDOM.scrollTop = 0;
  requestAnimationFrame(() => view && view.requestMeasure());
  bus.emit("cursor", { line: 1, col: 1 });
  bus.emit("open", path);
}

export function rebuild() {
  if (!view) return;
  openToken++;
  if (store.activePath) {
    openFile(store.activePath);
  } else {
    view.setState(EditorState.create({ doc: "", extensions: makeExts("", null) }));
  }
}

export function saveCurrent() {
  if (!store.activePath || !view) return false;
  const doc = view.state.doc.toString();
  store.vfs.write(store.activePath, doc);
  store.saved[store.activePath] = doc;
  store.dirty.delete(store.activePath);
  schedulePersist();
  bus.emit("saved", store.activePath);
  return true;
}

export function saveAll() {
  if (store.activePath && view) {
    store.saved[store.activePath] = view.state.doc.toString();
  }
  for (const p of [...store.dirty]) {
    store.saved[p] = store.vfs.read(p) || "";
    store.dirty.delete(p);
  }
  schedulePersist();
  bus.emit("saved", store.activePath);
}

export function goTo(offset) {
  if (!view || !store.activePath) return;
  const len = view.state.doc.length;
  const from = Math.max(0, Math.min(offset ?? 0, len));
  view.dispatch({ selection: { anchor: from }, effects: EditorView.scrollIntoView(from) });
  view.focus();
}

export function goToLine(n) {
  if (!view) return;
  const max = view.state.doc.lines;
  const num = Math.max(1, Math.min(Number(n) || 1, max));
  const l = view.state.doc.line(num);
  goTo(l.from);
}

export function selectRange(from, to) {
  if (!view) return;
  view.dispatch({ selection: { anchor: from, head: to }, effects: EditorView.scrollIntoView(from) });
  view.focus();
}

export function focus() {
  if (view) view.focus();
}

export function getDoc() {
  return view ? view.state.doc.toString() : "";
}
