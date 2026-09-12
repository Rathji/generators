// ============================================================================
//  VALIDATION TESTS — T13 Virtual File Explorer
//
//  `runFileTests()` returns [{name, pass, error?}, ...]. Run in the page:
//    const m = await import("./src/tests/files.test.js");
//    await m.runFileTests()
//
//  Pure tests cover the FileSystem store in src/filesystem.js (save a file,
//  list it, fetch it back by id/name, persistence round-trip). DOM-backed
//  tests drive the live Desktop "Files" sidebar: save the active window as a
//  named file, list it, open it back into the workspace (content loads into a
//  window), re-open focuses instead of duplicating, and delete removes it.
// ============================================================================

import { FileSystem } from "../filesystem.js";
import { fileSystem } from "../filesystem.js";
import { documentRegistry } from "../registry.js";
import { windowManager } from "../windows.js";

function memStore() {
  const m = new Map();
  return { get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => m.set(k, v) };
}

export async function runFileTests() {
  const results = [];
  const t = async (name, fn) => {
    try {
      await fn();
      results.push({ name, pass: true });
    } catch (e) {
      results.push({ name, pass: false, error: e && e.message ? e.message : String(e) });
    }
  };

  // ── Pure: the FileSystem store ──────────────────────────────────────────
  await t("create() saves a file with id, app, name, content and timestamps", () => {
    const fs = new FileSystem({ store: memStore() });
    const res = fs.create({ app: "docs", name: "Report", content: "hello" });
    if (!res.ok || !res.file) throw new Error("create failed");
    const f = res.file;
    if (!f.id) throw new Error("no id");
    if (f.app !== "docs" || f.name !== "Report" || f.content !== "hello") throw new Error("fields wrong");
    if (!(f.createdAt > 0) || !(f.updatedAt > 0)) throw new Error("timestamps missing");
    if (fs.count() !== 1) throw new Error("count");
  });

  await t("list() and listByApp() return the saved files", () => {
    const fs = new FileSystem({ store: memStore() });
    fs.create({ app: "docs", name: "B", content: "1" });
    fs.create({ app: "docs", name: "A", content: "2" });
    fs.create({ app: "slides", name: "Deck", content: "3" });
    if (fs.list().length !== 3) throw new Error("list length");
    const docs = fs.listByApp("docs");
    if (docs.length !== 2) throw new Error("listByApp length");
    if (docs[0].name !== "A" || docs[1].name !== "B") throw new Error("listByApp should sort by name");
  });

  await t("get() and getByName() look up saved files", () => {
    const fs = new FileSystem({ store: memStore() });
    const { file } = fs.create({ app: "docs", name: "Memo", content: "x" });
    if (!fs.get(file.id)) throw new Error("get by id failed");
    if (fs.getByName("docs", "Memo").id !== file.id) throw new Error("getByName failed");
    if (fs.getByName("docs", "Nope") !== null) throw new Error("getByName miss should be null");
  });

  await t("saveAs() creates a new file for an unused name", () => {
    const fs = new FileSystem({ store: memStore() });
    const res = fs.saveAs({ app: "docs", name: "Fresh", content: "a" });
    if (!res.ok || !res.created) throw new Error("should create");
    if (res.file.content !== "a") throw new Error("content not stored");
  });

  await t("saveAs() updates the file that already owns the name", () => {
    const fs = new FileSystem({ store: memStore() });
    const { file } = fs.create({ app: "docs", name: "Note", content: "old" });
    const res = fs.saveAs({ app: "docs", name: "Note", content: "new" });
    if (!res.ok || res.created) throw new Error("should update, not create");
    if (res.file.id !== file.id) throw new Error("same file should be updated");
    if (fs.get(file.id).content !== "new") throw new Error("content not updated");
    if (fs.count() !== 1) throw new Error("no new file should appear");
  });

  await t("save(id, patch) updates content/meta and bumps updatedAt", () => {
    const fs = new FileSystem({ store: memStore() });
    const { file } = fs.create({ app: "sheets", name: "Budget", content: "1" });
    const t0 = file.updatedAt;
    const res = fs.save(file.id, { content: "2", meta: { kind: "demo" } });
    if (!res.ok) throw new Error("save failed");
    const f = fs.get(file.id);
    if (f.content !== "2" || f.meta.kind !== "demo") throw new Error("patch not applied");
    if (!(f.updatedAt >= t0)) throw new Error("updatedAt not bumped");
  });

  await t("saved files survive a fresh FileSystem restored from the same store", () => {
    const store = memStore();
    const fs = new FileSystem({ store });
    fs.create({ app: "docs", name: "Durable", content: "kept" });
    const fs2 = new FileSystem({ store });
    if (fs2.count() !== 1) throw new Error("restore lost files");
    const f = fs2.getByName("docs", "Durable");
    if (!f || f.content !== "kept") throw new Error("restored content wrong");
  });

  await t("remove() deletes a file and reports it", () => {
    const fs = new FileSystem({ store: memStore() });
    const { file } = fs.create({ app: "docs", name: "Gone", content: "" });
    const res = fs.remove(file.id);
    if (!res.ok || fs.get(file.id) !== null || fs.count() !== 0) throw new Error("remove failed");
    if (fs.remove(file.id).ok) throw new Error("second remove should fail");
  });

  // ── Desktop sidebar (page only) ─────────────────────────────────────────
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
    const cleanupFiles = (created) => {
      for (const f of created) {
        const cur = fileSystem.get(f.id);
        if (cur) fileSystem.remove(f.id);
      }
    };
    const cleanupWindow = (doc) => {
      const w = windowManager.list().find((x) => x.docId === doc.id);
      if (w) windowManager.close(w.id);
      if (documentRegistry.get(doc.id)) documentRegistry.remove(doc.id);
    };

    await t("the Desktop mounts a Files sidebar that lists saved files", async () => {
      const created = [];
      const winsBefore = windowManager.list().map((w) => w.id);
      try {
        const r = fileSystem.create({ app: "docs", name: "SidebarDemo", content: "xyz" });
        if (!r.ok) throw new Error("prep create failed");
        created.push(r.file);
        const side = await gotoDesktop();
        const row = side.querySelector('.fs-row[data-id="' + r.file.id + '"]');
        if (!row) throw new Error("saved file not listed in the sidebar");
        const name = row.querySelector(".fs-open").textContent.trim();
        if (name !== "SidebarDemo") throw new Error("row name: " + name);
        if (!side.querySelector(".fs-group-head")) throw new Error("no app group header");
        const expected = fileSystem.count();
        const cntTxt = document.querySelector(".desk-count").textContent;
        if (!new RegExp(expected + " saved file").test(cntTxt)) throw new Error("desk count did not reflect saved files: " + cntTxt);
      } finally {
        cleanupFiles(created);
        for (const w of windowManager.list().map((x) => x.id)) if (!winsBefore.includes(w)) windowManager.close(w);
      }
    });

    await t("Save… stores the active window's document as a named file", async () => {
      const created = [];
      const doc = documentRegistry.create({ app: "docs", content: "Saved body text" });
      const winsBefore = windowManager.list().map((w) => w.id);
      try {
        windowManager.open({ docId: doc.id, app: "docs", title: "Temp" });
        const side = await gotoDesktop();
        const name = "SavedViaSidebar_" + Date.now().toString(36);
        const btn = side.querySelector(".fs-save");
        if (!btn || btn.disabled) throw new Error("Save button missing/disabled");
        btn.click();
        const input = await waitFor(".fs-save-name");
        if (!input) throw new Error("save form did not open");
        input.value = name;
        side.querySelector(".fs-save-ok").click();
        const file = fileSystem.getByName("docs", name);
        if (!file) throw new Error("file not created");
        created.push(file);
        if (file.content !== "Saved body text") throw new Error("file content mismatch: " + file.content);
        const linked = documentRegistry.find((d) => d.meta && d.meta.fileId === file.id);
        if (!linked || linked.id !== doc.id) throw new Error("doc not linked to file");
      } finally {
        cleanupFiles(created);
        cleanupWindow(doc);
        for (const w of windowManager.list().map((x) => x.id)) if (!winsBefore.includes(w)) windowManager.close(w);
      }
    });

    await t("opening a saved file loads its content into a workspace window", async () => {
      const created = [];
      const docsOpened = [];
      const winsBefore = windowManager.list().map((w) => w.id);
      try {
        const r = fileSystem.create({ app: "docs", name: "OpenMe", content: "The loaded content" });
        if (!r.ok) throw new Error("prep create failed");
        created.push(r.file);
        const side = await gotoDesktop();
        const openBtn = side.querySelector('.fs-row[data-id="' + r.file.id + '"] .fs-open');
        if (!openBtn) throw new Error("open button missing");
        openBtn.click();
        let found = false;
        for (let i = 0; i < 40; i++) {
          const linked = documentRegistry.find((d) => d.meta && d.meta.fileId === r.file.id);
          if (linked && windowManager.list().find((w) => w.docId === linked.id)) {
            if (linked.content === "The loaded content") found = true;
            docsOpened.push(linked);
            break;
          }
          await sleep(60);
        }
        if (!found) throw new Error("file content did not load into the workspace window");
      } finally {
        cleanupFiles(created);
        for (const d of docsOpened) cleanupWindow(d);
        for (const w of windowManager.list().map((x) => x.id)) if (!winsBefore.includes(w)) windowManager.close(w);
      }
    });

    await t("opening the same file again focuses its window instead of duplicating", async () => {
      const created = [];
      const docsOpened = [];
      const winsBefore = windowManager.list().map((w) => w.id);
      try {
        const r = fileSystem.create({ app: "docs", name: "FocusMe", content: "once" });
        if (!r.ok) throw new Error("prep create failed");
        created.push(r.file);
        const side = await gotoDesktop();
        const open = async () => {
          side.querySelector('.fs-row[data-id="' + r.file.id + '"] .fs-open').click();
          for (let i = 0; i < 40; i++) {
            const linked = documentRegistry.find((d) => d.meta && d.meta.fileId === r.file.id);
            if (linked && windowManager.list().find((w) => w.docId === linked.id)) return linked;
            await sleep(60);
          }
          throw new Error("window did not open");
        };
        const linked = await open();
        docsOpened.push(linked);
        const afterFirst = windowManager.count();
        await open();
        if (windowManager.count() !== afterFirst) throw new Error("duplicate window created");
        const win = windowManager.list().find((w) => w.docId === linked.id);
        if (!win || windowManager.getActive().id !== win.id) throw new Error("existing window not focused");
      } finally {
        cleanupFiles(created);
        for (const d of docsOpened) cleanupWindow(d);
        for (const w of windowManager.list().map((x) => x.id)) if (!winsBefore.includes(w)) windowManager.close(w);
      }
    });

    await t("deleting a file removes it from the sidebar", async () => {
      const created = [];
      const winsBefore = windowManager.list().map((w) => w.id);
      try {
        const r = fileSystem.create({ app: "docs", name: "DeleteMe", content: "" });
        if (!r.ok) throw new Error("prep create failed");
        created.push(r.file);
        const side = await gotoDesktop();
        const delBtn = side.querySelector('.fs-row[data-id="' + r.file.id + '"] .fs-del');
        if (!delBtn) throw new Error("delete button missing");
        delBtn.click();
        const row = side.querySelector('.fs-row[data-id="' + r.file.id + '"]');
        if (!row.classList.contains("confirm")) throw new Error("first click should arm confirm");
        delBtn.click();
        if (fileSystem.get(r.file.id) !== null) throw new Error("file still present after confirm");
        if (document.querySelector('.fs-side .fs-row[data-id="' + r.file.id + '"]')) throw new Error("row still listed");
      } finally {
        cleanupFiles(created);
        for (const w of windowManager.list().map((x) => x.id)) if (!winsBefore.includes(w)) windowManager.close(w);
      }
    });

    await t("the sidebar shows an empty state when no files are saved", async () => {
      const saved = fileSystem.list().slice();
      const winsBefore = windowManager.list().map((w) => w.id);
      try {
        for (const f of saved) fileSystem.remove(f.id);
        const side = await gotoDesktop();
        if (!side.querySelector(".fs-empty")) throw new Error("empty state missing");
        if (!/0 saved files/.test(document.querySelector(".desk-count").textContent)) throw new Error("desk count did not drop to 0");
      } finally {
        for (const f of saved) fileSystem.create({ app: f.app, name: f.name, content: f.content, meta: f.meta });
        for (const w of windowManager.list().map((x) => x.id)) if (!winsBefore.includes(w)) windowManager.close(w);
      }
    });
  }

  return results;
}
