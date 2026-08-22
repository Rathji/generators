// Task #208: App boot flow — connects the interactive title screen to the
// boot system and the playable demo harness. Loaded last so window.startGame
// (from src/demo/rpg-demo.js) already exists. Dev demo harnesses (?demo=...)
// take over and this flow stays out of the way.

import { mountTitleScreen, showTitleScreen } from "./title-screen.js";

export function bootApp() {
  const params = new URLSearchParams(location.search);
  if (params.get("demo")) return;

  mountTitleScreen({
    onNewGame: () => {
      const boot = window.ff?.boot;
      if (!boot) return;
      boot.newGame();
      window.startGame?.({ fresh: true });
    },
    onContinue: (slot) => {
      const boot = window.ff?.boot;
      if (!boot) return;
      const res = boot.continue(slot);
      if (res.ok) {
        window.startGame?.({ fresh: false, slot });
      } else if (res.reason) {
        console.warn("Continue failed:", res.reason);
      }
    },
  });

  // Return-to-Title hook for the in-game Title button.
  if (!window.ff.titleScreen) {
    window.ff.titleScreen = { show: showTitleScreen, mount: mountTitleScreen };
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootApp);
} else {
  bootApp();
}
