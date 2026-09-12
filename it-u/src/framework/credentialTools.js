// src/framework/credentialTools.js — credential generation & rotation paths
// (roadmap Phase 4, task 19).
//
// Two things make passwords operationally real, and neither is "store a string":
//
//   • GENERATION — the interface can mint a strong password (length, character
//     classes, ambiguous-character avoidance) and tell the operator how strong
//     the result actually is.
//   • ROTATION — every credential records the PATH by which its secret is
//     changed: manually, or by a designated connected password-management
//     product. IT-U records that path and the rotation schedule; it does NOT
//     itself change passwords on a client's systems. That limitation is stated
//     plainly (ROTATION_DISCLAIMER) because whether rotation can be automated
//     depends entirely on the connected product.
//
// The rotation model is deliberately honest about capability: choosing
// "connected product" without naming the product is not a working rotation
// path, so rotationCapability() reports { ready:false, needsProduct:true } and
// the UI says so rather than pretending.

export const CREDENTIAL_CHARSETS = {
  lowercase: "abcdefghijklmnopqrstuvwxyz",
  uppercase: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  digits: "0123456789",
  symbols: "!@#$%^&*()-_=+[]{};:,.?/",
};

const AMBIGUOUS = new Set("Il1O0oS5B8Z2G6");

const stripAmbiguous = (s) => [...s].filter((c) => !AMBIGUOUS.has(c)).join("");

function pickRandom(pool, random) {
  return pool[Math.floor(random() * pool.length) % pool.length];
}

function shuffle(arr, random) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Generate a password. Guarantees at least one character from every selected
// class, then fills and shuffles, so the result is not biased toward any one
// class. `random` is injectable so tests are deterministic.
export function generatePassword(options = {}) {
  const {
    length = 20,
    lowercase = true,
    uppercase = true,
    digits = true,
    symbols = true,
    avoidAmbiguous = true,
    random = Math.random,
  } = options;

  const wanted = [];
  if (lowercase) wanted.push("lowercase");
  if (uppercase) wanted.push("uppercase");
  if (digits) wanted.push("digits");
  if (symbols) wanted.push("symbols");
  const classes = wanted.length ? wanted : ["lowercase"];

  const pools = classes.map((id) => (avoidAmbiguous ? stripAmbiguous(CREDENTIAL_CHARSETS[id]) : CREDENTIAL_CHARSETS[id]));
  const all = pools.join("");
  const size = Math.max(classes.length, Math.min(128, Math.max(4, Math.floor(Number(length) || 20))));
  const out = pools.map((p) => pickRandom(p, random));
  while (out.length < size) out.push(pickRandom(all, random));
  return shuffle(out, random).join("");
}

// A rough strength estimate: entropy = length × log2(alphabet size). Good enough
// to show a meter and to nudge operators toward a longer secret; it is not a
// crack-time oracle.
export function passwordStrength(password) {
  const s = String(password == null ? "" : password);
  let alphabet = 0;
  if (/[a-z]/.test(s)) alphabet += 26;
  if (/[A-Z]/.test(s)) alphabet += 26;
  if (/[0-9]/.test(s)) alphabet += 10;
  if (/[^A-Za-z0-9]/.test(s)) alphabet += 33;
  const bits = s.length && alphabet ? Math.round(s.length * Math.log2(alphabet)) : 0;
  let score;
  if (!s.length) score = 0;
  else if (bits < 40) score = 1;
  else if (bits < 60) score = 2;
  else if (bits < 80) score = 3;
  else score = 4;
  const labels = ["Empty", "Weak", "Fair", "Strong", "Very strong"];
  return { length: s.length, entropyBits: bits, score, label: labels[score], symbols: alphabet };
}

// ---- rotation path ---------------------------------------------------------

export const ROTATION_METHODS = [
  {
    id: "manual",
    label: "Manual rotation",
    description: "A person changes the secret on the underlying system and records the new value here.",
  },
  {
    id: "connected-product",
    label: "Connected password-management product",
    description: "A designated password manager or secrets platform holds the credential and performs or records rotation.",
  },
];

export const ROTATION_PRODUCTS = [
  { id: "1password", label: "1Password" },
  { id: "bitwarden", label: "Bitwarden" },
  { id: "keeper", label: "Keeper" },
  { id: "dashlane", label: "Dashlane" },
  { id: "delinea", label: "Delinea Secret Server" },
  { id: "cyberark", label: "CyberArk" },
  { id: "hashicorp-vault", label: "HashiCorp Vault" },
  { id: "azure-key-vault", label: "Azure Key Vault" },
  { id: "aws-secrets-manager", label: "AWS Secrets Manager" },
  { id: "other", label: "Another product" },
];

export const ROTATION_DISCLAIMER =
  "IT-U records each credential and the path by which it is rotated. Rotation capability depends on the connected product — the documentation system itself does not change passwords on your systems.";

export const DEFAULT_ROTATION_DAYS = 90;

export const rotationMethod = (id) => ROTATION_METHODS.find((m) => m.id === id) || null;
export const rotationProduct = (id) => ROTATION_PRODUCTS.find((p) => p.id === id) || null;

// The rotation path a credential records, and whether it is actually workable.
export function rotationCapability(record) {
  const r = record || {};
  const method = rotationMethod(r.rotationMethod) || rotationMethod("manual");
  const product = r.rotationProduct ? rotationProduct(r.rotationProduct) : null;
  const automated = method.id === "connected-product";
  const needsProduct = automated && !product;
  return {
    method,
    product,
    automated,
    needsProduct,
    ready: !needsProduct,
    summary: automated
      ? product
        ? `Rotated by the connected product ${product.label}.`
        : "Rotation is set to a connected product, but no product is named yet."
      : "Rotated manually and recorded here.",
    note: ROTATION_DISCLAIMER,
  };
}

const DAY = 86400000;

const toMs = (v) => {
  if (v == null || v === "") return null;
  if (typeof v === "number") return v > 0 ? v : null;
  const t = Date.parse(String(v));
  return Number.isNaN(t) ? null : t;
};

// Where a credential sits in its rotation schedule. `tracked` is false until a
// last-rotated date is recorded. The date may be a timestamp or a YYYY-MM-DD
// string (the credential record stores a plain date).
export function rotationStatus(record, { now = Date.now(), defaultDays = DEFAULT_ROTATION_DAYS } = {}) {
  const r = record || {};
  const intervalDays = Number(r.rotateEveryDays) > 0 ? Math.floor(Number(r.rotateEveryDays)) : defaultDays;
  const rotatedAt = toMs(r.rotatedAt);
  if (!rotatedAt) {
    return { tracked: false, due: false, overdue: false, intervalDays, rotatedAt: null, dueAt: null, daysUntil: null, overdueDays: 0 };
  }
  const dueAt = rotatedAt + intervalDays * DAY;
  const daysUntil = Math.ceil((dueAt - now) / DAY);
  return {
    tracked: true,
    due: daysUntil <= 0,
    overdue: daysUntil < 0,
    intervalDays,
    rotatedAt,
    dueAt,
    daysUntil,
    overdueDays: daysUntil < 0 ? -daysUntil : 0,
  };
}

export function rotationSummary(record, opts) {
  const cap = rotationCapability(record);
  const status = rotationStatus(record, opts);
  if (!status.tracked) return cap.summary + " No rotation date recorded yet.";
  if (status.overdue) return `${cap.summary} Overdue for rotation by ${status.overdueDays} day${status.overdueDays === 1 ? "" : "s"}.`;
  if (status.due) return `${cap.summary} Due for rotation now.`;
  return `${cap.summary} Next rotation in ${status.daysUntil} day${status.daysUntil === 1 ? "" : "s"}.`;
}
