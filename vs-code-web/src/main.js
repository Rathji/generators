import { store, bus, registerCmd, loadPersisted } from "./store.js";
import * as editor from "./editor.js";
import * as ui from "./ui.js";
import * as preview from "./preview.js";
import { SNIPPETS_PATH, openSnippetsFile } from "./snippets.js";

const $ = (sel) => document.querySelector(sel);

function seedDefaults() {
  if (store.vfs.walkFiles().length > 0) return;
  const files = {
    "README.md": `# Welcome to your browser-based code editor

This is a full **VS Code-style editor** running right inside your Perchance generator.

## Try it
- \`Ctrl+Shift+P\` \u2014 Command Palette
- \`Ctrl+P\` \u2014 Quick Open (switch files)
- \`Ctrl+F5\` \u2014 Run the active JavaScript file
- \`Ctrl+\`\` \u2014 Toggle the terminal
- \`Ctrl+B\` \u2014 Toggle the sidebar

Open \`src/main.js\` and press **Ctrl+F5** to run some code.

Everything you type is saved automatically in your browser \u2014 reload the page and it's all still here.
`,
    "src/main.js": `// Press Ctrl+F5 (or the \u25b6 button) to run this file.
// Output appears in the OUTPUT panel at the bottom.

const adventurers = ["Kira", "Brin", "Moss", "Taro"];

function roll(dice) {
  return 1 + Math.floor(Math.random() * dice);
}

console.log("Welcome, adventurer!");
console.log("Your party:", adventurers.join(", "));

for (const hero of adventurers) {
  const hp = 20 + roll(10);
  const gold = 5 * roll(6);
  console.log(\`\${hero} \u2014 hp \${hp}, gold \${gold}\`);
}

console.log("10 + 5 \u00d7 3 =", 10 + 5 * 3);

// Async code works too!
setTimeout(() => console.log("...and the adventure continues."), 500);
`,
    "src/style.css": `:root {
  --accent: #3794ff;
}

body {
  font-family: system-ui;
  background: #0f1115;
  color: #e6edf3;
}
`,
    "index.html": `<!doctype html>
<html>
<head>
  <title>Sample</title>
  <link rel="stylesheet" href="src/style.css">
</head>
<body>
  <h1>Hello, world</h1>
  <script src="app.js"><\/script>
</body>
</html>
`,
    "notes.txt": `Keyboard shortcuts
\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
Ctrl+Shift+P   Command palette
Ctrl+P         Quick open file
Ctrl+S         Save file
Ctrl+F5        Run active JS file
Ctrl+\`         Toggle terminal
Ctrl+B         Toggle sidebar
Ctrl+Shift+F   Search files
Ctrl+,         Settings
`,
  };
  for (const [p, c] of Object.entries(files)) store.vfs.write(p, c);
  store.tabs = ["README.md"];
  store.activePath = "README.md";
  store.expanded = new Set(["src"]);
}

const WORKER_SRC = `
self.onmessage = function (e) {
  var code = e.data;
  var logs = [];
  function fmt(x) {
    if (typeof x === "string") return x;
    if (x instanceof Error) return x.stack || String(x);
    try {
      var s = JSON.stringify(x, function (k, v) { return typeof v === "bigint" ? v.toString() : v; }, 2);
      return s === undefined ? String(x) : s;
    } catch (err) { return String(x); }
  }
  function mk(type) { return function () { logs.push({ type: type, text: Array.prototype.map.call(arguments, fmt).join(" ") }); }; }
  var cons = {
    log: mk("log"), info: mk("info"), warn: mk("warn"), error: mk("error"), debug: mk("log"),
    clear: function () { logs.push({ type: "clear", text: "" }); }
  };
  function finish(err) {
    if (err) logs.push({ type: "error", text: (err && err.stack) || String(err) });
    self.postMessage({ done: true, logs: logs });
  }
  try {
    var fn = new Function("console", "'use strict'; return (async () => { " + code + " })();");
    Promise.resolve(fn(cons)).then(function (r) {
      if (r !== undefined) logs.push({ type: "log", text: "< " + fmt(r) });
      finish();
    }, finish);
  } catch (err) {
    finish(err);
  }
};
`;

function runCode(code, onLog, onDone) {
  let worker;
  try {
    const blob = new Blob([WORKER_SRC], { type: "text/javascript" });
    worker = new Worker(URL.createObjectURL(blob));
  } catch (e) {
    onLog({ type: "error", text: "Worker unavailable: " + e.message });
    onDone();
    return;
  }
  const timer = setTimeout(() => {
    try { worker.terminate(); } catch {}
    onLog({ type: "error", text: "Script timed out after 20s (terminated)." });
    onDone();
  }, 20000);
  worker.onmessage = (e) => {
    const m = e.data || {};
    if (m.logs) for (const l of m.logs) onLog(l);
    if (m.done) {
      clearTimeout(timer);
      onDone();
      try { worker.terminate(); } catch {}
    }
  };
  worker.onerror = (e) => {
    clearTimeout(timer);
    onLog({ type: "error", text: "Worker error: " + e.message });
    onDone();
  };
  worker.postMessage(code);
}

export function runFile(path) {
  if (!path) {
    ui.toast("Nothing to run \u2014 open a .js file first");
    return;
  }
  if (!/\.(js|mjs|cjs)$/i.test(path)) {
    ui.toast("Only JavaScript files can be run: " + path);
    return;
  }
  ui.showPanel("output");
  ui.setPanelTab("output");
  ui.outputClear(path);
  ui.outputLine({ type: "info", text: "\u25b6 Running " + path + " \u2026" });
  ui.outputStatus("running");
  const code = store.vfs.read(path) || "";
  runCode(
    code,
    (l) => ui.outputLine(l),
    () => {
      ui.outputLine({ type: "info", text: "\u2014 done \u2014" });
      ui.outputStatus("");
    }
  );
}

bus.on("runfile", (path) => runFile(path));

function runActive() {
  runFile(store.activePath);
}

function keyStr(e) {
  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push("ctrl");
  if (e.altKey) parts.push("alt");
  if (e.shiftKey) parts.push("shift");
  if (e.key) parts.push(e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase());
  return parts.join("+");
}

function bindKeys() {
  const map = {
    "ctrl+shift+p": () => ui.openPalette("cmd"),
    "f1": () => ui.openPalette("cmd"),
    "ctrl+p": (e) => { e.preventDefault(); ui.openPalette("file"); },
    "ctrl+s": (e) => { e.preventDefault(); editor.saveCurrent(); ui.toast("Saved"); },
    "ctrl+shift+s": (e) => { e.preventDefault(); editor.saveAll(); ui.toast("Saved all"); },
    "ctrl+`": (e) => { e.preventDefault(); ui.togglePanel(); },
    "ctrl+b": (e) => { e.preventDefault(); ui.toggleSidebar(); },
    "ctrl+shift+e": (e) => { e.preventDefault(); ui.setView("explorer"); ui.showSidebar(true); },
    "ctrl+shift+f": (e) => { e.preventDefault(); ui.setView("search"); ui.showSidebar(true); ui.focusSearch(); },
    "ctrl+f5": (e) => { e.preventDefault(); runActive(); },
    "ctrl+w": (e) => { e.preventDefault(); ui.closeTab(store.activePath); },
    "ctrl+,": (e) => { e.preventDefault(); ui.openSettings(); },
    "ctrl+=": (e) => { e.preventDefault(); ui.changeFont(1); },
    "ctrl+shift+=": (e) => { e.preventDefault(); ui.changeFont(1); },
    "ctrl+-": (e) => { e.preventDefault(); ui.changeFont(-1); },
    "ctrl+tab": (e) => { e.preventDefault(); ui.nextTab(); },
  };
  document.addEventListener("keydown", (e) => {
    const t = e.target;
    if (t && typeof t.closest === "function" && t.closest("input, textarea, select")) return;
    const fn = map[keyStr(e)];
    if (fn) fn(e);
  });
}

function registerCommands() {
  registerCmd("file.new", { title: "File: New File", run: () => ui.newFilePrompt() });
  registerCmd("file.newFolder", { title: "File: New Folder", run: () => ui.newFolderPrompt() });
  registerCmd("file.open", { title: "File: Open File", keys: "Ctrl+P", run: () => ui.openPalette("file") });
  registerCmd("file.save", { title: "File: Save", keys: "Ctrl+S", run: () => { editor.saveCurrent(); ui.toast("Saved"); } });
  registerCmd("file.saveAll", { title: "File: Save All", keys: "Ctrl+Shift+S", run: () => { editor.saveAll(); ui.toast("Saved all"); } });
  registerCmd("file.changeLanguage", { title: "File: Change Language Mode", run: () => ui.openPalette("lang") });
  registerCmd("snippets.open", { title: "Snippets: Open Snippets File", run: () => { ui.openFile(openSnippetsFile()); } });
  registerCmd("file.close", { title: "File: Close Editor", keys: "Ctrl+W", run: () => ui.closeTab(store.activePath) });
  registerCmd("file.closeAll", { title: "File: Close All Editors", run: () => ui.closeAllTabs() });
  registerCmd("view.explorer", { title: "View: Show Explorer", keys: "Ctrl+Shift+E", run: () => { ui.setView("explorer"); ui.showSidebar(true); } });
  registerCmd("view.search", { title: "View: Show Search", keys: "Ctrl+Shift+F", run: () => { ui.setView("search"); ui.showSidebar(true); ui.focusSearch(); } });
  registerCmd("view.scm", { title: "View: Show Source Control", run: () => { ui.setView("scm"); ui.showSidebar(true); } });
  registerCmd("view.run", { title: "View: Show Run and Debug", run: () => { ui.setView("run"); ui.showSidebar(true); } });
  registerCmd("view.extensions", { title: "View: Show Extensions", run: () => { ui.setView("extensions"); ui.showSidebar(true); } });
  registerCmd("view.sidebar", { title: "View: Toggle Sidebar", keys: "Ctrl+B", run: () => ui.toggleSidebar() });
  registerCmd("view.panel", { title: "View: Toggle Panel", keys: "Ctrl+`", run: () => ui.togglePanel() });
  registerCmd("view.wordWrap", { title: "View: Toggle Word Wrap", run: () => ui.toggleWordWrap() });
  registerCmd("view.preview", { title: "View: Toggle Live Preview", keys: "Ctrl+Shift+V", run: () => preview.togglePreview() });
  registerCmd("terminal.toggle", { title: "Terminal: Toggle Terminal", keys: "Ctrl+`", run: () => { ui.setPanelTab("terminal"); ui.togglePanel(); ui.focusTerminal(); } });
  registerCmd("run.active", { title: "Run: Run Active JavaScript File", keys: "Ctrl+F5", run: () => runActive() });
  registerCmd("scm.commit", { title: "Source Control: Commit Changes", run: () => bus.emit("commit") });
  registerCmd("settings.open", { title: "Settings: Open Settings", keys: "Ctrl+,", run: () => ui.openSettings() });
  registerCmd("settings.zoomIn", { title: "Settings: Increase Font Size", keys: "Ctrl+=", run: () => ui.changeFont(1) });
  registerCmd("settings.zoomOut", { title: "Settings: Decrease Font Size", keys: "Ctrl+-", run: () => ui.changeFont(-1) });
  registerCmd("help.welcome", { title: "Help: Show Welcome", run: () => ui.showWelcomeScreen() });
}

async function boot() {
  seedDefaults();
  await loadPersisted();
  ui.init();
  editor.initEditor($("#editorhost"));
  preview.initPreview();
  registerCommands();
  bindKeys();
  ui.showSidebar(true);
  ui.applySettings();
  if (store.activePath) ui.openFile(store.activePath);
  else ui.showWelcomeScreen();
}

boot();
