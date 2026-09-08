// Webuntu OS — Mail app (POST-52, Task 60)
// A self-contained email client for the Webuntu Business universe: curated
// contacts, a seeded mailbox (Inbox / Starred / Sent / Drafts / Trash) with
// read/unread + star state, compose with contact autocomplete, reply /
// forward with quoting, search across folders, mark-all-read, two-step Empty
// Trash, and a "live" feel — a scripted new message occasionally arrives
// (bell notification + toast when the app is closed). Everything persists in
// webuntu.mail (versioned, re-seeds on bump). Replaces the original stub.

(function () {
  "use strict";

  const KEY = "webuntu.mail";
  const VERSION = 2;
  const HOUR = 3600000;
  const DAY = 86400000;

  // ---------- curated address book (fictional Webuntu universe) ----------
  const CONTACTS = [
    { name: "Rathji",             email: "rathji@webuntu.dev",        icon: "🧙", color: "#7c6cff" },
    { name: "Perchance Team",     email: "hello@perchance.org",       icon: "⚡", color: "#22d3ee" },
    { name: "The Ledger",         email: "hello@the-ledger.app",      icon: "🧾", color: "#22c55e" },
    { name: "Atomic Roadmap",     email: "builds@atomic-roadmap.app", icon: "🗺️", color: "#8b5cf6" },
    { name: "Northwind Inc.",     email: "marcus@northwind.io",       icon: "💼", color: "#f59e0b" },
    { name: "Cascadia Software",  email: "sofia@cascadia.co",          icon: "🏔️", color: "#22d3ee" },
    { name: "Radiance Studio",    email: "clara@radiance.studio",      icon: "🎨", color: "#f472b6" },
    { name: "Webuntu Security",   email: "security@webuntu.dev",       icon: "🛡️", color: "#f87171" },
    { name: "Business News",      email: "news@webuntu.dev",           icon: "📰", color: "#94a3b8" },
  ];
  const UNKNOWN = { name: "Unknown", email: "", icon: "👤", color: "#94a3b8" };

  function me() {
    let name = "user";
    let addr = "user";
    try {
      const u = window.OS && OS.currentUser;
      if (u) {
        addr = u;
        const accounts = JSON.parse(localStorage.getItem("webuntu.accounts") || "{}");
        name = (accounts[u] && accounts[u].displayName) || u;
      }
    } catch (e) {}
    return { name: name, email: addr + "@webuntu.dev" };
  }
  function contactFor(who) {
    if (!who || !who.email) return UNKNOWN;
    return CONTACTS.find((c) => c.email === who.email) || UNKNOWN;
  }

  // ---------- seed mailbox ----------
  const IN = (from, subject, body, ts, read) => ({ folder: "inbox", from, to: me(), subject, body, ts, read, starred: false });
  const h = (n) => Date.now() - n * HOUR;
  const d = (n) => Date.now() - n * DAY;

  function seed() {
    const rathji = CONTACTS[0], perch = CONTACTS[1], ledger = CONTACTS[2], roadmap = CONTACTS[3],
      marcus = CONTACTS[4], sofia = CONTACTS[5], clara = CONTACTS[6],
      sec = CONTACTS[7], news = CONTACTS[8];
    const prize = { name: "Prize Center", email: "winner@prize-center.biz", icon: "🎰", color: "#f87171" };
    const msgs = [
      IN(rathji, "Webuntu Business is live — welcome to the suite",
        "Morning,\n\nWebuntu Business 12 \"Iron Ledger\" shipped today. You now have the whole\nbusiness stack on one desktop:\n\n\u2022 The Ledger \u2014 bookkeeping, invoices, chart of accounts\n\u2022 Project Master \u2014 projects, kanban and releases\n\u2022 Atomic Roadmap \u2014 AI-broken-down backlogs\n\u2022 sys-plan & Diagram It \u2014 boards and diagrams\n\u2022 Chance Code & Perch Edit \u2014 for when you build\n\nEverything runs as live Perchance generators right inside the OS. If anything\nfeels off, just reply and I\u2019ll take a look.\n\n\u2014 Rathji", h(0.4), false),
      IN(perch, "Welcome to the Perchance community 🎉",
        "Hi there,\n\nThanks for building on Perchance! Your Webuntu Business desktop is now live.\nA few tips:\n\n\u2022 You can rename or fork it from the settings menu\n\u2022 Every generator gets its own page and community\n\u2022 The docs and plugins directory are a click away\n\nWe can\u2019t wait to see what you build next.\n\n\u2014 The Perchance Team", h(2), true),
      IN(ledger, "Your ledger workspace is ready",
        "Hi,\n\nWe\u2019ve set up your workspace:\n\n\u2022 Chart of accounts \u2014 standard small-business codes\n\u2022 Invoice #1001 template \u2014 ready to customise\n\u2022 Opening balances \u2014 enter them in Settings\n\nYour data stays in your browser \u2014 nothing is sent to us. Open The Ledger from\nthe desktop or the Finance category in the Start menu.\n\n\u2014 The Ledger team", h(5), false),
      IN(marcus, "Q3 contract renewal — final draft",
        "Hi,\n\nAttached is the final draft of the Q3 renewal (same scope as Q2, +2 days of\narchitecture review). Terms unchanged, rate index-linked as discussed.\n\nCan you sign off by Thursday so we can schedule the kick-off?\n\n\u2014 Marcus Cole, Northwind Inc.", h(9), false),
      IN(sofia, "Invoice #2210 — payment due this week",
        "Hi,\n\nA reminder that invoice #2210 (2,140.00) is due on 14 September. Our accounts\nteam can send a receipt on request. Let me know if anything on it looks off.\n\n\u2014 Sofia Reyes, Cascadia Software", d(1), false),
      IN(clara, "Brand refresh — mockups for review",
        "Hi,\n\nI\u2019ve roughed out three directions for the brand refresh. The \"ledger-green\"\none is my favourite \u2014 very Iron Ledger. Could you take a look before Friday?\n\n\u2014 Clara, Radiance Studio", d(2), true),
      IN(sec, "Phishing advisory — fake invoice emails",
        "Hi,\n\nA wave of fake \"overdue invoice\" emails is doing the rounds. Webuntu will never:\n\n\u2022 ask you to open an attached spreadsheet from an unknown sender\n\u2022 send you to a login page outside perchance.org\n\u2022 ask for your password by email\n\nWhen in doubt, verify the sender address and report it to us.\n\n\u2014 Webuntu Security", d(3), true),
      IN(roadmap, "Your Q3 plan has been generated",
        "Morning,\n\nAtomic Roadmap turned your Q3 launch goal into 14 concrete tasks with\ndependencies and estimated effort. Open the app to review and reorder them.\n\n\u2014 Atomic Roadmap", d(4), true),
      IN(news, "This month in the Webuntu ecosystem",
        "Welcome to the digest. This month:\n\n\u2022 Webuntu Business goes live with 11 pre-installed apps\n\u2022 The Ledger adds recurring invoices\n\u2022 sys-plan reaches v2 with export to Diagram It\n\u2022 Template spotlight: the monthly close checklist\n\nRead it all in the Software Center when you have a moment.", d(5), true),
      { folder: "sent", from: me(), to: marcus, subject: "Re: Q3 contract renewal — final draft",
        body: "Thanks Marcus \u2014 scope looks right. One note: let\u2019s move the architecture\nreview to week 3 so the ledger migration lands first. Signing Thursday.\n\n\u2014 You", ts: d(1), read: true, starred: true },
      { folder: "sent", from: me(), to: clara, subject: "Re: Brand refresh — mockups for review",
        body: "Loving the ledger-green direction. Could the type be a touch warmer on the\ncards? Otherwise ready for the stakeholder call.\n\n\u2014 You", ts: d(2), read: true, starred: false },
      { folder: "sent", from: me(), to: rathji, subject: "Re: Webuntu Business is live — welcome to the suite",
        body: "This is great \u2014 the embedded suite is exactly right for a small firm. One\nrequest: a keyboard shortcut list in the About screen would help. No rush.\n\nThanks for the hard work!", ts: h(0.3), read: true, starred: true },
      { folder: "drafts", from: me(), to: sofia, subject: "Re: Invoice #2210 — payment due this week",
        body: "Thanks for the reminder \u2014 payment is scheduled for the 13th. Could you\nsend the breakdown of line 3? I want to double-check the travel line.", ts: h(12), read: true, starred: false },
      { folder: "drafts", from: me(), to: roadmap, subject: "Re: Your Q3 plan has been generated",
        body: "Great start \u2014 I\u2019ve reordered the first sprint. Could you split task 9 into\ntwo smaller tickets? It\u2019s still too big to estimate.", ts: h(5), read: true, starred: false },
      { folder: "trash", from: prize, to: me(), subject: "You\u2019ve won a free cruise!!!",
        body: "CONGRATULATIONS!!! You have been selected to receive a FREE luxury cruise. Click this link to claim within 24 hours: hxxp://totally-real-prize.center/claim\n\n(This looks like a phishing attempt \u2014 delete it and never click the link.)", ts: d(3), read: true, starred: false },
      { folder: "trash", from: news, to: me(), subject: "Weekly digest #14",
        body: "The usual roundup of community highlights. (Unsubscribed.)", ts: d(6), read: true, starred: false },
    ];
    msgs.forEach((m, i) => { m.id = "s" + (i + 1); });
    return { version: VERSION, seedVer: 1, lastSim: 0, seq: 1000, contacts: CONTACTS, messages: msgs };
  }

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || "null");
      if (raw && raw.version === VERSION && Array.isArray(raw.messages)) return raw;
    } catch (e) {}
    return null;
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }
  function nextId() { return "m" + (state.seq++); }

  let state = load() || seed();
  if (!state.contacts || !state.contacts.length) state.contacts = CONTACTS;
  save();

  // ---------- derived helpers ----------
  function listFor(folder) {
    if (folder === "starred") return state.messages.filter((m) => m.starred);
    return state.messages.filter((m) => m.folder === folder);
  }
  function unreadInbox() { return state.messages.filter((m) => m.folder === "inbox" && !m.read).length; }
  function folderCount(f) {
    if (f === "inbox") return unreadInbox();
    if (f === "starred") return state.messages.filter((m) => m.starred).length;
    return state.messages.filter((m) => m.folder === f).length;
  }

  function searchResults(q) {
    q = q.toLowerCase();
    return state.messages
      .filter((m) => m.folder !== "trash")
      .filter((m) =>
        (m.subject || "").toLowerCase().includes(q) ||
        (m.body || "").toLowerCase().includes(q) ||
        (m.from && (m.from.name + " " + m.from.email).toLowerCase().includes(q)) ||
        (m.to && (m.to.name + " " + m.to.email).toLowerCase().includes(q)))
      .sort((a, b) => b.ts - a.ts);
  }

  function whenStr(ts) {
    const diff = Date.now() - ts;
    if (diff < 60000) return "now";
    if (diff < HOUR) return Math.floor(diff / 60000) + "m";
    const dt = new Date(ts), now = new Date();
    if (dt.toDateString() === now.toDateString()) return dt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    if (diff < 6 * DAY) return dt.toLocaleDateString([], { weekday: "short" });
    if (dt.getFullYear() === now.getFullYear()) return dt.toLocaleDateString([], { month: "short", day: "numeric" });
    return dt.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
  }
  function fullWhen(ts) {
    return new Date(ts).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }
  function snippet(m) {
    return (m.body || "").replace(/\s+/g, " ").trim().slice(0, 84);
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function avStyle(c) {
    return "background:color-mix(in srgb, " + c.color + " 22%, transparent);border-color:color-mix(in srgb, " + c.color + " 45%, transparent);";
  }

  // ---------- live incoming mail ----------
  const SIM_POOL = [
    { from: CONTACTS[2], subject: "Monthly close checklist — 5 items",
      body: "Heads up: the monthly close checklist is waiting in The Ledger (5 items,\nmostly reviews). Everything auto-generates from this month\u2019s entries \u2014 open\nthe app and walk it when you\u2019re ready.\n\n\u2014 The Ledger team" },
    { from: CONTACTS[8], subject: "New in the ecosystem: plugin roundup",
      body: "Quick heads-up \u2014 three new community plugins just landed in the\ndirectory (Markdown preview, CSV tools, a kanban board). Might be worth a\nlook for your next build.\n\n\u2014 Business News" },
    { from: CONTACTS[0], subject: "Small fix in the Business Assistant",
      body: "Heads up \u2014 pushed a fix to the Business Assistant\u2019s file summariser; it\nwas truncating long documents. Refresh and it should handle whole files now.\n\n\u2014 Rathji" },
    { from: CONTACTS[4], subject: "Re: Q3 contract renewal — signed",
      body: "Signed copy is on its way back to you. Kick-off stands for Monday week \u2014\nI\u2019ll circulate the invite with the room link.\n\n\u2014 Marcus Cole, Northwind Inc." },
  ];
  let simScheduled = false;
  let replyScheduled = false;

  function maybeScheduleSim() {
    if (simScheduled || replyScheduled) return;
    if (state.lastSim && Date.now() - state.lastSim < 10 * 60 * 1000) return;
    simScheduled = true;
    const delay = 45000 + Math.random() * 75000;
    setTimeout(() => {
      simScheduled = false;
      const pick = SIM_POOL[Math.floor(Math.random() * SIM_POOL.length)];
      deliverIncoming(pick.from, pick.subject, pick.body, true);
    }, delay);
  }
  function scheduleReplyTo(contact) {
    if (replyScheduled || simScheduled) return;
    if (Math.random() > 0.65) return;
    replyScheduled = true;
    setTimeout(() => {
      replyScheduled = false;
      if (contact.email === CONTACTS[0].email) {
        deliverIncoming(CONTACTS[0], "Re: your message",
          "Got it, thanks \u2014 noted on the About-screen shortcut list. It\u2019s on the\n12.1 board. Appreciate you taking the time!\n\n\u2014 Rathji", false);
      } else if (contact.email === CONTACTS[4].email) {
        deliverIncoming(CONTACTS[4], "Re: Q3 contract renewal",
          "Thanks for the quick sign-off! The finance team has filed it \u2014 expect the\nPO number by end of week.\n\n\u2014 Marcus Cole, Northwind Inc.", false);
      } else if (contact.email === CONTACTS[5].email) {
        deliverIncoming(CONTACTS[5], "Re: Invoice #2210",
          "Invoice #2210 is marked paid \u2014 receipt attached to this thread. Thanks for\nthe prompt settlement!\n\n\u2014 Sofia Reyes, Cascadia Software", false);
      } else {
        deliverIncoming(contact, "Re: " + contact.name,
          "Thanks for your message! I\u2019ll get back to you properly soon.\n\n\u2014 " + contact.name, false);
      }
    }, 12000 + Math.random() * 13000);
  }

  function deliverIncoming(from, subject, body, toast) {
    const msg = { id: nextId(), folder: "inbox", from, to: me(), subject, body, ts: Date.now(), read: false, starred: false };
    state.messages.unshift(msg);
    state.lastSim = Date.now();
    save();
    const win = window.WM && window.WM.findByAppId("mail");
    const focused = win && window.WM.focusedId === win.id;
    if (!focused && toast && window.Notify) {
      window.Notify.push({
        app: "Mail", icon: "✉️", title: from.name, body: subject,
        onClick: () => {
          if (window.Apps) window.Apps.launch("mail");
          setTimeout(() => { if (window.Mail) window.Mail.openMessage(msg.id); }, 150);
        },
      });
    }
    if (els) {
      els.status.textContent = "New mail from " + from.name;
      els.status.classList.add("flash");
      clearTimeout(flashTimer);
      flashTimer = setTimeout(() => { els.status.textContent = ""; els.status.classList.remove("flash"); }, 5000);
      renderAllRef();
    }
  }

  // ---------- view state ----------
  let els = null;
  let renderAllRef = () => {};
  let flashTimer = null;
  let confirmEmptyAt = 0;
  const cur = { folder: "inbox", query: "", openId: null, compose: null };

  const FOLDERS = [
    { id: "inbox",   label: "Inbox",   icon: "📥" },
    { id: "starred", label: "Starred", icon: "⭐" },
    { id: "sent",    label: "Sent",    icon: "📤" },
    { id: "drafts",  label: "Drafts",  icon: "📝" },
    { id: "trash",   label: "Trash",   icon: "🗑️" },
  ];

  // ---------- build ----------
  function buildApp() {
    const root = el("div", "mail");
    const bar = el("div", "ml-bar");
    const composeBtn = el("button", "set-btn ml-new", "✉️  Compose");
    composeBtn.type = "button";
    composeBtn.addEventListener("click", () => openCompose(null));
    const search = el("input", "set-input ml-search");
    search.type = "search";
    search.placeholder = "Search mail\u2026";
    search.addEventListener("input", () => {
      cur.query = search.value.trim();
      cur.openId = null;
      cur.compose = null;
      renderMain();
    });
    const bulk = el("button", "set-btn ml-bulk", "Mark all read");
    bulk.type = "button";
    const status = el("div", "ml-status", "");
    bar.append(composeBtn, search, bulk, status);

    const body = el("div", "ml-body");
    const side = el("div", "ml-side");
    const mine = me();
    const acct = el("div", "ml-acct");
    const myAv = el("div", "ml-av", "🧑‍💻");
    myAv.style.cssText = "background:var(--grad);border-color:transparent;color:#fff;";
    const acctBox = el("div", "ml-acct-box");
    acctBox.appendChild(el("div", "ml-acct-name", mine.name));
    acctBox.appendChild(el("div", "ml-acct-mail", mine.email));
    acct.append(myAv, acctBox);
    const foldersEl = el("div", "ml-folders");
    side.append(acct, foldersEl);

    const main = el("div", "ml-main");
    const listEl = el("div", "ml-list");
    const readEl = el("div", "ml-read");
    const compEl = el("div", "ml-comp");
    readEl.hidden = true;
    compEl.hidden = true;
    main.append(listEl, readEl, compEl);
    body.append(side, main);
    root.append(bar, body);

    els = { root, bar, bulk, status, foldersEl, listEl, readEl, compEl, composeBtn };

    function renderFolders() {
      foldersEl.textContent = "";
      for (const f of FOLDERS) {
        const n = folderCount(f.id);
        const b = el("button", "ml-folder" + (cur.folder === f.id ? " active" : "") + (f.id === "inbox" && n > 0 ? " badge" : ""), "");
        b.type = "button";
        b.dataset.folder = f.id;
        b.appendChild(el("span", "ml-folder-ico", f.icon));
        b.appendChild(el("span", "ml-folder-label", f.label));
        if (n > 0 || f.id === "inbox") b.appendChild(el("span", "ml-folder-count", String(n)));
        b.addEventListener("click", () => {
          cur.folder = f.id;
          cur.query = "";
          search.value = "";
          cur.openId = null;
          cur.compose = null;
          renderAll();
        });
        foldersEl.appendChild(b);
      }
    }

    function updateBulk() {
      if (cur.query) { bulk.hidden = true; return; }
      if (cur.folder === "inbox") {
        bulk.hidden = false;
        bulk.textContent = "Mark all read";
        bulk.disabled = unreadInbox() === 0;
      } else if (cur.folder === "trash") {
        bulk.hidden = false;
        bulk.textContent = listFor("trash").length ? "Empty Trash" : "Empty Trash";
        bulk.disabled = listFor("trash").length === 0;
      } else {
        bulk.hidden = true;
      }
    }
    bulk.addEventListener("click", () => {
      if (cur.folder === "inbox") {
        for (const m of listFor("inbox")) m.read = true;
        save();
        renderAll();
        status.textContent = "Inbox marked as read";
        flash();
      } else if (cur.folder === "trash") {
        if (Date.now() - confirmEmptyAt > 4000) {
          confirmEmptyAt = Date.now();
          bulk.textContent = "Click again to confirm";
          bulk.classList.add("danger");
          setTimeout(() => { bulk.textContent = "Empty Trash"; bulk.classList.remove("danger"); }, 4000);
          return;
        }
        confirmEmptyAt = 0;
        state.messages = state.messages.filter((m) => m.folder !== "trash");
        save();
        renderAll();
        status.textContent = "Trash emptied";
        flash();
      }
    });

    function flash() {
      status.classList.add("flash");
      clearTimeout(flashTimer);
      flashTimer = setTimeout(() => { status.textContent = ""; status.classList.remove("flash"); }, 4000);
    }

    function renderList() {
      listEl.textContent = "";
      let items;
      if (cur.query) items = searchResults(cur.query);
      else items = listFor(cur.folder).slice().sort((a, b) => b.ts - a.ts);
      if (!items.length) {
        const empty = el("div", "ml-empty", cur.query ? "No results for \u201C" + cur.query + "\u201D" : "No messages in " + (FOLDERS.find((f) => f.id === cur.folder) || {}).label);
        empty.className = "ml-empty";
        listEl.appendChild(empty);
        return;
      }
      for (const m of items) {
        const other = m.folder === "sent" || m.folder === "drafts" ? (m.to || m.from) : m.from;
        const c = contactFor(other);
        const row = el("div", "ml-row" + (!m.read && m.folder === "inbox" ? " unread" : ""));
        row.dataset.id = m.id;
        const star = el("button", "ml-star" + (m.starred ? " on" : ""), m.starred ? "★" : "☆");
        star.type = "button";
        star.title = m.starred ? "Unstar" : "Star";
        star.addEventListener("click", (ev) => {
          ev.stopPropagation();
          m.starred = !m.starred;
          save();
          renderAll();
        });
        const av = el("div", "ml-av", c.icon);
        av.style.cssText = avStyle(c);
        const rb = el("div", "ml-rowbody");
        const line1 = el("div", "ml-line1");
        line1.appendChild(el("span", "ml-name", other.name));
        if (cur.query) line1.appendChild(el("span", "ml-tag", FOLDERS.find((f) => f.id === m.folder).label));
        line1.appendChild(el("span", "ml-date", whenStr(m.ts)));
        rb.appendChild(line1);
        rb.appendChild(el("div", "ml-subj", m.subject || "(no subject)"));
        rb.appendChild(el("div", "ml-snip", snippet(m)));
        const dot = el("div", "ml-dot", "");
        row.append(star, av, rb, dot);
        if (m.read && m.folder === "inbox") dot.hidden = true;
        row.addEventListener("click", () => openMessage(m.id));
        listEl.appendChild(row);
      }
    }

    function renderRead() {
      const m = state.messages.find((x) => x.id === cur.openId);
      readEl.textContent = "";
      if (!m) { readEl.hidden = true; listEl.hidden = false; return; }
      const other = m.folder === "sent" || m.folder === "drafts" ? (m.to || m.from) : m.from;
      const c = contactFor(other);
      const back = el("button", "set-btn ml-read-back", "← Back");
      back.type = "button";
      back.addEventListener("click", () => { cur.openId = null; renderAll(); });
      const subj = el("div", "ml-read-subject", m.subject || "(no subject)");
      const meta = el("div", "ml-read-meta");
      const av = el("div", "ml-av", c.icon);
      av.style.cssText = avStyle(c);
      const who = el("div", "ml-read-who");
      who.appendChild(el("div", "ml-read-from", other.name + (m.from && m.from.email ? "  <" + m.from.email + ">" : "")));
      who.appendChild(el("div", "ml-read-mail", (m.folder === "sent" || m.folder === "drafts" ? "To " : "From ") + fullWhen(m.ts)));
      meta.append(av, who, el("div", "ml-read-date", ""));
      const actions = el("div", "ml-read-actions");
      const btnReply = el("button", "set-btn", "↩ Reply");
      btnReply.type = "button";
      btnReply.addEventListener("click", () => openCompose({ mode: "reply", to: m.from, subject: m.subject, body: m.body, msg: m }));
      const btnFwd = el("button", "set-btn", "→ Forward");
      btnFwd.type = "button";
      btnFwd.addEventListener("click", () => openCompose({ mode: "forward", to: null, subject: m.subject, body: m.body, msg: m }));
      const btnStar = el("button", "set-btn", m.starred ? "★ Unstar" : "☆ Star");
      btnStar.type = "button";
      btnStar.addEventListener("click", () => { m.starred = !m.starred; save(); renderRead(); renderFolders(); });
      const btnDel = el("button", "set-btn" + (m.folder === "trash" ? " danger" : ""),
        m.folder === "trash" ? "Delete forever" : "🗑 Delete");
      btnDel.type = "button";
      btnDel.addEventListener("click", () => {
        if (m.folder === "trash") {
          state.messages = state.messages.filter((x) => x.id !== m.id);
          cur.openId = null;
        } else {
          m.folder = "trash";
          cur.openId = null;
          status.textContent = "Message moved to Trash";
          flash();
        }
        save();
        renderAll();
      });
      if (m.folder === "trash") {
        const btnRestore = el("button", "set-btn", "↺ Restore");
        btnRestore.type = "button";
        btnRestore.addEventListener("click", () => { m.folder = "inbox"; cur.folder = "inbox"; cur.openId = null; save(); renderAll(); });
        actions.append(btnRestore, btnStar, btnDel);
      } else {
        actions.append(btnReply, btnFwd, btnStar, btnDel);
      }
      const bodyEl = el("div", "ml-read-body", m.body || "");
      readEl.append(back, subj, meta, actions, bodyEl);
      readEl.hidden = false;
      listEl.hidden = true;
      compEl.hidden = true;
      if (!m.read && m.folder === "inbox") { m.read = true; save(); renderFolders(); }
    }

    function renderCompose() {
      const pre = cur.compose || { mode: "new", to: null, subject: "", body: "", msg: null };
      compEl.textContent = "";
      const head = el("div", "ml-comp-head");
      const back = el("button", "set-btn", "← Cancel");
      back.type = "button";
      back.addEventListener("click", () => {
        const t = toInput.value.trim(), s = subjInput.value.trim(), b = bodyTa.value.trim();
        if ((s || b || (t && pre.mode === "new")) && pre.mode !== "draft-saved") {
          state.messages.unshift({
            id: nextId(), folder: "drafts", from: me(), to: { name: t.split("@")[0] || "?", email: t || "" },
            subject: s || "(no subject)", body: b, ts: Date.now(), read: true, starred: false,
          });
          save();
          status.textContent = "Draft saved";
          flash();
        }
        cur.compose = null;
        cur.folder = pre.mode === "draft-saved" ? cur.folder : (pre.mode === "draft" ? "drafts" : cur.folder);
        renderAll();
      });
      const title = el("div", "ml-comp-title", pre.mode === "reply" ? "Reply" : pre.mode === "forward" ? "Forward" : "New message");
      head.append(back, title);

      const fTo = el("div", "ml-field");
      fTo.appendChild(el("div", "ml-field-label", "To"));
      const toInput = el("input", "set-input ml-in");
      toInput.type = "text";
      toInput.placeholder = "name@domain — or pick a contact";
      toInput.setAttribute("list", "mailContacts");
      fTo.appendChild(toInput);
      const fSubj = el("div", "ml-field");
      fSubj.appendChild(el("div", "ml-field-label", "Subject"));
      const subjInput = el("input", "set-input ml-in");
      subjInput.type = "text";
      subjInput.placeholder = "Subject";
      fSubj.appendChild(subjInput);
      const bodyTa = el("textarea", "ml-body-ta");
      bodyTa.placeholder = "Write your message\u2026";

      if (pre.mode === "reply") {
        toInput.value = pre.to ? pre.to.email : "";
        subjInput.value = (pre.subject || "").startsWith("Re:") ? pre.subject : "Re: " + (pre.subject || "");
        const orig = pre.msg;
        bodyTa.value = "\n\nOn " + fullWhen(orig.ts) + ", " + orig.from.name + " wrote:\n" +
          String(orig.body || "").split("\n").map((l) => "> " + l).join("\n");
      } else if (pre.mode === "forward") {
        subjInput.value = (pre.subject || "").startsWith("Fwd:") ? pre.subject : "Fwd: " + (pre.subject || "");
        const orig = pre.msg;
        bodyTa.value = "\n\n---------- Forwarded message ----------\nFrom: " + orig.from.name + " <" + orig.from.email + ">\nSubject: " + orig.subject + "\nDate: " + fullWhen(orig.ts) + "\n\n" + orig.body;
      } else if (pre.mode === "draft" && pre.to) {
        toInput.value = pre.to.email || "";
        subjInput.value = pre.subject || "";
        bodyTa.value = pre.body || "";
      }

      const actions = el("div", "ml-comp-actions");
      const send = el("button", "set-btn ml-send", "Send");
      send.type = "button";
      send.addEventListener("click", () => {
        const t = toInput.value.trim();
        if (!t || !t.includes("@")) {
          status.textContent = "Enter a valid recipient address";
          status.classList.add("flash");
          flash();
          return;
        }
        const c = CONTACTS.find((x) => x.email === t);
        state.messages.unshift({
          id: nextId(), folder: "sent", from: me(), to: { name: c ? c.name : t.split("@")[0], email: t },
          subject: subjInput.value.trim() || "(no subject)", body: bodyTa.value, ts: Date.now(), read: true, starred: false,
        });
        save();
        cur.compose = null;
        cur.folder = "sent";
        status.textContent = "Message sent";
        flash();
        renderAll();
        if (c) scheduleReplyTo(c);
      });
      const draft = el("button", "set-btn", "Save draft");
      draft.type = "button";
      draft.addEventListener("click", () => {
        const t = toInput.value.trim();
        if (!subjInput.value.trim() && !bodyTa.value.trim() && !t) {
          status.textContent = "Nothing to save";
          flash();
          return;
        }
        if (pre.mode === "draft" && pre.msgId) {
          const dm = state.messages.find((x) => x.id === pre.msgId);
          if (dm) {
            dm.subject = subjInput.value.trim() || "(no subject)";
            dm.body = bodyTa.value;
            dm.ts = Date.now();
            save();
            cur.compose = null;
            cur.folder = "drafts";
            renderAll();
            status.textContent = "Draft updated";
            flash();
            return;
          }
        }
        state.messages.unshift({
          id: nextId(), folder: "drafts", from: me(), to: { name: t.split("@")[0] || "?", email: t },
          subject: subjInput.value.trim() || "(no subject)", body: bodyTa.value, ts: Date.now(), read: true, starred: false,
        });
        save();
        cur.compose = null;
        cur.folder = "drafts";
        renderAll();
        status.textContent = "Draft saved";
        flash();
      });
      actions.append(send, draft);
      compEl.append(head, fTo, fSubj, bodyTa, actions);
      compEl.hidden = false;
      listEl.hidden = true;
      readEl.hidden = true;
      toInput.focus();
    }

    function renderMain() {
      if (cur.compose) { renderCompose(); return; }
      if (cur.openId) { renderRead(); return; }
      compEl.hidden = true;
      readEl.hidden = true;
      listEl.hidden = false;
      renderList();
    }

    function renderAll() {
      renderFolders();
      updateBulk();
      renderMain();
    }

    renderAllRef = renderAll;
    renderAll();
    return { root, onCloseRequest: () => {} };
  }

  // ---------- actions used by the app + window.Mail ----------
  function openMessage(id) {
    const m = state.messages.find((x) => x.id === id);
    if (!m) return;
    cur.query = "";
    cur.compose = null;
    cur.folder = m.folder === "trash" ? "trash" : m.folder === "sent" ? "sent" : m.folder === "drafts" ? "drafts" : "inbox";
    cur.openId = id;
    if (m.folder === "inbox" && !m.read) { m.read = true; save(); }
    if (els) {
      if (els.bar.querySelector(".ml-search")) els.bar.querySelector(".ml-search").value = "";
      renderAllRef();
    }
  }

  function openCompose(preset) {
    if (preset && preset.mode === "draft" && preset.msg) {
      cur.compose = { mode: "draft", to: preset.msg.to, subject: preset.msg.subject, body: preset.msg.body, msgId: preset.msg.id, msg: preset.msg };
    } else if (preset && preset.mode) {
      cur.compose = preset;
    } else {
      cur.compose = { mode: "new", to: null, subject: "", body: "", msg: null };
    }
    cur.openId = null;
    if (els) renderAllRef();
  }

  function refresh() {
    if (els) renderAllRef();
  }

  window.Mail = {
    openMessage,
    get unread() { return unreadInbox(); },
    get state() { return state; },
    refresh,
  };

  // contact datalist for the compose To field
  (function ensureContactsDatalist() {
    if (document.getElementById("mailContacts")) return;
    const dl = document.createElement("datalist");
    dl.id = "mailContacts";
    for (const c of CONTACTS) {
      const o = document.createElement("option");
      o.value = c.email;
      o.label = c.name;
      dl.appendChild(o);
    }
    document.body.appendChild(dl);
  })();

  window.AppContent = window.AppContent || {};
  window.AppContent["mail"] = function () {
    const built = buildApp();
    return { content: built.root, w: 900, h: 620, minW: 600, minH: 400, onCloseRequest: built.onCloseRequest };
  };

  maybeScheduleSim();
})();
