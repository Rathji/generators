#!/usr/bin/env node
/* Standalone archive validator — run without a browser:

     node src/validate.mjs            (from the generator root)
     node validate.mjs                (from inside src/)

   Reads src/data/schema.json, src/data/games.json and every
   src/data/<game>/<category>.json, applies the same rules the in-app
   Integrity tab uses (via ./validate-core.js), prints a report and exits
   non-zero if any issue is found. */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { validateArchive, summarize } from './validate-core.js';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, 'data');

async function readJSON(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function readCategory(gameId, key) {
  try {
    const recs = await readJSON(join(dataDir, gameId, `${key}.json`));
    return Array.isArray(recs) ? recs : [];
  } catch {
    return [];
  }
}

const schema = await readJSON(join(dataDir, 'schema.json'));
const games = await readJSON(join(dataDir, 'games.json'));
if (!Array.isArray(games)) throw new Error('data/games.json must be an array of games');
if (!schema || !Array.isArray(schema.entityTypes)) throw new Error('data/schema.json must define entityTypes[]');

const data = {};
for (const g of games) {
  data[g.id] = {};
  for (const t of schema.entityTypes) data[g.id][t.key] = await readCategory(g.id, t.key);
}

const issues = validateArchive({ schema, games, data });
const summary = summarize(games, data, schema, issues);

console.log(`The Elder Archive — validation report`);
console.log(`  ${summary.totalRecords} records across ${games.length} games`);
for (const g of summary.perGame) {
  if (g.total === 0 && g.issues === 0) continue;
  console.log(`  · ${g.title}: ${g.total} records, ${g.verified} verified, ${g.issues} issue${g.issues === 1 ? '' : 's'}`);
}

if (!issues.length) {
  console.log(`\n\u2713 No issues — every record conforms to schema.json.`);
  process.exitCode = 0;
} else {
  console.log(`\n${issues.length} issue${issues.length === 1 ? '' : 's'} found:`);
  for (const i of issues) {
    console.log(`  [${i.kind}] ${i.gameId}/${i.cat} · ${i.id} — ${i.detail}`);
  }
  process.exitCode = 1;
}
