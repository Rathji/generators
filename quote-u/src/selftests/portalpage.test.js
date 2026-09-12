(function () {
  const T = window.QU_SELFTEST;
  const PP = window.QU_PORTALPAGE;
  if (!T || !PP) return;

  function fakeApi(view) {
    return {
      handle: async req => {
        if (req.method === "GET" && req.path === "/view") {
          return { status: 200, body: { view: view, token: { expires_at: null }, version: view.version } };
        }
        return { status: 200, body: { view: view } };
      }
    };
  }

  // A minimal but complete client-safe view with one grouped pair of options.
  function viewWith(type) {
    return {
      kind: "quote-portal-view",
      currency: "CAD",
      quote: { title: "Acme quote", company_name: "Acme Ltd", quote_number: "QU-1" },
      version: { version_number: 1 },
      sections: [{ label: "One-time", kind: "one_time", lines: ["li-1", "li-2", "li-3"], total_cents: 10000 }],
      lines: [
        { id: "li-1", kind: "one_time", description: "Base", quantity: 1, unit_sell_cents: 10000, amount_cents: 10000, optional: false, option_group_id: null, selected: true },
        { id: "li-2", kind: "one_time", description: "Pro", quantity: 1, unit_sell_cents: 5000, amount_cents: 5000, optional: true, option_group_id: "g1", selected: false },
        { id: "li-3", kind: "one_time", description: "Enterprise", quantity: 1, unit_sell_cents: 9000, amount_cents: 9000, optional: true, option_group_id: "g1", selected: false }
      ],
      option_groups: [{ id: "g1", name: "Tier", selection_type: type, sort_order: 0, description: "" }],
      totals: { one_time_cents: 10000, mrr_cents: 0, annual_mrr_cents: 0, twelve_month_value_cents: 10000 }
    };
  }

  T.register("portal page: a canonical `bundle` group renders as a choose-one radio set", async () => {
    const bad = [];
    if (PP.controlFor({ selection_type: "bundle" }) !== "radio") bad.push("controlFor(bundle) = " + PP.controlFor({ selection_type: "bundle" }));
    if (PP.controlFor({ selection_type: "single" }) !== "radio") bad.push("controlFor(single) = " + PP.controlFor({ selection_type: "single" }));
    if (PP.controlFor({ selection_type: "multi" }) !== "checkbox") bad.push("controlFor(multi) = " + PP.controlFor({ selection_type: "multi" }));
    if (PP.groupTypeLabel({ selection_type: "bundle" }) !== "Choose one") bad.push("label(bundle) = " + PP.groupTypeLabel({ selection_type: "bundle" }));
    if (PP.groupTypeLabel({ selection_type: "multi" }) !== "Choose any") bad.push("label(multi) = " + PP.groupTypeLabel({ selection_type: "multi" }));
    if (PP.groupTypeLabel({ selection_type: "optional" }) !== "Optional") bad.push("label(optional) = " + PP.groupTypeLabel({ selection_type: "optional" }));

    const root = await PP.render({ secret: "s", api: fakeApi(viewWith("bundle")) });
    const radios = root.querySelectorAll('input[type="radio"][name="grp-g1"]');
    // the two members plus the "None of these" escape hatch
    if (radios.length !== 3) bad.push("bundle radio count = " + radios.length);
    if (!root.querySelector(".portal-opt-none")) bad.push("no 'None of these' escape hatch");
    const label = root.querySelector(".portal-group-type");
    if (!label || label.textContent !== "Choose one") bad.push("group type label = " + (label && label.textContent));
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "a bundle group is a 3-way radio set (2 members + None) labelled 'Choose one'" };
  });

  T.register("portal page: a multi group stays a checkbox set", async () => {
    const bad = [];
    const root = await PP.render({ secret: "s", api: fakeApi(viewWith("multi")) });
    if (root.querySelectorAll('input[type="radio"][name="grp-g1"]').length) bad.push("a multi group rendered radios");
    const boxes = root.querySelectorAll('input[type="checkbox"][data-group="g1"]');
    if (boxes.length !== 2) bad.push("multi checkbox count = " + boxes.length);
    const label = root.querySelector(".portal-group-type");
    if (!label || label.textContent !== "Choose any") bad.push("multi label = " + (label && label.textContent));
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "a multi group is a checkbox set labelled 'Choose any'" };
  });
})();
