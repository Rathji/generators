import { store, bus } from "./store.js";
import { marked } from "https://esm.sh/marked@12.0.2";

const $ = (s) => document.querySelector(s);

let previewVisible = false;
let lastRendered = "";
let debounceTimer = null;

function isHtml(path) {
  return /\.html?$/i.test(path || "");
}

function isMd(path) {
  return /\.(md|markdown|mdown|mkd)$/i.test(path || "");
}

export function isPreviewable(path) {
  return isHtml(path) || isMd(path);
}

export function isPreviewVisible() {
  return previewVisible;
}

export function togglePreview() {
  setPreviewVisible(!previewVisible);
}

export function setPreviewVisible(v) {
  previewVisible = !!v;
  const pane = $("#previewpane");
  if (pane) pane.hidden = !previewVisible;
  const btn = $("#pvToggleBtn");
  if (btn) btn.classList.toggle("active", previewVisible);
  if (previewVisible) refreshPreview(true);
  else lastRendered = "";
}

function show(kind) {
  $("#pv-iframe").hidden = kind !== "html";
  $("#pv-md").hidden = kind !== "md";
  $("#pv-placeholder").hidden = kind !== "ph";
}

function refreshPreview(force) {
  const pane = $("#previewpane");
  if (!pane || pane.hidden) return;
  const path = store.activePath;
  const title = $(".pv-title");
  title.textContent = path ? path.split("/").pop() + " \u2014 Preview" : "Preview";
  if (!path || store.vfs.read(path) === null) {
    show("ph");
    $("#pv-placeholder").textContent = "Open a file to see a live preview.";
    lastRendered = "";
    return;
  }
  const content = store.vfs.read(path) || "";
  if (!force && content === lastRendered) return;
  lastRendered = content;
  if (isHtml(path)) {
    show("html");
    $("#pv-iframe").srcdoc = content;
  } else if (isMd(path)) {
    show("md");
    $("#pv-md").innerHTML = marked.parse(content);
  } else {
    show("ph");
    $("#pv-placeholder").textContent = "No preview available for this file type.\n\nLive preview works for .html and .md files.";
  }
}

function scheduleRefresh() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => refreshPreview(false), 300);
}

export function initPreview() {
  bus.on("open", () => refreshPreview(true));
  bus.on("docchange", (path) => {
    if (path === store.activePath && previewVisible) scheduleRefresh();
  });
  const btn = $("#pvToggleBtn");
  if (btn) btn.onclick = () => togglePreview();
  const close = $(".pv-close");
  if (close) close.onclick = () => setPreviewVisible(false);
}
