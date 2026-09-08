// src/mail/email-dispatcher.test.js
// Validation suite for the Email Dispatcher.
// Run via ?test=email, or: await (await import("src/mail/email-dispatcher.test.js")).runAll();

import { makeSuite, assert, assertEq, makeEnv } from "../test-helpers.js";
import * as ed from "./email-dispatcher.js";

const { test, runAll } = makeSuite();
export { runAll };

test("sendEmail: POSTs to /me/sendMail with full recipient set + text body", async () => {
  const env = makeEnv({ routes: { "/me/sendMail": { payload: {} } } });
  await ed.sendEmail({
    to: ["a@contoso.com", { name: "Bob", address: "bob@contoso.com" }],
    cc: "cc@contoso.com",
    bcc: "bcc@contoso.com",
    subject: "Hello",
    body: "Plain body",
  });
  const call = env.calls.graph[0];
  assert(/\/me\/sendMail$/.test(call.url), "correct endpoint");
  const body = JSON.parse(call.init.body);
  assertEq(body.message.subject, "Hello");
  assertEq(body.message.toRecipients.length, 2);
  assertEq(body.message.toRecipients[1].emailAddress.name, "Bob");
  assertEq(body.message.ccRecipients[0].emailAddress.address, "cc@contoso.com");
  assertEq(body.message.bccRecipients[0].emailAddress.address, "bcc@contoso.com");
  assertDeepBody(body.message.body, "Plain body");
  assertEq(body.saveToSentItems, true, "defaults to save to sent items");
});

test("sendEmail: HTML body uses contentType html; saveToSentItems false honored", async () => {
  const env = makeEnv({ routes: { "/me/sendMail": { payload: {} } } });
  await ed.sendEmail({ to: "a@c.com", html: "<b>Hi</b>", saveToSentItems: false });
  const body = JSON.parse(env.calls.graph[0].init.body);
  assertDeepBody(body.message.body, "<b>Hi</b>", "html");
  assertEq(body.saveToSentItems, false);
});

test("sendEmail: importance and from are passed through", async () => {
  const env = makeEnv({ routes: { "/me/sendMail": { payload: {} } } });
  await ed.sendEmail({ to: "a@c.com", importance: "high", from: "boss@contoso.com" });
  const body = JSON.parse(env.calls.graph[0].init.body);
  assertEq(body.message.importance, "high");
  assertEq(body.message.from.emailAddress.address, "boss@contoso.com");
});

test("sendEmail: attachment becomes fileAttachment with base64 contentBytes", async () => {
  const env = makeEnv({ routes: { "/me/sendMail": { payload: {} } } });
  await ed.sendEmail({
    to: "a@c.com",
    subject: "file",
    attachments: [{ name: "notes.txt", mimeType: "text/plain", content: new TextEncoder().encode("hello") }],
  });
  const body = JSON.parse(env.calls.graph[0].init.body);
  const att = body.message.attachments[0];
  assertEq(att["@odata.type"], "#microsoft.graph.fileAttachment");
  assertEq(att.name, "notes.txt");
  assertEq(att.contentType, "text/plain");
  assertEq(att.contentBytes, btoa("hello"), "base64 content");
  assertEq(att.isInline, false);
});

test("sendEmail: contentBytes (already base64) passed through untouched", async () => {
  const env = makeEnv({ routes: { "/me/sendMail": { payload: {} } } });
  await ed.sendEmail({ to: "a@c.com", attachments: [{ name: "x.bin", contentBytes: "QUJDRA==" }] });
  const body = JSON.parse(env.calls.graph[0].init.body);
  assertEq(body.message.attachments[0].contentBytes, "QUJDRA==");
});

test("createDraft: POSTs to /me/messages and returns created message", async () => {
  const env = makeEnv({ routes: { "/me/messages": { payload: { id: "draft-1", subject: "Draft" } } } });
  const res = await ed.createDraft({ subject: "Draft", body: "draft body", to: "a@c.com" });
  assert(/\/me\/messages$/.test(env.calls.graph[0].url), "endpoint");
  assertEq(res.id, "draft-1");
  assertEq(JSON.parse(env.calls.graph[0].init.body).toRecipients[0].emailAddress.address, "a@c.com");
});

test("sendDraft: POSTs to /me/messages/{id}/send", async () => {
  const env = makeEnv({ routes: { "/me/messages/draft-1/send": { payload: {} } } });
  const res = await ed.sendDraft("draft-1");
  assert(/\/me\/messages\/draft-1\/send$/.test(env.calls.graph[0].url), "endpoint");
  assertEq(res.ok, true);
});

test("encodeBase64: encodes bytes chunk-safely and matches reference", async () => {
  const big = new Uint8Array(200000).fill(65);
  const b64 = ed.encodeBase64(big);
  assert(b64.length > 0, "encoded");
  const back = atob(b64);
  assertEq(back[0], "A");
  assertEq(back[199999], "A");
  assertEq(ed.encodeBase64(new TextEncoder().encode("héllo")), btoa(unescape(encodeURIComponent("héllo"))), "utf8 encoded via TextEncoder");
});

test("toAddress: string, object and emailAddress forms normalize", () => {
  assertDeepAddr(ed.toAddress("a@b.com"), "a@b.com", "");
  assertDeepAddr(ed.toAddress({ name: "N", address: "a@b.com" }), "a@b.com", "N");
  assertDeepAddr(ed.toAddress({ emailAddress: { name: "E", address: "x@y.z" } }), "x@y.z", "E");
});

function assertDeepBody(b, content, contentType) {
  assertEq(b.content, content);
  if (contentType) assertEq(b.contentType, contentType);
}
function assertDeepAddr(a, address, name) {
  assertEq(a.address, address);
  assertEq(a.name, name);
}
