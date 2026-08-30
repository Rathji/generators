# `q8tgpbvj6l` — deliberately holds BOTH naming layouts. Delete nothing here.

This directory is the **one intentional exception** to the 2026-08-30 layout migration that
renamed every other `lists.txt`/`html.txt` pair in this repo to `main.pjs`/`index.html`. It was
left alone on purpose. If you are tidying and this directory looks like something the migration
missed, it is not.

## Why

**The generator is gone.** `q8tgpbvj6l` has returned 404 from perchance.org since 2026-08-18,
re-confirmed 2026-08-21 and again by the existence oracle on 2026-08-29. It is `skip: true` in
`fleet-state.json` and is never captured again. **Nothing here can be re-derived from anywhere.**

**The two pairs are different captures, not a naming duplicate.**

| pair | captured | `main`/`lists` | `index`/`html` |
|---|---|---|---|
| `lists.txt` / `html.txt` | 2026-08-12 | 1,253 bytes | 33,933 bytes |
| `main.pjs` / `index.html` | 2026-08-14 | 409 bytes | 27,150 bytes |

They are two days apart and they diverge substantially. Note that the newer `index.html` is the
**smaller** file — 6,783 bytes smaller — so "keep the newest" is not obviously "keep the most
complete". The 2026-08-12 `html.txt` loads its logic by reference
(`<script type="module" src="src/main.js">`); the 2026-08-14 capture does not carry that tag.

**`src/main.js` is referenced by no manifest.** `meta.json` declares an empty `srcManifest`, so
nothing in the tooling knows that file should exist, and no verification step would notice it
going missing. It is tracked here and nowhere else. `CLAUDE.md` in `perchance-manager` calls this
out by name: *"`generators` is not regenerable output… `q8tgpbvj6l/src/main.js` in particular is
tracked there and referenced by no manifest."*

Together: this directory is the only surviving copy of a dead generator, in two versions, one of
which points at a source file no manifest protects. Deleting either pair destroys unique history
permanently.

## What this means in practice

- **Do not delete `lists.txt`, `html.txt`, `main.pjs`, `index.html`, or anything under `src/`.**
- **Do not "finish the migration" here.** The non-conformity is the record.
- Treat both pairs as historical evidence of a real deploy divergence — see thread `T-15` in
  `perchance-manager/docs/open-threads.md`, which documents that a fix was committed to
  `src/main.js` but never went live, because the deploy attempt hit perchance's 24-hour rolling
  save limit and was reverted.
- `fleet-state.json` records `layout: "perchance"` for this slug. That describes which pair the
  tooling would write if it ever captured again. It never will, because `skip` is `true`.

Recorded 2026-08-30, during the T-15 layout migration.
