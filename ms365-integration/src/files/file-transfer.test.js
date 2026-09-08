// src/files/file-transfer.test.js
// Validation suite for the File Upload/Download Streamer.
// Run via ?test=file-transfer, or: await (await import("src/files/file-transfer.test.js")).runAll();

import { makeSuite, assert, assertEq, makeEnv } from "../test-helpers.js";
import * as ft from "./file-transfer.js";
import * as fd from "./file-discovery.js";

const { test, runAll } = makeSuite();
export { runAll };

const ITEM = {
  id: "f1", name: "report.pdf", size: 2048,
  folder: null, file: { mimeType: "application/pdf" },
  createdDateTime: "2026-09-01T10:00:00Z", lastModifiedDateTime: "2026-09-05T10:00:00Z",
  webUrl: "https://contoso-my.sharepoint.com/report.pdf",
  parentReference: { id: "root" },
};

test("uploadFile: simple PUT to /root:/name:/content with raw bytes + Content-Type", async () => {
  const env = makeEnv({ routes: { "/me/drive/root:/report.pdf:/content": { payload: ITEM } } });
  const bytes = new TextEncoder().encode("PDFDATA");
  const res = await ft.uploadFile({ name: "report.pdf", data: bytes, mimeType: "application/pdf" });
  const call = env.calls.graph[0];
  assertEq(call.init.method, "PUT");
  const path = call.url.split("?")[0];
  assertEq(path, "https://graph.microsoft.com/v1.0/me/drive/root:/report.pdf:/content", "content endpoint");
  assertEq(call.init.body, bytes, "raw bytes body");
  assertEq(call.init.headers["Content-Type"], "application/pdf");
  assertEq(res.id, "f1");
  assertEq(res.name, "report.pdf");
});

test("uploadFile: folder path addressing + conflictBehavior query", async () => {
  const env = makeEnv({ routes: { "/me/drive/root:/Docs/Sub/notes.txt:/content": { payload: { id: "f2", name: "notes.txt", size: 5, file: { mimeType: "text/plain" } } } } });
  await ft.uploadFile({ name: "notes.txt", data: "abc", mimeType: "text/plain", folder: "Docs/Sub", conflictBehavior: "replace" });
  const call = env.calls.graph[0];
  assert(call.url.includes("/me/drive/root:/Docs/Sub/notes.txt:/content"), "path: " + call.url);
  assert(call.url.includes("@microsoft.graph.conflictBehavior=replace"), "conflictBehavior: " + call.url);
});

test("uploadFile: large data (> limit) routes through upload session with chunked PUTs", async () => {
  const bytes = new Uint8Array(20).fill(88);
  const env = makeEnv({ routes: {
    "/me/drive/root:/big.bin:/createUploadSession": { payload: { uploadUrl: "https://graph.microsoft.com/v1.0/drives/d1/uploadSessions/sess1" } },
    "/drives/d1/uploadSessions/sess1": { payload: {} },
    "/me/drive/root:/big.bin": { payload: { id: "big1", name: "big.bin", size: 20, file: { mimeType: "application/octet-stream" } } },
  } });
  const res = await ft.uploadFile({ name: "big.bin", data: bytes, maxSimpleBytes: 4, chunkSize: 6 });
  const posts = env.calls.graph.filter((c) => c.init.method === "POST");
  const puts = env.calls.graph.filter((c) => c.init.method === "PUT");
  assertEq(posts.length, 1, "one createUploadSession");
  assert(posts[0].url.includes("createUploadSession"), "session endpoint");
  assertEq(puts.length, 4, "20 bytes / 6 chunk = 4 PUTs");
  assert(/bytes 0-5\/20/.test(puts[0].init.headers["Content-Range"]), "first range");
  assert(/bytes 18-19\/20/.test(puts[3].init.headers["Content-Range"]), "final range");
  assertEq(res.id, "big1");
});

test("downloadFile: returns bytes + mimeType + original name", async () => {
  const env = makeEnv({ routes: {
    "/me/drive/items/f1/content": { payload: "RAWBYTES", headers: { "Content-Type": "application/pdf" } },
  } });
  const dl = await ft.downloadFile({ itemId: "f1", name: "report.pdf" });
  assertEq(dl.name, "report.pdf");
  assertEq(dl.mimeType, "application/pdf");
  assertEq(dl.size, 8);
  assertEq(new TextDecoder().decode(dl.data), "RAWBYTES");
  assertEq(dl.format, null);
  assert(env.calls.graph[0].url.includes("/me/drive/items/f1/content"), "download endpoint");
});

test("downloadFile: with format applies extension swap", async () => {
  const env = makeEnv({ routes: { "/me/drive/items/f1/content": { payload: "PDF", headers: { "Content-Type": "application/pdf" } } } });
  const dl = await ft.downloadFile({ itemId: "f1", name: "report.docx", format: "pdf" });
  assert(dl.urlIncludesFormat = env.calls.graph[0].url.includes("format=pdf"), "format query");
  assertEq(dl.name, "report.pdf", "extension integrity preserved via swap");
  assertEq(dl.format, "pdf");
});

test("applyFormatExtension: stem kept, extension swapped", () => {
  assertEq(ft.applyFormatExtension("report.docx", "pdf"), "report.pdf");
  assertEq(ft.applyFormatExtension("noext", "png"), "noext.png");
  assertEq(ft.applyFormatExtension(null, "pdf"), "download.pdf");
  assertEq(ft.applyFormatExtension("a.b.c.txt", "pdf"), "a.b.c.pdf");
});

test("driveItemPath: folder + name addressing", () => {
  assertEq(ft.driveItemPath(null, "x.txt"), "/x.txt");
  assertEq(ft.driveItemPath("Docs", "x.txt"), "/Docs/x.txt");
  assertEq(ft.driveItemPath("Docs/Sub", "x y.txt"), "/Docs/Sub/x%20y.txt");
  assertEq(ft.driveItemPath("/Docs/", "x.txt"), "/Docs/x.txt", "leading/trailing slashes trimmed");
});

test("uploadFile: missing name/data throws", async () => {
  makeEnv({ routes: {} });
  let threw = false;
  try { await ft.uploadFile({ name: "", data: "x" }); } catch (e) { threw = true; }
  assert(threw, "missing name throws");
  threw = false;
  try { await ft.uploadFile({ name: "x.txt" }); } catch (e) { threw = true; }
  assert(threw, "missing data throws");
});

test("uploadFile: normalizeItem round-trips through file-discovery", async () => {
  const env = makeEnv({ routes: { "/me/drive/root:/f.bin:/content": { payload: ITEM } } });
  const res = await ft.uploadFile({ name: "f.bin", data: new Uint8Array(3) });
  const norm = fd.normalizeItem(ITEM);
  assertEq(res.isFile, norm.isFile);
  assertEq(res.mimeType, "application/pdf");
});
