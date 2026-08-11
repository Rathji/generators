# rathjis-generators

Captured source for Mark's own perchance.org generators (perchance handle `Rathji`), used for
GitHub-backed backup and round-trip testing.

**This is not regenerable output.** Some of what is here exists nowhere else —
`q8tgpbvj6l/src/main.js` in particular is referenced by no manifest and no capture will bring it
back. Treat the repo as a backup of record, not a cache.

## Layout

Each `<slug>/` holds the two editor panels plus `meta.json`
(`{name, imports, isPrivate, srcManifest}`). Two naming conventions are in use, deliberately:

| files | directories | meaning |
|---|---|---|
| `lists.txt` + `html.txt` | 42 | the original capture naming |
| `main.pjs` + `index.html` | 1 (`q8tgpbvj6l`) | perchance's own export convention, written by `--layout perchance` |
| `src/<name>` | 1 (`q8tgpbvj6l`) | files a generator's `srcManifest` declares |

The old directories are not being migrated; the new naming applies to future captures only, so a
directory that gets re-captured ends up holding both pairs. See `SYNC-PROCESS.md`.

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
generator is still a manual step, and one thing not to click.

Originally captured 2026-08-10; all generators were `isPrivate: false` at capture time.
