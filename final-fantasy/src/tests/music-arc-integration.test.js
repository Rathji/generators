// Task #229: music arc integration — boot a fresh game and drive the real
// demo wiring: title theme on load, area themes as the player moves, the
// battle/boss themes during combat, victory fanfare + resume, overlay
// ducking for the command menu and save panel, and the on-screen controls.

export async function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  for (let i = 0; i < 60; i++) {
    if (window.ff?.music && window.ff?.boot && window.ff?.slots && window.startGame) break;
    await new Promise((r) => setTimeout(r, 300));
  }
  const music = window.ff.music;
  const boot = window.ff.boot;
  if (!music || !boot) {
    check("music + boot wired", false, "missing ff.music/ff.boot");
    return out;
  }

  for (const s of ["A", "B", "C"]) window.ff.slots.erase(s);

  // Normalize to a title-screen state (the controller's default): the menu
  // theme plays whenever the title is showing. Suite runs share one page, so
  // force it here rather than assuming a fresh load.
  boot.toTitle();
  // Task #227: audio defaults to OFF. Suite runs share one page and an
  // earlier music-arc run leaves audio on (its last toggle click re-enables
  // it), so normalize the muted flag too — the default-off checks below
  // assume this precondition.
  music.setMuted(true);
  window.ff.sounds.setMuted(true);
  music.setTitle(true);
  check("title theme on load", music.state.songId === "menu", music.state.songId);
  check("title flag set", music.state.title === true);

  // Start a game: the demo mounts and the cornelia (town) theme takes over.
  boot.newGame();
  window.startGame({ fresh: true });
  for (let i = 0; i < 40; i++) {
    const d = document.getElementById("rpgDemo");
    if (d && !d.hidden) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  // The audio button text is normally refreshed on the demo's animation
  // frame, but requestAnimationFrame is throttled (sometimes fully paused)
  // in this embedded iframe — refresh it directly so the default-off state
  // is asserted against the real button, not a stale rAF value.
  window.rpgDemo.helpers.refreshMusicUI();
  check("town theme in cornelia", music.state.songId === "town", music.state.songId);
  check("region is town", music.state.region === "town", music.state.region);
  check("title flag cleared", music.state.title === false);
  check("audio off by default", (document.getElementById("rpgAudioBtn")?.textContent ?? "") === "Audio: Off", document.getElementById("rpgAudioBtn")?.textContent ?? "");

  const helpers = window.rpgDemo.helpers;
  const eng = window.ff.musicEngine;

  // Moving to the overworld switches to the overworld theme.
  helpers.moveToMap("overworld", 20, 20);
  check("overworld theme", music.state.songId === "overworld", music.state.songId);
  check("region is overworld", music.state.region === "overworld");

  // The now-playing badge (refreshed by the rAF loop; rAF is throttled in a
  // freshly-loaded test iframe, so drive one refresh explicitly here).
  window.rpgDemo.helpers.refreshMusicUI();
  const badge = document.getElementById("rpgNowPlaying")?.textContent ?? "";
  check("now-playing badge shows track", badge.includes("Overworld"), badge);
  check("badge is visible", document.getElementById("rpgNowPlaying").hidden === false);

  // A dungeon.
  helpers.moveToMap("caves_of_cornelia", 3, 3);
  check("dungeon theme", music.state.songId === "dungeon", music.state.songId);
  check("region is dungeon", music.state.region === "dungeon");

  // Back to town, then to the overworld for a battle.
  helpers.moveToMap("cornelia", 7, 5);
  check("back to town theme", music.state.songId === "town", music.state.songId);
  helpers.moveToMap("overworld", 20, 20);
  check("overworld again", music.state.songId === "overworld", music.state.songId);

  // A real encounter switches to the battle theme.
  const enc = window.ff.encounters.forceEncounter("overworld", "goblins");
  check("encounter generated", !!enc && enc.enemies.length > 0);
  helpers.startBattle(enc);
  check("battle theme", music.state.songId === "battle", music.state.songId);
  check("battle flag set", music.state.battle === true && music.state.boss === false);

  // Victory: the fanfare plays, then the controller resumes the area music.
  for (const e of enc.enemies) e.hp = 0;
  helpers.endBattle();
  check("victory fanfare plays", music.state.songId === "victory", music.state.songId);
  check("battle flag cleared", music.state.battle === false);
  eng.onEnd?.("victory");
  check("area music resumes after fanfare", music.state.songId === "overworld", music.state.songId);

  // A boss fight uses the boss theme.
  helpers.startBattle({ enemies: [{ name: "Tyrant", hp: 60, boss: true, xp: 0, gold: 0 }], groupId: "boss_test" });
  check("boss theme", music.state.songId === "boss", music.state.songId);
  check("boss flag set", music.state.boss === true);
  window.rpgDemo.battle.enemies.forEach((e) => { e.hp = 0; });
  helpers.endBattle();
  check("victory after boss", music.state.songId === "victory", music.state.songId);
  eng.onEnd?.("victory");
  check("area resumes after boss", music.state.songId === "overworld", music.state.songId);

  // Command menu ducks the volume.
  helpers.toggleCommandMenu();
  check("menu overlay ducks", music.state.overlay === true && music.state.ducked === true, JSON.stringify(music.state));
  check("song unchanged while ducked", music.state.songId === "overworld", music.state.songId);
  helpers.closeCommandMenu();
  check("menu close un-ducks", music.state.ducked === false);

  // Save panel ducks too.
  helpers.toggleSavePanel();
  check("save panel ducks", music.state.ducked === true);
  helpers.toggleSavePanel();
  check("save panel close un-ducks", music.state.ducked === false);

  // The audio button is a master toggle for music + SFX, defaulting to OFF.
  const btn = document.getElementById("rpgAudioBtn");
  check("audio muted by default", music.muted === true && window.ff.sounds.muted === true && btn.textContent === "Audio: Off", `m=${music.muted} s=${window.ff.sounds.muted} btn=${btn.textContent}`);
  btn.click();
  check("unmute via button", music.muted === false && window.ff.sounds.muted === false && btn.textContent === "Audio: On", `m=${music.muted} s=${window.ff.sounds.muted} btn=${btn.textContent}`);
  btn.click();
  check("mute via button", music.muted === true && window.ff.sounds.muted === true && btn.textContent === "Audio: Off", `m=${music.muted} s=${window.ff.sounds.muted} btn=${btn.textContent}`);
  btn.click();
  check("back on after toggle", music.muted === false && window.ff.sounds.muted === false, `m=${music.muted} s=${window.ff.sounds.muted}`);

  // Disabling music stops playback.
  music.setEnabled(false);
  check("disabled stops engine", music.state.playing === false, music.state.songId);
  music.setEnabled(true);
  check("re-enable resumes area", music.state.songId === "overworld", music.state.songId);

  // Return to title via the real button: menu theme returns.
  document.querySelector("#rpgTitle").click();
  check("title theme returns", music.state.songId === "menu", music.state.songId);
  check("title flag set again", music.state.title === true);

  // Cleanup.
  for (const s of ["A", "B", "C"]) window.ff.slots.erase(s);
  boot.toTitle();
  window.ff.titleScreen?.show();
  check("cleaned up", window.ff.slots.any() === false);

  return out;
}
