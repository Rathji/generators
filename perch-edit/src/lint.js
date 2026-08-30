import { parse } from "https://esm.sh/acorn@8.11.3";
import { store, bus } from "./store.js";

export function isJsPath(path) {
  return /\.(js|mjs|cjs)$/i.test(path || "");
}

export function parseErrors(code) {
  if (!String(code ?? "").trim()) return [];
  try {
    parse(code, { ecmaVersion: "latest", sourceType: "module", allowHashBang: true });
  } catch (e) {
    if (e instanceof SyntaxError && e.loc && typeof e.loc.line === "number") {
      return [
        {
          line: e.loc.line,
          col: e.loc.column || 0,
          message: String(e.message).split("\n")[0],
        },
      ];
    }
  }
  return [];
}

export function setProblems(path, list) {
  if (!path) return;
  if (list && list.length) store.problems[path] = list;
  else delete store.problems[path];
  bus.emit("problems", path);
}

export function lintFile(path) {
  if (!path || !isJsPath(path)) {
    delete store.problems[path];
    return [];
  }
  const errs = parseErrors(store.vfs.read(path) || "");
  if (errs.length) store.problems[path] = errs;
  else delete store.problems[path];
  return errs;
}

export function lintAll() {
  for (const path of store.vfs.walkFiles()) {
    if (isJsPath(path)) lintFile(path);
  }
  bus.emit("problems", null);
}
