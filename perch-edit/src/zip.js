import JSZip from "https://esm.sh/jszip@3.10.1";
import { store, schedulePersist, VFS } from "./store.js";

function safePath(name) {
  const parts = String(name).split("/").filter((p) => p && p !== "." && p !== "..");
  return parts.join("/");
}

export async function exportWorkspaceZip() {
  const files = store.vfs.walkFiles();
  if (!files.length) throw new Error("workspace is empty");
  const zip = new JSZip();
  for (const p of files) zip.file(p, store.vfs.read(p) || "");
  const blob = await zip.generateAsync({ type: "blob" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "perchedit-workspace.zip";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 3000);
  return { count: files.length };
}

export async function importWorkspaceZip(file) {
  let zip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch (e) {
    throw new Error("Not a valid .zip archive: " + (e && e.message ? e.message : e));
  }
  let count = 0;
  let skipped = 0;
  const entries = [];
  zip.forEach((relPath, entry) => {
    if (entry.dir) return;
    const p = safePath(relPath);
    if (!p) return;
    entries.push({ p, entry });
  });
  for (const { p, entry } of entries) {
    let content;
    try {
      content = await entry.async("string");
    } catch (e) {
      skipped++;
      continue;
    }
    if (store.vfs.read(p) !== null) {
      const existing = store.vfs.read(p);
      if (existing === content) {
        skipped++;
        continue;
      }
    }
    store.vfs.write(p, content);
    if (store.saved[p] === undefined) store.saved[p] = "";
    store.dirty.add(p);
    if (!store.tabs.includes(p)) store.tabs.push(p);
    count++;
  }
  schedulePersist();
  return { count, skipped };
}

export function collectWorkspace() {
  return store.vfs.walkFiles().map((p) => ({ path: p, content: store.vfs.read(p) || "" }));
}

export function restoreWorkspaceData(files) {
  store.vfs = new VFS();
  for (const { path, content } of files) store.vfs.write(path, content);
}
