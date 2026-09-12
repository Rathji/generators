/* ============================================================
   PSA-U — members, teams & business-hours calendars
   (Phase 1 · Task 4)
   The people side of the provider: each member (technician or
   staff) carries a functional role, team memberships, skills, an
   assigned business-hours calendar, cost/charge rates and the
   record-level scopes the security service enforces. Teams group
   members for routing and dispatch; calendars define the working
   hours and holidays that SLA and scheduling math later depend on.

   Everything lives in the active provider's document as records of
   kind "member" / "team" / "calendar", so it syncs, backs up and
   is versioned with the rest of the tenant data.
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  const M = (ERP.members = {});

  M.KINDS = ["member", "team", "calendar"];

  function ten() {
    if (!ERP.tenancy) throw new Error("members requires the tenancy service");
    return ERP.tenancy;
  }

  /* ─────────────────────────── generic access ─────────────────────────── */

  /* All provider-level records (any kind) — used by diagnostics/exports. */
  M.all = async function () {
    const p = await ten().provider();
    if (!p) return [];
    return ten().records("provider", p.id);
  };

  /* Records of one kind. Defaults to members so a bare `list()` is never a
     footgun that returns taxonomy/teams/calendars too. */
  M.list = async function (kind) {
    kind = kind || "member";
    const p = await ten().provider();
    if (!p) return [];
    const list = await ten().records("provider", p.id, kind);
    return list.slice().sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  };

  M.get = async function (kind, id) {
    return (await M.list(kind)).find((r) => String(r.id) === String(id)) || null;
  };

  M.save = async function (kind, rec) {
    const p = await ten().provider();
    if (!p) return { error: "no_provider" };
    const incoming = Object.assign({ kind: kind }, rec);
    if (!isFinite(incoming.id)) {
      const cur = await ten().records("provider", p.id, kind);
      incoming.id = ten().nextId(cur);
    }
    const res = await ten().upsert("provider", p.id, incoming);
    if (!res.error && kind === "member" && ERP.security && ERP.security.invalidateMembers) ERP.security.invalidateMembers();
    return res;
  };

  M.remove = async function (kind, id) {
    const p = await ten().provider();
    if (!p) return { error: "no_provider" };
    const res = await ten().remove("provider", p.id, (r) => r.kind === kind && String(r.id) === String(id));
    if (!res.error && kind === "member" && ERP.security && ERP.security.invalidateMembers) ERP.security.invalidateMembers();
    return res;
  };

  M.members = () => M.list("member");
  M.teams = () => M.list("team");
  M.calendars = () => M.list("calendar");

  M.member = (id) => M.get("member", id);
  M.team = (id) => M.get("team", id);
  M.calendar = (id) => M.get("calendar", id);

  M.memberName = async function (id) {
    const m = await M.member(id);
    return m ? m.name : (id == null || id === "" ? "—" : String(id));
  };
  M.teamName = async function (id) {
    const t = await M.team(id);
    return t ? t.name : (id == null || id === "" ? "—" : String(id));
  };
  M.calendarName = async function (id) {
    const c = await M.calendar(id);
    return c ? c.name : (id == null || id === "" ? "—" : String(id));
  };

  /* Members of a team (member.teams holds team ids). */
  M.teamMembers = async function (teamId) {
    const members = await M.members();
    return members.filter((m) => Array.isArray(m.teams) && m.teams.map(String).indexOf(String(teamId)) !== -1);
  };

  M.memberTeams = async function (member) {
    const teams = await M.teams();
    const ids = (member && member.teams) || [];
    return teams.filter((t) => ids.map(String).indexOf(String(t.id)) !== -1);
  };

  M.defaultCalendar = async function () {
    const list = await M.calendars();
    return list.find((c) => c.isDefault) || list[0] || null;
  };

  M.summary = async function () {
    const [members, teams, calendars] = await Promise.all([M.members(), M.teams(), M.calendars()]);
    return {
      members: members.length,
      activeMembers: members.filter((m) => m.active !== false).length,
      teams: teams.length,
      calendars: calendars.length,
    };
  };

  /* ─────────────────────────── defaults & seeding ─────────────────────────── */

  const DEFAULT_CALENDAR = {
    name: "Standard business hours",
    timezone: "UTC",
    isDefault: true,
    hours: {
      mon: [{ from: "08:00", to: "17:00" }],
      tue: [{ from: "08:00", to: "17:00" }],
      wed: [{ from: "08:00", to: "17:00" }],
      thu: [{ from: "08:00", to: "17:00" }],
      fri: [{ from: "08:00", to: "17:00" }],
      sat: [],
      sun: [],
    },
    holidays: [],
  };

  M.newCalendar = () => JSON.parse(JSON.stringify(DEFAULT_CALENDAR));

  M.newMember = function (over) {
    return Object.assign({
      kind: "member",
      name: "",
      email: "",
      phone: "",
      title: "",
      functionalRole: "technician",
      systemRole: "staff",
      teams: [],
      skills: [],
      territory: "",
      workHours: null,
      dispatchable: true,
      calendarId: null,
      hourlyCost: 0,
      hourlyRate: 0,
      active: true,
      scopes: { companies: [], financials: false },
    }, over || {});
  };

  M.newTeam = (over) => Object.assign({ kind: "team", name: "", description: "", color: "#0a58ca", active: true }, over || {});

  /* Idempotent: creates a default business-hours calendar and a starter team
     only when the provider has none. */
  M.seed = async function () {
    const p = await ten().provider();
    if (!p) return { skipped: "no_provider" };
    const created = {};
    if (!(await M.calendars()).length) {
      await M.save("calendar", M.newCalendar());
      created.calendar = true;
    }
    if (!(await M.teams()).length) {
      await M.save("team", M.newTeam({ name: "Service desk", description: "Front-line service delivery team." }));
      created.team = true;
    }
    /* Members with no calendar fall back to the default. */
    const def = await M.defaultCalendar();
    if (def) {
      const members = await M.members();
      for (const m of members) {
        if (!m.calendarId) await M.save("member", Object.assign({}, m, { calendarId: def.id }));
      }
    }
    return created;
  };
})();
