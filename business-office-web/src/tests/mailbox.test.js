// ============================================================================
//  VALIDATION TESTS — T15 Mailbox Engine
//
//  `runMailTests()` returns [{name, pass, error?}, ...]. Run in the page:
//    const m = await import("./src/tests/mailbox.test.js");
//    await m.runMailTests()
//
//  Pure tests cover the Mailbox model in src/mailbox.js (folders, unread
//  counts, threading, search, read/star/move, drafts, send, reply/forward,
//  contacts and persistence). DOM-backed tests drive the live Mail surface:
//  folders render, opening a thread marks it read, search filters the list,
//  compose → send lands in Sent, reply prefills "Re:", and stars toggle.
// ============================================================================

import { Mailbox, mailbox, parseAddress, formatAddress, normalizeSubject } from "../mailbox.js";
import { documentRegistry } from "../registry.js";
import { windowManager } from "../windows.js";

function memStore() {
  const m = new Map();
  return { get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => m.set(k, v) };
}

export async function runMailTests() {
  const results = [];
  const t = async (name, fn) => {
    try {
      await fn();
      results.push({ name, pass: true });
    } catch (e) {
      results.push({ name, pass: false, error: e && e.message ? e.message : String(e) });
    }
  };

  // ── Pure: helpers ───────────────────────────────────────────────────────
  await t("parseAddress handles objects, names and bare addresses", () => {
    const a = parseAddress({ name: "Dana", email: "dana@x.com" });
    if (a.name !== "Dana" || a.email !== "dana@x.com") throw new Error("object form");
    const b = parseAddress("Dana Whitfield <dana@x.com>");
    if (b.name !== "Dana Whitfield" || b.email !== "dana@x.com") throw new Error("name form: " + JSON.stringify(b));
    const c = parseAddress("dana@x.com");
    if (c.name !== "" || c.email !== "dana@x.com") throw new Error("bare form");
    const d = parseAddress("");
    if (d.email !== "") throw new Error("empty form");
  });

  await t("formatAddress renders a display string", () => {
    if (formatAddress({ name: "Dana", email: "dana@x.com" }) !== "Dana <dana@x.com>") throw new Error("named");
    if (formatAddress({ name: "", email: "dana@x.com" }) !== "dana@x.com") throw new Error("bare");
  });

  await t("normalizeSubject strips reply/forward prefixes", () => {
    const cases = { "Re: Hello": "hello", "RE:Fwd: Hello": "hello", "Fwd: Re: Hi there": "hi there", "  Hello  ": "hello" };
    for (const [input, want] of Object.entries(cases)) {
      if (normalizeSubject(input) !== want) throw new Error(input + " -> " + normalizeSubject(input));
    }
  });

  // ── Pure: folders, unread, list, search ─────────────────────────────────
  await t("a fresh mailbox is seeded with messages across folders", () => {
    const mb = new Mailbox({ store: memStore() });
    if (mb.count() < 6) throw new Error("too few seed messages: " + mb.count());
    const stats = mb.folderStats();
    if (stats.inbox.total < 3) throw new Error("inbox empty");
    if (stats.sent.total < 1) throw new Error("no sent seed");
    if (stats.drafts.total < 1) throw new Error("no draft seed");
    if (stats.inbox.unread < 1) throw new Error("expected unread seed");
  });

  await t("list() filters by folder, unread, starred and search query", () => {
    const mb = new Mailbox({ store: memStore() });
    const inbox = mb.list({ folder: "inbox" });
    if (!inbox.length) throw new Error("no inbox");
    if (inbox.some((m) => m.folder !== "inbox")) throw new Error("folder leak");
    if (inbox.some((m) => !(m.date <= inbox[0].date))) throw new Error("not sorted newest-first");
    const unread = mb.list({ folder: "inbox", filter: "unread" });
    if (unread.some((m) => m.read)) throw new Error("unread filter leaked read mail");
    const q = mb.list({ folder: "inbox", q: "headcount" });
    if (q.length !== 1) throw new Error("search 'headcount' -> " + q.length);
    if (mb.list({ folder: "inbox", q: "zzznope" }).length !== 0) throw new Error("search should miss");
  });

  await t("threads() groups a conversation by stripped subject", () => {
    const mb = new Mailbox({ store: memStore() });
    const threads = mb.threads({ folder: "inbox" });
    const q3 = threads.find((th) => /q3 business review/i.test(th.latest.subject));
    if (!q3) throw new Error("Q3 thread not found");
    if (q3.count < 3) throw new Error("expected 3 messages in Q3 thread, got " + q3.count);
    if (!q3.messages.every((m) => m.threadId === q3.threadId)) throw new Error("thread id mismatch");
    for (let i = 1; i < q3.messages.length; i++) {
      if (q3.messages[i].date < q3.messages[i - 1].date) throw new Error("thread not oldest-first");
    }
  });

  await t("markThreadRead / markRead / toggleStar / move / remove behave", () => {
    const mb = new Mailbox({ store: memStore() });
    const q3 = mb.threads({ folder: "inbox" }).find((th) => /q3 business review/i.test(th.latest.subject));
    if (mb.unreadCount("inbox") < 1) throw new Error("precondition: expected unread");
    mb.markThreadRead(q3.threadId, true);
    if (q3.messages.some((m) => !mb.get(m.id).read)) throw new Error("thread not read");
    const one = mb.list({ folder: "inbox" })[0];
    mb.markRead(one.id, false);
    if (mb.get(one.id).read) throw new Error("markRead(false) failed");
    const before = mb.get(one.id).starred;
    mb.toggleStar(one.id);
    if (mb.get(one.id).starred === before) throw new Error("star did not toggle");
    mb.move(one.id, "archive");
    if (mb.get(one.id).folder !== "archive") throw new Error("move failed");
    const n = mb.count();
    mb.remove(one.id);
    if (mb.count() !== n - 1 || mb.get(one.id)) throw new Error("remove failed");
  });

  await t("emptyTrash removes only trashed messages", () => {
    const mb = new Mailbox({ store: memStore() });
    const trashed = mb.list({ folder: "trash" });
    if (!trashed.length) throw new Error("expected a trashed seed");
    const before = mb.count();
    const removed = mb.emptyTrash();
    if (removed !== trashed.length) throw new Error("removed " + removed + " != " + trashed.length);
    if (mb.count() !== before - trashed.length) throw new Error("count wrong");
    if (mb.list({ folder: "trash" }).length !== 0) throw new Error("trash not empty");
  });

  // ── Pure: compose flows ─────────────────────────────────────────────────
  await t("saveDraft creates then updates a single draft", () => {
    const mb = new Mailbox({ store: memStore() });
    const d1 = mb.saveDraft({ to: [{ name: "Jo", email: "jo@x.com" }], subject: "Hi", body: "one" });
    if (!d1 || d1.folder !== "drafts") throw new Error("draft not created");
    const d2 = mb.saveDraft({ id: d1.id, subject: "Hi there", body: "two" });
    if (d2.id !== d1.id) throw new Error("draft should update in place");
    if (mb.get(d1.id).body !== "two" || mb.get(d1.id).subject !== "Hi there") throw new Error("draft not updated");
  });

  await t("send() files the message in Sent and consumes its draft", () => {
    const mb = new Mailbox({ store: memStore() });
    const d = mb.saveDraft({ to: [{ email: "jo@x.com" }], subject: "Ping", body: "draft body" });
    const sent = mb.send({ id: d.id, to: [{ name: "Jo", email: "jo@x.com" }], subject: "Ping", body: "final body" });
    if (sent.folder !== "sent") throw new Error("not in sent");
    if (sent.from.email !== mb.self.email) throw new Error("from not self");
    if (!sent.read) throw new Error("sent should be read");
    if (mb.get(d.id)) throw new Error("draft should be gone after send");
    if (!mb.list({ folder: "sent" }).some((m) => m.id === sent.id)) throw new Error("sent not listed");
  });

  await t("buildReply prefills recipients, subject and a quote", () => {
    const mb = new Mailbox({ store: memStore() });
    const orig = mb.list({ folder: "inbox" }).find((m) => m.to.length && m.from.email);
    const r = mb.buildReply(orig.id, { all: false });
    if (!r.to.some((a) => a.email === orig.from.email)) throw new Error("reply to wrong recipient");
    if (!/^\s*re\s*:/i.test(r.subject)) throw new Error("subject not Re: " + r.subject);
    if (!r.body.includes("> ")) throw new Error("quote missing");
    if (r.threadId !== orig.threadId) throw new Error("thread not inherited");
    const all = mb.buildReply(orig.id, { all: true });
    if (all.to.length !== 1) throw new Error("reply-all 'to' should be the sender");
  });

  await t("buildForward prefills Fwd: and the original body", () => {
    const mb = new Mailbox({ store: memStore() });
    const orig = mb.list({ folder: "inbox" })[0];
    const f = mb.buildForward(orig.id);
    if (!/^\s*fwd\s*:/i.test(f.subject)) throw new Error("subject not Fwd: " + f.subject);
    if (!f.body.includes("Forwarded message")) throw new Error("header missing");
    if (f.threadId) throw new Error("forward should start a new thread");
  });

  await t("listContacts derives the address book, most frequent first", () => {
    const mb = new Mailbox({ store: memStore() });
    const contacts = mb.listContacts();
    const dana = contacts.find((c) => c.email.toLowerCase() === "dana.whitfield@northwind.example");
    if (!dana) throw new Error("Dana missing");
    if (dana.count < 2) throw new Error("Dana count " + dana.count);
    if (contacts.some((c) => c.email.toLowerCase() === mb.self.email.toLowerCase())) throw new Error("self leaked");
    if (contacts.some((c) => c.email.toLowerCase() === "it@perchance.office") && !contacts.find((c) => c.email.toLowerCase() === "it@perchance.office").name) {
      throw new Error("sender name not captured");
    }
    for (let i = 1; i < contacts.length; i++) {
      if (contacts[i].count > contacts[i - 1].count) throw new Error("not sorted by frequency");
    }
  });

  // ── Pure: persistence ───────────────────────────────────────────────────
  await t("the mailbox survives a fresh instance restored from the same store", () => {
    const store = memStore();
    const mb1 = new Mailbox({ store });
    const n = mb1.count();
    const target = mb1.list({ folder: "inbox" })[0];
    mb1.markRead(target.id, true);
    mb1.toggleStar(target.id);
    const mb2 = new Mailbox({ store });
    if (mb2.count() !== n) throw new Error("restore lost messages: " + mb2.count() + " != " + n);
    const got = mb2.get(target.id);
    if (!got || !got.read || !got.starred) throw new Error("flags not restored");
  });

  await t("toJSON/load round-trips the whole mailbox", () => {
    const mb = new Mailbox({ store: memStore() });
    const json = mb.toJSON();
    const copy = new Mailbox({ store: memStore() }).load(JSON.parse(JSON.stringify(json)));
    if (copy.count() !== mb.count()) throw new Error("count mismatch");
    const ids = mb.list().map((m) => m.id).sort().join(",");
    const ids2 = copy.list().map((m) => m.id).sort().join(",");
    if (ids !== ids2) throw new Error("ids mismatch");
  });

  // ── DOM: the Mail surface (page only) ───────────────────────────────────
  let domOk = true;
  try {
    domOk = typeof document !== "undefined" && !!document.createElement;
  } catch {
    domOk = false;
  }

  if (!domOk) return results;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const snapshot = JSON.parse(JSON.stringify(mailbox.toJSON()));
  const winsBefore = windowManager.list().map((w) => w.id);
  // Discard uses a native confirm() — stub it so automated clicks never block the page.
  const origConfirm = window.confirm;
  window.confirm = () => true;
  const q = (sel) => document.querySelector(".desk-win.active .mail-app " + sel);
  const qa = (sel) => [...document.querySelectorAll(".desk-win.active .mail-app " + sel)];

  const openMail = async () => {
    location.hash = "#/app/mail";
    for (let i = 0; i < 60; i++) {
      const el = document.querySelector(".desk-win.active .mail-app");
      if (el && el.querySelector(".mail-list")) return el;
      await sleep(100);
    }
    throw new Error("Mail surface did not mount");
  };
  const click = (el) => el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  const type = (el, value) => {
    el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };

  try {
    mailbox.reset();
    await openMail();

    await t("the folder rail renders with an inbox unread badge", async () => {
      await openMail();
      mailbox.reset();
      await sleep(60);
      const folders = qa(".mail-folder");
      if (folders.length < 6) throw new Error("folders: " + folders.length);
      const inbox = qa('.mail-folder[data-folder="inbox"]')[0];
      if (!inbox.classList.contains("active")) throw new Error("inbox not active by default");
      const badge = inbox.querySelector(".mf-count").textContent.trim();
      if (Number(badge) !== mailbox.unreadCount("inbox")) throw new Error("badge " + badge + " != " + mailbox.unreadCount("inbox"));
      if (!qa(".mail-thread").length) throw new Error("no threads listed");
    });

    await t("opening a thread renders it and clears its unread state", async () => {
      await openMail();
      mailbox.reset();
      await sleep(60);
      const unreadBefore = mailbox.unreadCount("inbox");
      if (unreadBefore < 1) throw new Error("precondition: no unread");
      const row = qa(".mail-thread.unread")[0];
      if (!row) throw new Error("no unread row");
      click(row);
      const subject = q(".mr-subject").textContent.trim();
      if (!subject) throw new Error("reading pane empty");
      if (q(".mail-empty").hidden === false) throw new Error("empty state still visible");
      if (mailbox.unreadCount("inbox") !== 0) throw new Error("unread not cleared: " + mailbox.unreadCount("inbox"));
      if (!q(".mr-msg-body")) throw new Error("message body not rendered");
    });

    await t("search filters the visible conversations", async () => {
      await openMail();
      mailbox.reset();
      await sleep(60);
      const before = qa(".mail-thread").length;
      type(q(".mail-search-input"), "headcount");
      const after = qa(".mail-thread").length;
      if (after !== 1) throw new Error("search -> " + after + " threads (was " + before + ")");
      if (!/q3 business review/i.test(qa(".mail-thread .mt-subject")[0].textContent)) throw new Error("wrong thread surfaced");
      type(q(".mail-search-input"), "zzznope");
      if (qa(".mail-thread").length !== 0) throw new Error("no-match search still lists threads");
      click(q(".mail-search-clear"));
      if (qa(".mail-thread").length !== before) throw new Error("clear did not restore list");
    });

    await t("compose → send files the message in Sent", async () => {
      await openMail();
      mailbox.reset();
      await sleep(60);
      click(q(".mail-compose-new"));
      if (q(".mail-compose").hidden !== false) throw new Error("compose pane not shown");
      type(q(".mc-to"), "client@acme.example");
      type(q(".mc-subject"), "A brand new subject");
      const body = q(".mc-body");
      body.textContent = "Hello from the test.";
      body.dispatchEvent(new Event("input", { bubbles: true }));
      click(q(".mc-send"));
      const found = mailbox.list({ folder: "sent" }).find((m) => m.subject === "A brand new subject");
      if (!found) throw new Error("message not in Sent");
      if (found.body.indexOf("Hello from the test") === -1) throw new Error("body not stored: " + found.body);
      if (!found.to.some((a) => a.email === "client@acme.example")) throw new Error("recipient not stored");
      // Editable state: the Sent folder now lists it.
      if (q(".mail-compose").hidden !== true) throw new Error("compose should have closed");
    });

    await t("draft auto-saves while composing", async () => {
      await openMail();
      mailbox.reset();
      await sleep(60);
      click(q(".mail-compose-new"));
      type(q(".mc-to"), "drafty@example.com");
      type(q(".mc-subject"), "Half-written");
      const before = mailbox.list({ folder: "drafts" }).length;
      await sleep(750); // let the debounced autosave fire
      const after = mailbox.list({ folder: "drafts" }).length;
      if (after !== before + 1) throw new Error("draft not auto-saved (" + before + " -> " + after + ")");
      const d = mailbox.list({ folder: "drafts" }).find((m) => m.subject === "Half-written");
      if (!d) throw new Error("auto-saved draft missing");
      click(q('.mc-discard'));
    });

    await t("reply prefills Re: and the sender", async () => {
      await openMail();
      mailbox.reset();
      await sleep(60);
      click(qa(".mail-thread")[0]);
      const fromBefore = mailbox.get(mailbox.list({ folder: "inbox" })[0].id).from.email;
      click(q('.mr-act[data-act="reply"]'));
      if (q(".mail-compose").hidden !== false) throw new Error("reply did not open compose");
      const subject = q(".mc-subject").value;
      if (!/^\s*re\s*:/i.test(subject)) throw new Error("subject not Re: " + subject);
      const to = q(".mc-to").value;
      if (!to) throw new Error("reply has no recipient");
      if (to.indexOf("@") === -1) throw new Error("recipient not an address: " + to);
      click(q('.mc-discard'));
    });

    await t("starring from the list updates the message", async () => {
      await openMail();
      mailbox.reset();
      await sleep(60);
      const starBtn = qa(".mt-star").find((b) => !b.classList.contains("on"));
      if (!starBtn) throw new Error("no unstarred row");
      const id = starBtn.dataset.star;
      const before = mailbox.get(id).starred;
      click(starBtn);
      if (mailbox.get(id).starred === before) throw new Error("star did not toggle");
      const row = document.querySelector('.desk-win.active .mail-app .mt-star[data-star="' + CSS.escape(id) + '"]');
      if (!row.classList.contains("on")) throw new Error("star button not marked");
    });

    await t("the Contacts folder lists people from the mailbox", async () => {
      await openMail();
      mailbox.reset();
      await sleep(60);
      click(q('.mail-folder[data-folder="contacts"]'));
      const rows = qa(".mail-contact");
      if (!rows.length) throw new Error("no contacts listed");
      if (!rows.some((r) => /dana/i.test(r.textContent))) throw new Error("Dana missing from contacts");
      // Clicking a contact opens a preaddressed compose.
      click(rows[0]);
      if (q(".mail-compose").hidden !== false) throw new Error("contact click did not open compose");
      if (!q(".mc-to").value) throw new Error("compose not preaddressed");
    });
  } finally {
    mailbox.load(snapshot);
    for (const id of windowManager.list().map((w) => w.id)) {
      if (!winsBefore.includes(id)) windowManager.close(id);
    }
    for (const doc of documentRegistry.listByApp("mail")) {
      if (!windowManager.list().some((w) => w.docId === doc.id)) documentRegistry.remove(doc.id);
    }
  }

  return results;
}
