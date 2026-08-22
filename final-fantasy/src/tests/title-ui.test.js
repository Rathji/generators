// Validation tests for Task #207/#208: the mounted title-screen UI and the
// demo's in-game save panel. These run in the live page, so they assert on
// the real DOM the boot flow builds. Saves written here are erased at the end.

export async function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const slots = window.ff?.slots;
  const boot = window.ff?.boot;
  if (!slots || !boot) {
    check("boot systems wired", false, "ff.slots/ff.boot missing");
    return out;
  }

  // The title UI mounts asynchronously after load — wait for it.
  for (let i = 0; i < 40; i++) {
    if (document.getElementById("titleMenu")) break;
    await new Promise((r) => setTimeout(r, 150));
  }

  // Start from a clean slate.
  for (const s of ["A", "B", "C"]) slots.erase(s);
  if (!document.getElementById("titleScreen")?.hidden) {
    window.ff.titleScreen?.show();
  }

  const menu = document.getElementById("titleMenu");
  check("title menu mounted", !!menu);
  const btns = [...document.querySelectorAll(".titleMenuItem")];
  check("three menu items", btns.length === 3);
  check("menu order", btns.map((b) => b.dataset.action).join(",") === "new,continue,delete");
  check("hint present", !!document.getElementById("titleHint"));
  check("slots panel hidden in menu mode", document.getElementById("titleSlots").hidden === true);
  check("new game cursor by default", btns[0].classList.contains("cursor"));
  check("continue disabled with no saves", btns[1].classList.contains("disabled"));
  check("delete disabled with no saves", btns[2].classList.contains("disabled"));

  // Write a save through the boot system, re-open the slots view, verify meta renders.
  boot.newGame();
  const sv = boot.saveCurrent("A");
  check("saveCurrent via boot ok", sv.ok === true);
  window.ff.titleScreen.show(); // re-render with the new save present
  document.querySelector('.titleMenuItem[data-action="continue"]').click();
  const slotsView = document.getElementById("titleSlots");
  check("slots view opened", slotsView.hidden === false);
  const slotA = document.querySelector('.titleSlot[data-slot="A"]');
  check("slot A shows meta", slotA && !slotA.classList.contains("empty") && slotA.querySelector(".tslMeta").textContent.includes("150g"));
  check("slot B still empty", document.querySelector('.titleSlot[data-slot="B"]').classList.contains("empty"));
  check("continue item now enabled", !btns[1].classList.contains("disabled"));

  // Delete mode marks the slot.
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  check("esc returns to menu", menu.hidden === false);
  document.querySelector('.titleMenuItem[data-action="delete"]').click();
  check("delete mode arms slot A", document.querySelector('.titleSlot[data-slot="A"]').classList.contains("armed"));

  // In-game save panel wiring (only if the demo was ever mounted — mount it).
  if (!document.getElementById("rpgDemo")) {
    await import("./../demo/rpg-demo.js").then((m) => m.startGame({})).catch(() => {});
  } else if (document.getElementById("rpgDemo").hidden) {
    // Another test left the demo mounted but hidden; bring it back up.
    window.startGame?.({});
  }
  await new Promise((r) => setTimeout(r, 200));
  const demo = document.getElementById("rpgDemo");
  check("demo harness exists", !!demo);
  if (demo) {
    const panel = document.getElementById("rpgSavePanel");
    check("save panel exists", !!panel);
    check("save panel hidden initially", panel.hidden === true);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "k" }));
    check("K toggles save panel open", panel.hidden === false);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "k" }));
    check("K toggles save panel closed", panel.hidden === true);
    check("save/title buttons present", !!document.getElementById("rpgSave") && !!document.getElementById("rpgTitle"));
  }

  // Clean up: no lingering saves, back to title.
  for (const s of ["A", "B", "C"]) slots.erase(s);
  boot.toTitle();
  window.ff.titleScreen?.show();
  check("cleaned up", slots.any() === false);

  return out;
}
