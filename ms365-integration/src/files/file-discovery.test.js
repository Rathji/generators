// src/files/file-discovery.test.js
// Validation suite for the File Discovery Service.
// Run via ?test=files, or: await (await import("src/files/file-discovery.test.js")).runAll();

import { makeSuite, assert, assertEq, assertDeep, makeEnv } from "../test-helpers.js";
import * as fd from "./file-discovery.js";

const { test, runAll } = makeSuite();
export { runAll };

const ITEM = {
  id: "f1", name: "report.pdf", size: 2048,
  folder: null, file: { mimeType: "application/pdf" },
  createdDateTime: "2026-09-01T10:00:00Z", lastModifiedDateTime: "2026-09-05T10:00:00Z",
  webUrl: "https://contoso-my.sharepoint.com/report.pdf",
  parentReference: { id: "root", path: "/drive/root:" },
  "@microsoft.graph.downloadUrl": "https://graph.microsoft.com/download/report.pdf",
};
const FOLDER = {
  id: "d1", name: "Documents", size: 0, folder: { childCount: 3 }, file: null,
  parentReference: { id: "root" }, webUrl: "https://.../Documents",
};

test("listFiles: root children of default drive, normalized", async () => {
  const env = makeEnv({ routes: { "/me/drive/root/children": { payload: { value: [ITEM, FOLDER] } } } });
  const res = await fd.listFiles({});
  const url = env.calls.graph[0].url;
  assert(/\/me\/drive\/root\/children$/.test(url.split("?")[0]), "default drive root: " + url);
  const it = res.value[0];
  assertEq(it.id, "f1");
  assertEq(it.isFile, true);
  assertEq(it.isFolder, false);
  assertEq(it.mimeType, "application/pdf");
  assertEq(it.size, 2048);
  assertEq(it.downloadUrl, "https://graph.microsoft.com/download/report.pdf");
  const fo = res.value[1];
  assertEq(fo.isFolder, true);
  assertEq(fo.childCount, 3);
  assertEq(fo.mimeType, "folder");
});

test("listFiles: folder relative path uses root:/path:/children", async () => {
  const env = makeEnv({ routes: { "/me/drive/root:/Docs/Sub:/children": { payload: { value: [ITEM] } } } });
  await fd.listFiles({ folder: "Docs/Sub" });
  const path = env.calls.graph[0].url.split("?")[0];
  assertEq(path, "https://graph.microsoft.com/v1.0/me/drive/root:/Docs/Sub:/children", "path addressing");
});

test("listFiles: folder item id uses /items/{id}/children", async () => {
  const env = makeEnv({ routes: { "/me/drive/items/00000000-0000-0000-0000-0000000000aa/children": { payload: { value: [] } } } });
  await fd.listFiles({ folder: "00000000-0000-0000-0000-0000000000aa" });
  const path = env.calls.graph[0].url.split("?")[0];
  assert(path.includes("/items/00000000-0000-0000-0000-0000000000aa/children"), "id addressing");
});

test("listFiles: sharepoint site drive + top/skip query", async () => {
  const env = makeEnv({ routes: { "/sites/site123/drive/root/children": { payload: { value: [] } } } });
  await fd.listFiles({ drive: { siteId: "site123" }, top: 10, skip: 5 });
  const url = env.calls.graph[0].url;
  assert(/\/sites\/site123\/drive\/root\/children/.test(url.split("?")[0]));
  assert(/\$top=10/.test(url), "top");
  assert(/\$skip=5/.test(url), "skip");
});

test("searchFiles: search(q='...') with escaping", async () => {
  const env = makeEnv({ routes: { "/me/drive/root/search(q='annual%20report')": { payload: { value: [ITEM] } } } });
  const res = await fd.searchFiles({ query: "annual report" });
  const url = decodeURIComponent(env.calls.graph[0].url);
  assert(/root\/search\(q='annual report'\)/.test(url), "search path");
  assertEq(res.value.length, 1);
});

test("searchFiles: apostrophe in query escaped", async () => {
  const env = makeEnv({ routes: { "/me/drive/root/search(q='o''brien')": { payload: { value: [] } } } });
  await fd.searchFiles({ query: "o'brien" });
  const url = decodeURIComponent(env.calls.graph[0].url);
  assert(/search\(q='o''brien'\)/.test(url), "escaped: " + url);
});

test("getFileMeta: by item id", async () => {
  const env = makeEnv({ routes: { "/me/drive/items/f1": { payload: ITEM } } });
  const it = await fd.getFileMeta({ itemId: "f1" });
  assert(/\/me\/drive\/items\/f1/.test(env.calls.graph[0].url.split("?")[0]));
  assertEq(it.name, "report.pdf");
});

test("getFileByPath: address by path", async () => {
  const env = makeEnv({ routes: { "/me/drive/root:/Docs/report.pdf": { payload: ITEM } } });
  const it = await fd.getFileByPath("Docs/report.pdf");
  assertEq(env.calls.graph[0].url.split("?")[0], "https://graph.microsoft.com/v1.0/me/drive/root:/Docs/report.pdf");
  assertEq(it.id, "f1");
});

test("resolveDrive: all forms", () => {
  assertEq(fd.resolveDrive(), "/me/drive");
  assertEq(fd.resolveDrive("drv1"), "/drives/drv1");
  assertEq(fd.resolveDrive({ siteId: "s" }), "/sites/s/drive");
  assertEq(fd.resolveDrive({ driveId: "d" }), "/drives/d");
  assertEq(fd.resolveDrive({ groupId: "g" }), "/groups/g/drive");
  assertEq(fd.resolveDrive("sharepoint"), "sharepoint");
});

test("normalizeItem: missing fields → safe defaults", () => {
  const it = fd.normalizeItem({ id: "x" });
  assertEq(it.size, 0);
  assertEq(it.isFolder, false);
  assertEq(it.mimeType, null);
  assertEq(it.downloadUrl, null);
  assertEq(fd.normalizeItem(null), null);
});
