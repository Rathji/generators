import { Campaign } from './campaign.js';
import { UI } from './ui.js';
import { Renderer } from './render.js';
import { World } from './world.js';

const campaign = new Campaign();
campaign.setWorldCtor(World);

const ui = new UI();
const canvas = document.getElementById('mapCanvas');
const renderer = new Renderer(canvas);
ui.bind(null, campaign, renderer);

window.addEventListener('resize', () => renderer.resize());
if (window.ResizeObserver) {
  new ResizeObserver(() => renderer.resize()).observe(document.getElementById('mapWrap'));
}

ui.buildTitle();
ui.bindCanvas(canvas);
ui.bindKeyboard();
ui.showHint();

let lastSim = performance.now();
let endShown = false;
let lastWorld = null;

function simTick() {
  const now = performance.now();
  const dt = Math.min(0.25, (now - lastSim) / 1000);
  lastSim = now;
  const world = ui.world;
  if (world !== lastWorld) { lastWorld = world; endShown = false; }
  if (world && !world.over && !ui.state.paused) {
    world.step(dt * ui.state.timeComp);
  }
  ui.update(dt, now);
  if (world && world.over && !endShown) {
    endShown = true;
    setTimeout(() => ui.showEnd(world, campaign), 1000);
  }
}

setInterval(simTick, 100);

function frame(now) {
  const world = ui.world;
  if (world) {
    renderer.draw(world, ui, campaign);
  } else {
    renderer.draw(null, ui, campaign);
  }
  ui.update((now - lastSim) / 1000, now);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.rsr = {
  get world() { return ui.world; },
  campaign, ui, renderer,
  startMission: (id) => {
    const m = campaign.missions.find(x => x.id === id) || campaign.missions[0];
    ui.launchMission(m);
    return true;
  },
};

if (location.hash === '#sandbox') {
  window.rsr.startMission('intercept');
  const w = ui.world;
  w.debug.showAll = true;
  const sag = w.platforms.find(p => p.cls === 'kirov');
  w.player.x = sag.x + 4; w.player.y = sag.y + 4;
  w.player.heading = 225; w.player.headingCmd = 225;
  w.player.speedCmd = 5;
}
