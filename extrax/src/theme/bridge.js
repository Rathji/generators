import { designTokens, cardColors, tokensToJson, tokensToCssVars, tokensToScss, tokensToTailwind, tokensToMarkdown } from "./tokens.js";
import { starterScaffold, scaffoldZipName } from "./scaffold.js";
import { findSimilar, compareCards, compareToText } from "./compare.js";
import { generatorOverview, treeToText, overviewSummary, generatorApiUrl, generatorHtmlUrl, generatorPageUrl, generatorPreviewUrl, extractGeneratorName } from "./inspector.js";
import { createZip } from "../lib/zip.js";
import { openModal, closeModal, modalBody, el } from "../ui/modal.js";

function vault() {
  return window.extraxVault || null;
}

function esc(s) {
  if (vault() && typeof vault().esc === "function") return vault().esc(s);
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function copyText(text) {
  return navigator.clipboard.writeText(text).catch(() => {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  });
}

function downloadBlob(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
}

function downloadText(name, text, mime) {
  downloadBlob(name, new Blob([text], { type: mime || "text/plain;charset=utf-8" }));
}

function flash(btn, txt) {
  const old = btn.textContent;
  btn.textContent = txt;
  btn.disabled = true;
  setTimeout(() => { btn.textContent = old; btn.disabled = false; }, 1300);
}

function section(title) {
  return el("h4", { text: title });
}

/* ---------------- swatches + card buttons ---------------- */

function swatchRow(card) {
  const colors = cardColors(card);
  if (!colors.length) return null;
  const row = el("div", { class: "fonts" });
  for (const hex of colors.slice(0, 10)) {
    row.appendChild(el("span", { class: "fontchip", title: hex, style: "padding:4px 8px;" }, [
      el("i", { style: "display:inline-block;width:12px;height:12px;border-radius:4px;background:" + hex + ";border:1px solid rgba(255,255,255,.25);vertical-align:-1px;margin-right:6px;" }),
      hex
    ]));
  }
  return row;
}

function ensureButtons(cardEl) {
  const actions = cardEl.querySelector(".actions");
  if (!actions || actions.dataset.exdone) return;
  actions.dataset.exdone = "1";
  const mk = (cls, label, title) => {
    const b = document.createElement("button");
    b.className = cls;
    b.textContent = label;
    if (title) b.title = title;
    return b;
  };
  actions.insertBefore(mk("exTokensBtn", "Tokens", "Export this theme's design tokens"), actions.querySelector(".moodBtn") || null);
  actions.insertBefore(mk("exStarterBtn", "Starter", "Generate a ready-to-paste themed starter project"), actions.querySelector(".moodBtn") || null);
  actions.insertBefore(mk("exSimilarBtn", "Similar", "Find themes like this one"), actions.querySelector(".delBtn") || null);
  actions.insertBefore(mk("exCompareBtn", "Compare", "Compare with another captured theme"), actions.querySelector(".delBtn") || null);
}

function decorateGrid() {
  const grid = document.getElementById("grid");
  if (!grid) return;
  for (const cardEl of grid.querySelectorAll(".card")) {
    if (cardEl.dataset.exdecorated) continue;
    cardEl.dataset.exdecorated = "1";
    const card = vault() && vault().byId(cardEl.dataset.id);
    if (!card) continue;
    ensureButtons(cardEl);
    const fonts = cardEl.querySelector(".fonts");
    const sw = swatchRow(card);
    if (sw) {
      if (fonts) fonts.insertAdjacentElement("afterend", sw);
      else {
        const rows = cardEl.querySelector(".rows");
        if (rows) rows.insertAdjacentElement("afterend", sw);
      }
    }
  }
}

/* ---------------- tokens modal ---------------- */

function tokenExports(card) {
  const tokens = designTokens(card);
  return [
    { key: "css", label: "CSS variables", text: tokensToCssVars(tokens), file: "theme-tokens.css", mime: "text/css;charset=utf-8" },
    { key: "scss", label: "SCSS", text: tokensToScss(tokens), file: "theme-tokens.scss", mime: "text/plain;charset=utf-8" },
    { key: "tailwind", label: "Tailwind config", text: tokensToTailwind(tokens), file: "tailwind.config.js", mime: "text/javascript;charset=utf-8" },
    { key: "json", label: "JSON", text: tokensToJson(tokens), file: "theme-tokens.json", mime: "application/json" },
    { key: "md", label: "Markdown", text: tokensToMarkdown(card, tokens), file: "theme-tokens.md", mime: "text/markdown;charset=utf-8" }
  ];
}

function tokensModal(card) {
  const exports = tokenExports(card);
  let active = exports[0];
  const body = openModal({ title: "Design tokens — " + (card.title || card.name || "theme"), wide: true });
  const tokens = designTokens(card);

  const swatches = el("div", { class: "exrow" });
  for (const c of tokens.colors.slice(0, 16)) {
    swatches.appendChild(el("span", { class: "exitem", style: "padding:6px 10px;" }, [
      el("span", { class: "exswatch", style: "background:" + c.value }),
      el("span", { class: "exgrow" }, [el("b", { text: c.value }), el("span", { class: "exmuted", text: " " + c.name })])
    ]));
  }
  body.appendChild(swatches);

  const info = el("div", { class: "exmuted" });
  const bits = [];
  if (tokens.fontFamily) bits.push("Font: " + tokens.fontFamily);
  if (tokens.background) bits.push("Background: " + tokens.background);
  if (tokens.textColor) bits.push("Text: " + tokens.textColor);
  if (tokens.radius) bits.push("Radius: " + tokens.radius);
  if (tokens.shadow) bits.push("Shadow: " + tokens.shadow);
  info.textContent = bits.join("  ·  ") || "No design tokens were captured for this theme.";
  body.appendChild(info);

  const tabs = el("div", { class: "exrow", style: "margin-top:12px;" });
  const pre = el("pre", { class: "extrax-pre" });
  const renderPre = () => { pre.textContent = active.text; };
  for (const item of exports) {
    const b = el("button", { class: "exbtn", text: item.label });
    b.addEventListener("click", () => {
      active = item;
      for (const other of tabs.querySelectorAll("button")) other.classList.remove("prim");
      b.classList.add("prim");
      renderPre();
    });
    if (item === active) b.classList.add("prim");
    tabs.appendChild(b);
  }
  body.append(tabs, pre);
  renderPre();

  body.appendChild(el("div", { class: "exrow" }, [
    el("button", { class: "exbtn prim", text: "Copy current", onClick: e => copyText(active.text).then(() => flash(e.currentTarget, "Copied!")) }),
    el("button", { class: "exbtn", text: "Download current", onClick: () => downloadText(active.file, active.text, active.mime) }),
    el("button", { class: "exbtn", text: "Copy all as JSON", onClick: () => copyText(tokensToJson(designTokens(card))) })
  ]));
}

/* ---------------- starter modal ---------------- */

function starterModal(card) {
  const scaffold = starterScaffold(card);
  const body = openModal({
    title: "Themed starter — " + scaffold.title,
    actions: [
      { label: "Download .zip", cls: "prim", onClick: () => downloadBlob(scaffoldZipName(card), new Blob([createZip(scaffold.files.map(f => ({ name: f.name, data: f.text })))], { type: "application/zip" })) }
    ]
  });
  body.appendChild(el("p", { class: "exmuted", text: "Four files that recreate this theme in a brand-new Perchance generator. Paste index.html into your new generator's index.html and main.pjs into its main.pjs — the page then renders a themed demo you can swap out." }));
  for (const file of scaffold.files) {
    body.appendChild(section(file.name));
    const pre = el("pre", { class: "extrax-pre" });
    pre.textContent = file.text;
    body.appendChild(pre);
    body.appendChild(el("div", { class: "exrow" }, [
      el("button", { class: "exbtn", text: "Copy " + file.name, onClick: e => copyText(file.text).then(() => flash(e.currentTarget, "Copied!")) }),
      el("button", { class: "exbtn", text: "Download", onClick: () => downloadText(file.name, file.text, file.mime) })
    ]));
  }
}

/* ---------------- similar / compare ---------------- */

function similarModal(card) {
  const cards = vault() ? vault().all() : [];
  const results = findSimilar(cards, card, 6);
  const body = openModal({ title: "Themes similar to " + (card.title || card.name) });
  if (!results.length) {
    body.appendChild(el("p", { class: "exmuted", text: "No other captured theme shares enough of this one's tags, fonts, palette or wording yet. Capture a few more and try again." }));
    return;
  }
  const list = el("div", { class: "exlist" });
  for (const r of results) {
    list.appendChild(el("div", { class: "exitem" }, [
      el("div", { class: "exgrow" }, [
        el("b", { text: r.card.title || r.card.name }),
        el("div", { class: "exmuted", text: r.score + "% · " + (r.reasons.join(", ") || "related") })
      ]),
      el("button", { class: "exbtn", text: "Compare", onClick: () => compareModal(card, r.card) })
    ]));
  }
  body.appendChild(list);
}

function compareModal(a, b) {
  const body = openModal({ title: "Compare themes", wide: true });
  const cards = vault() ? vault().all().filter(c => c.id !== (a && a.id)) : [];
  const select = el("select", { style: "min-width:220px;" });
  for (const c of cards) {
    const opt = el("option", { value: c.id, text: c.title || c.name });
    if (b && c.id === b.id) opt.selected = true;
    select.appendChild(opt);
  }
  const renderCompare = () => {
    Array.from(body.querySelectorAll(".compare-out")).forEach(n => n.remove());
    const right = cards.find(c => c.id === select.value) || b;
    if (!right) {
      body.appendChild(el("p", { class: "exmuted compare-out", text: "Capture at least two themes to compare them." }));
      return;
    }
    const cmp = compareCards(a, right);
    const out = el("div", { class: "compare-out" });
    out.appendChild(el("p", { class: "exmuted", text: "Similarity: " + cmp.score + "%" + (cmp.reasons.length ? " · " + cmp.reasons.join(", ") : "") }));
    const table = el("table", { class: "extable" });
    const thead = el("thead");
    thead.appendChild(el("tr", {}, [el("th", { text: "Field" }), el("th", { text: a.title || a.name }), el("th", { text: right.title || right.name })]));
    table.appendChild(thead);
    const tbody = el("tbody");
    for (const row of cmp.rows) {
      tbody.appendChild(el("tr", {}, [
        el("td", { text: (row.changed ? "✗ " : "✓ ") + row.label }),
        el("td", { text: row.a || "—" }),
        el("td", { text: row.b || "—" })
      ]));
    }
    table.appendChild(tbody);
    out.appendChild(table);
    out.appendChild(el("div", { class: "exrow" }, [
      el("button", { class: "exbtn", text: "Copy comparison", onClick: e => copyText(compareToText(a, right, cmp)).then(() => flash(e.currentTarget, "Copied!")) }),
      el("button", { class: "exbtn", text: "Download .md", onClick: () => downloadText("theme-comparison.md", compareToText(a, right, cmp), "text/markdown;charset=utf-8") })
    ]));
    body.appendChild(out);
  };
  if (a && cards.length) {
    body.appendChild(el("div", { class: "exrow" }, [
      el("span", { class: "exmuted", text: "Compare " + (a.title || a.name) + " with:" }),
      select
    ]));
    select.addEventListener("change", renderCompare);
  }
  renderCompare();
}

/* ---------------- generator inspector ---------------- */

async function fetchGeneratorSource(name) {
  const api = generatorApiUrl(name);
  let code = "";
  let html = "";
  try {
    const res = await fetch(api).then(r => r.json());
    const g = res && res.generators && res.generators[name];
    if (g) code = g.code || "";
  } catch (err) { /* fall through */ }
  if (!code && window.root && typeof window.root.superFetch === "function") {
    try {
      const res = await window.root.superFetch(api).then(r => r.json());
      const g = res && res.generators && res.generators[name];
      if (g) code = g.code || "";
    } catch (err) { /* nothing */ }
  }
  try {
    const res = await fetch(generatorHtmlUrl(name));
    if (res.ok) html = await res.text();
  } catch (err) { /* html optional */ }
  return { code, html };
}

async function inspectorModal(name) {
  const body = openModal({ title: "Generator inspector — " + name, wide: true });
  body.appendChild(el("p", { class: "exmuted", html: '<span class="exspin"></span> Fetching <b>' + esc(name) + "</b> from the Perchance API…" }));
  const { code, html } = await fetchGeneratorSource(name);
  body.textContent = "";
  if (!code) {
    body.appendChild(el("p", { class: "exmuted", text: "Couldn't load that generator's source. It may not exist, or its source may be private." }));
    return;
  }
  const overview = generatorOverview(code);
  const meta = overview.meta || {};
  const summary = overviewSummary(overview);
  const stats = el("div", { class: "exrow" }, [
    el("span", { class: "exitem exgrow" }, [el("div", { class: "exgrow" }, [el("b", { text: (meta.title || name) }), el("div", { class: "exmuted", text: (meta.description ? meta.description + " · " : "") + summary })])])
  ]);
  body.appendChild(stats);
  if (overview.imports.length) {
    body.appendChild(section("Imports"));
    body.appendChild(el("div", { class: "exrow" }, overview.imports.map(i => el("span", { class: "exitem", text: i.alias + " → " + i.name }))));
  }
  body.appendChild(section("Structure"));
  const pre = el("pre", { class: "extrax-pre" });
  pre.textContent = treeToText(overview.tree);
  body.appendChild(pre);
  body.appendChild(el("div", { class: "exrow" }, [
    el("button", { class: "exbtn prim", text: "Capture this theme", onClick: e => { flash(e.currentTarget, "Opening…"); window.location.hash = ""; if (vault() && vault().setInput) vault().setInput(name); const input = document.getElementById("genInput"); if (input) input.value = name; const btn = document.getElementById("captureBtn"); if (btn) btn.click(); closeModal(); } }),
    el("button", { class: "exbtn", text: "Copy pjs structure", onClick: e => copyText(treeToText(overview.tree)).then(() => flash(e.currentTarget, "Copied!")) }),
    el("a", { class: "exitem", href: generatorPageUrl(name), target: "_blank", rel: "noopener", text: "Open on Perchance ↗" })
  ]));
  body.appendChild(section("Live preview"));
  body.appendChild(el("iframe", { class: "expreview", src: generatorPreviewUrl(name), loading: "lazy" }));
}

/* ---------------- wiring ---------------- */

function handleGridClick(event) {
  const btn = event.target.closest("button");
  if (!btn) return;
  const cardEl = btn.closest(".card[data-id]");
  if (!cardEl || !vault()) return;
  const card = vault().byId(cardEl.dataset.id);
  if (!card) return;
  if (btn.classList.contains("exTokensBtn")) tokensModal(card);
  else if (btn.classList.contains("exStarterBtn")) starterModal(card);
  else if (btn.classList.contains("exSimilarBtn")) similarModal(card);
  else if (btn.classList.contains("exCompareBtn")) compareModal(card, null);
}

function addInspectButton() {
  const capture = document.querySelector("#paneTheme .capture");
  if (!capture || capture.querySelector(".exInspectBtn")) return;
  const btn = document.createElement("button");
  btn.className = "exInspectBtn";
  btn.textContent = "Inspect source";
  btn.title = "Fetch a generator's source and preview it";
  btn.style.cssText = "border:1px solid var(--line); background:var(--panel2); color:var(--text); border-radius:10px; padding:11px 18px; font-size:14px; cursor:pointer;";
  btn.addEventListener("mouseenter", () => { btn.style.borderColor = "var(--accent)"; btn.style.color = "#fff"; });
  btn.addEventListener("mouseleave", () => { btn.style.borderColor = "var(--line)"; btn.style.color = "var(--text)"; });
  btn.addEventListener("click", () => {
    const raw = document.getElementById("genInput").value;
    const name = extractGeneratorName(raw);
    if (!name || !/^[a-z0-9-]+$/.test(name)) {
      inspectorModal("");
      return;
    }
    inspectorModal(name);
  });
  capture.appendChild(btn);
}

function init() {
  const grid = document.getElementById("grid");
  if (grid) {
    grid.addEventListener("click", handleGridClick);
    const observer = new MutationObserver(() => decorateGrid());
    observer.observe(grid, { childList: true });
    decorateGrid();
  }
  addInspectButton();
  const capture = document.querySelector("#paneTheme .capture");
  if (capture) {
    const observer = new MutationObserver(() => addInspectButton());
    observer.observe(capture, { childList: true });
  }
}

window.extraxTheme = {
  decorateGrid,
  tokensModal,
  starterModal,
  similarModal,
  compareModal,
  inspectorModal,
  tokenExports,
  fetchGeneratorSource
};

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
