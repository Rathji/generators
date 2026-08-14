# generators

Captured source for Rathji's own perchance.org generators (perchance handle `Rathji`), kept as a
GitHub-backed backup of record.

This repo also hosted the round-trip test of `github-data-plugin` — capture out, edit, push back,
verify. **That test is finished: the plugin works, confirmed by the operator 2026-08-14.** Backup
is now the repo's standing purpose; the test is history, and the slug that carried it
(`q8tgpbvj6l`) is described below.

The 9 generators whose name contained "template" were split out to
[perchance-templates](https://github.com/Rathji/perchance-templates) on 2026-08-11 (history
preserved). This repo keeps the rest.

**This is not regenerable output.** Some of what is here exists nowhere else —
`q8tgpbvj6l/src/main.js` in particular is referenced by no manifest and no capture will bring it
back. Treat the repo as a backup of record, not a cache.

## Layout

Each `<slug>/` holds the two editor panels plus `meta.json`
(`{name, imports, isPrivate, srcManifest}`). Two naming conventions are in use, deliberately:

| files | directories | meaning |
|---|---|---|
| `lists.txt` + `html.txt` | 32 | the original capture naming |
| `main.pjs` + `index.html` | 1 (`q8tgpbvj6l`) | perchance's own export convention, written by `--layout perchance` |
| `src/<name>` | 1 (`q8tgpbvj6l`) | files a generator's `srcManifest` declares |

The old directories are not being migrated; the new naming applies to future captures only, so a
directory that gets re-captured ends up holding both pairs. See `SYNC-PROCESS.md`.

`q8tgpbvj6l` is the slug the plugin test ran on, and it is now a demo/landing page for
`github-data-plugin` — rewritten into that form on 2026-08-11, replacing a build described further
down in `SYNC-PROCESS.md`. **Its test role is complete** (plugin confirmed working, operator,
2026-08-14); what remains is a live demo, not work in progress. Its directory holds that demo's
live `main.pjs`/`index.html` alongside `html.txt`, `lists.txt`, and `src/main.js` — relics of an
unrelated, earlier generator (a captured copy of the bullet-bunny game,
`https://gd.games/penusbmic/bullet-bunny`) that once lived under this same slug. Those relics are
historical only; nothing about them describes the live generator today, and the do-not-delete rule
above still covers them.

**`github-data-plugin/` was removed on 2026-08-11** and now lives only in
`Rathji/perchance-manager` under `plugins/github-data-plugin/`, which is where `SYNC-PROCESS.md`
has named its home since the split. It is *our source*, not captured third-party data, and keeping
a second copy here — under the old `lists.txt`/`html.txt` naming, in a different repo — is what
allowed the two to drift apart unnoticed until a deploy nearly overwrote live content with the
staler one. Do not re-capture it into this repo. The pre-move bytes remain in commit `1089309`.

`source.html` is skipped on capture (`--no-source`) — it is a near-duplicate perchance page
wrapper, not generator content.

## Capturing

The tooling lives in
[perchance-manager](https://github.com/Rathji/perchance-manager) (it moved there from
`perchance-generator-reference` on 2026-08-10):

```
node <path-to-perchance-manager>/tools/fleet-backup.mjs --repo <path-to-this-repo> <slug> --push
```

`SYNC-PROCESS.md` is the full runbook — including why pushing changes *back* into a live
generator is still a manual step, and a GitHub Backup hazard that once lived here, now fixed.

Originally captured 2026-08-10; all generators were `isPrivate: false` at capture time.
