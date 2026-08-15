// Shared mutable singleton for UI modules.
export const S = {
  game: null,
  screen: 'title', // 'title' | 'map' | 'town' | 'hero' | 'combat'
  selectedHeroId: null,
  hover: null,      // {q, r}
  pathPreview: null, // [{q,r}, ...]
  battle: null,
  battleMeta: null,
};

export function setScreen(name) {
  S.screen = name;
  const gameScr = document.getElementById('gameScreen');
  const titleScr = document.getElementById('titleScreen');
  const combatScr = document.getElementById('combatScreen');
  for (const el of [gameScr, titleScr, combatScr]) el.hidden = name === 'title' ? el !== titleScr : (el !== gameScr && el !== combatScr);
  // overlays
  for (const id of ['townScreen', 'heroScreen']) {
    document.getElementById(id).hidden = true;
  }
  if (name === 'combat') { gameScr.hidden = true; combatScr.hidden = false; titleScr.hidden = true; }
  if (name === 'map') { combatScr.hidden = true; gameScr.hidden = false; titleScr.hidden = true; }
  if (name === 'title') { gameScr.hidden = true; combatScr.hidden = true; titleScr.hidden = false; }
}
