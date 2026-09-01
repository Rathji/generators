/* ============================================================
   BUSINESS TEMPLATE — application logic
   - loads the configuration from main.pjs (with any saved override)
   - renders the page from it
   - settings panel: edit, preview, scan-a-website palettes
   - JSON import / export / validation / format guide
   ============================================================ */

(function () {
  "use strict";

  const LS_KEY = "project-template-config-v1";

  /* ============================ tiny utils ============================ */

  const $ = (sel, ctx) => (ctx || document).querySelector(sel);
  const $$ = (sel, ctx) => Array.from((ctx || document).querySelectorAll(sel));

  function getPath(obj, path) {
    return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
  }
  function setPath(obj, path, value) {
    const keys = path.split(".");
    let o = obj;
    for (let i = 0; i < keys.length - 1; i++) {
      if (o[keys[i]] == null || typeof o[keys[i]] !== "object") o[keys[i]] = {};
      o = o[keys[i]];
    }
    o[keys[keys.length - 1]] = value;
  }
  const deepClone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function toast(msg, type) {
    const ctn = $("#toastCtn");
    const t = document.createElement("div");
    t.className = "toast" + (type ? " " + type : "");
    t.textContent = msg;
    ctn.appendChild(t);
    setTimeout(() => { t.style.opacity = "0"; t.style.transition = "opacity .3s"; setTimeout(() => t.remove(), 320); }, 2600);
  }

  /* ============================ color utils ============================ */

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  function hexToRgb(hex) {
    let h = String(hex).replace("#", "").trim();
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    if (h.length !== 6 || !/^[0-9a-f]{6}$/i.test(h)) return null;
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgbToHex([r, g, b]) {
    return "#" + [r, g, b].map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, "0")).join("");
  }
  function rgbToHsl([r, g, b]) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
    }
    return [h * 360, s, l];
  }
  function hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360 / 360;
    if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const f = (t) => {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    return [f(h + 1 / 3), f(h), f(h - 1 / 3)].map((v) => Math.round(v * 255));
  }
  const hslToHex = (h, s, l) => rgbToHex(hslToRgb(h, s, l));
  function shift(hex, dh, ds, dl) {
    const [h, s, l] = rgbToHsl(hexToRgb(hex));
    return hslToHex(((h + dh) % 360 + 360) % 360, clamp(s + (ds || 0), 0, 1), clamp(l + (dl || 0), 0, 1));
  }
  const darken = (c, d) => shift(c, 0, 0, -d);
  const lighten = (c, d) => shift(c, 0, 0, d);
  function mix(a, b, t) {
    const A = hexToRgb(a), B = hexToRgb(b);
    return rgbToHex(A.map((v, i) => v + (B[i] - v) * t));
  }
  const hueDist = (a, b) => { const d = Math.abs(((a - b) % 360 + 540) % 360 - 180); return d; };
  const isNeutral = (hex) => rgbToHsl(hexToRgb(hex))[1] < 0.12;
  const hexToRgba = (hex, a) => {
    const [r, g, b] = hexToRgb(hex) || [0, 0, 0];
    return "rgba(" + r + "," + g + "," + b + "," + a + ")";
  };

  /* ============================ icons ============================ */

  const ICON_PATHS = {
    zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
    chart: '<path d="M3 3v18h18"/><path d="M8 17v-5"/><path d="M13 17V8"/><path d="M18 17v-3"/>',
    layers: '<path d="M12 2 2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>',
    code: '<path d="m16 18 6-6-6-6"/><path d="M8 6l-6 6 6 6"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    rocket: '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    spark: '<path d="M12 3v4"/><path d="M12 17v4"/><path d="M3 12h4"/><path d="M17 12h4"/><path d="M5.6 5.6l2.8 2.8"/><path d="M15.6 15.6l2.8 2.8"/><path d="M18.4 5.6l-2.8 2.8"/><path d="M8.4 15.6l-2.8 2.8"/>',
    star: '<path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.77 5.82 21 7 14.14l-5-4.87 6.91-1.01L12 2z"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    gear: '<path d="M4 21v-7"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M20 21v-5"/><path d="M20 12V3"/><path d="M1 14h6"/><path d="M9 8h6"/><path d="M17 16h6"/>',
    cpu: '<rect x="7" y="7" width="10" height="10" rx="2"/><path d="M9 1v4"/><path d="M15 1v4"/><path d="M9 19v4"/><path d="M15 19v4"/><path d="M1 9h4"/><path d="M1 15h4"/><path d="M19 9h4"/><path d="M19 15h4"/>',
    cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>'
  };
  function icon(name, size) {
    const s = size || 20;
    return '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICON_PATHS[name] || ICON_PATHS.gear) + "</svg>";
  }

  /* ======================== config schema ========================
     The single definition of the JSON format: used for validation,
     the format guide, the example, and the downloadable JSON Schema.
     ================================================================ */

  const HEX = "hex", STR = "string", BOOL = "boolean", NUM = "number", OBJ = "object", ARR = "array", ENUM = "enum", FREE = "free";

  const SCHEMA = {
    type: OBJ, doc: "Root — the whole configuration. Imports may be partial; anything missing falls back to the template defaults.",
    fields: {
      schemaVersion: { type: STR, doc: "Format version of this config file.", example: "1.0.0" },
      branding: {
        type: OBJ, doc: "Company / brand identity used across the page.",
        fields: {
          companyName: { type: STR, doc: "Full company name — header, footer, copyright.", example: "Acme Solutions" },
          companyShortName: { type: STR, doc: "Compact variant (optional).", example: "Acme" },
          companyUrl: { type: STR, doc: "Your website URL — links the logo, header CTA and footer.", example: "https://example.com" },
          logoGlyph: { type: STR, doc: "Single letter/monogram drawn inside the logo mark.", example: "A" },
          logoUrl: { type: STR, doc: "Square logo image URL — upload one in settings → Branding → Logo image. Shown in the header/footer logo mark instead of the letter.", example: "" },
          tagline: { type: STR, doc: "Short pitch shown in the footer.", example: "Technology that moves your business forward" },
          contactEmail: { type: STR, doc: "Shown in the footer as a mailto: link.", example: "hello@example.com" },
          contactPhone: { type: STR, doc: "Shown in the footer as a tel: link.", example: "+1 (555) 010-0000" },
          address: { type: STR, doc: "Street address shown in the footer.", example: "123 Main Street, Anytown" },
          footerText: { type: STR, doc: "Bottom bar text. {year} and {companyName} are auto-filled.", example: "© {year} {companyName}. All rights reserved." }
        }
      },
      theme: {
        type: OBJ, doc: "Visual theme.",
        fields: {
          mode: { type: ENUM, values: ["light", "dark"], doc: "Light or dark interface.", example: "light" },
          accentStyle: { type: ENUM, values: ["gradient", "solid"], doc: "How CTAs and highlights are filled.", example: "gradient" },
          radius: { type: NUM, doc: "Corner radius in px (0–32).", example: 16 },
          fontSize: { type: NUM, doc: "Base text size in px (15–18).", example: 16 },
          fontFamily: { type: ENUM, values: ["lato", "inter", "roboto", "open-sans", "source-sans", "ibm-plex", "dm-sans", "manrope", "montserrat-lato", "playfair-lato", "merriweather-inter"], doc: "Font pairing — Lato, Inter, Roboto, IBM Plex Sans, or a headline/body combo like Playfair Display + Lato.", example: "lato" },
          reduceMotion: { type: BOOL, doc: "Disable animations and transitions.", example: false }
        }
      },
      colors: {
        type: OBJ, doc: "Brand palette. All values are #rrggbb hex colors.",
        fields: {
          primary: { type: HEX, doc: "Main brand color — buttons, links, highlights.", example: "#0a58ca" },
          secondary: { type: HEX, doc: "Secondary brand color — gradients, charts.", example: "#6ea8fe" },
          accent: { type: HEX, doc: "Accent — stars, badges, small details.", example: "#084298" },
          background: { type: HEX, doc: "Page background.", example: "#f8f9fa" },
          surface: { type: HEX, doc: "Card and section backgrounds.", example: "#ffffff" },
          text: { type: HEX, doc: "Main text color.", example: "#212529" },
          textMuted: { type: HEX, doc: "Secondary / muted text color.", example: "#6c757d" }
        }
      },
      product: {
        type: OBJ, doc: "Product / project details for the hero section.",
        fields: {
          name: { type: STR, doc: "Project or product name.", example: "Project Name" },
          badge: { type: STR, doc: "Small pill above the headline, e.g. 'New release'.", example: "New release" },
          headline: { type: STR, doc: "Main hero headline.", example: "Ship your next big thing, faster." },
          headlineAccent: { type: STR, doc: "The word(s) rendered in the brand gradient — should appear in the headline.", example: "faster." },
          subheadline: { type: STR, doc: "Supporting line under the headline.", example: "A short line on what this project does and who it is for." },
          primaryCta: { type: STR, doc: "Main call-to-action label.", example: "Get started" },
          primaryCtaUrl: { type: STR, doc: "Main call-to-action URL.", example: "#" },
          secondaryCta: { type: STR, doc: "Secondary call-to-action label.", example: "See how it works" },
          secondaryCtaUrl: { type: STR, doc: "Secondary call-to-action URL.", example: "#how" },
          status: { type: STR, doc: "Status chip under the CTAs. Empty string hides it.", example: "v1.0 · Released" }
        }
      },
      trustedBy: { type: ARR, doc: "Names shown in the 'trusted by' strip.", item: { type: STR, example: "Acme Corp" } },
      features: {
        type: ARR, doc: "Feature grid cards (3–8 recommended).",
        item: {
          type: OBJ, fields: {
            icon: { type: STR, doc: "One of: zap, shield, globe, chart, layers, code, lock, rocket, users, spark, star, gear, cpu, cloud.", example: "zap" },
            title: { type: STR, example: "Instant deployments" },
            description: { type: STR, example: "Ship updates in seconds." }
          }
        }
      },
      stats: {
        type: ARR, doc: "Numbers band (4 recommended).",
        item: {
          type: OBJ, fields: {
            value: { type: STR, doc: "The number, e.g. '99.99'.", example: "99.99" },
            suffix: { type: STR, doc: "Shown right after the number, e.g. '%', 'k+'.", example: "%" },
            label: { type: STR, doc: "Caption under the number.", example: "Uptime SLA" }
          }
        }
      },
      charts: {
        type: OBJ, doc: "Analytics charts section — three business graphs rendered with the data-visualization-plugin (line, bars, donut).",
        fields: {
          enabled: { type: BOOL, doc: "Show the analytics section on the page.", example: true },
          heading: { type: STR, doc: "Section heading.", example: "Performance at a glance" },
          description: { type: STR, doc: "Section subheading.", example: "Revenue, pipeline and traffic — the metrics your team cares about most." },
          revenue: {
            type: OBJ, doc: "Monthly revenue line chart.",
            fields: {
              title: { type: STR, doc: "Chart title.", example: "Monthly revenue" },
              labels: { type: FREE, doc: "X-axis labels, e.g. [\"Jan\", \"Feb\", …].", example: ["Jan","Feb","Mar"] },
              series: { type: FREE, doc: "Series as [name, [values…]] pairs, e.g. [[\"This year\",[42,48,45]],…].", example: [["This year",[42,48,45]],["Last year",[30,34,38]]] }
            }
          },
          leads: {
            type: OBJ, doc: "New-leads bar chart.",
            fields: {
              title: { type: STR, doc: "Chart title.", example: "New leads per month" },
              labels: { type: FREE, doc: "X-axis labels.", example: ["Jan","Feb","Mar"] },
              values: { type: FREE, doc: "Bar values, one per label.", example: [120,135,128] }
            }
          },
          channels: {
            type: OBJ, doc: "Traffic-sources donut chart.",
            fields: {
              title: { type: STR, doc: "Chart title.", example: "Traffic sources" },
              values: { type: FREE, doc: "Donut slices as [label, value] pairs.", example: [["Organic search",38],["Paid ads",24]] }
            }
          }
        }
      },
      how: {
        type: ARR, doc: "'How it works' steps (3 recommended).",
        item: {
          type: OBJ, fields: {
            title: { type: STR, example: "Connect" },
            description: { type: STR, example: "Bring your existing tools and data." }
          }
        }
      },
      showcase: {
        type: OBJ, doc: "Showcase section (left column, next to the terminal visual).",
        fields: {
          heading: { type: STR, example: "Built to be dependable" },
          description: { type: STR, example: "Under the hood, everything is engineered for transparency and control." },
          points: { type: ARR, doc: "Bullet points with checkmarks.", item: { type: STR, example: "A single source of truth for your team's workflow" } }
        }
      },
      testimonials: {
        type: ARR, doc: "Customer quotes (3 recommended).",
        item: {
          type: OBJ, fields: {
            quote: { type: STR, example: "The smoothest rollout we've ever done." },
            name: { type: STR, example: "Sarah Chen" },
            role: { type: STR, example: "Head of Operations" },
            company: { type: STR, example: "Acme Corp" }
          }
        }
      },
      cta: {
        type: OBJ, doc: "Final call-to-action band.",
        fields: {
          heading: { type: STR, example: "Ready to take the next step?" },
          description: { type: STR, example: "Set up your workspace today — no credit card required." },
          buttonText: { type: STR, example: "Get started today" },
          buttonUrl: { type: STR, example: "#" }
        }
      },
      faq: {
        type: ARR, doc: "FAQ accordion items.",
        item: {
          type: OBJ, fields: {
            question: { type: STR, example: "How long does it take to get started?" },
            answer: { type: STR, example: "Most teams are up and running within a day." }
          }
        }
      },
      footer: {
        type: OBJ, doc: "Footer link columns.",
        fields: {
          columns: {
            type: ARR, doc: "Link columns (up to 4).",
            item: {
              type: OBJ, fields: {
                heading: { type: STR, example: "Product" },
                links: {
                  type: ARR, item: {
                    type: OBJ, fields: {
                      label: { type: STR, example: "Features" },
                      url: { type: STR, example: "#features" }
                    }
                  }
                }
              }
            }
          }
        }
      },
      admin: {
        type: OBJ, doc: "Editor / admin behavior.",
        fields: {
          showSettingsButton: { type: BOOL, doc: "Show the ⚙ configuration panel.", example: true }
        }
      }
    }
  };

  const HEX_RE = /^#([0-9a-f]{6}|[0-9a-f]{3})$/i;
  const normalizeHex = (v) => {
    if (typeof v !== "string") return null;
    const m = String(v).trim().match(HEX_RE);
    if (!m) return null;
    let h = m[1];
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    return "#" + h.toLowerCase();
  };

  function collectDocLines(schema, path, out) {
    out = out || [];
    const p = path ? path + "." : "";
    if (schema.type === OBJ) {
      for (const key of Object.keys(schema.fields)) collectDocLines(schema.fields[key], p + key, out);
    } else if (schema.type === ARR) {
      out.push(p.slice(0, -1) + "  —  array of objects  —  " + (schema.doc || ""));
    } else {
      let typeName = schema.type === FREE ? "any" : schema.type;
      if (schema.type === HEX) typeName = "hex";
      if (schema.type === ENUM) typeName = schema.values.map((v) => '"' + v + '"').join(" | ");
      out.push(p.slice(0, -1) + "  —  " + typeName + "  —  " + (schema.doc || ""));
    }
    return out;
  }

  function buildExample(schema) {
    schema = schema || SCHEMA;
    if (schema.type === OBJ) {
      const o = {};
      for (const key of Object.keys(schema.fields)) o[key] = buildExample(schema.fields[key]);
      return o;
    }
    if (schema.type === ARR) {
      if (schema.item && schema.item.example != null) return [schema.item.example];
      return [buildExample(schema.item)];
    }
    return schema.example != null ? deepClone(schema.example) : "";
  }

  function buildJsonSchema() {
    const map = (s) => {
      if (s.type === HEX) return { type: "string", pattern: "^#[0-9a-fA-F]{6}$" };
      if (s.type === ENUM) return { type: "string", enum: s.values };
      if (s.type === OBJ) {
        const o = { type: "object", properties: {}, required: Object.keys(s.fields) };
        for (const k of Object.keys(s.fields)) o.properties[k] = map(s.fields[k]);
        return o;
      }
      if (s.type === ARR) {
        const a = { type: "array", items: s.item ? map(s.item) : {} };
        if (s.item && s.item.example != null) a.example = s.item.example;
        return a;
      }
      if (s.type === FREE) return {};
      return { type: s.type };
    };
    const root = map(SCHEMA);
    return {
      $schema: "http://json-schema.org/draft-07/schema#",
      title: "Business Template configuration",
      description: "Full configuration for the Business Template. Partial objects are accepted — missing fields fall back to the template defaults.",
      ...root
    };
  }

  /* ---------- validation ---------- */

  function validateConfig(input) {
    const errors = [], warnings = [];
    const normalized = {};
    const walk = (schema, value, path, target) => {
      if (value == null) return; // missing → keep default
      if (schema.type === FREE) { target[path] = value; return; }
      if (schema.type === OBJ) {
        if (typeof value !== "object" || Array.isArray(value)) { errors.push(path + " must be an object"); return; }
        for (const key of Object.keys(value)) {
          if (!schema.fields[key]) { warnings.push(path + "." + key + " is not a known field and will be ignored"); continue; }
          walk(schema.fields[key], value[key], path + "." + key, target);
        }
        return;
      }
      if (schema.type === ARR) {
        if (!Array.isArray(value)) { errors.push(path + " must be an array"); return; }
        target[path] = value.map((item, i) => {
          const holder = {};
          walk(schema.item, item, path + "[" + i + "]", holder);
          return holder[path + "[" + i + "]"] === undefined ? item : holder[path + "[" + i + "]"];
        });
        return;
      }
      // scalars
      if (schema.type === HEX) {
        const h = normalizeHex(value);
        if (!h) { errors.push(path + " must be a hex color like #2563eb (got: " + JSON.stringify(value) + ")"); return; }
        target[path] = h;
        return;
      }
      if (schema.type === ENUM) {
        if (!schema.values.includes(value)) { errors.push(path + " must be one of " + schema.values.join(", ") + " (got: " + JSON.stringify(value) + ")"); return; }
        target[path] = value; return;
      }
      if (schema.type === NUM) {
        if (typeof value !== "number" || isNaN(value)) { errors.push(path + " must be a number (got: " + JSON.stringify(value) + ")"); return; }
        target[path] = value; return;
      }
      if (schema.type === BOOL) {
        if (typeof value !== "boolean") { errors.push(path + " must be true or false (got: " + JSON.stringify(value) + ")"); return; }
        target[path] = value; return;
      }
      // string
      if (typeof value !== "string") { errors.push(path + " must be a string (got: " + JSON.stringify(value) + ")"); return; }
      target[path] = value;
    };
    walk(SCHEMA, input, "$", normalized);
    return { ok: errors.length === 0, errors, warnings };
  }

  function mergeDeep(base, override) {
    const out = deepClone(base);
    const apply = (b, o) => {
      for (const k of Object.keys(o)) {
        if (o[k] && typeof o[k] === "object" && !Array.isArray(o[k]) && b[k] && typeof b[k] === "object") apply(b[k], o[k]);
        else b[k] = deepClone(o[k]);
      }
      return b;
    };
    return apply(out, override);
  }

  /* ============================ config ============================ */

  let cfg = null;
  let persistedJson = null;

  function defaultConfig() {
    const node = window.root ? root.config : undefined;
    if (!node || typeof node !== "object") {
      toast("Could not read `config` in main.pjs — using example defaults", "error");
      return buildExample();
    }
    // the `config` list in main.pjs — read each field explicitly so the
    // structure is predictable regardless of pjs list-node quirks
    const str = (v, d) => (v === undefined || v === null ? d || "" : String(v));
    const bool = (v, d) => (v === undefined ? d : !!v);
    const num = (v, d) => (v === undefined || v === null ? d : Number(v));
    const seq = (parent, prefix, fields) => {
      const arr = [];
      for (let i = 1; i <= 50; i++) {
        const child = parent[prefix + i];
        if (child === undefined) break;
        const o = {};
        for (const f of fields) o[f] = str(child[f]);
        arr.push(o);
      }
      return arr;
    };
    const flat = (v, d) => {
      if (v === undefined || v === null) return d;
      return Array.isArray(v) && v.length === 1 && Array.isArray(v[0]) ? v[0] : v;
    };
    const chartSeries = (parent) => {
      const arr = [];
      for (let i = 1; i <= 20; i++) {
        const child = parent && parent["s" + i];
        if (child === undefined) break;
        arr.push({
          name: str(child.name, "Series " + i),
          data: flat(child.data, []).map((n) => Number(n))
        });
      }
      return arr.filter((s) => s.data.length);
    };
    const chartPairs = (v) => (Array.isArray(v) ? v : []).map((p) => ({
      label: String(p && p[0]),
      value: Number(p && p[1])
    })).filter((p) => p.label !== "" && isFinite(p.value));

    const B = node.branding || {};
    const T = node.theme || {};
    const C = node.colors || {};
    const P = node.product || {};
    const SC = node.showcase || {};
    const CT = node.cta || {};
    const columns = node.footer && node.footer.columns || {};
    const colNames = [];
    for (let i = 1; i <= 12; i++) { if (columns["col" + i] !== undefined) colNames.push("col" + i); else break; }
    const footerColumns = colNames.map((name) => ({
      heading: str(columns[name].heading),
      links: seq(columns[name].links || {}, "l", ["label", "url"])
    }));

    return {
      schemaVersion: str(node.schemaVersion, "1.0.0"),
      branding: {
        companyName: str(B.companyName),
        companyShortName: str(B.companyShortName),
        companyUrl: str(B.companyUrl),
        logoGlyph: str(B.logoGlyph),
        logoUrl: str(B.logoUrl),
        tagline: str(B.tagline),
        contactEmail: str(B.contactEmail),
        contactPhone: str(B.contactPhone),
        address: str(B.address),
        footerText: str(B.footerText)
      },
      theme: {
        mode: ["light", "dark"].includes(str(T.mode, "light")) ? str(T.mode, "light") : "light",
        accentStyle: ["gradient", "solid"].includes(str(T.accentStyle, "gradient")) ? str(T.accentStyle, "gradient") : "gradient",
        radius: num(T.radius, 16),
        fontSize: clamp(num(T.fontSize, 16), 14, 20),
        fontFamily: str(T.fontFamily, "lato"),
        reduceMotion: bool(T.reduceMotion, false)
      },
      colors: {
        primary: str(C.primary, "#0a58ca"),
        secondary: str(C.secondary, "#6ea8fe"),
        accent: str(C.accent, "#084298"),
        background: str(C.background, "#f8f9fa"),
        surface: str(C.surface, "#ffffff"),
        text: str(C.text, "#212529"),
        textMuted: str(C.textMuted, "#6c757d")
      },
      product: {
        name: str(P.name),
        badge: str(P.badge),
        headline: str(P.headline),
        headlineAccent: str(P.headlineAccent),
        subheadline: str(P.subheadline),
        primaryCta: str(P.primaryCta),
        primaryCtaUrl: str(P.primaryCtaUrl),
        secondaryCta: str(P.secondaryCta),
        secondaryCtaUrl: str(P.secondaryCtaUrl),
        status: str(P.status)
      },
      trustedBy: Array.isArray(node.trustedBy) ? node.trustedBy.map((s) => String(s)) : [],
      features: seq(node.features || {}, "f", ["icon", "title", "description"]),
      stats: seq(node.stats || {}, "s", ["value", "suffix", "label"]).map((s) => ({ ...s, value: String(s.value) })),
      charts: (() => {
        const CH = node.charts || {};
        const R = CH.revenue || {}, L = CH.leads || {}, K = CH.channels || {};
        return {
          enabled: bool(CH.enabled, true),
          heading: str(CH.heading, "Performance at a glance"),
          description: str(CH.description, "Revenue, pipeline and traffic — the metrics your team cares about most."),
          revenue: {
            title: str(R.title, "Monthly revenue"),
            labels: flat(R.labels, []).map((s) => String(s)),
            series: chartSeries(R.series)
          },
          leads: {
            title: str(L.title, "New leads per month"),
            labels: flat(L.labels, []).map((s) => String(s)),
            values: flat(L.values, []).map((n) => Number(n))
          },
          channels: {
            title: str(K.title, "Traffic sources"),
            values: chartPairs(K.values)
          }
        };
      })(),
      how: seq(node.how || {}, "h", ["title", "description"]),
      showcase: {
        heading: str(SC.heading),
        description: str(SC.description),
        points: Array.isArray(SC.points) ? SC.points.map((s) => String(s)) : []
      },
      testimonials: seq(node.testimonials || {}, "t", ["quote", "name", "role", "company"]),
      cta: {
        heading: str(CT.heading),
        description: str(CT.description),
        buttonText: str(CT.buttonText),
        buttonUrl: str(CT.buttonUrl)
      },
      faq: seq(node.faq || {}, "q", ["question", "answer"]),
      footer: { columns: footerColumns },
      admin: { showSettingsButton: bool(node.admin && node.admin.showSettingsButton, true) }
    };
  }

  function detectPreset() {
    lastPresetName = null;
    for (const p of PRESETS) {
      if (p.colors.primary === cfg.colors.primary &&
          p.colors.secondary === cfg.colors.secondary &&
          p.colors.accent === cfg.colors.accent &&
          p.colors.background === cfg.colors.background &&
          p.colors.surface === cfg.colors.surface &&
          p.colors.text === cfg.colors.text &&
          p.colors.textMuted === cfg.colors.textMuted) { lastPresetName = p.name; break; }
    }
  }

  function loadConfig() {
    persistedJson = localStorage.getItem(LS_KEY);
    let base = defaultConfig();
    if (persistedJson) {
      try {
        const res = validateConfig(JSON.parse(persistedJson));
        if (res.ok) {
          const kept = {};
          Object.keys(JSON.parse(persistedJson)).forEach((k) => { kept[k] = JSON.parse(persistedJson)[k]; });
          base = mergeDeep(base, kept);
          if (res.warnings.length) console.warn("Saved config warnings:", res.warnings);
        } else {
          toast("Saved configuration is invalid — falling back to defaults", "error");
        }
      } catch (e) {
        toast("Saved configuration could not be parsed — falling back to defaults", "error");
      }
    }
    cfg = base;
    detectPreset();
  }

  function persist() {
    localStorage.setItem(LS_KEY, JSON.stringify(cfg));
    persistedJson = localStorage.getItem(LS_KEY);
    markDirty();
    toast("Configuration saved to this browser", "success");
  }

  function resetConfig() {
    localStorage.removeItem(LS_KEY);
    persistedJson = null;
    cfg = defaultConfig();
    detectPreset();
    applyAll();
    rebuildSettingsForms();
    markDirty();
    toast("Reset to template defaults");
  }

  function resetStyle() {
    const d = defaultConfig();
    cfg.colors = d.colors;
    cfg.theme = d.theme;
    detectPreset();
    applyThemeColors();
    loadFontPair();
    buildColorForms();
    buildThemeForm();
    buildPresets();
    const t = $("#themeToggleIcon");
    if (t) t.innerHTML = icon(cfg.theme.mode === "dark" ? "spark" : "star", 18);
    const tb = $("#themeToggle");
    if (tb) tb.title = cfg.theme.mode === "dark" ? "Switch to light mode" : "Switch to dark mode";
    markDirty();
    toast("Style reset to defaults");
  }

  function isDirty() { return persistedJson !== JSON.stringify(cfg); }
  function markDirty() {
    const hint = $("#dirtyHint");
    if (hint) hint.style.visibility = isDirty() ? "visible" : "hidden";
  }

  /* ============================ apply config ============================ */

  function applyThemeColors() {
    const c = cfg.colors, t = cfg.theme;
    const isDark = t.mode === "dark";
    const hasPreset = PRESETS.some((pr) => pr.name === lastPresetName);
    const bg = isDark ? (hasPreset ? c.background : "#141414") : c.background;
    const surface = isDark ? (hasPreset ? c.surface : "#1d1d22") : c.surface;
    const text = isDark ? (hasPreset ? c.text : "#f1f5f9") : c.text;
    const muted = isDark ? (hasPreset ? c.textMuted : "#94a3b8") : c.textMuted;
    const r = document.documentElement.style;
    r.setProperty("--primary", c.primary);
    r.setProperty("--secondary", c.secondary);
    r.setProperty("--accent", c.accent);
    r.setProperty("--radius", clamp(Number(t.radius) || 16, 0, 32) + "px");
    r.setProperty("--bg", bg);
    r.setProperty("--surface", surface);
    r.setProperty("--surface-2", isDark ? (hasPreset ? mix(c.surface, c.background, 0.5) : "#232329") : mix(c.surface, c.background, 0.55));
    r.setProperty("--border", isDark ? "rgba(148,163,184,.2)" : "rgba(15,23,42,.09)");
    r.setProperty("--text", text);
    r.setProperty("--text-muted", muted);
    r.setProperty("--muted", muted);
    r.setProperty("--terminal-bg", isDark ? mix(c.background, "#000000", 0.4) : "#0d1117");
    r.setProperty("--primary-strong", isDark ? lighten(c.primary, 0.14) : darken(c.primary, 0.12));
    r.setProperty("--primary-soft", mix(c.primary, bg, isDark ? 0.8 : 0.9));
    r.setProperty("--grad", t.accentStyle === "solid" ? "linear-gradient(135deg," + c.primary + "," + c.primary + ")" : "linear-gradient(135deg," + c.primary + "," + c.secondary + ")");
    r.setProperty("--bg-glass", hexToRgba(bg, 0.82));
    r.setProperty("--bg-glass-2", hexToRgba(bg, 0.9));
    r.setProperty("--primary-glow", hexToRgba(c.primary, 0.12));
    r.setProperty("--secondary-glow", hexToRgba(c.secondary, 0.1));
    r.setProperty("--badge-border", hexToRgba(c.primary, 0.28));
    r.setProperty("--primary-border-hover", hexToRgba(c.primary, 0.3));
    r.setProperty("--primary-border-open", hexToRgba(c.primary, 0.35));
    r.setProperty("--ring", hexToRgba(c.primary, 0.45));
    r.setProperty("--ring-soft", hexToRgba(c.primary, 0.18));
    const scale = clamp(Number(t.fontSize) || 16, 14, 20) / 16;
    r.setProperty("--text-scale", scale.toFixed(4));
    const F = fontInfo(String(t.fontFamily));
    r.setProperty("--font-display", fontStack(F.display, F.serif));
    r.setProperty("--font-body", fontStack(F.body, false));
    document.documentElement.classList.toggle("reduce-motion", !!t.reduceMotion);
    document.documentElement.dataset.theme = isDark ? "dark" : "light";
    document.documentElement.style.colorScheme = isDark ? "dark" : "light";
  
    if (cfg && $("#chartsGrid") && $("#chartsGrid").innerHTML !== "") renderCharts();}

  function applyText() {
    $$("[data-field]").forEach((el) => {
      const v = getPath(cfg, el.dataset.field);
      if (v != null) el.textContent = v;
    });
    $$("[data-href]").forEach((el) => { const v = getPath(cfg, el.dataset.href); if (v) el.setAttribute("href", v); });

    // hero headline = normal text + gradient-accent word(s)
    const lead = $("#heroTitle"), acc = $("#heroAccent");
    if (lead) {
      const head = String(cfg.product.headline || "");
      const accent = String(cfg.product.headlineAccent || "");
      if (accent && head.includes(accent)) {
        const i = head.lastIndexOf(accent);
        lead.innerHTML = esc(head.slice(0, i)) + '<span class="grad-text">' + esc(accent) + "</span>" + esc(head.slice(i + accent.length));
      } else {
        lead.innerHTML = esc(head);
      }
    }
    const sub = $("#heroSubhead");
    if (sub) sub.textContent = cfg.product.subheadline || "";
    const status = $("#heroStatus");
    if (status) status.style.display = cfg.product.status ? "flex" : "none";

    const ctaH = $("#ctaHeading");
    if (ctaH) ctaH.textContent = cfg.cta.heading || "";
    const ctaD = $("#ctaDesc");
    if (ctaD) ctaD.textContent = cfg.cta.description || "";

    const yearEl = $("#yearEl");
    if (yearEl) {
      const t = String(cfg.branding.footerText || "")
        .replace("{year}", new Date().getFullYear())
        .replace("{companyName}", cfg.branding.companyName);
      yearEl.textContent = t;
    }
    const fab = $("#settingsFab");
    if (fab) fab.hidden = !getPath(cfg, "admin.showSettingsButton");
  }

  function renderAll() {
    renderTrusted(); renderFeatures(); renderStats(); renderCharts(); renderSteps(); renderShowcase(); renderTestimonials(); renderFaq(); renderFooter();
  }

  function renderTrusted() {
    const list = $("#trustList");
    list.innerHTML = (cfg.trustedBy || []).map((n) => '<li class="trust-item">' + esc(n) + "</li>").join("");
  }

  function renderFeatures() {
    const grid = $("#featuresGrid");
    if (!grid) return;
    grid.innerHTML = (cfg.features || []).map((f) =>
      '<article class="feature-card"><div class="feature-icon">' + icon(f.icon) + "</div><h3>" + esc(f.title) + "</h3><p>" + esc(f.description) + "</p></article>"
    ).join("");
  }

  function renderStats() {
    const band = $("#statsBand");
    const stats = cfg.stats || [];
    const kpi = stats.slice(0, 4);
    while (kpi.length < 4) kpi.push({ value: "0", suffix: "", label: "" });
    band.innerHTML = kpi.map((s) =>
      '<div class="stat"><div class="stat-value"><span data-count="' + esc(String(s.value)) + '">' + esc(s.value) + "</span>" + esc(s.suffix || "") + '</div><div class="stat-label">' + esc(s.label) + "</div></div>"
    ).join("");
    observeCountUps();
  }

  function renderCharts() {
    const sec = $("#analytics");
    const grid = $("#chartsGrid");
    const hasPlugin = !!(window.root && root.charts && typeof root.charts.line === "function");
    const ch = cfg.charts || {};
    const enabled = ch.enabled !== false;
    if (sec) sec.style.display = enabled && hasPlugin ? "" : "none";
    if (!grid) return;
    grid.innerHTML = "";
    if (!enabled) return;
    if (!hasPlugin) {
      grid.innerHTML = '<p class="hint">The data-visualization-plugin did not load — add <code>charts = {import:data-visualization-plugin}</code> to main.pjs.</p>';
      return;
    }
    const c = cfg.colors || {};
    const brand = [c.primary, c.secondary, c.accent, mix(c.primary, c.secondary, 0.5), mix(c.accent, c.secondary, 0.5)].filter((x) => x);
    const chartOpts = { theme: null, height: 300, colors: brand };
    const safe = (f) => {
      try {
        const s = f();
        return s && String(s).indexOf("<svg") >= 0 ? s : '<p class="chart-err">' + esc(String(s)) + "</p>";
      } catch (e) {
        return '<p class="chart-err">' + esc(String((e && e.message) || e)) + "</p>";
      }
    };
    const card = (title, svg, wide) => {
      const el = document.createElement("div");
      el.className = "chart-card" + (wide ? " chart-wide" : "");
      el.innerHTML = '<div class="chart-title">' + esc(title) + "</div>";
      const body = document.createElement("div");
      body.className = "chart-body";
      body.innerHTML = svg;
      el.appendChild(body);
      return el;
    };

    const rev = ch.revenue || {};
    if (rev.series && rev.series.length && rev.series[0].data && rev.series[0].data.length) {
      const svg = safe(() => root.charts.line({ labels: rev.labels, series: rev.series }, Object.assign({ title: rev.title }, chartOpts)));
      grid.appendChild(card(rev.title || "Revenue", svg, true));
    }
    const leads = ch.leads || {};
    if (leads.values && leads.values.length) {
      const data = (leads.labels || []).map((l, i) => ({ label: l, value: leads.values[i] }));
      const svg = safe(() => root.charts.bar(data, Object.assign({ title: leads.title, labels: false }, chartOpts)));
      grid.appendChild(card(leads.title || "Leads", svg));
    }
    const chn = ch.channels || {};
    if (chn.values && chn.values.length) {
      const svg = safe(() => root.charts.donut(chn.values, Object.assign({ title: chn.title }, chartOpts)));
      grid.appendChild(card(chn.title || "Channels", svg));
    }
    if (!grid.children.length) {
      grid.innerHTML = '<p class="hint">No chart data configured — add a <code>charts</code> section to <code>config</code> in main.pjs.</p>';
    }
  }

  function renderSteps() {
    const wrap = $("#stepsWrap");
    wrap.innerHTML = (cfg.how || []).map((s, i) =>
      '<div class="step"><div class="step-num">' + (i + 1) + "</div><h3>" + esc(s.title) + "</h3><p>" + esc(s.description) + "</p></div>"
    ).join("");
  }

  function renderShowcase() {
    const sc = cfg.showcase || {};
    $("#showcaseHeading").textContent = sc.heading || "";
    $("#showcaseDesc").textContent = sc.description || "";
    $("#showcaseList").innerHTML = (sc.points || []).map((p) => '<li><span class="check">' + icon("check", 13) + "</span><span>" + esc(p) + "</span></li>").join("");
  }

  function renderTestimonials() {
    const grid = $("#testiGrid");
    grid.innerHTML = (cfg.testimonials || []).map((t) =>
      '<article class="testi-card"><div class="testi-stars" aria-label="5 out of 5 stars">★★★★★</div><p class="testi-quote">' + esc(t.quote) +
      '</p><div class="testi-person"><div class="avatar">' + esc((t.name || "?")[0].toUpperCase()) + '</div><div><div class="testi-name">' + esc(t.name) +
      '</div><div class="testi-role">' + esc(t.role) + " · " + esc(t.company) + "</div></div></div></article>"
    ).join("");
  }

  function renderFaq() {
    const wrap = $("#faqList");
    wrap.innerHTML = (cfg.faq || []).map((f, i) =>
      '<details class="faq-item" id="faq-' + i + '"><summary class="faq-q">' + esc(f.question) + '<span class="faq-chev">' +
      icon("chevron", 18) + "</span></summary><div class=\"faq-a\">" + esc(f.answer) + "</div></details>"
    ).join("");
  }

  function renderFooter() {
    const b = cfg.branding;
    const glyph = (b.logoGlyph || (b.companyName || "?")[0]).slice(0, 1).toUpperCase();
    renderLogoMark($("#footerLogoMark"), b.logoUrl, glyph);
    $("#footerLogoText").textContent = b.companyName;
    $("#footerTagline").textContent = b.tagline || "";
    $("#footerEmail").textContent = b.contactEmail; $("#footerEmail").href = "mailto:" + b.contactEmail;
    $("#footerPhone").textContent = b.contactPhone; $("#footerPhone").href = "tel:" + String(b.contactPhone).replace(/[^+\d]/g, "");
    $("#footerAddress").textContent = b.address || "";
    const cols = $("#footerCols");
    cols.innerHTML = (cfg.footer && cfg.footer.columns || []).map((col) =>
      '<div class="footer-col"><h4>' + esc(col.heading) + "</h4>" +
      (col.links || []).map((l) => '<a href="' + esc(l.url) + '">' + esc(l.label) + "</a>").join("") + "</div>"
    ).join("");
  }

  function applyAll() {
    applyThemeColors();
    applyText();
    renderAll();
  }

  /* ---------- header logo ---------- */
  function renderLogoMark(el, url, glyph) {
    if (!el) return;
    if (url) {
      el.classList.add("has-img");
      el.innerHTML = '<img class="logo-img" src="' + esc(url) + '" alt="">';
    } else {
      el.classList.remove("has-img");
      el.textContent = glyph;
    }
  }

  function updateHeaderLogo() {
    const b = cfg.branding;
    const glyph = (b.logoGlyph || (b.companyName || "?")[0]).slice(0, 1).toUpperCase();
    renderLogoMark($("#logoMark"), b.logoUrl, glyph);
    renderLogoMark($("#footerLogoMark"), b.logoUrl, glyph);
    $("#logoText").textContent = b.companyName;
    $("#footerLogoText").textContent = b.companyName;
    $("#headerLogo").href = b.companyUrl || "#";
    $("#footerLogo").href = b.companyUrl || "#";
    const navBrand = $("#navBrand");
    if (navBrand) navBrand.href = b.companyUrl || "#";
  }

  /* ============================ count-up stats ============================ */

  let countUpObs = null;
  function observeCountUps() {
    if (countUpObs) countUpObs.disconnect();
    countUpObs = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        countUpObs.unobserve(e.target);
        animateCount(e.target);
      });
    }, { threshold: 0.5 });
    $$("#statsBand [data-count]").forEach((el) => countUpObs.observe(el));
  }

  function animateCount(el) {
    const target = parseFloat(el.dataset.count);
    if (isNaN(target)) return;
    const isFloat = /\./.test(el.dataset.count);
    const dur = 1100, start = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      const val = target * eased;
      el.textContent = isFloat ? val.toFixed(2) : Math.round(val).toString();
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /* ============================ theme toggle ============================ */

  function setupThemeToggle() {
    const update = () => {
      $("#themeToggleIcon").innerHTML = icon(cfg.theme.mode === "dark" ? "spark" : "star", 18);
      $("#themeToggle").title = cfg.theme.mode === "dark" ? "Switch to light mode" : "Switch to dark mode";
    };
    $("#themeToggle").addEventListener("click", () => {
      setThemeMode(cfg.theme.mode === "dark" ? "light" : "dark");
    });
    update();
  }

  /* ============================ settings panel ============================ */

  let activeTab = "brand";

  function openModal(id) {
    $(id).classList.add("open");
    document.body.style.overflow = "hidden";
  }
  function closeModal(id) {
    $(id).classList.remove("open");
    document.body.style.overflow = "";
  }

  function setupSettingsModal() {
    $("#settingsFab").addEventListener("click", () => {
      openModal("#settingsModal");
      rebuildSettingsForms();
      syncIoArea();
      markDirty();
    });
    $("#settingsCloseBtn").addEventListener("click", () => closeModal("#settingsModal"));
    $("#settingsModal").addEventListener("click", (e) => { if (e.target === $("#settingsModal")) closeModal("#settingsModal"); });
    $$(".tab").forEach((tab) => tab.addEventListener("click", () => setTab(tab.dataset.tab)));
    $("#saveConfigBtn").addEventListener("click", persist);
    $("#resetStyleBtn").addEventListener("click", resetStyle);
    const shareBtn = $("#shareBtn");
    if (shareBtn) shareBtn.addEventListener("click", copyShareLink);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeModal("#settingsModal"); closeModal("#scannerModal"); } });
  }

  function setTab(name) {
    activeTab = name;
    $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
    $$(".tab-panel").forEach((p) => p.classList.toggle("active", p.dataset.panel === name));
    if (name === "io") {
      syncIoArea();
      buildFormatGuide();
    }
    if (name === "content") rebuildContentForms();
  }

  function rebuildSettingsForms() {
    buildBrandForm();
    buildColorForms();
    buildThemeForm();
    buildPresets();
    rebuildContentForms();
    updateHeaderLogo();
  }

  /* ---------- Branding tab ---------- */

  const BRAND_FIELDS = [
    { key: "branding.companyName", label: "Company name", hint: "Shown in the header, footer and copyright." },
    { key: "branding.companyShortName", label: "Company short name", hint: "Optional compact variant for narrow screens." },
    { key: "branding.companyUrl", label: "Company website URL", type: "url", hint: "Links the logo and footer." },
    { key: "branding.logoGlyph", label: "Logo letter / monogram", hint: "Single character drawn in the logo mark (used when no logo image is set)." },
    { key: "branding.logoUrl", label: "Logo image", type: "logo" },
    { key: "branding.tagline", label: "Tagline", type: "text", cls: "full", hint: "Used in the footer." },
    { key: "branding.contactEmail", label: "Contact email", type: "email" },
    { key: "branding.contactPhone", label: "Contact phone", type: "tel" },
    { key: "branding.address", label: "Address", cls: "full" },
    { key: "branding.footerText", label: "Footer bottom text", cls: "full", hint: "{year} and {companyName} are auto-filled." }
  ];

  function renderLogoPreview(el) {
    const url = cfg.branding.logoUrl;
    if (url) {
      el.classList.add("has-img");
      el.innerHTML = '<img class="logo-img" src="' + esc(url) + '" alt="">';
    } else {
      el.classList.remove("has-img");
      el.textContent = (cfg.branding.logoGlyph || (cfg.branding.companyName || "?")[0]).slice(0, 1).toUpperCase();
    }
  }

  function buildBrandForm() {
    const wrap = $("#brandFields");
    wrap.innerHTML = "";
    for (const f of BRAND_FIELDS) {
      const field = document.createElement("div");
      field.className = "field" + (f.cls ? " " + f.cls : "");
      if (f.type === "logo") { field.classList.add("full"); }
      const label = document.createElement("label");
      label.htmlFor = "f_" + f.key.replace(/\./g, "_");
      label.textContent = f.label;
      field.appendChild(label);
      if (f.type === "logo") {
        const row = document.createElement("div");
        row.className = "logo-upload-row";
        const preview = document.createElement("span");
        preview.className = "logo-upload-preview";
        renderLogoPreview(preview);
        const controls = document.createElement("div");
        controls.className = "logo-upload-controls";
        const fileLab = document.createElement("label");
        fileLab.className = "btn btn-ghost btn-sm";
        fileLab.textContent = "Upload image…";
        const file = document.createElement("input");
        file.type = "file"; file.accept = "image/*"; file.style.display = "none";
        fileLab.appendChild(file);
        const status = document.createElement("span");
        status.className = "logo-upload-status";
        const urlInput = document.createElement("input");
        urlInput.type = "url"; urlInput.id = "f_branding_logoUrl";
        urlInput.placeholder = "…or paste an image URL";
        urlInput.value = cfg.branding.logoUrl || "";
        const removeBtn = document.createElement("button");
        removeBtn.type = "button"; removeBtn.className = "btn btn-ghost btn-sm";
        removeBtn.textContent = "Remove";
        removeBtn.style.display = cfg.branding.logoUrl ? "" : "none";
        let uploading = false;
        file.addEventListener("change", async () => {
          const f = file.files && file.files[0];
          if (!f) return;
          if (!/^image\//.test(f.type)) { toast("Please choose an image file", "error"); file.value = ""; return; }
          if (f.size > 5 * 1024 * 1024) { toast("Logo is too large — 5 MB max", "error"); file.value = ""; return; }
          if (!(window.root && root.uploadPlugin)) { toast("The upload plugin is not loaded — check {import:upload-plugin} in main.pjs", "error"); file.value = ""; return; }
          if (uploading) return;
          uploading = true;
          status.textContent = "Uploading…";
          try {
            const res = await root.uploadPlugin(f);
            if (res && res.error) {
              toast("Upload failed: " + res.error, "error");
              status.textContent = "";
            } else {
              cfg.branding.logoUrl = res.url;
              renderLogoPreview(preview);
              updateHeaderLogo();
              markDirty();
              status.textContent = "Uploaded — saved in your configuration";
              urlInput.value = res.url;
              removeBtn.style.display = "";
              toast("Logo uploaded", "success");
            }
          } catch (e) {
            toast("Upload failed", "error");
            status.textContent = "";
          }
          uploading = false;
          file.value = "";
        });
        urlInput.addEventListener("change", () => {
          const v = urlInput.value.trim();
          if (v && !/^https?:\/\//i.test(v)) { toast("Logo URL must start with http:// or https://", "error"); return; }
          cfg.branding.logoUrl = v;
          renderLogoPreview(preview);
          updateHeaderLogo();
          removeBtn.style.display = v ? "" : "none";
          markDirty();
        });
        removeBtn.addEventListener("click", () => {
          cfg.branding.logoUrl = "";
          urlInput.value = "";
          renderLogoPreview(preview);
          updateHeaderLogo();
          removeBtn.style.display = "none";
          markDirty();
        });
        controls.appendChild(fileLab);
        controls.appendChild(urlInput);
        controls.appendChild(status);
        const btnRow = document.createElement("div");
        btnRow.className = "logo-upload-actions";
        btnRow.appendChild(removeBtn);
        controls.appendChild(btnRow);
        row.appendChild(preview);
        row.appendChild(controls);
        field.appendChild(row);
        const h = document.createElement("div");
        h.className = "hint";
        h.textContent = "Square PNG or JPG, up to 5 MB. Uploaded through the Perchance file host — the returned URL is stored in your configuration and exported with it.";
        field.appendChild(h);
        wrap.appendChild(field);
        continue;
      }
      const input = document.createElement("input");
      input.type = f.type || "text";
      input.id = "f_" + f.key.replace(/\./g, "_");
      input.value = getPath(cfg, f.key) || "";
      input.addEventListener("input", () => { setPath(cfg, f.key, input.value); applyText(); updateHeaderLogo(); markDirty(); });
      field.appendChild(input);
      if (f.hint) { const h = document.createElement("div"); h.className = "hint"; h.textContent = f.hint; field.appendChild(h); }
      wrap.appendChild(field);
    }
  }

  /* ---------- Colors tab ---------- */

  const COLOR_FIELDS = [
    { key: "primary", name: "Primary", desc: "Buttons, links, highlights" },
    { key: "secondary", name: "Secondary", desc: "Gradients, charts" },
    { key: "accent", name: "Accent", desc: "Stars, badges, details" },
    { key: "background", name: "Background", desc: "Page background" },
    { key: "surface", name: "Surface", desc: "Cards & sections" },
    { key: "text", name: "Text", desc: "Main text" },
    { key: "textMuted", name: "Muted text", desc: "Secondary text" }
  ];

  function buildColorForms() {
    const wrap = $("#colorRows");
    wrap.innerHTML = "";
    for (const c of COLOR_FIELDS) {
      const row = document.createElement("div");
      row.className = "color-row";
      const picker = document.createElement("input");
      picker.type = "color";
      picker.value = cfg.colors[c.key];
      picker.addEventListener("input", () => { lastPresetName = null; cfg.colors[c.key] = picker.value; hexIn.value = picker.value; applyThemeColors(); markDirty(); });
      const name = document.createElement("span");
      name.className = "cname";
      name.textContent = c.name;
      const hexIn = document.createElement("input");
      hexIn.className = "hex-input";
      hexIn.value = cfg.colors[c.key];
      hexIn.spellcheck = false;
      hexIn.addEventListener("input", () => {
        const h = normalizeHex(hexIn.value);
        hexIn.classList.toggle("invalid", !h);
        if (h) { lastPresetName = null; cfg.colors[c.key] = h; picker.value = h; applyThemeColors(); markDirty(); }
      });
      hexIn.addEventListener("blur", () => { hexIn.value = cfg.colors[c.key]; hexIn.classList.remove("invalid"); });
      const desc = document.createElement("span");
      desc.className = "cdesc";
      desc.textContent = c.desc;
      row.appendChild(picker); row.appendChild(hexIn); row.appendChild(name); row.appendChild(desc);
      wrap.appendChild(row);
    }
  }

  function buildThemeForm() {
    const wrap = $("#themeFields");
    wrap.innerHTML = "";
    // mode
    const modeF = document.createElement("div");
    modeF.className = "field";
    const modeL = document.createElement("label"); modeL.textContent = "Theme mode";
    const group = document.createElement("div"); group.className = "radio-group";
    for (const m of ["light", "dark"]) {
      const lab = document.createElement("label");
      const radio = document.createElement("input");
      radio.type = "radio"; radio.name = "themeMode"; radio.value = m;
      radio.checked = cfg.theme.mode === m;
      radio.addEventListener("change", () => { if (radio.checked) { setThemeMode(m); } });
      lab.appendChild(radio); lab.appendChild(document.createTextNode(m === "light" ? "Light" : "Dark"));
      group.appendChild(lab);
    }
    modeF.appendChild(modeL); modeF.appendChild(group); wrap.appendChild(modeF);
    // accent style
    const accF = document.createElement("div");
    accF.className = "field";
    const accL = document.createElement("label"); accL.textContent = "Accent treatment";
    const sel = document.createElement("select");
    for (const s of ["gradient", "solid"]) {
      const opt = document.createElement("option"); opt.value = s; opt.textContent = s[0].toUpperCase() + s.slice(1);
      sel.appendChild(opt);
    }
    sel.value = cfg.theme.accentStyle;
    sel.addEventListener("change", () => { cfg.theme.accentStyle = sel.value; applyThemeColors(); markDirty(); });
    accF.appendChild(accL); accF.appendChild(sel); wrap.appendChild(accF);
    // radius
    const radF = document.createElement("div");
    radF.className = "field";
    const radL = document.createElement("label"); radL.textContent = "Corner radius: " + cfg.theme.radius + "px";
    const radRow = document.createElement("div"); radRow.className = "range-row";
    const range = document.createElement("input");
    range.type = "range"; range.min = 0; range.max = 32; range.value = cfg.theme.radius;
    range.addEventListener("input", () => { cfg.theme.radius = Number(range.value); radL.textContent = "Corner radius: " + range.value + "px"; applyThemeColors(); markDirty(); });
    radRow.appendChild(range); radF.appendChild(radL); radF.appendChild(radRow); wrap.appendChild(radF);
    // base text size
    const sizeF = document.createElement("div");
    sizeF.className = "field";
    const sizeL = document.createElement("label"); sizeL.textContent = "Text size";
    const sizeRow = document.createElement("div"); sizeRow.className = "radio-group";
    for (const [label, px] of [["Small", 15], ["Medium", 16], ["Large", 18]]) {
      const lab = document.createElement("label");
      const radio = document.createElement("input");
      radio.type = "radio"; radio.name = "themeSize"; radio.value = String(px);
      radio.checked = Number(cfg.theme.fontSize) === px;
      radio.addEventListener("change", () => { if (radio.checked) { cfg.theme.fontSize = px; applyThemeColors(); markDirty(); } });
      lab.appendChild(radio); lab.appendChild(document.createTextNode(label));
      sizeRow.appendChild(lab);
    }
    sizeF.appendChild(sizeL); sizeF.appendChild(sizeRow); wrap.appendChild(sizeF);
    // font pairing
    const fontF = document.createElement("div");
    fontF.className = "field";
    const fontL = document.createElement("label"); fontL.textContent = "Font pairing";
    const fontSel = document.createElement("select");
    for (const f of FONTS) {
      const opt = document.createElement("option");
      opt.value = f.id; opt.textContent = f.name + " — " + f.desc;
      fontSel.appendChild(opt);
    }
    fontSel.value = fontInfo(String(cfg.theme.fontFamily)).id;
    fontSel.addEventListener("change", () => { cfg.theme.fontFamily = fontSel.value; applyThemeColors(); loadFontPair(); markDirty(); });
    fontF.appendChild(fontL); fontF.appendChild(fontSel); wrap.appendChild(fontF);
    // reduce motion
    const motF = document.createElement("div");
    motF.className = "field";
    const motL = document.createElement("label"); motL.textContent = "Reduce motion";
    const motRow = document.createElement("div"); motRow.className = "radio-group";
    const motLab = document.createElement("label");
    const motBox = document.createElement("input");
    motBox.type = "checkbox"; motBox.checked = !!cfg.theme.reduceMotion;
    motBox.addEventListener("change", () => { cfg.theme.reduceMotion = motBox.checked; applyThemeColors(); markDirty(); });
    motLab.appendChild(motBox); motLab.appendChild(document.createTextNode("Disable animations and transitions"));
    motRow.appendChild(motLab); motF.appendChild(motL); motF.appendChild(motRow); wrap.appendChild(motF);
  }

  // Business-focused themes, each with a light palette and a matching dark variant.
  // The first entry is the generator's default brand look. Applying a theme sets
  // the theme mode to the chosen variant; toggling mode afterwards keeps the
  // matching dark/light palette.
  let lastPresetName = null;
  const PRESETS = [
    { name: "Trust Blue",
      colors: { primary: "#0a58ca", secondary: "#6ea8fe", accent: "#084298", background: "#f8f9fa", surface: "#ffffff", text: "#212529", textMuted: "#6c757d" },
      dark:   { primary: "#6ea8fe", secondary: "#4f8ef7", accent: "#8bb5fe", background: "#121212", surface: "#1d1d1f", text: "#e9ecef", textMuted: "#adb5bd" } },
    { name: "Tech Indigo",
      colors: { primary: "#4f46e5", secondary: "#818cf8", accent: "#4338ca", background: "#f9fafb", surface: "#ffffff", text: "#111827", textMuted: "#6b7280" },
      dark:   { primary: "#818cf8", secondary: "#6366f1", accent: "#a5b4fc", background: "#0b0f19", surface: "#141a2a", text: "#f3f4f6", textMuted: "#94a3b8" } },
    { name: "Executive Slate",
      colors: { primary: "#0f172a", secondary: "#334155", accent: "#1e293b", background: "#ffffff", surface: "#f8fafc", text: "#334155", textMuted: "#64748b" },
      dark:   { primary: "#94a3b8", secondary: "#64748b", accent: "#cbd5e1", background: "#0f172a", surface: "#1e293b", text: "#f8fafc", textMuted: "#94a3b8" } },
    { name: "Growth Green",
      colors: { primary: "#15803d", secondary: "#16a34a", accent: "#166534", background: "#fafafa", surface: "#ffffff", text: "#1c1917", textMuted: "#78716c" },
      dark:   { primary: "#4ade80", secondary: "#22c55e", accent: "#86efac", background: "#141414", surface: "#1e1e1e", text: "#f5f5f4", textMuted: "#a8a29e" } },
    { name: "Warm Agency",
      colors: { primary: "#ea580c", secondary: "#f97316", accent: "#c2410c", background: "#fffdf7", surface: "#ffffff", text: "#27272a", textMuted: "#71717a" },
      dark:   { primary: "#f97316", secondary: "#fb923c", accent: "#fdba74", background: "#18181b", surface: "#232327", text: "#fafafa", textMuted: "#a1a1aa" } },
    { name: "Royal Burgundy",
      colors: { primary: "#9f1239", secondary: "#7c2d12", accent: "#b45309", background: "#ffffff", surface: "#fdf2f6", text: "#1c1917", textMuted: "#6b5b5b" },
      dark:   { primary: "#fb7185", secondary: "#d97706", accent: "#fbbf24", background: "#180a10", surface: "#241019", text: "#fff1f2", textMuted: "#c4a5ac" } }
  ];

  // Business font pairings (Google Fonts). `url` is the css2 query that loads
  // exactly the weights the template uses — weights a family does not provide
  // are skipped so the request stays valid. `serif` swaps the display fallback.
  const FONTS = [
    { id: "lato", name: "Lato", desc: "Clean & friendly", display: "Lato", body: "Lato", serif: false, url: "Lato:wght@400;700;900" },
    { id: "inter", name: "Inter", desc: "Modern SaaS standard", display: "Inter", body: "Inter", serif: false, url: "Inter:wght@400;600;700;900" },
    { id: "roboto", name: "Roboto", desc: "Professional & classic", display: "Roboto", body: "Roboto", serif: false, url: "Roboto:wght@400;500;700;900" },
    { id: "open-sans", name: "Open Sans", desc: "Warm & highly readable", display: "Open Sans", body: "Open Sans", serif: false, url: "Open+Sans:wght@400;600;700;800" },
    { id: "source-sans", name: "Source Sans 3", desc: "Open & approachable", display: "Source Sans 3", body: "Source Sans 3", serif: false, url: "Source+Sans+3:wght@400;600;700;900" },
    { id: "ibm-plex", name: "IBM Plex Sans", desc: "Enterprise & corporate", display: "IBM Plex Sans", body: "IBM Plex Sans", serif: false, url: "IBM+Plex+Sans:wght@400;600;700" },
    { id: "dm-sans", name: "DM Sans", desc: "Contemporary geometric", display: "DM Sans", body: "DM Sans", serif: false, url: "DM+Sans:wght@400;600;700;900" },
    { id: "manrope", name: "Manrope", desc: "Modern & techy", display: "Manrope", body: "Manrope", serif: false, url: "Manrope:wght@400;600;700;800" },
    { id: "montserrat-lato", name: "Montserrat + Lato", desc: "Bold headlines, clean body", display: "Montserrat", body: "Lato", serif: false, url: "Montserrat:wght@400;600;700;900&family=Lato:wght@400;700;900" },
    { id: "playfair-lato", name: "Playfair Display + Lato", desc: "Elegant, high-end", display: "Playfair Display", body: "Lato", serif: true, url: "Playfair+Display:wght@400;600;700;900&family=Lato:wght@400;700;900" },
    { id: "merriweather-inter", name: "Merriweather + Inter", desc: "Editorial & trustworthy", display: "Merriweather", body: "Inter", serif: true, url: "Merriweather:wght@400;700;900&family=Inter:wght@400;600;700;900" }
  ];
  const fontInfo = (id) => FONTS.find((f) => f.id === id) || FONTS[0];
  const fontStack = (name, serif) => '"' + name + '",' + (serif ? ' Georgia, "Times New Roman", serif' : " var(--font-fallback)");
  let fontLinkEl = null;
  function loadFontPair() {
    const F = fontInfo(String(cfg && cfg.theme ? cfg.theme.fontFamily : "lato"));
    if (fontLinkEl) { fontLinkEl.remove(); fontLinkEl = null; }
    fontLinkEl = document.createElement("link");
    fontLinkEl.rel = "stylesheet";
    fontLinkEl.href = "https://fonts.googleapis.com/css2?family=" + F.url + "&display=swap";
    document.head.appendChild(fontLinkEl);
  }

  function buildPresets() {
    const wrap = $("#presetGrid");
    wrap.innerHTML = "";
    for (const p of PRESETS) {
      const card = document.createElement("div");
      card.className = "preset";
      const name = document.createElement("span");
      name.className = "preset-name";
      name.textContent = p.name;
      card.appendChild(name);
      const variants = [["Light", p.colors], ["Dark", p.dark]];
      for (const [mode, variant] of variants) {
        const row = document.createElement("span");
        row.className = "preset-row";
        row.title = "Apply the " + p.name + " " + mode.toLowerCase() + " theme";
        const lab = document.createElement("span");
        lab.className = "preset-row-label";
        lab.textContent = mode;
        const strip = document.createElement("span");
        strip.className = "swatch-strip";
        strip.innerHTML = ["primary", "secondary", "accent", "background", "surface"].map((k) => '<span style="background:' + variant[k] + '"></span>').join("");
        row.appendChild(lab); row.appendChild(strip);
        row.addEventListener("click", () => applyPreset(p, mode === "Dark"));
        card.appendChild(row);
      }
      wrap.appendChild(card);
    }
  }

  function applyPreset(p, dark) {
    lastPresetName = p.name;
    cfg.colors = deepClone(dark ? p.dark : p.colors);
    cfg.theme.mode = dark ? "dark" : "light";
    applyThemeColors();
    buildColorForms();
    buildThemeForm();
    refreshThemeToggleUI();
    markDirty();
    toast("Applied the " + p.name + " " + (dark ? "dark" : "light") + " theme");
  }

  /* ---------- Content tab ---------- */

  function rebuildContentForms() {
    const wrap = $("#contentFields");
    wrap.innerHTML = "";

    const sub = (text) => { const h = document.createElement("h4"); h.className = "subhead"; h.textContent = text; wrap.appendChild(h); };

    // product
    sub("Hero & calls-to-action");
    const PRODUCT_FIELDS = [
      { key: "product.name", label: "Product / project name" },
      { key: "product.badge", label: "Badge pill text", hint: "e.g. “New release”" },
      { key: "product.headline", label: "Headline" },
      { key: "product.headlineAccent", label: "Gradient-accent word(s)", hint: "Must appear within the headline." },
      { key: "product.subheadline", label: "Subheadline", cls: "full" },
      { key: "product.primaryCta", label: "Primary button text" },
      { key: "product.primaryCtaUrl", label: "Primary button URL" },
      { key: "product.secondaryCta", label: "Secondary button text" },
      { key: "product.secondaryCtaUrl", label: "Secondary button URL" },
      { key: "product.status", label: "Status chip", hint: "e.g. “v1.0 · Released”. Empty hides it.", cls: "full" }
    ];
    for (const f of PRODUCT_FIELDS) {
      const field = document.createElement("div");
      field.className = "field" + (f.cls ? " " + f.cls : "");
      const label = document.createElement("label"); label.textContent = f.label;
      const input = document.createElement("input");
      input.type = "text"; input.value = getPath(cfg, f.key) || "";
      input.addEventListener("input", () => { setPath(cfg, f.key, input.value); applyText(); markDirty(); });
      field.appendChild(label); field.appendChild(input);
      if (f.hint) { const h = document.createElement("div"); h.className = "hint"; h.textContent = f.hint; field.appendChild(h); }
      wrap.appendChild(field);
    }

    // trustedBy
    sub("“Trusted by” strip");
    const tbField = document.createElement("div"); tbField.className = "field";
    const tbLabel = document.createElement("label"); tbLabel.textContent = "Client names (comma-separated)";
    const tbInput = document.createElement("input");
    tbInput.type = "text";
    tbInput.value = (cfg.trustedBy || []).join(", ");
    tbInput.addEventListener("input", () => {
      cfg.trustedBy = tbInput.value.split(",").map((s) => s.trim()).filter(Boolean);
      renderTrusted(); markDirty();
    });
    tbField.appendChild(tbLabel); tbField.appendChild(tbInput); wrap.appendChild(tbField);

    // stats
    sub("Stats band");
    wrap.appendChild(listEditor("stats", [
      { key: "value", label: "Value", placeholder: "99.99" },
      { key: "suffix", label: "Suffix", placeholder: "% / k+ / +" },
      { key: "label", label: "Label" }
    ]));

    // how
    sub("How it works");
    wrap.appendChild(listEditor("how", [
      { key: "title", label: "Title" },
      { key: "description", label: "Description", textarea: true }
    ]));

    // showcase
    sub("Showcase");
    const scF = document.createElement("div"); scF.className = "field";
    const scL = document.createElement("label"); scL.textContent = "Heading";
    const scIn = document.createElement("input"); scIn.type = "text"; scIn.value = cfg.showcase.heading || "";
    scIn.addEventListener("input", () => { cfg.showcase.heading = scIn.value; $("#showcaseHeading").textContent = scIn.value; markDirty(); });
    scF.appendChild(scL); scF.appendChild(scIn); wrap.appendChild(scF);
    const scD = document.createElement("div"); scD.className = "field";
    const scDL = document.createElement("label"); scDL.textContent = "Description";
    const scDIn = document.createElement("textarea"); scDIn.rows = 3; scDIn.value = cfg.showcase.description || "";
    scDIn.addEventListener("input", () => { cfg.showcase.description = scDIn.value; $("#showcaseDesc").textContent = scDIn.value; markDirty(); });
    scD.appendChild(scDL); scD.appendChild(scDIn); wrap.appendChild(scD);
    const scP = document.createElement("div"); scP.className = "field";
    const scPL = document.createElement("label"); scPL.textContent = "Bullet points (one per line)";
    const scPIn = document.createElement("textarea"); scPIn.rows = 3; scPIn.value = (cfg.showcase.points || []).join("\n");
    scPIn.addEventListener("input", () => { cfg.showcase.points = scPIn.value.split("\n").map((s) => s.trim()).filter(Boolean); renderShowcase(); markDirty(); });
    scP.appendChild(scPL); scP.appendChild(scPIn); wrap.appendChild(scP);

    // testimonials
    sub("Testimonials");
    wrap.appendChild(listEditor("testimonials", [
      { key: "quote", label: "Quote", textarea: true },
      { key: "name", label: "Name" },
      { key: "role", label: "Role" },
      { key: "company", label: "Company" }
    ]));

    // cta
    sub("Final call-to-action");
    const CTA_FIELDS = [
      { key: "cta.heading", label: "Heading" },
      { key: "cta.description", label: "Description", cls: "full" },
      { key: "cta.buttonText", label: "Button text" },
      { key: "cta.buttonUrl", label: "Button URL" }
    ];
    for (const f of CTA_FIELDS) {
      const field = document.createElement("div");
      field.className = "field" + (f.cls ? " " + f.cls : "");
      const label = document.createElement("label"); label.textContent = f.label;
      const input = document.createElement("input");
      input.type = "text"; input.value = getPath(cfg, f.key) || "";
      input.addEventListener("input", () => { setPath(cfg, f.key, input.value); applyText(); markDirty(); });
      field.appendChild(label); field.appendChild(input); wrap.appendChild(field);
    }

    // faq
    sub("FAQ");
    wrap.appendChild(listEditor("faq", [
      { key: "question", label: "Question" },
      { key: "answer", label: "Answer", textarea: true }
    ]));

    // footer columns
    sub("Footer link columns");
    const fcF = document.createElement("div"); fcF.className = "field";
    const fcL = document.createElement("label"); fcL.textContent = "Columns (JSON)";
    const fcIn = document.createElement("textarea"); fcIn.rows = 6; fcIn.spellcheck = false;
    fcIn.value = JSON.stringify(cfg.footer, null, 2);
    const fcHint = document.createElement("div"); fcHint.className = "hint";
    fcHint.textContent = 'Structure: { "columns": [ { "heading": "…", "links": [ { "label": "…", "url": "…" } ] } ] }';
    fcIn.addEventListener("input", () => {
      fcIn.classList.toggle("invalid", false);
      try {
        const parsed = JSON.parse(fcIn.value);
        if (parsed && Array.isArray(parsed.columns)) {
          cfg.footer = parsed;
          renderFooter(); markDirty();
          fcIn.classList.remove("invalid");
        } else fcIn.classList.add("invalid");
      } catch (e) { fcIn.classList.add("invalid"); }
    });
    fcF.appendChild(fcL); fcF.appendChild(fcIn); fcF.appendChild(fcHint); wrap.appendChild(fcF);
  }

  function listEditor(key, fields) {
    const box = document.createElement("div");
    box.className = "list-editor";
    const itemKeys = key === "features" ? cfg.features : cfg[key];
    const items = Array.isArray(itemKeys) ? itemKeys : [];

    const render = () => {
      box.innerHTML = "";
      items.forEach((item, i) => {
        const row = document.createElement("div");
        row.className = "list-item";
        row.style.cssText = "border:1px solid var(--border);border-radius:12px;padding:12px;margin-bottom:10px;background:var(--bg);";
        const grid = document.createElement("div");
        grid.className = "form-grid";
        for (const f of fields) {
          const fd = document.createElement("div");
          fd.className = "field";
          const lab = document.createElement("label"); lab.textContent = f.label;
          let inp;
          if (f.textarea) {
            inp = document.createElement("textarea");
            inp.rows = 2;
          } else {
            inp = document.createElement("input");
            inp.type = "text";
            if (f.placeholder) inp.placeholder = f.placeholder;
          }
          inp.value = item[f.key] != null ? item[f.key] : "";
          inp.addEventListener("input", () => {
            item[f.key] = inp.value;
            if (key === "stats") renderStats();
            if (key === "how") renderSteps();
            if (key === "testimonials") renderTestimonials();
            if (key === "faq") renderFaq();
            markDirty();
          });
          fd.appendChild(lab); fd.appendChild(inp); grid.appendChild(fd);
        }
        const remove = document.createElement("button");
        remove.type = "button"; remove.className = "btn btn-ghost btn-sm";
        remove.style.cssText = "margin-top:6px;";
        remove.textContent = "Remove";
        remove.addEventListener("click", () => { items.splice(i, 1); render(); applyAll(); markDirty(); });
        row.appendChild(grid); row.appendChild(remove); box.appendChild(row);
      });
      const add = document.createElement("button");
      add.type = "button"; add.className = "btn btn-ghost btn-sm";
      add.textContent = "+ Add " + (key === "features" ? "feature" : key === "stats" ? "stat" : key === "how" ? "step" : key === "faq" ? "FAQ item" : "item");
      add.addEventListener("click", () => {
        const blank = {};
        fields.forEach((f) => { blank[f.key] = ""; });
        items.push(blank);
        render(); applyAll(); markDirty();
      });
      box.appendChild(add);
    };
    render();
    return box;
  }

  /* ---------- Import & Export tab ---------- */

  function syncIoArea() {
    $("#ioArea").value = JSON.stringify(cfg, null, 2);
  }

  function buildFormatGuide() {
    const docBox = $("#formatDocs");
    docBox.innerHTML = collectDocLines(SCHEMA, "", []).map((l) => '<div class="guide-doc-line">' + esc(l) + "</div>").join("");
    $("#formatExample").textContent = JSON.stringify(buildExample(), null, 2);
  }

  function setupIoTab() {
    $("#exportBtn").addEventListener("click", () => {
      syncIoArea();
      const text = $("#ioArea").value;
      copyText(text);
      toast("Configuration JSON copied to clipboard");
    });
    $("#copyBtn").addEventListener("click", () => {
      const text = $("#ioArea").value || JSON.stringify(cfg, null, 2);
      copyText(text);
      toast("Copied to clipboard");
    });
    $("#importBtn").addEventListener("click", () => {
      const textarea = $("#ioArea");
      let parsed;
      try { parsed = JSON.parse(textarea.value); }
      catch (e) { showIoErrors("Not valid JSON: " + e.message); return; }
      const res = validateConfig(parsed);
      if (!res.ok) { showIoErrors(res.errors.join("\n")); return; }
      const kept = {};
      Object.keys(parsed).forEach((k) => { kept[k] = parsed[k]; });
      cfg = mergeDeep(defaultConfig(), kept);
      if (res.warnings.length) console.warn("Import warnings:", res.warnings);
      applyAll();
      rebuildSettingsForms();
      syncIoArea();
      markDirty();
      showIoErrors("", false);
      toast("Configuration imported and applied");
    });
    $("#downloadBtn").addEventListener("click", () => {
      downloadFile("business-config.json", JSON.stringify(cfg, null, 2), "application/json");
      toast("Downloaded business-config.json");
    });
    $("#schemaBtn").addEventListener("click", () => {
      downloadFile("business-config.schema.json", JSON.stringify(buildJsonSchema(), null, 2), "application/schema+json");
      toast("Downloaded JSON Schema");
    });
    $("#resetBtn").addEventListener("click", () => {
      if (confirm("Reset all settings to the template defaults (from main.pjs)? This clears your saved browser configuration.")) resetConfig();
    });
  }

  function showIoErrors(msg, show) {
    const box = $("#importErrors");
    if (msg) { box.textContent = msg; box.classList.add("show"); }
    else { box.textContent = ""; box.classList.remove("show"); }
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    } else fallbackCopy(text);
  }
  function fallbackCopy(text) {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); } catch (e) {}
    ta.remove();
  }
  function downloadFile(name, content, type) {
    const blob = new Blob([content], { type: type || "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 300);
  }

  /* ============================ brand scanner ============================ */

  function setupScanner() {
    $("#openScannerBtn").addEventListener("click", () => {
      const url = cfg.branding.companyUrl;
      $("#scanUrlInput").value = url && !/your-company/.test(url) ? url : "";
      $("#scanResult").innerHTML = "";
      showScanError("");
      openModal("#scannerModal");
    });
    $("#scannerCloseBtn").addEventListener("click", () => closeModal("#scannerModal"));
    $("#scannerModal").addEventListener("click", (e) => { if (e.target === $("#scannerModal")) closeModal("#scannerModal"); });
    $("#scanUrlInput").addEventListener("keydown", (e) => { if (e.key === "Enter") doScan(); });
    $("#scanBtn").addEventListener("click", doScan);
  }

  function showScanError(msg) {
    const box = $("#scanError");
    box.textContent = msg;
    box.classList.toggle("show", !!msg);
  }

  async function doScan() {
    const raw = $("#scanUrlInput").value.trim();
    if (!raw) { showScanError("Please enter a website URL."); return; }
    let url;
    try { url = new URL(raw.includes("://") ? raw : "https://" + raw); }
    catch (e) { showScanError("That doesn't look like a valid URL. Try e.g. https://example.com"); return; }

    $("#scanLoading").hidden = false;
    $("#scanBtn").disabled = true;
    showScanError("");
    $("#scanResult").innerHTML = "";
    try {
      const found = await analyzeSite(url);
      if (!found || !found.length) {
        showScanError("No usable brand colors were found on that page. It may be fully rendered by JavaScript — try a different page of the site (e.g. /about or /contact), or a plain marketing page.");
        return;
      }
      const schemes = buildSchemes(found);
      renderScanResults(found, schemes);
    } catch (err) {
      console.error("Scan failed:", err);
      showScanError("Could not analyze that site: " + (err.message || err) + ". It may be down, or blocking automated requests.");
    } finally {
      $("#scanLoading").hidden = true;
      $("#scanBtn").disabled = false;
    }
  }

  async function analyzeSite(url) {
    const fetcher = async (u, timeout) => {
      const res = await Promise.race([
        root.superFetch(u),
        new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), timeout || 20000))
      ]);
      return await res.text();
    };

    const html = await fetcher(url.href);
    const colors = new Map(); // "#rrggbb" -> weight
    const add = (raw, weight) => {
      const hex = normalizeColor(raw);
      if (hex) colors.set(hex, (colors.get(hex) || 0) + (weight || 1));
    };

    // <meta name="theme-color"> — the site's explicit brand color
    for (const m of html.matchAll(/<meta[^>]+name=["']theme-color["'][^>]*>/gi)) {
      const c = m[0].match(/content=["']([^"']+)["']/i);
      if (c) add(c[1], 24);
    }
    // inline style attributes
    for (const m of html.matchAll(/style\s*=\s*["'][^"']*["']/gi)) addColorsFromText(m[0], 3, add);
    // <style> blocks in the page
    for (const m of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) addColorsFromText(m[1], 1, add);
    // linked stylesheets (a bounded sample)
    const cssHrefs = [];
    for (const m of html.matchAll(/<link[^>]+rel=["']?stylesheet["']?[^>]*>/gi)) {
      const h = m[0].match(/href=["']([^"']+)["']/i);
      if (h && h[1] && !/^data:/i.test(h[1])) cssHrefs.push(h[1]);
    }
    const cssSample = cssHrefs.slice(0, 6);
    await Promise.all(cssSample.map(async (href) => {
      try {
        const full = new URL(href, url.href).href;
        const css = await fetcher(full, 15000);
        addColorsFromText(css.slice(0, 300000), 1, add);
      } catch (e) { /* skip unreadable stylesheets */ }
    }));

    // score & filter
    const scored = [];
    for (const [hex, w] of colors) {
      const [h, s, l] = rgbToHsl(hexToRgb(hex));
      scored.push({ hex, w, h, s, l, score: w * (0.25 + 0.75 * s) });
    }
    return scored
      .filter((c) => c.s > 0.13 && c.l > 0.1 && c.l < 0.92 && c.w >= 1)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12);
  }

  const NAMED = { black: "#000000", white: "#ffffff", red: "#ff0000", blue: "#0000ff", green: "#008000", gray: "#808080", grey: "#808080", silver: "#c0c0c0", yellow: "#ffff00", orange: "#ffa500", purple: "#800080", pink: "#ffc0cb", teal: "#008080", cyan: "#00ffff", navy: "#000080", maroon: "#800000", olive: "#808000", lime: "#00ff00", aqua: "#00ffff", fuchsia: "#ff00ff", brown: "#a52a2a", violet: "#ee82ee", gold: "#ffd700", indigo: "#4b0082" };

  function normalizeColor(raw) {
    if (typeof raw !== "string") return null;
    let v = raw.trim();
    const hex = v.match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
    if (hex) {
      let h = hex[1];
      if (h.length === 4) h = h.slice(0, 3);
      if (h.length === 8) h = h.slice(0, 6);
      if (h.length === 3) h = h.split("").map((c) => c + c).join("");
      return "#" + h.toLowerCase();
    }
    const rgb = v.match(/^rgba?\(\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*[,\s]\s*([\d.]+)(?:\s*[,\s/]\s*([\d.]+))?\s*\)$/i);
    if (rgb) {
      const a = rgb[4] == null ? 1 : parseFloat(rgb[4]);
      if (a < 0.5) return null;
      return rgbToHex([+rgb[1], +rgb[2], +rgb[3]]);
    }
    const hsl = v.match(/^hsla?\(\s*([\d.]+)\s*(?:deg)?\s*[,\s]\s*([\d.]+)%\s*[,\s]\s*([\d.]+)%(?:\s*[,\s/]\s*([\d.]+))?\s*\)$/i);
    if (hsl) {
      const a = hsl[4] == null ? 1 : parseFloat(hsl[4]);
      if (a < 0.5) return null;
      return hslToHex(parseFloat(hsl[1]), parseFloat(hsl[2]) / 100, parseFloat(hsl[3]) / 100);
    }
    const named = NAMED[v.toLowerCase()];
    return named || null;
  }

  function addColorsFromText(text, weight, add) {
    const HEXRE = /#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})\b/gi;
    const RGBRE = /rgba?\([^)]*\)/gi;
    const HSLRE = /hsla?\([^)]*\)/gi;
    for (const m of text.matchAll(HEXRE)) add(m[0], weight);
    for (const m of text.matchAll(RGBRE)) add(m[0], weight);
    for (const m of text.matchAll(HSLRE)) add(m[0], weight);
  }

  /* ---------- build color schemes from extracted colors ---------- */

  function buildSchemes(top) {
    const primary = top[0];
    const hue = primary.h;
    const distinct = (minDeg) => top.find((c) => hueDist(c.h, hue) >= minDeg && c.hex !== primary.hex) || null;

    const sec1 = distinct(30);
    const sec = sec1 ? sec1.hex : hslToHex((hue + 35) % 360, Math.min(0.85, primary.s + 0.15), 0.5);
    const acc1 = top.find((c) => c.hex !== primary.hex && c.hex !== sec && hueDist(c.h, hue) >= 50);
    const accent = acc1 ? acc1.hex : hslToHex((hue + 24) % 360, 0.92, 0.56);

    const complement = hslToHex((hue + 180) % 360, Math.max(0.55, primary.s), 0.52);
    const analogA = hslToHex((hue + 26) % 360, 0.78, 0.5);
    const analogB = hslToHex((hue - 24 + 360) % 360, 0.85, 0.55);

    return [
      {
        id: "core",
        name: "Brand core",
        desc: "The site's own dominant colors, kept as-is.",
        darkMode: false,
        colors: {
          primary: primary.hex, secondary: sec, accent,
          background: "#ffffff", surface: mix(primary.hex, "#ffffff", 0.94), text: "#0f172a", textMuted: "#5b6478"
        }
      },
      {
        id: "complement",
        name: "Brand complement",
        desc: "Adds a complementary hue for strong contrast.",
        darkMode: false,
        colors: {
          primary: primary.hex, secondary: complement, accent,
          background: "#ffffff", surface: mix(primary.hex, "#ffffff", 0.94), text: "#0f172a", textMuted: "#5b6478"
        }
      },
      {
        id: "analog",
        name: "Brand analog",
        desc: "Neighboring hues for a harmonious, calm feel.",
        darkMode: false,
        colors: {
          primary: primary.hex, secondary: analogA, accent: analogB,
          background: "#ffffff", surface: "#f7f8fc", text: "#0f172a", textMuted: "#5b6478"
        }
      },
      {
        id: "dark",
        name: "Brand dark",
        desc: "A modern dark interface built around the brand color.",
        darkMode: true,
        colors: {
          primary: primary.hex, secondary: complement, accent,
          background: "#141414", surface: "#1d1d22", text: "#f1f5f9", textMuted: "#94a3b8"
        }
      }
    ];
  }

  function refreshThemeToggleUI() {
    const t = $("#themeToggleIcon");
    if (t) t.innerHTML = icon(cfg.theme.mode === "dark" ? "spark" : "star", 18);
    const tb = $("#themeToggle");
    if (tb) tb.title = cfg.theme.mode === "dark" ? "Switch to light mode" : "Switch to dark mode";
  }

  function setThemeMode(m) {
    cfg.theme.mode = m;
    const preset = PRESETS.find((pr) => pr.name === lastPresetName);
    if (preset) cfg.colors = deepClone(m === "dark" ? preset.dark : preset.colors);
    applyThemeColors();
    buildColorForms();
    buildThemeForm();
    refreshThemeToggleUI();
    markDirty();
  }

  function applySchemeColors(s) {
    lastPresetName = null;
    cfg.colors = deepClone(s.colors);
    if (s.darkMode !== undefined) cfg.theme.mode = s.darkMode ? "dark" : "light";
    applyThemeColors();
    buildColorForms();
    buildThemeForm();
    refreshThemeToggleUI();
    markDirty();
  }

  function renderScanResults(found, schemes) {
    const box = $("#scanResult");
    box.innerHTML = "";
    const intro = document.createElement("p");
    intro.className = "panel-intro";
    intro.textContent = "Extracted " + found.length + " colors from the site. Pick a scheme to preview it on the page, then Apply to save it.";
    box.appendChild(intro);

    const strip = document.createElement("div");
    strip.className = "found-strip";
    strip.innerHTML = found.slice(0, 8).map((c) => '<span class="found-chip"><i style="background:' + c.hex + '"></i>' + c.hex + "</span>").join("");
    box.appendChild(strip);

    const schemesHead = document.createElement("h4");
    schemesHead.className = "subhead";
    schemesHead.textContent = "Suggested color schemes";
    box.appendChild(schemesHead);

    const ORDER = ["primary", "secondary", "accent", "background", "surface", "text", "textMuted"];
    for (const s of schemes) {
      const card = document.createElement("div");
      card.className = "scheme-card";
      const head = document.createElement("div");
      head.className = "scheme-head";
      head.innerHTML = '<div><div class="scheme-name">' + esc(s.name) + '</div><div class="scheme-desc">' + esc(s.desc) + "</div></div>";
      const swatches = document.createElement("div");
      swatches.className = "scheme-swatches";
      for (const k of ORDER) {
        const sw = document.createElement("span");
        sw.className = "s";
        sw.style.background = s.colors[k];
        sw.title = k + " · " + s.colors[k];
        sw.addEventListener("click", () => {
          cfg.colors = deepClone(s.colors);
          applyThemeColors();
          buildColorForms();
          markDirty();
          toast("Previewing " + s.name + " — click Apply to keep it", "success");
        });
        swatches.appendChild(sw);
      }
      const actions = document.createElement("div");
      actions.className = "scheme-actions";
      const previewBtn = document.createElement("button");
      previewBtn.type = "button"; previewBtn.className = "btn btn-ghost btn-sm";
      previewBtn.textContent = "Preview";
      previewBtn.addEventListener("click", () => {
        applySchemeColors(s);
        toast("Previewing the " + s.name + " scheme");
      });
      const applyBtn = document.createElement("button");
      applyBtn.type = "button"; applyBtn.className = "btn btn-primary btn-sm";
      applyBtn.textContent = "Apply";
      applyBtn.addEventListener("click", () => {
        applySchemeColors(s);
        persist();
        toast("Applied the " + s.name + " scheme", "success");
      });
      actions.appendChild(previewBtn); actions.appendChild(applyBtn);
      card.appendChild(head); card.appendChild(swatches); card.appendChild(actions);
      box.appendChild(card);
    }

    const note = document.createElement("p");
    note.className = "hint";
    note.style.marginTop = "14px";
    note.textContent = "Tip: you can also click any individual swatch to apply just that color slot.";
    box.appendChild(note);
  }

  /* ============================ misc UI ============================ */

  function setupMisc() {
    // mobile menu
    $("#hamburgerBtn").addEventListener("click", () => $("#mobileMenu").classList.toggle("open"));
    $$("#mobileMenu a").forEach((a) => a.addEventListener("click", () => $("#mobileMenu").classList.remove("open")));

    // scroll progress
    const bar = $("#progressBar");
    const onScroll = () => {
      const h = document.documentElement;
      const max = h.scrollHeight - h.clientHeight;
      bar.style.width = (max > 0 ? (h.scrollTop / max) * 100 : 0) + "%";
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  /* ============================ init ============================ */

  // ?theme=&primary=&secondary=&accent=&size=&motion= — settings shared via a
  // link override whatever is saved in this browser (same convention as the
  // badge template this port is based on).
  function applyUrlOverrides() {
    const qp = new URLSearchParams(location.search);
    const q = (k) => qp.get(k);
    if (q("theme") === "light" || q("theme") === "dark") cfg.theme.mode = q("theme");
    for (const k of ["primary", "secondary", "accent"]) {
      const h = normalizeHex(q(k));
      if (h) cfg.colors[k] = h;
    }
    const sz = parseInt(q("size"), 10);
    if ([15, 16, 18].includes(sz)) cfg.theme.fontSize = sz;
    const m = q("motion");
    if (m !== null) cfg.theme.reduceMotion = m === "true" || m === "1" || m === "on";
    if (qp.toString()) toast("Applied settings from the link");
  }

  function copyShareLink() {
    const u = new URL(location.href);
    const set = (k, v) => { if (v != null && v !== "") u.searchParams.set(k, v); else u.searchParams.delete(k); };
    set("theme", cfg.theme.mode);
    set("primary", cfg.colors.primary);
    set("secondary", cfg.colors.secondary);
    set("accent", cfg.colors.accent);
    set("size", cfg.theme.fontSize);
    set("motion", cfg.theme.reduceMotion ? "true" : "false");
    history.replaceState(null, "", u);
    copyText(u.href);
    toast("Share link copied to clipboard", "success");
  }

  function init() {
    loadConfig();
    applyUrlOverrides();
    applyAll();
    loadFontPair();
    updateHeaderLogo();
    setupThemeToggle();
    setupSettingsModal();
    setupIoTab();
    setupScanner();
    setupMisc();
    buildFormatGuide();
    setTab("brand");
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
