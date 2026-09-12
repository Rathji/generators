(function () {
  const T = window.QU_SELFTEST;
  const PV = window.QU_PORTALVIEW;
  const LI = window.QU_LINEITEMS;
  const TOT = window.QU_TOTALS;
  const M = window.QU_MONEY;
  if (!T || !PV || !LI || !TOT || !M) return;

  function throws(fn, code) {
    try {
      fn();
    } catch (err) {
      if (code && err.code !== code) return "threw " + err.code + " instead of " + code;
      return null;
    }
    return "did not throw";
  }

  // A deterministic PRNG so the fuzz shapes are the same on every run.
  function rng(seed) {
    let s = seed >>> 0;
    return function () {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  function makeLine(r, i) {
    const kind = r() < 0.5 ? "one_time" : "mrr";
    const optional = r() < 0.4;
    const groupId = optional && r() < 0.7 ? "g" + Math.floor(r() * 3) : null;
    const useSnapshot = r() < 0.5;
    const input = {
      kind,
      description: "Item " + i,
      manufacturer_part_number: "MPN-" + i,
      sku: "SKU-" + i,
      section: r() < 0.5 ? "Hardware" : "",
      quantity: 1 + Math.floor(r() * 4),
      unit_cost_cents: Math.floor(r() * 50000),
      unit_sell_cents: 1000 + Math.floor(r() * 200000),
      optional,
      option_group_id: groupId,
      selected_by_default: optional ? r() < 0.5 : false,
      sort_order: i
    };
    if (useSnapshot) {
      input.price_snapshot_ref = "snap-" + i;
      input.pricing_mode = "snapshot";
    }
    return LI.normalize(input, { id: "li-" + i });
  }

  function makeShape(seed) {
    const r = rng(seed);
    const count = 1 + Math.floor(r() * 8);
    const lines = [];
    for (let i = 0; i < count; i++) lines.push(makeLine(r, i));
    const groups = [0, 1, 2].slice(0, Math.floor(r() * 4)).map((n, i) => ({
      id: "g" + i,
      quote_version_id: "v-1",
      name: "Group " + i,
      selection_type: ["single", "multi", "optional"][Math.floor(r() * 3)],
      sort_order: i,
      description: r() < 0.5 ? "choose one" : ""
    }));
    const selection = lines.filter(l => l.optional).map(l => ({ id: l.id, on: r() < 0.6 }))
      .reduce((acc, x) => { if (x.on) acc.push(x.id); return acc; }, []);
    return {
      quote: {
        id: "q-1", quote_number: "QU-2026-0001", title: "Acme quote",
        company_name: "Acme Ltd", contact_name: "Dana", contact_email: "dana@acme.test",
        opportunity_name: "Acme refresh", created_at: "2026-08-01T00:00:00.000Z",
        internal_note: "priced thin — floor is 18%", cost_basis_cents: 12345
      },
      version: {
        id: "v-1", quote_id: "q-1", version_number: 1, state: "draft",
        title: "Acme quote", frozen_at: null, created_at: "2026-08-01T00:00:00.000Z",
        revised_from: null, internal_margin_target_bp: 3000
      },
      line_items: lines,
      option_groups: groups,
      selection
    };
  }

  T.register("portal view: the serializer whitelists fields and derives amounts from sell price only", () => {
    const line = LI.normalize({
      kind: "one_time", description: "Firewall", quantity: 3,
      unit_cost_cents: 80000, unit_sell_cents: 125000,
      price_snapshot_ref: "snap-1", pricing_mode: "snapshot"
    }, { id: "li-1" });
    const dto = PV.serialize({ quote: { id: "q", title: "T" }, version: { id: "v", version_number: 1 }, line_items: [line] });
    const bad = [];
    const dtoLine = dto.lines[0];
    if (dtoLine.amount_cents !== 375000) bad.push("amount=" + dtoLine.amount_cents);
    if (dtoLine.unit_sell_cents !== 125000) bad.push("sell=" + dtoLine.unit_sell_cents);
    ["unit_cost_cents", "price_snapshot_ref", "pricing_mode", "catalog_ref"].forEach(f => {
      if (Object.prototype.hasOwnProperty.call(dtoLine, f)) bad.push("leaked line field " + f);
    });
    if (!dtoLine.selected) bad.push("required line not selected");
    const serialized = JSON.stringify(dto);
    ["unit_cost_cents", "price_snapshot_ref", "pricing_mode", "margin", "markup", "list_price"].forEach(k => {
      if (serialized.indexOf('"' + k + '"') !== -1) bad.push("serialized view contains " + k);
    });
    if (PV.audit(dto).ok !== true) bad.push("audit failed: " + JSON.stringify(PV.audit(dto).violations));
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "only client fields copied; amount derived from unit sell; cost/snapshot/margin absent" };
  });

  T.register("portal view: totals come from the shared QU_TOTALS engine", () => {
    const lines = [
      LI.normalize({ kind: "one_time", description: "A", quantity: 2, unit_sell_cents: 100000, unit_cost_cents: 60000 }, { id: "li-1" }),
      LI.normalize({ kind: "mrr", description: "B", unit_sell_cents: 25000, unit_cost_cents: 9000, optional: true, selected_by_default: true }, { id: "li-2" })
    ];
    const dto = PV.serialize({ line_items: lines, selection: ["li-1", "li-2"] });
    const shared = TOT.computeTotals({ line_items: lines, selection: ["li-1", "li-2"] });
    const bad = [];
    if (!TOT.sameTotals({
      one_time_cents: dto.totals.one_time_cents, mrr_cents: dto.totals.mrr_cents,
      annual_mrr_cents: dto.totals.annual_mrr_cents, twelve_month_value_cents: dto.totals.twelve_month_value_cents,
      deal_value_cents: dto.totals.deal_value_cents, currency: dto.totals.currency,
      term_months: dto.totals.term_months, selected_count: dto.totals.selected_count
    }, shared)) bad.push("totals disagree with QU_TOTALS");
    if (dto.totals.one_time_cents !== 200000) bad.push("one_time=" + dto.totals.one_time_cents);
    if (dto.totals.mrr_cents !== 25000) bad.push("mrr=" + dto.totals.mrr_cents);
    if (dto.totals.twelve_month_value_cents !== 500000) bad.push("twelve=" + dto.totals.twelve_month_value_cents);
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "client view totals are byte-identical to the shared totals engine" };
  });

  T.register("portal view: selection toggles change totals and the per-line selected flag", () => {
    const lines = [
      LI.normalize({ kind: "one_time", description: "Base", unit_sell_cents: 10000 }, { id: "li-1" }),
      LI.normalize({ kind: "one_time", description: "Add-on", unit_sell_cents: 5000, optional: true, selected_by_default: false }, { id: "li-2" })
    ];
    const bad = [];
    const off = PV.serialize({ line_items: lines, selection: [] });
    const offLine = off.lines.find(l => l.id === "li-2");
    if (offLine.selected !== false) bad.push("unselected add-on flagged selected");
    if (off.totals.one_time_cents !== 10000) bad.push("off total=" + off.totals.one_time_cents);
    const on = PV.serialize({ line_items: lines, selection: ["li-1", "li-2"] });
    const onLine = on.lines.find(l => l.id === "li-2");
    if (onLine.selected !== true) bad.push("selected add-on not flagged");
    if (on.totals.one_time_cents !== 15000) bad.push("on total=" + on.totals.one_time_cents);
    if (off.sections[0].total_cents !== 10000 || on.sections[0].total_cents !== 15000) bad.push("section totals do not track selection");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "toggling an optional line flips its flag and the totals/section sums" };
  });

  T.register("portal view: lines are grouped into one-time and monthly sections", () => {
    const lines = [
      LI.normalize({ kind: "one_time", description: "AP", section: "Hardware", unit_sell_cents: 10000, sort_order: 1 }, { id: "li-1" }),
      LI.normalize({ kind: "one_time", description: "Labour", section: "Services", unit_sell_cents: 20000, sort_order: 2 }, { id: "li-2" }),
      LI.normalize({ kind: "mrr", description: "Circuit", section: "Internet", unit_sell_cents: 50000, sort_order: 3 }, { id: "li-3" })
    ];
    const dto = PV.serialize({ line_items: lines });
    const bad = [];
    if (dto.sections.length !== 3) bad.push("sections=" + dto.sections.length);
    if (dto.sections[0].kind !== "one_time") bad.push("one-time not first");
    const labels = dto.sections.map(s => s.label);
    if (labels.indexOf("One-time · Hardware") === -1) bad.push("hardware label missing: " + labels.join(","));
    if (labels.indexOf("One-time · Services") === -1) bad.push("services label missing");
    if (labels.indexOf("Monthly · Internet") === -1) bad.push("internet label missing");
    if (dto.lines.map(l => l.id).join(",") !== "li-1,li-2,li-3") bad.push("line order: " + dto.lines.map(l => l.id).join(","));
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "sections keyed by kind + section, one-time first; line order follows sort_order" };
  });

  T.register("portal view: no cost or margin field survives for any generated quote shape", () => {
    const bad = [];
    let checked = 0;
    let totalForbiddenKeys = 0;
    for (let seed = 1; seed <= 160; seed++) {
      const shape = makeShape(seed);
      let dto;
      try {
        dto = PV.serialize(shape);
      } catch (e) {
        bad.push("seed " + seed + " threw " + e.code + ": " + e.message);
        if (bad.length > 4) break;
        continue;
      }
      checked++;
      const a = PV.audit(dto);
      if (!a.ok) {
        totalForbiddenKeys += a.violations.length;
        bad.push("seed " + seed + " leaked " + a.violations.map(v => v.path).join(","));
        if (bad.length > 4) break;
      }
      // Belt and braces: no forbidden field NAME may appear in the JSON.
      const json = JSON.stringify(dto);
      ["unit_cost_cents", "unit_cost", "margin", "markup", "profit", "price_snapshot_ref", "list_price_cents", "internal_note", "cost_basis_cents"].forEach(f => {
        if (json.indexOf('"' + f + '"') !== -1) bad.push("seed " + seed + " JSON contains " + f);
      });
    }
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: checked + " quote shapes serialized; zero cost/margin/snapshot fields across all of them (" + totalForbiddenKeys + " leaks)" };
  });

  T.register("portal view: audit refuses hand-injected cost fields (and sanitize strips them)", () => {
    const dto = PV.serialize({ line_items: [LI.normalize({ kind: "one_time", description: "x", unit_sell_cents: 100 })] });
    const bad = [];
    const leaked = JSON.parse(JSON.stringify(dto));
    leaked.lines[0].unit_cost_cents = 42;
    const e1 = throws(() => PV.assertClientSafe(leaked), "cost_leak");
    if (e1) bad.push("top-level injection: " + e1);
    const nested = JSON.parse(JSON.stringify(dto));
    if (!nested.totals) nested.totals = {};
    nested.totals.margin_bp = 4000;
    const a = PV.audit(nested);
    if (a.ok || a.violations.length === 0 || a.violations[0].reason.indexOf("margin") === -1) bad.push("nested margin not caught: " + JSON.stringify(a));
    const deep = { a: { b: [{ c: { raw_response: "x" } }] } };
    if (PV.audit(deep).ok) bad.push("nested raw payload not caught");
    const stripped = PV.sanitize(leaked);
    if (Object.prototype.hasOwnProperty.call(stripped.lines[0], "unit_cost_cents")) bad.push("sanitize kept the cost field");
    if (!PV.audit(stripped).ok) bad.push("sanitized object still fails the audit");
    if (PV.audit({ unitSellCents: 1, amount_cents: 2, twelve_month_value_cents: 3, quote_number: "Q" }).ok !== true) bad.push("a clean sell-only object was flagged");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "assertClientSafe throws cost_leak on any injected/nested cost field; sanitize removes them; sell-only objects pass" };
  });

  T.register("portal view: the client view drops internal quote/version fields", () => {
    const shape = makeShape(7);
    const dto = PV.serialize(shape);
    const bad = [];
    const serialized = JSON.stringify(dto);
    if (serialized.indexOf("priced thin") !== -1) bad.push("internal quote note leaked");
    if (serialized.indexOf("internal_margin_target_bp") !== -1) bad.push("internal version field leaked");
    if (dto.quote.quote_number !== "QU-2026-0001") bad.push("quote number missing");
    if (dto.quote.company_name !== "Acme Ltd") bad.push("company missing");
    if (dto.quote.contact_email !== "dana@acme.test") bad.push("contact email missing");
    if (Object.prototype.hasOwnProperty.call(dto.quote, "internal_note")) bad.push("quote DTO has internal_note");
    if (Object.prototype.hasOwnProperty.call(dto.version, "internal_margin_target_bp")) bad.push("version DTO has internal field");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "internal notes/targets are dropped; client-facing identifiers survive" };
  });

  T.register("portal view: renderHtml escapes hostile text and toText is plain and cost-free", () => {
    const hostile = '<img src=x onerror="alert(1)"> & "quoted"';
    const line = LI.normalize({ kind: "one_time", description: hostile, sku: "<b>", unit_sell_cents: 12345, quantity: 2 }, { id: "li-1" });
    const dto = PV.serialize({ quote: { title: hostile, quote_number: "QU-1" }, line_items: [line] });
    const html = PV.renderHtml(dto, { note: hostile });
    const bad = [];
    if (html.indexOf("<img") !== -1) bad.push("raw HTML injected");
    if (html.indexOf(hostile) !== -1) bad.push("hostile string present unescaped");
    if (html.indexOf("&lt;img") === -1) bad.push("hostile text was not escaped");
    if (html.indexOf("$246.90") === -1) bad.push("amount not formatted: " + html.slice(0, 60));
    if (PV.audit({ html: html }).ok !== true && /cost|margin/i.test(html)) bad.push("rendered HTML mentions cost/margin");
    const text = PV.toText(dto);
    if (text.indexOf(hostile) === -1) bad.push("toText dropped the description");
    if (/unit_cost|margin|markup/i.test(text)) bad.push("toText mentions cost/margin");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "renderHtml escapes every injected value; toText renders a plain cost-free summary" };
  });

  T.register("portal view: a raw quote shape with an unknown field cannot leak through", () => {
    const line = LI.normalize({ kind: "one_time", description: "x", unit_sell_cents: 100 }, { id: "li-1" });
    line.secret_margin_note = "do not show";
    line.unit_cost_cents = 55;
    line.wholesalePrice = 70;
    const dto = PV.serialize({ line_items: [line] });
    const bad = [];
    const serialized = JSON.stringify(dto);
    ["secret_margin_note", "unit_cost_cents", "wholesalePrice"].forEach(f => {
      if (serialized.indexOf(f) !== -1) bad.push("unknown/internal field leaked: " + f);
    });
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "extra fields on a raw line are never copied; the whitelist is the only path to a client view" };
  });
})();
