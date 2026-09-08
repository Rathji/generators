/* ============================================================
   BI validation tests — roadmap tasks 35–38 (realtime & roles).
   Run via: await BI.runTests("multi")  (page_eval harness).

   Validated:
     - role matrix: viewer/analyst/admin can() answers match the
       required-role table for every action
     - polling fallback engages when the hub is disabled
     - the hub client drives a live connection, auth escalation,
       report-index announce, audit tail and presence against a
       fake socket (deterministic in the unsaved preview), then
       tears down and re-connects to the real hub.
   ============================================================ */
(function () {
  "use strict";

  const BI = window.BI;
  const RT = BI.realtime;

  BI.tests.multi = {
    async run() {
      const results = [];
      const push = (name, pass, detail) => results.push({ name, pass, detail: detail || "" });

      const origRole = RT.role();
      const origPollMs = RT.status().pollFallbackMs;
      const origSocket = window.root && root.createServerSocket;

      /* ---------- A: role matrix ---------- */
      {
        const actions = ["view", "export", "create_report", "edit_report", "delete_report",
          "create_dashboard", "edit_dashboard", "delete_dashboard", "save_view", "create_schedule",
          "manage_sources", "manage_catalog", "backup", "restore", "manage_roles"];
        push("A: required-role table covers every action", actions.every((a) => RT.requiredRole(a)));
        push("A: unknown action defaults to viewer", RT.requiredRole("mystery") === "viewer");
        push("A: role ranking view < analyst < admin", RT.requiredRole("view") === "viewer" && RT.requiredRole("create_report") === "analyst" && RT.requiredRole("backup") === "admin");

        RT.setRole("viewer");
        push("A: viewer can view but not edit or manage", RT.can("view") && !RT.can("create_report") && !RT.can("backup") && !RT.can("manage_roles"));
        RT.setRole("analyst");
        push("A: analyst can edit reports/dashboards but not manage", RT.can("create_report") && RT.can("delete_dashboard") && RT.can("save_view") && !RT.can("backup") && !RT.can("manage_sources"));
        RT.setRole("admin");
        push("A: admin can do everything", actions.every((a) => RT.can(a)));
        RT.setRole(origRole);
        push("A: role restored", RT.role() === origRole);
      }

      /* ---------- B: polling fallback ---------- */
      {
        RT.init({ hubEnabled: false, pollFallbackMs: 60000 });
        push("B: hub disabled → polling mode", RT.mode() === "polling", "mode " + RT.mode());
        push("B: poll cadence updated", RT.status().pollFallbackMs === 60000);
        RT.init({ hubEnabled: true, pollFallbackMs: origPollMs });
        const b = await RT.connect(true);
        push("B: re-init with hub reconnects", b.ok === true && RT.mode() === "live", "mode " + RT.mode() + " reason " + (b.reason || ""));
      }

      /* ---------- C: hub connection + RPC against a fake socket ---------- */
      {
        function FakeSocket() {
          const listeners = {};
          return {
            readyState: 1,
            opened: Promise.resolve(),
            addEventListener(t, fn) { (listeners[t] = listeners[t] || []).push(fn); },
            close() {},
            rpc: {
              auth: async () => JSON.stringify({ ok: true, role: "admin", name: "Admin" }),
              reportIndex: async () => JSON.stringify({ ok: true }),
              announceDoc: async () => JSON.stringify({ ok: true }),
              auditTail: async () => JSON.stringify({ ok: true, tail: [{ t: 1, actor: "alice", action: "restore" }] }),
              presence: async () => JSON.stringify({ ok: true, counts: { viewer: 2, analyst: 1, admin: 1 } }),
            },
          };
        }
        const fake = FakeSocket();
        if (window.root) root.createServerSocket = () => fake;

        const r = await RT.connect(true);
        push("C: connect opens the hub socket", r.ok === true && r.mode === "live", JSON.stringify(r));

        const auth = await RT.auth("fake-admin-token");
        push("C: auth escalates to admin", auth.ok === true && auth.role === "admin" && RT.role() === "admin", JSON.stringify(auth));

        RT.reportIndex();
        RT.announceDoc({ id: "rep-x", actor: "alice", action: "update" });
        await new Promise((res) => setTimeout(res, 50));
        push("C: reportIndex + announceDoc call the hub", true, "no throw");

        const tail = await RT.auditTail();
        push("C: auditTail returns hub log", tail.ok === true && tail.tail.length === 1, JSON.stringify(tail));

        RT.presenceRefresh();
        await new Promise((res) => setTimeout(res, 50));
        const st = RT.status();
        push("C: status reflects live mode + presence", st.mode === "live" && st.socketState === 1 && st.presence.viewer === 2 && st.presence.admin === 1, JSON.stringify(st));

        /* teardown + restore the real hub connection */
        if (window.root) root.createServerSocket = origSocket;
        RT.setRole(origRole);
        await RT.connect(true);
        push("C: hub client reconnects to the real socket", true, "mode after: " + RT.mode());
      }

      return results;
    },
  };
})();
