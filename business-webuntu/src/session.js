// Webuntu OS — Lock / login screen with accounts (Phase 1, Task 4)
// A real sign-in experience: create an account (username + password), sign in,
// and lock/unlock. Credentials are stored locally with a salted SHA-256 hash
// (plaintext is never kept). Multiple accounts are supported; the last user is
// remembered. It can never trap the user: "Reset accounts" forgets everything
// and returns to setup. Exposes window.OS.lock()/unlock()/isLocked/currentUser.

(function () {
  "use strict";

  const loginEl = document.getElementById("login");
  const timeEl  = document.getElementById("loginTime");
  const dateEl  = document.getElementById("loginDate");
  const appEl   = document.getElementById("app");
  const avatarEl = document.getElementById("loginAvatar");
  const userEl   = document.getElementById("loginUser");
  const hostEl   = document.getElementById("loginHost");

  const signinForm     = document.getElementById("signinForm");
  const createForm     = document.getElementById("createForm");
  const signinUserInput = document.getElementById("signinUser");
  const signinPassInput = document.getElementById("signinPass");
  const signinErrorEl   = document.getElementById("signinError");
  const createUserInput = document.getElementById("createUser");
  const createDisplayInput = document.getElementById("createDisplay");
  const createPassInput = document.getElementById("createPass");
  const createPass2Input = document.getElementById("createPass2");
  const createErrorEl   = document.getElementById("createError");
  const toCreateBtn     = document.getElementById("toCreateBtn");
  const toSigninBtn     = document.getElementById("toSigninBtn");
  const resetAcctBtn    = document.getElementById("resetAcctBtn");

  let locked = false;

  if (window.__migrateKey) {
    window.__migrateKey("rathbuntu.accounts", "webuntu.accounts");
    window.__migrateKey("rathbuntu.session", "webuntu.session");
  }

  // ---------- account storage (local, salted hash — never plaintext) ----------
  const AVATAR_DEFAULT = "👤";
  const AVATAR_CHOICES = ["🦊","🐼","🐸","🦉","🐙","🦋","🦁","🐯","🐺","🦄","🐲","🐳","⭐","🚀","🎧","👑"];
  function defaultAvatar(username) { return username ? username[0].toUpperCase() : AVATAR_DEFAULT; }
  function normalizeAccounts(raw) {
    for (const [u, a] of Object.entries(raw || {})) {
      if (!a || typeof a !== "object") continue;
      a.displayName = a.displayName || u;
      a.avatar = a.avatar || defaultAvatar(u);
    }
    return raw;
  }
  function loadAccounts() {
    try { return normalizeAccounts(JSON.parse(localStorage.getItem("webuntu.accounts") || "{}")); }
    catch (e) { return {}; }
  }
  function saveAccounts(a) {
    try { localStorage.setItem("webuntu.accounts", JSON.stringify(a)); } catch (e) {}
  }
  function lastUser() {
    try { return JSON.parse(localStorage.getItem("webuntu.session") || "{}").lastUser || null; }
    catch (e) { return null; }
  }
  function setLastUser(u) {
    try { localStorage.setItem("webuntu.session", JSON.stringify({ lastUser: u })); } catch (e) {}
  }

  const SALT_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  function makeSalt() {
    const a = new Uint8Array(12);
    crypto.getRandomValues(a);
    return [...a].map((b) => SALT_CHARS[b % SALT_CHARS.length]).join("");
  }
  async function hashPassword(password, salt) {
    const data = salt + ":" + password;
    if (crypto && crypto.subtle) {
      const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
      return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
    }
    // fallback for insecure contexts (non-crypto mix)
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < data.length; i++) {
      const ch = data.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
  }

  // ---------- account management (shared by the login screen and Settings) ----
  async function createAccount(username, display, password) {
    const uname = String(username || "").trim().toLowerCase();
    const disp = String(display || "").trim();
    const pass = String(password || "");
    const accounts = loadAccounts();
    if (!/^[a-z0-9_.-]{3,20}$/.test(uname)) return { error: "Username: 3–20 letters/numbers/._-" };
    if (accounts[uname]) return { error: "That username is taken." };
    if (pass.length < 4) return { error: "Password must be at least 4 characters." };
    const salt = makeSalt();
    const hash = await hashPassword(pass, salt);
    accounts[uname] = { salt, hash, displayName: disp || uname, avatar: defaultAvatar(uname), created: Date.now() };
    saveAccounts(accounts);
    return { ok: true, username: uname };
  }

  async function updateAccount(username, patch) {
    const accounts = loadAccounts();
    const a = accounts[username];
    if (!a) return { error: "No such account." };
    if (patch && typeof patch.displayName === "string") a.displayName = patch.displayName.trim() || username;
    if (patch && typeof patch.avatar === "string") {
      const av = patch.avatar.trim();
      a.avatar = av.length && av.length <= 4 ? av : defaultAvatar(username);
    }
    if (patch && patch.password) {
      const pass = String(patch.password);
      if (pass.length < 4) return { error: "Password must be at least 4 characters." };
      a.salt = makeSalt();
      a.hash = await hashPassword(pass, a.salt);
    }
    saveAccounts(accounts);
    return { ok: true };
  }

  function deleteAccount(username) {
    const accounts = loadAccounts();
    if (!accounts[username]) return { error: "No such account." };
    if (Object.keys(accounts).length <= 1) return { error: "You can't delete the only account." };
    delete accounts[username];
    saveAccounts(accounts);
    const self = lastUser() === username;
    if (self) setLastUser(Object.keys(accounts)[0]);
    return { ok: true, selfDeleted: self };
  }

  function notifyUserChange() {
    document.dispatchEvent(new CustomEvent("webuntu-userchange"));
  }

  const accountsEl = document.getElementById("loginAccounts");
  let selectedUser = null;

  function mk(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function applyProfile(username) {
    const acct = loadAccounts()[username];
    const disp = (acct && acct.displayName) || username || "Sign in";
    if (userEl) userEl.textContent = disp;
    if (avatarEl) avatarEl.textContent = (acct && acct.avatar) || defaultAvatar(username);
    if (hostEl) hostEl.textContent = username ? username + "@webuntu" : "@webuntu";
  }

  // Linux-style login: every account appears as a clickable avatar chip.
  function renderAccountPicker(selected) {
    if (!accountsEl) return;
    accountsEl.textContent = "";
    const list = Object.entries(loadAccounts());
    if (!list.length) { accountsEl.hidden = true; return; }
    accountsEl.hidden = false;
    for (const [u, a] of list) {
      const chip = mk("button", "login-acct" + (u === selected ? " sel" : ""));
      chip.type = "button";
      chip.dataset.user = u;
      chip.title = u;
      chip.appendChild(mk("span", "login-acct-avatar", a.avatar || defaultAvatar(u)));
      chip.appendChild(mk("span", "login-acct-name", a.displayName || u));
      chip.addEventListener("click", () => selectAccount(u));
      accountsEl.appendChild(chip);
    }
    const add = mk("button", "login-acct login-acct-new");
    add.type = "button";
    add.appendChild(mk("span", "login-acct-avatar", "+"));
    add.appendChild(mk("span", "login-acct-name", "New user"));
    add.addEventListener("click", () => { signinPassInput.value = ""; showCreate(); });
    accountsEl.appendChild(add);
  }

  function fillSignin(username) {
    selectedUser = username;
    signinUserInput.value = username;
    signinPassInput.value = "";
    applyProfile(username);
    renderAccountPicker(username);
    signinPassInput.focus();
  }

  function selectAccount(username) {
    if (!createForm.hidden) {
      createForm.hidden = true;
      signinForm.hidden = false;
      signinErrorEl.textContent = "";
    }
    fillSignin(username);
  }

  // ---------- clock ----------
  const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
  const dateFmt = new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long" });
  function tick() {
    const now = new Date();
    if (timeEl) timeEl.textContent = timeFmt.format(now);
    if (dateEl) dateEl.textContent = dateFmt.format(now);
  }

  // ---------- auth UI ----------
  function showSignin() {
    signinForm.hidden = false;
    createForm.hidden = true;
    signinErrorEl.textContent = "";
    const accounts = loadAccounts();
    const lu = lastUser();
    const target = (lu && accounts[lu]) ? lu : (Object.keys(accounts)[0] || null);
    if (target) fillSignin(target);
    else {
      selectedUser = null;
      signinUserInput.value = "";
      signinPassInput.value = "";
      applyProfile("Sign in");
      renderAccountPicker(null);
      signinUserInput.focus();
    }
  }

  function showCreate() {
    createForm.hidden = false;
    signinForm.hidden = true;
    createErrorEl.textContent = "";
    if (userEl) userEl.textContent = "New user";
    if (hostEl) hostEl.textContent = "@webuntu";
    if (avatarEl) avatarEl.textContent = "👤";
    renderAccountPicker(null);
    createUserInput.focus();
  }

  function refreshAuthUI() {
    if (Object.keys(loadAccounts()).length > 0) showSignin();
    else showCreate();
  }

  // ---------- lock / unlock ----------
  function lock() {
    locked = true;
    tick();
    loginEl.classList.add("visible");
    refreshAuthUI();
  }
  function unlock() {
    locked = false;
    loginEl.classList.remove("visible");
    appEl.classList.add("visible");
    if (window.Welcome && window.Welcome.check) window.Welcome.check();
    notifyUserChange();
  }

  // ---------- events ----------
  signinForm.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const username = signinUserInput.value.trim().toLowerCase();
    const password = signinPassInput.value;
    if (!username || !password) {
      signinErrorEl.textContent = "Enter your username and password.";
      if (window.Sounds) window.Sounds.play("error");
      return;
    }
    const accounts = loadAccounts();
    const acct = accounts[username];
    if (!acct) {
      signinErrorEl.textContent = "No account \"" + username + "\" — create one.";
      if (window.Sounds) window.Sounds.play("error");
      return;
    }
    const hash = await hashPassword(password, acct.salt);
    if (hash !== acct.hash) {
      signinErrorEl.textContent = "Incorrect password.";
      signinPassInput.value = "";
      signinPassInput.focus();
      if (window.Sounds) window.Sounds.play("error");
      return;
    }
    setLastUser(username);
    unlock();
  });

  createForm.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const username = createUserInput.value.trim().toLowerCase();
    const display = createDisplayInput.value.trim();
    const password = createPassInput.value;
    const pass2 = createPass2Input.value;
    if (password !== pass2) {
      createErrorEl.textContent = "Passwords don't match.";
      if (window.Sounds) window.Sounds.play("error");
      return;
    }
    const res = await createAccount(username, display, password);
    if (res.error) {
      createErrorEl.textContent = res.error;
      if (window.Sounds) window.Sounds.play("error");
      return;
    }
    setLastUser(res.username);
    unlock();
  });

  toCreateBtn.addEventListener("click", showCreate);
  toSigninBtn.addEventListener("click", showSignin);

  resetAcctBtn.addEventListener("click", () => {
    if (!confirm("Reset accounts? This forgets all local accounts and returns to setup.")) return;
    try {
      localStorage.removeItem("webuntu.accounts");
      localStorage.removeItem("webuntu.session");
    } catch (e) {}
    signinPassInput.value = "";
    createPassInput.value = "";
    createPass2Input.value = "";
    refreshAuthUI();
  });

  setInterval(tick, 30000);

  window.OS = {
    lock,
    unlock,
    switchUser() { lock(); },
    get isLocked() { return locked; },
    get currentUser() { return lastUser(); },
    get accounts() { return Object.keys(loadAccounts()); },
    accountsInfo() {
      return Object.entries(loadAccounts()).map(([u, a]) => ({
        username: u,
        displayName: (a && a.displayName) || u,
        avatar: (a && a.avatar) || defaultAvatar(u),
      }));
    },
    displayName(u) { const a = loadAccounts()[u]; return (a && a.displayName) || u; },
    avatar(u) { const a = loadAccounts()[u]; return (a && a.avatar) || defaultAvatar(u); },
    get avatarChoices() { return AVATAR_CHOICES.slice(); },
    createAccount,
    updateAccount,
    deleteAccount,
  };
})();
