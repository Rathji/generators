# Repo ↔ live-generator sync process

A runbook for round-tripping changes between this repo and a live perchance.org generator you
own. Capture is automated; **push back into perchance is still manual**, and the reason is a
hard limitation rather than missing effort — see "Why the push direction is still manual" below.

**Scope note:** this only works on a generator **you own** (perchance's "duplicate" copies a
generator into your account under a new slug — `q8tgpbvj6l` is one such copy, confirmed owned
2026-08-10). Saving to a generator you don't own forks it into a new copy instead of updating it.

---

## What changed on 2026-08-10 (read this before using any command below)

This document was rewritten because three of its load-bearing claims had gone false. If you have
an older copy of it in your head, these are the corrections:

1. **The capture tool moved.** It is no longer in `perchance-generator-reference`. It lives in
   **`Rathji/perchance-manager`**, and `--out-dir` is now a required flag with no default.
2. **`srcManifest` files can be fetched automatically now** (`--src`). The hand-rolled `curl` loop
   this document used to prescribe is obsolete.
3. **`q8tgpbvj6l` no longer keeps its logic in `src/main.js`.** It was inlined into the HTML
   panel, its `srcManifest` is now `{}`, and the whole "why manual" rationale that rested on the
   `src/` upload path no longer applies to it. The real reason push is manual is `/api/save`.

There is also a **live hazard** introduced by that same rewrite — see "⚠ Do not press that
generator's Backup button at this repo" below. Read it before clicking anything.

---

## The three directions

### 1. Capture: live generator → this repo

Preferred — one command, handles `srcManifest` and the file naming:

```
node <path-to-perchance-manager>/tools/fleet-backup.mjs \
  --repo "<path-to-this-repo>" <slug> [<slug> ...]
```

Add `--push` to push, `--dry-run` to see the plan without changing anything, and
`--list-repo-slugs` to see what is already backed up here. There is deliberately no `--all`
flag: the scope is always an explicit slug list.

Under the hood that runs the capture tool with `--src --layout perchance`. To call it directly:

```
node <path-to-perchance-manager>/tools/perchance-fetch.mjs <slug> \
  --out-dir "<path-to-this-repo>" --force --no-source --src --layout perchance
```

`--src` downloads every `srcManifest` entry to `<slug>/src/<declared filename>` from
`https://user.uploads.dev/file/<key>`, verifying each downloaded byte count against the size the
manifest declares. That host is public, unauthenticated, and CORS-open, confirmed across five
keys in three generators. A mismatch or non-200 is reported per file rather than aborting the run.

Commit and push after capturing.

### 2. Edit: change files in this repo

Ordinary git workflow. Edit the panel files or `src/*`, commit, push. Nothing perchance-specific
here — the repo is just files until step 3.

### 3. Push: this repo → live generator (the manual part)

1. Open `https://perchance.org/<slug>#edit`, logged in as the owning account.
2. **Lists panel** ← the slug's `main.pjs` (or `lists.txt` in the 41 directories still using the
   old naming — see "Two naming layouts" below). Select all, replace.
3. **HTML panel** ← the slug's `index.html` (or `html.txt`). Same.
4. **`src/*` files**, if the generator has any: open the editor's files panel and re-upload the
   changed file so it replaces the manifest entry perchance tracks. *(Exact UI location still
   undocumented here — note it on your first pass.)*
5. Click **Save**. If perchance shows a staleness prompt ("It looks like you're editing an old
   version…"), something changed the live copy since your capture — **do not force through it**.
   Re-capture (step 1) and re-apply your edit on top of the current version.
6. Perchance keeps its own version history (the **backups** button in the editor). Your pre-edit
   state is recoverable there independently of this repo.

### 4. Verify: re-capture and diff

```
node <path-to-perchance-manager>/tools/fleet-backup.mjs --repo "<path-to-this-repo>" <slug> --dry-run
# then, for real:
node <path-to-perchance-manager>/tools/fleet-backup.mjs --repo "<path-to-this-repo>" <slug>
git diff <slug>/
```

An empty diff confirms the live generator matches what is committed here. With `--src` this now
covers `src/*` too, so unlike the old process there is no separate manual re-check.

---

## Why the push direction is still manual

**Not for the reason this document used to give.** The old rationale was that `q8tgpbvj6l` kept
its logic in a `srcManifest` file that the two panel editors can't reach, so a panel-only tool
would report success while changing nothing. That was true when it was written and is no longer
true of that generator (see below) — but it was never the real blocker anyway.

The real blocker is **`POST /api/save`**, perchance's actual generator-write endpoint. Its request
body is built from `this.store.data.user` — the **editor page's** logged-in session store,
carrying `email` and `sessionToken`. Two consequences:

- A perchance **plugin** runs in the generator's sandboxed output iframe and has no access to that
  store. No plugin can write generator source, `github-data-plugin` included. This is a structural
  limit, not a gap in the plugin.
- The endpoint also runs a staleness/conflict protocol — a `"stale"` response triggers a three-way
  `/src` rebase before any retry, and `forceSaveDespiteStaleness` exists as an explicit opt-in
  escape hatch. Any future automation must honor that machinery rather than bypass it.

Automating step 3 therefore means holding real account session credentials **outside** a plugin
sandbox — a logged-in browser session, or a script that calls `/api/login`/`/api/verify` and keeps
the resulting `sessionToken`. That is a separate, deliberately-scoped project, tracked as **T-13**
in `perchance-manager/docs/open-threads.md`. Until it exists, step 3 stays manual so that this
process is honest about what it does.

---

## ⚠ Do not press `q8tgpbvj6l`'s Backup button at this repo

The live generator has a **GitHub Backup screen** in its menu (`#ghScreen`). Verified in the
2026-08-10 capture, `index.html:4031`, its Backup action calls:

```js
const r = await api.backupGenerator(repo);
```

`backupGenerator()` hardcodes its target paths — `plugins/github-data-plugin/main.pjs:414` pushes
literally `{ "main.pjs": code, "index.html": html }`, at the **repository root**, with no path or
prefix option. Its Restore action reads the same root paths (`index.html:4050-4051`,
`api.raw(repo, 'main.pjs')` / `api.raw(repo, 'index.html')`).

Pointed at this repo, that would write a root-level `main.pjs` and `index.html` — *not*
`q8tgpbvj6l/main.pjs` — and a Restore would read whichever generator wrote them last. In a
multi-generator repo those root paths are a shared, unlabelled slot every generator collides in.
Neither file currently exists at this repo's root; keep it that way. This is also why pointing
Restore here 404'd when it was tried on 2026-08-10: there was no root `main.pjs` to find, and in
this repo there never should be.

Use `fleet-backup.mjs` (step 1) instead. It writes `<slug>/`, which is the layout this repo
actually uses.

---

## The state of `q8tgpbvj6l`, precisely

This slug is the one used to develop the process, so its oddities are worth stating exactly rather
than leaving as folklore. All of the following was verified on 2026-08-10 against the committed
files.

**Its logic was inlined into the HTML panel.** `meta.json` now declares `"srcManifest": {}`. The
old capture `html.txt` (582 lines) carries `<script type="module" src="src/main.js"></script>` at
line 582; the new capture `index.html` (4,115 lines) has no such tag, is **168,124 bytes larger**,
and contains code from `src/main.js` verbatim. The old HTML panel's content is also still present
inside the new one. So: same generator, logic folded inline.

**But the inlined version is not the committed `src/main.js`.** They diverge, provably:

| symbol | `src/main.js` | live `index.html` |
|---|---|---|
| `initGithubBackup` | 2 | **0** |
| `gh.push` | 1 | **0** |
| `backupGenerator` | 0 | **1** |

The committed `src/main.js` implements the GitHub screen with slug-prefixed `gh.push()` calls —
the approach that works in a multi-generator repo. The live generator implements it with
`backupGenerator()` and root-level paths — the approach that does not. **The committed file is a
fix that is not live.**

**So `src/main.js` (169,541 bytes) is an orphan, and it is the only copy of that variant
anywhere.** It is referenced by no manifest entry in the `meta.json` beside it, and no capture
will ever regenerate it. **Do not delete it.**

**One number is still unexplained.** The `meta.json` in this repo previously declared
`src/main.js` at **163,205** bytes, and probing the upload key confirmed the host served exactly
that. The committed file is **169,541** bytes with zero CRLF pairs, so the size gap is not a
line-ending artifact — the hand-placed file never corresponded to the recorded manifest key.
Whether it is newer, older, or from a different build entirely is unknown.

---

## Two naming layouts

This repo currently holds both, on purpose:

| | count |
|---|---|
| directories with `lists.txt`/`html.txt` (old) | 33 (9 template-named ones split to `perchance-templates` on 2026-08-11) |
| directories with `main.pjs`/`index.html` (new) | 1 (`q8tgpbvj6l`) |
| directories with `src/` | 1 (`q8tgpbvj6l`) |

`main.pjs`/`index.html` is perchance's own export convention and what `--layout perchance` writes;
GitHub renders and syntax-highlights it. The old directories are **not being migrated** — that
was decided deliberately on 2026-08-10, and the new naming applies going forward only. A directory
the fleet runner touches therefore ends up holding **both** pairs, as `q8tgpbvj6l` does (its
`main.pjs` and `lists.txt` are identical apart from a trailing newline).

`fleet-backup.mjs` requires an explicit slug scope and has no `--all` flag, so nothing spreads the
duplication repo-wide by accident. Tracked as **T-15** in
`perchance-manager/docs/open-threads.md`.

`.gitattributes` here pins LF for `.txt`, `.json`, `.md`, `.js`, **`.pjs`, and `.html`** — the
last two added 2026-08-10, when git first warned about normalizing the new layout's output.

---

## Attribution note

`q8tgpbvj6l`'s own panel header: *"NOT MY GENERATOR — copied to test a plugin… All credit to the
original author."* (original: `https://gd.games/penusbmic/bullet-bunny`). Keep that disclaimer
intact in any edit that touches the `$meta` block.

---

## Related repos

- **`Rathji/perchance-manager`** — the capture and fleet-backup tooling, the `github-data-plugin`
  source, and `docs/open-threads.md` (T-13, T-15).
- **`nstsp-mp/perchance-generator-reference`** — a corpus of captured third-party generators and
  the DSL/architecture documentation mined from it. Nothing in this repo depends on it.
