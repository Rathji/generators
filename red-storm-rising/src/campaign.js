import { makePlatform, rand, pick, clamp } from './world.js';

const MER = (lat) => 60 * Math.cos(lat * Math.PI / 180);

export const MISSIONS = [
  {
    id: 'intercept', title: 'OP "ICE CURTAIN" — INTERCEPT THE KIROV',
    brief: 'SIGINT indicates the Kirov battlegroup has slipped the GIUK gap and is racing for the North Atlantic convoy routes at 20 knots. If the Kirov reaches the open ocean, it will tear the convoy lanes apart.\n\nYour task: find the battlegroup, penetrate its ASW screen, and put the Kirov on the bottom. Escorts are a secondary target. Exfiltrate south when it is done.',
    primary: 'Sink the Kirov',
    secondary: 'Sink or disable 3 escort ships',
    objectives: [
      { type: 'sink', cls: 'kirov', label: 'Sink the KIROV' },
      { type: 'sink-class', cls: 'surface-warship', count: 3, label: 'Sink or disable 3 escorts' },
    ],
    group: ['kirov', 'sovremenny', 'krivak', 'krivak', 'udaloy'],
    screen: ['victor', 'victor'],
    area: { lon: -25, lat: 57 },
    startBear: 190, startRange: 22, groupCourse: 235, groupSpeed: 20,
    objPrimary: { type: 'sink', cls: 'kirov', label: 'Sink the KIROV' },
    objSecondary: { type: 'sink-class', cls: 'surface-warship', count: 3, label: 'Sink or disable 3 escorts' },
  },
  {
    id: 'convoy', title: 'OP "NARROW WINDOW" — SOVIET SUPPLY ECHELON',
    brief: 'A Soviet supply echelon bound for the Kola Peninsula is slipping south of Iceland to avoid our strike aircraft. Twenty thousand tons of ammunition aboard those merchants will fuel the Northern Fleet.\n\nIntercept the echelon and sink at least 30,000 tons of shipping. The SSN screen is hunting you — do not let them find you first.',
    primary: 'Sink 30,000 tons of shipping',
    secondary: 'Sink the screen SSNs',
    objectives: [
      { type: 'tonnage', tons: 30000, label: 'Sink 30,000 tons of shipping' },
      { type: 'sink-class', cls: 'sub', count: 2, label: 'Sink the screen SSNs' },
    ],
    convoy: { cols: 6, rows: 4, ships: 24, escorts: ['krivak', 'krivak', 'sovremenny'], course: 30, speed: 14 },
    screen: ['victor', 'kilo'],
    area: { lon: -15, lat: 61 },
    startBear: 340, startRange: 18, groupCourse: 30, groupSpeed: 14,
    objPrimary: { type: 'tonnage', tons: 30000, label: 'Sink 30,000 tons of shipping' },
    objSecondary: { type: 'sink-class', cls: 'sub', count: 2, label: 'Sink the screen SSNs' },
  },
  {
    id: 'duel', title: 'OP "DRY HELL" — BARRIER PATROL',
    brief: 'Soviet attack boats are walling off the Denmark Strait with an ASW barrier. An Alfa — the fastest submarine afloat — is at the center of it. Our ballistic-missile boats are waiting to transit.\n\nYour task: clear the barrier. Two Soviet boats minimum. The Alfa is dangerous at close range — use standoff weapons and the deep water.',
    primary: 'Sink 2 Soviet submarines',
    secondary: 'Sink the Alfa',
    objectives: [
      { type: 'sink-class', cls: 'sub', count: 2, label: 'Sink 2 Soviet submarines' },
      { type: 'sink', cls: 'alfa', label: 'Sink the ALFA' },
    ],
    group: null,
    screen: ['alfa', 'victor', 'victor'],
    area: { lon: -28, lat: 64 },
    startBear: 180, startRange: 14, groupCourse: 250, groupSpeed: 12,
    objPrimary: { type: 'sink-class', cls: 'sub', count: 2, label: 'Sink 2 Soviet submarines' },
    objSecondary: { type: 'sink', cls: 'alfa', label: 'Sink the ALFA' },
  },
  {
    id: 'climax', title: 'OP "RED OCTOBER" — THE KOLA STRIKE',
    brief: 'The war hangs in the balance. The Soviet flagship Kirov is anchored at Severomorsk — and the entire Northern Fleet surface group is on a full combat sortie with her.\n\nThis is the decisive action of the Atlantic campaign. Sink the Kirov. Everything else is negotiable.',
    primary: 'Sink the Kirov',
    secondary: 'Sink 5 warships total',
    objectives: [
      { type: 'sink', cls: 'kirov', label: 'Sink the KIROV' },
      { type: 'sink-class', cls: 'surface-warship', count: 5, label: 'Sink 5 warships total' },
    ],
    group: ['kirov', 'slava', 'sovremenny', 'sovremenny', 'krivak', 'udaloy', 'kashin'],
    screen: ['oscar', 'alfa', 'victor'],
    area: { lon: 18, lat: 68 },
    startBear: 200, startRange: 26, groupCourse: 250, groupSpeed: 18,
    objPrimary: { type: 'sink', cls: 'kirov', label: 'Sink the KIROV' },
    objSecondary: { type: 'sink-class', cls: 'surface-warship', count: 5, label: 'Sink 5 warships total' },
  },
];

const CONVOY_COURSE = { from: { lon: -72, lat: 40 }, to: { lon: -8, lat: 49 } };

export class Campaign {
  constructor() {
    this.day = 1;
    this.tonnage = 0;
    this.kills = [];
    this.convoysDelivered = 0;
    this.convoysLost = 0;
    this.news = [];
    this.missions = MISSIONS.map((m, i) => ({ ...m, state: i === 0 ? 'available' : 'locked' }));
    this.currentMission = null;
    this.over = false;
    this.overType = null;
  }

  unlockNext() {
    const idx = this.missions.findIndex(m => m.state === 'available');
    if (idx >= 0 && idx < this.missions.length - 1) this.missions[idx + 1].state = 'available';
    if (idx === this.missions.length - 1) {
      this.over = true; this.overType = 'victory';
    }
  }

  missionResults(world) {
    this.tonnage += world.missionStats.tonnage;
    for (const s of world.missionStats.sunk) this.kills.push(s);
    const idx = this.missions.findIndex(m => m.id === world.mission.id);
    if (idx >= 0) this.missions[idx].state = 'complete';
  }

  generateWorld(mission) {
    const m = mission;
    m.objectives = (m.objectives || []).map(o => ({ ...o, met: false, metCount: 0 }));
    const w = new this._worldCtor(m, {});
    const pl = makePlatform('los-angeles', { isPlayer: true, speed: 8 });
    const mp = this._geoToWorld(m.area, 0, 0);
    pl.x = mp.x; pl.y = mp.y;
    pl.heading = m.groupCourse + 180;
    pl.speedCmd = 8; pl.depthCmd = 150; pl.depth = 150;
    pl.silent = true;
    w.setupPlayer(pl);

    let leader = null;
    if (m.group) {
      leader = w.spawn(makePlatform(m.group[0], { x: mp.x, y: mp.y, heading: m.groupCourse, speed: m.groupSpeed }));
      leader.ai = { mode: 'sag', course: m.groupCourse, speed: m.groupSpeed };
      const escorts = m.group.slice(1).map(cls => w.spawn(makePlatform(cls, { x: mp.x + rand(-2, 2), y: mp.y + rand(-2, 2), heading: m.groupCourse, speed: m.groupSpeed })));
      w.makeFormation(leader, escorts);
    }
    if (m.screen) {
      const subs = m.screen.map((cls, i) => {
        const s = w.spawn(makePlatform(cls, { x: mp.x + rand(-14, 14), y: mp.y + rand(-14, 14), heading: m.groupCourse, speed: m.groupSpeed }));
        s.ai = { mode: 'patrol', course: m.groupCourse, speed: m.groupSpeed, patrolPt: { x: s.x + rand(-8, 8), y: s.y + rand(-8, 8) } };
        s.depthCmd = 150; s.depth = 150;
        return s;
      });
    }
    if (m.convoy) {
      this.spawnConvoy(w, m);
    }
    this._placePlayerApproach(w, m);
    w.objectives = { primary: m.objPrimary, secondary: m.objSecondary };
    return w;
  }

  spawnConvoy(w, m) {
    const c = m.convoy;
    const center = this._geoToWorld(m.area, 0, 0);
    const cols = [];
    for (let ci = 0; ci < c.cols; ci++) {
      const col = [];
      for (let ri = 0; ri < c.rows; ri++) {
        const off = ci * 1.1 - (c.cols - 1) * 0.55;
        const back = ri * 0.9;
        const s = w.spawn(makePlatform('merchant', { x: center.x + off, y: center.y + back, heading: c.course, speed: c.speed }));
        s.ai = { mode: 'convoy', course: c.course, speed: c.speed, col: ci, row: ri };
        col.push(s);
      }
      cols.push(col);
    }
    const escorts = c.escorts.map((cls, i) => {
      const e = w.spawn(makePlatform(cls, { x: center.x + (i === 0 ? -3 : 3), y: center.y + (i === 0 ? 1 : -1), heading: c.course, speed: c.speed }));
      e.ai = { mode: 'transit', course: c.course, speed: c.speed };
      return e;
    });
  }

  _placePlayerApproach(w, m) {
    const mp = this._geoToWorld(m.area, 0, 0);
    const brg = m.startBear;
    const dist = m.startRange;
    w.player.x = mp.x + Math.sin(brg * Math.PI / 180) * dist;
    w.player.y = mp.y + Math.cos(brg * Math.PI / 180) * dist;
    w.player.heading = brg + 180;
    w.player.headingCmd = w.player.heading;
  }

  _geoToWorld(geo, dx, dy) {
    return { x: (geo.lon + 60) * MER(geo.lat), y: geo.lat * 60 };
  }

  setWorldCtor(ctor) { this._worldCtor = ctor; }

  advanceDay(world) {
    this.day += 1;
    this.convoysDelivered += Math.random() < 0.7 ? 1 : 0;
    this.convoysLost += Math.random() < 0.4 ? 1 : 0;
    const snippets = [
      'NATO CINCLANT: convoy HX-214 delivered safe to Liverpool.',
      'TASS reports 40,000 tons of NATO shipping sunk in the Atlantic.',
      'Soviet Backfires hit a resupply convoy; two escorts lost.',
      'Keflavik reports heavy ASW activity in the GIUK gap.',
      'Naval intelligence: Kirov refueled at sea, proceeding west.',
      'Two Soviet SSBNs tracked leaving Kola for patrol stations.',
    ];
    this.news.unshift(pick(snippets));
    if (this.news.length > 8) this.news.pop();
  }
}
