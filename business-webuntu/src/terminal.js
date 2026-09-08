// Webuntu OS — Terminal (Phase 6, Task 31; power-up in Task 65)
// The "Perch shell": a windowed terminal that runs commands against the real
// virtual filesystem (window.FS + window.FSPath). Commands: ls, cd, pwd, cat,
// mkdir, rm, touch, echo (with > / >> redirect and $VAR expansion), cp, mv,
// head, tail, grep, wc, tree, clear, help, history (persisted across sessions
// via webuntu.term.history, -c to clear), man, neofetch, open <name> (launch
// apps / shortcuts / folders), plus whoami / hostname / date / uname / version
// / uptime / free / env / sudo (gag) / exit / quit / cls.
// History via ↑/↓, Tab autocompletes commands and (path-aware) file/dir names,
// Ctrl+L clears. Keyboard input only works while the terminal window is
// focused (a shared document listener routes to the focused terminal).

(function () {
  "use strict";

  const HOME = "/home/user";

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function distro(field) {
    try {
      if (root && root.distro && root.distro[field]) return root.distro[field].evaluateItem;
    } catch (e) {}
    return "";
  }

  // ---------- shared helpers (Task 65) ----------
  // Fictional shell environment for $VAR expansion and `env`.
  function shellEnv(cwd) {
    return {
      HOME: "/home/user",
      USER: "user",
      PATH: "/usr/local/bin:/usr/bin:/bin:/usr/games",
      SHELL: "/bin/perch",
      TERM: "xterm-256color",
      PWD: cwd,
      OLDPWD: "/home/user",
    };
  }
  function expandVars(s, cwd) {
    const env = shellEnv(cwd);
    return String(s).replace(/\$(\w+)|\$\{(\w+)\}/g, (m, a, b) => {
      const k = a || b;
      return Object.prototype.hasOwnProperty.call(env, k) ? env[k] : "";
    });
  }
  function humanSize(bytes) {
    const b = Math.max(0, Number(bytes) || 0);
    if (b < 1024) return b + " B";
    if (b < 1048576) return (b / 1024).toFixed(1) + " KiB";
    return (b / 1048576).toFixed(1) + " MiB";
  }
  function fmtUptime() {
    const s = Math.max(0, Math.floor(performance.now() / 1000));
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    if (d) return d + "d " + h + "h " + m + "m";
    if (h) return h + "h " + m + "m";
    return m + "m " + (s % 60) + "s";
  }
  // Deep-clone a FS node into a create()-able spec (used by cp / mv).
  function cloneSpec(node) {
    const s = {
      name: node.name,
      type: node.type,
      icon: node.icon,
      meta: node.meta ? JSON.parse(JSON.stringify(node.meta)) : {},
    };
    if (node.type === "folder") s.children = (node.children || []).map(cloneSpec);
    return s;
  }
  // Manual pages for `man <command>`.
  const MAN = {
    ls: "ls [path] [-l] [-h] — list a directory. Folders end with /, shortcuts with *. -l shows kind, size, modified time; -h prints sizes in human units.",
    cd: "cd [path] — change directory. 'cd' or 'cd ~' returns home; '..', '.', and absolute paths work.",
    pwd: "pwd — print the working directory as an absolute path.",
    cat: "cat <path> — print a file's contents to the terminal.",
    mkdir: "mkdir <path> — create a folder (and any missing parents' siblings are NOT auto-created).",
    rm: "rm <path> [-r|-rf|-f] — remove a file or folder. Deletion is permanent; the OS refuses to remove '/' or your home directory.",
    cp: "cp <src> <dst> — copy a file or folder. If dst is an existing folder the item lands inside it with its original name.",
    mv: "mv <src> <dst> — move a file or folder (renames when both are in the same directory).",
    touch: "touch <path> — create an empty file (or leave an existing one alone).",
    echo: "echo <text> [> file | >> file] — print text. > writes a file (creating it), >> appends. $HOME/$USER/$PATH/$PWD/$SHELL/$TERM expand.",
    head: "head [-n N] <file> — print the first N lines (default 10).",
    tail: "tail [-n N] <file> — print the last N lines (default 10).",
    grep: "grep [-i] <pattern> <file> — print lines matching a regular expression. -i ignores case.",
    wc: "wc <file> — count lines, words and characters.",
    tree: "tree [path] — draw the folder tree starting at path (default '.').",
    open: "open <name> — launch an app (e.g. open terminal), a shortcut, or a folder relative to the current directory.",
    upload: "upload <path> — host a file on Perchance's storage via upload-plugin and copy its share link to the clipboard (Super+V to browse history).",
    ai: "ai \"<prompt>\" — ask the AI anything. The answer streams into the terminal as it's generated.",
    gh: "gh search <query> — search GitHub repositories, sorted by stars, and print the top results inline.",
    img: "img \"<prompt>\" — generate an image with AI and save it into /home/user/Pictures.",
    neofetch: "neofetch — a colourful system-info banner with the Webuntu logo.",
    man: "man <command> — show this help for a single command.",
    history: "history [-c] — list past commands (numbered), or -c to clear them. History persists across sessions.",
    whoami: "whoami — print the current user's name.",
    hostname: "hostname — print the machine name.",
    date: "date — print the current date and time.",
    uname: "uname [-a] — print kernel info.",
    version: "version — print the Webuntu version and shell.",
    uptime: "uptime — how long the session has been running.",
    free: "free [-h] — report (fictional) memory usage.",
    env: "env — list the shell's environment variables.",
    sudo: "sudo <command> — run a command as root. You are not in the sudoers file.",
    exit: "exit — the Perch shell lives inside Webuntu and can't quit; use the power menu instead.",
    clear: "clear (or cls, or Ctrl+L) — clear the terminal screen.",
    help: "help — list every command.",
  };


  // ---------- help text ----------
  const HELP = [
    "Perch shell " + (distro("version") || "") + " \u2014 Webuntu " + (distro("name") || "") + " commands:",
    "  ls [path]          list a directory (folders end with /, -l long, -h human)",
    "  cd [path]          change directory (~ = home)",
    "  pwd                print working directory",
    "  cat <path>         print a file's contents",
    "  mkdir <path>       create a folder",
    "  rm <path>          remove a file or folder",
    "  cp <src> <dst>     copy a file or folder",
    "  mv <src> <dst>     move a file or folder",
    "  touch <path>       create an empty file",
    "  echo <text>        print text   (> file writes, >> appends, $VAR expands)",
    "  head/tail <file>   first/last lines (-n N)",
    "  grep <pat> <file>  print matching lines (-i ignores case)",
    "  wc <file>          count lines, words, characters",
    "  tree [path]        show a folder tree",
    "  open <name>        launch an app, shortcut or folder",
    "  upload <path>      host a file and copy its share link",
    "  ai \"<prompt>\"       ask the AI (the answer streams in)",
    "  gh search <query>  search GitHub repositories by stars",
    "  img \"<prompt>\"      generate an image into Pictures",
    "  neofetch           system info with a logo",
    "  man <command>      show a command's manual entry",
    "  history [-c]       show (or clear) command history",
    "  whoami · hostname · date · uname · version · uptime · free · env",
    "  sudo <command>     run as root (you are not root)",
    "  clear              clear the screen   (Ctrl+L too)",
    "  help               this help",
    "",
  ];

  // Persisted command history (Task 65) — survives reloads.
  const HIST_KEY = "webuntu.term.history";
  function loadHistory() {
    try {
      const a = JSON.parse(localStorage.getItem(HIST_KEY) || "[]");
      return Array.isArray(a) ? a.filter((x) => typeof x === "string").slice(-200) : [];
    } catch (e) { return []; }
  }
  function saveHistory(history) {
    try { localStorage.setItem(HIST_KEY, JSON.stringify(history.slice(-200))); } catch (e) {}
  }

  function createTerminal() {
    const term = {
      root: el("div", "term"),
      cwd: HOME,
      history: loadHistory(),
      histIdx: -1,
      buffer: "",
      w: null,
    };
    term.histIdx = term.history.length;

    const out = el("div", "term-out");
    const lineRow = el("div", "term-line");
    const prompt = el("span", "term-prompt");
    const input = el("input", "term-input");
    input.type = "text";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.setAttribute("aria-label", "Terminal input");
    lineRow.append(prompt, input);

    function banner() {
      const rows = [
        (distro("name") || "Webuntu") + " " + (distro("version") || "") + " \u201c" + (distro("codename") || "") + "\u201d \u2014 " + (distro("tagline") || ""),
        "Welcome to the " + (distro("shell") || "Perch") + ". Type 'help' for commands, or 'neofetch' for a system summary.",
        "",
      ];
      for (const r of rows) print(r);
    }

    function shortCwd() {
      return term.cwd === HOME ? "~" : term.cwd.replace(/^\/home\/user/, "~") || "/";
    }
    function renderPrompt() {
      prompt.textContent = "user@webuntu:" + shortCwd() + " $";
    }
    function print(text) {
      const div = el("div", "term-line-out");
      div.textContent = String(text == null ? "" : text);
      out.appendChild(div);
      out.scrollTop = out.scrollHeight;
      return div;
    }
    function printHtml(html) {
      const div = el("div", "term-line-out");
      div.innerHTML = html;
      out.appendChild(div);
      out.scrollTop = out.scrollHeight;
      return div;
    }
    function focusInput() { input.focus(); }

    // ---------- helpers ----------
    function lsLines(node, withMeta, human) {
      if (!node || !window.FS.isFolder(node)) return ["ls: not a directory"];
      const children = (node.children || []).slice().sort((a, b) => {
        const af = window.FS.isFolder(a) ? 0 : 1, bf = window.FS.isFolder(b) ? 0 : 1;
        return af - bf || a.name.localeCompare(b.name);
      });
      if (!children.length) return ["(empty)"];
      if (!withMeta) {
        return [children.map((c) => {
          if (window.FS.isFolder(c)) return c.name + "/";
          if (window.FS.isShortcut(c)) return c.name + "*";
          return c.name;
        }).join("   ")];
      }
      const rows = [];
      for (const c of children) {
        const kind = window.FS.isFolder(c) ? "d" : (window.FS.isShortcut(c) ? "s" : "-");
        const bytes = (c.meta && c.meta.size != null) ? c.meta.size : 0;
        const size = human ? humanSize(bytes).padStart(9) : String(bytes).padStart(8);
        const mod = c.meta && c.meta.modified ? new Date(c.meta.modified).toISOString().slice(0, 19).replace("T", " ") : "";
        rows.push(kind + "  " + size + "  " + mod + "  " + c.name);
      }
      return rows;
    }
    function resolveNode(arg, isDir) {
      const res = window.FSPath.lookup(arg, { cwd: term.cwd });
      if (!res.ok) return { ok: false, error: res.error };
      if (isDir && !window.FS.isFolder(res.node)) {
        return { ok: false, error: "ENOTDIR: not a directory: '" + res.path + "'" };
      }
      return { ok: true, node: res.node, path: res.path };
    }
    function createAt(arg, type) {
      const target = window.FSPath.cd(term.cwd, arg);
      const parent = window.FSPath.parentPath(target);
      const name = window.FSPath.basename(target);
      const v = window.FS.sanitizeName(name);
      if (!v.ok) return v.error;
      if (window.FS.exists(target)) return "Already exists: " + target;
      const node = window.FS.create(parent, type === "folder"
        ? { name: v.name, type: "folder", icon: "📁", meta: {} }
        : { name: v.name, type: "file", icon: "📄", meta: { content: "", size: 0, modified: Date.now() } });
      return node ? null : "Could not create " + target;
    }

    // ---------- commands ----------
    const CMDS = {};
    function cmd(name, fn, desc) {
      CMDS[name] = { fn, desc };
    }

    cmd("help", () => HELP.slice());
    cmd("pwd", () => [term.cwd]);
    cmd("ls", (args) => {
      const flags = args.filter((a) => a.startsWith("-"));
      const target = args.find((a) => !a.startsWith("-")) || ".";
      const r = resolveNode(target, true);
      return r.ok ? lsLines(r.node, flags.includes("-l"), flags.includes("-h")) : [r.error];
    });
    cmd("cd", (args) => {
      if (!args[0] || args[0] === "~") { term.cwd = HOME; return []; }
      const res = window.FSPath.cdNode(term.cwd, args[0]);
      if (!res.ok) return [res.error];
      term.cwd = res.path;
      return [];
    });
    cmd("cat", (args) => {
      if (!args.length) return ["cat: missing file operand"];
      const r = resolveNode(args[0], false);
      if (!r.ok) return [r.error];
      if (!window.FS.isFile(r.node)) return ["cat: " + r.path + ": not a plain file"];
      return String(r.node.meta.content == null ? "" : r.node.meta.content).split("\n");
    });
    cmd("mkdir", (args) => {
      if (!args.length) return ["mkdir: missing operand"];
      const e = createAt(args[0], "folder");
      return e ? [e] : [];
    });
    cmd("touch", (args) => {
      if (!args.length) return ["touch: missing file operand"];
      const e = createAt(args[0], "file");
      return e ? [e] : [];
    });
    cmd("rm", (args) => {
      if (!args.length) return ["rm: missing operand"];
      // Accept -r/-rf (recursive — our virtual FS removes subtrees wholesale).
      let target = args[0];
      while (target === "-r" || target === "-rf" || target === "-f") { args.shift(); target = args[0]; }
      if (!args.length) return ["rm: missing operand"];
      const r = resolveNode(args[0], false);
      if (!r.ok) return [r.error];
      if (r.path === "/" || r.path === HOME) return ["rm: refusing to remove " + r.path];
      window.FS.remove(r.path);
      return ["Removed " + r.path];
    });
    cmd("echo", (args) => {
      const joined = expandVars(args.join(" "), term.cwd);
      const m = /^([\s\S]*?)\s*(>>?)\s*(\S.*)$/.exec(joined);
      if (!m) return [joined];
      const text = m[1];
      const target = window.FSPath.cd(term.cwd, m[3]);
      const parent = window.FSPath.parentPath(target);
      let node = window.FS.resolve(target);
      if (!node) {
        const v = window.FS.sanitizeName(window.FSPath.basename(target));
        if (!v.ok) return [v.error];
        if (!window.FS.isFolder(window.FS.resolve(parent))) return ["echo: no such directory: " + parent];
        node = window.FS.create(parent, { name: v.name, type: "file", icon: "📄", meta: { content: "", size: 0, modified: Date.now() } });
      }
      if (!window.FS.isFile(node)) return ["echo: " + target + " is not a file"];
      const base = m[2] === ">>" ? String(node.meta.content || "") : "";
      const content = base + (base && !base.endsWith("\n") ? "\n" : "") + text + "\n";
      node.meta.content = content;
      node.meta.size = new TextEncoder().encode(content).length;
      node.meta.modified = Date.now();
      if (window.FS.onChange) window.FS.onChange();
      return [];
    });
    cmd("clear", () => { out.textContent = ""; return []; });
    cmd("history", () => term.history.map((h, i) => String(i + 1).padStart(3) + "  " + h));
    cmd("open", (args) => {
      if (!args.length) return ["open: missing name"];
      const name = args.join(" ");
      const app = window.Apps ? window.Apps.getById(name) : null;
      if (app) { window.Apps.launch(name); return ["Opening " + app.name + "…"]; }
      // shortcut / folder lookup relative to cwd (and home)
      for (const base of [term.cwd, HOME]) {
        const child = window.FSPath.child(base, name);
        if (child && window.FS.isShortcut(child)) {
          window.Launcher.launch(child);
          return ["Opening " + child.name + "…"];
        }
        if (child && window.FS.isFolder(child)) {
          window.Launcher.openFolder(window.FS.getPath(child));
          return ["Opening " + child.name + "…"];
        }
      }
      return ["open: could not find \u201c" + name + "\u201d (try an app id, e.g. open terminal)"];
    });
    cmd("about-webuntu", () => neofetchHtml());
    // Task 65 — a proper neofetch: coloured W logo (Rathji palette) + system
    // info. Prints HTML rows directly (the output area supports it).
    function neofetchHtml() {
      const violet = "#7c6cff", cyan = "#22d3ee", purple = "#8b5cf6";
      const logo = [
        ["      ╔══╗ ╔╗  ╔══╗", violet],
        ["      ╚╗╔╝ ║║  ║╔╗║", cyan],
        ["       ║║  ║╚═╗║╚╝║", purple],
        ["       ╚╝  ╚══╝╚══╝", violet],
        ["", null],
      ];
      const info = [
        [distro("name") || "Webuntu", distro("version") || ""],
        ["DE", distro("desktopEnv") || ""],
        ["Shell", distro("shell") || ""],
        ["Kernel", distro("kernel") || ""],
        ["Uptime", fmtUptime()],
        ["Host", "webuntu"],
        ["User", "user"],
        ["Display", window.innerWidth + "x" + window.innerHeight],
        ["Theme", (document.documentElement.getAttribute("data-theme") === "light" ? "Light" : "Dark") + " · Rathji"],
        ["Terminal", "Perch VT-42"],
      ];
      const rows = [];
      const maxLogo = Math.max(...logo.map((l) => l[0].length));
      for (let i = 0; i < Math.max(logo.length, info.length + 1); i++) {
        const logoLine = logo[i] || ["", null];
        const pad = " ".repeat(Math.max(1, maxLogo - logoLine[0].length));
        if (i < info.length + 1) {
          const [k, v] = i === 0 ? ["OS", (info[0][0] || "Webuntu") + " " + (info[0][1] || "")] : info[i - 1];
          rows.push('<span style="color:' + logoLine[1] + '">' + logoLine[0] + pad + '</span><span>' +
            escapeHtml(k.padEnd(10)) + ": " + escapeHtml(v) + "</span>");
        } else if (logoLine[0]) {
          rows.push('<span style="color:' + logoLine[1] + '">' + logoLine[0] + "</span>");
        }
      }
      for (const r of rows) printHtml(r);
      print("");
      return [];
    }
    function escapeHtml(s) {
      return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }
    cmd("neofetch", () => CMDS["about-webuntu"].fn());

    // ---------- Task 65 additions ----------
    cmd("cp", (args) => {
      if (args.length < 2) return ["cp: missing destination file operand"];
      const rs = resolveNode(args[0], false);
      if (!rs.ok) return [rs.error];
      if (rs.path === "/" || rs.path === HOME) return ["cp: refusing to copy " + rs.path];
      let target = window.FSPath.cd(term.cwd, args[1]);
      const dstNode = window.FS.resolve(target);
      if (dstNode && window.FS.isFolder(dstNode)) target = window.FSPath.cd(target, window.FSPath.basename(rs.path));
      if (window.FS.exists(target)) return ["cp: destination exists: " + target];
      const parent = window.FSPath.parentPath(target);
      if (!window.FS.isFolder(window.FS.resolve(parent))) return ["cp: no such directory: " + parent];
      const spec = cloneSpec(rs.node);
      spec.name = window.FSPath.basename(target);
      window.FS.create(parent, spec);
      return ["Copied " + rs.path + " → " + target];
    });
    cmd("mv", (args) => {
      if (args.length < 2) return ["mv: missing destination file operand"];
      const rs = resolveNode(args[0], false);
      if (!rs.ok) return [rs.error];
      if (rs.path === "/" || rs.path === HOME) return ["mv: refusing to move " + rs.path];
      let target = window.FSPath.cd(term.cwd, args[1]);
      const dstNode = window.FS.resolve(target);
      if (dstNode && window.FS.isFolder(dstNode)) target = window.FSPath.cd(target, window.FSPath.basename(rs.path));
      if (window.FS.exists(target)) return ["mv: destination exists: " + target];
      const parent = window.FSPath.parentPath(target);
      if (!window.FS.isFolder(window.FS.resolve(parent))) return ["mv: no such directory: " + parent];
      if (parent === window.FSPath.parentPath(rs.path)) {
        window.FS.rename(rs.path, window.FSPath.basename(target));
        return ["Renamed " + rs.path + " → " + target];
      }
      const spec = cloneSpec(rs.node);
      spec.name = window.FSPath.basename(target);
      window.FS.create(parent, spec);
      window.FS.remove(rs.path);
      return ["Moved " + rs.path + " → " + target];
    });
    function headTail(mode, args) {
      let n = 10, target;
      if (args[0] === "-n" && args[1]) { n = Math.max(0, parseInt(args[1], 10) || 0); target = args[2]; }
      else target = args[0];
      if (!target) return [mode + ": missing file operand"];
      const r = resolveNode(target, false);
      if (!r.ok) return [r.error];
      if (!window.FS.isFile(r.node)) return [mode + ": " + r.path + ": not a plain file"];
      const lines = String(r.node.meta.content == null ? "" : r.node.meta.content).split("\n");
      return mode === "head" ? lines.slice(0, n) : lines.slice(-n);
    }
    cmd("head", (args) => headTail("head", args));
    cmd("tail", (args) => headTail("tail", args));
    cmd("grep", (args) => {
      let ignoreCase = false;
      if (args[0] === "-i") { ignoreCase = true; args = args.slice(1); }
      if (args.length < 2) return ["grep: missing pattern or file operand"];
      const r = resolveNode(args[1], false);
      if (!r.ok) return [r.error];
      if (!window.FS.isFile(r.node)) return ["grep: " + r.path + ": not a plain file"];
      let re;
      try { re = new RegExp(args[0], ignoreCase ? "i" : ""); }
      catch (e) { return ["grep: invalid regular expression: " + args[0]]; }
      const lines = String(r.node.meta.content == null ? "" : r.node.meta.content).split("\n");
      const hits = lines.filter((l) => re.test(l));
      return hits.length ? hits : [];
    });
    cmd("wc", (args) => {
      if (!args.length) return ["wc: missing file operand"];
      const r = resolveNode(args[0], false);
      if (!r.ok) return [r.error];
      if (!window.FS.isFile(r.node)) return ["wc: " + r.path + ": not a plain file"];
      const text = String(r.node.meta.content == null ? "" : r.node.meta.content);
      const lines = text === "" ? 0 : text.split("\n").length;
      const words = (text.match(/\S+/g) || []).length;
      const chars = text.length;
      return [String(lines).padStart(6) + "  " + String(words).padStart(6) + "  " + String(chars).padStart(7) + "  " + args[0]];
    });
    cmd("tree", (args) => {
      const base = args[0] || ".";
      const r = resolveNode(base, true);
      if (!r.ok) return [r.error];
      const out = [r.path];
      function walk(node, prefix) {
        const kids = (node.children || []).slice().sort((a, b) => {
          const af = window.FS.isFolder(a) ? 0 : 1, bf = window.FS.isFolder(b) ? 0 : 1;
          return af - bf || a.name.localeCompare(b.name);
        });
        kids.forEach((k, i) => {
          const last = i === kids.length - 1;
          const label = k.name + (window.FS.isFolder(k) ? "/" : (window.FS.isShortcut(k) ? "*" : ""));
          out.push(prefix + (last ? "└── " : "├── ") + label);
          if (window.FS.isFolder(k)) walk(k, prefix + (last ? "    " : "│   "));
        });
      }
      walk(r.node, "");
      return out;
    });
    cmd("man", (args) => {
      if (!args[0]) return ["What manual page do you want? For example, try 'man ls'."];
      if (!CMDS[args[0]]) return ["No manual entry for " + args[0]];
      return [MAN[args[0]] || (args[0] + ": " + (CMDS[args[0]].desc || "see 'help'"))];
    });
    cmd("history", (args) => {
      if (args.includes("-c")) { term.history.length = 0; term.histIdx = 0; saveHistory(term.history); return ["history cleared"]; }
      return term.history.map((h, i) => String(i + 1).padStart(3) + "  " + h);
    });
    cmd("uptime", () => [
      " " + new Date().toLocaleString() + "  up " + fmtUptime() + ",  1 user,  load average: 0.42, 0.37, 0.33",
    ]);
    cmd("free", (args) => {
      if (args.includes("-h")) return [
        "              total        used        free",
        "Mem:          8.0 GiB     3.4 GiB     4.6 GiB",
        "Swap:         2.0 GiB     0.0 GiB     2.0 GiB",
      ];
      return [
        "              total        used        free",
        "Mem:         8388608     3565158     4823450",
        "Swap:        2097152           0     2097152",
      ];
    });
    cmd("env", () => {
      const env = shellEnv(term.cwd);
      return Object.keys(env).map((k) => k + "=" + env[k]);
    });
    cmd("sudo", (args) => {
      if (args[0] === "rm" && (args.includes("-rf") || args.includes("-r")) && /(\/|--no-preserve-root)/.test(args.join(" "))) {
        return ["Nice try. user is not in the sudoers file. This incident will be reported."];
      }
      return ["user is not in the sudoers file. This incident will be reported."];
    });
    cmd("whoami", () => ["user"]);
    cmd("hostname", () => ["webuntu"]);
    cmd("date", () => [new Date().toString()]);
    cmd("uname", (args) => {
      if (args.includes("-a")) return [distro("kernel") + " #perch-mint SMP Webuntu " + (distro("version") || "")];
      return [distro("kernel") || "perch"];
    });
    cmd("version", () => [(distro("name") || "Webuntu") + " " + (distro("version") || "") + " (" + (distro("codename") || "") + ") \u2014 " + (distro("shell") || "")]);
    cmd("exit", () => ["The Perch shell lives inside Webuntu \u2014 it can't quit. Use the power menu instead."]);
    cmd("quit", () => CMDS["exit"].fn());
    cmd("cls", () => CMDS["clear"].fn());

    // Task 82 — host a file on Perchance storage and get a share link.
    cmd("upload", (args) => {
      if (!args[0]) return ["usage: upload <path>   (host a file and copy its share link)"];
      const r = resolveNode(args[0], false);
      if (!r.ok) return [r.error];
      if (window.FS.isFolder(r.node)) return ["upload: " + r.path + " is a folder — upload a file."];
      if (!window.Uploads) return ["upload: the Uploads module isn't loaded."];
      return (async () => {
        print("Uploading " + r.path + " …");
        const res = await window.Uploads.uploadNode(r.node);
        if (!res.ok) return ["upload: " + (res.error || "failed")];
        return ["ok — " + res.url, "link copied to clipboard (Super+V to browse history)"];
      })();
    });

    // Task 84 — AI verbs: ai (chat), gh (GitHub search), img (image generation).
    const ghCache = {};
    function slugify(s) {
      return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "image";
    }

    cmd("ai", (args) => {
      if (!args[0]) return ["usage: ai \"<prompt>\"   (ask the AI anything)"];
      if (!window.root || typeof window.root.generateText !== "function")
        return ["ai: the AI text plugin isn't loaded."];
      return (async () => {
        const line = print("ai: thinking…");
        line.classList.add("term-busy");
        let started = false;
        try {
          await window.root.generateText({
            instruction: args[0],
            onChunk: (d) => {
              const t = d && d.textChunk != null ? String(d.textChunk) : "";
              if (t) {
                if (!started) { started = true; line.textContent = ""; line.classList.remove("term-busy"); }
                line.textContent += t;
                scrollBottom();
              }
            },
          });
          if (!started) { line.classList.remove("term-busy"); line.textContent = "ai: (empty response)"; }
        } catch (e) {
          line.classList.remove("term-busy");
          line.textContent = "ai: " + ((e && e.message) || "error");
        }
        scrollBottom();
      })();
    });

    cmd("gh", (args) => {
      if (!args[0]) return ["usage: gh search <query>   (search GitHub repositories by stars)"];
      if (args[0] !== "search") return ["gh: unknown subcommand. Try 'gh search <query>'."];
      if (!args[1]) return ["usage: gh search <query>"];
      return (async () => {
        const q = args.slice(1).join(" ");
        const cacheKey = q.toLowerCase();
        const hit = ghCache[cacheKey];
        if (hit && Date.now() - hit.ts < 5 * 60 * 1000) return hit.lines.slice();
        print("gh: searching GitHub for \"" + q + "\" …");
        let data;
        try {
          const res = await fetch("https://api.github.com/search/repositories?q=" +
            encodeURIComponent(q) + "&sort=stars&order=desc&per_page=8", { signal: AbortSignal.timeout(15000) });
          if (!res.ok) {
            let msg = "HTTP " + res.status;
            try { const b = await res.clone().json(); if (b && b.message) msg += " — " + b.message; } catch (e) {}
            return ["gh: " + msg];
          }
          data = await res.json();
        } catch (e) {
          return ["gh: " + ((e && e.message) || "network error")];
        }
        const items = (data && data.items) || [];
        if (!items.length) return ["gh: no repositories found for \"" + q + "\"."];
        const lines = [
          "gh: top " + items.length + " results for \"" + q + "\":",
          ...items.map((r) => {
            const lang = r.language ? " [" + r.language + "]" : "";
            const desc = r.description ? " — " + r.description : "";
            return "⭐ " + (r.stargazers_count || 0).toLocaleString() + "  " + r.full_name + lang + desc;
          }),
        ];
        ghCache[cacheKey] = { ts: Date.now(), lines };
        return lines;
      })();
    });

    cmd("img", (args) => {
      if (!args[0]) return ["usage: img \"<prompt>\"   (generate an image and save it to Pictures)"];
      if (!window.root || typeof window.root.generateImage !== "function")
        return ["img: the AI image plugin isn't loaded."];
      return (async () => {
        const line = print("img: generating…");
        line.classList.add("term-busy");
        try {
          const res = await window.root.generateImage(args[0], { resolution: "768x768" });
          if (!res || !res.dataUrl) { line.classList.remove("term-busy"); line.textContent = "img: the image plugin returned nothing."; return; }
          const folder = "/home/user/Pictures";
          if (!window.FS.isFolder(window.FS.resolve(folder))) {
            window.FS.create("/home/user", { name: "Pictures", type: "folder", icon: "📁", meta: { modified: Date.now() } });
          }
          const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
          let name = slugify(args[0]) + "-" + stamp + ".png";
          while (window.FS.resolve(window.FSPath.childPath(folder, name))) {
            name = "img-" + Math.random().toString(36).slice(2, 8) + ".png";
          }
          window.FS.create(folder, {
            name, type: "file", icon: "🖼️",
            meta: { content: res.dataUrl, size: Math.floor(res.dataUrl.length * 0.75), modified: Date.now() },
          });
          const path = window.FSPath.childPath(folder, name);
          line.classList.remove("term-busy");
          line.textContent = "img: saved " + path;
          print("open the Pictures folder to view it — or share it with 'upload " + path + "'");
          scrollBottom();
        } catch (e) {
          line.classList.remove("term-busy");
          line.textContent = "img: " + ((e && e.message) || "error");
        }
      })();
    });

    // ---------- execution ----------
    // Shell-style tokenizer: splits on whitespace but keeps 'single' and
    // "double" quoted spans together (and drops the quotes), so filenames with
    // spaces like `cat 'About Webuntu.txt'` work as a user expects.
    function tokenize(s) {
      const tokens = [];
      let cur = "", inTok = false, q = null;
      for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (q) {
          if (ch === q) q = null;
          else cur += ch;
          inTok = true;
        } else if (ch === '"' || ch === "'") {
          q = ch; inTok = true;
        } else if (ch === " " || ch === "\t") {
          if (inTok) { tokens.push(cur); cur = ""; inTok = false; }
        } else {
          cur += ch; inTok = true;
        }
      }
      if (inTok) tokens.push(cur);
      return tokens;
    }

    function execute(raw) {
      const line = String(raw || "").trim();
      renderPrompt();
      print("user@webuntu:" + shortCwd() + " $ " + line);
      if (line) {
        term.history.push(line);
        if (term.history.length > 200) term.history.shift();
        saveHistory(term.history);
      }
      term.histIdx = term.history.length;
      if (!line) return;
      const parts = tokenize(line);
      const name = parts[0];
      const args = parts.slice(1);
      const c = CMDS[name];
      if (!c) {
        print("command not found: " + name + " \u2014 try 'help'");
        return;
      }
      // Async commands (upload/ai/gh/img) resolve to a Promise of lines; print
      // them when they land. The shell stays usable while they run.
      let pending = null;
      try {
        const out = c.fn(args);
        if (out && typeof out.then === "function") {
          pending = out.then(
            (lines) => { for (const l of lines || []) print(l); scrollBottom(); focusInput(); },
            (e) => { print(name + ": " + ((e && e.message) || "error")); scrollBottom(); focusInput(); }
          );
        } else {
          for (const l of out || []) print(l);
          scrollBottom();
        }
      } catch (e) {
        print(name + ": " + ((e && e.message) || "error"));
        scrollBottom();
      }
      return pending;
    }
    function scrollBottom() {
      requestAnimationFrame(() => { out.scrollTop = out.scrollHeight; });
    }

    // ---------- Tab completion (Task 65: path-aware) ----------
    // Completes the word under the caret. For the first token it offers
    // commands + cwd folders; for later tokens it descends the path prefix —
    // `cat Doc` → "Documents/", then Tab keeps completing inside that folder.
    function complete() {
      const value = input.value;
      const caret = input.selectionStart == null ? value.length : input.selectionStart;
      const prefix = value.slice(0, caret);
      const suffix = value.slice(caret);
      const m = /^([\s\S]*?)([\S]*)$/.exec(prefix);
      const head = m[1], word = m[2];
      const isFirst = !/\S/.test(head);
      let candidates = [];
      let baseNode = null;
      if (isFirst) {
        candidates = Object.keys(CMDS).filter((c) => c.startsWith(word));
        const cwd = window.FS.resolve(term.cwd);
        candidates = candidates.concat((cwd.children || [])
          .filter((c) => window.FS.isFolder(c)).map((c) => c.name).filter((n) => n.startsWith(word)));
      } else {
        const slash = word.lastIndexOf("/");
        const base = slash >= 0 ? word.slice(0, slash + 1) : "";
        const seg = slash >= 0 ? word.slice(slash + 1) : word;
        const res = window.FSPath.lookup(base || ".", { cwd: term.cwd });
        if (res.ok && window.FS.isFolder(res.node)) {
          baseNode = res.node;
          candidates = (res.node.children || []).map((c) => c.name).filter((n) => n.startsWith(seg));
        }
      }
      candidates = Array.from(new Set(candidates)).sort();
      if (candidates.length === 1) {
        const c = candidates[0];
        let insert = c;
        if (isFirst) {
          insert = c + " ";
        } else {
          const node = (baseNode.children || []).find((x) => x.name === c);
          insert = word.slice(0, word.length - (word.slice(word.lastIndexOf("/") + 1)).length) + c;
          if (window.FS.isFolder(node)) insert += "/";
          else insert += " ";
        }
        const newPrefix = head + insert;
        input.value = newPrefix + suffix;
        input.setSelectionRange(newPrefix.length, newPrefix.length);
        return;
      }
      if (candidates.length > 1) {
        print("$ " + prefix);
        print(candidates.join("   "));
        scrollBottom();
      }
    }

    // ---------- input handling ----------
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        const value = input.value;
        input.value = "";
        execute(value);
        focusInput();
      } else if (ev.key === "ArrowUp") {
        ev.preventDefault();
        if (term.history.length) {
          if (term.histIdx <= 0) term.histIdx = 0;
          else term.histIdx--;
          input.value = term.history[term.histIdx];
          input.setSelectionRange(input.value.length, input.value.length);
        }
      } else if (ev.key === "ArrowDown") {
        ev.preventDefault();
        if (term.histIdx < term.history.length - 1) {
          term.histIdx++;
          input.value = term.history[term.histIdx];
        } else {
          term.histIdx = term.history.length;
          input.value = "";
        }
        input.setSelectionRange(input.value.length, input.value.length);
      } else if (ev.key === "Tab") {
        ev.preventDefault();
        complete();
      } else if (ev.ctrlKey && (ev.key === "l" || ev.key === "L")) {
        ev.preventDefault();
        out.textContent = "";
      } else if (ev.ctrlKey && (ev.key === "c" || ev.key === "C")) {
        // clear the current input line (^C)
        if (input.value) {
          ev.preventDefault();
          print("^C");
          input.value = "";
        }
      }
    });

    term.root.append(out, lineRow);
    term.root.tabIndex = 0;
    term.root.addEventListener("pointerdown", (ev) => {
      if (ev.target === out || ev.target === term.root) focusInput();
    });
    renderPrompt();
    banner();
    scrollBottom();

    term.onMount = function () {
      const winEl = term.root.closest(".window");
      if (!winEl) return;
      const win = (window.WM.windows || []).find((w) => w.el === winEl);
      if (win) {
        term.w = win;
        setTimeout(focusInput, 60);
      }
    };
    // Task 70 — the Run-a-command dialog (and anything else) can drive the
    // last-created terminal instance: run a command line + focus its input.
    term.execute = execute;
    term.input = input;
    lastTerm = term;
    return term;
  }

  let lastTerm = null;

  window.AppContent = window.AppContent || {};
  window.AppContent["terminal"] = function () {
    const term = createTerminal();
    setTimeout(() => term.onMount(), 60);
    return { content: term.root, w: 640, h: 420, minW: 380, minH: 260 };
  };

  window.Terminal = {
    // Run a command line in the Perch shell, opening the terminal first if
    // needed. Polls (setTimeout, not rAF) until an instance is live so it
    // works even if animation frames stall.
    run(cmd) {
      const go = () => {
        if (lastTerm && lastTerm.execute) {
          lastTerm.execute(String(cmd));
          if (lastTerm.input) lastTerm.input.focus();
          return true;
        }
        return false;
      };
      if (go()) return;
      if (window.Apps) window.Apps.launch("terminal");
      let tries = 0;
      const iv = setInterval(() => {
        tries++;
        if (go() || tries > 25) clearInterval(iv);
      }, 120);
    },
    get open() { return !!(lastTerm && lastTerm.root && lastTerm.root.isConnected); },
  };
})();
