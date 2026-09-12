import { el, $ } from "./dom.js";

export function toast(message, { tone = "info", timeout = 3600 } = {}) {
  const ctn = $("#puToastCtn");
  if (!ctn) return null;
  const node = el("div.pu-toast", { text: String(message), role: "status" });
  if (tone === "error") node.style.borderLeftColor = "#b42318";
  if (tone === "success") node.style.borderLeftColor = "#067647";
  ctn.appendChild(node);
  const remove = () => node.remove();
  if (timeout) setTimeout(remove, timeout);
  return { node, remove };
}
