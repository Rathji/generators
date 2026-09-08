// src/rbac-build.mjs — regenerates the embedded/generated parts of the plugin.
//
// Pipeline (single source of truth -> generated artifacts):
//   src/rbac-engine.js            pure engine (matcher + factory functions)
//   src/rbac-server-core.js       authoritative server core
//   src/rbac-demo-server.js       demo app server extension
//   src/rbac-templates/*          hand-written plugin API + demo page (markers)
//   --------------------------------------------------------------
//   main.pjs                      createEngine/matchPermission bodies +
//                                 getServerScript()/demoServerScript() strings
//   index.html                    <script type="text/x-server-plugin"> content
//
// Run it from execute_js (a module worker with `fs` + WebCrypto):
//   const src = await fs.readTextFile("src/rbac-build.mjs");
//   await (0, eval)(src);          // writes main.pjs + index.html
//
// The demo admin password is "demo-admin-pw" (hash embedded into the DEMO
// server script only — the generic getServerScript() keeps a placeholder for
// each app to fill with its own hash). It is shown on the demo page; this is a
// demo-only convenience, never a production pattern.

const ENGINE = "src/rbac-engine.js";
const CORE = "src/rbac-server-core.js";
const DEMO = "src/rbac-demo-server.js";
const MAIN_TPL = "src/rbac-templates/main.pjs";
const HTML_TPL = "src/rbac-templates/index.html";
const MAIN_OUT = "main.pjs";
const HTML_OUT = "index.html";
const DEMO_PASSWORD = "demo-admin-pw";

// ---- extract a top-level function body by header, ignoring comments/strings ----
function findFunction(src, header) {
  const start = src.indexOf(header);
  if (start === -1) throw new Error("header not found: " + header);
  const open = src.indexOf("{", start + header.length);
  let depth = 0, inStr = null, inLine = false, inBlock = false;
  for (let i = open; i < src.length; i++) {
    const ch = src[i], nx = src[i + 1];
    if (inLine) { if (ch === "\n") inLine = false; continue; }
    if (inBlock) { if (ch === "*" && nx === "/") { inBlock = false; i++; } continue; }
    if (inStr) { if (ch === "\\") { i++; continue; } if (ch === inStr) inStr = null; continue; }
    if (ch === "/" && nx === "/") { inLine = true; i++; continue; }
    if (ch === "/" && nx === "*") { inBlock = true; i++; continue; }
    if (ch === '"' || ch === "'") { inStr = ch; continue; }
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) return { bodyStart: open + 1, bodyEnd: i }; }
  }
  throw new Error("unterminated: " + header);
}

// Normalize an extracted function body to ZERO leading indentation per line
// (blank lines become ""). The Perchance pjs parser chokes on embedded function
// bodies with NON-UNIFORM indentation (e.g. first line at 6 spaces, rest at 4)
// — it hangs the whole page render. Uniform indentation is required, so every
// line is trimmed here and re-indented uniformly by embedBlock() below.
function norm(t) {
  return t.replace(/^\s*\n/gm, "").replace(/\s+$/gm, "").split("\n").map(l => l.trim()).join("\n");
}
// Re-indent a normalized body for insertion at a 4-space-indented marker line:
// the FIRST line keeps 0 leading indent (the marker's own 4 spaces supply it),
// every later line gets `pad` — so all lines land at exactly `pad` in the file.
function embedBlock(t, pad) {
  return t.split("\n").map((l, i) => (i === 0 ? l : pad + l)).join("\n");
}
function trimEnd(s) { return s.replace(/\s+$/g, ""); }

// UTF-8 -> base64. The server scripts are embedded as base64 string literals in
// main.pjs because very long single-line string literals containing quotes,
// braces and backslashes hang the Perchance pjs parser, while base64 content
// (A-Za-z0-9+/=) is safe. b64decode() in the rbac list reverses this at runtime.
function b64Utf8(s) {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// Run from execute_js (module worker with `fs` + WebCrypto):
//   const src = await fs.readTextFile("src/rbac-build.mjs");
//   await (0, eval)(src + "\nreturn await build();");

async function build(opts = {}) {
  const engineSrc = await fs.readTextFile(ENGINE);
  const coreSrc = await fs.readTextFile(CORE);
  const demoSrc = await fs.readTextFile(DEMO);

  const matcher = findFunction(engineSrc, "function __rbacMatchPermission(pattern, permission)");
  const engineFn = findFunction(engineSrc, "function __rbacEngine()");
  const matcherBody = norm(engineSrc.slice(matcher.bodyStart, matcher.bodyEnd));
  const engineBody = norm(engineSrc.slice(engineFn.bodyStart, engineFn.bodyEnd));

  const matchFn = embedBlock(matcherBody, "    ");

  // Both const-arrow bodies land at 4 spaces (first line via the marker line,
  // the rest via embedBlock) — uniform indentation keeps the pjs parser happy.
  const engineBlock = embedBlock(
    "const __rbacMatchPermission = (pattern, permission) => {\n" + matcherBody + "\n};\n" +
    "const __rbacEngine = () => {\n" + engineBody + "\n};",
    "    "
  );

  const genericServer = trimEnd(engineSrc) + "\n" + trimEnd(coreSrc) + "\n";

  let demoHash = "";
  try {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(DEMO_PASSWORD));
    demoHash = [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
  } catch (e) { throw new Error("crypto.subtle unavailable: " + e.message); }

  const demoServer = (trimEnd(engineSrc) + "\n" + trimEnd(coreSrc) + "\n" + trimEnd(demoSrc) + "\n").replace(/__DEMO_HASH__/g, demoHash);

  let main = await fs.readTextFile(MAIN_TPL);
  main = main.replace("@@RBAC_ENGINE_BODY@@", () => engineBlock.replace(/\n$/, ""));
  main = main.replace("@@RBAC_MATCH_BODY@@", () => matchFn.replace(/\n$/, ""));
  main = main.replace("@@RBAC_SERVER_SCRIPT_B64@@", () => b64Utf8(genericServer));
  main = main.replace("@@RBAC_DEMO_SERVER_SCRIPT_B64@@", () => b64Utf8(demoServer));

  let html = await fs.readTextFile(HTML_TPL);
  html = html.replace("@@RBAC_DEMO_SERVER_SCRIPT@@", () => demoServer);

  await fs.writeTextFile(MAIN_OUT, main);
  await fs.writeTextFile(HTML_OUT, html);

  return {
    demoHash,
    genericServerBytes: genericServer.length,
    demoServerBytes: demoServer.length,
    mainBytes: main.length,
    htmlBytes: html.length,
    markersLeft: (main.match(/@@RBAC/g) || []).length + (html.match(/@@RBAC/g) || []).length
  };
}
