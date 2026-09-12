/* ============================================================
   PSA-U — admin console (Phase 1 · Tasks 4 & 5 + Task 6 tools)
   One console for the system-wide configuration every module
   depends on:
     Overview       — the service provider's own profile
     Members        — members, teams and business-hours calendars
     Configuration  — the taxonomy (boards, statuses, priorities,
                      types, work types, charge codes, terms …)
                      with its change history
     Security       — the role / scope model, enforced in code
     Data & sync    — sync centre, backup/restore, version history
                      and per-document storage sizing
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  const A = (ERP.admin = {});

  function ten() { return ERP.tenancy; }

  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

  function colorField(name, label, val) {
    return ERP.ui.field(label, '<input type="color" name="' + ERP.ui.esc(name) + '" value="' + ERP.ui.esc(val || "#0a58ca") + '">');
  }

  /* ─────────────────────────── overview ─────────────────────────── */

  async function renderOverview(panel, refresh) {
    const ui = ERP.ui;
    const p = (await ten().provider()) || {};
    const canEdit = ERP.security.can("data.manage");
    const fields =
      ui.text("name", "Provider name", p.name, "e.g. Northwind Managed IT") +
      ui.text("legalName", "Legal name", p.legalName) +
      '<div class="erp-form-row">' + ui.text("email", "Email", p.email) + ui.text("phone", "Phone", p.phone) + "</div>" +
      ui.text("website", "Website", p.website) +
      ui.text("address", "Address", p.address) +
      '<div class="erp-form-row">' + ui.text("city", "City", p.city) + ui.text("region", "State / region", p.region) + "</div>" +
      '<div class="erp-form-row">' + ui.text("country", "Country", p.country) + ui.text("timezone", "Timezone", p.timezone) + "</div>" +
      '<div class="erp-form-row">' +
        ui.select("currency", "Currency", Object.keys(ui.CURRENCIES), p.currency || "USD") +
        ui.select("fiscalYearStartMonth", "Fiscal year starts", MONTHS.map((m, i) => ({ value: i + 1, label: m })), p.fiscalYearStartMonth || 1) +
      "</div>" +
      ui.textarea("notes", "Notes", p.notes, 3);

    panel.innerHTML = ui.card("Service provider profile",
      (canEdit ? "" : ui.alert("Only an owner can edit the provider profile.", "warn")) +
      '<form class="erp-form" data-ui-form>' + fields + '<div class="erp-form-foot">' + ui.btn("Save profile", { primary: true, act: "ov-save", disabled: !canEdit }) + "</div></form>");

    ui.bind(panel, "click", "[data-act=ov-save]", async (t) => {
      if (!ERP.security.enforce("data.manage")) return;
      const form = panel.querySelector("[data-ui-form]");
      const v = ui.collect(form, ["name", "legalName", "email", "phone", "website", "address", "city", "region", "country", "timezone", "currency", "fiscalYearStartMonth", "notes"]);
      if (!v.name) { ERP.toast("A provider name is required.", "error"); return; }
      t.disabled = true;
      await ten().updateProvider(Object.assign({}, p, v));
      ERP.toast("Provider profile saved.", "success");
      refresh();
    });
  }

  /* ─────────────────────────── members ─────────────────────────── */

  async function openMemberModal(member, refresh) {
    const ui = ERP.ui;
    if (!ERP.security.enforce("members.edit")) return;
    const [teams, calendars, companies] = await Promise.all([
      ERP.members.teams(),
      ERP.members.calendars(),
      ERP.companies.list(),
    ]);
    const m = member || ERP.members.newMember();
    const scopes = m.scopes || { companies: [], financials: false };
    const fields =
      ui.text("name", "Name", m.name) +
      ui.text("title", "Job title", m.title) +
      '<div class="erp-form-row">' + ui.text("email", "Email", m.email) + ui.text("phone", "Phone", m.phone) + "</div>" +
      '<div class="erp-form-row">' +
        ui.select("functionalRole", "Functional role", ERP.security.FUNCTIONAL_ROLES.map((r) => ({ value: r.id, label: r.label })), m.functionalRole) +
        ui.select("systemRole", "System role", ERP.ROLES.map((r) => ({ value: r, label: ERP.ROLE_LABELS[r] })), m.systemRole) +
      "</div>" +
      '<div class="field"><label>Teams</label><div class="radio-group">' +
        (teams.length ? teams.map((t) => '<label><input type="checkbox" data-team value="' + ui.esc(t.id) + '"' + ((m.teams || []).map(String).indexOf(String(t.id)) >= 0 ? " checked" : "") + "> " + ui.esc(t.name) + "</label>").join("") : '<span class="erp-sub">No teams yet — create one below.</span>') +
      "</div></div>" +
      ui.text("skills", "Skills (comma separated)", (m.skills || []).join(", "), "Windows, networking, M365") +
      ui.select("calendarId", "Business-hours calendar", calendars.map((c) => ({ value: c.id, label: c.name })), m.calendarId) +
      '<div class="erp-form-row">' + ui.number("hourlyCost", "Hourly cost", m.hourlyCost) + ui.number("hourlyRate", "Hourly charge", m.hourlyRate) + "</div>" +
      '<div class="field"><label>Client scope</label><div class="radio-group">' +
        (companies.length ? companies.map((c) => '<label><input type="checkbox" data-company value="' + ui.esc(c.id) + '"' + ((scopes.companies || []).map(String).indexOf(String(c.id)) >= 0 ? " checked" : "") + "> " + ui.esc(c.name) + "</label>").join("") : '<span class="erp-sub">No clients yet.</span>') +
      '</div><div class="hint">Leave all unchecked for access to every client.</div></div>' +
      ui.check("financials", "May see financial figures", scopes.financials !== false) +
      ui.check("active", "Active", m.active !== false);

    const modal = ui.modal({
      title: member ? "Edit member" : "New member",
      body: ui.form(fields),
      foot: ui.btn("Cancel", { small: true, act: "m-cancel" }) + " " + ui.btn(member ? "Save member" : "Create member", { small: true, primary: true, act: "m-save" }),
    });
    const form = modal.querySelector("[data-ui-form]");
    modal.querySelector("[data-act=m-cancel]").onclick = () => ui.closeModal();
    modal.querySelector("[data-act=m-save]").onclick = async (t) => {
      const v = ui.collect(form, ["name", "title", "email", "phone", "functionalRole", "systemRole", "skills", "calendarId", "hourlyCost", "hourlyRate", "financials", "active"]);
      if (!v.name) { ERP.toast("A member name is required.", "error"); return; }
      const rec = Object.assign({}, m, v, {
        teams: Array.from(form.querySelectorAll("[data-team]:checked")).map((i) => Number(i.value)),
        skills: String(v.skills || "").split(",").map((s) => s.trim()).filter(Boolean),
        scopes: {
          companies: Array.from(form.querySelectorAll("[data-company]:checked")).map((i) => Number(i.value)),
          financials: !!v.financials,
        },
      });
      delete rec.skillsRaw;
      t.disabled = true;
      const res = await ERP.members.save("member", rec);
      ui.closeModal();
      if (res.error) { ERP.toast("Could not save: " + (res.message || res.error), "error"); return; }
      ERP.toast(member ? "Member updated." : "Member created.", "success");
      refresh();
    };
  }

  async function openTeamModal(team, refresh) {
    const ui = ERP.ui;
    if (!ERP.security.enforce("teams.edit")) return;
    const t0 = team || ERP.members.newTeam();
    const members = await ERP.members.members();
    const fields =
      ui.text("name", "Team name", t0.name) +
      colorField("color", "Colour", t0.color) +
      ui.textarea("description", "Description", t0.description, 2) +
      ui.check("active", "Active", t0.active !== false) +
      '<div class="field"><label>Members</label><div class="radio-group">' +
        (members.length ? members.map((m) => '<label><input type="checkbox" data-member value="' + ui.esc(m.id) + '"' + ((m.teams || []).map(String).indexOf(String(t0.id)) >= 0 ? " checked" : "") + "> " + ui.esc(m.name) + "</label>").join("") : '<span class="erp-sub">No members yet.</span>') +
      "</div><div class=\"hint\">Team membership is stored on each member; changing it here updates them.</div></div>";
    const modal = ui.modal({
      title: team ? "Edit team" : "New team",
      body: ui.form(fields),
      foot: ui.btn("Cancel", { small: true, act: "t-cancel" }) + " " + ui.btn(team ? "Save team" : "Create team", { small: true, primary: true, act: "t-save" }),
    });
    const form = modal.querySelector("[data-ui-form]");
    modal.querySelector("[data-act=t-cancel]").onclick = () => ui.closeModal();
    modal.querySelector("[data-act=t-save]").onclick = async (t) => {
      const v = ui.collect(form, ["name", "color", "description", "active"]);
      if (!v.name) { ERP.toast("A team name is required.", "error"); return; }
      t.disabled = true;
      const res = await ERP.members.save("team", Object.assign({}, t0, v));
      if (res.error) { ui.closeModal(); ERP.toast("Could not save: " + (res.message || res.error), "error"); return; }
      const teamId = res.record && res.record.id != null ? res.record.id : t0.id;
      const chosen = Array.from(form.querySelectorAll("[data-member]:checked")).map((i) => String(i.value));
      /* reconcile membership both ways */
      const all = await ERP.members.members();
      for (const m of all) {
        const has = (m.teams || []).map(String).indexOf(String(teamId)) >= 0;
        const want = chosen.indexOf(String(m.id)) >= 0;
        if (has !== want) {
          const teams = want ? (m.teams || []).concat([teamId]) : (m.teams || []).filter((x) => String(x) !== String(teamId));
          await ERP.members.save("member", Object.assign({}, m, { teams: teams }));
        }
      }
      ui.closeModal();
      ERP.toast(team ? "Team updated." : "Team created.", "success");
      refresh();
    };
  }

  async function openCalendarModal(cal, refresh) {
    const ui = ERP.ui;
    if (!ERP.security.enforce("calendars.edit")) return;
    const c = cal || ERP.members.newCalendar();
    const hours = c.hours || {};
    const dayFields = DAYS.map((d) => {
      const r = (hours[d] && hours[d][0]) || { from: "", to: "" };
      return '<div class="erp-form-row"><label class="erp-check" style="min-width:64px">' + d.toUpperCase() + '</label>' +
        '<input type="time" name="' + d + '-from" value="' + ui.esc(r.from || "") + '"><input type="time" name="' + d + '-to" value="' + ui.esc(r.to || "") + '"></div>';
    }).join("");
    const fields =
      ui.text("name", "Calendar name", c.name) +
      '<div class="erp-form-row">' +
        ui.text("timezone", "Timezone", c.timezone || "UTC") +
        '<div class="field"><label>Default calendar</label>' + ui.check("isDefault", "Use as default", c.isDefault) + "</div>" +
      "</div>" +
      '<div class="field"><label>Working hours</label><div class="erp-cal-days">' + dayFields + "</div></div>" +
      ui.textarea("holidays", "Holidays (one per line: YYYY-MM-DD, Label)", (c.holidays || []).map((h) => h.date + (h.label ? ", " + h.label : "")).join("\n"), 3);
    const modal = ui.modal({
      title: cal ? "Edit calendar" : "New calendar",
      body: ui.form(fields),
      foot: ui.btn("Cancel", { small: true, act: "cal-cancel" }) + " " + ui.btn(cal ? "Save calendar" : "Create calendar", { small: true, primary: true, act: "cal-save" }),
    });
    const form = modal.querySelector("[data-ui-form]");
    modal.querySelector("[data-act=cal-cancel]").onclick = () => ui.closeModal();
    modal.querySelector("[data-act=cal-save]").onclick = async (t) => {
      const v = ui.collect(form, ["name", "timezone", "isDefault"]);
      if (!v.name) { ERP.toast("A calendar name is required.", "error"); return; }
      const h = {};
      DAYS.forEach((d) => {
        const from = form.querySelector('[name="' + d + '-from"]').value;
        const to = form.querySelector('[name="' + d + '-to"]').value;
        h[d] = from && to ? [{ from: from, to: to }] : [];
      });
      const holidays = String(ui.collect(form, ["holidays"]).holidays || "").split("\n").map((line) => {
        const parts = line.split(",");
        const date = (parts.shift() || "").trim();
        return date ? { date: date, label: parts.join(",").trim() } : null;
      }).filter(Boolean);
      t.disabled = true;
      const res = await ERP.members.save("calendar", Object.assign({}, c, v, { hours: h, holidays: holidays }));
      if (!res.error && v.isDefault) {
        const others = (await ERP.members.calendars()).filter((x) => String(x.id) !== String(res.record.id) && x.isDefault);
        for (const o of others) await ERP.members.save("calendar", Object.assign({}, o, { isDefault: false }));
      }
      ui.closeModal();
      ERP.toast(res.error ? "Could not save calendar." : (cal ? "Calendar updated." : "Calendar created."), res.error ? "error" : "success");
      refresh();
    };
  }

  async function renderMembers(panel, refresh) {
    const ui = ERP.ui;
    const [members, teams, calendars] = await Promise.all([ERP.members.members(), ERP.members.teams(), ERP.members.calendars()]);
    const canMember = ERP.security.can("members.edit");
    const mRows = members.map((m) => ({
      name: "<b>" + ui.esc(m.name) + "</b>" + (m.title ? '<div class="erp-sub">' + ui.esc(m.title) + "</div>" : ""),
      role: ui.esc((ERP.security.functionalRole(m.functionalRole) || {}).label || m.functionalRole || "—"),
      system: ui.badge(m.systemRole || "staff", m.systemRole === "owner" ? "danger" : m.systemRole === "manager" ? "warn" : "muted"),
      teams: ui.esc((teams.filter((t) => (m.teams || []).map(String).indexOf(String(t.id)) >= 0).map((t) => t.name)).join(", ") || "—"),
      cal: ui.esc((calendars.find((c) => String(c.id) === String(m.calendarId)) || {}).name || "—"),
      active: m.active === false ? ui.badge("inactive", "muted") : ui.badge("active", "success"),
      actions: (canMember ? ui.btn("Edit", { small: true, act: "mem-edit", arg: m.id }) : "") + (canMember ? " " + ui.btn("Delete", { small: true, danger: true, act: "mem-del", arg: m.id }) : ""),
    }));
    const tRows = teams.map((t) => ({
      name: '<span class="erp-dot" style="background:' + ui.esc(t.color || "#0a58ca") + '"></span> <b>' + ui.esc(t.name) + "</b>" + (t.description ? '<div class="erp-sub">' + ui.esc(t.description) + "</div>" : ""),
      n: ui.fmt(members.filter((m) => (m.teams || []).map(String).indexOf(String(t.id)) >= 0).length, 0),
      actions: (ERP.security.can("teams.edit") ? ui.btn("Edit", { small: true, act: "team-edit", arg: t.id }) + " " + ui.btn("Delete", { small: true, danger: true, act: "team-del", arg: t.id }) : ""),
    }));
    const cRows = calendars.map((c) => ({
      name: "<b>" + ui.esc(c.name) + "</b>" + (c.isDefault ? " " + ui.badge("default", "info") : ""),
      tz: ui.esc(c.timezone || "—"),
      hours: ui.esc(DAYS.filter((d) => (c.hours && c.hours[d] && c.hours[d].length)).map((d) => d.toUpperCase()).join(" ") || "—"),
      hol: ui.fmt((c.holidays || []).length, 0),
      actions: (ERP.security.can("calendars.edit") ? ui.btn("Edit", { small: true, act: "cal-edit", arg: c.id }) + " " + ui.btn("Delete", { small: true, danger: true, act: "cal-del", arg: c.id }) : ""),
    }));

    panel.innerHTML =
      ui.card("Members", ui.table([
        { key: "name", label: "Member" },
        { key: "role", label: "Function" },
        { key: "system", label: "System role" },
        { key: "teams", label: "Teams" },
        { key: "cal", label: "Calendar" },
        { key: "active", label: "Status" },
        { key: "actions", label: "", align: "right" },
      ], mRows), { actions: canMember ? ui.btn("Add member", { small: true, primary: true, act: "mem-new" }) : "" }) +
      ui.card("Teams", ui.table([
        { key: "name", label: "Team" },
        { key: "n", label: "Members", align: "right" },
        { key: "actions", label: "", align: "right" },
      ], tRows), { actions: ERP.security.can("teams.edit") ? ui.btn("Add team", { small: true, primary: true, act: "team-new" }) : "" }) +
      ui.card("Business-hours calendars", ui.table([
        { key: "name", label: "Calendar" },
        { key: "tz", label: "Timezone" },
        { key: "hours", label: "Open days" },
        { key: "hol", label: "Holidays", align: "right" },
        { key: "actions", label: "", align: "right" },
      ], cRows), { actions: ERP.security.can("calendars.edit") ? ui.btn("Add calendar", { small: true, primary: true, act: "cal-new" }) : "" });

    ui.bind(panel, "click", "[data-act]", async (el, e, act, arg) => {
      if (act === "mem-new") return openMemberModal(null, refresh);
      if (act === "mem-edit") return openMemberModal(await ERP.members.member(arg), refresh);
      if (act === "mem-del") {
        if (await ui.confirm({ title: "Delete member?", message: "This member record will be removed.", danger: true, okLabel: "Delete" })) {
          await ERP.members.remove("member", arg); ERP.toast("Member deleted.", "success"); refresh();
        }
        return;
      }
      if (act === "team-new") return openTeamModal(null, refresh);
      if (act === "team-edit") return openTeamModal(await ERP.members.team(arg), refresh);
      if (act === "team-del") {
        if (await ui.confirm({ title: "Delete team?", message: "The team is removed; members keep their records.", danger: true, okLabel: "Delete" })) {
          await ERP.members.remove("team", arg); ERP.toast("Team deleted.", "success"); refresh();
        }
        return;
      }
      if (act === "cal-new") return openCalendarModal(null, refresh);
      if (act === "cal-edit") return openCalendarModal(await ERP.members.calendar(arg), refresh);
      if (act === "cal-del") {
        if (await ui.confirm({ title: "Delete calendar?", message: "Members using it will fall back to the default.", danger: true, okLabel: "Delete" })) {
          await ERP.members.remove("calendar", arg); ERP.toast("Calendar deleted.", "success"); refresh();
        }
      }
    });
  }

  /* ─────────────────────────── configuration (taxonomy) ─────────────────────────── */

  async function openTaxModal(category, rec, refresh) {
    const ui = ERP.ui;
    if (!ERP.security.enforce("taxonomy.edit")) return;
    const defs = ERP.taxonomy.fieldsFor(category);
    const r = rec || { category: category, active: true, order: 999 };
    const fields =
      ui.text("code", "Code", r.code, "unique-within-category") +
      ui.text("label", "Label", r.label) +
      ui.number("order", "Sort order", r.order) +
      defs.map((f) => {
        if (f.type === "bool") return ui.check(f.id, f.label, r[f.id]);
        if (f.type === "color") return colorField(f.id, f.label, r[f.id]);
        if (f.type === "number") return ui.number(f.id, f.label, r[f.id]);
        return ui.text(f.id, f.label, r[f.id]);
      }).join("") +
      ui.check("active", "Active", r.active !== false);
    const names = ["code", "label", "order", "active"].concat(defs.map((f) => f.id));
    const modal = ui.modal({
      title: (rec ? "Edit " : "New ") + ERP.taxonomy.categoryLabel(category).toLowerCase().replace(/s$/, ""),
      body: ui.form(fields),
      foot: ui.btn("Cancel", { small: true, act: "tx-cancel" }) + " " + ui.btn("Save", { small: true, primary: true, act: "tx-save" }),
    });
    const form = modal.querySelector("[data-ui-form]");
    modal.querySelector("[data-act=tx-cancel]").onclick = () => ui.closeModal();
    modal.querySelector("[data-act=tx-save]").onclick = async (t) => {
      const v = ui.collect(form, names);
      if (!v.label) { ERP.toast("A label is required.", "error"); return; }
      t.disabled = true;
      const p = await ten().provider();
      const res = await ERP.taxonomy.upsert(p.id, Object.assign({}, r, v, { category: category }));
      ui.closeModal();
      if (res.error) { ERP.toast("Could not save: " + (res.message || res.error), "error"); return; }
      await ERP.taxonomy.recordChange("Configuration updated — " + ERP.taxonomy.categoryLabel(category) + ": " + v.label + ".");
      ERP.toast("Configuration saved.", "success");
      refresh();
    };
  }

  async function renderConfig(panel, refresh, activeCat) {
    const ui = ERP.ui;
    const p = await ten().provider();
    const cat = activeCat || panel.__cat || ERP.taxonomy.CATEGORIES[0].id;
    panel.__cat = cat;
    const cats = ERP.taxonomy.CATEGORIES;
    const list = await ERP.taxonomy.list(p.id, cat);
    const defs = ERP.taxonomy.fieldsFor(cat);
    const canEdit = ERP.security.can("taxonomy.edit");
    const history = (await ERP.history.entries(ten().providerDocName(p.id))).slice(0, 12);

    const side =
      '<div class="erp-cat-list">' +
      cats.map((c) => '<button class="erp-cat-btn' + (c.id === cat ? " active" : "") + '" data-cat="' + ui.esc(c.id) + '">' + ui.esc(c.label) + "</button>").join("") +
      "</div>";

    const cols = [{ key: "label", label: "Label" }, { key: "code", label: "Code" }];
    defs.forEach((f) => cols.push({ key: f.id, label: f.label, render: (r) => f.type === "color" && r[f.id] ? '<span class="erp-dot" style="background:' + ui.esc(r[f.id]) + '"></span> ' + ui.esc(r[f.id]) : ui.esc(r[f.id] == null ? "—" : f.type === "bool" ? (r[f.id] ? "yes" : "no") : r[f.id]) }));
    cols.push({ key: "active", label: "Active", render: (r) => (r.active === false ? ui.badge("no", "muted") : ui.badge("yes", "success")) });
    if (canEdit) cols.push({ key: "actions", label: "", align: "right", render: (r) => ui.btn("Edit", { small: true, act: "tx-edit", arg: r.id }) + " " + ui.btn("Delete", { small: true, danger: true, act: "tx-del", arg: r.id }) });

    const histRows = history.map((h) => ({
      when: ui.dateTime(h.ts),
      by: ui.esc(h.by || "—"),
      count: ui.fmt(h.count, 0),
      note: ui.esc(h.note || "—"),
      actions: h.tooLarge ? ui.badge("too large", "muted") : ui.btn("Restore", { small: true, act: "tx-restore", arg: h.id }),
    }));

    const c = cats.find((x) => x.id === cat);
    panel.innerHTML =
      '<div class="erp-split">' +
        side +
        '<div class="erp-split-main">' +
          ui.card(c.label, (c.hint ? '<p class="erp-sub">' + ui.esc(c.hint) + "</p>" : "") + ui.table(cols, list), { actions: canEdit ? ui.btn("Add", { small: true, primary: true, act: "tx-new" }) : "" }) +
          ui.card("Change history", ui.table([
            { key: "when", label: "When" },
            { key: "by", label: "By" },
            { key: "count", label: "Records", align: "right" },
            { key: "note", label: "Note" },
            { key: "actions", label: "", align: "right" },
          ], histRows, { emptyText: "No changes recorded yet." }), { actions: ui.btn("All versions", { small: true, act: "tx-allversions" }) }) +
        "</div>" +
      "</div>";

    ui.bind(panel, "click", "[data-cat]", (el) => { panel.__cat = el.getAttribute("data-cat"); renderConfig(panel, refresh, panel.__cat); });
    ui.bind(panel, "click", "[data-act]", async (el, e, act, arg) => {
      if (act === "tx-new") return openTaxModal(cat, null, refresh);
      if (act === "tx-edit") return openTaxModal(cat, list.find((r) => String(r.id) === String(arg)), refresh);
      if (act === "tx-del") {
        if (await ui.confirm({ title: "Delete configuration item?", message: "Records already using this value keep their stored code.", danger: true, okLabel: "Delete" })) {
          await ERP.taxonomy.remove(p.id, arg);
          await ERP.taxonomy.recordChange("Configuration item deleted from " + c.label + ".");
          ERP.toast("Configuration item deleted.", "success");
          refresh();
        }
        return;
      }
      if (act === "tx-restore") return openRestoreModal(ten().providerDocName(p.id), arg, refresh);
      if (act === "tx-allversions") return openVersionsModal(ten().providerDocName(p.id), refresh);
    });
  }

  /* ─────────────────────────── security ─────────────────────────── */

  async function renderSecurity(panel, refresh) {
    const ui = ERP.ui;
    const members = await ERP.members.members();
    const actorId = ERP.security.actorMemberId();
    const perms = Object.keys(ERP.security.PERMS);
    const roleCols = ERP.ROLES;
    const matrix = perms.map((perm) => {
      const allowed = ERP.security.PERMS[perm];
      return {
        perm: "<code>" + ui.esc(perm) + "</code><div class=\"erp-sub\">" + ui.esc(ERP.security.PERM_LABELS[perm] || perm) + "</div>",
        owner: allowed.length === 0 || allowed.indexOf("owner") >= 0 ? ui.badge("yes", "success") : ui.badge("—", "muted"),
        manager: allowed.length === 0 || allowed.indexOf("manager") >= 0 ? ui.badge("yes", "success") : ui.badge("—", "muted"),
        staff: allowed.length === 0 || allowed.indexOf("staff") >= 0 ? ui.badge("yes", "success") : ui.badge("—", "muted"),
      };
    });
    const frRows = ERP.security.FUNCTIONAL_ROLES.map((r) => ({
      role: "<b>" + ui.esc(r.label) + "</b>",
      desc: ui.esc(r.desc),
      members: ui.esc(members.filter((m) => m.functionalRole === r.id).map((m) => m.name).join(", ") || "—"),
    }));
    const actorOpts = [{ value: "", label: "— System role only (" + (ERP.ROLE_LABELS[ERP.role] || ERP.role) + ") —" }].concat(members.map((m) => ({ value: m.id, label: m.name + " · " + (ERP.security.functionalRole(m.functionalRole) || {}).label })));

    panel.innerHTML =
      ui.alert("Every permission below is enforced in code — the UI hides what you cannot use, but the controllers also refuse it. When the realtime hub is online the server's role wins over the local selector.", "info") +
      ui.card("Acting as", ui.field("Member identity", '<select id="actorSelect" name="actor">' +
        actorOpts.map((o) => '<option value="' + ui.esc(o.value) + '"' + (String(o.value) === String(actorId || "") ? " selected" : "") + ">" + ui.esc(o.label) + "</option>").join("") + "</select>",
        "Pick a member to apply their functional role and record scopes, or leave as the system role.")) +
      ui.card("System role permission matrix", ui.table([
        { key: "perm", label: "Permission" },
        { key: "owner", label: "Owner" },
        { key: "manager", label: "Manager" },
        { key: "staff", label: "Staff" },
      ], matrix)) +
      ui.card("Functional roles", ui.table([
        { key: "role", label: "Role" },
        { key: "desc", label: "Purpose" },
        { key: "members", label: "Members" },
      ], frRows)) +
      ui.card("Record scopes", '<p class="erp-sub">A member\'s scopes live on their record: <b>Company scope</b> restricts which clients they can see or change, and <b>financial visibility</b> hides money figures from technicians. Edit these under Admin → Members.</p>' +
        ui.table([
          { key: "name", label: "Member" },
          { key: "role", label: "Function" },
          { key: "scope", label: "Clients" },
          { key: "fin", label: "Financials" },
        ], members.map((m) => {
          const s = ERP.security.scopeSummary(m);
          return { name: ui.esc(m.name), role: ui.esc((ERP.security.functionalRole(m.functionalRole) || {}).label), scope: ui.esc(s.companies), fin: s.financials ? ui.badge("visible", "success") : ui.badge("hidden", "muted") };
        }), { emptyText: "No members yet." }));

    const sel = panel.querySelector("#actorSelect");
    if (sel) sel.addEventListener("change", () => {
      ERP.security.setActorMember(sel.value || null);
      ERP.toast(sel.value ? "Now acting as that member." : "Acting as the system role.", "success");
      refresh();
    });
  }

  /* ─────────────────────────── data, sync, versions ─────────────────────────── */

  async function openVersionsModal(docName, refresh) {
    const ui = ERP.ui;
    const entries = await ERP.history.entries(docName);
    const rows = entries.map((h) => ({
      when: ui.dateTime(h.ts),
      rev: ui.esc(h.rev),
      by: ui.esc(h.by || "—"),
      count: ui.fmt(h.count, 0),
      note: ui.esc(h.note || "—"),
      actions: h.tooLarge ? ui.badge("too large", "muted") : ui.btn("Restore", { small: true, act: "v-restore", arg: h.id }),
    }));
    ui.modal({
      title: "Version history · " + ERP.store.humanDocName(docName),
      size: "lg",
      body: ui.table([
        { key: "when", label: "When" },
        { key: "rev", label: "Rev" },
        { key: "by", label: "By" },
        { key: "count", label: "Records", align: "right" },
        { key: "note", label: "Note" },
        { key: "actions", label: "", align: "right" },
      ], rows, { emptyText: "No versions recorded yet." }),
      foot: ui.btn("Close", { small: true, act: "v-close" }),
    });
    const modal = document.getElementById("uiModal");
    modal.querySelector("[data-act=v-close]").onclick = () => ui.closeModal();
    modal.querySelectorAll("[data-act=v-restore]").forEach((b) => {
      b.onclick = () => { ui.closeModal(); openRestoreModal(docName, b.getAttribute("data-arg"), refresh); };
    });
  }

  async function openRestoreModal(docName, versionId, refresh) {
    const ui = ERP.ui;
    const entries = await ERP.history.entries(docName);
    const v = entries.find((h) => String(h.id) === String(versionId));
    if (!v) { ERP.toast("Version not found.", "error"); return; }
    if (await ui.confirm({
      title: "Restore this version?",
      message: "Restoring " + ERP.store.humanDocName(docName) + " to revision " + v.rev + " (" + ui.dateTime(v.ts) + "). The current state is snapshotted first, so this is itself undoable.",
      okLabel: "Restore version",
    })) {
      const res = await ERP.history.restore(docName, versionId);
      if (res.error) { ERP.toast("Restore failed: " + (res.message || res.error), "error"); return; }
      ERP.toast("Restored " + ERP.store.humanDocName(docName) + ".", "success");
      if (ERP.tenancy) { ERP.tenancy.invalidateRoot(); ERP.tenancy.notify(); }
      if (ERP.security) ERP.security.refresh(true);
      if (refresh) refresh();
    }
  }

  async function renderData(panel, refresh) {
    const ui = ERP.ui;
    const st = await ERP.store.status().catch(() => null);
    const conflicts = ERP.store.conflicts();
    const tenantDocs = await ten().tenantDocs().catch(() => []);
    const vDocs = await ERP.history.documents().catch(() => []);
    const published = ERP.backup ? await ERP.backup.publishedBackup().catch(() => null) : null;
    const canManage = ERP.security.can("data.manage");

    const tenantRows = tenantDocs.map((d) => ({
      doc: "<b>" + ui.esc(d.label || d.name) + "</b><div class=\"erp-sub\">" + ui.esc(d.name) + "</div>",
      records: ui.fmt(d.records, 0),
      rev: ui.esc(d.rev),
      bytes: ERP.store.fmtBytes(d.bytes || 0),
    }));
    const vRows = vDocs.map((d) => ({
      doc: ui.esc(ERP.store.humanDocName(d.doc)),
      versions: ui.fmt(d.versions, 0),
      last: d.last ? ui.dateTime(d.last.ts) + " · rev " + d.last.rev : "—",
      actions: ui.btn("History", { small: true, act: "data-history", arg: d.doc }),
    }));

    panel.innerHTML =
      ui.alert(
        conflicts.length
          ? conflicts.length + " document(s) changed on another device since your last sync — nothing was overwritten. Open the sync centre to resolve."
          : "All documents are in sync on this device.",
        conflicts.length ? "warn" : "success"
      ) +
      ui.card("Sync & conflicts", '<p class="erp-sub">Reconcile every document against its canonical copy. A two-device edit is offered as keep-mine / keep-theirs / field-level merge before anything is overwritten.</p>' +
        '<div class="erp-btn-row">' +
          ui.btn("Open sync centre", { primary: true, act: "data-sync" }) +
          ui.btn("Sync now", { act: "data-syncnow" }) +
        "</div>") +
      ui.card("Backup & restore", (published
        ? ui.alert("Published backup: " + ui.dateTime(published.exportedAt) + " · " + Object.keys(published.docs || {}).length + " documents.", "success")
        : ui.alert("No published backup yet. Publish one so another device can restore from this generator's own namespace.", "info")) +
        '<div data-backup-host></div>') +
      ui.card("Version history", '<p class="erp-sub">Every committed change is snapshotted. Restore any revision; the current state is snapshotted first so a restore is itself undoable. Snapshots are pruned (newest per document, bounded total).</p>' +
        ui.table([
          { key: "doc", label: "Document" },
          { key: "versions", label: "Versions", align: "right" },
          { key: "last", label: "Latest" },
          { key: "actions", label: "", align: "right" },
        ], vRows, { emptyText: "No versions recorded yet." })) +
      ui.card("Tenant documents", '<p class="erp-sub">One versioned document per service provider and per client company, plus the provider registry.</p>' +
        ui.table([
          { key: "doc", label: "Document" },
          { key: "records", label: "Records", align: "right" },
          { key: "rev", label: "Rev", align: "right" },
          { key: "bytes", label: "Size", align: "right" },
        ], tenantRows, { emptyText: "No tenant documents yet." })) +
      ui.card("Storage", st
        ? ui.summary([
            { label: "Total stored", value: ERP.store.fmtBytes(st.totalBytes || 0) },
            { label: "Ceiling / document", value: ERP.store.fmtBytes(st.maxDocBytes) },
            { label: "Canonical store", value: st.canonical ? "connected" : "local only" },
            { label: "Schema version", value: String(st.schemaVersion) },
          ])
        : '<p class="erp-alert">Storage status unavailable.</p>');

    if (ERP.backup && ERP.backup.renderPanel) {
      const host = panel.querySelector("[data-backup-host]");
      if (host) ERP.backup.renderPanel(host).catch((e) => { host.innerHTML = ui.alert("Backup panel unavailable: " + (e && e.message || e), "danger"); });
    }

    ui.bind(panel, "click", "[data-act]", async (el, e, act, arg) => {
      if (act === "data-sync") return ERP.syncCenter.open();
      if (act === "data-syncnow") { await ERP.syncCenter.runSync(false); refresh(); return; }
      if (act === "data-history") return openVersionsModal(arg, refresh);
    });
  }

  /* ─────────────────────────── controller ─────────────────────────── */

  A.render = async function (ctx) {
    const ui = ERP.ui;
    const host = ctx.el;
    const defs = [
      { id: "overview", label: "Overview" },
      { id: "members", label: "Members, teams & hours" },
      { id: "configuration", label: "Configuration" },
      { id: "security", label: "Security" },
      { id: "collaboration", label: "Collaboration" },
      { id: "data", label: "Data & sync" },
      { id: "integrations", label: "Integrations" },
      { id: "api", label: "API & webhooks" },
      { id: "integrity", label: "Data integrity" },
    ];
    const active = defs.find((d) => d.id === host.__tab) ? host.__tab : "overview";

    const renderTab = async (id) => {
      const old = host.querySelector('[data-panel="' + id + '"]');
      if (!old) return;
      /* Swap in a fresh panel node so delegated listeners from a previous
         render do not accumulate across tab switches. */
      const panel = document.createElement("div");
      panel.className = old.className;
      panel.setAttribute("data-panel", id);
      old.replaceWith(panel);
      ERP.states.loading(panel, "Loading " + (defs.find((d) => d.id === id) || {}).label);
      try {
        if (id === "overview") await renderOverview(panel, () => renderTab(id));
        else if (id === "members") await renderMembers(panel, () => renderTab(id));
        else if (id === "configuration") await renderConfig(panel, () => renderTab(id));
        else if (id === "security") await renderSecurity(panel, () => renderTab(id));
        else if (id === "collaboration") await ERP.collab.renderPanel(panel, () => renderTab(id));
        else if (id === "data") await renderData(panel, () => renderTab(id));
        else if (id === "integrations") ERP.integrations.renderPanel(panel, () => renderTab(id));
        else if (id === "api") ERP.api.renderPanel(panel, () => renderTab(id));
        else if (id === "integrity") ERP.integrity.renderPanel(panel, () => renderTab(id));
      } catch (e) {
        console.error("admin tab failed", id, e);
        ERP.states.error(panel, { title: "This tab hit a problem", message: (e && e.message) || "Unexpected error." });
      }
    };

    host.innerHTML = ui.pageHead("Admin", "System configuration, people, security and data tools.", "") + ui.tabs(defs, active).html;
    host.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", async () => {
      ui.showTab(host, b.getAttribute("data-tab"));
      host.__tab = b.getAttribute("data-tab");
      await renderTab(host.__tab);
    }));
    await renderTab(active);
  };

  /* ─────────────────────────── boot: repurpose health button ─────────────────────────── */

  function healthDot() {
    const dot = document.getElementById("healthDot");
    if (!dot) return;
    const conflicts = ERP.store.conflicts().length;
    dot.className = "erp-health-dot " + (conflicts ? "amber" : "green");
    const btn = document.getElementById("healthBtn");
    if (btn) btn.title = conflicts ? "Data & sync — " + conflicts + " conflict(s) to review" : "Data & sync — all documents in sync";
  }

  function boot() {
    const btn = document.getElementById("healthBtn");
    if (btn && !btn.__psaWired) {
      btn.__psaWired = true;
      btn.addEventListener("click", () => { location.hash = "#/admin:data"; });
    }
    healthDot();
    if (ERP.store.setSyncListener) ERP.store.setSyncListener(() => { healthDot(); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  A.openVersionsModal = openVersionsModal;
  A.openRestoreModal = openRestoreModal;
})();
