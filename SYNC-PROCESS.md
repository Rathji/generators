# Repo ↔ live-generator sync process

A manual runbook for round-tripping changes between this repo and a live perchance.org
generator you own. No new tooling yet — deliberately, since the app used to develop this
(`q8tgpbvj6l`) turned out to keep almost all its real logic in a `srcManifest` file
(`src/main.js`), which the two panel editors can't reach at all. See "Why manual, why now"
below before trying to automate any of this.

**Scope note:** this only works on a generator **you own** (perchance's "duplicate" copies a
generator into your account under a new slug — `q8tgpbvj6l` is one such copy, confirmed owned
2026-08-10). Saving to a generator you don't own forks it into a new copy instead of updating it.

## The three directions

### 1. Capture: live generator → this repo

```
node <path-to-perchance-generator-reference>/tools/perchance-fetch.mjs <slug> \
  --out-dir "<path-to-this-repo>" --force --no-source
```

Writes `<slug>/{lists.txt,html.txt,meta.json}`. **Does not fetch `srcManifest` files** — that
was done by hand for `q8tgpbvj6l/src/main.js` (see below). If `meta.json` declares a
`srcManifest`, fetch each entry yourself:

```
curl -s "https://user.uploads.dev/file/<key>" -o "<slug>/src/<name>"
```

Confirmed working 2026-08-10: this URL is public, unauthenticated, CORS-open
(`Access-Control-Allow-Origin: *`), and returns the exact byte count `meta.json` declares. See
`perchance-generator-reference`'s `reference/open-threads.md` T-7 for the finding.

Commit and push after capturing.

### 2. Edit: change files in this repo

Ordinary git workflow. Edit `lists.txt`/`html.txt`/`src/*.js`, commit, push. Nothing
perchance-specific here — the repo is just files until step 3.

### 3. Push: this repo → live generator (the manual part)

1. Open `https://perchance.org/<slug>#edit`, logged in as the owning account.
2. **For `lists.txt` changes:** select all in the Lists panel, replace with the repo's current
   `lists.txt` content.
3. **For `html.txt` changes:** same, in the HTML panel.
4. **For `src/*` changes** (e.g. `src/main.js`): open the editor's **files panel** (exact
   location not yet documented here — find it on your first pass and add a note) and re-upload
   the changed file so it replaces the existing entry perchance tracks in the manifest.
5. Click **Save**. If perchance shows a staleness prompt ("It looks like you're editing an old
   version…"), that means something changed the live copy since your last capture — don't just
   force through it; re-capture (step 1) first and re-apply your edit on top of the current
   version.
6. Perchance keeps its own version history (the **backups** button in the editor) — your
   pre-edit state is recoverable there if a save goes wrong, independent of this repo.

### 4. Verify: re-capture and diff

```
node tools/perchance-fetch.mjs <slug> --out-dir "<path-to-this-repo>" --force --no-source
git diff <slug>/
```

An empty diff (plus a manual re-check of `src/*` files, since those aren't re-downloaded
automatically — repeat the `curl` from step 1) confirms the live generator now matches what's
committed here.

## Update 2026-08-10: a self-service alternative for the *push* direction

`q8tgpbvj6l` now imports `github-data-plugin` (`gh = {import:github-data-plugin}`) and has its
own **GitHub Backup screen** built into its menu (`#ghScreen` in `html.txt`, wired in
`src/main.js`'s `initGithubBackup()`). This runs live, in the browser, as the owning user —
which sidesteps step 3's manual paste for the **capture → GitHub** half specifically:

- **Backup → GitHub**: one click fetches this generator's *own last-saved* Lists/HTML panels
  straight from perchance's API and pushes them to `<generator-name>/lists.txt` +
  `<generator-name>/html.txt` in a repo you own, as a single commit. No copy-paste, no capture
  tool. **Deliberately does not use `root.gh.backupGenerator()`** — that call hardcodes
  root-level `main.pjs`/`index.html` with no path option, which collides across every generator
  sharing one repo (confirmed live 2026-08-10: pointing Restore at `Rathji/generators`
  404'd looking for a root `main.pjs` that was never going to exist in a multi-generator repo).
  `root.gh.push()`/`.raw()` with slug-prefixed paths are used directly instead.
- **Restore ← GitHub**: fetches `<generator-name>/lists.txt` + `<generator-name>/html.txt` via
  `root.gh.raw(...)` and offers them as downloads to review. It still does **not** write back
  into perchance's editor — same `/api/save` limitation as ever (see
  `perchance-generator-reference`'s `reference/open-threads.md` T-13) — so applying a restore is
  still steps 2-3 above, manually.

This only covers the two panels, matching what `backupGenerator()` actually reaches — it says
nothing about `src/main.js`, which still needs the manual files-panel re-upload in step 3. Don't
mistake "I clicked Backup to GitHub" for "everything is synced."

## Why manual, why now

`q8tgpbvj6l`'s `lists.txt` is 12 lines and `html.txt` is 518, but its actual game logic is a
163 KB `src/main.js` loaded via `<script type="module" src="src/main.js">`. Perchance's own save
path treats the two editor panels and the `src/` file manifest as separate systems — panel
content goes through `window.modelTextEditor`/`outputTemplateEditor`, while `src/` files upload
through the editor's own upload pipeline (`window.srcState.prepareForSave()`) and travel with
the save as a manifest, not as editor text. A tool that only automates the two panels would
report success on this app while changing nothing a player would notice. Until the `src/`
upload path is separately investigated and confirmed scriptable, keeping this whole process
manual means it's honest about what it does — no false sense of "synced."

## Attribution note

`q8tgpbvj6l`'s own `lists.txt` header: *"NOT MY GENERATOR — copied to test a plugin... All
credit to the original author."* (original: `https://gd.games/penusbmic/bullet-bunny`). Keep
that disclaimer intact in any edit that touches `lists.txt`'s `$meta` block.
