// src/mail/mailbox-query.test.js
// Validation suite for the Mailbox Query Engine.
// Run via ?test=mailbox, or: await (await import("src/mail/mailbox-query.test.js")).runAll();

import { makeSuite, assert, assertEq, assertDeep, makeEnv } from "../test-helpers.js";
import * as mq from "./mailbox-query.js";

const { test, runAll } = makeSuite();
export { runAll };

const MSG = {
  id: "m1", subject: "Hello world", from: { emailAddress: { name: "Alice", address: "alice@contoso.com" } },
  toRecipients: [{ emailAddress: { name: "Bob", address: "bob@contoso.com" } }],
  ccRecipients: [], bccRecipients: [],
  bodyPreview: "Hi there, this is a preview with keyword", body: { contentType: "text", content: "Full body" },
  receivedDateTime: "2026-09-06T10:00:00Z", sentDateTime: "2026-09-06T09:00:00Z",
  importance: "normal", isRead: false, hasAttachments: true, categories: ["work"],
  conversationId: "c1", webLink: "https://outlook.live.com/mail/0/",
};

test("searchEmails: builds sender + date $filter and normalizes messages", async () => {
  const env = makeEnv({ routes: { "/me/mailFolders/inbox/messages": { payload: { value: [MSG], "@odata.count": 1 } } } });
  const res = await mq.searchEmails({ from: "alice@contoso.com", receivedAfter: new Date("2026-09-01T00:00:00Z") });
  const url = env.calls.graph[0].url;
  assert(url.includes("$filter="), "filter present");
  const filter = decodeURIComponent(url.split("$filter=")[1].split("&")[0]);
  assert(/from\/emailAddress\/address eq 'alice@contoso.com'/.test(filter), "sender filter: " + filter);
  assert(/receivedDateTime ge 2026-09-01T00:00:00Z/.test(filter), "date filter: " + filter);
  assert(/receivedDateTime desc/.test(decodeURIComponent(url)), "orderby desc");
  assertEq(res.count, 1);
  const msg = res.value[0];
  assertEq(msg.subject, "Hello world");
  assertEq(msg.from.address, "alice@contoso.com");
  assertEq(msg.to[0].address, "bob@contoso.com");
  assertEq(msg.isRead, false);
  assertEq(msg.hasAttachments, true);
  assertDeep(msg.body, { type: "text", content: "Full body" });
});

test("searchEmails: keyword searches subject OR preview; isRead filter; apostrophe escaping", async () => {
  const env = makeEnv({ routes: { "/me/mailFolders/inbox/messages": { payload: { value: [] } } } });
  await mq.searchEmails({ keyword: "o'brien", isRead: false });
  const filter = decodeURIComponent(env.calls.graph[0].url.split("$filter=")[1].split("&")[0]);
  assert(/contains\(subject, 'o''brien'\) or contains\(bodyPreview, 'o''brien'\)/.test(filter), "keyword + escaping: " + filter);
  assert(/isRead eq false/.test(filter), "isRead filter: " + filter);
});

test("searchEmails: paginates via @odata.nextLink and accumulates", async () => {
  let call = 0;
  const env = makeEnv({ routes: {
    "/me/mailFolders/inbox/messages": () => {
      call++;
      if (call === 1) return { payload: { value: [MSG], "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$skip=1" } };
      return { payload: { value: [{ ...MSG, id: "m2" }] } };
    },
  } });
  const res = await mq.searchEmails({}, { maxPages: 5 });
  assertEq(res.value.length, 2);
  assertEq(res.value[1].id, "m2");
  assertEq(call, 2, "stopped after final page");
});

test("searchEmails: non-inbox folder path resolves", async () => {
  const env = makeEnv({ routes: { "/me/mailFolders/Archive/messages": { payload: { value: [] } } } });
  await mq.searchEmails({ folder: "Archive" });
  assert(/\/me\/mailFolders\/Archive\/messages/.test(env.calls.graph[0].url), "folder path");
});

test("listInbox: defaults to inbox", async () => {
  const env = makeEnv({ routes: { "/me/mailFolders/inbox/messages": { payload: { value: [MSG] } } } });
  const res = await mq.listInbox({ top: 5 });
  assert(/\/me\/mailFolders\/inbox\/messages/.test(env.calls.graph[0].url));
  assert(/top=5/i.test(env.calls.graph[0].url), "top applied");
  assertEq(res.count, 1);
});

test("getMessage: single message by id", async () => {
  const env = makeEnv({ routes: { "/me/messages/m1": { payload: MSG } } });
  const msg = await mq.getMessage("m1");
  assert(/\/me\/messages\/m1/.test(env.calls.graph[0].url));
  assertEq(msg.id, "m1");
  assertEq(msg.conversationId, "c1");
});

test("normalizeMessage: empty message produces safe defaults", () => {
  const m = mq.normalizeMessage({ id: "x" });
  assertEq(m.subject, "");
  assertEq(m.to.length, 0);
  assertEq(m.importance, "normal");
  assertEq(m.isRead, false);
  assertEq(m.categories.length, 0);
  assertEq(mq.normalizeMessage(null), null);
});
