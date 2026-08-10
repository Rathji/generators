# rathjis-generators

Captured source for Mark's own perchance.org generators (perchance handle `Rathji`), seeded for
GitHub-backed testing/backup workflows.

Each `<slug>/` holds `lists.txt` (Lists panel / `modelText`), `html.txt` (HTML panel /
`outputTemplate`), and `meta.json` (`{name, imports, isPrivate, srcManifest}`), captured via
[perchance-generator-reference](https://github.com/nstsp-mp/perchance-generator-reference)'s
`tools/perchance-fetch.mjs` against perchance.org's public export endpoint. `source.html` was
skipped on capture (`--no-source`) — it's a near-duplicate page wrapper, not generator content.

Captured 2026-08-10. All 41 generators were `isPrivate: false` on perchance.org at capture time.
