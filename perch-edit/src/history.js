import { store, bus, scheduleSnapshotPersist } from "./store.js";

export const SNAPSHOT_CAP = 50;

export function addSnapshot(path, content) {
  if (!path || content == null) return;
  const arr = (store.snapshots[path] = store.snapshots[path] || []);
  const last = arr[arr.length - 1];
  if (last && last.content === content) return;
  arr.push({ ts: Date.now(), content });
  while (arr.length > SNAPSHOT_CAP) arr.shift();
  scheduleSnapshotPersist();
  bus.emit("snapshots", path);
}

export function snapshotsFor(path) {
  return store.snapshots[path] || [];
}

export function restoreSnapshot(path, content) {
  if (!path || content == null) return;
  bus.emit("restore", path, content);
}

export function cleanSnapshots(oldP, newP, isDir) {
  const snaps = store.snapshots;
  if (!snaps) return;
  if (newP) {
    for (const k of Object.keys(snaps)) {
      if (k === oldP || (isDir && k.startsWith(oldP + "/"))) {
        const nk = newP + k.slice(oldP.length);
        snaps[nk] = snaps[k];
        delete snaps[k];
      }
    }
  } else {
    for (const k of Object.keys(snaps)) {
      if (k === oldP || (isDir && k.startsWith(oldP + "/"))) delete snaps[k];
    }
  }
  scheduleSnapshotPersist();
}
