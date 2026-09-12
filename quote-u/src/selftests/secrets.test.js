(function () {
  const T = window.QU_SELFTEST;
  const S = window.QU_SECRETS;
  if (!T || !S) return;

  T.register("secrets: a credential-shaped value or key is recognised, and a declaration that carries one is refused", () => {
    const bad = [];
    const secrets = [
      "-----BEGIN RSA PRIVATE KEY-----\nMIIE...",
      "sk-abcdefghijklmnop1234567890",
      "ghp_" + "a".repeat(36),
      "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
      "AIza" + "B".repeat(35),
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"
    ];
    secrets.forEach((v, i) => { if (!S.isSecretShaped(v)) bad.push("should look secret-shaped: #" + i); });
    if (S.isSecretShaped("alex.rivera@example.com")) bad.push("a mailbox is not a secret");
    if (S.isSecretShaped("QU-2026-0001")) bad.push("a quote number is not a secret");
    if (S.isSecretShaped(20260912)) bad.push("a number is not a secret");

    let threw = null;
    try { S.assertClean({ roles: { owner: { connectors: "*" } } }, "policy"); } catch (e) { threw = e; }
    if (threw) bad.push("a clean declaration must pass: " + (threw && threw.code));
    threw = null;
    try { S.assertClean({ api_key: "sk-abcdefghijklmnop1234567890" }, "seed"); } catch (e) { threw = e; }
    if (!threw || threw.code !== "secret_in_surface") bad.push("a secret-shaped key/value must be refused");
    if (threw && !(threw.findings || []).length) bad.push("a refusal must carry the findings");

    const ref = S.reference("distributor_a_api");
    if (!S.isReference(ref) || ref.by !== "identity" || ref.value !== undefined) bad.push("a reference carries no value: " + JSON.stringify(ref));
    if (S.isReference({ by: "identity", name: "x", value: "sk-abc" })) bad.push("a reference with a value is not a reference");
    let refThrew = false;
    try { S.reference(""); } catch (e) { refThrew = e.code === "bad_reference"; }
    if (!refThrew) bad.push("a nameless reference must be refused");
    if (S.redact("sk-abcdefghijklmnop") !== "[redacted]") bad.push("redact: " + S.redact("sk-abcdefghijklmnop"));
    if (S.redact({ x: 1 }) !== "[redacted]") bad.push("redact of a non-string must be a placeholder");
    if (S.fingerprint("sk-abcdefghijklmnop") === S.fingerprint("sk-abcdefghijklmnop2")) bad.push("the fingerprint must distinguish different values");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "private keys, provider tokens, bearer/JWT and long hex are recognised, a clean declaration passes while one carrying a credential is refused with its findings, and an identity reference cannot carry a value" };
  });

  T.register("secrets: a client-facing surface that leaks a credential is caught before it can ship", () => {
    const bad = [];
    const clean = S.scanSurfaces([
      { name: "portal DTO", json: { quote_number: "QU-2026-0001", lines: [{ description: "AP", sell_cents: 120000 }] } },
      { name: "print view", text: "<html><body>Northwind — QU-2026-0001</body></html>" }
    ]);
    if (!clean.ok || clean.findings.length) bad.push("a clean surface must pass: " + JSON.stringify(clean.findings));

    const leaked = S.scanSurfaces([
      { name: "call log", text: "POST https://api.example.com Authorization: Bearer sk-live-abcdefghijklmnop123456" },
      { name: "portal DTO", json: { ok: true } }
    ]);
    if (leaked.ok || !leaked.findings.length) bad.push("a leaked surface must be caught");
    if (!leaked.findings.some(f => f.surface === "call log")) bad.push("the finding must name the surface: " + JSON.stringify(leaked.findings));

    let threw = null;
    try { S.assertSurfaces([{ name: "print view", text: "api_key: sk-abcdefghijklmnop1234567890" }]); } catch (e) { threw = e; }
    if (!threw || threw.code !== "secret_in_surface") bad.push("assertSurfaces must refuse a leaking surface");

    const verified = S.verify({ gateway_keys: { distributor_a: "distributor_a_api" } });
    if (!verified.ok) bad.push("a reference-only config must verify clean: " + JSON.stringify(verified.findings));
    const dirty = S.verify({ gateway_keys: { distributor_a: "sk-abcdefghijklmnop1234567890" } });
    if (dirty.ok) bad.push("a config with a raw credential must fail verify");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "the portal DTO and print surfaces pass when clean, a leaked bearer/credential is caught with the surface named, and a config holding key NAMES verifies clean while one holding a raw credential fails" };
  });
})();
