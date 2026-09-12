// ============================================================================
//  VALIDATION TESTS — T14 File Naming & Renaming
//
//  `runNamingTests()` returns [{name, pass, error?}, ...]. Run in the page:
//    const m = await import("./src/tests/naming.test.js");
//    await m.runNamingTests()
//
//  Pure tests cover the naming rules in src/filesystem.js: files are created
//  with a name, names are unique per app (duplicates rejected on create and
//  rename), empty names are rejected, and same-name-in-a-different-app is
//  allowed. DOM-backed tests drive the sidebar's inline rename editor.
// ============================================================================

import { FileSystem } from "../filesystem.js";
import { fileSystem } from "../filesystem.js";
import { documentRegistry } from "../registry.js";
import { windowManager } from "../windows.js";

function memStore() {
  const m = new Map();
  return { get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => m.set(k, v) };
}

export async function runNamingTests() {
  const results = [];
  const t = async (name, fn) => {
    try {
      await fn();
      results.push({ name, pass: true });
    } catch (e) {
      results.push({ name, pass: false, error: e && e.message ? e.message : String(e) });
    }
  };

  // ── Pure: naming rules ──────────────────────────────────────────────────
  await t("create() stores the file under the given name", () => {
    const fs = new FileSystem({ store: memStore() });
    const { file } = fs.create({ app: "docs", name: "Quarterly Report", content: "" });
    if (file.name !== "Quarterly Report") throw new Error("name not stored");
  });

  await t("rename() updates the file's name", () => {
    const fs = new FileSystem({ store: memStore() });
    const { file } = fs.create({ app: "docs", name: "Old Name", content: "" });
    const res = fs.rename(file.id, "New Name");
    if (!res.ok || !res.renamed) throw new Error("rename failed");
    if (fs.get(file.id).name !== "New Name") throw new Error("name not updated");
    if (fs.getByName("docs", "New Name").id !== file.id) throw new Error("lookup under new name failed");
    if (fs.getByName("docs", "Old Name") !== null) throw new Error("old name still resolves");
  });

  await t("duplicate names are rejected on create", () => {
    const fs = new FileSystem({ store: memStore() });
    fs.create({ app: "docs", name: "Budget", content: "" });
    const dup = fs.create({ app: "docs", name: "Budget", content: "x" });
    if (dup.ok) throw new Error("duplicate create should be rejected");
    if (dup.error !== "duplicate") throw new Error("wrong error: " + dup.error);
    if (fs.count() !== 1) throw new Error("duplicate was stored");
  });

  await t("duplicate names are rejected on rename", () => {
    const fs = new FileSystem({ store: memStore() });
    const a = fs.create({ app: "docs", name: "One", content: "" }).file;
    fs.create({ app: "docs", name: "Two", content: "" });
    const res = fs.rename(a.id, "Two");
    if (res.ok) throw new Error("duplicate rename should be rejected");
    if (res.error !== "duplicate") throw new Error("wrong error: " + res.error);
    if (fs.get(a.id).name !== "One") throw new Error("name changed despite rejection");
  });

  await t("empty / whitespace-only names are rejected", () => {
    const fs = new FileSystem({ store: memStore() });
    if (fs.create({ app: "docs", name: "", content: "" }).ok) throw new Error("empty create accepted");
    if (fs.create({ app: "docs", name: "   ", content: "" }).ok) throw new Error("whitespace create accepted");
    const { file } = fs.create({ app: "docs", name: "Real", content: "" });
    if (fs.rename(file.id, "  ").ok) throw new Error("whitespace rename accepted");
    if (fs.get(file.id).name !== "Real") throw new Error("name changed on bad rename");
  });

  await t("the same name may exist in different apps", () => {
    const fs = new FileSystem({ store: memStore() });
    if (!fs.create({ app: "docs", name: "Plan", content: "" }).ok) throw new Error("docs create failed");
    const res = fs.create({ app: "slides", name: "Plan", content: "" });
    if (!res.ok) throw new Error("same name in another app should be allowed");
    if (fs.count() !== 2) throw new Error("count");
  });

  await t("renaming a file to its own current name is a no-op success", () => {
    const fs = new FileSystem({ store: memStore() });
    const { file } = fs.create({ app: "docs", name: "Same", content: "" });
    const res = fs.rename(file.id, "Same");
    if (!res.ok || res.renamed) throw new Error("self-rename should succeed without a rename event");
  });

  await t("names are trimmed on create and rename", () => {
    const fs = new FileSystem({ store: memStore() });
    const { file } = fs.create({ app: "docs", name: "  Padded  ", content: "" });
    if (file.name !== "Padded") throw new Error("create did not trim");
    const res = fs.rename(file.id, "  Trimmed  ");
    if (!res.ok || fs.get(file.id).name !== "Trimmed") throw new Error("rename did not trim");
  });

  // ── Sidebar inline rename (page only) ───────────────────────────────────
  let domOk = true;
  try {
    domOk = typeof document !== "undefined" && !!document.createElement;
  } catch {
    domOk = false;
  }

  if (domOk) {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const waitFor = async (sel, tries = 60) => {
      for (let i = 0; i < tries; i++) {
        const el = document.querySelector(sel);
        if (el) return el;
        await sleep(80);
      }
      return null;
    };
    const gotoDesktop = async () => {
      if (location.hash === "#/desktop") {
        location.hash = "#/home";
        for (let i = 0; i < 40 && document.querySelector(".fs-side"); i++) await sleep(50);
        await sleep(60);
      }
      location.hash = "#/desktop";
      const side = await waitFor(".fs-side");
      if (!side) throw new Error("no file sidebar");
      return side;
    };
    const cleanup = (files) => {
      for (const f of files) {
        const cur = fileSystem.get(f.id);
        if (cur) fileSystem.remove(f.id);
      }
    };

    await t("the sidebar renames a file through its inline editor", async () => {
      const created = [];
      const winsBefore = windowManager.list().map((w) => w.id);
      try {
        const r = fileSystem.create({ app: "docs", name: "RenameMe", content: "" });
        if (!r.ok) throw new Error("prep create failed");
        created.push(r.file);
        const side = await gotoDesktop();
        const row = side.querySelector('.fs-row[data-id="' + r.file.id + '"]');
        row.querySelector(".fs-rename").click();
        const input = await waitFor(".fs-rename-input");
        if (!input) throw new Error("rename editor did not open");
        input.value = "RenamedViaSidebar";
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        const file = fileSystem.get(r.file.id);
        if (!file || file.name !== "RenamedViaSidebar") throw new Error("rename not applied: " + (file && file.name));
        const side2 = await waitFor('.fs-row[data-id="' + r.file.id + '"] .fs-open');
        if (!side2 || side2.textContent.trim() !== "RenamedViaSidebar") throw new Error("sidebar not refreshed");
      } finally {
        cleanup(created);
        for (const w of windowManager.list().map((x) => x.id)) if (!winsBefore.includes(w)) windowManager.close(w);
      }
    });

    await t("renaming to an existing name is rejected and keeps the old name", async () => {
      const created = [];
      const winsBefore = windowManager.list().map((w) => w.id);
      try {
        const a = fileSystem.create({ app: "docs", name: "KeepMe", content: "" });
        const b = fileSystem.create({ app: "docs", name: "Taken", content: "" });
        if (!a.ok || !b.ok) throw new Error("prep create failed");
        created.push(a.file, b.file);
        const side = await gotoDesktop();
        const row = side.querySelector('.fs-row[data-id="' + a.file.id + '"]');
        row.querySelector(".fs-rename").click();
        const input = await waitFor(".fs-rename-input");
        if (!input) throw new Error("rename editor did not open");
        input.value = "Taken";
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        if (fileSystem.get(a.file.id).name !== "KeepMe") throw new Error("duplicate rename should keep the old name");
      } finally {
        cleanup(created);
        for (const w of windowManager.list().map((x) => x.id)) if (!winsBefore.includes(w)) windowManager.close(w);
      }
    });
  }

  return results;
}
