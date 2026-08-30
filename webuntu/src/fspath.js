// Webuntu OS — Path navigation service (Phase 4, Task 20)
// A shared navigation layer used by File Manager, Terminal and Save dialogs.
// Two halves:
//   • pure path-string math (no FS dependency): normalize, isAbsolute, join,
//     basename, dirname, cd, parse, parentPath, childPath — handles "/", ".",
//     "..", duplicate slashes, and clamps traversal at the root for absolute
//     paths (so ".." can never escape "/").
//   • FS-aware lookups on top of window.FS: lookup(path, {cwd}) → {ok,node,
//     path} (or {ok:false, error}), cdNode (POSIX-ish cd that returns a
//     directory node), parent/child node lookup, homePath.
// Relative paths resolve against the per-user home /home/user by default.
// Node parents/canonical path strings come from FS's WeakMap parent table.

(function () {
  "use strict";

  // ---------- pure path-string math ----------

  // Collapse slashes, resolve "." and "..". Absolute paths keep a leading "/"
  // and clamp ".." at the root; relative paths keep leading ".." segments.
  function normalize(path) {
    path = String(path == null ? "" : path);
    if (path === "") return "";
    const isAbs = path.startsWith("/");
    const parts = [];
    for (const raw of path.split("/")) {
      if (raw === "" || raw === ".") continue;
      if (raw === "..") {
        if (parts.length) parts.pop();
        else if (!isAbs) parts.push("..");
        continue;
      }
      parts.push(raw);
    }
    return (isAbs ? "/" : "") + parts.join("/");
  }

  function isAbsolute(path) { return String(path).startsWith("/"); }

  function join() {
    return normalize([...arguments].filter((p) => p != null && p !== "").join("/"));
  }

  // Last path segment; "/" and "" return themselves.
  function basename(path) {
    const n = normalize(path);
    if (n === "" || n === "/") return n;
    return n.slice(n.lastIndexOf("/") + 1);
  }

  // Everything before the last segment; "/" stays "/", "foo" → ".".
  function dirname(path) {
    const n = normalize(path);
    if (n === "") return ".";
    const i = n.lastIndexOf("/");
    if (i === -1) return ".";
    if (i === 0) return "/";
    return n.slice(0, i);
  }

  // POSIX-ish cd: no/empty arg → home; "~" → home; "~/x" → home-relative;
  // absolute → itself; otherwise relative to cwd.
  function cd(cwd, arg) {
    const home = homePath();
    if (arg == null || arg === "" || arg === "~") return home;
    const a = String(arg);
    if (a.startsWith("~/")) return normalize(join(home, a.slice(2)));
    if (isAbsolute(a)) return normalize(a);
    return normalize(join(cwd == null ? home : cwd, a));
  }

  // { isAbsolute, parts, path } for Terminal-style consumption.
  function parse(path) {
    const n = normalize(path);
    return { isAbsolute: n.startsWith("/"), parts: n.split("/").filter(Boolean), path: n };
  }

  function parentPath(path) {
    const n = normalize(path);
    if (n === "" || n === "/") return "/";
    return dirname(n);
  }

  function childPath(parent, name) {
    return normalize(join(parent, name));
  }

  // ---------- FS-aware lookups (thin wrappers over window.FS) ----------

  function homePath() {
    return FS ? FS.getPath(FS.home()) : "/home/user";
  }

  // Resolve a path (absolute, or relative to opts.cwd, default: home).
  // Returns { ok:true, node, path } or { ok:false, path, error }.
  function lookup(path, opts) {
    const cwd = opts && opts.cwd != null ? normalize(opts.cwd) : homePath();
    const target = path == null || path === "" ? cwd : cd(cwd, path);
    const node = FS.resolve(target);
    if (!node) {
      return { ok: false, path: target, error: `ENOENT: no such file or directory: '${target}'` };
    }
    return { ok: true, node, path: FS.getPath(node) };
  }

  // cd that returns the resulting directory node (or an error).
  function cdNode(cwd, arg) {
    const next = cd(cwd, arg);
    const res = lookup(next, { cwd: "/" }); // `next` is already canonical/absolute
    if (!res.ok) return res;
    if (!FS.isFolder(res.node)) {
      return { ok: false, path: next, error: `ENOTDIR: not a directory: '${next}'` };
    }
    return res;
  }

  // Parent/child NODE lookup (opposite direction of parentPath/childPath).
  function parent(pathOrNode) {
    if (pathOrNode && typeof pathOrNode === "object") return FS.getParent(pathOrNode);
    const res = lookup(parentPath(pathOrNode));
    return res.ok ? res.node : null;
  }

  function child(pathOrNode, name) {
    const base = typeof pathOrNode === "object" ? FS.getPath(pathOrNode) : normalize(pathOrNode);
    const res = lookup(childPath(base, name));
    return res.ok ? res.node : null;
  }

  window.FSPath = {
    normalize, isAbsolute, join, basename, dirname, cd, parse, parentPath, childPath,
    homePath, lookup, cdNode, parent, child,
  };
})();
