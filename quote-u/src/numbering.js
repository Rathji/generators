// ============================================================================
// quote-u — quote identity & numbering (roadmap task 7)
// ----------------------------------------------------------------------------
// Every quote gets a human-readable number from a CONFIGURABLE scheme (default
// `QU-{YYYY}-{####}` → QU-2026-0001). A number is:
//   - unique  — the sequence is monotonic and the ledger of issued numbers is
//     consulted before every allocation, so a number can never be handed out
//     twice (even if a counter were somehow lost);
//   - stable  — once a quote carries a number it never changes; the ledger
//     records which quote owns which number;
//   - never reused — deleting or archiving a quote does not free its number.
//     Nothing decrements a counter and nothing removes a ledger entry.
//
// The counter + ledger live in the header of the `quotes` document
// (`content.numbering`), alongside the quote records. Allocation is a
// revision-guarded read-modify-write through the document store, so two devices
// racing on the same document cannot mint the same number: the loser re-reads
// the winner's revision and picks the next sequence.
//
// Scheme tokens (inside `{...}`): `{YYYY}` `{YY}` `{MM}` `{DD}` (UTC date of
// allocation) and exactly one `{#...}` sequence whose width = the number of
// `#` (zero-padded, but never truncated — sequence 10000 renders as `10000`).
// The sequence is BUCKETED by the rendered non-sequence prefix, so a pattern
// containing `{YYYY}` resets to 0001 each year while the ledger keeps the old
// numbers reserved forever.
// ============================================================================
(function () {
  "use strict";

  const VERSION = "1.0.0";
  const DEFAULT_DOC = "quotes";
  const DEFAULT_PATTERN = "QU-{YYYY}-{####}";
  const DEFAULT_MAX_RETRIES = 5;
  const DATE_TOKENS = ["YYYY", "YY", "MM", "DD"];
  const DATE_WORDS = { YYYY: "4-digit year", YY: "2-digit year", MM: "2-digit month", DD: "2-digit day" };
  const SCHEME_TOKENS = ["{YYYY}", "{YY}", "{MM}", "{DD}", "{####} (sequence — width = number of #)"];
  const SEQUENCE_MARK = "\u0001";

  class NumberingError extends Error {
    constructor(code, message) {
      super(message);
      this.name = "NumberingError";
      this.code = code;
    }
  }

  function fail(code, message) {
    throw new NumberingError(code, message);
  }

  // ---------------------------------------------------------------- schemes

  function parsePattern(pattern) {
    if (typeof pattern !== "string") fail("bad_scheme", "A numbering scheme pattern must be a string.");
    if (!pattern.trim()) fail("bad_scheme", "A numbering scheme pattern cannot be empty.");
    const segments = [];
    let seqCount = 0;
    let seqWidth = 0;
    let lastIndex = 0;
    const re = /\{([^{}]*)\}/g;
    let m;
    while ((m = re.exec(pattern))) {
      const lit = pattern.slice(lastIndex, m.index);
      if (lit) segments.push({ t: "lit", v: lit });
      const token = m[1];
      if (/^#+$/.test(token)) {
        seqCount += 1;
        if (seqCount > 1) fail("bad_scheme", "A numbering scheme pattern must contain exactly one sequence token (e.g. {####}).");
        if (token.length > 12) fail("bad_scheme", "A sequence token can have at most 12 digits.");
        seqWidth = token.length;
        segments.push({ t: "seq", width: token.length });
      } else if (DATE_TOKENS.indexOf(token) !== -1) {
        segments.push({ t: "date", v: token });
      } else {
        fail("bad_scheme", `Unknown numbering scheme token "{${token}}". Supported tokens: ${SCHEME_TOKENS.join(", ")}.`);
      }
      lastIndex = m.index + m[0].length;
    }
    const tail = pattern.slice(lastIndex);
    if (tail) segments.push({ t: "lit", v: tail });
    const braces = pattern.replace(/\{[^{}]*\}/g, "");
    if (braces.indexOf("{") !== -1 || braces.indexOf("}") !== -1) fail("bad_scheme", "A numbering scheme pattern has an unmatched brace.");
    if (!seqCount) fail("bad_scheme", "A numbering scheme pattern must contain a sequence token (e.g. {####}).");
    const tokens = segments.filter(s => s.t === "date").map(s => s.v);
    return { segments, seqWidth, tokens };
  }

  function describePattern(parsed) {
    const parts = [];
    for (const seg of parsed.segments) {
      if (seg.t === "date") parts.push(DATE_WORDS[seg.v]);
      else if (seg.t === "seq") parts.push(seg.width + "-digit sequence");
      else if (seg.v.trim()) parts.push('"' + seg.v + '"');
    }
    return parts.join(" ");
  }

  // Accept a pattern string (shorthand) or a { id, pattern, description } object.
  function normalizeScheme(scheme) {
    let id = "default";
    let pattern;
    let description;
    if (typeof scheme === "string") {
      pattern = scheme;
    } else if (scheme && typeof scheme === "object") {
      pattern = scheme.pattern;
      if (scheme.id !== undefined && scheme.id !== null) id = String(scheme.id);
      if (scheme.description !== undefined && scheme.description !== null) description = String(scheme.description);
    } else {
      fail("bad_scheme", "A numbering scheme must be a pattern string or a { pattern } object.");
    }
    const parsed = parsePattern(pattern);
    return Object.freeze({
      id,
      pattern,
      description: description === undefined ? describePattern(parsed) : description,
      seqWidth: parsed.seqWidth,
      tokens: Object.freeze(parsed.tokens.slice())
    });
  }

  const DEFAULT_SCHEME = normalizeScheme({ id: "default", pattern: DEFAULT_PATTERN, description: "Quote number — QU-<year>-<sequence>" });

  function segmentsOf(scheme) {
    if (typeof scheme === "string") return parsePattern(scheme).segments;
    if (scheme && Array.isArray(scheme.segments)) return scheme.segments;
    if (scheme && typeof scheme.pattern === "string") return parsePattern(scheme.pattern).segments;
    return parsePattern(DEFAULT_PATTERN).segments;
  }

  // ---------------------------------------------------------------- rendering

  function toDate(at) {
    if (at === undefined || at === null) return new Date();
    const d = at instanceof Date ? at : new Date(at);
    if (isNaN(d.getTime())) fail("bad_time", `Invalid numbering time "${at}".`);
    return d;
  }

  function datePart(d, token) {
    const y = d.getUTCFullYear();
    if (token === "YYYY") return String(y).padStart(4, "0");
    if (token === "YY") return String(((y % 100) + 100) % 100).padStart(2, "0");
    if (token === "MM") return String(d.getUTCMonth() + 1).padStart(2, "0");
    if (token === "DD") return String(d.getUTCDate()).padStart(2, "0");
    return "";
  }

  function pad(width, n) {
    const s = String(n);
    return s.length >= width ? s : "0".repeat(width - s.length) + s;
  }

  function renderSegments(segments, d, seq, mark) {
    let out = "";
    for (const seg of segments) {
      if (seg.t === "lit") out += seg.v;
      else if (seg.t === "date") out += datePart(d, seg.v);
      else out += mark === undefined ? pad(seg.width, seq) : mark;
    }
    return out;
  }

  function render(scheme, at, seq) {
    const n = Number(seq);
    if (!isFinite(n) || n < 0 || Math.floor(n) !== n) fail("bad_seq", `A quote sequence must be a non-negative integer (got "${seq}").`);
    return renderSegments(segmentsOf(scheme), toDate(at), n);
  }

  function format(scheme, at, seq) {
    return render(scheme, at, seq);
  }

  // The bucket key = the rendered non-sequence prefix/suffix. It changes exactly
  // when a date token rolls over, which is what makes a year-based scheme reset.
  function bucketKey(scheme, at) {
    return renderSegments(segmentsOf(scheme), toDate(at), 0, SEQUENCE_MARK);
  }

  function sample(scheme, at, seq) {
    return { scheme: describePattern(parsePattern(typeof scheme === "string" ? scheme : (scheme && scheme.pattern) || DEFAULT_PATTERN)), example: render(scheme || DEFAULT_PATTERN, at, seq === undefined ? 1 : seq) };
  }

  // ----------------------------------------------------------------- service

  function createService(opts) {
    opts = opts || {};
    const store = opts.store;
    if (!store || typeof store.loadDoc !== "function" || typeof store.saveChecked !== "function") {
      fail("no_store", "The numbering service needs a document store with loadDoc/saveChecked.");
    }
    const doc = opts.doc || DEFAULT_DOC;
    const maxRetries = opts.maxRetries === undefined ? DEFAULT_MAX_RETRIES : opts.maxRetries;
    const clock = typeof opts.clock === "function" ? opts.clock : () => new Date().toISOString();
    const initialScheme = normalizeScheme(opts.scheme || DEFAULT_PATTERN);

    function blank() {
      return { scheme: initialScheme, counters: {}, issued: {} };
    }

    function readState(content) {
      const n = content && content.numbering;
      if (!n || typeof n !== "object") return blank();
      let scheme;
      try {
        scheme = normalizeScheme(n.scheme || initialScheme);
      } catch (e) {
        scheme = initialScheme;
      }
      return { scheme, counters: Object.assign({}, n.counters || {}), issued: Object.assign({}, n.issued || {}) };
    }

    async function load() {
      const d = await store.loadDoc(doc);
      if (!d.ok) return d;
      return { ok: true, state: d.state, revision: d.revision, numberState: readState(d.content), content: d.content || { records: [] } };
    }

    async function mutate(fn) {
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const d = await store.loadDoc(doc);
        if (!d.ok) return d;
        const content = d.content || { records: [] };
        let outcome;
        try {
          outcome = fn(readState(content), content, { revision: d.revision, attempt });
        } catch (e) {
          if (e instanceof NumberingError) return { ok: false, code: e.code, detail: e.message };
          throw e;
        }
        const next = Object.assign({}, content, { numbering: outcome.state });
        const save = await store.saveChecked(doc, next, { expectedBase: d.revision });
        if (save.ok) {
          const res = outcome.result || {};
          return Object.assign({ ok: true, revision: save.revision, noop: !!save.noop }, res);
        }
        if (save.code === "conflict" || save.code === "conflict_stale" || save.code === "server_lag") continue;
        return save;
      }
      return { ok: false, code: "number_conflict", detail: `Could not allocate a quote number after ${maxRetries + 1} attempts; the ${doc} document kept moving.` };
    }

    function freezeState(ns) {
      return { scheme: ns.scheme, counters: ns.counters, issued: ns.issued };
    }

    function findByQuote(issued, quoteId) {
      if (quoteId === undefined || quoteId === null) return null;
      for (const number of Object.keys(issued)) {
        const e = issued[number];
        if (e && e.quote_id === quoteId) return Object.assign({ existing: true }, entryResult(e));
      }
      return null;
    }

    function entryResult(e) {
      return { number: e.number, seq: e.seq, bucket: e.bucket, at: e.at, quote_id: e.quote_id === undefined ? null : e.quote_id, entry: e };
    }

    function allocate(ns, spec) {
      const at = spec.at === undefined ? clock() : spec.at;
      const scheme = ns.scheme;
      const bucket = bucketKey(scheme, at);
      let seq = (Number(ns.counters[bucket]) || 0) + 1;
      let number = render(scheme, at, seq);
      // The ledger is the final authority on reuse: even if a counter were lost
      // or reset, we advance past any number already issued.
      let guard = 0;
      while (Object.prototype.hasOwnProperty.call(ns.issued, number)) {
        seq += 1;
        number = render(scheme, at, seq);
        if (++guard > 1000000) fail("number_reused", "Could not find an unused quote number.");
      }
      const quoteId = spec.quote_id === undefined ? null : spec.quote_id;
      const entry = { number, seq, bucket, at, quote_id: quoteId };
      const issued = Object.assign({}, ns.issued);
      issued[number] = entry;
      const counters = Object.assign({}, ns.counters);
      counters[bucket] = seq;
      return { state: { scheme, counters, issued }, result: Object.assign({ existing: false }, entryResult(entry)) };
    }

    async function mint(spec) {
      return mutate((ns) => allocate(ns, spec || {}));
    }

    // Idempotent per quote: a quote that already owns a number keeps it.
    async function ensure(quoteId, spec) {
      if (quoteId === undefined || quoteId === null || quoteId === "") fail("bad_quote", "ensure needs a quote id.");
      return mutate((ns) => {
        const found = findByQuote(ns.issued, quoteId);
        if (found) return { state: freezeState(ns), result: found };
        return allocate(ns, Object.assign({}, spec || {}, { quote_id: quoteId }));
      });
    }

    // Return the quote with a stable `quote_number`, allocating one if needed.
    async function attach(quote, spec) {
      if (!quote || typeof quote !== "object") fail("bad_quote", "attach needs a quote record.");
      const id = quote.id || quote.quote_id;
      if (!id) fail("bad_quote", "A quote needs an id before it can be numbered.");
      if (quote.quote_number) {
        const known = await lookup(quote.quote_number);
        return { ok: true, number: quote.quote_number, existing: true, issued: !!(known && known.entry), quote: Object.assign({}, quote) };
      }
      const res = await ensure(id, spec);
      if (!res.ok) return res;
      return Object.assign({}, res, { quote: Object.assign({}, quote, { quote_number: res.number }) });
    }

    async function lookup(number) {
      const d = await load();
      if (!d.ok) return d;
      const entry = d.numberState.issued[number] || null;
      return { ok: true, number, entry, issued: !!entry, revision: d.revision };
    }

    async function isIssued(number) {
      const r = await lookup(number);
      return !!(r && r.ok && r.issued);
    }

    async function list(filter) {
      const d = await load();
      if (!d.ok) return d;
      const ns = d.numberState;
      let entries = Object.keys(ns.issued).map(k => ns.issued[k]).filter(e => e && typeof e === "object");
      entries.sort((a, b) => (Number(a.seq) || 0) - (Number(b.seq) || 0) || String(a.number).localeCompare(String(b.number)));
      if (filter && filter.quote_id !== undefined) entries = entries.filter(e => e.quote_id === filter.quote_id);
      if (filter && filter.order === "desc") entries = entries.slice().reverse();
      if (filter && filter.limit !== undefined) entries = entries.slice(0, filter.limit);
      return { ok: true, entries, total: Object.keys(ns.issued).length, revision: d.revision };
    }

    async function count() {
      const d = await load();
      return d.ok ? { ok: true, count: Object.keys(d.numberState.issued).length, revision: d.revision } : d;
    }

    async function getScheme() {
      const d = await load();
      return d.ok ? { ok: true, scheme: d.numberState.scheme, revision: d.revision } : d;
    }

    // Change the scheme for FUTURE numbers only; issued numbers are untouched.
    async function setScheme(next) {
      const scheme = normalizeScheme(next);
      return mutate((ns) => ({ state: { scheme, counters: ns.counters, issued: ns.issued }, result: { scheme } }));
    }

    async function state() {
      const d = await load();
      if (!d.ok) return d;
      const ns = d.numberState;
      const numbers = Object.keys(ns.issued);
      return {
        ok: true,
        scheme: ns.scheme,
        counters: Object.assign({}, ns.counters),
        issuedCount: numbers.length,
        head: numbers.length ? ns.issued[numbers[numbers.length - 1]].number : null,
        revision: d.revision
      };
    }

    // Prove the ledger and the quote records agree: no number is used twice, no
    // quote carries an unrecorded number, and every counter is at least as high
    // as the sequence it has issued.
    async function verify(records) {
      const d = await load();
      if (!d.ok) return d;
      const ns = d.numberState;
      const recs = Array.isArray(records) ? records : Array.isArray(d.content && d.content.records) ? d.content.records : [];
      const breaks = [];
      const seen = Object.create(null);
      const maxSeqByBucket = Object.create(null);
      for (const number of Object.keys(ns.issued)) {
        const e = ns.issued[number];
        if (!e || typeof e !== "object") {
          breaks.push("ledger entry " + number + " is malformed");
          continue;
        }
        const b = e.bucket;
        maxSeqByBucket[b] = Math.max(maxSeqByBucket[b] || 0, Number(e.seq) || 0);
      }
      for (const r of recs) {
        if (!r || typeof r !== "object") continue;
        const num = r.quote_number;
        if (num === undefined || num === null || num === "") continue;
        const e = ns.issued[num];
        if (!e) {
          breaks.push("quote " + (r.id || r.quote_id || "?") + " carries number " + num + " that is not in the ledger");
          continue;
        }
        if (seen[num]) breaks.push("number " + num + " is used by more than one quote");
        seen[num] = true;
        const rid = r.id || r.quote_id;
        if (e.quote_id && rid && e.quote_id !== rid) breaks.push("number " + num + " is assigned to " + e.quote_id + " but used by " + rid);
      }
      for (const bucket of Object.keys(ns.counters)) {
        const c = Number(ns.counters[bucket]) || 0;
        const mx = maxSeqByBucket[bucket] || 0;
        if (c < mx) breaks.push("bucket " + JSON.stringify(bucket) + " counter " + c + " is behind its issued sequence " + mx);
      }
      return { ok: breaks.length === 0, breaks, issued: Object.keys(ns.issued).length, records: recs.length, scheme: ns.scheme, revision: d.revision };
    }

    function ready() {
      const p = store.ready ? Promise.resolve(store.ready()) : Promise.resolve();
      return p.then(() => true);
    }

    return {
      doc,
      load,
      mint,
      ensure,
      attach,
      lookup,
      isIssued,
      list,
      count,
      getScheme,
      setScheme,
      state,
      verify,
      ready
    };
  }

  window.QU_NUMBERING = {
    VERSION,
    DEFAULT_DOC,
    DEFAULT_PATTERN,
    DEFAULT_SCHEME,
    DATE_TOKENS,
    SCHEME_TOKENS,
    SEQUENCE_MARK,
    NumberingError,
    parsePattern,
    normalizeScheme,
    render,
    format,
    renderPattern: render,
    bucketKey,
    sample,
    createService
  };
})();
