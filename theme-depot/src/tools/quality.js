// Theme Depot — bulk quality enrichment script
//
// Computes a quality score for every theme in the catalog (see computeQuality()
// in src/data.js — weighted blend of popularity, maintenance, completeness,
// documentation, polish) and writes src/quality.json for the app to overlay at
// load, so the score/badge/sort are available for the whole catalog on first
// load without hitting GitHub/shields at runtime.
//
// Signal sources:
//   - Popularity + maintenance: shields.io badge JSON for GitHub stars and
//     last-commit (no auth, no meaningful rate limit, CORS-enabled — unlike the
//     GitHub API's 60 req/hr unauth limit).
//   - Completeness/polish: the store list (modes, legacy, screenshot).
//   - Documentation: hub pages (same fetch pipeline as categorize.js).
//
// Run it with the execute_js worker:
//   const code = await fs.readTextFile("src/tools/quality.js");
//   const mod = await import("data:text/javascript;base64," + btoa(unescape(encodeURIComponent(code))));
//   await mod.main();
//
// Test mode (validates the pipeline without touching the real output):
//   await mod.main({ limit: 100, outPath: "scratch/quality-sample.json" });

const OUT_PATH = "src/quality.json";
const CONCURRENCY_HUB = 8;
const CONCURRENCY_SHIELDS = 6;
const REQUEST_DELAY_MS = 80;

const SHIELDS = {
  stars: (repo) => `https://img.shields.io/github/stars/${encodeURIComponent(repo)}.json`,
  lastCommit: (repo) => `https://img.shields.io/github/last-commit/${encodeURIComponent(repo)}.json`,
};

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} · ${url}`);
  return res.text();
}

async function readDataJs() {
  if (typeof fs !== "undefined" && fs.readTextFile) {
    return await fs.readTextFile("src/data.js");
  }
  return await fetchText("src/data.js");
}

async function importDataJs() {
  const src = await readDataJs();
  const b64 = btoa(unescape(encodeURIComponent(src)));
  return await import("data:text/javascript;base64," + b64);
}

async function mapConcurrent(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      try {
        results[idx] = { ok: true, value: await fn(items[idx], idx) };
      } catch (e) {
        results[idx] = { ok: false, error: e };
      }
      if (REQUEST_DELAY_MS) await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
    }
  }
  await Promise.all(Array.from({ length: limit }, worker));
  return results;
}

export async function main(opts = {}) {
  const {
    STORE_URL,
    HUB_ACCESS_BASE,
    THEMES_DIR,
    INDEX_NAME,
    parseHubIndex,
    buildTheme,
    parseHubPage,
    computeQuality,
    computeRanks,
    docRichness,
    parseStars,
    parseRelativeAge,
  } = await importDataJs();

  const limit = opts.limit || 0;
  const outPath = opts.outPath || OUT_PATH;

  console.log("Fetching store list…");
  const store = JSON.parse(await fetchText(STORE_URL));
  console.log(`  ${store.length} themes in store`);

  console.log("Fetching hub index…");
  const hubMap = parseHubIndex(await fetchText(HUB_ACCESS_BASE + THEMES_DIR + INDEX_NAME));
  console.log(`  ${hubMap.size} hub theme pages`);

  const themes = store.map((t) => buildTheme(t, hubMap));
  themes.sort((a, b) => a.name.localeCompare(b.name));
  if (limit) {
    themes.length = Math.min(themes.length, limit);
    console.log(`  TEST MODE: processing first ${themes.length} themes only`);
  }

  const withPage = themes.filter((t) => t.hubMdUrl);
  console.log(`Fetching hub descriptions for ${withPage.length} hub themes…`);
  const hubResults = await mapConcurrent(withPage, CONCURRENCY_HUB, async (t) => {
    const info = parseHubPage(await fetchText(t.hubMdUrl));
    t.description = info.description || "";
  });
  let hubFailures = 0;
  hubResults.forEach((r, i) => {
    if (!r.ok) {
      hubFailures++;
      withPage[i].description = withPage[i].description || "";
    }
  });

  console.log(`Fetching GitHub stats for ${themes.length} themes (shields.io)…`);
  const ghResults = await mapConcurrent(themes, CONCURRENCY_SHIELDS, async (t) => {
    const out = { stars: null, lastCommitDays: null };
    const [s, c] = await Promise.all([
      fetchText(SHIELDS.stars(t.repo)),
      fetchText(SHIELDS.lastCommit(t.repo)),
    ]);
    const sj = JSON.parse(s);
    const cj = JSON.parse(c);
    if (sj && sj.value && !/not found|invalid|repo not available/i.test(sj.value)) out.stars = parseStars(sj.value);
    if (cj && cj.value && !/not found|invalid|repo not available/i.test(cj.value)) out.lastCommitDays = parseRelativeAge(cj.value);
    return out;
  });
  let ghFailures = 0;
  ghResults.forEach((r, i) => {
    if (!r.ok) {
      ghFailures++;
      themes[i]._gh = { stars: null, lastCommitDays: null };
    } else {
      themes[i]._gh = r.value;
    }
  });

  const map = {};
  const gradeCounts = {};
  let withStars = 0;
  for (const t of themes) {
    const gh = t._gh || { stars: null, lastCommitDays: null };
    t.gh = gh;
    if (gh.stars != null) withStars++;
    const doc = docRichness(t);
    const q = computeQuality(t, { stars: gh.stars, lastCommitDays: gh.lastCommitDays, docRichness: doc });
    gradeCounts[q.grade] = (gradeCounts[q.grade] || 0) + 1;
    t._docRichness = doc;
  }
  // The canonical sub-ranking (computeRanks in src/data.js): orders the whole
  // catalog by score (then stars, then name) and gives each theme a "A.1"-style
  // rank within its letter grade. Persisted below for later use.
  computeRanks(themes);
  for (const t of themes) {
    const gh = t.gh || { stars: null, lastCommitDays: null };
    // Compact per-theme entry: [stars, lastCommitDays, docRichness, rank]
    map[t.name] = [gh.stars, gh.lastCommitDays, t._docRichness, t.rank];
  }

  const out = {
    generatedAt: new Date().toISOString(),
    source: "shields.io (stars, last commit) + hub (docs) + store (modes/legacy/screenshot)",
    storeCount: themes.length,
    hubFetchFailures: hubFailures,
    ghFailures,
    withStars,
    grades: Object.fromEntries(Object.entries(gradeCounts).sort((a, b) => (a[0] < b[0] ? -1 : 1))),
    themes: map,
  };

  const json = JSON.stringify(out, null, 2);
  if (typeof fs !== "undefined" && fs.writeTextFile) {
    await fs.writeTextFile(outPath, json);
    console.log(`Wrote ${outPath} (${json.length} bytes)`);
  } else {
    console.log("// Copy this output into " + outPath + ":\n" + json);
  }

  console.log(
    `Done: ${themes.length} themes, ${hubFailures} hub failures, ${ghFailures} gh failures, ${withStars} with stars`
  );
  for (const [g, n] of Object.entries(out.grades)) console.log(`  grade ${g}: ${n}`);
  return {
    wrote: outPath,
    themes: themes.length,
    storeCount: out.storeCount,
    hubFailures,
    ghFailures,
    withStars,
    grades: out.grades,
    generatedAt: out.generatedAt,
    json,
  };
}
