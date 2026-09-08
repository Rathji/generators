// src/framework/toast.js — transient bottom notification.

export function toast(message, type = "info", duration = 2800) {
  const ctn = document.getElementById("toastCtn");
  if (!ctn) return;
  const t = document.createElement("div");
  t.className = "toast" + (type && type !== "info" ? " " + type : "");
  t.textContent = message;
  ctn.appendChild(t);
  requestAnimationFrame(() => t.classList.add("show"));
  setTimeout(() => {
    t.classList.remove("show");
    setTimeout(() => t.remove(), 320);
  }, duration);
}
