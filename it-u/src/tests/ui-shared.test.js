// src/tests/ui-shared.test.js — DOM tests for the shared view scaffolding
// (src/modules/shared.js): the format helpers, the standard view panel and
// breadcrumb bar, and the three promise-based dialogs (confirm, prompt, modal).
// Run in the live page:
//   await import("./src/tests/ui-shared.test.js").then((m) => m.run())
//
// These run against the real document, so every overlay is cleaned up in a
// finally block — a stranded overlay would sit on top of the app.

import { runTests, assert, assertEq } from "./harness.js";
import { viewPanel, breadcrumbs, relTime, fmtDate, fmtBytes, openModal, confirmDialog, promptPanel } from "../modules/shared.js";

const lastOverlay = () => {
  const all = document.querySelectorAll(".kb-modal-overlay");
  return all[all.length - 1] || null;
};
const cleanOverlays = () => document.querySelectorAll(".kb-modal-overlay").forEach((el) => el.remove());

export async function run() {
  return runTests([
    {
      name: "relTime formats each age bracket and the 48h day boundary",
      fn: async () => {
        assertEq(relTime(null), "—");
        assertEq(relTime(0), "—");
        assertEq(relTime(Date.now() - 30 * 1000), "just now");
        assertEq(relTime(Date.now() - 5 * 60000), "5 min ago");
        assertEq(relTime(Date.now() - 3 * 3600000), "3 h ago");
        assertEq(relTime(Date.now() - 47 * 3600000), "47 h ago");
        assertEq(relTime(Date.now() - 49 * 3600000), "2 d ago");
        assertEq(relTime(Date.now() - 72 * 3600000), "3 d ago");
      },
    },
    {
      name: "fmtDate renders a locale date (or a dash) and fmtBytes scales",
      fn: async () => {
        assertEq(fmtDate(null), "—");
        assert(fmtDate(Date.now()).includes(String(new Date().getFullYear())), "the year is present");
        assertEq(fmtBytes(null), "—");
        assertEq(fmtBytes(512), "512 B");
        assertEq(fmtBytes(2048), "2.0 KB");
        assertEq(fmtBytes(1048576), "1.00 MB");
        assertEq(fmtBytes(1536000), "1.46 MB");
      },
    },
    {
      name: "viewPanel builds the standard view with crumb, title, desc, actions and body",
      fn: async () => {
        const body = document.createElement("div");
        body.className = "kb-body";
        const actions = document.createElement("button");
        actions.textContent = "Act";
        const panel = viewPanel({ crumb: "IT-U / Assets", title: "Assets", desc: "Everything", body, actions });
        assert(panel.classList.contains("kb-view"), "kb-view root");
        assertEq(panel.querySelector(".kb-view-title").textContent, "Assets");
        assertEq(panel.querySelector(".kb-breadcrumb").textContent, "IT-U / Assets");
        assertEq(panel.querySelector(".kb-view-desc").textContent, "Everything");
        assert(panel.querySelector(".kb-body"), "body mounted");
        assert(panel.querySelector(".kb-view-title-row button"), "actions mounted");

        const bare = viewPanel({ title: "Bare" });
        assertEq(bare.querySelector(".kb-breadcrumb"), null, "no crumb when omitted");
        assertEq(bare.querySelector(".kb-view-desc"), null, "no desc when omitted");
      },
    },
    {
      name: "breadcrumbs marks the last part as the current page",
      fn: async () => {
        const bc = breadcrumbs(["IT-U", "Assets", "Switches"]);
        const spans = bc.querySelectorAll("span");
        assertEq(spans.length, 3);
        assertEq(spans[0].textContent, "IT-U / ");
        assertEq(spans[2].textContent, "Switches");
        assert(spans[2].classList.contains("kb-bc-current"), "last is current");
        assert(!spans[0].classList.contains("kb-bc-current"), "earlier parts are not");

        const one = breadcrumbs(["Solo"]);
        assertEq(one.querySelectorAll("span").length, 1);
        assert(one.querySelector(".kb-bc-current"), "a single part is current");
      },
    },
    {
      name: "openModal mounts the overlay and its error helpers toggle",
      fn: async () => {
        cleanOverlays();
        const child = document.createElement("p");
        child.className = "kb-test-child";
        child.textContent = "hi";
        const m = openModal({ title: "Edit", description: "desc", children: [child], wide: true });
        try {
          assert(m.overlay.isConnected, "overlay in the document");
          const box = m.overlay.querySelector(".kb-modal");
          assert(box.classList.contains("kb-modal-wide"), "wide variant");
          assertEq(m.overlay.querySelector(".kb-modal-title").textContent, "Edit");
          assertEq(m.overlay.querySelector(".kb-modal-text").textContent, "desc");
          assert(m.overlay.querySelector(".kb-test-child"), "child mounted");
          assert(m.actions.classList.contains("kb-modal-actions"), "actions row exposed");
          const err = m.overlay.querySelector(".kb-form-error");
          assertEq(err.hidden, true, "error hidden initially");
          m.showError("Nope");
          assertEq(err.hidden, false, "showError reveals it");
          assertEq(err.textContent, "Nope");
          m.clearError();
          assertEq(err.hidden, true, "clearError hides it");
          assertEq(err.textContent, "");
        } finally {
          m.close();
        }
        assertEq(m.overlay.isConnected, false, "close removes the overlay");
      },
    },
    {
      name: "openModal closes on Escape and on a backdrop click",
      fn: async () => {
        cleanOverlays();
        const m = openModal({ title: "Esc" });
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        assertEq(m.overlay.isConnected, false, "Escape closes it");
        const m2 = openModal({ title: "Backdrop" });
        m2.overlay.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        assertEq(m2.overlay.isConnected, false, "backdrop click closes it");
      },
    },
    {
      name: "confirmDialog resolves true on confirm and false on cancel",
      fn: async () => {
        cleanOverlays();
        const okPromise = confirmDialog({ title: "Sure?", message: "m", confirmLabel: "Yes", danger: true });
        const okOverlay = lastOverlay();
        const okBtns = okOverlay.querySelectorAll("button");
        assertEq(okBtns[0].textContent, "Cancel");
        assertEq(okBtns[1].textContent, "Yes");
        assert(okBtns[1].classList.contains("kb-btn-danger"), "danger styling");
        okBtns[1].click();
        assertEq(await okPromise, true, "confirm resolves true");
        assertEq(okOverlay.isConnected, false, "overlay removed");
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); // self-remove the esc listener

        const cancelPromise = confirmDialog({ title: "Sure again?" });
        const cancelOverlay = lastOverlay();
        cancelOverlay.querySelectorAll("button")[0].click();
        assertEq(await cancelPromise, false, "cancel resolves false");
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      },
    },
    {
      name: "confirmDialog resolves false when the backdrop is clicked",
      fn: async () => {
        cleanOverlays();
        const p = confirmDialog({ title: "Backdrop" });
        const overlay = lastOverlay();
        overlay.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        assertEq(await p, false, "backdrop cancels");
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      },
    },
    {
      name: "promptPanel returns the trimmed value or null",
      fn: async () => {
        cleanOverlays();
        const p = promptPanel({ title: "Name", initial: "seed", placeholder: "ph" });
        const overlay = lastOverlay();
        const ta = overlay.querySelector("textarea");
        assertEq(ta.value, "seed", "initial value prefilled");
        assertEq(ta.placeholder, "ph");
        ta.value = "  hello  ";
        overlay.querySelectorAll("button")[1].click();
        assertEq(await p, "hello", "OK resolves with the trimmed value");

        const p2 = promptPanel({ title: "Name" });
        const overlay2 = lastOverlay();
        overlay2.querySelectorAll("button")[0].click();
        assertEq(await p2, null, "Cancel resolves null");
      },
    },
  ]);
}
