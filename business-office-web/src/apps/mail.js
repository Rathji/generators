// ============================================================================
//  MAIL APP (@) — inbox engine surface (T15)
//
//  A three-pane mail client bound to the shared `mailbox` (src/mailbox.js):
//    • a folder rail (Inbox / Drafts / Sent / Archive / Trash + Contacts)
//    • a conversation list with search + All / Unread / Starred filters
//    • a reading pane that renders a whole thread, or a compose editor
//
//  Compose carries a subject line and a formatting toolbar over the suite's
//  RichText model (src/richtext.js), so bodies are stored as Markdown like the
//  Documents app. Drafts auto-save as you type. Contacts are derived from the
//  mailbox plus a saved address book, and appear as one-click chips in compose.
//
//  The mailbox is a suite-wide singleton (persisted via StateStore), so every
//  Mail window shows the same inbox; the window's registry doc mirrors it so the
//  Desktop's Save… can capture the mailbox as a file.
// ============================================================================

import { mailbox, FOLDERS, parseAddress, formatAddress, formatAddressList } from "../mailbox.js";
import { RichText } from "../richtext.js";
import { documentRegistry } from "../registry.js";
import { selectionOffsets, setSelectionAt } from "../domedit.js";

const MAIL_GLYPH = `<svg viewBox="0 0 24 24"><rect x="3" y="5.2" width="18" height="13.6" rx="2.4" fill="#fff"/><path fill="none" stroke="rgba(25,45,85,.42)" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" d="m4.6 7.2 7.4 5.3 7.4-5.3"/></svg>`;
const STAR_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9Z"/></svg>`;
const CLIP_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.5 12.6 21a5 5 0 0 1-7.1-7.1l8.5-8.5a3.4 3.4 0 0 1 4.8 4.8l-8.5 8.5a1.8 1.8 0 0 1-2.5-2.5l7.8-7.8"/></svg>`;
const SEARCH_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>`;
const BACK_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m14 6-6 6 6 6"/></svg>`;
const PLUS_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`;

const FOLDER_ICON = {
  inbox: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M3 12h5l1.5 2.5h5L16 12h5"/><path d="M4.5 5h15l1.5 7v5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17v-5Z"/></svg>`,
  drafts: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M6 3h8l4 4v14H6Z"/><path d="M14 3v4h4"/><path d="M8.5 13h7M8.5 16.5h4"/></svg>`,
  sent: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="m3 11 18-8-8 18-2-8Z"/></svg>`,
  archive: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M3 7h18v3H3ZM5 10h14v10H5Z"/><path d="M10 14h4"/></svg>`,
  trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M5 7h14M9.5 7V5h5v2M6.5 7l1 13h9l1-13"/></svg>`,
  contacts: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6"/></svg>`,
};

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function stripMd(md) {
  return String(md || "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/[#*_`~\[\]()]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function firstLine(md) {
  const line = stripMd(md).split(/(?<=[.!?])\s/)[0] || "";
  return line.length > 140 ? line.slice(0, 140).trimEnd() + "…" : line;
}

function initialOf(input) {
  const a = parseAddress(input);
  const src = a.name || a.email || "?";
  return src.trim().charAt(0).toUpperCase() || "?";
}

function responseTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString([], { month: "short", day: "numeric" });
  return d.toLocaleDateString([], { year: "2-digit", month: "short", day: "numeric" });
}

function fullTime(ts) {
  return new Date(ts).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function addressStr(list) {
  return (list || []).map((a) => a.email).join(", ");
}

/** Names taking part in a thread, excluding the owner — or "You" for sent-only. */
function participants(thread) {
  const self = mailbox.self.email.toLowerCase();
  const names = [];
  for (const m of thread.messages) {
    const from = m.from.email.toLowerCase() === self ? "You" : m.from.name || m.from.email;
    if (!names.includes(from)) names.push(from);
  }
  return names.join(", ") || "You";
}

// ── Static shell ────────────────────────────────────────────────────────────
function mailHTML() {
  const folders = FOLDERS.map(
    (f) => `<button type="button" class="mail-folder" data-folder="${f.id}">
      <span class="mf-ic">${FOLDER_ICON[f.id]}</span>
      <span class="mf-name">${f.name}</span>
      <span class="mf-count" data-count="${f.id}"></span>
    </button>`
  ).join("");
  return `
  <div class="mail-app">
    <div class="mail-toolbar">
      <span class="mail-brand">${MAIL_GLYPH}</span>
      <button type="button" class="mail-compose-new btn btn-primary">${PLUS_SVG}<span>New message</span></button>
      <div class="mail-search">
        ${SEARCH_SVG}
        <input type="search" class="mail-search-input" placeholder="Search mail…" autocomplete="off" aria-label="Search mail">
        <button type="button" class="mail-search-clear" aria-label="Clear search">×</button>
      </div>
      <div class="mail-filters" role="group" aria-label="Filter">
        <button type="button" class="mail-filter" data-filter="all">All</button>
        <button type="button" class="mail-filter" data-filter="unread">Unread</button>
        <button type="button" class="mail-filter" data-filter="starred">Starred</button>
      </div>
    </div>
    <div class="mail-body">
      <aside class="mail-side">
        <button type="button" class="mail-new">${PLUS_SVG}<span>Compose</span></button>
        <nav class="mail-folders">${folders}</nav>
        <button type="button" class="mail-folder mail-folder-contacts" data-folder="contacts">
          <span class="mf-ic">${FOLDER_ICON.contacts}</span>
          <span class="mf-name">Contacts</span>
          <span class="mf-count" data-count="contacts"></span>
        </button>
      </aside>
      <section class="mail-list-pane">
        <div class="mail-list-head">
          <span class="mail-list-title">Inbox</span>
          <span class="mail-list-count"></span>
        </div>
        <div class="mail-list"></div>
      </section>
      <section class="mail-read-pane">
        <div class="mail-compose" hidden></div>
        <div class="mail-read" hidden></div>
        <div class="mail-empty">
          <span class="mail-empty-ic">${MAIL_GLYPH}</span>
          <p class="mail-empty-title">No message selected</p>
          <p class="mail-empty-sub">Pick a conversation from the list to read it, or start a new message.</p>
        </div>
      </section>
    </div>
  </div>`;
}

function threadRowHTML(thread) {
  const m = thread.latest;
  const unread = thread.unread > 0;
  return `<div class="mail-thread${unread ? " unread" : ""}" data-thread="${esc(thread.threadId)}" role="button" tabindex="0">
    <span class="mt-dot" aria-hidden="true"></span>
    <div class="mt-main">
      <div class="mt-top">
        <span class="mt-who">${esc(participants(thread))}</span>
        <span class="mt-time">${responseTime(m.date)}</span>
      </div>
      <div class="mt-subject">${esc(m.subject || "(no subject)")}${thread.count > 1 ? ` <span class="mt-count">${thread.count}</span>` : ""}</div>
      <div class="mt-snip">${esc(firstLine(m.body) || "No content")}</div>
    </div>
    <div class="mt-flags">
      ${thread.hasAttachments ? `<span class="mt-flag mt-clip">${CLIP_SVG}</span>` : ""}
      <button type="button" class="mt-flag mt-star${thread.starred ? " on" : ""}" data-star="${esc(thread.latest.id)}" title="${thread.starred ? "Unstar" : "Star"}" aria-label="Star">${STAR_SVG}</button>
    </div>
  </div>`;
}

function contactRowHTML(contact) {
  return `<div class="mail-contact" data-email="${esc(contact.email)}" role="button" tabindex="0">
    <span class="mc-avatar">${esc(initialOf(contact))}</span>
    <div class="mct-main">
      <span class="mct-name">${esc(contact.name || contact.email)}</span>
      <span class="mct-email">${esc(contact.email)}</span>
    </div>
    ${contact.saved ? `<span class="mct-saved" title="Saved contact">saved</span>` : ""}
    <span class="mct-count">${contact.count ? contact.count + " msg" + (contact.count === 1 ? "" : "s") : "new"}</span>
  </div>`;
}

function messageHTML(message, showFull) {
  const self = mailbox.self.email.toLowerCase();
  const from = message.from.email.toLowerCase() === self ? "You" : message.from.name || message.from.email;
  const toLine = message.to.length ? "to " + formatAddressList(message.to) : "no recipients";
  const ccLine = message.cc.length ? "cc " + formatAddressList(message.cc) : "";
  const bodyHTML = RichText.fromMarkdown(message.body || "").getHTML();
  const atts = message.attachments.length
    ? `<div class="mr-atts">${message.attachments
        .map((a) => `<span class="mr-att">${CLIP_SVG}<span>${esc(a.name)}</span><span class="mr-att-size">${(a.size / 1024).toFixed(0)} KB</span></span>`)
        .join("")}</div>`
    : "";
  return `<article class="mr-msg${showFull ? "" : " collapsed"}">
    <header class="mr-msg-head">
      <span class="mr-msg-avatar">${esc(initialOf(message.from))}</span>
      <div class="mr-msg-who">
        <span class="mr-msg-from">${esc(from)}</span>
        <span class="mr-msg-to">${esc(toLine)}${ccLine ? " · " + esc(ccLine) : ""}</span>
      </div>
      <span class="mr-msg-time" title="${esc(fullTime(message.date))}">${responseTime(message.date)}</span>
    </header>
    <div class="mr-msg-body">${bodyHTML}</div>
    ${atts}
  </article>`;
}

function readHTML(thread, folder) {
  const latest = thread.latest;
  const isTrash = folder === "trash";
  const isDraft = folder === "drafts" && thread.messages.length === 1;
  const anyUnread = thread.messages.some((m) => !m.read);
  return `<div class="mail-read-inner">
    <div class="mr-bar">
      <button type="button" class="mr-back" title="Back to list">${BACK_SVG}</button>
      <div class="mr-headinfo">
        <h2 class="mr-subject">${esc(latest.subject || "(no subject)")}</h2>
        <span class="mr-meta">${thread.count} message${thread.count === 1 ? "" : "s"}${latest.attachments.length ? " · attachment" : ""}</span>
      </div>
      <div class="mr-actions">
        ${
          isDraft
            ? `<button type="button" class="mr-act" data-act="edit">Edit draft</button>`
            : `<button type="button" class="mr-act" data-act="reply">Reply</button>
               <button type="button" class="mr-act" data-act="replyall">Reply all</button>
               <button type="button" class="mr-act" data-act="forward">Forward</button>`
        }
        <button type="button" class="mr-act mr-act-icon${thread.starred ? " on" : ""}" data-act="star" title="Star" aria-label="Star">${STAR_SVG}</button>
        <button type="button" class="mr-act" data-act="read">Mark ${anyUnread ? "read" : "unread"}</button>
        ${isTrash
          ? `<button type="button" class="mr-act mr-danger" data-act="delete">Delete forever</button>`
          : `<button type="button" class="mr-act" data-act="archive">Archive</button>
             <button type="button" class="mr-act mr-danger" data-act="trash">Trash</button>`
        }
      </div>
    </div>
    <div class="mr-thread">
      ${thread.messages.map((m, i) => messageHTML(m, i === thread.messages.length - 1)).join("")}
    </div>
  </div>`;
}

function composeHTML(compose) {
  const contacts = mailbox.listContacts().slice(0, 8);
  return `<div class="mc">
    <div class="mc-bar">
      <button type="button" class="mr-back" title="Close" data-act="discard">${BACK_SVG}</button>
      <span class="mc-title">${esc(compose.mode === "edit" ? "Draft" : compose.mode === "reply" || compose.mode === "reply-all" ? "Reply" : compose.mode === "forward" ? "Forward" : "New message")}</span>
      <span class="mc-spacer"></span>
      <button type="button" class="mc-send btn btn-primary" data-act="send">Send</button>
      <button type="button" class="mc-save" data-act="save">Save draft</button>
      <button type="button" class="mc-discard" data-act="discard">Discard</button>
    </div>
    <div class="mc-fields">
      <label class="mc-field"><span class="mc-label">To</span><input type="text" class="mc-to" value="${esc(addressStr(compose.to))}" placeholder="name@example.com" autocomplete="off"></label>
      <label class="mc-field"><span class="mc-label">Cc</span><input type="text" class="mc-cc" value="${esc(addressStr(compose.cc))}" placeholder="Optional" autocomplete="off"></label>
      <label class="mc-field"><span class="mc-label">Subject</span><input type="text" class="mc-subject" value="${esc(compose.subject)}" placeholder="Subject" autocomplete="off"></label>
    </div>
    ${
      contacts.length
        ? `<div class="mc-chips"><span class="mc-chips-label">Quick add</span>${contacts
            .map((c) => `<button type="button" class="mc-chip" data-chip="${esc(c.email)}">${esc(c.name || c.email)}</button>`)
            .join("")}</div>`
        : ""
    }
    <div class="mc-fmt" role="toolbar" aria-label="Formatting">
      <button type="button" class="mc-fmt-btn" data-fmt="b" title="Bold (Ctrl+B)" aria-label="Bold"><b>B</b></button>
      <button type="button" class="mc-fmt-btn" data-fmt="i" title="Italic (Ctrl+I)" aria-label="Italic"><i>I</i></button>
      <button type="button" class="mc-fmt-btn" data-fmt="u" title="Underline (Ctrl+U)" aria-label="Underline"><u>U</u></button>
    </div>
    <div class="mc-body" contenteditable="true" spellcheck="false" data-placeholder="Write your message…"></div>
    <div class="mc-status"><span class="mc-save-state">Draft</span></div>
  </div>`;
}

// ── Mount ───────────────────────────────────────────────────────────────────
export function mountMail(zone, ctx) {
  const doc = ctx.doc || null;
  zone.innerHTML = mailHTML();
  const rootEl = zone.querySelector(".mail-app");
  const sideEl = zone.querySelector(".mail-side");
  const listPane = zone.querySelector(".mail-list-pane");
  const listTitle = zone.querySelector(".mail-list-title");
  const listCount = zone.querySelector(".mail-list-count");
  const listEl = zone.querySelector(".mail-list");
  const readPane = zone.querySelector(".mail-read-pane");
  const readEl = zone.querySelector(".mail-read");
  const composeEl = zone.querySelector(".mail-compose");
  const emptyEl = zone.querySelector(".mail-empty");
  const searchInput = zone.querySelector(".mail-search-input");
  const searchClear = zone.querySelector(".mail-search-clear");

  let folder = "inbox";
  let filter = "all";
  let q = "";
  let selectedThreadId = null;
  let view = "empty"; // "empty" | "read" | "compose"
  let compose = null; // { id, to[], cc[], subject, model, threadId, inReplyTo, mode }
  let narrow = false;
  let autosaveTimer = null;

  const syncDoc = () => {
    if (!doc) return;
    documentRegistry.update(doc.id, { content: JSON.stringify(mailbox.toJSON()) });
  };

  const setNarrow = (isNarrow) => {
    if (isNarrow === narrow) return;
    narrow = isNarrow;
    rootEl.classList.toggle("narrow", narrow);
  };

  const updateShowRead = () => {
    rootEl.classList.toggle("show-read", narrow && view !== "empty");
  };

  // ── Folders ─────────────────────────────────────────────────────────────
  const renderFolders = () => {
    const stats = mailbox.folderStats();
    zone.querySelectorAll(".mail-folder").forEach((btn) => {
      const id = btn.dataset.folder;
      btn.classList.toggle("active", id === folder);
      const badge = btn.querySelector(".mf-count");
      if (id === "contacts") {
        const n = mailbox.listContacts().length;
        badge.textContent = n ? String(n) : "";
        badge.classList.remove("hot");
      } else if (stats[id]) {
        const show = id === "inbox" ? stats[id].unread : stats[id].total;
        badge.textContent = show ? String(show) : "";
        badge.classList.toggle("hot", id === "inbox" && stats[id].unread > 0);
      }
    });
  };

  // ── List ────────────────────────────────────────────────────────────────
  const renderList = () => {
    const title = folder === "contacts" ? "Contacts" : (FOLDERS.find((f) => f.id === folder) || {}).name || "Inbox";
    listTitle.textContent = title;
    const filterWrap = zone.querySelector(".mail-filters");
    filterWrap.classList.toggle("off", folder === "contacts");

    if (folder === "contacts") {
      const contacts = mailbox.listContacts();
      listCount.textContent = contacts.length + (q ? " match" : "");
      const filtered = q
        ? contacts.filter((c) => (c.name + " " + c.email).toLowerCase().includes(q.toLowerCase()))
        : contacts;
      listEl.innerHTML = filtered.length
        ? filtered.map(contactRowHTML).join("")
        : `<div class="mail-list-empty">No contacts${q ? " match “" + esc(q) + "”" : " yet"}.</div>`;
      return;
    }

    const threads = mailbox.threads({ folder, q, filter });
    listCount.textContent = threads.length + (q ? " match" : "");
    listEl.innerHTML = threads.length
      ? threads.map(threadRowHTML).join("")
      : `<div class="mail-list-empty">${q ? "No messages match “" + esc(q) + "”." : emptyListText()}</div>`;
    const sel = selectedThreadId
      ? listEl.querySelector('.mail-thread[data-thread="' + CSS.escape(selectedThreadId) + '"]')
      : null;
    if (sel) sel.classList.add("selected");
  };

  const emptyListText = () => {
    if (filter === "unread") return "Nothing unread here. Nice.";
    if (filter === "starred") return "No starred messages yet.";
    return "No messages here yet.";
  };

  // ── Reading pane ────────────────────────────────────────────────────────
  const currentThread = () => (selectedThreadId ? mailbox.threads({}).find((t) => t.threadId === selectedThreadId) : null);

  const renderRead = () => {
    const thread = currentThread();
    if (!thread) {
      view = "empty";
      readEl.hidden = true;
      composeEl.hidden = true;
      emptyEl.hidden = false;
      updateShowRead();
      return;
    }
    view = "read";
    composeEl.hidden = true;
    emptyEl.hidden = true;
    readEl.hidden = false;
    readEl.innerHTML = readHTML(thread, folder);
    updateShowRead();
  };

  const openThread = (threadId) => {
    selectedThreadId = threadId;
    const thread = mailbox.threads({}).find((t) => t.threadId === threadId);
    if (!thread) return;
    const latest = thread.latest;
    if (folder === "drafts" && thread.messages.length === 1 && latest.folder === "drafts") {
      openCompose({ mode: "edit", id: latest.id, to: latest.to, cc: latest.cc, subject: latest.subject, body: latest.body });
      return;
    }
    mailbox.markThreadRead(threadId, true);
    renderRead();
    renderList();
    renderFolders();
  };

  const clearSelection = () => {
    selectedThreadId = null;
    renderRead();
    renderList();
  };

  // ── Compose ─────────────────────────────────────────────────────────────
  const openCompose = (prefill = {}) => {
    const body = prefill.body || "";
    compose = {
      id: prefill.id || null,
      to: (prefill.to || []).map(parseAddress),
      cc: (prefill.cc || []).map(parseAddress),
      subject: prefill.subject || "",
      model: RichText.fromMarkdown(body),
      threadId: prefill.threadId || "",
      inReplyTo: prefill.inReplyTo || null,
      mode: prefill.mode || "new",
    };
    view = "compose";
    selectedThreadId = null;
    emptyEl.hidden = true;
    readEl.hidden = true;
    composeEl.hidden = false;
    composeEl.innerHTML = composeHTML(compose);
    const bodyEl = composeEl.querySelector(".mc-body");
    if (compose.model.isEmpty()) bodyEl.innerHTML = "";
    else bodyEl.innerHTML = compose.model.getHTML();
    bodyEl.classList.toggle("is-empty", compose.model.isEmpty());
    updateShowRead();
    renderFolders();
    renderList();
    if (narrow) rootEl.classList.add("show-read");
    const focusEl = compose.subject ? bodyEl : composeEl.querySelector(compose.subject === "" && !compose.to.length ? ".mc-to" : ".mc-body");
    if (focusEl) focusEl.focus();
  };

  const readComposeFields = () => ({
    to: splitAddresses(composeEl.querySelector(".mc-to").value),
    cc: splitAddresses(composeEl.querySelector(".mc-cc").value),
    subject: composeEl.querySelector(".mc-subject").value,
    body: compose.model.getMarkdown(),
  });

  const splitAddresses = (str) =>
    String(str || "")
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map(parseAddress);

  const setSaveState = (text) => {
    const el = composeEl.querySelector(".mc-save-state");
    if (el) el.textContent = text;
  };

  const autoSaveDraft = () => {
    if (!compose) return;
    const fields = readComposeFields();
    const draft = mailbox.saveDraft({
      id: compose.id,
      to: fields.to,
      cc: fields.cc,
      subject: fields.subject,
      body: fields.body,
    });
    if (draft && draft.id) compose.id = draft.id;
    setSaveState("Saved " + responseTime(Date.now()));
  };

  const scheduleAutoSave = () => {
    clearTimeout(autosaveTimer);
    setSaveState("Saving…");
    autosaveTimer = setTimeout(autoSaveDraft, 600);
  };

  const closeCompose = (keepDraft) => {
    clearTimeout(autosaveTimer);
    if (!keepDraft && compose && compose.id) mailbox.remove(compose.id);
    compose = null;
    composeEl.hidden = true;
    composeEl.innerHTML = "";
    view = "empty";
    renderRead();
  };

  const sendCompose = () => {
    if (!compose) return;
    clearTimeout(autosaveTimer);
    const fields = readComposeFields();
    if (!fields.to.length) {
      setSaveState("Add at least one recipient");
      const toEl = composeEl.querySelector(".mc-to");
      if (toEl) toEl.focus();
      return;
    }
    const sent = mailbox.send({
      id: compose.id,
      to: fields.to,
      cc: fields.cc,
      subject: fields.subject,
      body: fields.body,
      threadId: compose.threadId,
      inReplyTo: compose.inReplyTo,
    });
    compose = null;
    composeEl.hidden = true;
    composeEl.innerHTML = "";
    folder = "sent";
    filter = "all";
    q = "";
    searchInput.value = "";
    selectedThreadId = sent.threadId;
    toast("Message sent");
    renderFolders();
    renderList();
    renderRead();
  };

  const applyFmt = (fmt) => {
    const bodyEl = composeEl.querySelector(".mc-body");
    const { start, end } = selectionOffsets(bodyEl);
    if (start >= end) return;
    compose.model.applyFormat(start, end, fmt);
    bodyEl.innerHTML = compose.model.getHTML();
    setSelectionAt(bodyEl, start, end);
    scheduleAutoSave();
  };

  // ── Toast (kept local so the app never depends on shell internals) ──────
  function toast(msg) {
    let t = document.querySelector(".toast");
    if (!t) {
      t = document.createElement("div");
      t.className = "toast";
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(t._tm);
    t._tm = setTimeout(() => t.classList.remove("show"), 2200);
  }

  // ── Events ──────────────────────────────────────────────────────────────
  const onFolderClick = (folderId) => {
    clearTimeout(autosaveTimer);
    compose = null;
    composeEl.hidden = true;
    composeEl.innerHTML = "";
    if (folderId !== "contacts" && folder === folderId && selectedThreadId) {
      // clicking the current folder again collapses the reader
      selectedThreadId = null;
    }
    folder = folderId;
    selectedThreadId = null;
    if (folderId === "contacts") filter = "all";
    renderFolders();
    renderList();
    renderRead();
    if (narrow) rootEl.classList.remove("show-read");
  };

  sideEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".mail-folder");
    if (btn) onFolderClick(btn.dataset.folder);
  });
  zone.querySelector(".mail-compose-new").addEventListener("click", () => openCompose({ mode: "new" }));
  zone.querySelector(".mail-new").addEventListener("click", () => openCompose({ mode: "new" }));

  zone.querySelector(".mail-filters").addEventListener("click", (e) => {
    const b = e.target.closest(".mail-filter");
    if (!b) return;
    filter = b.dataset.filter;
    zone.querySelectorAll(".mail-filter").forEach((x) => x.classList.toggle("active", x === b));
    renderList();
  });

  searchInput.addEventListener("input", () => {
    q = searchInput.value.trim();
    searchClear.classList.toggle("on", !!q);
    renderList();
  });
  searchClear.addEventListener("click", () => {
    searchInput.value = "";
    q = "";
    searchClear.classList.remove("on");
    renderList();
    searchInput.focus();
  });

  // Thread list interactions (delegated).
  listEl.addEventListener("click", (e) => {
    const star = e.target.closest(".mt-star");
    if (star) {
      e.stopPropagation();
      mailbox.toggleStar(star.dataset.star);
      renderList();
      if (view === "read") renderRead();
      return;
    }
    const contact = e.target.closest(".mail-contact");
    if (contact) {
      openCompose({ mode: "new", to: [parseAddress(contact.dataset.email)] });
      return;
    }
    const row = e.target.closest(".mail-thread");
    if (row) openThread(row.dataset.thread);
  });
  listEl.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const row = e.target.closest(".mail-thread, .mail-contact");
    if (!row) return;
    e.preventDefault();
    row.click();
  });

  // Reading pane actions (delegated).
  readEl.addEventListener("click", (e) => {
    const back = e.target.closest(".mr-back");
    if (back) {
      clearSelection();
      if (narrow) rootEl.classList.remove("show-read");
      return;
    }
    const act = e.target.closest(".mr-act");
    if (!act || !selectedThreadId) return;
    const thread = currentThread();
    if (!thread) return;
    const latest = thread.latest;
    switch (act.dataset.act) {
      case "reply":
        openCompose(mailbox.buildReply(latest.id, { all: false }));
        break;
      case "replyall":
        openCompose(mailbox.buildReply(latest.id, { all: true }));
        break;
      case "forward":
        openCompose(mailbox.buildForward(latest.id));
        break;
      case "star":
        mailbox.toggleStar(latest.id);
        renderRead();
        renderList();
        break;
      case "read": {
        const anyUnread = thread.messages.some((m) => !m.read);
        mailbox.markThreadRead(selectedThreadId, anyUnread);
        renderRead();
        renderList();
        renderFolders();
        break;
      }
      case "archive":
        mailbox.moveThread(selectedThreadId, "archive");
        toast("Archived");
        clearSelection();
        renderFolders();
        break;
      case "trash":
        mailbox.moveThread(selectedThreadId, "trash");
        toast("Moved to Trash");
        clearSelection();
        renderFolders();
        break;
      case "delete":
        mailbox.removeThread(selectedThreadId);
        toast("Deleted forever");
        clearSelection();
        renderFolders();
        break;
      case "edit":
        openCompose({ mode: "edit", id: latest.id, to: latest.to, cc: latest.cc, subject: latest.subject, body: latest.body });
        break;
    }
  });

  // Compose interactions (delegated).
  composeEl.addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]");
    if (act) {
      if (act.dataset.act === "send") sendCompose();
      else if (act.dataset.act === "save") autoSaveDraft();
      else if (act.dataset.act === "discard") {
        if (compose && (compose.subject || !compose.model.isEmpty())) {
          if (!window.confirm("Discard this draft?")) return;
          clearTimeout(autosaveTimer);
        }
        closeCompose(false);
        if (narrow) rootEl.classList.remove("show-read");
      }
      return;
    }
    const back = e.target.closest(".mr-back");
    if (back) {
      closeCompose(true);
      if (narrow) rootEl.classList.remove("show-read");
      return;
    }
    const fmt = e.target.closest(".mc-fmt-btn");
    if (fmt) {
      applyFmt(fmt.dataset.fmt);
      return;
    }
    const chip = e.target.closest(".mc-chip");
    if (chip) {
      const toEl = composeEl.querySelector(".mc-to");
      const existing = splitAddresses(toEl.value).map((a) => a.email.toLowerCase());
      if (!existing.includes(chip.dataset.chip.toLowerCase())) {
        toEl.value = [...splitAddresses(toEl.value).map((a) => a.email), chip.dataset.chip].join(", ");
      }
      toEl.focus();
      scheduleAutoSave();
    }
  });
  composeEl.addEventListener("mousedown", (e) => {
    if (e.target.closest(".mc-fmt-btn")) e.preventDefault();
  });
  composeEl.addEventListener("input", (e) => {
    if (!compose) return;
    if (e.target.closest(".mc-body")) {
      compose.model = RichText.fromHTML(e.target.innerHTML);
      e.target.classList.toggle("is-empty", compose.model.isEmpty());
    }
    scheduleAutoSave();
  });
  composeEl.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && (k === "b" || k === "i" || k === "u")) {
      e.preventDefault();
      applyFmt(k);
    }
  });

  // Keep the mailbox, list and doc mirror in sync with any mutation.
  const unsubscribe = mailbox.on(() => {
    renderFolders();
    renderList();
    if (view === "read") renderRead();
    syncDoc();
  });

  const resizeObs = window.ResizeObserver
    ? new ResizeObserver(() => setNarrow(rootEl.clientWidth < 640))
    : null;
  if (resizeObs) resizeObs.observe(rootEl);
  setNarrow(rootEl.clientWidth > 0 && rootEl.clientWidth < 640);

  renderFolders();
  renderList();
  renderRead();
  syncDoc();

  return () => {
    clearTimeout(autosaveTimer);
    unsubscribe();
    if (resizeObs) resizeObs.disconnect();
  };
}

export const mailApp = {
  key: "mail",
  roadTitle: "Mail build",
  roadmap: [
    "Inbox / sent / drafts / archive / trash folder list with thread view",
    "Compose editor with subject line + formatting toolbar (B/I/U over RichText)",
    "Draft auto-save per user (persisted via the suite StateStore)",
    "Local contact book with quick-address chips",
    "Search across subjects, senders and bodies",
    "Attachments & links handled through upload-plugin",
  ],
  workspaceNote:
    "A working inbox: five folders with unread counts, conversation threading, search and All / Unread / Starred filters, a reading pane, and a compose editor with subject line + rich-text toolbar that auto-saves drafts. A derived contact book powers one-click address chips. Attachments are modelled but not yet wired to upload-plugin.",
  mountFile: "src/apps/mail.js",
  hasSurface: true,
  mount: mountMail,
  seedHints: [
    "The mailbox model lives in src/mailbox.js — all reads/writes go through it, never the DOM",
    "Bodies are Markdown (src/richtext.js), so compose reuses the Documents model and formatting helpers (src/domedit.js)",
    "Messages thread by stripped subject (normalizeSubject); replies inherit the parent thread id",
  ],
};
