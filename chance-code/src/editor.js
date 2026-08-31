import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, dropCursor } from "https://esm.sh/@codemirror/view@6";
import { EditorState, Compartment } from "https://esm.sh/@codemirror/state@6";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "https://esm.sh/@codemirror/commands@6";
import { javascript } from "https://esm.sh/@codemirror/lang-javascript@6";
import { html } from "https://esm.sh/@codemirror/lang-html@6";
import { css } from "https://esm.sh/@codemirror/lang-css@6";
import { json } from "https://esm.sh/@codemirror/lang-json@6";
import { markdown } from "https://esm.sh/@codemirror/lang-markdown@6";
import { oneDark } from "https://esm.sh/@codemirror/theme-one-dark@6";
import { searchKeymap, highlightSelectionMatches, openSearchPanel } from "https://esm.sh/@codemirror/search@6";
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from "https://esm.sh/@codemirror/autocomplete@6";
import { bracketMatching, foldGutter, foldKeymap, HighlightStyle, syntaxHighlighting } from "https://esm.sh/@codemirror/language@6";
import { tags as t } from "https://esm.sh/@lezer/highlight@1";

export const FILE_ICONS = {
  ".pjs": "⬡", ".js": "🟨", ".mjs": "🟨", ".html": "🟧", ".css": "🟦",
  ".json": "🟩", ".md": "📄", ".txt": "📄", ".pjsn": "⬡"
};

export function langForPath(path) {
  const ext = "." + (path.split(".").pop() || "");
  if (ext === ".pjs" || ext === ".js" || ext === ".mjs" || ext === ".ts") return "javascript";
  if (ext === ".html") return "html";
  if (ext === ".css") return "css";
  if (ext === ".json") return "json";
  if (ext === ".md" || ext === ".markdown") return "markdown";
  return "plain";
}

const LANG_EXTENSIONS = {
  javascript: javascript(),
  html: html(),
  css: css(),
  json: json(),
  markdown: markdown(),
  plain: []
};

const lightSyntax = HighlightStyle.define([
  { tag: [t.comment, t.lineComment, t.blockComment], color: "#6e7781", fontStyle: "italic" },
  { tag: [t.keyword, t.modifier, t.controlKeyword], color: "#cf222e" },
  { tag: [t.string, t.special(t.string)], color: "#0a3069" },
  { tag: [t.number, t.integer, t.float, t.bool, t.null], color: "#0550ae" },
  { tag: [t.operator, t.operatorKeyword], color: "#cf222e" },
  { tag: [t.propertyName, t.attributeName], color: "#0550ae" },
  { tag: [t.tagName], color: "#116329" },
  { tag: [t.className, t.typeName, t.namespace], color: "#953800" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "#8250df" },
  { tag: [t.definition(t.variableName)], color: "#24292f" },
  { tag: [t.punctuation, t.bracket], color: "#57606a" },
  { tag: [t.heading], color: "#0550ae", fontWeight: "bold" },
  { tag: [t.strong], fontWeight: "bold" },
  { tag: [t.emphasis], fontStyle: "italic" },
  { tag: [t.link, t.url], color: "#0969da", textDecoration: "underline" },
  { tag: [t.meta], color: "#57606a" },
  { tag: [t.quote], color: "#57606a", fontStyle: "italic" },
  { tag: [t.invalid], color: "#cf222e" }
]);

const lightTheme = EditorView.theme({
  "&": { backgroundColor: "#ffffff", color: "#24292f" },
  ".cm-content": { caretColor: "#24292f" },
  ".cm-cursor": { borderLeftColor: "#24292f" },
  ".cm-gutters": { backgroundColor: "#f6f8fa", color: "#57606a", border: "none" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": { background: "#c8d3f5" },
  ".cm-tooltip": { backgroundColor: "#ffffff", border: "1px solid #d0d7de", color: "#24292f" },
  ".cm-tooltip-autocomplete ul li[aria-selected]": { backgroundColor: "#ddf4ff" },
  ".cm-searchMatch": { background: "rgba(187, 128, 9, .35)" }
}, { dark: false });

const lightExt = [lightTheme, syntaxHighlighting(lightSyntax)];
const editorFontTheme = EditorView.theme({
  ".cm-scroller": { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', lineHeight: "1.6" }
});

export function createEditor(hostEl, { onChange, onCursor, onSave } = {}) {
  const langComp = new Compartment();
  const themeComp = new Compartment();
  let suppressChange = false;
  let themeLight = false;

  let view = null;

  function buildState(doc, lang) {
    return EditorState.create({
      doc,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        drawSelection(),
        dropCursor(),
        foldGutter(),
        history(),
        bracketMatching(),
        closeBrackets(),
        autocompletion(),
        highlightSelectionMatches(),
        editorFontTheme,
        themeComp.of(themeLight ? lightExt : oneDark),
        langComp.of(LANG_EXTENSIONS[lang] || []),
        EditorView.updateListener.of((u) => {
          if (u.docChanged && onChange && !suppressChange) onChange(view);
          if (u.selectionSet || u.docChanged) {
            if (onCursor) {
              const head = u.state.selection.main.head;
              const line = u.state.doc.lineAt(head);
              onCursor({ line: line.number, col: head - line.from });
            }
          }
        }),
        keymap.of([
          { key: "Mod-f", run: openSearchPanel, preventDefault: true },
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...foldKeymap,
          ...completionKeymap,
          indentWithTab
        ])
      ]
    });
  }

  function open(path, content, lang) {
    if (view) {
      suppressChange = true;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: content }, selection: { anchor: 0 } });
      suppressChange = false;
      setLang(lang);
      return;
    }
    view = new EditorView({ state: buildState(content, lang), parent: hostEl });
  }

  function setLang(lang) {
    if (!view) return;
    view.dispatch({ effects: langComp.reconfigure(LANG_EXTENSIONS[lang] || []) });
  }

  function setTheme(light) {
    themeLight = light;
    if (!view) return;
    view.dispatch({ effects: themeComp.reconfigure(light ? lightExt : oneDark) });
  }

  function getValue() { return view ? view.state.doc.toString() : ""; }
  function setValue(text) {
    if (!view) return;
    suppressChange = true;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
    suppressChange = false;
  }
  function focus() { if (view) view.focus(); }
  function getCursor() {
    if (!view) return null;
    const head = view.state.selection.main.head;
    const line = view.state.doc.lineAt(head);
    return { line: line.number, col: head - line.from };
  }
  function scrollTo(line) {
    if (!view) return;
    const l = Math.max(0, line - 1);
    view.dispatch({ selection: { anchor: view.state.doc.line(l + 1).from }, scrollIntoView: true });
    view.focus();
  }
  function jumpTo(line, col) {
    if (!view) return;
    const l = Math.max(0, (line || 1) - 1);
    const from = view.state.doc.line(l + 1).from + (col || 0);
    view.dispatch({ selection: { anchor: from }, scrollIntoView: true });
    view.focus();
  }

  return { open, setLang, setTheme, getValue, setValue, focus, getCursor, scrollTo, jumpTo, getEditor: () => view };
}
