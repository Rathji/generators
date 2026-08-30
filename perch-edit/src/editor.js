import { EditorView, basicSetup } from "https://esm.sh/codemirror@6.0.1";
import { EditorState, StateEffect } from "https://esm.sh/@codemirror/state@6.7.1";
import { oneDark } from "https://esm.sh/@codemirror/theme-one-dark@6.1.2";
import { languages } from "https://esm.sh/@codemirror/language-data@6.5.1";
import { foldState, foldEffect, indentUnit } from "https://esm.sh/@codemirror/language@%5E6.0.0?target=es2022";
import { startCompletion } from "https://esm.sh/@codemirror/autocomplete@%5E6.0.0?target=es2022";
import { linter, lintGutter } from "https://esm.sh/@codemirror/lint@%5E6.0.0?target=es2022";
import { snippetExtension, initSnippets } from "./snippets.js";
import { store, bus, schedulePersist } from "./store.js";
import { initMinimap, setMinimapVisible } from "./minimap.js";
import * as lint from "./lint.js";
import { addSnapshot } from "./history.js";

globalThis.__store = store;

let view = null;
let rightView = null;
let rightPath = null;
let rightToken = 0;
let focusedView = null;
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
  view.dispatch({ effects: StateEffect.reconfigure.of(makeExts(path, lang, view, activePathGetter)) });
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

function activePathGetter() {
  return store.activePath;
}

function makeExts(path, lang, viewRef, pathGetter) {
  const exts = [basicSetup, snippetExtension(), chrome, indentUnit.of(" ".repeat(store.settings.tabSize || 2)), lintGutter(), linter((v) => lintDiags(v, pathGetter), { delay: 400 }), EditorView.editable.of(!store.readOnly)];
  if (store.settings.theme === "light") exts.push(lightTheme);
  else exts.push(oneDark);
  if (store.settings.wordWrap) exts.push(EditorView.lineWrapping);
  if (lang) exts.push(lang);
  exts.push(EditorView.updateListener.of((u) => onUpdate(u, viewRef, pathGetter)));
  return exts;
}

function lintDiags(v, pathGetter) {
  const path = pathGetter();
  if (!path || !lint.isJsPath(path)) {
    lint.setProblems(path, []);
    return [];
  }
  const doc = v.state.doc;
  const errs = lint.parseErrors(doc.toString());
  const diags = [];
  for (const e of errs) {
    const lineNo = Math.min(Math.max(1, e.line), doc.lines);
    const line = doc.line(lineNo);
    const from = Math.min(line.from + e.col, line.to);
    diags.push({
      from,
      to: Math.min(from + 1, line.to + 1),
      severity: "error",
      message: e.message,
    });
  }
  lint.setProblems(path, errs);
  return diags;
}

let typeTimer = null;

function onUpdate(update, viewRef, pathGetter) {
  const path = pathGetter();
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
        if (viewRef && !viewRef.dom.querySelector(".cm-tooltip-autocomplete")) startCompletion(viewRef);
      }, 120);
    }
  }
  if (update.selectionSet || update.docChanged) {
    if (viewRef === focusedView) {
      const { head } = update.state.selection.main;
      const line = update.state.doc.lineAt(head);
      bus.emit("cursor", { line: line.number, col: head - line.from + 1 });
    }
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

function createView(host, pathGetter) {
  let v = null;
  v = new EditorView({
    parent: host,
    state: EditorState.create({ doc: "", extensions: makeExts("", null, v, pathGetter) }),
  });
  v.dom.addEventListener("focusin", () => {
    focusedView = v;
  });
  return v;
}

export function initEditor(host) {
  initSnippets();
  view = createView(host, activePathGetter);
  focusedView = view;
  globalThis.__editorView = view;
  initMinimap(view);
  applyMinimap();
  bus.on("restore", (path, content) => {
    if (!path || content == null) return;
    if (store.activePath === path && view) setContent(content);
    else {
      store.vfs.write(path, content);
      store.dirty.add(path);
      bus.emit("docchange", path, true);
      schedulePersist();
    }
    bus.emit("restored", path);
  });
  return view;
}

export function applyMinimap() {
  setMinimapVisible(!!store.settings.minimap);
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
  view.setState(EditorState.create({ doc: content, extensions: makeExts(path, lang, view, activePathGetter) }));
  applyFoldsToView(view, path, content);
  if (view.scrollDOM) view.scrollDOM.scrollTop = 0;
  requestAnimationFrame(() => view && view.requestMeasure());
  bus.emit("cursor", { line: 1, col: 1 });
  bus.emit("open", path);
}

function applyFoldsToView(v, path, content) {
  const saved = store.folds && store.folds[path];
  if (saved && Array.isArray(saved) && saved.length >= 2) {
    const effects = [];
    const len = content.length;
    for (let i = 0; i + 1 < saved.length; i += 2) {
      const from = Math.max(0, Math.min(saved[i], len));
      const to = Math.max(from, Math.min(saved[i + 1], len));
      if (to > from) effects.push(foldEffect.of({ from, to }));
    }
    if (effects.length) v.dispatch({ effects });
  }
}

export function splitActive() {
  return !!rightView;
}

export function getSplitPath() {
  return rightPath;
}

function splitDom() {
  let pane = document.querySelector("#splitpane");
  const divider = document.querySelector("#splitdivider");
  if (!pane) {
    const wrap = document.querySelector("#editorsplit");
    divider = document.createElement("div");
    divider.id = "splitdivider";
    divider.hidden = true;
    divider.title = "Drag to resize";
    pane = document.createElement("div");
    pane.id = "splitpane";
    pane.hidden = true;
    pane.innerHTML =
      '<div class="split-head"><span class="split-title"></span><button class="split-close" title="Close split (Ctrl+Shift+\\)">\u00d7</button></div><div class="split-editor"></div>';
    wrap.appendChild(divider);
    wrap.appendChild(pane);
  }
  if (!pane.dataset.splitWired) {
    pane.dataset.splitWired = "1";
    const closeBtn = pane.querySelector(".split-close");
    if (closeBtn) closeBtn.addEventListener("click", closeSplit);
    if (divider) attachDividerDrag(divider);
  }
  applySplitWidth();
  return pane;
}

function attachDividerDrag(divider) {
  divider.addEventListener("mousedown", (e) => {
    e.preventDefault();
    divider.classList.add("dragging");
    const startX = e.clientX;
    const pane = document.querySelector("#splitpane");
    const startW = pane.getBoundingClientRect().width;
    const move = (ev) => {
      const total = document.querySelector("#editorsplit").clientWidth || 1;
      const w = startW - (ev.clientX - startX);
      const pct = Math.round(Math.max(18, Math.min(72, (w / total) * 100)));
      store.settings.splitWidth = pct;
      applySplitWidth();
    };
    const up = () => {
      divider.classList.remove("dragging");
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      schedulePersist();
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  });
}

function applySplitWidth() {
  const pane = document.querySelector("#splitpane");
  if (pane) pane.style.flexBasis = (store.settings.splitWidth || 45) + "%";
}

function updateSplitTitle() {
  const title = document.querySelector(".split-title");
  if (title) {
    if (rightPath) {
      const name = rightPath.split("/").pop();
      const ext = name.includes(".") ? name.split(".").pop().toLowerCase() : "";
      const colorMap = {
        js: "#f7df1e", mjs: "#f7df1e", cjs: "#f7df1e", ts: "#3178c6", jsx: "#f7df1e", tsx: "#3178c6",
        json: "#f0c674", html: "#e44d26", htm: "#e44d26", css: "#42a5f5", md: "#519aba", txt: "#9da5b4",
      };
      const color = colorMap[ext] || "#9da5b4";
      title.innerHTML = `<span class="ficon" style="color:${color}">${ICON_FILE}</span>${escHtml(name)}`;
    } else title.innerHTML = "";
  }
}

function escHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const ICON_FILE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5"/></svg>';

export function openToSide(path) {
  if (!path || store.vfs.read(path) === null) return false;
  const dom = splitDom();
  dom.hidden = false;
  const divider = document.querySelector("#splitdivider");
  divider.hidden = false;
  applySplitWidth();
  if (rightView && rightPath === path) {
    rightView.focus();
    bus.emit("split", path);
    return true;
  }
  const token = ++rightToken;
  rightPath = path;
  if (rightView) {
    rightView.destroy();
    rightView = null;
    globalThis.__rightEditorView = null;
  }
  if (!(path in store.saved)) store.saved[path] = store.vfs.read(path) || "";
  const content = store.vfs.read(path) || "";
  const host = dom.querySelector(".split-editor");
  const created = createView(host, () => rightPath);
  created.setState(EditorState.create({ doc: content, extensions: makeExts(path, null, created, () => rightPath) }));
  rightView = created;
  globalThis.__rightEditorView = created;
  store.split = { path };
  Promise.resolve()
    .then(async () => {
      let lang = null;
      try {
        const d = resolveLang(path);
        if (d && d.load) lang = (await d.load()) ?? null;
      } catch {
        lang = null;
      }
      if (token !== rightToken || !rightView || rightPath !== path) return;
      rightView.dispatch({ effects: StateEffect.reconfigure.of(makeExts(path, lang, rightView, () => rightPath)) });
    })
    .catch(() => {});
  applyFoldsToView(created, path, content);
  if (created.scrollDOM) created.scrollDOM.scrollTop = 0;
  updateSplitTitle();
  schedulePersist();
  bus.emit("split", path);
  return true;
}

export function closeSplit() {
  if (rightView) {
    rightView.destroy();
    rightView = null;
  }
  globalThis.__rightEditorView = null;
  rightPath = null;
  rightToken++;
  if (store.split) store.split = null;
  const pane = document.querySelector("#splitpane");
  const divider = document.querySelector("#splitdivider");
  if (pane) pane.hidden = true;
  if (divider) divider.hidden = true;
  if (focusedView === null && view) focusedView = view;
  schedulePersist();
  bus.emit("split", null);
}

export function rebuild() {
  if (!view) return;
  openToken++;
  if (store.activePath) {
    openFile(store.activePath);
  } else {
    view.setState(EditorState.create({ doc: "", extensions: makeExts("", null, view, activePathGetter) }));
  }
  if (rightView && rightPath) {
    const path = rightPath;
    const token = ++rightToken;
    const dom = document.querySelector("#splitpane");
    const host = dom ? dom.querySelector(".split-editor") : null;
    if (!host) return;
    rightView.destroy();
    rightView = null;
    if (!(path in store.saved)) store.saved[path] = store.vfs.read(path) || "";
    const content = store.vfs.read(path) || "";
    const created = createView(host, () => rightPath);
    created.setState(EditorState.create({ doc: content, extensions: makeExts(path, null, created, () => rightPath) }));
    rightView = created;
    globalThis.__rightEditorView = created;
    Promise.resolve()
      .then(async () => {
        let lang = null;
        try {
          const d = resolveLang(path);
          if (d && d.load) lang = (await d.load()) ?? null;
        } catch {
          lang = null;
        }
        if (token !== rightToken || !rightView || rightPath !== path) return;
        rightView.dispatch({ effects: StateEffect.reconfigure.of(makeExts(path, lang, rightView, () => rightPath)) });
      })
      .catch(() => {});
    applyFoldsToView(created, path, content);
    updateSplitTitle();
  }
}

export function saveCurrent() {
  if (store.readOnly) return false;
  if (!store.activePath || !view) return false;
  const doc = view.state.doc.toString();
  store.vfs.write(store.activePath, doc);
  store.saved[store.activePath] = doc;
  store.dirty.delete(store.activePath);
  addSnapshot(store.activePath, doc);
  schedulePersist();
  bus.emit("saved", store.activePath);
  return true;
}

export function saveAll() {
  if (store.readOnly) return;
  const savedPaths = new Set();
  if (store.activePath && view) {
    const doc = view.state.doc.toString();
    store.vfs.write(store.activePath, doc);
    store.saved[store.activePath] = doc;
    store.dirty.delete(store.activePath);
    savedPaths.add(store.activePath);
  }
  for (const p of [...store.dirty]) {
    const doc = store.vfs.read(p) || "";
    store.saved[p] = doc;
    store.dirty.delete(p);
    savedPaths.add(p);
  }
  for (const p of savedPaths) addSnapshot(p, store.saved[p]);
  schedulePersist();
  bus.emit("saved", store.activePath);
}

export function setContent(content) {
  if (!view || !store.activePath) return;
  const to = view.state.doc.length;
  view.dispatch({ changes: { from: 0, to, insert: String(content ?? "") } });
  view.focus();
}

export function getSelection() {
  if (!view) return null;
  const sel = view.state.selection.main;
  if (sel.empty) return null;
  return view.state.sliceDoc(sel.from, sel.to);
}

export function goTo(offset) {
  if (!view || !store.activePath) return;
  const len = view.state.doc.length;
  const from = Math.max(0, Math.min(offset ?? 0, len));
  view.dispatch({ selection: { anchor: from }, effects: EditorView.scrollIntoView(from) });
  view.focus();
}

export function goToLine(n, col) {
  if (!view) return;
  const max = view.state.doc.lines;
  const num = Math.max(1, Math.min(Number(n) || 1, max));
  const l = view.state.doc.line(num);
  const offset = col ? Math.max(0, Math.min(Math.max(0, Math.round(col) - 1), l.length)) : 0;
  goTo(l.from + offset);
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
