import { RESOURCES, RES_BY_ID, CREATURES } from './data.js';
import { S } from './app.js';
import { heroMaxMove } from './engine.js';

export function updateTopbar(game) {
  const cal = document.getElementById('calendarEl');
  const monthName = ['I', 'II', 'III', 'IV'][game.month - 1] || 'I';
  cal.textContent = `Month ${monthName} · Week ${game.week} · Day ${game.day}`;
  const res = document.getElementById('resEl');
  res.innerHTML = '';
  const p = game.players[game.turn];
  for (const r of RESOURCES) {
    const el = document.createElement('span');
    el.className = 'res';
    const ico = document.createElement('span');
    ico.className = 'resIcon';
    ico.style.background = r.color;
    el.appendChild(ico);
    el.appendChild(document.createTextNode(String(p.resources[r.id])));
    res.appendChild(el);
  }
  const turnEl = document.getElementById('turnEl');
  turnEl.textContent = `${p.name}'s turn`;
  const endBtn = document.getElementById('endTurnBtn');
  endBtn.disabled = game.gameOver !== null || game.players[game.turn].isAI;
  endBtn.hidden = game.players[game.turn].isAI;
  document.getElementById('gameScreen').hidden = false;
}

export function updateHeroStrip(game) {
  const strip = document.getElementById('heroStrip');
  strip.innerHTML = '';
  const myPid = 0;
  for (const hero of game.heroes) {
    if (hero.pid !== myPid) continue;
    const card = document.createElement('div');
    card.className = 'heroCard' + (S.selectedHeroId === hero.id ? ' sel' : '');
    const color = hero.pid === 0 ? '#4a7fd6' : '#c6483e';
    card.innerHTML = `
      <div class="port" style="background:${color}; border:2px solid ${S.selectedHeroId === hero.id ? '#ffdc78' : '#000'}"></div>
      <div>
        <div class="hName">${hero.name}</div>
        <div class="hSub">Lv ${hero.level} · Move ${hero.move}/${heroMaxMove(hero)}</div>
        <div class="hArmy"></div>
      </div>`;
    const army = card.querySelector('.hArmy');
    for (const st of hero.army) {
      if (!st) continue;
      const c = CREATURES[st.id];
      const span = document.createElement('span');
      span.style.background = ({ castle: '#4a7fd6', rampart: '#5aa05a', necropolis: '#8a5fc4', stronghold: '#c6483e' })[c.faction];
      span.textContent = st.count;
      army.appendChild(span);
    }
    card.addEventListener('click', () => {
      S.selectedHeroId = hero.id;
      updateHeroStrip(game);
      renderMapNow();
      if (stripClick) stripClick(hero);
    });
    strip.appendChild(card);
  }
}

let mapRedraw = null;
let stripClick = null;
export function setMapRedraw(fn) { mapRedraw = fn; }
export function setStripClick(fn) { stripClick = fn; }
export function renderMapNow() { if (mapRedraw) mapRedraw(); }

export function toast(msg, cls = '') {
  const ctn = document.getElementById('toastCtn');
  const el = document.createElement('div');
  el.className = 'toast ' + cls;
  el.textContent = msg;
  ctn.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

export function showModal(html) {
  const ctn = document.getElementById('modalCtn');
  ctn.innerHTML = `<div class="modal">${html}</div>`;
  ctn.hidden = false;
  return ctn;
}
export function hideModal() {
  document.getElementById('modalCtn').hidden = true;
  document.getElementById('modalCtn').innerHTML = '';
}
