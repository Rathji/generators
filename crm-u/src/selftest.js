window.SELFTEST = (function () {
  const tests = [];
  let lastResults = null;

  function register(name, fn) {
    tests.push({ name, fn });
  }

  function normalize(r) {
    if (r === undefined || r === true || r === null) return { pass: true, detail: "" };
    if (r === false) return { pass: false, detail: "" };
    if (typeof r === "string") return { pass: true, detail: r };
    if (r && typeof r === "object") {
      return { pass: !!r.pass, skip: !!r.skip, detail: r.detail || "" };
    }
    return { pass: true, detail: "" };
  }

  async function run(filter) {
    const results = [];
    for (const t of tests) {
      if (filter && t.name.indexOf(filter) === -1) continue;
      const start = performance.now();
      let outcome;
      try {
        outcome = normalize(await t.fn());
      } catch (err) {
        outcome = { pass: false, detail: (err && err.message) || String(err) };
      }
      results.push({
        name: t.name,
        pass: outcome.pass,
        skip: !!outcome.skip,
        detail: outcome.detail || "",
        ms: Math.round(performance.now() - start)
      });
    }
    lastResults = results;
    return results;
  }

  return {
    register,
    run,
    list: () => tests.slice(),
    get lastResults() { return lastResults; }
  };
})();
