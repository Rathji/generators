// Webuntu Business OS — Virtual filesystem: model + default tree (Phase 4)
// An in-memory tree rooted at `/`, with the per-user home `/home/user`
// containing the business folders (Documents, Finance, Projects, Pictures,
// Downloads) plus a Desktop folder of launcher shortcuts. Every node is a
// plain, serializable object:
//   { name, type: "folder"|"file"|"shortcut", icon, meta }
// (folders carry a `children` array; file content + size live in meta;
// shortcuts carry color + meta.kind/target/appId/singleton/comingSoon).
// The module owns the tree, minimal resolution / create / remove operations,
// and the default-seed migrations (window.FS.ensureSeeds) that bring trees
// stored by earlier editions up to date without clobbering user edits.
// Persistence itself lives in src/fspersist.js.

(function () {
  "use strict";

  // Bump when the default tree adds/removes nodes that existing stored trees
  // should receive as a one-time backfill (see ensureSeeds). Version 6 is the
  // Business edition conversion: the game folders (Board Games, Video Games,
  // Music, Software) are replaced by Finance & Projects.
  const FS_VERSION = 6;

  // /Trash is the virtual recycle bin: moveToTrash relocates nodes here with
  // their original path stashed in meta.trashOriginalPath, restoreFromTrash
  // moves them back (re-creating parent folders and de-duplicating names), and
  // emptyTrash clears it. Deleting something that's already inside /Trash is
  // permanent — exactly like a real Trash folder.
  const TRASH = "/Trash";

  // Parent back-references live in a WeakMap so the tree itself stays acyclic
  // and JSON-serializable (a `_parent` field would recurse forever on stringify).
  const parentOf = new WeakMap();

  function folder(name, icon, children) {
    return { name, type: "folder", icon, meta: {}, children: children || [] };
  }
  function file(name, content, icon) {
    const bytes = new TextEncoder().encode(content || "").length;
    return {
      name,
      type: "file",
      icon: icon || "📄",
      meta: { content: content || "", size: bytes, modified: Date.now() },
    };
  }
  // .desktop-style shortcut node (Task 22): { name, type:"shortcut", icon,
  // color, meta }. meta.kind is the launch type — app (appId from the app
  // catalog), link / game (target = perchance slug), stub (planned, disabled),
  // folder (target = an FS path; used by the desktop's folder launchers).
  function shortcut(name, icon, opts) {
    opts = opts || {};
    return {
      name,
      type: "shortcut",
      icon,
      color: opts.color || null,
      meta: {
        kind: opts.kind || "stub",
        target: opts.target || null,
        appId: opts.appId || null,
        singleton: opts.singleton === true,
        comingSoon: opts.comingSoon === true,
        players: opts.players || null,
        // VGN arcade data (Task 41): era/eraName/year/genre power the chips
        // and arcade-styled game window; hubSlug/hubName drive the coming-soon
        // dialog's "Visit the hub instead" for VGN games.
        era: opts.era || null,
        eraName: opts.eraName || null,
        year: opts.year || null,
        genre: opts.genre || null,
        hubSlug: opts.hubSlug || null,
        hubName: opts.hubName || null,
        source: opts.source || null,
        created: Date.now(),
      },
    };
  }

  // Bind parent refs for a node and all its descendants (used when building
  // the default tree and when attaching newly created nodes).
  function bind(parent, child) {
    parentOf.set(child, parent);
    if (child.type === "folder") for (const c of child.children) bind(child, c);
  }

  // Desktop shortcuts seeded from main.pjs's desktopDefaults config (the
  // canonical "what the desktop shows" list). Returns shortcut nodes.
  function desktopSeed() {
    let src = [];
    try {
      src = (root && root.desktopDefaults)
        ? root.desktopDefaults.selectAll.map((n) => ({
            name: n.name.evaluateItem,
            icon: n.icon.evaluateItem,
            color: n.color ? n.color.evaluateItem : null,
            kind: n.kind ? n.kind.evaluateItem : (n.type ? n.type.evaluateItem : "app"),
            target: n.target ? n.target.evaluateItem : null,
            id: n.id ? n.id.evaluateItem : null,
            singleton: n.singleton ? n.singleton.evaluateItem === true : false,
          }))
        : [];
    } catch (e) { src = []; }
    return src.map((item) => shortcut(item.name, item.icon, {
      color: item.color,
      kind: item.kind === "link" ? "link" : (item.kind === "folder" ? "folder" : "app"),
      target: item.target || null,
      appId: item.kind === "folder" ? null : (item.id || null),
      singleton: item.singleton,
    }));
  }

  // The business edition keeps the home folders document-driven: sample files
  // ship inside buildDefaults (Documents/Finance/Projects), so no extra
  // folder-level shortcut seeds are applied to stored trees.
  function defaultSeedSpecs() {
    return [];
  }

  // Add every default seed shortcut to the given tree, skipping any folder
  // that already has a same-named child (so user edits survive re-seeding).
  function applyDefaultSeeds(tree) {
    for (const spec of defaultSeedSpecs()) {
      const dir = resolveIn(tree, spec.dir);
      if (!dir) continue;
      const node = spec.node();
      if (dir.children.some((c) => c.name === node.name)) continue;
      dir.children.push(node);
      bind(dir, node);
    }
  }

  // Add a Desktop folder (with default shortcuts) to a given tree's user home.
  function seedDesktopIn(tree) {
    const homeNode = resolveIn(tree, "/home/user");
    if (!homeNode) return null;
    const existing = homeNode.children.find((c) => c.name === "Desktop");
    if (existing) return existing;
    const desktop = folder("Desktop", "🖥️", desktopSeed());
    homeNode.children.push(desktop);
    bind(homeNode, desktop);
    return desktop;
  }

  // Keep the desktop's shortcuts in sync with main.pjs's desktopDefaults: each
  // known shortcut's kind/target/icon/color is updated in place (so config
  // changes like the Trash folder shortcut land on already-stored trees) and
  // missing shortcuts are added. User-added desktop items are never touched.
  function syncDesktopShortcuts(tree) {
    const desktop = resolveIn(tree, "/home/user/Desktop");
    if (!desktop) return false;
    let changed = false;
    const seeds = desktopSeed();
    for (const seed of seeds) {
      const existing = desktop.children.find((c) => c.type === "shortcut" && c.name === seed.name);
      if (existing) {
        const m = existing.meta = existing.meta || {};
        if (existing.icon !== seed.icon) { existing.icon = seed.icon; changed = true; }
        if (existing.color !== seed.color) { existing.color = seed.color; changed = true; }
        if (m.kind !== seed.meta.kind) { m.kind = seed.meta.kind; changed = true; }
        if (m.target !== seed.meta.target) { m.target = seed.meta.target; changed = true; }
        if (m.appId !== seed.meta.appId) { m.appId = seed.meta.appId; changed = true; }
        if (m.singleton !== seed.meta.singleton) { m.singleton = seed.meta.singleton; changed = true; }
      } else {
        desktop.children.push(seed);
        bind(desktop, seed);
        changed = true;
      }
    }
    return changed;
  }

  // Business-edition conversion (FS v6): stored trees from the gaming era are
  // migrated in place — the Board Games / Video Games / Music / Software home
  // folders and the legacy desktop hub shortcuts are dropped, Finance &
  // Projects folders (with sample files) are added and the old About file is
  // replaced with the business one. Idempotent. Returns true if changed.
  function migrateToBusiness(tree) {
    let changed = false;
    const dropNames = (parent, names) => {
      if (!parent || parent.type !== "folder") return;
      for (const name of names) {
        const i = parent.children.findIndex((c) => c.name === name);
        if (i !== -1) { parent.children.splice(i, 1); changed = true; }
      }
    };
    const home = resolveIn(tree, "/home/user");
    const desktop = resolveIn(tree, "/home/user/Desktop");
    if (desktop) {
      dropNames(desktop, ["Board Games", "Video Games", "Music", "Software",
        "Rathji's Generators", "Plugin Tutorials"]);
    }
    if (!home || home.type !== "folder") return changed;

    dropNames(home, ["Board Games", "Video Games", "Music", "Software"]);

    // Upgrade Documents: drop the gaming-era About file, add the business one.
    const docs = home.children.find((c) => c.type === "folder" && c.name === "Documents");
    if (docs) {
      const oldI = docs.children.findIndex((c) => c.name === "About Webuntu.txt");
      if (oldI !== -1) { docs.children.splice(oldI, 1); changed = true; }
      if (!docs.children.some((c) => c.name === "About Webuntu Business.txt")) {
        const n = file("About Webuntu Business.txt", "About Webuntu Business\n\nWebuntu Business 12 \"Iron Ledger\" is the business edition of the Webuntu\ndesktop: a fictional Debian-based Linux fork running the Perch Desktop\nenvironment. It ships with an embedded suite of Perchance productivity\ngenerators (The Ledger, Project Master, Atomic Roadmap, sys-plan, Diagram\nIt, Chance Code, Perch Edit, Todo Checklist, File Format Converter, Business Intelligence Dashboard, Business CRM, Business Documentation, Business PSA and the\nvoice assistants) plus native apps: Mail, Notes, File Manager, a Business\nAssistant, AI Images, Browser and realtime Perch Chat.\n");
        docs.children.push(n); bind(docs, n); changed = true;
      }
      if (!docs.children.some((c) => c.type === "folder" && c.name === "Notes")) {
        const n = folder("Notes", "📓", []);
        docs.children.push(n); bind(docs, n); changed = true;
      }
    }

    // Ensure Finance & Projects (with their sample files) exist.
    for (const spec of homeContentSpecs()) {
      let f = home.children.find((c) => c.type === "folder" && c.name === spec.name);
      if (!f) {
        f = spec;
        home.children.push(f);
        bind(home, f);
        changed = true;
      }
    }
    return changed;
  }

  // Bring the CURRENT tree up to date: adds the Desktop folder and /Trash if
  // missing, re-syncs the desktop's shortcuts to desktopDefaults, and applies
  // the Business-edition migration to trees stored before FS v6. Returns true
  // if anything changed (caller persists).
  function ensureSeeds() {
    let changed = false;
    if (!resolveIn(tree, "/home/user/Desktop")) {
      seedDesktopIn(tree);
      changed = true;
    }
    if (!resolveIn(tree, TRASH)) {
      const trashNode = folder("Trash", "🗑️", []);
      tree.children.push(trashNode);
      bind(tree, trashNode);
      changed = true;
    }
    if (syncDesktopShortcuts(tree)) changed = true;
    if (!tree.meta.fsVersion || tree.meta.fsVersion < FS_VERSION) {
      if (migrateToBusiness(tree)) changed = true;
      tree.meta.fsVersion = FS_VERSION;
    }
    return changed;
  }

  // The standard business home folders (fresh tree + migration share this).
  function homeContentSpecs() {
    return [
      folder("Finance", "💰", [
        file("Chart of Accounts.txt", "Chart of Accounts (sample)\n\n1000  Cash\n1100  Accounts receivable\n1200  Inventory\n1500  Equipment\n2000  Accounts payable\n2100  Payroll liabilities\n3000  Owner's equity\n4000  Revenue — services\n4100  Revenue — products\n5000  Cost of goods sold\n6000  Operating expenses\n\nManage the real books in The Ledger app (Start menu → Finance).\n"),
        file("Invoice — Sample #1001.txt", "ACME CONSULTING LTD\n\n" +
          "INVOICE #1001 · 1 July 2026\n\n" +
          "Bill to: Northwind Inc.\n" +
          "Attn: Marcus Cole\n\n" +
          "  Q3 planning workshop ........ 3 days @ 900 ....... 2,700.00\n" +
          "  Systems architecture review .. 1 day @ 950 ......... 950.00\n" +
          "  Expenses (travel) ........................... 142.80\n\n" +
          "Subtotal ............................... 3,792.80\n" +
          "Tax (5%) ............................... 189.64\n" +
          "TOTAL DUE .............................. 3,982.44\n\n" +
          "Payment due within 30 days. Thank you for your business!\n"),
        file("Budget — Q3 Draft.txt", "Q3 BUDGET (DRAFT)\n\n" +
          "Revenue target ............. 48,000\n" +
          "  Services ................ 38,000\n" +
          "  Products ................ 10,000\n\n" +
          "Expenses .................. 21,500\n" +
          "  Payroll ................. 12,000\n" +
          "  Software & tools ......... 2,400\n" +
          "  Marketing ............... 3,200\n" +
          "  Office .................. 2,100\n" +
          "  Contingency ............. 1,800\n\n" +
          "Projected margin ........... 26,500 (55%)\n"),
      ]),
      folder("Projects", "🗂️", [
        file("Project Pipeline.txt", "PROJECT PIPELINE\n\n" +
          "1. Ledger migration ........ owner: You ......... in progress\n" +
          "2. Website relaunch ........ owner: Clara ....... planning\n" +
          "3. Mobile app v2 ........... owner: Marcus ...... backlog\n" +
          "4. Invoice automation ...... owner: You ......... idea\n\n" +
          "Drive execution in Project Master (Start menu → Planning) and\n" +
          "Atomic Roadmap for AI-broken-down backlogs.\n"),
        file("Q3 Launch Plan.txt", "Q3 LAUNCH PLAN\n\n" +
          "Week 1   Finalise scope + budget\n" +
          "Week 2   Wireframes & stakeholder review\n" +
          "Week 3   Build sprint 1 (ledger sync)\n" +
          "Week 4   Build sprint 2 (reporting)\n" +
          "Week 5   UAT + fixes\n" +
          "Week 6   Go-live + training\n"),
      ]),
    ];
  }

  function buildDefaults() {
    const homeKids = [
      folder("Documents", "📄", [
        file("About Webuntu Business.txt", "About Webuntu Business\n\nWebuntu Business 12 \"Iron Ledger\" is the business edition of the Webuntu\ndesktop: a fictional Debian-based Linux fork running the Perch Desktop\nenvironment. It ships with an embedded suite of Perchance productivity\ngenerators (The Ledger, Project Master, Atomic Roadmap, sys-plan, Diagram\nIt, Chance Code, Perch Edit, Todo Checklist, File Format Converter, Business Intelligence Dashboard, Business CRM, Business Documentation, Business PSA and the\nvoice assistants) plus native apps: Mail, Notes, File Manager, a Business\nAssistant, AI Images, Browser and realtime Perch Chat.\n"),
        folder("Notes", "📓", []),
      ]),
    ];
    for (const spec of homeContentSpecs()) homeKids.push(spec);
    homeKids.push(folder("Pictures", "🖼️", []));
    homeKids.push(folder("Downloads", "⬇️", [
      file("readme.txt", "Files you download land in this folder.\n"),
    ]));
    const tree = folder("/", null, [
      folder("home", "🏠", [
        folder("user", "👤", homeKids),
      ]),
      folder("Trash", "🗑️", []),
    ]);
    bind(null, tree);
    seedDesktopIn(tree);
    applyDefaultSeeds(tree);
    tree.meta.fsVersion = FS_VERSION;
    return tree;
  }

  let tree = buildDefaults();

  // ---------- resolution ----------
  function resolveIn(tree, path) {
    let node = tree;
    for (const p of String(path).split("/").filter(Boolean)) {
      if (!node || node.type !== "folder") return null;
      node = node.children.find((c) => c.name === p) || null;
      if (!node) return null;
    }
    return node;
  }
  // Accepts a node object or a path string ("/home/user/...", leading slash
  // optional). Full parse/cd semantics are in src/fspath.js (Task 20).
  function resolve(path) {
    if (path && typeof path === "object") return path;
    return resolveIn(tree, path);
  }

  function getParent(node) { return parentOf.get(node) || null; }

  // Canonical path string for any node ("/" for the root).
  function getPath(node) {
    if (!node) return null;
    const parts = [];
    let cur = node;
    while (cur && cur !== tree) { parts.unshift(cur.name); cur = parentOf.get(cur); }
    return "/" + parts.join("/");
  }

  // ---------- queries ----------
  function isFolder(n) { return !!(n && n.type === "folder"); }
  function isFile(n) { return !!(n && n.type === "file"); }
  function isShortcut(n) { return !!(n && n.type === "shortcut"); }
  function exists(path) { return resolve(path) !== null; }
  function list(path) {
    const n = resolve(path);
    return isFolder(n) ? n.children.slice() : null;
  }
  function home() { return resolve("/home/user"); }

  // ---------- mutations (create/remove — used by Terminal, File Manager,
  // Notes, Save dialogs in later phases) ----------
  function create(parentPath, spec) {
    const parent = resolve(parentPath);
    if (!isFolder(parent)) return null;
    const node = Object.assign({ children: undefined }, spec);
    node.children = node.type === "folder" ? (spec.children || []) : undefined;
    parent.children.push(node);
    bind(parent, node);
    if (window.FS.onChange) window.FS.onChange();
    return node;
  }

  function remove(path) {
    const node = resolve(path);
    if (!node || node === tree) return false;
    const parent = getParent(node);
    if (!parent) return false;
    const i = parent.children.indexOf(node);
    if (i === -1) return false;
    parent.children.splice(i, 1);
    if (window.FS.onChange) window.FS.onChange();
    return true;
  }

  // ---------- copy / move (Task 67 — File Manager clipboard) ----------
  // Deep-copy a node into an unattached spec (recursive for folders; meta is
  // JSON-deep-copied so the copy never aliases the source's meta objects).
  function deepSpec(node) {
    const spec = { name: node.name, type: node.type, icon: node.icon };
    if (node.color) spec.color = node.color;
    spec.meta = node.meta ? JSON.parse(JSON.stringify(node.meta)) : {};
    if (node.type === "folder") spec.children = (node.children || []).map(deepSpec);
    return spec;
  }

  // First free sibling name for a copy: "name", "name (copy)", "name (copy 2)"…
  function uniqueCopyName(dirPath, baseName) {
    const dir = resolve(dirPath);
    const existing = new Set(isFolder(dir) ? (dir.children || []).map((c) => c.name) : []);
    const st = sanitizeName(baseName);
    const base = st.ok ? st.name : "item";
    if (!existing.has(base)) return base;
    const m = /^(.*?)\s*\(\d+\)$/.exec(base);
    const root = m ? m[1].trim() : base;
    let n = 1;
    for (;;) {
      const cand = root + " (copy" + (n > 1 ? " " + n : "") + ")";
      if (!existing.has(cand)) return cand;
      n++;
      if (n > 1000) return root + " (copy " + Date.now() + ")";
    }
  }

  const REFUSE = { "/": true }; // can't copy/move the filesystem root

  function destIsSameOrInside(srcP, destP) {
    return srcP === destP || destP.startsWith(srcP + "/");
  }

  // Copy srcPath into destDirPath (whole subtree). Refuses the root and
  // copying a folder into itself/its descendants. Name conflicts resolve with
  // a " (copy)" suffix. Returns { ok:true, path } or { ok:false, error }.
  function copyInto(srcPath, destDirPath) {
    const src = resolve(srcPath);
    const dest = resolve(destDirPath);
    if (!src) return { ok: false, error: "Source not found." };
    if (!isFolder(dest)) return { ok: false, error: "Destination isn't a folder." };
    const srcP = getPath(src), destP = getPath(dest);
    if (REFUSE[srcP] || srcP === getPath(home())) return { ok: false, error: "Refusing to copy that." };
    if (destIsSameOrInside(srcP, destP)) return { ok: false, error: "Can't copy a folder into itself." };
    const spec = deepSpec(src);
    spec.name = uniqueCopyName(destP, src.name);
    const node = create(destP, spec);
    return node ? { ok: true, path: getPath(node) } : { ok: false, error: "Copy failed." };
  }

  // Move srcPath into destDirPath. Same rules as copyInto plus a same-folder
  // guard ("already there"). On success the source is removed.
  function moveInto(srcPath, destDirPath) {
    const src = resolve(srcPath);
    const dest = resolve(destDirPath);
    if (!src) return { ok: false, error: "Source not found." };
    if (!isFolder(dest)) return { ok: false, error: "Destination isn't a folder." };
    const srcP = getPath(src), destP = getPath(dest);
    if (REFUSE[srcP] || srcP === getPath(home())) return { ok: false, error: "Refusing to move that." };
    if (destIsSameOrInside(srcP, destP)) return { ok: false, error: "Can't move a folder into itself." };
    const srcParent = getParent(src);
    if (srcParent && getPath(srcParent) === destP) return { ok: false, error: "\"" + src.name + "\" is already in that folder." };
    const spec = deepSpec(src);
    spec.name = uniqueCopyName(destP, src.name);
    const node = create(destP, spec);
    if (!node) return { ok: false, error: "Move failed." };
    remove(srcP);
    return { ok: true, path: getPath(node) };
  }

  // Validate a node name — shared by File Manager, Terminal and Save dialogs.
  // Returns { ok:true, name } (trimmed) or { ok:false, error }.
  function sanitizeName(name) {
    const s = String(name == null ? "" : name).trim();
    if (!s) return { ok: false, error: "Name can't be empty." };
    if (s === "." || s === "..") return { ok: false, error: "That name is reserved." };
    if (s.includes("/")) return { ok: false, error: "Names can't contain a slash (/)." };
    if (s.length > 120) return { ok: false, error: "Name is too long (120 characters max)." };
    return { ok: true, name: s };
  }

  // Rename a node in place (fires onChange like every other mutation).
  // Returns { ok:true, node } or { ok:false, error }.
  function rename(path, newName) {
    const node = resolve(path);
    if (!node) return { ok: false, error: "ENOENT: no such file or directory." };
    if (node === tree) return { ok: false, error: "The root folder can't be renamed." };
    const parent = getParent(node);
    if (!parent) return { ok: false, error: "That node can't be renamed." };
    const v = sanitizeName(newName);
    if (!v.ok) return v;
    if (parent.children.some((c) => c !== node && c.name === v.name)) {
      return { ok: false, error: "An item named \u201c" + v.name + "\u201d already exists here." };
    }
    node.name = v.name;
    if (window.FS.onChange) window.FS.onChange();
    return { ok: true, node };
  }

  // Replace the whole tree with a persisted one (parents are re-bound via the
  // WeakMap). Never fires onChange — the caller decides whether to re-save.
  function load(loadedTree) {
    if (!loadedTree || typeof loadedTree !== "object" || typeof loadedTree.name !== "string") return tree;
    bind(null, loadedTree);
    tree = loadedTree;
    return tree;
  }

  // ---------- Trash (Task 53) ----------

  // True when the path is /Trash itself or a node inside it.
  function isInTrash(path) {
    const p = "/" + String(path || "").replace(/^\/+/, "");
    return p === TRASH || p.indexOf(TRASH + "/") === 0;
  }

  // Move a node (file/folder/shortcut) to /Trash, remembering its original
  // path (meta.trashOriginalPath) and when it was deleted. Returns
  // { ok:true, path } (the new trash path) or { ok:false, error }.
  function moveToTrash(path) {
    const node = resolve(path);
    if (!node || node === tree) return { ok: false, error: "Nothing to move." };
    const origPath = getPath(node);
    if (!origPath || isInTrash(origPath)) return { ok: false, error: "Already in the Trash." };
    const oldParent = getParent(node);
    const trashNode = resolve(TRASH);
    if (!oldParent || !isFolder(trashNode)) return { ok: false, error: "The Trash folder is missing." };

    let name = node.name;
    if (trashNode.children.some((c) => c.name === name)) {
      let i = 1;
      while (trashNode.children.some((c) => c.name === name + " (" + i + ")")) i++;
      name = name + " (" + i + ")";
    }
    node.name = name;
    node.meta = node.meta || {};
    node.meta.trashOriginalPath = origPath;
    node.meta.trashDeletedAt = Date.now();

    oldParent.children.splice(oldParent.children.indexOf(node), 1);
    trashNode.children.push(node);
    bind(trashNode, node);
    if (window.FS.onChange) window.FS.onChange();
    return { ok: true, path: getPath(node) };
  }

  // Move a node back out of /Trash to meta.trashOriginalPath, re-creating any
  // parent folders that no longer exist and de-duplicating a name that's now
  // taken (a " (restored)" suffix is appended). Returns { ok:true, path } or
  // { ok:false, error }.
  function restoreFromTrash(path) {
    const node = resolve(path);
    if (!node || node === tree) return { ok: false, error: "Nothing to restore." };
    const curPath = getPath(node);
    if (!curPath || !isInTrash(curPath)) return { ok: false, error: "That item isn't in the Trash." };
    const m = node.meta || {};
    const origPath = m.trashOriginalPath;
    if (!origPath || origPath === TRASH || origPath.charAt(0) !== "/") {
      return { ok: false, error: "This item can't be restored." };
    }
    const parts = origPath.split("/").filter(Boolean);
    const name = parts.pop();
    let parent = tree;
    for (const part of parts) {
      let child = parent.children.find((c) => c.name === part);
      if (!child) {
        child = { name: part, type: "folder", icon: "📁", meta: {}, children: [] };
        parent.children.push(child);
        bind(parent, child);
      }
      if (!isFolder(child)) return { ok: false, error: "A file is in the way of the restore path." };
      parent = child;
    }
    let destName = name;
    if (parent.children.some((c) => c.name === destName)) {
      let i = 1;
      while (parent.children.some((c) => c.name === name + " (restored" + (i === 1 ? "" : " " + i) + ")")) i++;
      destName = name + " (restored" + (i === 1 ? "" : " " + i) + ")";
    }
    const trashParent = getParent(node);
    if (!trashParent) return { ok: false, error: "This item can't be restored." };
    node.name = destName;
    delete m.trashOriginalPath;
    delete m.trashDeletedAt;
    trashParent.children.splice(trashParent.children.indexOf(node), 1);
    parent.children.push(node);
    bind(parent, node);
    if (window.FS.onChange) window.FS.onChange();
    return { ok: true, path: getPath(node) };
  }

  // Permanently delete every item in /Trash. Returns true if anything was
  // removed.
  function emptyTrash() {
    const trashNode = resolve(TRASH);
    if (!isFolder(trashNode)) return false;
    const had = trashNode.children.length > 0;
    trashNode.children.length = 0;
    if (had && window.FS.onChange) window.FS.onChange();
    return had;
  }

  function reset(silent) {
    tree = buildDefaults();
    if (!silent && window.FS.onChange) window.FS.onChange();
    return tree;
  }

  window.FS = {
    get root() { return tree; },
    resolve,
    getPath,
    getParent,
    isFolder,
    isFile,
    isShortcut,
    exists,
    list,
    home,
    create,
    remove,
    copyInto,
    moveInto,
    deepSpec,
    uniqueCopyName,
    rename,
    sanitizeName,
    isInTrash,
    moveToTrash,
    restoreFromTrash,
    emptyTrash,
    reset,
    load,
    ensureSeeds,
    onChange: null,   // set by FSPersist — fired after every mutation
  };
})();
