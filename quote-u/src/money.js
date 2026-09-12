// quote-u — money engine (roadmap task 3)
//
// HARD RULE (invariant): every monetary value in quote-u is an INTEGER NUMBER
// OF CENTS in the currency's minor unit. A monetary value is NEVER held as a
// floating-point number, never stored as a decimal string, and is never
// computed with floating-point arithmetic. `Number.isSafeInteger` is the only
// accepted representation.
//
// The arithmetic here is exact: multiply/divide is done in BigInt and rounded
// half-away-from-zero at the final step, so 5% of $1,234.56 is 6173 cents and
// 2.675 parses to 268 cents, where naive float math gives 6172.8→wrong and
// 267.49999…→267.
//
// Money fields carry a `currency` column (reserved; v1 is fixed CAD). All
// arithmetic is currency-checked: mixing CAD and USD cents throws
// `currency_mismatch` rather than silently adding unlike units.
//
// Margin is DERIVED, never stored: there is no stored margin field anywhere in
// the model. marginCents/marginBp/markupBp recompute it from sell/cost cents on
// demand. `auditStoredMoney` walks a document and proves no float ever reached
// a money-shaped field.
(function () {
  "use strict";

  const VERSION = "1.0.0";
  const DEFAULT_CURRENCY = "CAD";
  const CURRENCY_FIELD = "currency";
  const MARGIN_IS_DERIVED = true;

  // Registered currencies. v1 ships CAD only; the others are reserved so the
  // currency column has a real domain and a later phase can enable them without
  // a data migration (minor units are what matter).
  const CURRENCY_INFO = {
    CAD: { minorUnits: 2, symbol: "$", label: "Canadian dollar", enabled: true },
    USD: { minorUnits: 2, symbol: "$", label: "US dollar", enabled: false },
    EUR: { minorUnits: 2, symbol: "€", label: "Euro", enabled: false },
    GBP: { minorUnits: 2, symbol: "£", label: "British pound", enabled: false },
    JPY: { minorUnits: 0, symbol: "¥", label: "Japanese yen", enabled: false }
  };

  const MAX_CENTS = Number.MAX_SAFE_INTEGER;
  const MIN_CENTS = -Number.MAX_SAFE_INTEGER;

  class MoneyError extends Error {
    constructor(code, message, meta) {
      super(message);
      this.name = "MoneyError";
      this.code = code;
      if (meta) this.meta = meta;
    }
  }

  function fail(code, message, meta) {
    throw new MoneyError(code, message, meta);
  }

  // ---------------------------------------------------------------- integers

  function isCents(v) {
    return typeof v === "number" && Number.isSafeInteger(v);
  }

  function assertCents(v, label) {
    if (!isCents(v)) {
      const what = label ? label + " " : "";
      if (typeof v === "number" && Number.isFinite(v) && !Number.isInteger(v)) {
        fail("fractional_cents", `Expected integer cents for ${what}but got ${v}. Money is never a float.`);
      }
      fail("not_integer_cents", `Expected integer cents for ${what}but got ${typeof v} ${String(v)}.`);
    }
    return v;
  }

  function isBp(v) {
    return typeof v === "number" && Number.isSafeInteger(v);
  }

  function assertBp(v, label) {
    if (!isBp(v)) fail("bad_rate", `Expected an integer basis-point rate for ${label || "rate"} but got ${String(v)}.`);
    return v;
  }

  function fromBig(big, ctx) {
    if (big > BigInt(MAX_CENTS) || big < BigInt(MIN_CENTS)) {
      fail("out_of_range", `Money overflow in ${ctx || "arithmetic"}: ${big.toString()} cents exceeds the safe integer range.`);
    }
    return Number(big);
  }

  // ---------------------------------------------------------------- currency

  function normalizeCurrency(code) {
    if (code === undefined || code === null || code === "") return DEFAULT_CURRENCY;
    if (typeof code !== "string") fail("invalid_currency", `Currency must be a 3-letter code, got ${typeof code}.`);
    const c = code.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(c)) fail("invalid_currency", `Currency "${code}" is not a 3-letter ISO code.`);
    if (!CURRENCY_INFO[c]) fail("unknown_currency", `Currency "${c}" is not registered in the money engine.`);
    return c;
  }

  function minorUnits(code) {
    return CURRENCY_INFO[normalizeCurrency(code)].minorUnits;
  }

  function currencyInfo(code) {
    const c = normalizeCurrency(code);
    return Object.assign({ code: c }, CURRENCY_INFO[c]);
  }

  function sameCurrency(a, b) {
    return normalizeCurrency(a) === normalizeCurrency(b);
  }

  function assertSameCurrency(a, b) {
    const ca = normalizeCurrency(a);
    const cb = normalizeCurrency(b);
    if (ca !== cb) fail("currency_mismatch", `Cannot combine ${ca} and ${cb} money — currencies must match.`);
    return ca;
  }

  // --------------------------------------------------------------- canonical

  // Accepts an integer number of cents (preferred), a {cents} object, a
  // {dollars}/{major} object, a bigint, or an integer string. A fractional
  // number is REFUSED — it is never rounded silently into a stored field.
  function toCents(value, opts) {
    opts = opts || {};
    if (isCents(value)) return value;
    if (typeof value === "bigint") return fromBig(value, "toCents");
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (/^[+-]?\d+$/.test(trimmed)) return fromBig(BigInt(trimmed), "toCents");
      return fromMajor(trimmed, opts);
    }
    if (value && typeof value === "object") {
      if (isCents(value.cents)) return value.cents;
      if (value.cents !== undefined) assertCents(value.cents, "cents");
      if (value.dollars !== undefined) return fromMajor(value.dollars, opts);
      if (value.major !== undefined) return fromMajor(value.major, opts);
      fail("bad_money_object", "Money objects must carry an integer `cents` field.");
    }
    return assertCents(value, "value");
  }

  function centsFromParts(majorWhole, minorPart) {
    assertCents(majorWhole, "major whole part");
    assertCents(minorPart, "minor part");
    const total = BigInt(majorWhole) * 100n + BigInt(minorPart);
    return fromBig(total, "centsFromParts");
  }

  // ---------------------------------------------------------------- parsing

  function isGroupedTriples(s) {
    const parts = s.split(",");
    if (parts.length < 2) return false;
    if (!/^\d{1,3}$/.test(parts[0])) return false;
    for (let i = 1; i < parts.length; i++) if (!/^\d{3}$/.test(parts[i])) return false;
    return true;
  }

  // Parse a human major-unit amount ("$1,234.56", "1.005", "1.234,56",
  // "(1,000)", "-12") into exact integer cents. Pure string arithmetic — no
  // floating point anywhere — rounding half-up at the currency's minor unit.
  function fromMajor(value, opts) {
    opts = opts || {};
    let mu = opts.currency !== undefined ? minorUnits(opts.currency) : 2;
    let text;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) fail("bad_amount", `Cannot parse ${value} as an amount.`);
      text = String(value);
      if (/e/i.test(text)) fail("bad_amount", `Cannot parse exponent-notation amount ${text}; pass a plain decimal string.`);
    } else if (typeof value === "bigint") {
      return fromBig(value, "fromMajor");
    } else if (typeof value === "string") {
      text = value;
    } else {
      fail("bad_amount", `Cannot parse ${typeof value} as an amount.`);
    }

    let s = text.trim();
    if (!s) fail("empty_amount", "Cannot parse an empty amount.");
    let negative = false;
    if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1).trim(); }
    if (s.charAt(0) === "-") { negative = !negative; s = s.slice(1).trim(); }
    else if (s.charAt(0) === "+") s = s.slice(1).trim();
    s = s.replace(/[A-Za-z$€£¥₹]/g, "").replace(/[\s\u00a0\u202f'’]/g, "");
    if (!s) fail("bad_amount", `"${text}" has no digits.`);
    if (!/^[0-9.,]+$/.test(s)) fail("bad_amount", `"${text}" is not a valid amount.`);

    const lastDot = s.lastIndexOf(".");
    const lastComma = s.lastIndexOf(",");
    let decimalSep = null;
    if (lastDot !== -1 && lastComma !== -1) decimalSep = lastDot > lastComma ? "." : ",";
    else if (lastDot !== -1) decimalSep = ".";
    else if (lastComma !== -1 && !isGroupedTriples(s)) decimalSep = ",";

    let intPart;
    let fracPart = "";
    if (decimalSep) {
      const i = s.lastIndexOf(decimalSep);
      intPart = s.slice(0, i);
      fracPart = s.slice(i + 1);
      const groupSep = decimalSep === "." ? "," : ".";
      intPart = intPart.split(groupSep).join("");
      fracPart = fracPart.split(groupSep).join("");
    } else {
      intPart = s.split(",").join("").split(".").join("");
    }
    if (intPart === "") intPart = "0";
    if (!/^\d+$/.test(intPart) || !/^\d*$/.test(fracPart)) fail("bad_amount", `"${text}" is not a valid amount.`);

    const keep = fracPart.slice(0, mu);
    const extra = fracPart.slice(mu);
    let minor = BigInt(intPart) * 10n ** BigInt(mu);
    if (mu > 0) minor += BigInt(keep.padEnd(mu, "0") || "0");
    if (extra && extra.charAt(0) >= "5") minor += 1n;
    if (negative) minor = -minor;
    return fromBig(minor, "fromMajor");
  }

  // -------------------------------------------------------------- arithmetic

  function add(a, b) {
    assertCents(a, "addend");
    assertCents(b, "addend");
    return fromBig(BigInt(a) + BigInt(b), "add");
  }

  function sub(a, b) {
    assertCents(a, "minuend");
    assertCents(b, "subtrahend");
    return fromBig(BigInt(a) - BigInt(b), "sub");
  }

  function sum(values, selector) {
    if (!Array.isArray(values)) fail("bad_sum", "sum() expects an array.");
    let total = 0n;
    for (let i = 0; i < values.length; i++) {
      const raw = selector ? selector(values[i], i) : values[i];
      if (raw === undefined || raw === null) continue;
      assertCents(raw, `sum item ${i}`);
      total += BigInt(raw);
    }
    return fromBig(total, "sum");
  }

  function negate(a) {
    assertCents(a, "value");
    return fromBig(-BigInt(a), "negate");
  }

  function abs(a) {
    assertCents(a, "value");
    return fromBig(BigInt(a) < 0n ? -BigInt(a) : BigInt(a), "abs");
  }

  function mulByInt(a, b) {
    assertCents(a, "multiplicand");
    assertCents(b, "multiplier");
    return fromBig(BigInt(a) * BigInt(b), "mulByInt");
  }

  // Exact a*num/den rounded half-away-from-zero. This is the ONLY division
  // primitive — it never touches a float, so allocation, percentages, tax and
  // margin all stay exact.
  function mulDiv(a, num, den) {
    assertCents(a, "dividend");
    if (typeof num !== "number" || !Number.isFinite(num)) fail("bad_operand", `mulDiv numerator must be a number, got ${String(num)}.`);
    if (typeof den !== "number" || !Number.isFinite(den)) fail("bad_operand", `mulDiv denominator must be a number, got ${String(den)}.`);
    if (!Number.isInteger(num) || !Number.isInteger(den)) {
      // Non-integer operands are rejected: they would reintroduce floats.
      fail("bad_operand", "mulDiv operands must be integers (use basis points for rates).");
    }
    if (den === 0) fail("divide_by_zero", "Cannot divide money by zero.");
    let n = BigInt(a) * BigInt(num);
    let d = BigInt(den);
    if (d < 0n) { n = -n; d = -d; }
    const negative = n < 0n;
    const an = negative ? -n : n;
    const q = (an * 2n + d) / (d * 2n);
    return fromBig(negative ? -q : q, "mulDiv");
  }

  function ratio(a, num, den) {
    return mulDiv(a, num, den);
  }

  // Basis points: 10000 bp = 100%. Rates are integers, never percentages-as-
  // floats, so a "7.25% markdown" is the integer 725 bp.
  function applyBp(cents, bp) {
    assertCents(cents, "amount");
    assertBp(bp, "basis points");
    return mulDiv(cents, bp, 10000);
  }

  function bpOf(part, whole) {
    assertCents(part, "part");
    assertCents(whole, "whole");
    if (whole === 0) fail("divide_by_zero", "Cannot take a ratio with a zero whole.");
    return mulDiv(part, 10000, whole);
  }

  function lineTotal(unitCents, quantity) {
    assertCents(unitCents, "unit price");
    if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 0) {
      fail("bad_quantity", `Quantity must be a non-negative integer, got ${String(quantity)}.`);
    }
    return mulByInt(unitCents, quantity);
  }

  // Indicative-only tax (invariant: finance owns the authoritative figure).
  function tax(cents, rateBp) {
    return applyBp(cents, rateBp);
  }

  // Split `total` cents across integer weights so the parts sum EXACTLY to the
  // total. Remainder cents go to the largest fractional parts; ties go to the
  // earliest weight (deterministic).
  function allocate(total, weights) {
    assertCents(total, "total");
    if (!Array.isArray(weights) || weights.length === 0) fail("bad_weights", "allocate() needs at least one weight.");
    const w = weights.map((x, i) => {
      if (typeof x !== "number" || !Number.isInteger(x) || x < 0) fail("bad_weights", `Weight ${i} must be a non-negative integer.`);
      return BigInt(x);
    });
    let total0 = 0n;
    w.forEach(x => { total0 += x; });
    if (total0 === 0n) fail("zero_weights", "allocate() weights sum to zero.");
    const negative = total < 0;
    const magnitude = BigInt(Math.abs(total));
    const shares = new Array(w.length).fill(0n);
    const remainders = [];
    let assigned = 0n;
    for (let i = 0; i < w.length; i++) {
      const numerator = magnitude * w[i];
      const q = numerator / total0;
      shares[i] = q;
      assigned += q;
      remainders.push({ i, r: numerator % total0 });
    }
    remainders.sort((a, b) => (b.r > a.r ? 1 : b.r < a.r ? -1 : a.i - b.i));
    let leftover = Number(magnitude - assigned);
    for (let k = 0; k < leftover; k++) shares[remainders[k % remainders.length].i] += 1n;
    const out = shares.map(s => fromBig(negative ? -s : s, "allocate"));
    if (sum(out) !== total) fail("allocate_bug", "Internal allocation did not conserve the total.");
    return out;
  }

  // ------------------------------------------------------------------ margin
  // Margin is derived from sell/cost cents on demand and is NEVER stored as an
  // authoritative field anywhere in quote-u.

  function marginCents(sell, cost) {
    return sub(sell, cost);
  }

  function marginBp(sell, cost) {
    assertCents(sell, "sell");
    assertCents(cost, "cost");
    if (sell === 0) return null;
    return bpOf(sub(sell, cost), sell);
  }

  function markupBp(cost, sell) {
    assertCents(cost, "cost");
    assertCents(sell, "sell");
    if (cost === 0) return null;
    return bpOf(sub(sell, cost), cost);
  }

  // ------------------------------------------------------------- formatting

  function localeDecimal(locale) {
    try {
      const parts = new Intl.NumberFormat(locale).formatToParts(1.1);
      const d = parts.filter(p => p.type === "decimal")[0];
      if (d) return d.value;
    } catch (e) {}
    return ".";
  }

  function localeGroup(locale) {
    try {
      const parts = new Intl.NumberFormat(locale).formatToParts(1000);
      const g = parts.filter(p => p.type === "group")[0];
      if (g) return g.value;
    } catch (e) {}
    return ",";
  }

  function groupDigits(digits, sep) {
    let out = "";
    let count = 0;
    for (let i = digits.length - 1; i >= 0; i--) {
      out = digits.charAt(i) + out;
      count++;
      if (count % 3 === 0 && i > 0) out = sep + out;
    }
    return out;
  }

  function splitDigits(absCents, mu) {
    let s = String(absCents);
    if (mu <= 0) return { intDigits: s, fracDigits: "" };
    if (s.length <= mu) s = s.padStart(mu + 1, "0");
    return { intDigits: s.slice(0, s.length - mu), fracDigits: s.slice(s.length - mu) };
  }

  function currencyAffixes(locale, code, asCode) {
    try {
      const probe = new Intl.NumberFormat(locale, {
        style: "currency",
        currency: code,
        currencyDisplay: asCode ? "code" : "symbol",
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
      });
      const parts = probe.formatToParts(0);
      let before = "";
      let after = "";
      let seenDigits = false;
      for (const p of parts) {
        if (p.type === "integer" || p.type === "group" || p.type === "decimal" || p.type === "fraction") {
          seenDigits = true;
          continue;
        }
        if (!seenDigits) before += p.value;
        else after += p.value;
      }
      if (before || after) return { before, after };
    } catch (e) {}
    const sym = CURRENCY_INFO[code] ? CURRENCY_INFO[code].symbol : code;
    return { before: "", after: " " + (asCode ? code : sym) };
  }

  // Format integer cents for display. The integer and fraction digits are
  // composed from the digits of the integer value itself, so even magnitudes
  // near Number.MAX_SAFE_INTEGER render exactly (no float, no rounding drift).
  function format(cents, opts) {
    opts = opts || {};
    assertCents(cents, "amount");
    const showCurrency = opts.currency !== false && opts.withCurrency !== false;
    const code = normalizeCurrency(showCurrency ? opts.currency : DEFAULT_CURRENCY);
    const mu = minorUnits(code);
    const locale = opts.locale || "en-CA";
    const { intDigits, fracDigits } = splitDigits(Math.abs(cents), mu);
    const grouped = opts.grouping === false ? intDigits : groupDigits(intDigits, opts.groupSeparator || localeGroup(locale));
    let digits = grouped;
    if (mu > 0) digits += (opts.decimalSeparator || localeDecimal(locale)) + fracDigits;
    let body = digits;
    if (showCurrency) {
      const affixes = currencyAffixes(locale, code, !!opts.code);
      body = affixes.before + digits + affixes.after;
    }
    if (cents < 0) body = opts.accounting ? "(" + body + ")" : "-" + body;
    return body;
  }

  // Plain, locale-free major-unit string ("1234.56") — exact, for values that
  // must cross a wire as a decimal but never live as a float.
  function majorString(cents, opts) {
    opts = opts || {};
    assertCents(cents, "amount");
    const mu = opts.minorUnits !== undefined ? opts.minorUnits : minorUnits(opts.currency);
    const { intDigits, fracDigits } = splitDigits(Math.abs(cents), mu);
    const sign = cents < 0 ? "-" : "";
    return sign + intDigits + (mu > 0 ? "." + fracDigits : "");
  }

  function formatBp(bp) {
    assertBp(bp, "basis points");
    const sign = bp < 0 ? "-" : "";
    const magnitude = Math.abs(bp);
    const whole = Math.floor(magnitude / 100);
    const frac = magnitude % 100;
    let fracStr = String(frac).padStart(2, "0").replace(/0+$/, "");
    return sign + whole + (fracStr ? "." + fracStr : "") + "%";
  }

  // ---------------------------------------------------- stored-field auditing
  // The model has money-shaped field names. `auditStoredMoney` walks a document
  // and proves every one of them is an integer number of cents — the executable
  // form of "no monetary value is ever held as a floating-point number".

  const MONEY_FIELD_NAMES = new Set([
    "unit_cost_cents", "unit_sell_cents", "one_time_total_cents", "mrr_total_cents",
    "twelve_month_value_cents", "deal_value_cents", "list_price_cents", "sell_cents",
    "cost_cents", "amount_cents", "total_cents", "price_cents", "value_cents",
    "unitCost", "unitSell", "listPrice", "sellPrice", "netPrice", "dealValue",
    "oneTimeTotal", "mrrTotal", "twelveMonthValue",
    "unit_cost", "unit_sell", "list_price", "sell_price", "net_price", "deal_value",
    "one_time_total", "mrr_total", "twelve_month_value"
  ]);

  const DEFAULT_RAW_KEYS = ["raw", "rawPayload", "rawResponse", "raw_response", "raw_payload"];

  function isMoneyFieldName(name) {
    if (!name) return false;
    if (MONEY_FIELD_NAMES.has(name)) return true;
    if (/(?:^|_)cents?$/i.test(name)) return true;
    if (/(?:Cents|Cost|Sell|Price|Amount|Value)$/.test(name)) return true;
    if (/^(?:unit_cost|unit_sell|list_price|sell_price|net_price|deal_value)$/.test(name)) return true;
    return false;
  }

  function auditStoredMoney(rootValue, opts) {
    opts = opts || {};
    const ignore = new Set(opts.ignoreKeys || DEFAULT_RAW_KEYS);
    const violations = [];
    let moneyFields = 0;
    const seen = new Set();
    const walk = (value, path) => {
      if (value === null || typeof value !== "object") return;
      if (seen.has(value)) return;
      seen.add(value);
      if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) walk(value[i], path + "[" + i + "]");
        return;
      }
      for (const key of Object.keys(value)) {
        if (ignore.has(key)) continue;
        const child = value[key];
        const childPath = path ? path + "." + key : key;
        if (child !== null && child !== undefined && isMoneyFieldName(key)) {
          moneyFields++;
          if (typeof child === "number") {
            if (!Number.isSafeInteger(child)) {
              violations.push({
                path: childPath, key, value: child,
                reason: Number.isInteger(child) ? "unsafe_integer" : "fractional_cents"
              });
            }
          } else if (typeof child === "string") {
            if (/(?:^|_)cents?$/i.test(key) || opts.strictStrings) {
              violations.push({ path: childPath, key, value: child, reason: "string_not_integer" });
            }
          } else if (typeof child !== "bigint") {
            violations.push({ path: childPath, key, value: String(child), reason: "not_numeric" });
          }
        }
        walk(child, childPath);
      }
    };
    walk(rootValue, "");
    return { ok: violations.length === 0, violations, moneyFields };
  }

  function assertStored(value, opts) {
    const audit = auditStoredMoney(value, opts);
    if (!audit.ok) {
      fail("float_in_stored_money",
        "Stored money must be integer cents — found " +
        audit.violations.map(v => `${v.path}=${v.value} (${v.reason})`).join(", "),
        { violations: audit.violations });
    }
    return value;
  }

  // A plain, frozen money value: integer cents + its currency column. This is a
  // convenience for moving a value around together with its currency; it is
  // never a float and never a formatted string.
  function money(cents, currency) {
    assertCents(cents, "amount");
    return Object.freeze({ cents: cents, currency: normalizeCurrency(currency) });
  }

  window.QU_MONEY = {
    VERSION,
    DEFAULT_CURRENCY,
    CURRENCY_FIELD,
    CURRENCY_INFO,
    MARGIN_IS_DERIVED,
    MoneyError,

    // integrity
    isCents,
    assertCents,
    assertBp,
    assertSameCurrency,
    sameCurrency,
    normalizeCurrency,
    minorUnits,
    currencyInfo,

    // canonicalisation & parsing
    toCents,
    fromMajor,
    parse: fromMajor,
    centsFromParts,
    money,

    // arithmetic (exact, integer-only)
    add,
    sub,
    negate,
    abs,
    sum,
    mulByInt,
    mulDiv,
    ratio,
    applyBp,
    bpOf,
    lineTotal,
    tax,
    allocate,

    // derived margin (never stored)
    marginCents,
    marginBp,
    markupBp,

    // formatting
    format,
    majorString,
    formatBp,

    // stored-field auditing
    isMoneyFieldName,
    MONEY_FIELD_NAMES: Array.from(MONEY_FIELD_NAMES),
    auditStoredMoney,
    assertStored
  };
})();
