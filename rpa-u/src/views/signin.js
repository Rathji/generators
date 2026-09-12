import { el, mount } from "../framework/dom.js";
import { toast } from "../framework/toast.js";
import { connectivityChip, initialsOf, roleChip } from "./identity-ui.js";

function accountCard(account, onSignIn) {
  const card = el("article.pu-account-card");
  card.appendChild(el("span.pu-avatar.lg", { text: initialsOf(account.name) }));
  const body = el("div.pu-account-body");
  body.appendChild(el("span.pu-account-name", { text: account.name }));
  body.appendChild(el("span.pu-small.pu-muted", { text: account.jobTitle || account.username }));
  const meta = el("div.pu-chips", { style: { "margin-top": "0.35rem" } });
  meta.appendChild(roleChip(account.role));
  if (account.tenantId === "fabrikam-demo") meta.appendChild(el("span.pu-chip.warn", { text: "Wrong tenant demo" }));
  body.appendChild(meta);
  card.appendChild(body);
  const button = el("button.pu-btn.secondary", { type: "button", text: "Sign in" });
  button.addEventListener("click", () => onSignIn(account.id, button));
  card.appendChild(button);
  return card;
}

export function renderSignin({ hub, config }) {
  const root = el("div.pu-signin");
  let busy = false;

  const unsubscribe = hub.auth.subscribe(() => {
    if (hub.auth.snapshot().status === "authenticating") setStatus("Signing in…", "info");
  });

  function setStatus(message, tone) {
    mount(status, el("div.pu-alert", { class: tone || "", text: message }));
  }

  async function signIn(accountId, button) {
    if (busy) return;
    busy = true;
    if (button) button.disabled = true;
    setStatus("Signing in to the demo directory…", "info");
    try {
      const result = await hub.auth.signInWithSimulator(accountId);
      if (!result || result.ok === false) {
        const message = (result && result.error) || "The demo sign-in failed.";
        setStatus(message, "fail");
        toast(message, { tone: "error" });
        return;
      }
      toast("Signed in", { tone: "success" });
    } catch (error) {
      setStatus(error && error.message ? error.message : "The demo sign-in failed.", "fail");
    } finally {
      busy = false;
      if (button) button.disabled = false;
    }
  }

  async function entraSignIn(button) {
    if (busy) return;
    busy = true;
    if (button) button.disabled = true;
    try {
      const begun = await hub.auth.beginEntraSignIn();
      if (!begun || begun.ok === false) {
        setStatus((begun && begun.error) || "Entra ID sign-in could not be started.", "fail");
        return;
      }
      window.location.assign(begun.url);
    } catch (error) {
      setStatus(error && error.message ? error.message : "Entra ID sign-in could not be started.", "fail");
    } finally {
      busy = false;
      if (button) button.disabled = false;
    }
  }

  const publicConfig = hub.auth.publicConfig();
  const snap = hub.auth.snapshot();

  const card = el("section.pu-signin-card.pu-card");
  const brand = el("div.pu-signin-brand");
  brand.appendChild(el("span.pu-logo-mark.lg", { text: config.logoMark || "RU" }));
  brand.appendChild(el("h1", { text: config.appTitle }));
  brand.appendChild(el("p.pu-muted", { text: config.tagline }));
  card.appendChild(brand);

  const status = el("div.pu-signin-status");
  card.appendChild(status);

  if (snap.status === "wrong-tenant") setStatus(snap.error || "Your account belongs to an unauthorised tenant.", "fail");
  else if (snap.error) setStatus(snap.error, "fail");

  card.appendChild(
    el("p.pu-small", {
      text: "Sign in to open RPA-U. Your identity provider supplies the roles that decide which parts of the hub you can see and change.",
    })
  );

  if (publicConfig.configured) {
    const entraBtn = el("button.pu-btn.lg", { type: "button" });
    entraBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 23 23" aria-hidden="true"><path fill="#f35325" d="M1 1h10v10H1z"/><path fill="#81bc06" d="M12 1h10v10H12z"/><path fill="#05a6f0" d="M1 12h10v10H1z"/><path fill="#ffba08" d="M12 12h10v10H12z"/></svg><span>Sign in with Microsoft Entra ID</span>';
    entraBtn.addEventListener("click", () => entraSignIn(entraBtn));
    card.appendChild(el("div.pu-signin-actions", {}, entraBtn));
    card.appendChild(
      el("p.pu-small.pu-muted", {
        text: `Tenant ${publicConfig.tenantId} · client ${publicConfig.clientId}. Microsoft handles the password; RPA-U only ever sees a signed token.`,
      })
    );
  } else {
    card.appendChild(
      el("div.pu-alert", {
        class: "info",
        text: "Entra ID is not configured in this deployment, so the offline demo directory stands in for a real tenant. Add a tenant id and client id to the identity block in main.pjs to enable Microsoft sign-in.",
      })
    );
  }

  const accounts = hub.auth.accounts();
  if (publicConfig.showSimulator && accounts.length) {
    const demo = el("div.pu-signin-demo");
    demo.appendChild(el("h2", { text: "Demo directory" }));
    demo.appendChild(
      el("p.pu-small.pu-muted", {
        text: "Each account carries a different Entra ID app role, so you can see the permission model in action without a live tenant. The last account belongs to another tenant and is rejected by the tenant guard.",
      })
    );
    const grid = el("div.pu-account-grid");
    for (const account of accounts) grid.appendChild(accountCard(account, signIn));
    demo.appendChild(grid);
    card.appendChild(demo);
  }

  const footer = el("div.pu-signin-foot");
  footer.appendChild(connectivityChip(hub));
  footer.appendChild(
    el("span.pu-small.pu-muted", {
      text: "Client-side role checks shape the experience, but a determined user can edit the page. A trusted backend is required for security that matters.",
    })
  );
  card.appendChild(footer);

  root.appendChild(card);
  root.appendChild(el("p.pu-small.pu-muted.pu-signin-note", { text: "No passwords, client secrets or API keys are stored in this generator — all identity configuration is public-safe and entered at runtime." }));

  return { node: root, destroy: unsubscribe };
}
