/* Shared, environment-agnostic validation core for The Elder Archive.

   Pure ESM with no DOM, Node or browser APIs, so the exact same rules run in:
     - the app (src/app.js imports validateArchive for the Integrity tab), and
     - the standalone CLI (src/validate.mjs, run with `node src/validate.mjs`).

   An "issue" is { gameId, cat, id, name, kind, detail } where kind is one of:
   duplicate | required | enum | orphan. */

export function resolveRef(games, data, gameId, type, id) {
  const rec = (data[gameId]?.[type] || []).find((r) => r.id === id);
  if (rec) return { gameId, rec };
  for (const g of games) {
    const r2 = (data[g.id]?.[type] || []).find((r) => r.id === id);
    if (r2) return { gameId: g.id, rec: r2 };
  }
  return null;
}

export function validateArchive({ schema, games, data }) {
  const issues = [];
  for (const g of games) {
    for (const t of schema.entityTypes) {
      const recs = data[g.id]?.[t.key] || [];
      const seen = new Set();
      for (const rec of recs) {
        const base = { gameId: g.id, cat: t.key, id: rec.id, name: rec.name };
        if (seen.has(rec.id)) issues.push({ ...base, kind: 'duplicate', detail: `duplicate id \u201c${rec.id}\u201d` });
        seen.add(rec.id);
        for (const f of t.fields) {
          const raw = rec[f.key];
          const empty = raw === undefined || raw === null || raw === '' || (Array.isArray(raw) && raw.length === 0);
          if (f.required && empty) issues.push({ ...base, kind: 'required', detail: `missing required field \u201c${f.label}\u201d` });
          if (f.type === 'enum' && !empty) {
            const opts = f.options || [];
            const vals = Array.isArray(raw) ? raw : [raw];
            for (const v of vals) if (!opts.includes(v)) issues.push({ ...base, kind: 'enum', detail: `\u201c${f.label}\u201d has illegal value \u201c${v}\u201d` });
          }
          if (f.type === 'links' && !empty) {
            const ids = Array.isArray(raw) ? raw : [raw];
            for (const id of ids) if (!resolveRef(games, data, g.id, f.target, id)) issues.push({ ...base, kind: 'orphan', detail: `unresolved ${f.target} reference \u201c${id}\u201d` });
          }
        }
      }
    }
  }
  return issues;
}

/* A compact summary used by both the CLI and (optionally) the app. */
export function summarize(games, data, schema, issues) {
  const perGame = games.map((g) => {
    let total = 0, verified = 0;
    for (const t of schema.entityTypes) {
      const recs = data[g.id]?.[t.key] || [];
      total += recs.length;
      verified += recs.filter((r) => r.status === 'verified').length;
    }
    return { gameId: g.id, title: g.title, total, verified, issues: issues.filter((i) => i.gameId === g.id).length };
  });
  return {
    totalRecords: perGame.reduce((n, g) => n + g.total, 0),
    totalIssues: issues.length,
    byKind: issues.reduce((m, i) => (m[i.kind] = (m[i.kind] || 0) + 1, m), {}),
    perGame
  };
}
