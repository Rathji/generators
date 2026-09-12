// ============================================================================
//  MAILBOX ENGINE  (T15)
//
//  The data model behind the Mail app: a store of messages organised into
//  folders (Inbox / Drafts / Sent / Archive / Trash), grouped into conversation
//  threads, searchable, and backed by a StateStore so the mailbox survives
//  reloads. Messages carry a Markdown body (see src/richtext.js), a parsed
//  address list, read/starred flags and labels. All of it is app-owned and
//  stored opaquely in JSON, so a mailbox can also be saved to a file (T13/T14).
//
//  Threading: every message has a `threadId`. On insert it defaults to the
//  subject with reply/forward prefixes stripped (see normalizeSubject), so a
//  "Re: Q3 review" lands in the "Q3 review" conversation automatically; replies
//  built by buildReply() carry the parent's thread id explicitly.
//
//  Pure module — no DOM. Events: mailbox.on(fn) -> fn({ type, ... }) returns an
//  unsubscribe function.
// ============================================================================

import { StateStore } from "./state.js";

export const FOLDERS = [
  { id: "inbox", name: "Inbox" },
  { id: "drafts", name: "Drafts" },
  { id: "sent", name: "Sent" },
  { id: "archive", name: "Archive" },
  { id: "trash", name: "Trash" },
];

const FOLDER_IDS = FOLDERS.map((f) => f.id);

let idCounter = 0;

function generateId(prefix) {
  const uuid =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : null;
  return (
    uuid ||
    prefix + "_" + Date.now().toString(36) + "_" + ++idCounter + "_" + Math.random().toString(36).slice(2, 8)
  );
}

/** "Bob Smith <bob@x.com>", "bob@x.com" or an address object -> { name, email }. */
export function parseAddress(input) {
  if (input && typeof input === "object") {
    return { name: String(input.name || "").trim(), email: String(input.email || "").trim() };
  }
  const s = String(input == null ? "" : input).trim();
  const m = s.match(/^(.*?)\s*<\s*([^>]+)\s*>\s*$/);
  if (m) {
    const email = m[2].trim();
    const name = m[1].replace(/^"|"$/g, "").trim();
    return { name: name || email, email };
  }
  return { name: "", email: s };
}

export function formatAddress(input) {
  const a = parseAddress(input);
  if (a.name && a.email && a.name !== a.email) return a.name + " <" + a.email + ">";
  return a.email || a.name;
}

export function formatAddressList(list) {
  return (list || []).map(formatAddress).join(", ");
}

/** Strip leading Re:/Fwd:/Fw:/Aw:/Sv: prefixes, lower-cased — the thread key. */
export function normalizeSubject(subject) {
  let t = String(subject == null ? "" : subject).trim();
  let prev;
  do {
    prev = t;
    t = t.replace(/^\s*(re|fwd?|fw|aw|sv)\s*:\s*/i, "").trim();
  } while (t !== prev);
  return t.toLowerCase();
}

function threadIdFor(message) {
  return message.threadId || normalizeSubject(message.subject) || "thread:" + message.id;
}

/** A message with every field coerced to its canonical shape. */
export function makeMessage(fields = {}) {
  const folder = FOLDER_IDS.includes(fields.folder) ? fields.folder : "inbox";
  const subject = String(fields.subject == null ? "" : fields.subject);
  const message = {
    id: fields.id || generateId("msg"),
    folder,
    from: parseAddress(fields.from),
    to: (fields.to || []).map(parseAddress),
    cc: (fields.cc || []).map(parseAddress),
    subject,
    body: fields.body == null ? "" : String(fields.body),
    date: typeof fields.date === "number" ? fields.date : Date.now(),
    read: fields.read !== undefined ? !!fields.read : folder === "sent" || folder === "drafts",
    starred: !!fields.starred,
    labels: Array.isArray(fields.labels) ? fields.labels.slice() : [],
    attachments: Array.isArray(fields.attachments)
      ? fields.attachments.map((a) => ({ name: String(a.name || "attachment"), size: Number(a.size) || 0, type: String(a.type || "") }))
      : [],
    inReplyTo: fields.inReplyTo || null,
    threadId: "",
  };
  message.threadId = fields.threadId || normalizeSubject(subject) || "thread:" + message.id;
  return message;
}

function sanitizeMessage(raw) {
  if (!raw || typeof raw !== "object") return null;
  const m = makeMessage(raw);
  m.id = String(raw.id || m.id);
  m.threadId = String(raw.threadId || m.threadId);
  return m;
}

function matchesQuery(message, q) {
  const hay = [
    message.subject,
    message.from.name,
    message.from.email,
    message.labels.join(" "),
    message.body,
    ...message.to.map((a) => a.name + " " + a.email),
    ...message.cc.map((a) => a.name + " " + a.email),
  ]
    .join("\n")
    .toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => hay.includes(term));
}

export class Mailbox {
  /**
   * @param {{store?: {get: Function, set: Function}, self?: {name,email}}} [opts]
   */
  constructor(opts = {}) {
    this.store = opts.store || null;
    this.self = Object.assign({ name: "Alex Rivera", email: "alex@perchance.office" }, opts.self || {});
    this.messages = new Map(); // id -> message (insertion order)
    this.contacts = new Map(); // lowercased email -> { name, email }
    this.listeners = new Set();
    this.seeded = false;
    if (this.store) this._restore();
    if (!this.seeded) this.seedDefault();
  }

  // ── Persistence ─────────────────────────────────────────────────────────
  _persist() {
    if (!this.store) return;
    this.store.set("state", {
      self: this.self,
      contacts: [...this.contacts.values()],
      messages: [...this.messages.values()],
      seeded: true,
    });
  }

  _restore() {
    const s = this.store.get("state");
    if (!s || !Array.isArray(s.messages)) return;
    for (const raw of s.messages) {
      const m = sanitizeMessage(raw);
      if (m && !this.messages.has(m.id)) this.messages.set(m.id, m);
    }
    if (Array.isArray(s.contacts)) {
      for (const c of s.contacts) {
        const email = String((c && c.email) || "").trim();
        if (email) this.contacts.set(email.toLowerCase(), { name: String(c.name || ""), email });
      }
    }
    if (s.self && typeof s.self === "object") this.self = Object.assign({}, this.self, s.self);
    this.seeded = !!s.seeded;
  }

  _emit(type, extra) {
    for (const fn of this.listeners) {
      try {
        fn(Object.assign({ type, mailbox: this }, extra || {}));
      } catch {
        /* a listener must not break the mailbox */
      }
    }
  }

  _nextId() {
    let id;
    do {
      id = generateId("msg");
    } while (this.messages.has(id));
    return id;
  }

  _insert(message) {
    const m = makeMessage(message);
    m.id = this.messages.has(m.id) ? this._nextId() : m.id;
    m.threadId = threadIdFor(m);
    this.messages.set(m.id, m);
    this._persist();
    this._emit("insert", { message: m });
    return m;
  }

  toJSON() {
    return { self: this.self, contacts: [...this.contacts.values()], messages: [...this.messages.values()] };
  }

  load(data) {
    this.messages.clear();
    this.contacts.clear();
    if (data && typeof data === "object") {
      if (Array.isArray(data.messages)) {
        for (const raw of data.messages) {
          const m = sanitizeMessage(raw);
          if (m) this.messages.set(m.id, m);
        }
      }
      if (Array.isArray(data.contacts)) {
        for (const c of data.contacts) {
          const email = String((c && c.email) || "").trim();
          if (email) this.contacts.set(email.toLowerCase(), { name: String(c.name || ""), email });
        }
      }
      if (data.self) this.self = Object.assign({}, this.self, data.self);
    }
    this.seeded = true;
    this._persist();
    this._emit("reset", {});
    return this;
  }

  /** Wipe the mailbox and refill it with the starter messages. */
  reset() {
    this.messages.clear();
    this.contacts.clear();
    this.seeded = false;
    this.seedDefault();
    return this;
  }

  // ── Reads ───────────────────────────────────────────────────────────────
  get(id) {
    return this.messages.get(id) || null;
  }

  count() {
    return this.messages.size;
  }

  /**
   * Messages, newest first. Options: { folder, q, filter, starred }.
   * `filter` is "all" | "unread" | "starred".
   */
  list(opts = {}) {
    let arr = [...this.messages.values()];
    if (opts.folder) arr = arr.filter((m) => m.folder === opts.folder);
    if (opts.filter === "unread") arr = arr.filter((m) => !m.read);
    else if (opts.filter === "starred") arr = arr.filter((m) => m.starred);
    if (opts.starred) arr = arr.filter((m) => m.starred);
    if (opts.q) arr = arr.filter((m) => matchesQuery(m, opts.q));
    return arr.sort((a, b) => b.date - a.date);
  }

  /** All messages in a conversation, oldest first. */
  threadMessages(threadId) {
    return [...this.messages.values()]
      .filter((m) => m.threadId === threadId)
      .sort((a, b) => a.date - b.date);
  }

  /**
   * Conversation threads, newest first. A thread is included when any of its
   * messages matches the folder/search/filter, but the thread object carries
   * every non-trash message of that conversation so the reader shows the whole
   * back-and-forth.
   */
  threads(opts = {}) {
    const matched = this.list(opts);
    const seen = new Map();
    for (const m of matched) {
      if (!seen.has(m.threadId)) seen.set(m.threadId, true);
    }
    const out = [];
    for (const threadId of seen.keys()) {
      let msgs = [...this.messages.values()].filter((m) => m.threadId === threadId);
      if (opts.folder !== "trash") msgs = msgs.filter((m) => m.folder !== "trash");
      msgs.sort((a, b) => a.date - b.date);
      if (!msgs.length) continue;
      const latest = msgs[msgs.length - 1];
      out.push({
        threadId,
        messages: msgs,
        latest,
        count: msgs.length,
        unread: msgs.filter((m) => !m.read).length,
        starred: msgs.some((m) => m.starred),
        hasAttachments: msgs.some((m) => m.attachments.length > 0),
      });
    }
    return out.sort((a, b) => b.latest.date - a.latest.date);
  }

  /** Per-folder totals + unread counts: { inbox: { total, unread }, ... }. */
  folderStats() {
    const stats = {};
    for (const f of FOLDER_IDS) stats[f] = { total: 0, unread: 0 };
    for (const m of this.messages.values()) {
      const s = stats[m.folder];
      if (!s) continue;
      s.total++;
      if (!m.read) s.unread++;
    }
    return stats;
  }

  unreadCount(folder) {
    return this.list({ folder }).filter((m) => !m.read).length;
  }

  // ── Mutations ───────────────────────────────────────────────────────────
  update(id, patch = {}) {
    const m = this.messages.get(id);
    if (!m) return null;
    if (patch.folder !== undefined && FOLDER_IDS.includes(patch.folder)) m.folder = patch.folder;
    if (patch.from !== undefined) m.from = parseAddress(patch.from);
    if (patch.to !== undefined) m.to = (patch.to || []).map(parseAddress);
    if (patch.cc !== undefined) m.cc = (patch.cc || []).map(parseAddress);
    if (patch.subject !== undefined) m.subject = String(patch.subject);
    if (patch.body !== undefined) m.body = String(patch.body);
    if (patch.read !== undefined) m.read = !!patch.read;
    if (patch.starred !== undefined) m.starred = !!patch.starred;
    if (patch.labels !== undefined) m.labels = Array.isArray(patch.labels) ? patch.labels.slice() : [];
    if (patch.attachments !== undefined) m.attachments = Array.isArray(patch.attachments) ? patch.attachments.slice() : [];
    if (patch.date !== undefined && typeof patch.date === "number") m.date = patch.date;
    m.threadId = patch.threadId || threadIdFor(m);
    this._persist();
    this._emit("update", { message: m });
    return m;
  }

  markRead(id, read = true) {
    const m = this.messages.get(id);
    if (!m || m.read === !!read) return m;
    return this.update(id, { read: !!read });
  }

  markThreadRead(threadId, read = true) {
    let changed = false;
    for (const m of this.messages.values()) {
      if (m.threadId === threadId && m.read !== !!read) {
        m.read = !!read;
        changed = true;
      }
    }
    if (changed) {
      this._persist();
      this._emit("update", { threadId });
    }
    return changed;
  }

  toggleStar(id) {
    const m = this.messages.get(id);
    if (!m) return null;
    return this.update(id, { starred: !m.starred });
  }

  move(id, folder) {
    const m = this.messages.get(id);
    if (!m || !FOLDER_IDS.includes(folder)) return null;
    return this.update(id, { folder });
  }

  moveThread(threadId, folder) {
    if (!FOLDER_IDS.includes(folder)) return false;
    let changed = false;
    for (const m of this.messages.values()) {
      if (m.threadId === threadId && m.folder !== folder) {
        m.folder = folder;
        changed = true;
      }
    }
    if (changed) {
      this._persist();
      this._emit("update", { threadId });
    }
    return changed;
  }

  remove(id) {
    const m = this.messages.get(id);
    if (!m) return false;
    this.messages.delete(id);
    this._persist();
    this._emit("remove", { message: m });
    return true;
  }

  /** Permanently delete every message in a thread. Returns how many went. */
  removeThread(threadId) {
    let n = 0;
    for (const id of [...this.messages.keys()]) {
      if (this.messages.get(id).threadId === threadId) {
        this.messages.delete(id);
        n++;
      }
    }
    if (n) {
      this._persist();
      this._emit("remove", { threadId });
    }
    return n;
  }

  emptyTrash() {
    let n = 0;
    for (const id of [...this.messages.keys()]) {
      if (this.messages.get(id).folder === "trash") {
        this.messages.delete(id);
        n++;
      }
    }
    if (n) {
      this._persist();
      this._emit("remove", { folder: "trash" });
    }
    return n;
  }

  // ── Compose flows ───────────────────────────────────────────────────────
  /** Create or update a draft. Returns the draft message. */
  saveDraft(fields = {}) {
    const existing = fields.id ? this.messages.get(fields.id) : null;
    if (existing && existing.folder === "drafts") {
      return this.update(existing.id, {
        to: fields.to || [],
        cc: fields.cc || [],
        subject: fields.subject != null ? fields.subject : existing.subject,
        body: fields.body != null ? fields.body : existing.body,
        attachments: fields.attachments,
      });
    }
    return this._insert(makeMessage({
      folder: "drafts",
      from: this.self,
      to: fields.to || [],
      cc: fields.cc || [],
      subject: fields.subject || "",
      body: fields.body || "",
      attachments: fields.attachments || [],
      read: true,
    }));
  }

  /** Send a message: drop the draft it came from, file it in Sent. */
  send(fields = {}) {
    const draft = fields.id ? this.messages.get(fields.id) : null;
    if (draft && draft.folder === "drafts") this.messages.delete(draft.id);
    const sent = this._insert(makeMessage({
      folder: "sent",
      from: fields.from || this.self,
      to: fields.to || [],
      cc: fields.cc || [],
      subject: fields.subject || "",
      body: fields.body || "",
      attachments: fields.attachments || [],
      date: Date.now(),
      read: true,
      threadId: fields.threadId || "",
      inReplyTo: fields.inReplyTo || null,
    }));
    this._persist();
    this._emit("send", { message: sent });
    return sent;
  }

  /** Prefill data for a reply to `id` (all=true adds the other recipients). */
  buildReply(id, opts = {}) {
    const orig = this.messages.get(id);
    if (!orig) return null;
    const selfEmail = this.self.email.toLowerCase();
    const to = [orig.from];
    const cc = [];
    if (opts.all) {
      const seen = new Set([selfEmail, orig.from.email.toLowerCase()]);
      for (const a of [...orig.to, ...orig.cc]) {
        const email = a.email.toLowerCase();
        if (email && !seen.has(email)) {
          seen.add(email);
          cc.push(a);
        }
      }
    }
    const subject = /^\s*re\s*:/i.test(orig.subject) ? orig.subject : "Re: " + orig.subject;
    const quote = orig.body
      .split("\n")
      .map((line) => "> " + line)
      .join("\n");
    const dateLine = new Date(orig.date).toLocaleString();
    return {
      mode: opts.all ? "reply-all" : "reply",
      to,
      cc,
      subject,
      body: "\n\nOn " + dateLine + ", " + formatAddress(orig.from) + " wrote:\n\n" + quote,
      threadId: orig.threadId,
      inReplyTo: orig.id,
    };
  }

  /** Prefill data for forwarding `id`. */
  buildForward(id) {
    const orig = this.messages.get(id);
    if (!orig) return null;
    const subject = /^\s*fwd?\s*:/i.test(orig.subject) ? orig.subject : "Fwd: " + orig.subject;
    const header =
      "---------- Forwarded message ----------\n" +
      "From: " + formatAddress(orig.from) + "\n" +
      "Date: " + new Date(orig.date).toLocaleString() + "\n" +
      "Subject: " + orig.subject + "\n\n";
    return {
      mode: "forward",
      to: [],
      cc: [],
      subject,
      body: "\n\n" + header + orig.body,
      threadId: "",
      inReplyTo: orig.id,
    };
  }

  // ── Contacts ────────────────────────────────────────────────────────────
  /** Derived address book: everyone seen in the mailbox, most frequent first. */
  listContacts() {
    const selfEmail = this.self.email.toLowerCase();
    const tally = new Map();
    const add = (input, date) => {
      const a = parseAddress(input);
      const email = a.email.toLowerCase();
      if (!email || email === selfEmail) return;
      const cur = tally.get(email) || { name: "", email: a.email, count: 0, last: 0 };
      if (a.name && !cur.name) cur.name = a.name;
      cur.count++;
      cur.last = Math.max(cur.last, date || 0);
      tally.set(email, cur);
    };
    for (const m of this.messages.values()) {
      if (m.folder === "trash") continue;
      if (m.folder !== "sent" && m.folder !== "drafts") add(m.from, m.date);
      for (const a of m.to) add(a, m.date);
      for (const a of m.cc) add(a, m.date);
    }
    for (const c of this.contacts.values()) {
      const key = c.email.toLowerCase();
      const cur = tally.get(key) || { name: "", email: c.email, count: 0, last: 0 };
      if (c.name && !cur.name) cur.name = c.name;
      cur.saved = true;
      tally.set(key, cur);
    }
    return [...tally.values()].sort(
      (a, b) => b.count - a.count || (a.name || a.email).localeCompare(b.name || b.email)
    );
  }

  saveContact(input) {
    const a = parseAddress(input);
    if (!a.email) return null;
    const contact = { name: a.name || "", email: a.email };
    this.contacts.set(a.email.toLowerCase(), contact);
    this._persist();
    this._emit("contact", { contact });
    return contact;
  }

  removeContact(email) {
    const key = String(email || "").toLowerCase();
    if (!this.contacts.has(key)) return false;
    this.contacts.delete(key);
    this._persist();
    this._emit("contact", { email });
    return true;
  }

  on(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ── Starter mailbox ─────────────────────────────────────────────────────
  seedDefault() {
    if (this.seeded) return this;
    const HOUR = 3600 * 1000;
    const DAY = 24 * HOUR;
    const now = Date.now();
    const dana = { name: "Dana Whitfield", email: "dana.whitfield@northwind.example" };
    const marcus = { name: "Marcus Lee", email: "marcus.lee@northwind.example" };
    const priya = { name: "Priya Nair", email: "priya.nair@northwind.example" };
    const it = { name: "IT Helpdesk", email: "it@perchance.office" };
    const client = { name: "Jordan Blake", email: "jordan.blake@acme.example" };
    const seeds = [
      {
        folder: "inbox", from: dana, to: [this.self],
        subject: "Q3 business review — deck + numbers",
        body:
          "Hi Alex,\n\nAhead of Thursday's review, could you pull together the **Q3 numbers** and a short deck?\n\n" +
          "I'd like to cover:\n\n- Revenue vs. plan\n- Headcount by team\n- The top three risks going into Q4\n\n" +
          "The team budget sheet should have most of what you need.\n\nThanks,\nDana",
        date: now - 3 * HOUR, read: false, starred: true, labels: ["Work"],
      },
      {
        folder: "inbox", from: marcus, to: [this.self], cc: [dana],
        subject: "Re: Q3 business review — deck + numbers",
        body:
          "Adding to Dana's note — I've dropped the latest headcount export into the shared folder. " +
          "Happy to talk through the risk slide if that's useful.\n\nMarcus",
        date: now - 2.2 * HOUR, read: false, labels: ["Work"],
      },
      {
        folder: "sent", from: this.self, to: [dana], cc: [marcus],
        subject: "Re: Q3 business review — deck + numbers",
        body:
          "Thanks both — I'll have a first pass of the deck ready by Wednesday afternoon.\n\n" +
          "Marcus, I'll take you up on the risk slide.\n\nAlex",
        date: now - 1.4 * HOUR, read: true,
      },
      {
        folder: "inbox", from: priya, to: [this.self],
        subject: "Welcome to the team!",
        body:
          "Hi Alex — welcome aboard!\n\nA few links to get you started:\n\n" +
          "- The [team handbook](https://example.com/handbook)\n- Our meeting rhythm\n- Who to ask for what\n\n" +
          "Shout if you need anything.\n\nPriya",
        date: now - 26 * HOUR, read: true, labels: ["Onboarding"],
      },
      {
        folder: "inbox", from: it, to: [this.self],
        subject: "Action required: review your sign-in devices",
        body:
          "Hello,\n\nWe noticed a new sign-in to your account. If this was you, no action is needed. " +
          "Otherwise, please review your active sessions and change your password.\n\n— IT Helpdesk",
        date: now - 2 * DAY, read: true,
      },
      {
        folder: "drafts", from: this.self, to: [client], subject: "Draft — client proposal",
        body:
          "Hi Jordan,\n\nFollowing our call, here's the draft proposal for the pilot engagement. " +
          "The scope covers discovery, a working prototype, and a hand-over session.\n\n[finish the pricing table before sending]",
        date: now - 40 * HOUR, read: true,
      },
      {
        folder: "archive", from: priya, to: [this.self], subject: "Notes from the planning offsite",
        body:
          "Summarising the offsite so it's in one place:\n\n- Themes we agreed on\n- Owners for each workstream\n" +
          "- Dates to hold\n\nPriya",
        date: now - 6 * DAY, read: true, labels: ["Reference"],
      },
      {
        folder: "inbox", from: client, to: [this.self], subject: "Launch checklist",
        body:
          "Hi Alex,\n\nAttaching the launch checklist we discussed. Let me know which items are ours vs. yours.\n\nJordan",
        date: now - 5 * DAY, read: true, starred: true,
        attachments: [{ name: "launch-checklist.pdf", size: 184320, type: "application/pdf" }],
      },
    ];
    for (const s of seeds) this._insert(makeMessage(s));
    this.saveContact(dana);
    this.saveContact(marcus);
    this.saveContact(priya);
    this.saveContact(client);
    this.seeded = true;
    this._persist();
    this._emit("seed", {});
    return this;
  }
}

/** Shared suite-wide mailbox, persisted through the T1 session store. */
export const mailbox = new Mailbox({ store: new StateStore("mail") });
