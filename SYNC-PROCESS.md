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

There is also a **live hazard** introduced by that same rewrite — see "GitHub Backup hazard —
fixed on both sides" below. It was live and worth reading carefully as of 2026-08-10; as of
2026-08-14 it is fixed on both sides and that section records the fix.

---

## What changed on 2026-08-14

This document was reconciled again because two of the sections below described a build of
`q8tgpbvj6l` that no longer exists. On 2026-08-11 that generator was rewritten into a demo page
for `github-data-plugin`, and this repo received the new panels via the generator's own GitHub
Backup button (commit `50c6203`, 2026-08-11 22:28:53 -0600). The corrections, verified read-only
on 2026-08-14:

1. **The GitHub Backup hazard is now fixed on both sides**, and the fix is proven live by
   `50c6203` itself — see "GitHub Backup hazard — fixed on both sides" below.
2. **"The state of `q8tgpbvj6l`, precisely" now describes the live `github-data-plugin` demo**,
   not the retired bullet-bunny build it used to describe.
3. **Two stale directory counts are corrected to 32** (previously misstated as 41 and 33).
4. **The attribution note is recast as historical** — the disclaimer it quotes belongs to
   `html.txt` / `lists.txt` / `src/main.js`, not the live panels, which no longer carry it.
5. **A Windows crash in `fleet-backup.mjs`** is documented under "1. Capture" below. It was **fixed 2026-08-31**; the entry is kept because older logs still show it.
6. The claim that `q8tgpbvj6l`'s `main.pjs` and `lists.txt` were "identical apart from a
   trailing newline" was checked and found false (409 bytes vs. 1,253 bytes — different
   generations of different generators) and has been removed.
7. **The `github-data-plugin` round-trip test is finished and the plugin works** — confirmed by the
   operator 2026-08-14. `q8tgpbvj6l` is no longer a test in progress; it is a live demo of a
   working plugin. This runbook's steps stand unchanged — they describe the process the test
   validated, not the test itself.

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

**A Windows crash used to make this step untrustworthy. FIXED 2026-08-31 — the manual
`git status` check below is no longer owed.** Kept here because the failure mode is instructive and
because anyone reading an older run's logs will still meet it.

`fleet-backup.mjs` could crash with

```
Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 94
```

*after* the capture had already succeeded and written correct files to disk. The tool then printed
`No changes to commit (the target repo already matches perchance).`, marked the slug `failed`
(e.g. `0/1 ok, 1 failed`), and exited **1** — on a run whose files on disk genuinely had changed.

**Root cause**, found 2026-08-31: `process.exit()` was being called while Node's global `fetch`
still held its keep-alive sockets, which aborts libuv's handle teardown. It had nothing to do with
git or child processes, which is what everyone assumed. Two things changed in `perchance-manager`:
`perchance-fetch.mjs` now lets the process exit naturally, and — the part that matters here —
`fleet-backup.mjs` no longer decides a slug's fate from an exit code at all. It checks that the
capture's `meta.json`, `main.pjs` and `index.html` are present **and were written during that run**,
and commits on that basis. A crashed-but-correct capture is now committed rather than discarded.

Checking `git status` yourself after a capture remains a perfectly good habit, and this document
used to require it. It no longer does. The reason is worth stating precisely: not that the exit code
became trustworthy, but that nothing consults it any more.

**If you are reading an older log:** the crash appears as exit **3221226505** (`0xC0000409`) when
the tool was run by another process, and as **127** from a shell. They are the same fault.

Commit and push after capturing.

**Then check the capture is complete, which the tool's own output does not tell you.** `--src`
reports a size mismatch per file rather than aborting, so a run can print `1/1 ok` over a truncated
or skipped download. `meta.json`'s `srcManifest` declares a byte size for every `src/` file, and
comparing it against disk is the only integrity check this repo has — see "Checking that a capture
is complete" in `README.md` for a one-liner that does it repo-wide.

Run it. On 2026-08-14 its first run reported **86 declared files missing across 32 directories**,
all captured 2026-08-10 — before `--src` existed. The manifests had always declared them; nothing
had fetched them; nothing had ever compared the two. 79 were backfilled from live the same day. The
other 7 belong to `top-down-rpg-template`, which is 404, and are gone for good.

### 2. Edit: change files in this repo

Ordinary git workflow. Edit the panel files or `src/*`, commit, push. Nothing perchance-specific
here — the repo is just files until step 3.

### 3. Push: this repo → live generator (the manual part)

1. Open `https://perchance.org/<slug>#edit`, logged in as the owning account.
2. **Lists panel** ← the slug's `main.pjs`. Select all, replace.
3. **HTML panel** ← the slug's `index.html`. Same.
4. **`src/*` files**, if the generator has any: open the editor's files panel and re-upload the
   changed file so it replaces the manifest entry perchance tracks. *(Exact UI location still
   undocumented here — note it on your first pass.)*
5. Click **Save**. If perchance shows a staleness prompt ("It looks like you're editing an old
   version…"), something changed the live copy since your capture — **do not force through it**.
   Re-capture (step 1) and re-apply your edit on top of the current version.
6. Perchance keeps its own version history (the **backups** button in the editor). Your pre-edit
   state is recoverable there independently of this repo.

### 4. Verify: capture to a scratch directory and diff

**Do this by capturing somewhere else and comparing, not by capturing over the repo.** It is
read-only with respect to this repo, it spends no perchance save budget, and — unlike the older
method below — its result is unambiguous:

```
node <path-to-perchance-manager>/tools/perchance-fetch.mjs <slug> \
  --out-dir "<some-scratch-dir>" --force --no-source --src --layout perchance
diff "<some-scratch-dir>/<slug>/index.html" <slug>/index.html
diff "<some-scratch-dir>/<slug>/main.pjs"   <slug>/main.pjs
```

Identical files confirm the live generator matches what is committed here. With `--src` this
covers `src/*` too. Expect a one-byte trailing-newline difference, which perchance does not
store (see the note in step 1).

**The old method — `fleet-backup.mjs <slug>` then `git diff <slug>/` — still cannot be trusted,
and the reason that survives has nothing to do with the step-1 crash.** `git diff` is simply the
wrong probe:

- On a run that works, the tool **commits** what it captured, so `git diff` is empty whether or
  not live matched. The empty diff proves nothing. This was always the real objection and it is
  unaffected by any fix.
- Historically, a crashed run did not commit, so `git diff` showed the real drift while the
  tool's summary called the slug `failed` — inviting the reader to distrust the one signal that
  was actually correct. **That half is obsolete as of 2026-08-31** (see step 1): a crashed run
  whose capture verified on disk is now committed like any other, so it lands in the first case
  above rather than this one.

If you do run it against the repo anyway, verify with `git status --porcelain <slug>/` (is there
uncommitted drift?) and `git --no-pager log -1 --stat` (did it commit, and what?) — never with
`git diff` alone.

`--dry-run` is not a verification step. It prints the commands it *would* run and exits without
fetching anything, so it never compares the repo against live.

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

## GitHub Backup hazard — fixed on both sides

`q8tgpbvj6l` briefly carried a live hazard, first documented here 2026-08-10. Its GitHub Backup
screen called `api.backupGenerator(repo)`, and that function hardcoded its target paths —
`plugins/github-data-plugin/main.pjs:414` pushed literally `{ "main.pjs": code, "index.html":
html }` at the **repository root**, with no slug prefix. Its Restore action read the same root
paths back. Pointed at this multi-generator repo, that would have written a root-level `main.pjs`
and `index.html` that every generator's backup shared and collided in, unlabelled.

**That hazard is gone now, fixed independently on both sides:**

- **The live `github-data-plugin`** (published 2026-08-11) resolves the slug and pushes
  `gen + "/main.pjs"` / `gen + "/index.html"` (`main.pjs:414`, slug resolved at `:400`). A
  read-only capture on 2026-08-14 found the live copy differs from this repo's committed plugin
  copy by only a trailing newline.
- **`q8tgpbvj6l` itself was rewritten on 2026-08-11** into a demo page for that same plugin (see
  "The state of `q8tgpbvj6l`, precisely" below). Its own Backup button now builds its own
  slug-prefixed paths and calls `api.push()` (`index.html:422-425`); its Restore reads
  `rawTry([gen + '/main.pjs', 'main.pjs'])` and `rawTry([gen + '/index.html', 'index.html'])`
  (`:452-453`) — slug-first, with a root fallback. The old hazardous call, `backupGenerator`,
  appears exactly once in the live file, at `:366`, used only as a capability probe — not as an
  active write path.

**The fix is proven live, not just read from source.** Commit `50c6203` ("Update files via
github-data-plugin", 2026-08-11 22:28:53 -0600) is that Backup button writing into this repo, and
it landed the files at `q8tgpbvj6l/main.pjs` and `q8tgpbvj6l/index.html` — not at the repo root.

**The standing rule survives the fix anyway, because it costs nothing to keep:** no root-level
`main.pjs` or `index.html` belongs in this repo. Use `fleet-backup.mjs` (step 1) for captures; it
writes `<slug>/`, which is the layout this repo actually uses.

---

## The state of `q8tgpbvj6l`, precisely

**This section previously described a build that no longer exists.** Everything below it, through
2026-08-10, was about a bullet-bunny game copy with its logic inlined into the HTML panel. On
2026-08-11 that build was replaced live — the generator was rewritten into a demo/landing page for
`github-data-plugin` — and this repo received the new panels via the generator's own GitHub Backup
button (commit `50c6203`, 2026-08-11 22:28:53 -0600). What follows is the current state, verified
read-only on 2026-08-14 against the live site and the committed files.

**The test this slug existed for is over.** `q8tgpbvj6l` was duplicated into the account to test
`github-data-plugin`'s round trip; the operator confirmed on 2026-08-14 that **the test is done and
the plugin works**. Treat the slug as a finished demo rather than an experiment still running — the
distinction matters because this section used to be a live investigation log, and it is now a
record. Two things follow: no further deploy is pending against it (see T-15 in
`perchance-manager/docs/open-threads.md`), and its `html.txt` / `lists.txt` / `src/main.js` relics
are now purely archival. Note the register — the plugin working is the operator's confirmation; what
this repo independently proves is narrower, namely that the Backup direction wrote slug-prefixed
paths (commit `50c6203`).

**The live panels are small and single-purpose.** `index.html` is 508 lines / 27,150 bytes, down
from the retired build's 4,115 lines / 202,067 bytes. `grep -ci "bullet.bunny\|penusbmic"
q8tgpbvj6l/index.html` returns **0** — none of the old game survives in the live HTML panel.
`main.pjs` is 8 lines / 409 bytes:

```
gh = {import:github-data-plugin}
superFetch = {import:super-fetch-plugin}

$meta
  title = GITHUB DATA PLUGIN DEMO — backup & restore generators via GitHub
  description = A demo site for the github-data-plugin, a Perchance plugin that backs up and restores generators to GitHub. Your GitHub token never leaves this browser. See rathjis-plugin-tutorials for more on this plugin.
  header
    mode = minimal
```

**This repo's committed panels are byte-identical to live**, confirmed 2026-08-14.

**`meta.json` was stale until today's fleet capture.** Commit `5eb05be` ("Fleet backup:
q8tgpbvj6l (2026-08-14)") refreshed it to correctly declare **both** imports —
`github-data-plugin` and `super-fetch-plugin`. It previously declared only the first, because the
plugin's own Backup path pushes only the two panels and never touches `meta.json`.

**`src/main.js`, `html.txt`, and `lists.txt` are not an old build of this generator — they are the
only surviving record of a different generator entirely.** They are relics of the bullet-bunny
build this slug hosted before 2026-08-11: a captured copy of
`https://gd.games/penusbmic/bullet-bunny`, whose logic was, in that build, inlined into the HTML
panel and separately hand-placed at `src/main.js`. None of that code exists live anymore, on this
slug or (so far as known) anywhere else. No manifest entry references it, and no future capture
will ever regenerate it — it documents a generator that no longer exists under this slug, not a
variant of the one that does. **Do not delete it.**

---

## One naming layout — migrated 2026-08-30

**This repo is now on `main.pjs`/`index.html` throughout.** T-15, deferred since 2026-08-10, was
executed on 2026-08-30.

| | count |
|---|---|
| directories with `main.pjs`/`index.html` (current) | **135 — all of them** |
| directories with `src/` | 88 |
| directories still holding `lists.txt`/`html.txt` | **1 — `q8tgpbvj6l`, deliberately** |
| **total directories** | **135** |

`main.pjs`/`index.html` is perchance's own export convention and what `--layout perchance` writes;
GitHub renders and syntax-highlights it.

**What the migration did.** 30 directories here were renamed with `git mv` — so file history
follows the rename rather than reading as a delete plus an add — and the paired `layout` field in
`perchance-manager/fleet-state.json` was flipped from `reference` to `perchance` **in the same
change**. That lockstep is the point: renaming without the state flip would have the next
scheduled run write `lists.txt`/`html.txt` straight back, recreating the duplication the migration
existed to remove. Content was verified byte-identical across all renamed files by md5 before and
after; only names changed. The sibling `perchance-templates` repo had its 9 directories migrated
in the same session.

**`bgn-asset-factory` needed resolving, not just renaming.** It held a *stale* `main.pjs`/
`index.html` pair from 2026-08-20 beside the current `lists.txt`/`html.txt` from 2026-08-21 — the
stale pair still read `gameGenre = Asset Workshop` where the current one reads `Tool`, and the two
HTML files differed by 756 lines. The stale pair was removed and the current pair renamed into
place, so the directory now holds the 2026-08-21 content under the new names.

**`q8tgpbvj6l` was deliberately left holding both pairs.** It is 404 on perchance, `skip: true`,
and its two pairs are captures from different days that genuinely diverge — the newer `index.html`
is the *smaller* file. Neither can ever be re-created. See `q8tgpbvj6l/README.md`, which states
the rule in the directory itself: **delete nothing there.** It is the one intentional
non-conformity, and the non-conformity is the record.

`fleet-backup.mjs` still requires an explicit slug scope and still has no `--all` flag. That guard
was originally justified by the two-layout split; with the split gone it is now justified simply
by routing — the roster spans three repos and one slug must never be captured into this one.

`.gitattributes` here pins LF for `.txt`, `.json`, `.md`, `.js`, **`.pjs`, and `.html`** — the
last two added 2026-08-10, when git first warned about normalizing the new layout's output.

---

## Attribution note (historical)

`q8tgpbvj6l`'s bullet-bunny build carried this panel header: *"NOT MY GENERATOR — copied to test
a plugin… All credit to the original author."* (original:
`https://gd.games/penusbmic/bullet-bunny`). That disclaimer is **not** present in the live
`main.pjs` — the generator was rewritten on 2026-08-11 into the `github-data-plugin` demo quoted
under "The state of `q8tgpbvj6l`, precisely" above, and its `$meta` block carries no such notice.

The disclaimer survives only inside this repo's relics of that earlier build — `html.txt`,
`lists.txt`, and `src/main.js`. The instruction to keep it intact applies to edits that touch
**those** files, not to the live panels (`main.pjs` / `index.html`), which no longer carry it.

---

## Related repos

- **`Rathji/perchance-manager`** — the capture and fleet-backup tooling, the `github-data-plugin`
  source, and `docs/open-threads.md`, which is where this repo's open work is actually tracked:
  - **T-13** — `POST /api/save` is perchance's only real write endpoint and nothing reachable from
    a plugin can call it. This is why step 3 above is manual.
  - **T-15** — **closed 2026-08-30.** The *deploy* half closed 2026-08-14; the layout migration,
    deferred since 2026-08-10, was executed 2026-08-30. All 135 directories here are on
    `main.pjs`/`index.html`, `q8tgpbvj6l` excepted on purpose — see "One naming layout" above.
  - **M-4** — CLOSED 2026-08-31. The `fleet-backup.mjs` crash-and-misreport documented under
    step 1. Worth reading anyway: the fix was to stop trusting the exit code and verify the
    captured tree on disk instead, which is the same principle the rest of this document runs on.
- **`Rathji/perchance-reference`** — a corpus of captured third-party generators and the
  DSL/architecture documentation mined from it. Nothing in this repo depends on it. (Formerly
  `nstsp-mp/perchance-generator-reference`; transferred and renamed 2026-08-11.)
