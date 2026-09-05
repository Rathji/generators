(function () {
  "use strict";

  var W = 40, H = 40;
  var HW = Render.HW, HH = Render.HH;

  var TYPE = { NONE: 0, PARK: 1, POWER: 2, WTOWER: 3, POLICE: 4, GCPD: 5, ARK: 6, BAT: 7, WAYNE: 8, LIGHT: 9, MUSEUM: 10, UNI: 11, STAD: 12, HOSP: 13 };
  var ZONE = { NONE: 0, R: 1, C: 2, I: 3 };

  var DEV_POP = [0, 8, 20, 36, 60];
  var DEV_CJ = [0, 6, 16, 30, 55];
  var DEV_IJ = [0, 8, 22, 42, 85];

  var TOOLS = [
    { id: "road", name: "Road", cost: 8, sw: "#454a55", key: "1" },
    { id: "zr", name: "Residential", cost: 12, zone: ZONE.R, sw: "#a06b8a", key: "2" },
    { id: "zc", name: "Commercial", cost: 12, zone: ZONE.C, sw: "#5f7db6", key: "3" },
    { id: "zi", name: "Industrial", cost: 12, zone: ZONE.I, sw: "#8a8348", key: "4" },
    { id: "park", name: "Park", cost: 60, type: TYPE.PARK, sw: "#3f7d46", key: "5" },
    { id: "power", name: "Power Plant", cost: 1600, type: TYPE.POWER, sw: "#b06a3a", road: true, key: "6" },
    { id: "wtower", name: "Water Tower", cost: 280, type: TYPE.WTOWER, sw: "#4f8aa8", road: true, key: "7" },
    { id: "police", name: "Police Station", cost: 1100, type: TYPE.POLICE, sw: "#34517a", road: true, key: "8" },
    { id: "gcpd", name: "GCPD HQ", cost: 2400, type: TYPE.GCPD, sw: "#27405e", road: true, key: "9" },
    { id: "ark", name: "Arkham Asylum", cost: 2000, type: TYPE.ARK, sw: "#3f8a6a", road: true, key: "0" },
    { id: "bat", name: "Batcave", cost: 1600, type: TYPE.BAT, sw: "#20242c", road: true },
    { id: "wayne", name: "Wayne Tower", cost: 5000, type: TYPE.WAYNE, sw: "#5a6672", road: true },
    { id: "light", name: "Gotham Light", cost: 3200, type: TYPE.LIGHT, sw: "#c9a94f", road: true },
    { id: "museum", name: "Museum", cost: 2800, type: TYPE.MUSEUM, sw: "#d8d2c4", road: true },
    { id: "uni", name: "University", cost: 3600, type: TYPE.UNI, sw: "#8a5442", road: true },
    { id: "stad", name: "Stadium", cost: 4500, type: TYPE.STAD, sw: "#4a4f5e", road: true },
    { id: "hosp", name: "Hospital", cost: 2400, type: TYPE.HOSP, sw: "#b8bec6", road: true },
    { id: "wreck", name: "Bulldoze", cost: 0, wreck: true, sw: "#000" }
  ];
  var toolMap = {};
  for (var ti = 0; ti < TOOLS.length; ti++) toolMap[TOOLS[ti].id] = TOOLS[ti];

  var UPKEEP = {};
  UPKEEP[TYPE.PARK] = 3; UPKEEP[TYPE.POWER] = 60; UPKEEP[TYPE.WTOWER] = 12;
  UPKEEP[TYPE.POLICE] = 26; UPKEEP[TYPE.GCPD] = 70; UPKEEP[TYPE.ARK] = 80;
  UPKEEP[TYPE.BAT] = 0; UPKEEP[TYPE.WAYNE] = 110; UPKEEP[TYPE.LIGHT] = 70;
  UPKEEP[TYPE.MUSEUM] = 80; UPKEEP[TYPE.UNI] = 130; UPKEEP[TYPE.STAD] = 150; UPKEEP[TYPE.HOSP] = 120;

  var REFUND = 0.4;
  var START_MONEY = 30000;
  var HOUR_REAL = 1.5;

  var $ = function (id) { return document.getElementById(id); };

  var cv = $("cv"), stageEl = $("stage");
  var toolbarEl = $("toolbar"), infoTitleEl = $("infoTitle"), infoBodyEl = $("infoBody");
  var moneyEl = $("moneyEl"), popEl = $("popEl"), hapEl = $("hapEl"), crimeEl = $("crimeEl"), jobsEl = $("jobsEl");
  var dayEl = $("dayEl"), netEl = $("netEl"), taxRange = $("taxRange"), taxVal = $("taxVal");
  var newsText = $("newsText"), modalEl = $("modal");
  var modalTag = $("modalTag"), modalTitle = $("modalTitle"), modalText = $("modalText");
  var modalChoices = $("modalChoices"), modalChoiceBtns = $("modalChoiceBtns");
  var helpBtn = $("helpBtn"), newCityBtn = $("newCityBtn");

  var S = {
    W: W, H: H, money: START_MONEY, tax: 9, day: 1, hour: 6,
    speed: 1, paused: false,
    tool: null, cam: { ox: 0, oy: 0, z: 1 },
    time: 0, hourAcc: 0, saveAcc: 0,
    light: 0.9, net: 0, pop: 0, jobsC: 0, jobsI: 0, happy: 80, crimeAvg: 8, extJobs: 30,
    lastE: 1, crimeSpike: 0, happyAdj: 0,
    hasLegend: false,
    crimeView: false, coverView: false, sound: true,
    tot: {}, ach: {}, riddlesSolved: 0, bailouts: 0,
    cleanStreak: 0, won: false, fired: false,
    started: false, ghost: null
  };

  var land = new Uint8Array(W * H);
  var road = new Uint8Array(W * H);
  var zone = new Uint8Array(W * H);
  var type = new Uint8Array(W * H);
  var dev = new Uint8Array(W * H);
  var crime = new Float32Array(W * H);
  var poll = new Float32Array(W * H);
  var powerCov = new Uint8Array(W * H);
  var waterCov = new Uint8Array(W * H);
  var crimeCov = new Uint8Array(W * H);
  var parkBand = new Uint8Array(W * H);
  var indNear = new Uint8Array(W * H);
  var landVal = new Float32Array(W * H);
  S.land = land; S.road = road; S.zone = zone; S.type = type; S.dev = dev;
  S.crime = crime; S.power = powerCov; S.water = waterCov;

  function idx(x, y) { return y * W + x; }
  function inb(x, y) { return x >= 0 && y >= 0 && x < W && y < H; }

  var RIDDLES = [
    { q: "I speak without a mouth and hear without ears. I have no body, but I come alive with wind. What am I?", opts: ["An echo", "A mirror", "The wind"], a: 0 },
    { q: "The more of me you take, the more you leave behind. What am I?", opts: ["Footprints", "Time", "Breath"], a: 0 },
    { q: "I have cities, but no houses; forests, but no trees; and water, but no fish. What am I?", opts: ["A map", "A painting", "A dream"], a: 0 },
    { q: "What has a head, a tail, but no body?", opts: ["A coin", "A snake", "A question"], a: 0 },
    { q: "The more there is, the less you see. What am I?", opts: ["Darkness", "Fog", "Noise"], a: 0 },
    { q: "I have keys, but no locks. I have space, but no room. You can enter, but can't go outside. What am I?", opts: ["A keyboard", "A mirror", "A phone"], a: 0 }
  ];

  var EVENTS = [
    { tag: "SIGNAL LOCKED", type: "crime", min: 25, w: 1, crime: 9, money: -1200,
      text: "The Joker doused the [d] commercial strip with laughing gas. Officers are stretched thin across the district." },
    { tag: "GUNS ON THE STREET", type: "crime", min: 25, w: 1, crime: 7, money: -800,
      text: "A weapons shipment from the Iceberg Lounge hit the streets of [d]. Gun crime is climbing." },
    { tag: "PRISON BREAK", type: "crime", min: 25, w: 0.8, crime: 8,
      text: "An Arkham transport van was hit on the highway out of [d]. Someone very dangerous is loose in your city." },
    { tag: "RIOT", type: "crime", min: 45, w: 1.2, crime: 8, happy: -4,
      text: "Angry crowds are smashing windows in [d]. The riot squad is on its way, but so is the news crew." },
    { tag: "BAT-SIGNAL", type: "bat", min: 40, w: 2, crime: -11, happy: 5,
      text: "The Bat-Signal pierces the clouds above GCPD. Violent crime plummeted while the Bat was out." },
    { tag: "NIGHT PATROL", type: "bat", min: 55, w: 1.4, crime: -8, happy: 3,
      text: "A shadow moves across the rooftops of [d]. Several known fences have decided to relocate." },
    { tag: "CAT BURGLAR", type: "money", w: 1, money: -2400,
      text: "Catwoman cleaned out a downtown vault in [d]. Insurance refuses to cover a 'cat burglary'." },
    { tag: "WAYNE GRANT", type: "money", w: 1, money: 6000, happy: 4,
      text: "The Wayne Foundation granted the city funds for urban renewal in [d]. Generous. Suspiciously generous." },
    { tag: "RIDDLER'S CHARITY", type: "money", w: 1, money: 1500,
      text: "The Riddler outsmarted a bank heist in [d]... then donated the take to charity. Absolutely baffling." },
    { tag: "FEAR TOXIN", type: "happy", min: 0, w: 1, happy: -12, crime: 5,
      text: "Trace amounts of fear toxin were found in the water near [d]. Citizens insist the walls are melting." },
    { tag: "ACE CHEMICALS SPILL", type: "happy", w: 1, happy: -8, poll: 12,
      text: "A chemical spill at Ace Chemicals. The air over [d] tastes like regret." },
    { tag: "STREET FESTIVAL", type: "happy", w: 1, happy: 9,
      text: "The annual [d] street festival drew record crowds. Even the villains took the night off." },
    { tag: "BROADCAST BLACKOUT", type: "happy", w: 1, happy: -5,
      text: "The Riddler hijacked every screen in [d] for a 40-minute riddle. Nobody slept." },
    { tag: "SUSPICIOUS FIRE", type: "disaster", needZone: true, w: 1.1, crime: 5, happy: -3,
      text: "A suspicious fire in [d] claimed an entire building! Fire crews are overwhelmed." },
    { tag: "DEMOLITION GANG", type: "disaster", needZone: true, w: 0.9, crime: 6, happy: -2,
      text: "A rogue gang leveled a building in [d] with an armored car. The mayor's office is furious." },
    { tag: "BANK JOB FOILED", type: "happy", w: 1.4, happy: 6,
      text: "GCPD foiled a mid-day heist at the [d] branch of Gotham First. Solid work, for a change." },
    { tag: "TWO-FACED JUSTICE", title: "Two-Face", w: 1.05,
      hit: function (d) {
        if (Math.random() < 0.5) {
          S.money += 1000; S.happyAdj += 5; S.crimeSpike -= 3;
          return { txt: "A coin spun high above [d] and landed clean. Harvey Dent's people quietly wired a fortune to the city's victim fund. Whatever you think of the man — the math works.", bad: false };
        }
        S.money -= 500; S.crimeSpike += 7; S.happyAdj -= 3;
        return { txt: "The coin landed scarred. Half of [d] has been judged, and the verdict is chaos. The DA's office is refusing to comment.", bad: true };
      } },
    { tag: "IVY'S WRATH", title: "Poison Ivy", w: 0.8, needZone: true,
      hit: function () {
        var gone = destroyRandomBuilding(2);
        S.happyAdj -= 4; S.crimeSpike += 2;
        if (gone > 0) return { txt: "Kudzu and thorn-vines exploded through buildings in [d] overnight. Structural crews are cutting the city back out of the greenery.", bad: true };
        return { txt: "Vines crept through [d], crushed a few empty lots, then simply stopped. Ivy seems satisfied. For now.", bad: false };
      } },
    { tag: "CROC IN THE SEWERS", title: "Killer Croc", type: "crime", min: 20, w: 1, crime: 6, happy: -3, money: -500,
      text: "Something large is swimming the sewers under [d]. Manholes have been opened from the inside. The city recommends staying above street level, and honestly? Same." },
    { tag: "SEISMIC SURGE", title: "Earthquake", w: 0.7, needZone: true,
      hit: function () {
        var gone = destroyRandomBuilding(2 + Math.floor(Math.random() * 2));
        S.happyAdj -= 6; S.crimeSpike += 6;
        return { txt: "The ground rolled through [d] like a drumhead. Old Gotham's foundations were never built for this. Looters are already arguing over the cracks.", bad: gone > 0 };
      } },
    { tag: "RIVER ROSE", title: "Flood", w: 0.9, needZone: true,
      hit: function () {
        var cands = [];
        for (var i = 0; i < zone.length; i++) {
          if (zone[i] > 0 && dev[i] > 0) {
            var cx2 = i % W, cy2 = (i / W) | 0, near = false;
            for (var dx = -1; dx <= 1 && !near; dx++) for (var dy = -1; dy <= 1 && !near; dy++) if (inb(cx2 + dx, cy2 + dy) && land[idx(cx2 + dx, cy2 + dy)] === 1) near = true;
            if (near) cands.push(i);
          }
        }
        var gone = 0;
        while (gone < 2 && cands.length) {
          var t2 = pick(cands);
          dev[t2] = 0; timers[t2] = 0; gone++;
          cands.splice(cands.indexOf(t2), 1);
        }
        S.happyAdj -= 4; S.crimeSpike += 2;
        if (!gone) for (var p = 0; p < poll.length; p++) if (land[p] === 1) poll[p] = Math.min(100, poll[p] + 8);
        return { txt: "The Gotham River rose without warning and took the riverfront of [d] with it" + (gone ? ". Basements are lagoons now." : " — a foul tide soaked the embankment."), bad: true };
      } },
    { tag: "FREEZE FRONT", title: "Mr. Freeze", w: 0.9, happy: -4, money: -700,
      text: "A cryo-unit 'malfunction' flash-froze the water mains of [d]. Repairs will cost a fortune. The streets have never looked lovelier." },
    { tag: "BLACKGATE RIOT", title: "Breaking News", type: "crime", min: 30, w: 1, crime: 5, happy: -2,
      text: "A riot erupted on Blackgate Isle. Prisoners hold the cafeteria, the warden holds his coffee, and [d] holds its breath." }
  ];

  function rand(a, b) { return a + Math.random() * (b - a); }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  function mapTopText() {
    try {
      var t = window.root && root.districts;
      if (t) return root.districts.selectOne.evaluateItem;
    } catch (e) {}
    return "Old Gotham";
  }
  function flavorHeadline() {
    try {
      if (window.root && root.headlines) return root.headlines.selectOne.evaluateItem;
    } catch (e) {}
    return "City Council Votes To Raise Parking Fines";
  }

  function fillMap() {
    for (var i = 0; i < land.length; i++) { land[i] = 0; road[i] = 0; zone[i] = 0; type[i] = 0; dev[i] = 0; crime[i] = 0; poll[i] = 0; }
    var c0 = rand(2, 6);
    var amp = rand(3, 6);
    for (var x = 0; x < W; x++) {
      var c = c0 + amp * 0.5 * Math.sin(x * 0.4) + amp * 0.5 * Math.sin(x * 0.11 + 2);
      for (var y = 0; y < H; y++) {
        var d = Math.abs(y - x + c);
        if (d < 1.5) land[idx(x, y)] = 1;
      }
    }
    for (var x2 = 0; x2 < W; x2++) {
      var c2 = c0 + amp * 0.5 * Math.sin(x2 * 0.4) + amp * 0.5 * Math.sin(x2 * 0.11 + 2);
      for (var y2 = 0; y2 < H; y2++) {
        var d2 = Math.abs(y2 - x2 + c2);
        if (d2 < 3.2) {
          var j = idx(x2, y2);
          if (land[j] === 0 && Math.random() < 0.3) land[j] = 1;
        }
      }
    }
    for (var x3 = 0; x3 < W; x3++) {
      var c3 = c0 + amp * 0.5 * Math.sin(x3 * 0.4) + amp * 0.5 * Math.sin(x3 * 0.11 + 2);
      var yy = Math.round(x3 - c3);
      if (inb(x3, yy - 1) && land[idx(x3, yy - 1)] === 0) land[idx(x3, yy - 1)] = 1;
      if (inb(x3, yy + 1) && land[idx(x3, yy + 1)] === 0) land[idx(x3, yy + 1)] = 1;
    }
  }

  function nearRoadAt(x, y) {
    if (!inb(x, y)) return false;
    if (road[idx(x, y)]) return true;
    if (inb(x + 1, y) && road[idx(x + 1, y)]) return true;
    if (inb(x - 1, y) && road[idx(x - 1, y)]) return true;
    if (inb(x, y + 1) && road[idx(x, y + 1)]) return true;
    if (inb(x, y - 1) && road[idx(x, y - 1)]) return true;
    return false;
  }

  function flood(sources, radius, landArr, roadArr) {
    var n = land.length;
    var out = new Float32Array(n);
    var q = [];
    for (var s = 0; s < sources.length; s++) { q.push(sources[s]); out[sources[s]] = 1; }
    var head = 0;
    var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    while (head < q.length) {
      var cur = q[head++];
      var cx = cur % W, cy = (cur / W) | 0;
      for (var k = 0; k < 4; k++) {
        var nx = cx + dirs[k][0], ny = cy + dirs[k][1];
        if (!inb(nx, ny)) continue;
        var ni = ny * W + nx;
        if (out[ni] > 0) continue;
        if (landArr[ni] === 1 && roadArr[ni] === 0) continue;
        var nd = out[cur] + 1;
        if (nd > radius) continue;
        out[ni] = nd;
        q.push(ni);
      }
    }
    return out;
  }

  function radiusFill(sources, radius) {
    var n = land.length;
    var out = new Float32Array(n);
    for (var s = 0; s < sources.length; s++) {
      var o = sources[s];
      var sx = o % W, sy = (o / W) | 0;
      for (var y = Math.max(0, sy - radius); y <= Math.min(H - 1, sy + radius); y++) {
        for (var x = Math.max(0, sx - radius); x <= Math.min(W - 1, sx + radius); x++) {
          var d = Math.abs(x - sx) + Math.abs(y - sy);
          if (d <= radius) {
            var i = y * W + x;
            var v = (radius - d) / radius;
            if (v > out[i]) out[i] = v;
          }
        }
      }
    }
    return out;
  }

  function recomputeNetworks() {
    var pSrc = [], wSrc = [], cSrc = [], pkSrc = [], indSrc = [];
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        var i = y * W + x;
        var t = type[i];
        if (t === TYPE.POWER) pSrc.push(i);
        else if (t === TYPE.WTOWER) wSrc.push(i);
        else if (t === TYPE.POLICE || t === TYPE.GCPD || t === TYPE.ARK || t === TYPE.BAT) cSrc.push(i);
        else if (t === TYPE.PARK) pkSrc.push(i);
        if (zone[i] === ZONE.I && dev[i] > 0) indSrc.push(i);
      }
    }
    var pc = flood(pSrc, 18, land, road);
    var wc = flood(wSrc, 11, land, road);
    for (var i2 = 0; i2 < powerCov.length; i2++) {
      powerCov[i2] = pc[i2] > 0 ? 1 : 0;
      waterCov[i2] = wc[i2] > 0 ? 1 : 0;
      crimeCov[i2] = 0;
    }
    var cc = new Float32Array(land.length);
    for (var s = 0; s < cSrc.length; s++) {
      var so = cSrc[s];
      var st = type[so];
      var rad = st === TYPE.GCPD ? 13 : st === TYPE.ARK ? 12 : st === TYPE.BAT ? 16 : 9;
      var str = st === TYPE.GCPD ? 1.35 : st === TYPE.ARK ? 1.6 : st === TYPE.BAT ? 2.2 : 1;
      var sx = so % W, sy = (so / W) | 0;
      for (var yy = Math.max(0, sy - rad); yy <= Math.min(H - 1, sy + rad); yy++) {
        for (var xx = Math.max(0, sx - rad); xx <= Math.min(W - 1, sx + rad); xx++) {
          var d = Math.abs(xx - sx) + Math.abs(yy - sy);
          if (d <= rad) {
            var ii = yy * W + xx;
            cc[ii] += (1 - d / (rad + 1)) * str;
          }
        }
      }
    }
    for (var i3 = 0; i3 < crimeCov.length; i3++) {
      crimeCov[i3] = Math.round(Math.min(100, cc[i3] * 100));
    }
    for (var i4 = 0; i4 < parkBand.length; i4++) {
      var pv = 0;
      for (var ps = 0; ps < pkSrc.length; ps++) {
        var po = pkSrc[ps];
        var d3 = Math.abs((i4 % W) - (po % W)) + Math.abs(((i4 / W) | 0) - ((po / W) | 0));
        if (d3 <= 2) pv += (3 - d3) * 6;
      }
      parkBand[i4] = Math.min(100, pv);
      var iv = 0;
      for (var is = 0; is < indSrc.length; is++) {
        var io = indSrc[is];
        var d4 = Math.abs((i4 % W) - (io % W)) + Math.abs(((i4 / W) | 0) - ((io / W) | 0));
        if (d4 <= 2) iv += (3 - d4);
      }
      indNear[i4] = Math.min(30, iv);
    }
  }

  function simHour() {
    var i, x, y;
    var E = 1;
    if (S.pop > 0) E = Math.min(1, (S.jobsC + S.jobsI + S.extJobs) / (S.pop * 0.92));
    S.lastE = E;

    for (i = 0; i < crime.length; i++) {
      var t = type[i], z = zone[i];
      var base = 5;
      if (z === ZONE.R) base = 9;
      else if (z === ZONE.C) base = 13;
      else if (z === ZONE.I) base = 11;
      if (powerCov[i] === 0 && (z > 0 || t > 0)) base += 14;
      if (t === TYPE.BAT) base = 2;
      base += (1 - E) * 12;
      base += poll[i] * 0.06;
      base += S.crimeSpike;
      var supF = crimeCov[i] / 100;
      var target = base * (1 - supF * 0.75) + 4;
      target = Math.max(2, Math.min(96, target));
      crime[i] += (target - crime[i]) * 0.12;
      crime[i] += rand(-1.2, 1.2);
      if (crime[i] < 0) crime[i] = 0;
      if (crime[i] > 100) crime[i] = 100;
    }
    S.crimeSpike *= 0.85;

    for (i = 0; i < poll.length; i++) {
      var src = 0;
      if (zone[i] === ZONE.I && dev[i] > 0) src = powerCov[i] > 0 ? 3.4 : 1.2;
      if (type[i] === TYPE.POWER) src = 2;
      if (type[i] === TYPE.ARK) src = 0.4;
      if (type[i] === TYPE.PARK) src = -1.4;
      poll[i] = Math.max(0, Math.min(100, poll[i] * 0.94 + src));
    }

    computeLandVal();

    var zoneCounts = [0, 0, 0, 0];
    for (var zx = 0; zx < W; zx++) {
      for (var zy = 0; zy < H; zy++) {
        var zi = zy * W + zx;
        var zz = zone[zi];
        if (zz === 0) continue;
        var dd = dev[zi];
        var powered = powerCov[zi] > 0;
        var watered = waterCov[zi] > 0;
        var lvv = landVal[zi];
        var cr = crime[zi];
        var roaded = nearRoadAt(zx, zy);
        var grow = false, decline = false;
        if (zz === ZONE.R) {
          if (roaded && powered && watered && lvv >= 30 && cr < 72 && (S.pop === 0 || E >= 0.6)) grow = true;
          if (!powered || !watered || cr > 86 || E < 0.32) decline = true;
        } else if (zz === ZONE.C) {
          if (roaded && powered && watered && lvv >= 42 && cr < 70 && S.pop > 6 && S.pop * 0.8 > S.jobsC * 1.2) grow = true;
          if (!powered || !watered || cr > 86) decline = true;
        } else if (zz === ZONE.I) {
          if (roaded && powered && lvv >= 14 && cr < 88 && S.pop > 6 && (S.pop * 0.9) > (S.jobsC + S.jobsI) * 1.1) grow = true;
          if (!powered || cr > 90) decline = true;
        }
        if (grow && dd < 4) {
          var p = zz === ZONE.R ? 0.26 : zz === ZONE.C ? 0.2 : 0.22;
          if (lvv > 72) p += 0.05;
          if (Math.random() < p) {
            dev[zi]++;
            timers[zi] = 0;
          }
        } else if (decline && dd > 0) {
          if (timers[zi] < 250) timers[zi]++;
          if (timers[zi] > 6) {
            dev[zi]--;
            timers[zi] = 0;
          }
        } else if (!grow && timers[zi] > 0) {
          timers[zi]--;
        }
      }
    }
    recomputeTotals();
  }

  function computeLandVal() {
    for (var i = 0; i < landVal.length; i++) {
      var cx = i % W, cy = (i / W) | 0;
      var lv = 46;
      if (road[i]) lv += 3;
      var riverAdj = 0;
      for (var rr = -1; rr <= 1; rr++) {
        for (var rc = -1; rc <= 1; rc++) {
          if (inb(cx + rc, cy + rr) && land[idx(cx + rc, cy + rr)] === 1) riverAdj = 6;
        }
      }
      lv += riverAdj;
      lv -= poll[i] * 0.22;
      lv -= crime[i] * 0.16;
      lv += parkBand[i] * 0.09;
      lv -= indNear[i] * 2.2;
      if (road[i] && type[i] === TYPE.PARK) lv += 20;
      landVal[i] = Math.max(5, Math.min(100, lv));
    }
  }

  var timers = new Uint8Array(W * H);
  var ghostArr = new Uint8Array(W * H);
  function devTimer(i) { timers[i] = 0; }

  function recomputeTotals() {
    var P = 0, Jc = 0, Ji = 0, hw = 0, hs = 0, cw = 0, cs = 0, zt = 0, d4 = 0;
    for (var i = 0; i < zone.length; i++) {
      var z = zone[i], dd = dev[i];
      if (z === 0) continue;
      zt++;
      if (dd === 0) continue;
      if (dd === 4) d4++;
      var pw = powerCov[i] > 0;
      if (z === ZONE.R) {
        if (pw && waterCov[i] > 0) {
          var p = DEV_POP[dd];
          P += p;
          var h = 100 - Math.min(60, crime[i] * 0.55) - Math.max(0, (1 - S.lastE)) * 80 - Math.max(0, S.tax - 11) * 5 - (pw ? 0 : 20) - (waterCov[i] > 0 ? 0 : 12) - poll[i] * 0.25;
          h += parkBand[i] * 0.12;
          h += S.happyAdj;
          h = Math.max(5, Math.min(100, h));
          hw += h * p; hs += p;
        }
      } else if (z === ZONE.C) {
        if (pw) Jc += DEV_CJ[dd];
      } else if (z === ZONE.I) {
        if (pw) Ji += DEV_IJ[dd];
      }
    }
    for (var j = 0; j < crime.length; j++) {
      if ((zone[j] > 0 && dev[j] > 0)) { cw += crime[j]; cs++; }
    }
    S.pop = P; S.jobsC = Jc; S.jobsI = Ji;
    S.crimeAvg = cs > 0 ? cw / cs : 6;
    S.happy = hs > 0 ? hw / hs : 65;
    S.hasLegend = false;
    var hasG = false, hasA = false, hasB = false;
    var rCnt = 0, bCnt = 0, pkCnt = 0, mks = {};
    for (var k = 0; k < type.length; k++) {
      var tt = type[k];
      if (tt === TYPE.GCPD) hasG = true;
      else if (tt === TYPE.ARK) hasA = true;
      else if (tt === TYPE.BAT) hasB = true;
      else if (tt === TYPE.PARK) pkCnt++;
      else if (tt === TYPE.WAYNE) mks.wayne = 1;
      else if (tt === TYPE.LIGHT) mks.light = 1;
      else if (tt === TYPE.MUSEUM) mks.museum = 1;
      else if (tt === TYPE.UNI) mks.uni = 1;
      else if (tt === TYPE.STAD) mks.stad = 1;
      else if (tt === TYPE.HOSP) mks.hosp = 1;
      if (road[k]) { rCnt++; if (land[k] === 1) bCnt++; }
    }
    if (hasG && hasA && hasB) S.hasLegend = true;
    S.tot = { roads: rCnt, bridges: bCnt, parks: pkCnt, zoneTiles: zt, dev4: d4, marks: mks };
    checkAch(false);
  }

  function dailyRoll() {
    var income = S.pop * 28 * (S.tax / 100) + S.jobsC * 40 * (S.tax / 100) + S.jobsI * 24 * (S.tax / 100);
    var exp = 0, roads = 0;
    for (var i = 0; i < type.length; i++) {
      if (type[i] > 0) exp += UPKEEP[type[i]] || 0;
      if (road[i]) roads++;
    }
    exp += roads * 0.35;
    var net = income - exp;
    S.money += net;
    S.net = net;
    var badDay = false;
    if (S.money < -3000) {
      if (S.bailouts >= 2 && !S.fired) {
        S.fired = true;
        S.money += 6000;
        S.happyAdj -= 15;
        sfx.event();
        showDialog({
          tag: "STATE RECEIVERSHIP",
          title: "You're Fired, Mayor",
          text: "The Governor has seen enough: two emergency bailouts, a city that cannot pay its own electric bill, and a mayor who keeps blaming 'the villains'. Gotham is being placed under state receivership. The new caretaker has one question — what were you thinking?",
          choices: ["Serve as caretaker", "Campaign for a new term"],
          onPick: function (ci) {
            if (ci === 1) { newCity(); return; }
            S.bailouts = 0;
            pushNews("RECEIVERSHIP — A caretaker government takes the wheel. Your portrait has been moved to the basement.");
            renderNews();
          }
        }, null);
      } else {
        S.bailouts++;
        S.money += 6000;
        S.happyAdj -= 8;
        S.crimeSpike += 6;
        badDay = true;
        showDialog({ tag: "EMERGENCY FUNDING", title: "City Bailout", text: "The bank has extended an emergency line of credit to keep Gotham running. The interest is... not your problem, Mayor. That's next year's problem." }, null);
      }
    }
    var flavor = false;
    if (S.hasLegend && Math.random() < 0.5) {
      flavor = true;
      showDialog({ tag: "THE DARK KNIGHT", title: "A Quiet Night", text: "With GCPD, Arkham and the Batcave all standing, Gotham's underworld has gone quiet. Criminals keep finding... accidents. Very thorough accidents." }, null);
    }
    var eligible = EVENTS.filter(function (e) {
      if (e.needZone) {
        var has = false;
        for (var k2 = 0; k2 < zone.length; k2++) if (zone[k2] > 0 && dev[k2] > 0) { has = true; break; }
        if (!has) return false;
      }
      if (e.type === "crime" || e.type === "bat") return S.crimeAvg >= (e.min || 0);
      return true;
    });
    if (!flavor) {
      var total = 0;
      for (var ei = 0; ei < eligible.length; ei++) total += eligible[ei].w;
      var roll = Math.random() * (total + 1.6);
      var ev = null, acc = 0;
      for (var ei2 = 0; ei2 < eligible.length; ei2++) {
        acc += eligible[ei2].w;
        if (roll <= acc) { ev = eligible[ei2]; break; }
      }
      if (ev) {
        var d = mapTopText();
        var res = ev.hit ? ev.hit(d) : null;
        var txt = res && res.txt ? String(res.txt).split("[d]").join(d) : String(ev.text || "").split("[d]").join(d);
        var evBad = !!(res && res.bad) || ev.type === "crime" || (ev.money || 0) < 0 || (ev.happy || 0) < 0;
        if (ev.type === "disaster") {
          var destroyed = destroyRandomBuilding(1) > 0;
          if (!destroyed) ev = null;
          else evBad = true;
        }
        if (!ev) {
          pushNews(flavorHeadline());
        } else {
          if (evBad) badDay = true;
          if (ev.crime) S.crimeSpike += ev.crime;
          if (ev.money) S.money += ev.money;
          if (ev.happy) S.happyAdj += ev.happy;
          if (ev.poll) {
            var pt = pickPollTile();
            if (pt >= 0) poll[pt] = Math.min(100, poll[pt] + ev.poll);
          }
          if (evBad) sfx.event(); else sfx.chime();
          showDialog({ tag: ev.tag, title: ev.title || (ev.type === "bat" ? "The Bat" : "Breaking News"), text: txt }, null);
          pushNews(ev.tag + " — " + txt);
          if (ev.type === "bat") batFlash();
        }
      } else {
        pushNews(flavorHeadline());
      }
    } else {
      pushNews(flavorHeadline());
    }
    var cleanToday = !badDay && S.crimeAvg < 28;
    S.cleanStreak = cleanToday ? (S.cleanStreak || 0) + 1 : 0;
    if (!S.won && S.cleanStreak >= 10 && S.pop >= 120) {
      S.won = true;
      sfx.unlock();
      showDialog({
        tag: "GOTHAM SAVED",
        title: "Batman Retires",
        text: "Ten quiet days. No sirens, no hostage crises, no headlines screaming your name. Last night a silhouette stood on the GCPD roof, watched the sun rise over " + mapTopText() + ", and simply walked away. Gotham does not need a Dark Knight anymore, Mayor. It has you.",
        choices: ["Keep building the legacy", "Begin a new Gotham"],
        onPick: function (ci) { if (ci === 1) newCity(); }
      }, null);
    }
    if (Math.random() < 0.1 && S.day > 2) tryRiddler();
    checkAch(true);
    autosave();
  }

  function pickPollTile() {
    var best = -1, bestv = 0;
    for (var i = 0; i < poll.length; i++) {
      var v = Math.random() * (zone[i] > 0 ? 2 : 1);
      if (v > bestv) { bestv = v; best = i; }
    }
    return best;
  }

  function destroyRandomBuilding(n) {
    n = n || 1;
    var cands = [];
    for (var i = 0; i < zone.length; i++) if (zone[i] > 0 && dev[i] > 0) cands.push(i);
    if (cands.length === 0) return 0;
    var destroyed = 0;
    while (destroyed < n && cands.length) {
      var t = pick(cands);
      dev[t] = 0;
      timers[t] = 0;
      destroyed++;
      cands.splice(cands.indexOf(t), 1);
    }
    return destroyed;
  }

  function tryRiddler() {
    var r = pick(RIDDLES);
    var d = mapTopText();
    showDialog({
      tag: "RIDDLE ME THIS",
      title: "The Riddler",
      text: "Citizens of Gotham — solve my riddle and I shall reward your city's coffers. Fail, and I leave... a little chaos behind. From " + d + ":",
      body: r.q,
      choices: r.opts,
      onPick: function (ci) {
        if (ci === r.a) {
          S.money += 1400;
          S.happyAdj += 6;
          S.riddlesSolved++;
          sfx.chime();
          checkAch(false);
          pushNews("RIDDLER OUTWITTED — Gotham's Mayor answered correctly. How unsporting.");
          showDialog({ tag: "WELL PLAYED", title: "Correct", text: "\"" + r.opts[r.a] + "\". Damn you, Mayor. A donation to the city's general fund has been wired. The chaos... canceled." }, null);
        } else {
          S.money -= 400;
          S.happyAdj -= 3;
          S.crimeSpike += 3;
          sfx.deny();
          pushNews("RIDDLER STRIKES — Mayor failed a riddle in " + d + ". The city pays for ignorance.");
          showDialog({ tag: "WRONG", title: "Hah! Wrong.", text: "The answer was \"" + r.opts[r.a] + "\". A minor... inconvenience has been arranged for " + d + " in your honor." }, null);
        }
      }
    });
  }

  var newsQ = [];
  function pushNews(txt) {
    newsQ.push(txt);
    if (newsQ.length > 40) newsQ.shift();
  }

  function showDialog(opts, onClose) {
    if (modalBusy) { dialogQueue.push({ o: opts, c: onClose }); return; }
    presentDialog(opts, onClose);
  }
  var modalBusy = false;
  var dialogQueue = [];

  function presentDialog(opts, onClose) {
    modalBusy = true;
    modalTag.textContent = opts.tag || "GOTHAM GAZETTE";
    modalTitle.textContent = opts.title || "";
    modalText.innerHTML = opts.rawHtml !== undefined ? opts.rawHtml : (opts.body ? "<i>" + esc(opts.body) + "</i><br><br>" : "") + esc(opts.text || "");
    modalChoices.innerHTML = "";
    modalChoiceBtns.style.display = "none";
    var done = function (res) {
      modalEl.classList.remove("show");
      modalBusy = false;
      if (res && opts.onPick) opts.onPick(res);
      else if (onClose) onClose();
      var next = dialogQueue.shift();
      if (next) presentDialog(next.o, next.c);
    };
    if (opts.choices) {
      modalChoices.style.display = "flex";
      for (var i = 0; i < opts.choices.length; i++) {
        (function (ci, label) {
          var b = document.createElement("button");
          b.className = "choice";
          b.textContent = label;
          b.onclick = function () { done(ci); };
          modalChoices.appendChild(b);
        })(i, opts.choices[i]);
      }
    } else {
      modalChoices.style.display = "none";
      modalChoiceBtns.style.display = "flex";
      var ob = $("modalOk");
      ob.onclick = function () { done(null); };
    }
    modalEl.classList.add("show");
  }
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // ---- music (streamed tracks) ----
  var MUSIC_URLS = {
    day: "https://user.uploads.dev/file/6c3c4a404831eb5a9338d27e43bb0478.mp3",
    night: "https://user.uploads.dev/file/c16a444a501aaaa8fbaea4b15a0c10f0.mp3"
  };
  var audio = { musicEl: null, cur: "", fadeT: null };
  function fadeUp() {
    if (audio.fadeT) clearInterval(audio.fadeT);
    audio.fadeT = setInterval(function () {
      if (!audio.musicEl) { clearInterval(audio.fadeT); audio.fadeT = null; return; }
      audio.musicEl.volume = Math.min(0.4, audio.musicEl.volume + 0.03);
      if (audio.musicEl.volume >= 0.4) { clearInterval(audio.fadeT); audio.fadeT = null; }
    }, 120);
  }
  function musicPlay(url) {
    if (!S.sound) return;
    if (!audio.musicEl) {
      audio.musicEl = new Audio();
      audio.musicEl.loop = true;
    }
    if (audio.cur === url && !audio.musicEl.paused) { if (audio.musicEl.volume < 0.35) fadeUp(); return; }
    audio.musicEl.src = url;
    audio.cur = url;
    audio.musicEl.volume = 0;
    audio.musicEl.play().catch(function () {});
    fadeUp();
  }
  function musicOn() { musicPlay(MUSIC_URLS.day); }
  function musicOff() {
    if (!audio.musicEl) return;
    if (audio.fadeT) { clearInterval(audio.fadeT); audio.fadeT = null; }
    audio.musicEl.pause();
    audio.musicEl.volume = 0;
    audio.cur = "";
  }
  function updateMusic() {
    if (!S.sound || !S.started || !audio.musicEl || audio.musicEl.paused) return;
    var want = S.light < 0.35 ? MUSIC_URLS.night : MUSIC_URLS.day;
    if (audio.cur !== want) musicPlay(want);
  }

  // ---- synthesized sound effects ----
  var AC = null, masterGain = null;
  function audioCtx() {
    if (!AC) {
      try {
        AC = new (window.AudioContext || window.webkitAudioContext)();
        masterGain = AC.createGain();
        masterGain.gain.value = 0.5;
        masterGain.connect(AC.destination);
      } catch (e) { return null; }
    }
    if (AC.state === "suspended") { try { AC.resume(); } catch (e) {} }
    return AC;
  }
  function tone(freq, dur, type, vol, slideTo, delay) {
    var c = audioCtx();
    if (!c || !S.sound) return;
    var t0 = c.currentTime + (delay || 0);
    var o = c.createOscillator(), g = c.createGain();
    o.type = type || "sine";
    o.frequency.setValueAtTime(Math.max(1, freq), t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t0 + dur);
    g.gain.setValueAtTime(vol || 0.12, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(masterGain);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }
  function noiseHit(dur, vol, cutoff, delay) {
    var c = audioCtx();
    if (!c || !S.sound) return;
    var t0 = c.currentTime + (delay || 0);
    var n = Math.max(1, Math.floor(c.sampleRate * dur));
    var buf = c.createBuffer(1, n, c.sampleRate);
    var d = buf.getChannelData(0);
    for (var k2 = 0; k2 < n; k2++) d[k2] = (Math.random() * 2 - 1) * (1 - k2 / n);
    var src = c.createBufferSource(); src.buffer = buf;
    var f = c.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = cutoff || 900;
    var g = c.createGain(); g.gain.value = vol || 0.2;
    src.connect(f); f.connect(g); g.connect(masterGain);
    src.start(t0);
  }
  var sfx = {
    build: function () { tone(540 + Math.random() * 260, 0.07, "triangle", 0.07, 840); },
    wreck: function () { noiseHit(0.16, 0.14, 600); tone(170, 0.13, "sawtooth", 0.05, 55); },
    deny: function () { tone(140, 0.09, "square", 0.05, 110); },
    event: function () { noiseHit(0.5, 0.16, 420); tone(130, 0.4, "sine", 0.16, 45); tone(72, 0.5, "sine", 0.1, 38, 0.08); },
    bat: function () { tone(1500, 0.5, "sine", 0.06, 220); tone(900, 0.35, "triangle", 0.05, 300, 0.05); noiseHit(0.7, 0.05, 2400, 0.05); },
    unlock: function () { tone(523, 0.1, "triangle", 0.1); tone(659, 0.1, "triangle", 0.1, null, 0.09); tone(784, 0.12, "triangle", 0.1, null, 0.18); tone(1046, 0.22, "triangle", 0.11, null, 0.27); },
    chime: function () { tone(880, 0.22, "sine", 0.06); tone(1318, 0.28, "sine", 0.045, null, 0.05); }
  };

  // ---- achievements ----
  var ACH = [
    { id: "road1", name: "Cornerstone", desc: "Lay your first road." },
    { id: "bridge", name: "Crossing the River", desc: "Build a road bridge over the Gotham River." },
    { id: "planner", name: "City Planner", desc: "Zone 25 lots." },
    { id: "emerald", name: "Emerald City", desc: "Build 10 parks." },
    { id: "boom", name: "Boom Town", desc: "Reach 500 citizens." },
    { id: "metro", name: "Metropolis", desc: "Reach 2,000 citizens." },
    { id: "jobs", name: "Job Engine", desc: "Create 500 jobs." },
    { id: "skyline", name: "Gotham Skyline", desc: "Grow 12 buildings to level 4." },
    { id: "law", name: "Law & Order", desc: "End a full day with crime under 15%." },
    { id: "legend", name: "The Dark Knight Rises", desc: "Operate GCPD HQ, Arkham and the Batcave together." },
    { id: "pride", name: "Gotham's Pride", desc: "Build every landmark: Wayne Tower, Gotham Light, Museum, University, Stadium and Hospital." },
    { id: "riddler", name: "Riddle Master", desc: "Answer the Riddler correctly 3 times." },
    { id: "credit", name: "Emergency Credit", desc: "Survive your first city bailout." },
    { id: "mayor", name: "Mayor For Life", desc: "Reach day 20." },
    { id: "saved", name: "Gotham Saved", desc: "Win: 10 straight quiet days with the city thriving." }
  ];
  function achDone(id, atDay) {
    var t = S.tot;
    switch (id) {
      case "road1": return (t.roads || 0) >= 1;
      case "bridge": return (t.bridges || 0) >= 1;
      case "planner": return (t.zoneTiles || 0) >= 25;
      case "emerald": return (t.parks || 0) >= 10;
      case "boom": return S.pop >= 500;
      case "metro": return S.pop >= 2000;
      case "jobs": return S.jobsC + S.jobsI >= 500;
      case "skyline": return (t.dev4 || 0) >= 12;
      case "law": return !!atDay && S.pop > 0 && S.crimeAvg < 15;
      case "legend": return S.hasLegend;
      case "pride": return !!(t.marks && t.marks.wayne && t.marks.light && t.marks.museum && t.marks.uni && t.marks.stad && t.marks.hosp);
      case "riddler": return S.riddlesSolved >= 3;
      case "credit": return S.bailouts >= 1;
      case "mayor": return S.day >= 20;
      case "saved": return S.won;
    }
    return false;
  }
  function toast(msg, tag) {
    var tc = $("toasts");
    if (!tc) return;
    var d = document.createElement("div");
    d.className = "toast";
    d.innerHTML = (tag ? "<b>" + esc(tag) + "</b> — " : "") + esc(msg);
    tc.appendChild(d);
    setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 3700);
  }
  function checkAch(atDay) {
    for (var k3 = 0; k3 < ACH.length; k3++) {
      var a = ACH[k3];
      if (S.ach[a.id]) continue;
      if (achDone(a.id, atDay)) {
        S.ach[a.id] = true;
        pushNews("ACHIEVEMENT — " + a.name);
        toast(a.name + " — " + a.desc, "ACHIEVEMENT");
        sfx.unlock();
        var ab = $("achBtn");
        if (ab) {
          ab.classList.remove("glow");
          void ab.offsetWidth;
          ab.classList.add("glow");
        }
      }
    }
  }
  function achModal() {
    var rows = [];
    for (var k4 = 0; k4 < ACH.length; k4++) {
      var a = ACH[k4];
      var got = !!S.ach[a.id];
      rows.push("<div style='display:flex;gap:8px;align-items:flex-start;margin:4px 0'><span style='color:" + (got ? "var(--gold)" : "var(--dim)") + ";line-height:1.4'>" + (got ? "★" : "☆") + "</span><span style='flex:1;opacity:" + (got ? 1 : 0.55) + "'><b style='color:" + (got ? "#ffe9b0" : "var(--text)") + "'>" + esc(a.name) + "</b><br><span style='font-size:11px;color:var(--dim)'>" + esc(a.desc) + "</span></span></div>");
    }
    var hd = "<div style='font-size:12px;color:var(--dim);margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid var(--line)'>" + esc(fmtMoney(S.money)) + " · Day " + S.day + " · Pop " + S.pop + " · " + Math.round(S.happy) + "% happy · " + Math.round(S.crimeAvg) + "% crime<br>Clean streak: <b style='color:" + (S.cleanStreak >= 10 ? "#7fe08a" : "var(--text)") + "'>" + S.cleanStreak + "</b> day" + (S.cleanStreak === 1 ? "" : "s") + (S.hasLegend ? " · 🦇 Dark Knight active" : "") + (S.won ? " · <b style='color:var(--gold)'>GOTHAM SAVED</b>" : "") + "</div>";
    showDialog({ tag: "CITY RECORD", title: "Achievements & Status", rawHtml: hd + rows.join("") });
  }

  function batFlash() {
    sfx.bat();
    var f = document.createElement("div");
    f.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:45;background:radial-gradient(ellipse at 50% 20%, rgba(255,255,255,0.14), rgba(180,200,255,0.10) 40%, rgba(5,8,20,0.4));opacity:1;transition:opacity 1.6s;";
    var inner = document.createElement("div");
    inner.style.cssText = "position:absolute;top:12%;left:50%;font-size:120px;transform:translateX(-50%);color:rgba(220,230,255,0.9);text-shadow:0 0 40px rgba(150,180,255,0.9);";
    inner.textContent = "🦇";
    f.appendChild(inner);
    document.body.appendChild(f);
    requestAnimationFrame(function () { f.style.opacity = "0"; });
    setTimeout(function () { f.remove(); }, 1800);
  }

  function buildToolbar() {
    var html = "";
    var groups = [
      ["GROUND", ["road"]],
      ["ZONES", ["zr", "zc", "zi"]],
      ["SERVICES", ["park", "power", "wtower"]],
      ["SAFETY", ["police", "gcpd", "ark", "bat"]],
      ["LANDMARKS", ["wayne", "light", "museum", "uni", "stad", "hosp"]],
      ["DEMOLITION", ["wreck"]]
    ];
    for (var g = 0; g < groups.length; g++) {
      html += "<h4>" + groups[g][0] + "</h4>";
      for (var t2 = 0; t2 < groups[g][1].length; t2++) {
        var t = toolMap[groups[g][1][t2]];
        html += '<button class="tool" data-tool="' + t.id + '"><span class="sw" style="background:' + t.sw + '"></span><span class="tlab">' + t.name + "</span>" + (t.key ? '<span class="key">' + t.key + "</span>" : "") + "</button>";
      }
    }
    toolbarEl.innerHTML = html;
    var btns = toolbarEl.querySelectorAll(".tool");
    for (var b2 = 0; b2 < btns.length; b2++) {
      btns[b2].addEventListener("click", function () {
        selectTool(this.getAttribute("data-tool"));
      });
    }
  }
  function selectTool(id) {
    var want = id === "wreck" ? "wreck" : toolMap[id] ? id : null;
    S.tool = (want === S.tool) ? null : want;
    var btns = toolbarEl.querySelectorAll(".tool");
    for (var i = 0; i < btns.length; i++) btns[i].classList.toggle("active", btns[i].getAttribute("data-tool") === S.tool);
  }

  var lastSfxT = 0;
  function sfxPlace(kind) {
    if (!S.sound || !S.started) return;
    var now = performance.now();
    if (now - lastSfxT < 120) return;
    lastSfxT = now;
    if (kind === "wreck") sfx.wreck(); else sfx.build();
  }

  function canPlaceAt(x, y, toolId) {
    if (!inb(x, y)) return { ok: false, msg: "Off the map" };
    var i = idx(x, y);
    var t = toolMap[toolId];
    if (t.wreck) {
      var okW = type[i] > 0 || zone[i] > 0 || road[i] > 0;
      return { ok: okW, msg: okW ? "Click or drag to demolish (refund " + Math.round(REFUND * 100) + "%)" : "Nothing to demolish here" };
    }
    if (t.zone) {
      if (land[i] === 1) return { ok: false, msg: "Cannot zone on water" };
      if (road[i] || type[i] > 0 || zone[i] > 0) return { ok: false, msg: "Space occupied" };
      if (S.money < t.cost) return { ok: false, msg: "Not enough funds ($" + t.cost + ")" };
      return { ok: true, msg: "Zone lot — needs road, power & water to develop", cost: t.cost };
    }
    if (t.type || t.id === "road") {
      var isRoad = t.id === "road";
      if (land[i] === 1 && !isRoad) return { ok: false, msg: "Cannot build on water" };
      if (road[i] || type[i] > 0 || zone[i] > 0) return { ok: false, msg: "Space occupied" };
      if (S.money < t.cost) return { ok: false, msg: "Not enough funds ($" + t.cost + ")" };
      if (t.road && !isRoad && !nearRoadAt(x, y)) return { ok: false, msg: "Needs road access" };
      if (isRoad && land[i] === 1) {
        var near = false;
        var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        for (var k = 0; k < 4; k++) if (inb(x + dirs[k][0], y + dirs[k][1]) && road[idx(x + dirs[k][0], y + dirs[k][1])]) near = true;
        if (!near) return { ok: false, msg: "Bridges need a road on either side" };
      }
      return { ok: true, msg: (t.name || "Road") + " — $" + t.cost + " (right-drag to demolish)", cost: t.cost };
    }
    return { ok: false, msg: "" };
  }

  function placeAt(x, y, toolId, silent) {
    if (!inb(x, y)) return false;
    var cp = canPlaceAt(x, y, toolId);
    if (!cp.ok) return false;
    var i = idx(x, y);
    var t = toolMap[toolId];
    if (t.wreck) {
      var refunded = 0;
      if (land[i] === 1 && road[i]) {
        road[i] = 0;
        refunded = 6;
      } else if (type[i] > 0) {
        refunded = Math.round(costOfType(type[i]) * REFUND);
        type[i] = TYPE.NONE;
      } else if (zone[i] > 0) {
        if (dev[i] > 0) refunded = Math.round(12 * (1 + dev[i] * 2) * REFUND);
        zone[i] = ZONE.NONE;
        dev[i] = 0;
        timers[i] = 0;
      } else if (road[i]) {
        road[i] = 0;
        refunded = 2;
      }
      S.money += refunded;
      sfxPlace("wreck");
      afterChange();
      return true;
    }
    if (t.zone) {
      S.money -= t.cost;
      zone[i] = t.zone;
      dev[i] = 0;
      sfxPlace("build");
      afterChange();
      return true;
    }
    if (t.type) {
      S.money -= t.cost;
      type[i] = t.type;
      sfxPlace("build");
      afterChange();
      return true;
    }
    if (t.id === "road") {
      S.money -= t.cost;
      road[i] = 1;
      sfxPlace("build");
      afterChange();
      return true;
    }
    return false;
  }

  function costOfType(t) {
    for (var k = 0; k < TOOLS.length; k++) {
      if (TOOLS[k].type === t) return TOOLS[k].cost;
    }
    return 0;
  }

  function afterChange() {
    recomputeNetworks();
    computeLandVal();
    recomputeTotals();
  }

  var lastPlaced = null;
  function paintLine(x0, y0, x1, y1, toolId) {
    var dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    var sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    var err = dx - dy;
    var placed = 0;
    while (true) {
      if (placeAt(x0, y0, toolId, true)) placed++;
      if (x0 === x1 && y0 === y1) break;
      var e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x0 += sx; }
      if (e2 < dx) { err += dx; y0 += sy; }
      if (placed > 400) break;
    }
    if (placed > 0) afterChange();
    else if (placed === 0) recomputeTotals();
  }

  function cursorStatus() {
    var tool = S.tool;
    var c = S.hover;
    if (!c || !tool) return null;
    return canPlaceAt(c.x, c.y, tool);
  }

  function fmtMoney(n) {
    var neg = n < 0;
    var v = Math.abs(Math.round(n));
    var s = v >= 1000000 ? (v / 1000000).toFixed(1).replace(/\.0$/, "") + "M" : v >= 1000 ? (v / 1000).toFixed(1).replace(/\.0$/, "") + "K" : String(v);
    return (neg ? "-" : "") + "$" + s;
  }

  function refreshUI() {
    moneyEl.textContent = fmtMoney(S.money);
    moneyEl.classList.toggle("bad", S.money < 0);
    popEl.textContent = S.pop >= 1000 ? (S.pop / 1000).toFixed(1) + "K" : String(S.pop);
    hapEl.textContent = Math.round(S.happy) + "%";
    hapEl.classList.toggle("good", S.happy >= 65);
    hapEl.classList.toggle("bad", S.happy < 35);
    crimeEl.textContent = Math.round(S.crimeAvg) + "%";
    crimeEl.classList.toggle("good", S.crimeAvg < 30);
    crimeEl.classList.toggle("bad", S.crimeAvg > 60);
    jobsEl.textContent = (S.jobsC + S.jobsI);
    var hh = Math.floor(S.hour);
    var mm = Math.floor((S.hour - hh) * 60);
    dayEl.textContent = "Day " + S.day + " " + String(hh).padStart(2, "0") + ":" + String(mm).padStart(2, "0");
    netEl.textContent = fmtMoney(S.net);
    netEl.classList.toggle("good", S.net >= 0);
    netEl.classList.toggle("bad", S.net < 0);
  }

  function refreshInfo() {
    var c = S.hover;
    if (!c || !inb(c.x, c.y)) {
      infoTitleEl.textContent = "—";
      var dmd = demandText();
      infoBodyEl.innerHTML = "<div class='row'><span>Demand</span><span><b>" + dmd + "</b></span></div><div class='row'><span>R · C · I</span><span>" + demandArrows() + "</span></div><div class='row'><span>Tax</span><span>" + S.tax + "%</span></div><div style='font-size:11px;color:var(--dim);margin-top:8px'>Hover a tile to inspect it. Pick a tool from the left to build.</div>";
      syncMini(null);
      return;
    }
    var tool = S.tool;
    var cs = cursorStatus();
    if (tool && cs) {
      infoTitleEl.textContent = cs.ok ? "✔ " + (toolMap[tool].name || "Road") : "✖ " + (toolMap[tool].name || "Road");
      infoBodyEl.innerHTML = "<div class='row'><span>Status</span><span style='color:" + (cs.ok ? "#7fe08a" : "#ff7a7a") + "'><b>" + cs.msg + "</b></span></div>" + (cs.cost ? "<div class='row'><span>Cost</span><span><b>$" + cs.cost + "</b></span></div>" : "") + (toolMap[tool].road ? "<div class='row'><span>Requires</span><span>road access</span></div>" : "") + demandExtra();
      syncMini(null);
      return;
    }
    var v = tileInspectRows(c);
    infoTitleEl.textContent = v.title;
    infoBodyEl.innerHTML = v.html;
    syncMini(v);
  }

  function tileInspectRows(c) {
    var i = idx(c.x, c.y);
    var title = "Grassland", rows = [];
    if (land[i] === 1) title = "Gotham River";
    else if (road[i]) title = "Road";
    else if (zone[i] > 0) {
      var zn = zone[i] === ZONE.R ? "Residential" : zone[i] === ZONE.C ? "Commercial" : "Industrial";
      if (dev[i] > 0) {
        title = zn + " Lv" + dev[i];
        if (zone[i] === ZONE.R) rows.push(["Pop", DEV_POP[dev[i]]]);
        else rows.push(["Jobs", zone[i] === ZONE.C ? DEV_CJ[dev[i]] : DEV_IJ[dev[i]]]);
      } else title = zn + " (empty lot)";
      rows.push(["Power", powerCov[i] ? "✓" : "✗"]);
      if (zone[i] !== ZONE.I) rows.push(["Water", waterCov[i] ? "✓" : "✗"]);
    } else if (type[i] > 0) {
      title = toolName(type[i]);
      if (type[i] === TYPE.PARK || type[i] === TYPE.POLICE || type[i] === TYPE.GCPD || type[i] === TYPE.ARK || type[i] === TYPE.BAT) {
        rows.push(["Crime cover", Math.round(crimeCov[i]) + "%"]);
      }
      rows.push(["Upkeep", "$" + (UPKEEP[type[i]] || 0) + "/day"]);
    }
    rows.push(["Land value", Math.round(landVal[i])]);
    rows.push(["Crime", Math.round(crime[i]) + "%"]);
    if (poll[i] > 1) rows.push(["Pollution", Math.round(poll[i])]);
    rows.push(["Demand", demandArrows()]);
    var html = "";
    for (var r = 0; r < rows.length; r++) {
      html += "<div class='row'><span>" + rows[r][0] + "</span><span><b>" + rows[r][1] + "</b></span></div>";
    }
    return { title: title, html: html };
  }

  function syncMini(v) {
    var mini = $("miniInfo");
    if (!mini || !mini.classList.contains("show")) return;
    if (!v) { hideMiniInfo(); return; }
    $("miniTitle").textContent = v.title;
    $("miniBody").innerHTML = v.html;
  }
  function showMiniInfo(c) {
    var infoEl = $("info");
    if (infoEl && infoEl.offsetParent !== null) return;
    var v = tileInspectRows(c);
    $("miniTitle").textContent = v.title;
    $("miniBody").innerHTML = v.html;
    $("miniInfo").classList.add("show");
  }
  function hideMiniInfo() {
    var m = $("miniInfo");
    if (m) m.classList.remove("show");
  }

  function toolName(t) {
    for (var k = 0; k < TOOLS.length; k++) if (TOOLS[k].type === t) return TOOLS[k].name;
    return "Structure";
  }

  function demandText() {
    var d = [];
    var e = S.lastE;
    if (S.pop === 0) d.push("Housing wanted");
    else if (e >= 0.85) d.push("Housing boom");
    else if (e < 0.45) d.push("High unemployment");
    if (S.pop > 0 && S.pop * 0.8 > S.jobsC * 1.2) d.push("Shop shortage");
    if (S.pop > 0 && S.pop * 0.9 > (S.jobsC + S.jobsI) * 1.1) d.push("Need jobs");
    return d.length ? d.join(" · ") : "Balanced";
  }
  function demandArrows() {
    var e = S.lastE;
    var r = S.pop === 0 || e >= 0.62 ? '<span style="color:#7fe08a">▲</span>' : e < 0.4 ? '<span style="color:#ff7a7a">▼</span>' : '<span style="color:#d8b25c">—</span>';
    var c = (S.pop > 6 && S.pop * 0.8 > S.jobsC * 1.2) ? '<span style="color:#7fe08a">▲</span>' : S.jobsC * 1.2 > S.pop ? '<span style="color:#ff7a7a">▼</span>' : '<span style="color:#d8b25c">—</span>';
    var it = (S.pop > 6 && S.pop * 0.9 > (S.jobsC + S.jobsI) * 1.1) ? '<span style="color:#7fe08a">▲</span>' : (S.jobsC + S.jobsI) * 1.1 > S.pop ? '<span style="color:#ff7a7a">▼</span>' : '<span style="color:#d8b25c">—</span>';
    return r + " " + c + " " + it;
  }
  function demandExtra() {
    return "<div class='row' style='margin-top:6px'><span>Demand</span><span>" + demandArrows() + "</span></div>";
  }

  var tickerTimer = null;
  function renderNews() {
    var txt = newsQ.length ? newsQ[newsQ.length - 1] : "Welcome to Gotham, Mayor.";
    var el = newsText;
    el.textContent = txt;
    el.style.left = "100%";
    if (tickerTimer) clearTimeout(tickerTimer);
    var start = null;
    var dur = Math.max(9, txt.length * 0.14);
    var step = function () {
      if (start === null) start = performance.now();
      var sec = (performance.now() - start) / 1000;
      var x = 100 - (sec / dur) * 100 - 40;
      el.style.left = x + "%";
      if (sec < dur + 1) tickerTimer = setTimeout(step, 33);
    };
    step();
  }

  function updateCameraBounds() {
    var cw = stageEl.clientWidth, ch = stageEl.clientHeight;
    var m = 90;
    var L = -(H - 1) * HW;
    var R = L + (W + H) * HW;
    var B = (W + H) * HH;
    S.cam.ox = Math.min(cw - m - L * S.cam.z, Math.max(m - R * S.cam.z, S.cam.ox));
    S.cam.oy = Math.min(ch - m, Math.max(m - B * S.cam.z, S.cam.oy));
  }

  function fitView() {
    var cw = stageEl.clientWidth, ch = stageEl.clientHeight;
    var bw = (W + H) * HW, bh = (W + H) * HH + 160;
    var z = Math.min(cw / bw, ch / bh);
    z = Math.max(0.18, Math.min(z, 1.6));
    S.cam.z = z;
    var padB = (cw <= 600 && ch < 560) ? 148 : 0;
    var ox = cw / 2 - ((W - H) * HW / 2) * z;
    var oy = Math.max(0, (ch - padB) / 2 - ((W + H) * HH / 4) * z);
    S.cam.ox = ox; S.cam.oy = oy;
    updateCameraBounds();
  }

  function screenToWorld(sx, sy) {
    var r = cv.getBoundingClientRect();
    var mx = sx - r.left, my = sy - r.top;
    var wx = (mx - S.cam.ox) / S.cam.z;
    var wy = (my - S.cam.oy) / S.cam.z;
    var fx = wx / HW, fy = wy / HH;
    var x = (fx + fy) / 2;
    var y = (fy - fx) / 2;
    return { x: Math.round(x), y: Math.round(y) };
  }

  var mouse = { x: 0, y: 0, inside: false, downL: false, downR: false, downM: false, lastX: -1, lastY: -1, panning: false, px: 0, py: 0 };
  var ptrs = {};
  var pinchState = null;

  function onMove(e) {
    var r = cv.getBoundingClientRect();
    var mx = e.clientX - r.left, my = e.clientY - r.top;
    var dx = mx - mouse.px, dy = my - mouse.py;
    mouse.px = mx; mouse.py = my;
    mouse.x = mx; mouse.y = my;
    if ((mouse.downL || mouse.downR || mouse.downM) && Math.abs(e.clientX - (mouse.downPX || 0)) + Math.abs(e.clientY - (mouse.downPY || 0)) > 14) mouse.moved = true;
    if (e.pointerType === "touch" && ptrs[e.pointerId]) {
      ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
      var pkeys = Object.keys(ptrs);
      if (pkeys.length >= 2) {
        var A = ptrs[pkeys[0]], B = ptrs[pkeys[1]];
        var mdx = (A.x + B.x) / 2, mdy = (A.y + B.y) / 2;
        var d = Math.max(1, Math.sqrt((A.x - B.x) * (A.x - B.x) + (A.y - B.y) * (A.y - B.y)));
        if (pinchState) {
          var f = d / pinchState.d;
          var nz = Math.max(0.18, Math.min(3, pinchState.z * f));
          var wx = (pinchState.x - pinchState.ox) / pinchState.z;
          var wy = (pinchState.y - pinchState.oy) / pinchState.z;
          S.cam.z = nz;
          S.cam.ox = mdx - wx * nz;
          S.cam.oy = mdy - wy * nz;
          updateCameraBounds();
        }
        pinchState = { z: S.cam.z, ox: S.cam.ox, oy: S.cam.oy, x: mdx, y: mdy, d: d };
        mouse.lastX = -1; mouse.lastY = -1;
        return;
      }
    }
    var was = S.hover;
    var t = screenToWorld(e.clientX, e.clientY);
    if (inb(t.x, t.y)) {
      S.hover = t;
      mouse.inside = true;
      if (!was || was.x !== t.x || was.y !== t.y) refreshInfo();
    } else {
      S.hover = null;
      mouse.inside = false;
      if (was) refreshInfo();
    }
    if (mouse.panning) {
      S.cam.ox += dx;
      S.cam.oy += dy;
      updateCameraBounds();
      return;
    }
    if (mouse.downL && S.tool && S.started) {
      if (mouse.lastX < 0) { mouse.lastX = t.x; mouse.lastY = t.y; }
      paint(mouse.lastX, mouse.lastY, t, S.tool);
      mouse.lastX = t.x; mouse.lastY = t.y;
    } else if (mouse.downR && S.started) {
      if (mouse.lastX < 0) { mouse.lastX = t.x; mouse.lastY = t.y; }
      paint(mouse.lastX, mouse.lastY, t, "wreck");
      mouse.lastX = t.x; mouse.lastY = t.y;
    }
  }

  function paint(x0, y0, t, tool) {
    if (!inb(t.x, t.y)) return;
    var dx = Math.abs(t.x - x0), dy = Math.abs(t.y - y0);
    var sx = x0 < t.x ? 1 : -1, sy = y0 < t.y ? 1 : -1;
    var err = dx - dy, placed = 0;
    var cx2 = x0, cy2 = y0;
    while (placed < 400) {
      if (placeAt(cx2, cy2, tool, true)) placed++;
      if (cx2 === t.x && cy2 === t.y) break;
      var e2 = 2 * err;
      if (e2 > -dy) { err -= dy; cx2 += sx; }
      if (e2 < dx) { err += dx; cy2 += sy; }
    }
    if (placed > 0) afterChange();
  }

  function onDown(e) {
    mouse.downT = performance.now();
    mouse.downPX = e.clientX; mouse.downPY = e.clientY;
    mouse.moved = false;
    if (e.pointerType === "touch") {
      ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
      if (Object.keys(ptrs).length >= 2) {
        pinchState = null;
        mouse.downL = false; mouse.downR = false;
        mouse.panning = false;
        mouse.lastX = -1; mouse.lastY = -1;
        mouse.moved = true;
        return;
      }
    }
    var r = cv.getBoundingClientRect();
    mouse.px = e.clientX - r.left; mouse.py = e.clientY - r.top;
    var t = screenToWorld(e.clientX, e.clientY);
    if (inb(t.x, t.y) && (!S.hover || S.hover.x !== t.x || S.hover.y !== t.y)) {
      S.hover = t;
      refreshInfo();
    }
    if (e.button === 1 || (e.button === 0 && spaceDown)) {
      mouse.downM = true;
      mouse.panning = true;
      cv.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
    if (e.button === 0) {
      mouse.downL = true;
      cv.setPointerCapture(e.pointerId);
      if (S.tool && S.started) {
        mouse.panning = false;
        mouse.lastX = t.x; mouse.lastY = t.y;
        if (!placeAt(t.x, t.y, S.tool, true)) sfx.deny();
        else afterChange();
      } else {
        mouse.panning = true;
      }
      e.preventDefault();
      return;
    }
    if (e.button === 2) {
      mouse.downR = true;
      cv.setPointerCapture(e.pointerId);
      if (S.started) {
        mouse.panning = false;
        mouse.lastX = t.x; mouse.lastY = t.y;
        if (!placeAt(t.x, t.y, "wreck", true)) sfx.deny();
        else afterChange();
      }
      e.preventDefault();
    }
  }
  function onUp(e) {
    if (ptrs[e.pointerId]) delete ptrs[e.pointerId];
    if (Object.keys(ptrs).length < 2) pinchState = null;
    if (e.button === 0) mouse.downL = false;
    if (e.button === 1) mouse.downM = false;
    if (e.button === 2) mouse.downR = false;
    if (!mouse.downL && !mouse.downR && !mouse.downM && !spaceDown) mouse.panning = false;
    if (e.button === 0 || e.button === 2) { mouse.lastX = -1; mouse.lastY = -1; }
    if (e.button === 0 && !mouse.moved && !S.tool && S.started && performance.now() - (mouse.downT || 0) < 600) {
      var c = screenToWorld(e.clientX, e.clientY);
      if (inb(c.x, c.y)) showMiniInfo(c);
      else hideMiniInfo();
    } else if (e.button === 0 && !mouse.moved && !S.tool) {
      hideMiniInfo();
    }
  }

  var spaceDown = false;
  function onKey(e) {
    if (modalBusy && e.key === "Escape") {
      modalEl.classList.remove("show");
      modalBusy = false;
      var next = dialogQueue.shift();
      if (next) presentDialog(next.o, next.c);
      return;
    }
    if (e.key === " ") {
      spaceDown = true;
      if (!mouse.downL && !mouse.downR && !mouse.downM) mouse.panning = true;
      e.preventDefault();
      return;
    }
    if (e.key.startsWith("Arrow")) {
      e.preventDefault();
      var kx = e.key === "ArrowLeft" ? 46 : e.key === "ArrowRight" ? -46 : 0;
      var ky = e.key === "ArrowUp" ? 46 : e.key === "ArrowDown" ? -46 : 0;
      S.cam.ox += kx; S.cam.oy += ky;
      updateCameraBounds();
      return;
    }
    if (e.key === "+" || e.key === "=") { zoomAt(1.2, null); return; }
    if (e.key === "-") { zoomAt(0.8, null); return; }
    var digits = { "1": "road", "2": "zr", "3": "zc", "4": "zi", "5": "park", "6": "power", "7": "wtower", "8": "police", "9": "gcpd", "0": "ark" };
    if (digits[e.key]) selectTool(digits[e.key]);
    if (e.key === "Escape") selectTool(null);
  }
  function onKeyUp(e) {
    if (e.key === " ") {
      spaceDown = false;
      if (!mouse.downL && !mouse.downR && !mouse.downM) mouse.panning = false;
    }
  }

  function zoomAt(f, clientPt) {
    var old = S.cam.z;
    var nz = Math.max(0.18, Math.min(3, old * f));
    var cw = stageEl.clientWidth, ch = stageEl.clientHeight;
    var px = clientPt ? clientPt.x - cv.getBoundingClientRect().left : cw / 2;
    var py = clientPt ? clientPt.y - cv.getBoundingClientRect().top : ch / 2;
    var wx = (px - S.cam.ox) / old;
    var wy = (py - S.cam.oy) / old;
    S.cam.z = nz;
    S.cam.ox = px - wx * nz;
    S.cam.oy = py - wy * nz;
    updateCameraBounds();
  }

  function onWheel(e) {
    e.preventDefault();
    zoomAt(e.deltaY < 0 ? 1.15 : 0.87, { x: e.clientX, y: e.clientY });
  }

  function onCtx(e) { e.preventDefault(); }

  var lastTickT = 0;
  function loop(ts) {
    var now = (typeof ts === "number") ? ts : performance.now();
    if (now - lastTickT < 10) { armNext(); return; }
    lastTickT = now;
    var dt = Math.min(0.25, (now - (S._last || now)) / 1000);
    S._last = now;
    S.time += dt;
    if (!S.paused && S.started) {
      S.hourAcc += dt * S.speed;
      while (S.hourAcc >= HOUR_REAL) {
        S.hourAcc -= HOUR_REAL;
        S.hour += 1;
        if (S.hour >= 24) {
          S.hour = 0;
          S.day += 1;
          dailyRoll();
          if (newsQ.length) renderNews();
        } else if (Math.floor(S.hour) % 2 === 0) {
          if (Math.random() < 0.05) { pushNews(flavorHeadline()); renderNews(); }
        }
        simHour();
        refreshUI();
        refreshInfo();
      }
    }
    S.hourFrac = S.hour + (S.hourAcc / HOUR_REAL);
    S.light = lightAt(S.hourFrac);
    updateMusic();
    updateCursorStatus();
    refreshUI();
    if (S.started) {
      S.saveAcc += dt;
      if (S.saveAcc > 12) { S.saveAcc = 0; autosave(); }
    }
    Render.frame(S);
    armNext();
  }

  var armBusy = false;
  function armNext() {
    if (armBusy) return;
    armBusy = true;
    var fired = false;
    var fire = function (now) {
      if (fired) return;
      fired = true;
      armBusy = false;
      loop(now);
    };
    requestAnimationFrame(fire);
    setTimeout(function () { fire(performance.now()); }, 100);
  }

  function lightAt(h) {
    if (h < 4.5) return 0.16;
    if (h < 8) return 0.16 + (h - 4.5) / 3.5 * 0.84;
    if (h < 17) return 1;
    if (h < 21.5) return 1 - (h - 17) / 4.5 * 0.84;
    return 0.16;
  }

  function updateCursorStatus() {
    var c = S.hover;
    if (!c) {
      S.cursor = null;
      if (S.ghost) { ghostArr.fill(0); S.ghost = null; }
      return;
    }
    var tool = S.tool;
    if (!tool || mouse.panning || !S.started) {
      S.cursor = null;
      if (S.ghost) { ghostArr.fill(0); S.ghost = null; }
      return;
    }
    var cs = cursorStatus();
    S.cursor = { x: c.x, y: c.y, ok: cs ? cs.ok : false };
    ghostArr.fill(0);
    ghostArr[idx(c.x, c.y)] = (cs && cs.ok) ? 1 : 2;
    S.ghost = { arr: ghostArr, okCol: toolMap[tool].sw, badCol: "#c0392b" };
  }

  var savedName = "gothamCitySave1";
  function kvStore() {
    try {
      if (window.root && root.kv) return root.kv.gothamBuilder;
    } catch (e) {}
    return null;
  }

  function autosave() {
    var store = kvStore();
    if (!store) return;
    var data = serialize();
    try {
      store.set(savedName, data).catch(function (e) {});
    } catch (e) {}
  }

  function serialize() {
    return {
      v: 3, money: S.money, tax: S.tax, day: S.day, hour: S.hour, speed: S.speed,
      land: Array.from(land), road: Array.from(road), zone: Array.from(zone),
      type: Array.from(type), dev: Array.from(dev), crime: Array.from(crime), poll: Array.from(poll),
      ach: S.ach, riddlesSolved: S.riddlesSolved, bailouts: S.bailouts,
      cleanStreak: S.cleanStreak, won: S.won, fired: S.fired, sound: S.sound
    };
  }

  function deserialize(d) {
    land.set(d.land); road.set(d.road); zone.set(d.zone); type.set(d.type); dev.set(d.dev);
    crime.set(d.crime); poll.set(d.poll);
    S.money = d.money; S.tax = d.tax; S.day = d.day; S.hour = d.hour; S.speed = d.speed;
    S.ach = d.ach || {}; S.riddlesSolved = d.riddlesSolved || 0; S.bailouts = d.bailouts || 0;
    S.cleanStreak = d.cleanStreak || 0; S.won = !!d.won; S.fired = !!d.fired;
    S.sound = d.sound !== undefined ? d.sound : true;
    afterChange();
  }

  function hasSave() {
    var store = kvStore();
    if (!store) return Promise.resolve(false);
    return store.get(savedName).then(function (d) { return !!(d && d.v); }).catch(function () { return false; });
  }

  function wipeSave() {
    var store = kvStore();
    if (store) { try { store.delete(savedName).catch(function () {}); } catch (e) {} }
  }

  function newCity() {
    fillMap();
    ghostArr.fill(0);
    S.ghost = null;
    S.crimeView = false; S.coverView = false;
    S.ach = {}; S.riddlesSolved = 0; S.bailouts = 0;
    S.cleanStreak = 0; S.won = false; S.fired = false;
    S.crimeSpike = 0; S.happyAdj = 0;
    S.money = START_MONEY;
    S.day = 1; S.hour = 6; S.hourAcc = 0;
    S.pop = 0; S.jobsC = 0; S.jobsI = 0; S.net = 0;
    S.crimeAvg = 8; S.happy = 80; S.lastE = 1;
    S.speed = 1;
    S.paused = false;
    timers.fill(0);
    afterChange();
    fitView();
    Render.buildGround(S);
    wipeSave();
    S.started = true;
    $("pauseBtn").textContent = "⏸";
    $("startScreen").style.display = "none";
    hideMiniInfo();
    refreshTopButtons();
    pushNews("A new Gotham rises. Roads first, Mayor.");
    renderNews();
    showIntro();
    setSpeed(S.speed);
    autosave();
  }

  function loadCity() {
    var store = kvStore();
    if (!store) { newCity(); return; }
    store.get(savedName).then(function (d) {
      if (!d || !d.v) { newCity(); return; }
      deserialize(d);
      fitView();
      Render.buildGround(S);
      S.started = true;
      $("startScreen").style.display = "none";
      hideMiniInfo();
      refreshTopButtons();
      setSpeed(S.speed);
      taxRange.value = S.tax;
      taxVal.textContent = S.tax + "%";
      pushNews("Welcome back, Mayor. Gotham survived without you. Barely.");
      renderNews();
    }).catch(function () { newCity(); });
  }

  var introShown = false;
  function showIntro() {
    if (introShown) return;
    introShown = true;
    showDialog({
      tag: "MAYOR'S BRIEFING",
      title: "Welcome to Gotham",
      text: "The previous administration left you an empty city, a river, and a very bad reputation. Lay roads, zone districts, and plug them into power and water. Homes attract people, people attract shops, shops attract villains. Keep crime down with the GCPD — or heavier solutions.",
      choices: ["I'll take the job", "Where do I start?"],
      onPick: function (ci) {
        if (ci === 1) {
          showDialog({ tag: "GOTHAM GAZETTE", title: "Starting Tips", text: "1. Drag roads to the river and across it (bridges!).\n2. Zone Residential near your road, then add a Power Plant and Water Tower beside the road.\n3. Zone Commercial and Industrial to create jobs.\n4. Right-click or use the Bulldoze tool to demolish.\n5. Drag with a tool to paint whole lines. Space/middle-drag pans, scroll zooms. Touch: drag paints, pinch zooms; tap the selected tool again to deselect and pan.\n6. Save is automatic. Beware of men in masks." });
        }
      }
    });
  }

  function helpModal() {
    var legend = $("legend");
    if (legend) {
      legend.innerHTML = "<b>Legend</b><br><span style='color:#a06b8a'>■</span> Residential &nbsp;<span style='color:#5f7db6'>■</span> Commercial<br><span style='color:#8a8348'>■</span> Industrial &nbsp;<span style='color:#3b4049'>■</span> Road<br><span style='color:#3f7d46'>■</span> Park";
    }
    showDialog({
      tag: "GOTHAM GAZETTE",
      title: "Mayor's Handbook",
      text: "ROADS: Every zone and service needs road access. Drag to paint. Roads can cross the river as bridges.\nZONES: Lots develop into buildings when powered, watered and served by roads. Residential needs jobs; Commercial and Industrial provide them. Land value (crime, pollution, parks) decides how tall they grow.\nSERVICES: Power Plants and Water Towers spread coverage. Police, GCPD HQ, Arkham and the Batcave suppress crime. Arkham and the Batcave are... very effective.\nLANDMARKS: Wayne Tower, the Gotham Light, museums, stadiums and hospitals please the public — but need power and cost upkeep.\nTAXES & BUDGET: Income is collected daily. Watch your net. Going broke triggers emergency loans.\nBeware the villains: Joker, Riddler, Catwoman, Scarecrow... Build all of GCPD HQ, Arkham and the Batcave, and the Dark Knight may take a personal interest in your city.\n★ Achievements & status. Keep crime low for 10 straight days and the Bat retires — you win. Two bailouts and the Governor fires you. ◉ toggles the crime heatmap. ♪ toggles music. On phones, tap any tile (no tool selected) to inspect it."
    });
  }

  function setSpeed(n) {
    S.speed = n;
    ["sp1", "sp2", "sp3", "sp4"].forEach(function (id) {
      var el = $(id);
      if (el) el.classList.toggle("active", id === "sp" + n);
    });
  }
  function refreshTopButtons() {
    var sb = $("soundBtn"), cb = $("crimeBtn"), cvb = $("coverBtn");
    if (sb) sb.classList.toggle("off", !S.sound);
    if (cb) cb.classList.toggle("active", !!S.crimeView);
    if (cvb) cvb.classList.toggle("active", !!S.coverView);
  }

  function setup() {
    if (window.__gothamSetupDone) return;
    window.__gothamSetupDone = true;
    Render.init(cv);
    buildToolbar();
    selectTool("road");
    newCityBtn.onclick = function () {
      showDialog({
        tag: "DEMOLITION PERMIT",
        title: "Start a new Gotham?",
        text: "This will raze the current city to the ground (and erase your saved progress). The villains will be thrilled.",
        choices: ["Tear it down", "Keep the city"],
        onPick: function (ci) { if (ci === 0) newCity(); }
      });
    };
    helpBtn.onclick = helpModal;
    var soundBtn = $("soundBtn"), crimeBtn = $("crimeBtn"), achBtn = $("achBtn");
    soundBtn.onclick = function () {
      S.sound = !S.sound;
      refreshTopButtons();
      if (S.sound) musicOn(); else musicOff();
    };
    crimeBtn.onclick = function () {
      S.crimeView = !S.crimeView;
      refreshTopButtons();
      pushNews(S.crimeView ? "CRIME MAP — heatmap overlaid. Red burns hottest." : "CRIME MAP — overlay off.");
      renderNews();
      if (S.crimeView) sfx.chime(); else sfx.deny();
    };
    var coverBtn = $("coverBtn");
    if (coverBtn) coverBtn.onclick = function () {
      S.coverView = !S.coverView;
      refreshTopButtons();
      pushNews(S.coverView ? "COVERAGE MAP — green has power & water. Yellow no water, blue no power, red neither." : "COVERAGE MAP — overlay off.");
      renderNews();
      if (S.coverView) sfx.chime(); else sfx.deny();
    };
    achBtn.onclick = achModal;
    $("miniClose").onclick = hideMiniInfo;
    refreshTopButtons();

    taxRange.addEventListener("input", function () {
      S.tax = parseInt(taxRange.value, 10);
      taxVal.textContent = S.tax + "%";
    });
    taxRange.value = S.tax;
    taxVal.textContent = S.tax + "%";

    $("pauseBtn").onclick = function () {
      S.paused = !S.paused;
      this.textContent = S.paused ? "▶" : "⏸";
      if (S.paused) $("pauseBtn").classList.add("active");
      else $("pauseBtn").classList.remove("active");
    };
    $("sp1").onclick = function () { setSpeed(1); };
    $("sp2").onclick = function () { setSpeed(2); };
    $("sp3").onclick = function () { setSpeed(3); };
    $("sp4").onclick = function () { setSpeed(4); };
    setSpeed(1);

    $("startNewBtn").onclick = function () { musicOn(); newCity(); };
    $("startLoadBtn").onclick = function () { musicOn(); loadCity(); };

    cv.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("pointermove", onMove);
    cv.addEventListener("wheel", onWheel, { passive: false });
    cv.addEventListener("contextmenu", onCtx);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    cv.addEventListener("pointerleave", function () {
      mouse.inside = false;
      if (!mouse.panning && !mouse.downL && !mouse.downR) { S.hover = null; S.cursor = null; }
    });

    window.addEventListener("resize", function () {
      resizeCanvas();
      fitView();
    });

    function resizeCanvas() {
      Render.resize(stageEl.clientWidth, stageEl.clientHeight);
    }
    resizeCanvas();
    fitView();
    armNext();

    hasSave().then(function (ok) {
      if (ok) {
        $("startLoadBtn").style.display = "inline-block";
        $("saveNote").textContent = "A saved Gotham was found — you can pick up where you left off.";
      }
    });
    var legend = $("legend");
    if (legend) {
      legend.innerHTML = "<b>Legend</b><br><span style='color:#a06b8a'>■</span> Residential &nbsp;<span style='color:#5f7db6'>■</span> Commercial<br><span style='color:#8a8348'>■</span> Industrial &nbsp;<span style='color:#3b4049'>■</span> Road<br><span style='color:#3f7d46'>■</span> Park";
    }
    window.addEventListener("pagehide", function () { if (S.started) autosave(); });
    window.addEventListener("pointerdown", function () {
      if (S.sound && S.started && (!audio.musicEl || audio.musicEl.paused)) musicOn();
    }, { passive: true });
  }

  document.addEventListener("DOMContentLoaded", function () { setup(); });
  if (document.readyState !== "loading") setup();
  setInterval(function () { if (newsQ.length) renderNews(); }, 14000);

  window.GOTHAM = {
    S: S, place: placeAt, selectTool: selectTool, newCity: newCity,
    simHour: simHour, dailyRoll: dailyRoll, fillMap: fillMap,
    simHourFrac: function (n) { for (var k = 0; k < n; k++) simHour(); },
    expose: { W: W, H: H, idx: idx, TYPE: TYPE, ZONE: ZONE },
    arrays: function () { return { land: land, road: road, zone: zone, type: type, dev: dev, crime: crime, poll: poll }; },
    landVal: function () { return landVal; },
    zoneArr: function () { return zone; },
    devArr: function () { return dev; }
  };
})();
