(function () {
  const T = window.QU_SELFTEST;
  const QS = window.QU_STORE;
  const C = window.QU_CONNECTORS;
  const M = window.QU_MAIL;
  if (!T || !QS || !C || !M) return;

  function makeKv(kvStore) {
    return { get: async k => kvStore.get(k), set: async (k, v) => { kvStore.set(k, v); }, delete: async k => { kvStore.delete(k); } };
  }
  function makeEditable(files) {
    return {
      get: async name => { const f = files.get(name); return f ? f.text : null; },
      set: async (name, text, o) => {
        o = o || {};
        let f = files.get(name);
        if (!f) { f = { text, key: "ek." + name, count: 0 }; files.set(name, f); f.count = 1; return { error: null, editKey: f.key, editCount: 1, created: true }; }
        if (!o.editKey || o.editKey !== f.key) return { error: "invalid or missing edit key", created: false };
        if (f.text === text) return { error: null, editCount: f.count, unchanged: true };
        f.text = text; f.count++;
        return { error: null, editCount: f.count, unchanged: false };
      }
    };
  }
  function makeStore() {
    return QS.create({ ns: "mail" + QS.randHex(6), kv: makeKv(new Map()), editable: makeEditable(new Map()), modules: QS.DEFAULT_MODULES });
  }

  const DIRECTORY = [
    { actor: "rep1", name: "Alex Rivera", mailbox: "alex.rivera@example.com", group: "sales" },
    { actor: "rep2", name: "Jordan Blake", mailbox: "jordan.blake@example.com", group: "sales" },
    { actor: "ops1", name: "Priya Raman", mailbox: "priya.raman@example.com", group: "operations" }
  ];
  const POLICY = { permission: "Mail.Send", scope_group: "sales", send_as: "own_mailbox", allow_shared: false, shared_mailboxes: "sales@example.com,info@example.com" };

  T.register("mail: the permission is an application grant scoped to the sales group, send-as is the sender's own mailbox, and shared mailboxes are never the sender", () => {
    const bad = [];
    const svc = M.createService({ policy: POLICY, directory: DIRECTORY });
    const p = svc.policy();
    if (p.permission !== "Mail.Send") bad.push("permission: " + p.permission);
    if (p.scope_group !== "sales") bad.push("scope group: " + p.scope_group);
    if (p.send_as !== "own_mailbox") bad.push("send-as: " + p.send_as);
    if (p.allow_shared !== false) bad.push("shared must be refused");
    if (!svc.isInScope("rep1")) bad.push("rep1 is in scope");
    if (svc.isInScope("ops1")) bad.push("ops1 is NOT in the sales scope");
    if (!svc.isSharedMailbox("sales@example.com")) bad.push("sales@ is shared");
    if (svc.isSharedMailbox("alex.rivera@example.com")) bad.push("a personal mailbox is not shared");
    const g = svc.grant();
    if (g.mode !== "application") bad.push("the grant is an application grant");
    if (g.members.length !== 2) bad.push("the grant should list the two sales members: " + g.members.length);
    if (!svc.verify().ok) bad.push("verify: " + JSON.stringify(svc.verify().violations));
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "one application permission scoped to the sales group, send-as = own mailbox, shared mailboxes rejected, and the scope is enforced on membership" };
  });

  T.register("mail: authorize refuses an out-of-scope sender, a shared mailbox and another person's mailbox, and allows only the sender's own mailbox", () => {
    const bad = [];
    const svc = M.createService({ policy: POLICY, directory: DIRECTORY });
    const ok = svc.authorize({ actor: "rep1", from: "alex.rivera@example.com", to: "client@x.example" });
    if (!ok.ok || ok.mode !== "send_as_rep" || ok.mailbox !== "alex.rivera@example.com") bad.push("own mailbox: " + JSON.stringify(ok));
    const outOfScope = svc.authorize({ actor: "ops1", from: "priya.raman@example.com" });
    if (outOfScope.ok || outOfScope.code !== "not_in_scope") bad.push("out of scope: " + JSON.stringify(outOfScope));
    const shared = svc.authorize({ actor: "rep1", from: "sales@example.com" });
    if (shared.ok || shared.code !== "shared_mailbox_forbidden") bad.push("shared: " + JSON.stringify(shared));
    const other = svc.authorize({ actor: "rep1", from: "jordan.blake@example.com" });
    if (other.ok || other.code !== "not_own_mailbox") bad.push("not own: " + JSON.stringify(other));
    const unknown = svc.authorize({ actor: "ghost", from: "ghost@example.com" });
    if (unknown.ok || unknown.code !== "unknown_sender") bad.push("unknown: " + JSON.stringify(unknown));
    const noFrom = svc.authorize({ actor: "rep1", from: "" });
    if (noFrom.ok || noFrom.code !== "sender_required") bad.push("no from: " + JSON.stringify(noFrom));
    const resolvedByFrom = svc.authorize({ from: "jordan.blake@example.com" });
    if (!resolvedByFrom.ok || resolvedByFrom.actor !== "rep2") bad.push("resolve by mailbox: " + JSON.stringify(resolvedByFrom));
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "only a sales-group member sending as their OWN mailbox is allowed; out-of-scope, shared, foreign and unknown senders are refused with a precise code" };
  });

  T.register("mail: the connector enforces the permission on every send, a permitted send records the message (or a mailto link), and the grant persists in a document", async () => {
    const bad = [];
    const store = makeStore();
    const svc = M.createService({ store, policy: POLICY, directory: DIRECTORY });
    const ready = await svc.ready();
    if (!ready.ok) return { pass: false, detail: "ready: " + JSON.stringify(ready) };
    const doc = await store.loadDoc("mail_permission");
    if (!doc.ok || !doc.content || !doc.content.grant) bad.push("mail_permission document missing");
    else if (doc.content.grant.permission !== "Mail.Send" || doc.content.grant.scope_group !== "sales") bad.push("grant document wrong: " + JSON.stringify(doc.content.grant));

    const mail = C.createMockMail(undefined, { authorize: o => svc.authorize(o) });
    const gw = C.createGateway({
      connectors: { mail },
      manifest: { mail: { functions: { listReps: { effect: "read" }, resolveRep: { effect: "read" }, send: { effect: "write" }, get: { effect: "read" }, list: { effect: "read" }, outboxSize: { effect: "read" } } } }
    });

    const sent = gw.call("mail", "send", { to: "client@x.example", from: "alex.rivera@example.com", actor: "rep1", subject: "Your quote", body: "hi" }, { scope: "*" });
    if (!sent.ok || !sent.result || !sent.result.id) bad.push("permitted send: " + JSON.stringify(sent));
    const mailto = gw.call("mail", "send", { to: "client@x.example", from: "alex.rivera@example.com", actor: "rep1", subject: "Your quote", body: "hi", transport: "mailto" }, { scope: "*" });
    if (!mailto.ok || !mailto.result.client || !/^mailto:/.test(mailto.result.mailto_url || "")) bad.push("mailto transport: " + JSON.stringify(mailto));

    const foreign = gw.call("mail", "send", { to: "client@x.example", from: "jordan.blake@example.com", actor: "rep1" }, { scope: "*" });
    if (foreign.ok || foreign.code !== "not_own_mailbox") bad.push("connector must refuse a foreign sender: " + JSON.stringify(foreign));
    const shared = gw.call("mail", "send", { to: "client@x.example", from: "sales@example.com", actor: "rep1" }, { scope: "*" });
    if (shared.ok || shared.code !== "shared_mailbox_forbidden") bad.push("connector must refuse a shared mailbox: " + JSON.stringify(shared));
    const count = gw.call("mail", "outboxSize", {}, { scope: "*" });
    if (!count.ok || count.result !== 1) bad.push("only the permitted log send should be in the outbox: " + JSON.stringify(count));
    if (!svc.verify().ok) bad.push("verify: " + JSON.stringify(svc.verify().violations));
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "the mail connector refuses a shared or foreign sender before delivery, a permitted send records the message (and mailto builds the client link), and the application grant persists in the mail_permission document" };
  });
})();
