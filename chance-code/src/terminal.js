// terminal.js — a small command terminal + JS REPL for the workspace.

export function createTerminal(hostEl, ctx) {
  const out = document.createElement("div");
  out.id = "termOut";
  const row = document.createElement("div");
  row.id = "termRow";
  const prompt = document.createElement("span");
  prompt.id = "termPrompt";
  prompt.textContent = "❯";
  const input = document.createElement("input");
  input.id = "termInput";
  input.type = "text";
  input.autocomplete = "off";
  input.spellcheck = false;
  row.append(prompt, input);
  hostEl.append(out, row);

  let history = [];
  let histIdx = -1;

  function write(text, cls) {
    const div = document.createElement("div");
    if (cls) div.className = cls;
    div.textContent = text;
    out.appendChild(div);
    out.scrollTop = out.scrollHeight;
  }

  function clear() { out.innerHTML = ""; }

  const COMMANDS = {
    help() {
      write("Commands:", "ln");
      [
        "  help              show this help",
        "  ls | files        list workspace files",
        "  tree              show files as a tree",
        "  cat <path>        print a file's contents",
        "  new <path>        create an empty file",
        "  rm <path>         delete a file",
        "  run               run the project (main.pjs + index.html)",
        "  tree.eval <expr>  evaluate a Perchance expression, e.g. tree.eval hero.selectOne.evaluateItem",
        "  clear             clear the terminal",
        "  echo <text>       print text",
        "  anything else     evaluated as JavaScript (top-level await supported)"
      ].forEach(l => write(l));
    },
    async ls() {
      const files = await ctx.listFiles();
      if (!files.length) { write("(empty workspace)", "dim"); return; }
      files.forEach(f => write(f));
    },
    async tree() {
      const files = await ctx.listFiles();
      if (!files.length) { write("(empty workspace)", "dim"); return; }
      write(buildTreeText(files).trim(), "ln");
    },
    async cat(args) {
      const p = args.trim();
      if (!p) { write("usage: cat <path>", "le"); return; }
      const content = await ctx.read(p);
      if (content === null) { write("no such file: " + p, "le"); return; }
      write(content);
    },
    async new(args) {
      const p = args.trim();
      if (!p) { write("usage: new <path>", "le"); return; }
      const existed = await ctx.exists(p);
      await ctx.write(p, "");
      write(existed ? "overwrote " + p : "created " + p, "ln");
    },
    async rm(args) {
      const p = args.trim();
      if (!p) { write("usage: rm <path>", "le"); return; }
      const ok = await ctx.del(p);
      write(ok ? "deleted " + p : "no such file: " + p, ok ? "ln" : "le");
    },
    async run() {
      write("▶ running project…", "dim");
      await ctx.run();
    },
    async eval(args) {
      const expr = args.trim();
      if (!expr) { write("usage: eval <expr>  (or: tree.eval <expr>)", "le"); return; }
      write(evalJsText(ctx, expr), "ln");
    },
    echo(args) { write(args); },
    clear() { clear(); }
  };

  async function handle(line) {
    const trimmed = line.trim();
    if (!trimmed) return;
    write("❯ " + line, "dim");
    const space = trimmed.indexOf(" ");
    const cmd = space === -1 ? trimmed : trimmed.slice(0, space);
    const args = space === -1 ? "" : trimmed.slice(space + 1);
    const lower = cmd.toLowerCase();
    if (lower === "tree.eval" && args.trim()) {
      const res = ctx.evalTree(args.trim());
      write(res.text || "(empty)", "ln");
      res.errors.forEach(e => write(e, "le"));
      return;
    }
    if (COMMANDS[lower]) {
      await COMMANDS[lower](args);
      return;
    }
    await evalJsLine(line);
  }

  async function evalJsLine(line) {
    let src = line.trim();
    const head = src.split("\n")[0];
    const isStmt = /\b(return|var |let |const |if|for|while|function |class |import |throw )/.test(head) || /^(async\s+)?\(?\s*[a-zA-Z_$][\w$]*\s*(=|=>)/.test(head) || src.includes(";");
    const body = isStmt ? src : "return (" + src + ");";
    try {
      const fn = new Function("ctx", "return (async () => { " + body + " })();");
      const result = await fn(ctx);
      if (result !== undefined) write(typeof result === "string" ? result : JSON.stringify(result, null, 2), "ln");
    } catch (e) {
      write((e && e.message) || String(e), "le");
    }
  }

  function onKey(e) {
    if (e.key === "Enter") {
      const line = input.value;
      input.value = "";
      history.push(line);
      histIdx = history.length;
      handle(line);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (histIdx > 0) { histIdx--; input.value = history[histIdx] || ""; }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (histIdx < history.length) { histIdx++; input.value = history[histIdx] || ""; }
    } else if (e.key === "l" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault(); clear();
    }
  }
  input.addEventListener("keydown", onKey);

  function focus() { input.focus(); }

  write("Chance Code terminal — type help for commands, or just run JavaScript.", "dim");

  return { focus, clear, write, log: (t, cls) => write(t, cls) };
}

function buildTreeText(files) {
  const root = {};
  for (const f of files) {
    const parts = f.split("/");
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      const last = i === parts.length - 1;
      if (!node[p]) node[p] = last ? { __file: true } : {};
      node = node[p];
    }
  }
  const lines = [];
  (function walk(node, prefix, isLast, top) {
    const keys = Object.keys(node).filter(k => k !== "__file");
    keys.forEach((k, i) => {
      const last = i === keys.length - 1;
      const child = node[k];
      if (child.__file) lines.push(prefix + (top ? "" : isLast ? "└─ " : "├─ ") + k);
      else {
        if (!top) lines.push(prefix + (isLast ? "└─ " : "├─ ") + k + "/");
        walk(child, prefix + (top ? "" : isLast ? "   " : "│  "), last, false);
      }
    });
  })(root, "", false, true);
  return lines.join("\n");
}

function evalJsText(ctx, expr) {
  try {
    const result = new Function("return (" + expr + ");")();
    return typeof result === "string" ? result : JSON.stringify(result, null, 2);
  } catch (e) {
    return (e && e.message) || String(e);
  }
}
