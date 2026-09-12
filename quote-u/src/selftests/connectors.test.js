(function () {
  const T = window.QU_SELFTEST;
  const C = window.QU_CONNECTORS;
  if (!T || !C) return;

  T.register("mail connector: the outbound email adapter sends as the rep and keeps an outbox", () => {
    const bad = [];
    const url = C.mailtoUrl({ to: "dana@northwind.example", subject: "Your quote Q-0001", body: "Hi there & welcome" });
    if (url.indexOf("mailto:dana%40northwind.example?") !== 0) bad.push("mailtoUrl address: " + url);
    if (url.indexOf("subject=Your%20quote%20Q-0001") === -1) bad.push("mailtoUrl subject not encoded");
    if (url.indexOf("body=Hi%20there%20%26%20welcome") === -1) bad.push("mailtoUrl body not encoded");

    const mail = C.createMockMail();
    if (mail.functions.listReps().length !== C.DEFAULT_MAIL_SEED.reps.length) bad.push("listReps");
    const byName = mail.functions.resolveRep({ actor: "Alex Rivera" });
    if (!byName || byName.mailbox !== "alex.rivera@example.com") bad.push("resolveRep by name: " + JSON.stringify(byName));
    const byId = mail.functions.resolveRep({ actor: "rep2" });
    if (!byId || byId.id !== "rep2") bad.push("resolveRep by id");
    const byMail = mail.functions.resolveRep({ actor: "alex.rivera@example.com" });
    if (!byMail || byMail.id !== "rep1") bad.push("resolveRep by mailbox");
    if (mail.functions.resolveRep({ actor: "nobody" }) !== null) bad.push("unknown rep should resolve to null");

    const gateway = C.createGateway({ connectors: { mail } });
    const noTo = gateway.call("mail", "send", { from: "alex.rivera@example.com" }, { scope: "*" });
    if (noTo.ok || noTo.code !== "recipient_required") bad.push("missing recipient accepted: " + JSON.stringify(noTo));
    const noFrom = gateway.call("mail", "send", { to: "dana@northwind.example" }, { scope: "*" });
    if (noFrom.ok || noFrom.code !== "sender_required") bad.push("missing sender accepted: " + JSON.stringify(noFrom));

    const sent = gateway.call("mail", "send", { to: "dana@northwind.example", from: "alex.rivera@example.com", subject: "Quote", body: "Body", link: "https://perchance.org/quote-u#/q/abc", quote_id: "q1", company_id: "c1", transport: "log" }, { scope: "*" });
    if (!sent.ok || !sent.result || !sent.result.id || sent.result.to !== "dana@northwind.example" || sent.result.from !== "alex.rivera@example.com") bad.push("send result: " + JSON.stringify(sent));
    if (mail.functions.outboxSize() !== 1) bad.push("outbox size: " + mail.functions.outboxSize());
    const got = gateway.call("mail", "get", { id: sent.result.id }, { scope: "*" });
    if (!got.ok || !got.result || got.result.link !== "https://perchance.org/quote-u#/q/abc") bad.push("get message: " + JSON.stringify(got));

    gateway.call("mail", "send", { to: "priya@harborline.example", from: "jordan.blake@example.com", subject: "Other", quote_id: "q2", company_id: "c2" }, { scope: "*" });
    const forQ1 = gateway.call("mail", "list", { quote_id: "q1" }, { scope: "*" });
    if (!forQ1.ok || forQ1.result.length !== 1 || forQ1.result[0].quote_id !== "q1") bad.push("list by quote_id: " + JSON.stringify(forQ1));

    // Scope isolation: a c1-scoped caller cannot see or send as c2.
    const hidden = gateway.call("mail", "list", {}, { scope: ["c1"] });
    if (!hidden.ok || hidden.result.length !== 1 || hidden.result[0].company_id !== "c1") bad.push("scope leak in list: " + JSON.stringify(hidden));
    const blocked = gateway.call("mail", "send", { to: "x@example.com", from: "alex.rivera@example.com", company_id: "c2" }, { scope: ["c1"] });
    if (blocked.ok || blocked.code !== "not_found") bad.push("cross-account send allowed: " + JSON.stringify(blocked));

    const unknown = gateway.call("mail", "explode", {}, { scope: "*" });
    if (unknown.ok || unknown.code !== "function_not_allowed") bad.push("un-allowlisted function reachable: " + JSON.stringify(unknown));
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "the mock mail adapter resolves reps, demands a recipient and the rep's own sender, records an outbox, filters by quote/account scope, and only exposes allowlisted functions" };
  });
})();
