// SimAI — boot: initialize UI and the game loop.
import { init } from "./ui.js";
import { game } from "./game.js";

window.game = game;

init().catch(e => {
  console.error("SimAI boot failed:", e);
});
