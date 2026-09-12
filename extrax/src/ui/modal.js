let modalEl = null;
let lastFocus = null;

const STYLE_ID = "extrax-modal-style";

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = [
    ".extrax-modal{position:fixed; inset:0; z-index:99999; display:flex; align-items:center; justify-content:center; padding:20px;}",
    ".extrax-modal[hidden]{display:none !important;}",
    ".extrax-modal-backdrop{position:absolute; inset:0; background:rgba(4,6,12,.78); backdrop-filter:blur(3px);}",
    ".extrax-modal-panel{position:relative; width:min(760px,100%); max-height:88vh; display:flex; flex-direction:column; background:var(--panel,#161a24); border:1px solid var(--line,#272e40); border-radius:16px; box-shadow:0 30px 80px rgba(0,0,0,.6); overflow:hidden; text-align:left;}",
    ".extrax-modal.wide .extrax-modal-panel{width:min(1080px,100%);}",
    ".extrax-modal-head{display:flex; align-items:center; gap:12px; padding:15px 18px; border-bottom:1px solid var(--line,#272e40);}",
    ".extrax-modal-title{margin:0; font-size:17px; color:#fff; flex:1; line-height:1.3;}",
    ".extrax-modal-close{flex:none; width:32px; height:32px; border-radius:9px; border:1px solid var(--line,#272e40); background:var(--panel2,#1d2331); color:var(--muted,#98a0b6); font-size:19px; line-height:1; cursor:pointer;}",
    ".extrax-modal-close:hover{color:#fff; border-color:var(--accent,#8b5cf6);}",
    ".extrax-modal-body{padding:16px 18px; overflow:auto; flex:1; min-height:0; color:var(--text,#e8eaf2); font-size:14px;}",
    ".extrax-modal-foot{padding:12px 18px; border-top:1px solid var(--line,#272e40); display:flex; flex-wrap:wrap; gap:9px; justify-content:flex-end; background:rgba(0,0,0,.12);}",
    ".extrax-modal-foot button, .extrax-modal-body button.exbtn{border:1px solid var(--line,#272e40); background:var(--panel2,#1d2331); color:var(--text,#e8eaf2); border-radius:9px; padding:8px 14px; font-size:13px; cursor:pointer; transition:all .12s;}",
    ".extrax-modal-foot button:hover, .extrax-modal-body button.exbtn:hover{border-color:var(--accent,#8b5cf6); color:#fff;}",
    ".extrax-modal-foot button.prim, .extrax-modal-body button.exbtn.prim{background:var(--accent,#8b5cf6); border-color:var(--accent,#8b5cf6); color:#fff; font-weight:600;}",
    ".extrax-modal-body pre.extrax-pre{margin:0 0 12px; background:var(--panel2,#1d2331); border:1px solid var(--line,#272e40); border-radius:10px; padding:12px 14px; max-height:340px; overflow:auto; font-family:ui-monospace,Menlo,Consolas,monospace; font-size:12px; line-height:1.55; color:#c8d3ea; white-space:pre-wrap; word-break:break-word;}",
    ".extrax-modal h4{margin:0 0 8px; font-size:12.5px; text-transform:uppercase; letter-spacing:.5px; color:var(--accent2,#2cb67d);}",
    ".extrax-modal .exgrid{display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); gap:14px;}",
    ".extrax-modal .exfield{display:flex; flex-direction:column; gap:5px; margin-bottom:12px;}",
    ".extrax-modal .exfield label{font-size:12.5px; color:var(--muted,#98a0b6);}",
    ".extrax-modal select, .extrax-modal input[type=text], .extrax-modal input[type=number], .extrax-modal textarea{background:var(--panel2,#1d2331); color:var(--text,#e8eaf2); border:1px solid var(--line,#272e40); border-radius:9px; padding:9px 11px; font:inherit; font-size:13px; outline:none;}",
    ".extrax-modal select:focus, .extrax-modal input:focus, .extrax-modal textarea:focus{border-color:var(--accent,#8b5cf6);}",
    ".extrax-modal .exrow{display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:10px;}",
    ".extrax-modal .exmuted{color:var(--muted,#98a0b6); font-size:12.5px; line-height:1.55;}",
    ".extrax-modal .exlist{display:flex; flex-direction:column; gap:8px; margin-bottom:12px;}",
    ".extrax-modal .exitem{border:1px solid var(--line,#272e40); border-radius:10px; padding:10px 12px; background:var(--panel2,#1d2331); display:flex; align-items:center; gap:10px; flex-wrap:wrap;}",
    ".extrax-modal .exitem .exgrow{flex:1; min-width:160px;}",
    ".extrax-modal .exitem b{color:#fff;}",
    ".extrax-modal .exswatch{display:inline-block; width:16px; height:16px; border-radius:5px; border:1px solid rgba(255,255,255,.25); vertical-align:middle; margin-right:4px;}",
    ".extrax-modal iframe.expreview{width:100%; height:420px; border:1px solid var(--line,#272e40); border-radius:10px; background:#fff;}",
    ".extrax-modal table.extable{width:100%; border-collapse:collapse; font-size:13px; margin-bottom:12px;}",
    ".extrax-modal table.extable th, .extrax-modal table.extable td{border:1px solid var(--line,#272e40); padding:6px 9px; text-align:left;}",
    ".extrax-modal table.extable th{background:var(--panel2,#1d2331); color:#fff;}",
    ".extrax-modal .exstream{white-space:pre-wrap; line-height:1.6; font-size:13.5px; background:var(--panel2,#1d2331); border:1px solid var(--line,#272e40); border-radius:10px; padding:12px 14px; min-height:60px; max-height:340px; overflow:auto;}",
    ".extrax-modal .exspin{display:inline-block; width:14px; height:14px; border-radius:50%; border:2px solid var(--line,#272e40); border-top-color:var(--accent,#8b5cf6); animation:exsp .8s linear infinite; vertical-align:-2px;}",
    "@keyframes exsp{to{transform:rotate(360deg)}}"
  ].join("\n");
  document.head.appendChild(style);
}

function build() {
  ensureStyle();
  modalEl = document.createElement("div");
  modalEl.className = "extrax-modal";
  modalEl.hidden = true;
  modalEl.innerHTML = [
    '<div class="extrax-modal-backdrop"></div>',
    '<div class="extrax-modal-panel" role="dialog" aria-modal="true">',
    '  <div class="extrax-modal-head"><h3 class="extrax-modal-title"></h3><button class="extrax-modal-close" title="Close" aria-label="Close">&times;</button></div>',
    '  <div class="extrax-modal-body"></div>',
    '  <div class="extrax-modal-foot"></div>',
    "</div>"
  ].join("\n");
  document.body.appendChild(modalEl);
  modalEl.querySelector(".extrax-modal-backdrop").addEventListener("click", closeModal);
  modalEl.querySelector(".extrax-modal-close").addEventListener("click", closeModal);
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && modalEl && !modalEl.hidden) closeModal();
  });
}

export function isModalOpen() {
  return !!(modalEl && !modalEl.hidden);
}

export function modalBody() {
  if (!modalEl) build();
  return modalEl.querySelector(".extrax-modal-body");
}

export function closeModal() {
  if (!modalEl) return;
  modalEl.hidden = true;
  modalEl.querySelector(".extrax-modal-body").textContent = "";
  modalEl.querySelector(".extrax-modal-foot").textContent = "";
  if (lastFocus && typeof lastFocus.focus === "function") {
    try { lastFocus.focus(); } catch (err) { /* element gone */ }
  }
  lastFocus = null;
}

export function openModal(options = {}) {
  if (!modalEl) build();
  lastFocus = document.activeElement;
  modalEl.classList.toggle("wide", !!options.wide);
  modalEl.querySelector(".extrax-modal-title").textContent = options.title || "";
  const body = modalEl.querySelector(".extrax-modal-body");
  body.textContent = "";
  if (options.body instanceof Node) body.appendChild(options.body);
  else if (typeof options.body === "string") body.innerHTML = options.body;

  const foot = modalEl.querySelector(".extrax-modal-foot");
  foot.textContent = "";
  const actions = Array.isArray(options.actions) ? options.actions : [];
  for (const action of actions) {
    if (action.html) {
      const wrap = document.createElement("span");
      wrap.innerHTML = action.html;
      foot.appendChild(wrap);
      continue;
    }
    const btn = document.createElement("button");
    btn.textContent = action.label || "";
    if (action.cls) btn.className = action.cls;
    btn.addEventListener("click", () => {
      if (typeof action.onClick === "function") action.onClick(btn);
      else closeModal();
    });
    foot.appendChild(btn);
  }
  if (!actions.length) {
    const btn = document.createElement("button");
    btn.textContent = "Close";
    btn.addEventListener("click", closeModal);
    foot.appendChild(btn);
  }
  modalEl.hidden = false;
  const first = body.querySelector("input, select, textarea, button");
  if (first && options.focus !== false) {
    try { first.focus(); } catch (err) { /* not focusable */ }
  }
  return body;
}

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "html") node.innerHTML = value;
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child == null) continue;
    node.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}
