# Theme quality scoring — the process

Every theme gets a 0–100 quality score with a letter grade (A ≥ 70, B ≥ 50, C ≥ 30, D below),
shown as a badge on cards, as a breakdown panel in the detail view, and as a sort order.
This file documents how the score is computed, where the data comes from, and how to re-run it.

## The algorithm

`computeQuality()` in `src/data.js` blends five signals (`QUALITY_WEIGHTS`):

| Signal | Weight | What feeds it |
|--------|--------|---------------|
| Popularity | 0.40 | GitHub stars, log-scaled: `log10(1+stars)/log10(1001)` → 0 stars = 0, 1000+ = 1 |
| Maintenance | 0.25 | Last-commit age in days: ≤90 = 1, ≤365 = 0.8, ≤730 = 0.55, ≤1100 = 0.35, older = 0.15 (0.2 if unknown but GitHub data exists, 0.3 if no GitHub data at all) |
| Completeness | 0.15 | 60% modes (both light+dark = 1, single = 0.55) + 40% not legacy |
| Documentation | 0.10 | `docRichness()`: not hub-documented = 0.15; else 1/0.7/0.55/0.5 by description length (≥200 / ≥60 / ≥30 / shorter) |
| Polish | 0.10 | Has a screenshot = 1 |

Score = sum of `weight × signal`, rounded to 0–100.

## Sub-ranking (A.1, A.2, …)

Each theme also gets a sub-rank within its letter grade, computed by `computeRanks()`
in `src/data.js`: the whole catalog is ordered by quality score (desc), then GitHub
stars (desc), then name, and within each grade the best-scoring theme is `.1`, the
next `.2`, and so on. This is the canonical ranking — `src/app.js` recomputes it at
runtime (so it always matches the current weights), and `src/tools/quality.js`
persists the result into `src/quality.json` for later use (rank is the 4th element of
each per-theme entry, see below). The ranking sort in the app tie-breaks exactly like
`computeRanks()`, so the default ranking view lists `A.1, A.2, A.3, …` in order.

## Curation — top 25% + re-scaled grades

At runtime the app calls `curateCatalog()` (`src/data.js`) after ranking: it drops the
bottom `1 − KEEP_FRACTION` (default 75%) of the catalog by that same ordering and
**re-scales letter grades for the kept set so they distribute evenly** — the kept set
is split into equal bins across `GRADE_BINS` (A/B/C/D; each grade ends up holding
~25% of the kept set), then re-sub-ranked `A.1/A.2/…` within each new grade. With the
current 733-theme catalog that means the top 183 themes are shown as A.1–A.46, B.1–B.46,
C.1–C.46, D.1–D.45, and the other 550 are excluded from the view. Dropped themes are
flagged `curated: "dropped"` with their original full-catalog rank stored as `origRank`,
and the app's "Download removed (550)" button exports them as
`theme-depot-removed-themes.json` (metadata, source URL, original rank/score/stars).
`KEEP_FRACTION` and `GRADE_BINS` in `src/data.js` tune the split and the re-scaled grade
distribution. Note: `computeRanks()` still ranks the full catalog first — the curation
step builds on it, it doesn't replace it.

## Why shields.io for GitHub stats

Stars and last-commit are the strongest quality signals but the GitHub API caps unauthenticated
requests at 60/hour — nowhere near 732 repos. shields.io badge JSON
(`https://img.shields.io/github/stars/{repo}.json`) is CORS-enabled, needs no auth, and has no
meaningful rate limit, so the bulk script pulls both stats for every theme in ~2 minutes.

Two parse helpers in `src/data.js` decode shields values:
- `parseStars("5.4k")` → 5400
- `parseRelativeAge("last friday" | "3 months ago" | "december 2024" | "august")` → approximate days

Note shields switches from relative ("3 days ago") to absolute month forms ("december 2024") for
older commits — `parseRelativeAge` handles both. "repo not found" responses are skipped (theme gets
`null` stats and scores from catalog data alone).

## Running it

The script writes `src/quality.json` — a per-theme map
`{ "<Theme Name>": [stars, lastCommitDays, docRichness, rank] }`
(the app recomputes the actual score from the first three signals via
`computeQuality()` and the sub-rank via `computeRanks()`, so the algorithm lives in
one place; the stored `rank` is the persisted "A.1"-style result for later use).

**1. With the execute_js worker** (writes the file directly):

```js
const code = await fs.readTextFile("src/tools/quality.js");
const mod = await import("data:text/javascript;base64," + btoa(unescape(encodeURIComponent(code))));
await mod.main();
```

**2. In a browser console** on the running generator (no `fs` — prints the JSON to copy):

```js
const code = await (await fetch("src/tools/quality.js")).text();
const mod = await import("data:text/javascript;base64," + btoa(unescape(encodeURIComponent(code))));
await mod.main();
```

**Test mode** — validate on a subset without touching the real output:

```js
await mod.main({ limit: 100, outPath: "scratch/quality-sample.json" });
```

## When to re-run

- You want fresher stars / last-commit dates (the data is a snapshot at run time).
- You edit `QUALITY_WEIGHTS`, `computeQuality()`, `computeRanks()`, `docRichness()`, or the parse
  helpers — the precomputed signals don't change, but the app recomputes scores and ranks from them,
  so only the file's `[stars, lastCommitDays, docRichness, rank]` tuples would need refreshing if the
  sources changed.

## Tuning the algorithm

- **Grade thresholds** live in `qualityGrade()` (src/data.js): change the 70/50/30 cutoffs there.
- **Signal weights** live in `QUALITY_WEIGHTS` (src/data.js).
- After any change, re-run the script (only needed to refresh the data, not the scoring) and reload
  the app. The 100-theme test mode is the quick way to eyeball the distribution before a full run.
