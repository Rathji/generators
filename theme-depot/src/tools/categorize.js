// Theme Depo — bulk categorization script
//
// Fetches the full Obsidian theme catalog, fetches the hub description for every
// hub-documented theme (the "bulk of the work" that the app itself only does lazily
// per opened theme), classifies every theme with classifyTheme() (keyword categories
// defined in src/data.js), and writes src/categories.json for the app to load at
// runtime. src/categories.json gives the slicer complete, precomputed categories on
// first load instead of only for themes you've opened.
//
// Run it with the execute_js worker (see src/tools/CATEGORIZE.md for the process):
//   const code = await fs.readTextFile("src/tools/categorize.js");
//   const mod = await import("data:text/javascript;base64," + btoa(unescape(encodeURIComponent(code))));
//   await mod.main();
//
// Or from a browser console against the running generator:
//   const code = await (await fetch("src/tools/categorize.js")).text();
//   const mod = await import("data:text/javascript;base64," + btoa(unescape(encodeURIComponent(code))));
//   await mod.main();   // prints the JSON; paste it into src/categories.json
//
// The script is environment-agnostic: it detects the execute_js worker's live `fs`
// to write the output file, and falls back to printing the JSON if it's run in a
// browser (where only `fetch` exists).

const OUT_PATH = "src/categories.json";
const CONCURRENCY = 8;
const REQUEST_DELAY_MS = 80;

// Test mode: run the pipeline on the first `limit` themes (alphabetical) and
// write to a scratch file, so the real src/categories.json is never clobbered.
//   await mod.main({ limit: 100, outPath: "scratch/categories-sample.json" })

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} · ${url}`);
  return await res.text();
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

// Run fn over every item with `limit` concurrent workers, collecting ok/error per item.
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
    classifyTheme,
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
  console.log(`Fetching descriptions for ${withPage.length} hub themes…`);

  const results = await mapConcurrent(withPage, CONCURRENCY, async (t) => {
    const info = parseHubPage(await fetchText(t.hubMdUrl));
    t.description = info.description || "";
    if (info.modes.length) t.modes = info.modes;
    if (info.author) t.authorHub = info.author;
  });

  let failures = 0;
  results.forEach((r, i) => {
    if (!r.ok) {
      failures++;
      withPage[i].description = withPage[i].description || "";
    }
  });

  for (const t of themes) t.categories = classifyTheme(t);

  const map = {};
  for (const t of themes) map[t.name] = t.categories;

  const counts = {};
  for (const t of themes) for (const c of t.categories) counts[c] = (counts[c] || 0) + 1;

  const out = {
    generatedAt: new Date().toISOString(),
    storeCount: themes.length,
    hubPageCount: withPage.length,
    hubFetchFailures: failures,
    counts: Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1])),
    themes: map,
  };

  const json = JSON.stringify(out, null, 2);
  if (typeof fs !== "undefined" && fs.writeTextFile) {
    await fs.writeTextFile(outPath, json);
    console.log(`Wrote ${outPath} (${json.length} bytes)`);
  } else {
    console.log("// Copy this output into " + outPath + ":\n" + json);
  }

  console.log(`Done: ${themes.length} themes, ${failures} hub fetch failures`);
  for (const [c, n] of Object.entries(out.counts)) console.log(`  ${c}: ${n}`);
  return {
    wrote: outPath,
    themes: themes.length,
    storeCount: out.storeCount,
    failures,
    counts: out.counts,
    generatedAt: out.generatedAt,
    json,
  };
}
