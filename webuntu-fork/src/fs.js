// Webuntu OS — Virtual filesystem: model + default tree (Phase 4, Tasks 19/22)
// An in-memory tree rooted at `/`, with the per-user home `/home/user`
// containing the seven predefined folders (Board Games, Video Games,
// Documents, Pictures, Music, Downloads, Software) plus a Desktop folder of
// launcher shortcuts (Task 22). Every node is a plain, serializable object:
//   { name, type: "folder"|"file"|"shortcut", icon, meta }
// (folders carry a `children` array; file content + size live in meta;
// shortcuts carry color + meta.kind/target/appId/singleton/comingSoon).
// The module owns the tree, minimal resolution / create / remove operations,
// and the default-seed migrations (window.FS.ensureSeeds) that bring trees
// stored by earlier build phases up to date without clobbering user edits.
// Persistence itself lives in src/fspersist.js (Task 21).

(function () {
  "use strict";

  // Bump when the default tree adds/removes nodes that existing stored trees
  // should receive as a one-time backfill (see ensureSeeds).
  const FS_VERSION = 5;

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

  // The default shortcut seeds that ship inside the home folders (added in
  // Task 22). Specs are { dir, node } — node() returns a fresh shortcut node.
  function defaultSeedSpecs() {
    return [
      { dir: "/home/user/Board Games", node: () => shortcut("Boardgame Network", "🎲", { kind: "hub", target: "bgn-boardgame-network", color: "#7c6cff" }) },
      { dir: "/home/user/Video Games", node: () => shortcut("Video Game Network", "🕹️", { kind: "hub", target: "vgn-video-game-network", color: "#22d3ee", hubName: "Video Game Network", hubSlug: "vgn-video-game-network" }) },
      { dir: "/home/user/Video Games", node: () => shortcut("Starfall Odyssey", "🌠", { kind: "stub", color: "#f472b6", comingSoon: true, hubName: "Video Game Network", hubSlug: "vgn-video-game-network" }) },
      { dir: "/home/user/Software", node: () => shortcut("Terminal", "⌨️", { kind: "app", appId: "terminal", color: "#8b5cf6" }) },
      { dir: "/home/user/Software", node: () => shortcut("Settings", "⚙️", { kind: "app", appId: "settings", color: "#94a3b8", singleton: true }) },
      { dir: "/home/user/Software", node: () => shortcut("Notes", "📓", { kind: "app", appId: "notes", color: "#f59e0b" }) },
      { dir: "/home/user/Software", node: () => shortcut("Webuntu Software Center", "🧩", { kind: "app", appId: "software-center", color: "#94a3b8", singleton: true }) },
    ];
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

  // Task 37 — populate /home/user/Board Games with the BGN genre subfolders and
  // curated game shortcuts, driven by main.pjs's bgnGenres/bgnGames lists.
  // Idempotent: existing nodes are never duplicated or clobbered (a same-slug
  // shortcut or same-named folder is left alone). Also upgrades the old
  // "Boardgame Network" link shortcut to a hub shortcut. Returns nodes added.
  function seedBoardGames(tree) {
    let count = 0;
    const board = resolveIn(tree, "/home/user/Board Games");
    if (!board) return 0;

    const hub = board.children.find(
      (c) => c.type === "shortcut" && c.name === "Boardgame Network"
    );
    if (hub && hub.meta && hub.meta.kind !== "hub") {
      hub.meta.kind = "hub";
      hub.meta.target = hub.meta.target || "bgn-boardgame-network";
      count++;
    }

    let genres = [];
    try {
      genres = (root && root.bgnGenres)
        ? root.bgnGenres.selectAll.map((n) => ({
            key: n.key.evaluateItem,
            name: n.name.evaluateItem,
            icon: n.icon ? n.icon.evaluateItem : null,
            color: n.color ? n.color.evaluateItem : null,
          }))
        : [];
    } catch (e) { genres = []; }

    const genreName = (key) => {
      const g = genres.find((x) => x.key === key);
      return g ? g.name : null;
    };

    for (const g of genres) {
      if (!g.key || !g.name) continue;
      if (board.children.some((c) => c.type === "folder" && c.name === g.name)) continue;
      board.children.push(folder(g.name, g.icon || "📁", []));
      bind(board, board.children[board.children.length - 1]);
      count++;
    }

    let games = [];
    try {
      games = (root && root.bgnGames)
        ? root.bgnGames.selectAll.map((n) => ({
            slug: n.slug.evaluateItem,
            title: n.title.evaluateItem,
            icon: n.icon ? n.icon.evaluateItem : null,
            color: n.color ? n.color.evaluateItem : null,
            players: n.players ? n.players.evaluateItem : null,
            genre: n.genre ? n.genre.evaluateItem : null,
            comingSoon: n.comingSoon ? n.comingSoon.evaluateItem === true : false,
          }))
        : [];
    } catch (e) { games = []; }

    for (const g of games) {
      if (!g.slug || !g.title) continue;
      const parent = board.children.find(
        (c) => c.type === "folder" && c.name === genreName(g.genre)
      );
      if (!parent) continue;
      if (parent.children.some(
        (c) => c.type === "shortcut" && c.meta && c.meta.target === g.slug
      )) continue;
      parent.children.push(shortcut(g.title, g.icon || "🎲", {
        kind: "game",
        target: g.slug,
        color: g.color,
        players: g.players,
        comingSoon: g.comingSoon === true,
      }));
      bind(parent, parent.children[parent.children.length - 1]);
      count++;
    }
    return count;
  }

  // Task 41 — populate /home/user/Video Games with the VGN era subfolders and
  // curated game shortcuts, driven by main.pjs's vgnEras/vgnGames lists.
  // Idempotent, mirroring seedBoardGames: existing nodes are never duplicated
  // or clobbered. Also upgrades the old "Video Game Network" link shortcut to
  // a hub shortcut (Task 43). Returns nodes added.
  function seedVideoGames(tree) {
    let count = 0;
    const vids = resolveIn(tree, "/home/user/Video Games");
    if (!vids) return 0;

    const hub = vids.children.find(
      (c) => c.type === "shortcut" && c.name === "Video Game Network"
    );
    if (hub && hub.meta && hub.meta.kind !== "hub") {
      hub.meta.kind = "hub";
      hub.meta.target = hub.meta.target || "vgn-video-game-network";
      count++;
    }

    let eras = [];
    try {
      eras = (root && root.vgnEras)
        ? root.vgnEras.selectAll.map((n) => ({
            key: n.key.evaluateItem,
            name: n.name.evaluateItem,
            icon: n.icon ? n.icon.evaluateItem : null,
            color: n.color ? n.color.evaluateItem : null,
          }))
        : [];
    } catch (e) { eras = []; }

    const eraName = (key) => {
      const g = eras.find((x) => x.key === key);
      return g ? g.name : null;
    };

    for (const g of eras) {
      if (!g.key || !g.name) continue;
      if (vids.children.some((c) => c.type === "folder" && c.name === g.name)) continue;
      vids.children.push(folder(g.name, g.icon || "📁", []));
      bind(vids, vids.children[vids.children.length - 1]);
      count++;
    }

    let games = [];
    try {
      games = (root && root.vgnGames)
        ? root.vgnGames.selectAll.map((n) => ({
            slug: n.slug.evaluateItem,
            title: n.title.evaluateItem,
            icon: n.icon ? n.icon.evaluateItem : null,
            color: n.color ? n.color.evaluateItem : null,
            players: n.players ? n.players.evaluateItem : null,
            era: n.era ? n.era.evaluateItem : null,
            genre: n.genre ? n.genre.evaluateItem : null,
            year: n.year ? n.year.evaluateItem : null,
            comingSoon: n.comingSoon ? n.comingSoon.evaluateItem === true : false,
          }))
        : [];
    } catch (e) { games = []; }

    for (const g of games) {
      if (!g.slug || !g.title) continue;
      const parent = vids.children.find(
        (c) => c.type === "folder" && c.name === eraName(g.era)
      );
      if (!parent) continue;
      if (parent.children.some(
        (c) => c.type === "shortcut" && c.meta && c.meta.target === g.slug
      )) continue;
      parent.children.push(shortcut(g.title, g.icon || "🕹️", {
        kind: "game",
        target: g.slug,
        color: g.color,
        players: g.players,
        comingSoon: g.comingSoon === true,
        era: g.era,
        eraName: eraName(g.era),
        genre: g.genre,
        year: g.year,
        hubName: "Video Game Network",
        hubSlug: "vgn-video-game-network",
      }));
      bind(parent, parent.children[parent.children.length - 1]);
      count++;
    }
    return count;
  }

  // Task 44 — populate /home/user/Software/Developer with link-shortcuts to the
  // VGN and BGN game-making templates (root.vgnTemplates / root.bgnTemplates).
  // Templates are tools, not games: kind "link" opens the top-level page, and a
  // README file in the folder spells that out. Idempotent like the seeders.
  function seedDeveloper(tree) {
    let count = 0;
    const soft = resolveIn(tree, "/home/user/Software");
    if (!soft) return 0;

    let dev = soft.children.find((c) => c.type === "folder" && c.name === "Developer");
    if (!dev) {
      dev = folder("Developer", "🧰", []);
      soft.children.push(dev);
      bind(soft, dev);
      count++;
    }

    const readmeName = "README — templates.txt";
    if (!dev.children.some((c) => c.type === "file" && c.name === readmeName)) {
      dev.children.push(file(readmeName,
        "Game-making templates (Webuntu 12)\n\n" +
        "The shortcuts in this folder are TOOLS for making games — not games\n" +
        "themselves. Each one opens the generator's own page so you can remix\n" +
        "it into a new project.\n\n" +
        "  VGN — video game templates (generic, physics, platform, shooter,\n" +
        "        text, turn-based strategy, AI chat RPG, turn-based JRPG, text RPG)\n" +
        "  BGN — board game templates (blank, strategy, decks, pen & paper, hex)\n" +
        "        plus BGN tooling (management dashboard, standards checker,\n" +
        "        documentation reference, cover studio)\n"));
      bind(dev, dev.children[dev.children.length - 1]);
      count++;
    }

    function addTemplates(listName, source) {
      let items = [];
      try {
        items = (root && root[listName])
          ? root[listName].selectAll.map((n) => ({
              slug: n.slug.evaluateItem,
              title: n.title.evaluateItem,
              icon: n.icon ? n.icon.evaluateItem : null,
              color: n.color ? n.color.evaluateItem : null,
            }))
          : [];
      } catch (e) { items = []; }
      for (const t of items) {
        if (!t.slug) continue;
        if (dev.children.some(
          (c) => c.type === "shortcut" && c.meta && c.meta.target === t.slug
        )) continue;
        dev.children.push(shortcut(t.title, t.icon || "🧰", {
          kind: "link",
          target: t.slug,
          color: t.color,
          source,
        }));
        bind(dev, dev.children[dev.children.length - 1]);
        count++;
      }
    }
    addTemplates("vgnTemplates", "VGN");
    addTemplates("bgnTemplates", "BGN");
    return count;
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

  // Bring the CURRENT tree up to date with the default seeds: adds the
  // Desktop folder (Task 22) and, for trees stored before this version, the
  // home-folder shortcuts (Task 22) plus the BGN Board Games folder contents
  // (Task 37). Returns true if anything changed (caller persists).
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
      applyDefaultSeeds(tree);
      seedBoardGames(tree);
      seedVideoGames(tree);
      seedDeveloper(tree);
      tree.meta.fsVersion = FS_VERSION;
      changed = true;
    }
    return changed;
  }

  function buildDefaults() {
    const tree = folder("/", null, [
      folder("home", "🏠", [
        folder("user", "👤", [
          folder("Board Games", "🎲", [
            file("Welcome to the Boardgame Network.txt",
              "Webuntu 12 \u00b7 Perch Mint\n\n" +
              "The Board Games folder hosts the Boardgame Network (BGN) hub\n" +
              "shortcut; curated game shortcuts arrive in Task 37.\n"),
          ]),
          folder("Video Games", "🕹️", [
            file("Welcome to the Video Game Network.txt",
              "Webuntu 12 \u00b7 Perch Mint\n\n" +
              "The Video Games folder hosts the Video Game Network (VGN) hub\n" +
              "shortcut; curated game shortcuts arrive in Task 41.\n"),
          ]),
          folder("Documents", "📄", [
            file("About Webuntu.txt",
              "About Webuntu\n\n" +
              "Webuntu 12 \"Perch Mint\" is a fictional Debian-based Linux fork\n" +
              "running the Perch Desktop environment. This filesystem is the\n" +
              "in-memory model that the File Manager, Terminal and Save dialogs\n" +
              "will all read from.\n"),
            folder("Notes", "📓", []),   // the Notes app (Task 35) saves here
          ]),
          folder("Pictures", "🖼️", []),
          folder("Music", "🎵", []),
          folder("Downloads", "⬇️", [
            file("readme.txt", "Files you download land in this folder.\n"),
          ]),
          folder("Software", "💿", []),
        ]),
      ]),
      folder("Trash", "🗑️", []),
    ]);
    bind(null, tree);
    seedDesktopIn(tree);
    applyDefaultSeeds(tree);
    seedBoardGames(tree);
    seedVideoGames(tree);
    seedDeveloper(tree);
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
