import { clamp, bearingDeg, rangeNm, normalizeDeg, DR } from './world.js';

export class UI {
  constructor() {
    this.els = {};
    this.state = {
      view: 'tac', scale: 12, cx: 0, cy: 0, centerOnShip: true,
      cursor: { x: 0, y: 0 }, cursorValid: false, selected: null,
      weaponType: 'mk48', speedMode: 'FAST',
      paused: false, timeComp: 10,
    };
    this.world = null;
    this.campaign = null;
    this.lastLogCount = 0;
    this.lastTick = 0;
    this.panning = false;
    this.panStart = null;
  }

  bind(world, campaign, renderer) {
    this.world = world;
    this.campaign = campaign;
    this.renderer = renderer;
  }

  $(sel) { return document.querySelector(sel); }

  buildTitle() {
    const el = this.$('#titleScreen');
    el.innerHTML = `
      <h1>RED STORM RISING</h1>
      <div class="sub">TACTICAL SUBMARINE WARFARE · NORTH ATLANTIC · 1988</div>
      <div class="menu">
        <button class="menuItem" id="miCampaign">BEGIN CAMPAIGN</button>
        <button class="menuItem" id="miFreePlay">FREE PATROL</button>
        <button class="menuItem" id="miHelp">HOW TO PLAY</button>
      </div>
      <div class="titleText">USS DALLAS · LOS ANGELES CLASS SSN · COMMANDING OFFICER REPORTING</div>
      <div class="titleText blink">▌</div>
    `;
    this.$('#miCampaign').onclick = () => this.startCampaign();
    this.$('#miFreePlay').onclick = () => this.startFreePlay();
    this.$('#miHelp').onclick = () => this.showHelp();
  }

  startCampaign() {
    const first = this.campaign.missions.find(m => m.state === 'available');
    if (!first) return;
    this.showBriefing(first);
  }

  startFreePlay() {
    const avail = this.campaign.missions.filter(m => m.state !== 'locked');
    const pick = avail[Math.floor(Math.random() * avail.length)] || this.campaign.missions[0];
    this.showBriefing(pick);
  }

  showHelp() {
    const el = this.$('#briefingScreen');
    el.innerHTML = `
      <div class="briefCard" style="max-width:820px;">
        <h2>HOW TO PLAY</h2>
        <div class="meta">USS DALLAS — LOS ANGELES CLASS SSN</div>
        <p>
          You command a nuclear attack submarine. Your eyes are PASSIVE SONAR: contacts appear as bearings
          with uncertain ranges. Track a contact and the fire-control solution improves. Classify it
          (MERCHANT / SURFACE / SUBMARINE) to sharpen the estimate.
        </p>
        <p>
          <b>ACTIVE PING [P]</b> gives exact range but reveals your position to everything in the water.
          At PERISCOPE DEPTH you can sight ships visually. Stay quiet — a launch transient or a careless
          ping lets the Soviets find you. They WILL hunt you with ASW missiles, torpedoes and helicopters.
        </p>
        <p>
          <b>MK-48 TORPEDOES</b> are wire-guided: steer them, or let them home. Soviet SET-65 and Type 53
          wake-homers come back at you. Decoys and noisemakers are your escape tools. FLOODING and fires
          must be repaired by your damage-control teams.
        </p>
        <div class="obj">
          <div><b>CONTROLS</b></div>
          <div>MOUSE — move cursor · click empty water = set course · click contact = select</div>
          <div>DRAG — pan map · WHEEL — zoom · [F] — recenter on ship</div>
          <div>[SPACE] pause · [+]/[-] time compression · [S] sonar station · [C] campaign map · [ESC] back</div>
          <div>[P] active ping · [ENTER] fire selected contact · [B] break wire · [D] decoy · [N] noisemaker</div>
          <div>ARROWS — turn/change speed · [TAB] cycle contacts</div>
        </div>
        <p style="margin-top:16px;"><button class="btn primary" id="helpBack">BACK TO MAIN</button></p>
      </div>
    `;
    this.$('#helpBack').onclick = () => { this.showTitle(); };
    this.switchScreen('briefing');
  }

  showTitle() {
    this.switchScreen('title');
  }

  showBriefing(mission) {
    this.campaign.currentMission = mission;
    const el = this.$('#briefingScreen');
    const world = null;
    el.innerHTML = `
      <div class="briefCard">
        <h2>${mission.title}</h2>
        <div class="meta">CLASSIFIED · EYES ONLY · USS DALLAS (SSN-700)</div>
        <p>${mission.brief}</p>
        <div class="obj">
          <div style="color:#7dffa0;">PRIMARY OBJECTIVE — ${mission.objPrimary.label}</div>
          <div style="color:#d7ffb0;">SECONDARY — ${mission.objSecondary.label}</div>
        </div>
        <p style="margin-top:16px;"><button class="btn primary" id="briefGo">PROCEED TO PATROL AREA</button></p>
      </div>
    `;
    this.$('#briefGo').onclick = () => this.launchMission(mission);
    this.switchScreen('briefing');
  }

  launchMission(mission) {
    const world = this.campaign.generateWorld(mission);
    this.world = world;
    const st = this.state;
    st.view = 'tac';
    st.centerOnShip = true;
    st.selected = null;
    st.cx = world.player.x; st.cy = world.player.y;
    st.scale = 12;
    st.paused = false; st.timeComp = 10;
    st.cursor = { x: world.player.x, y: world.player.y };
    st.cursorValid = false;
    this.lastLogCount = 0;
    this.buildGameUI(world);
    this.switchScreen('game');
    this.buildTopbar(world, mission);
    world.addLog(`UNDERWAY — ${mission.title}`, 'info');
    world.addLog('RECOMMEND RIG FOR SILENT RUNNING AND PROCEED TO THE DATUM', 'info');
  }

  buildGameUI(world) {
    const side = this.$('#sidebar');
    side.innerHTML = `
      <section data-p="nav">
        <h3>■ COMMAND</h3>
        <div class="body">
          <div class="row"><span class="lbl">SPEED</span>
            <button class="btn small" data-spd="0">STOP</button>
            <button class="btn small" data-spd="5">SLOW</button>
            <button class="btn small" data-spd="10">1/3</button>
            <button class="btn small" data-spd="15">STD</button>
            <button class="btn small" data-spd="25">FLANK</button>
          </div>
          <div class="row"><span class="lbl">COURSE</span>
            <input id="courseInput" type="number" min="0" max="359" value="${String(Math.round(world.player.heading)).padStart(3, '0')}" style="width:60px;background:#062313;color:#d7ffb0;border:1px solid #1e5c3a;font-family:inherit;">
            <button class="btn small" id="courseSet">SET</button>
          </div>
          <div class="row"><span class="lbl">DEPTH</span>
            <button class="btn small" data-dpt="20">PER</button>
            <button class="btn small" data-dpt="60">60m</button>
            <button class="btn small" data-dpt="150">150</button>
            <button class="btn small" data-dpt="250">250</button>
            <button class="btn small" data-dpt="400">MAX</button>
          </div>
          <div class="row">
            <button class="btn small" id="silentBtn">SILENT RUNNING: OFF</button>
            <button class="btn small" id="stopBtn">ALL STOP</button>
          </div>
        </div>
      </section>
      <section data-p="sonar">
        <h3>■ SONAR</h3>
        <div class="body">
          <div class="row"><span class="lbl">MODE</span><span class="val" id="sonarMode">PASSIVE</span><span class="lbl" id="ownNoiseLbl">SELF NOISE</span><span class="val" id="ownNoise">—</span></div>
          <div class="row"><span class="lbl">SEA</span><span class="val" id="seaState">—</span></div>
          <div class="row"><span class="lbl">ESM</span><span class="val" id="esmRead">—</span></div>
          <div class="row"><button class="btn" id="pingBtn">ACTIVE PING [P]</button><span class="val" id="pingCd">READY</span></div>
        </div>
      </section>
      <section data-p="weapons">
        <h3>■ WEAPONS</h3>
        <div class="body">
          <div class="row"><span class="lbl">LOAD</span>
            <button class="btn small" data-wpn="mk48">MK-48</button>
            <button class="btn small" data-wpn="harpoon">HARPOON</button>
          </div>
          <div class="row"><span class="lbl">SPEED</span>
            <button class="btn small" data-spdmd="FAST">FAST</button>
            <button class="btn small" data-spdmd="SLOW">SLOW</button>
          </div>
          <div class="row"><span class="val" id="tubeStatus">—</span></div>
          <div class="row"><button class="btn primary" id="fireBtn">FIRE [ENTER]</button><span class="val" id="fireMsg"></span></div>
          <div class="row"><span class="lbl">WIRE</span>
            <button class="btn small" id="wl">◄</button>
            <button class="btn small" id="wr">►</button>
            <button class="btn small" id="wa">AUTO</button>
            <button class="btn small" id="wb">BREAK</button>
          </div>
          <div class="row">
            <button class="btn small" id="decoyBtn">DECOY <span id="decoyCount">4</span></button>
            <button class="btn small" id="noiseBtn">NOISEMAKER <span id="noiseCount">4</span></button>
          </div>
        </div>
      </section>
      <section data-p="contacts">
        <h3>■ CONTACTS <span class="count" id="ctcCount"></span></h3>
        <div class="body" id="contactsBody"></div>
      </section>
      <section data-p="damage">
        <h3>■ STATUS</h3>
        <div class="body">
          <div class="row"><span class="lbl">HULL</span><div class="barBg" style="flex:1;"><div class="bar" id="hullBar"></div></div><span class="val" id="hullTxt"></span></div>
          <div class="row"><span class="lbl">FLDG</span><div class="barBg" style="flex:1;"><div class="bar bad" id="fldgBar"></div></div><span class="val" id="fldgTxt"></span></div>
          <div class="row"><span class="lbl">SONAR</span><div class="barBg" style="flex:1;"><div class="bar" id="sysSonar"></div></div></div>
          <div class="row"><span class="lbl">PROP</span><div class="barBg" style="flex:1;"><div class="bar" id="sysProp"></div></div></div>
          <div class="row"><span class="lbl">STEER</span><div class="barBg" style="flex:1;"><div class="bar" id="sysSteer"></div></div></div>
          <div class="row"><span class="lbl">WPN</span><div class="barBg" style="flex:1;"><div class="bar" id="sysWpn"></div></div></div>
          <div class="row"><span class="lbl">REPAIR</span>
            <button class="btn small" data-teams="0">0</button>
            <button class="btn small" data-teams="1">1</button>
            <button class="btn small" data-teams="2">2</button>
            <span class="val" id="teamsTxt"></span>
          </div>
        </div>
      </section>
    `;
    this.bindSidebar(side, world);
  }

  bindSidebar(side, world) {
    side.querySelectorAll('h3').forEach(h => h.onclick = () => {
      const b = h.parentElement.querySelector('.body');
      b.hidden = !b.hidden;
    });
    side.querySelectorAll('[data-spd]').forEach(b => b.onclick = () => { world.player.speedCmd = +b.dataset.spd; });
    side.querySelectorAll('[data-dpt]').forEach(b => b.onclick = () => { world.player.depthCmd = +b.dataset.dpt; });
    side.querySelectorAll('[data-teams]').forEach(b => b.onclick = () => { world.player.repairTeams = +b.dataset.teams; });
    side.querySelectorAll('[data-wpn]').forEach(b => b.onclick = () => { this.state.weaponType = b.dataset.wpn; });
    side.querySelectorAll('[data-spdmd]').forEach(b => b.onclick = () => { this.state.speedMode = b.dataset.spdmd; });
    const silentBtn = this.$('#silentBtn');
    silentBtn.onclick = () => {
      world.player.silent = !world.player.silent;
      silentBtn.textContent = world.player.silent ? 'SILENT RUNNING: ON' : 'SILENT RUNNING: OFF';
      world.addLog(world.player.silent ? 'RIGGED FOR SILENT RUNNING — engines on standby, speed limited' : 'SILENT RUNNING CANCELED', 'info');
    };
    this.$('#courseSet').onclick = () => {
      const v = Math.round(+this.$('#courseInput').value || 0);
      world.player.headingCmd = normalizeDeg(v);
      world.addLog(`COURSE ${String(v).padStart(3, '0')}`, 'info');
    };
    this.$('#stopBtn').onclick = () => { world.player.speedCmd = 0; };
    this.$('#pingBtn').onclick = () => this.world.activePing();
    this.$('#fireBtn').onclick = () => this.fireSelected();
    const wire = {
      l: this.$('#wl'), r: this.$('#wr'), a: this.$('#wa'), b: this.$('#wb'),
    };
    wire.l.onclick = () => this.steerWire(-30);
    wire.r.onclick = () => this.steerWire(30);
    wire.a.onclick = () => this.autoWire();
    wire.b.onclick = () => this.breakWire();
    this.$('#decoyBtn').onclick = () => this.world.deployDecoy();
    this.$('#noiseBtn').onclick = () => this.world.deployNoisemaker();
  }

  buildTopbar(world, mission) {
    const tb = this.$('#topbar');
    tb.innerHTML = `
      <span class="tbTitle">${mission.title}</span>
      <span class="spacer"></span>
      <span class="clock" id="clockEl">${world.clock()}</span>
      <span class="tbTitle" id="compLbl">×${this.state.timeComp}</span>
      <button class="compBtn" data-comp="1">1×</button>
      <button class="compBtn" data-comp="10">10×</button>
      <button class="compBtn" data-comp="60">60×</button>
      <button class="compBtn" data-comp="300">300×</button>
      <button class="btn small" id="pauseBtn">⏸</button>
      <button class="btn small" id="sonarViewBtn">SONAR</button>
      <button class="btn small" id="campaignBtn">MAP</button>
      <button class="btn small" id="centerBtn">CENTER</button>
    `;
    tb.querySelectorAll('[data-comp]').forEach(b => {
      b.onclick = () => { this.state.timeComp = +b.dataset.comp; this.state.paused = false; };
    });
    this.$('#pauseBtn').onclick = () => { this.state.paused = !this.state.paused; };
    this.$('#sonarViewBtn').onclick = () => { this.state.view = this.state.view === 'sonar' ? 'tac' : 'sonar'; };
    this.$('#campaignBtn').onclick = () => { this.state.view = this.state.view === 'campaign' ? 'tac' : 'campaign'; };
    this.$('#centerBtn').onclick = () => { this.state.centerOnShip = true; };
  }

  steerWire(delta) {
    const ws = this.wireTorps();
    for (const w of ws) { w.autoSteer = false; w.headingCmd = normalizeDeg(w.heading + delta); }
    if (ws.length) this.world.addLog('MANUAL WIRE GUIDANCE OVERRIDE', 'info');
  }
  autoWire() {
    const ws = this.wireTorps();
    for (const w of ws) { w.autoSteer = true; w.headingCmd = null; }
    if (ws.length) this.world.addLog('WIRE GUIDANCE — AUTO', 'info');
  }
  breakWire() {
    const ws = this.wireTorps();
    for (const w of ws) { w.wire = false; w.headingCmd = null; }
    if (ws.length) this.world.addLog('WIRE BROKEN — torpedo autonomous', 'info');
  }
  wireTorps() {
    return this.world.weapons.filter(w => w.wire && w.launcherId === this.world.player.id);
  }

  fireSelected() {
    const c = this.selectedContact();
    if (!c) { this.world.addLog('[WEAPONS] NO CONTACT SELECTED', 'danger'); return; }
    if (!c.range || c.range <= 0) { this.world.addLog('[WEAPONS] NO RANGE SOLUTION — ping or close for a fix', 'danger'); return; }
    this.world.playerFire(this.state.weaponType, this.state.speedMode, c);
  }

  selectedContact() {
    if (!this.state.selected) return null;
    return this.world.contacts.get(this.state.selected) || null;
  }

  switchScreen(name) {
    for (const s of ['title', 'briefing', 'game', 'end']) {
      const el = this.$('#' + s + 'Screen');
      if (el) el.hidden = s !== name;
    }
  }

  update(dt, now) {
    const world = this.world;
    if (!world) return;
    const st = this.state;
    if (st.view === 'tac' && st.centerOnShip) {
      st.cx = world.player.x; st.cy = world.player.y;
    }
    if (now - this.lastTick > 250) {
      this.lastTick = now;
      this.updatePanels(world, dt);
      this.updateTopbar(world);
    }
  }

  updateTopbar(world) {
    const c = this.$('#clockEl');
    if (c) c.textContent = world.clock();
    const cl = this.$('#compLbl');
    if (cl) cl.textContent = this.state.paused ? 'PAUSED' : `×${this.state.timeComp}`;
    const pb = this.$('#pauseBtn');
    if (pb) pb.textContent = this.state.paused ? '▶' : '⏸';
  }

  updatePanels(world, dt) {
    const pl = world.player;
    this.$('#ownNoise').textContent = pl.selfNoise.toFixed(1);
    this.$('#seaState').textContent = world.sea.factor < 0.9 ? 'FAVORABLE' : world.sea.factor < 1.1 ? 'NORMAL' : 'NOISY';
    this.$('#esmRead').textContent = pl.esm ? `RADAR ${String(Math.round(pl.esm.brg)).padStart(3, '0')}°` : '—';
    const pingCd = 20 - (world.t - (pl.lastPingT || 0));
    const pb = this.$('#pingBtn');
    if (pingCd > 0) { pb.disabled = true; this.$('#pingCd').textContent = pingCd.toFixed(0) + 's'; }
    else { pb.disabled = false; this.$('#pingCd').textContent = 'READY'; }

    const tubes = pl.tubes.map(t => t.ready ? `T${t.idx + 1} READY` : `T${t.idx + 1} ${Math.ceil(t.reloadT)}s`).join('  ');
    this.$('#tubeStatus').textContent = tubes;

    this.$('#decoyCount').textContent = pl.decoys;
    this.$('#noiseCount').textContent = pl.noisemakers;

    const sel = this.selectedContact();
    this.$('#fireMsg').textContent = sel ? `TARGET C${sel.num}` : '';

    this.$('#hullBar').style.width = Math.max(0, pl.hull) + '%';
    this.$('#hullBar').className = 'bar' + (pl.hull < 40 ? ' bad' : '');
    this.$('#hullTxt').textContent = pl.hull.toFixed(0) + '%';
    this.$('#fldgBar').style.width = Math.max(0, Math.min(100, pl.flooding)) + '%';
    this.$('#fldgTxt').textContent = pl.flooding.toFixed(0) + '%';
    for (const [k, sel2] of [['sonar', '#sysSonar'], ['propulsion', '#sysProp'], ['steering', '#sysSteer'], ['weapons', '#sysWpn']]) {
      const el = this.$(sel2);
      if (el) { el.style.width = Math.max(0, pl.systems[k]) + '%'; el.className = 'bar' + (pl.systems[k] < 40 ? ' bad' : ''); }
    }
    this.$('#teamsTxt').textContent = pl.repairTeams;

    this.updateContacts(world);
    this.updateConsole(world);
    this.updateAlert(world);
  }

  updateContacts(world) {
    const body = this.$('#contactsBody');
    const ctcs = [...world.contacts.values()].sort((a, b) => a.num - b.num);
    this.$('#ctcCount').textContent = '(' + ctcs.length + ')';
    if (!ctcs.length) {
      body.innerHTML = '<div style="color:#3d7a55;padding:4px 0;">NO CONTACTS — LISTEN ON PASSIVE</div>';
      return;
    }
    const rows = ctcs.map(c => {
      const rangeTxt = c.range > 0 ? `${c.range.toFixed(0)}±${c.rangeErr.toFixed(0)}` : 'RNG?';
      const spdTxt = c.speed > 0 ? c.speed.toFixed(0) : '—';
      const isSel = this.state.selected === c.targetId;
      return `<tr class="${isSel ? 'ctcSel' : ''}" data-id="${c.targetId}">
        <td>C${c.num}</td><td>${String(Math.round(c.bearing)).padStart(3, '0')}°</td><td>${rangeTxt}</td>
        <td>${spdTxt}</td><td><button class="btn small ctcSelBtn" data-id="${c.targetId}">SEL</button></td>
        <td>${this.classBtns(c)}</td>
      </tr>`;
    }).join('');
    body.innerHTML = `<table class="contacts"><tr><th>ID</th><th>BRG</th><th>RNG</th><th>SPD</th><th></th><th>CLASSIFY</th></tr>${rows}</table>`;
    body.querySelectorAll('.ctcSelBtn').forEach(b => b.onclick = () => {
      const id = b.dataset.id;
      this.state.selected = this.state.selected === id ? null : id;
    });
    body.querySelectorAll('[data-class]').forEach(b => b.onclick = () => {
      const c = world.contacts.get(b.dataset.id);
      if (!c) return;
      c.suspect = b.dataset.class;
      c.q = Math.min(1, c.q + 0.15);
      world.addLog(`CONTACT C${c.num} CLASSIFIED AS ${b.dataset.class}`, 'sonar');
    });
  }

  classBtns(c) {
    const marks = [['?', 'UNKNOWN'], ['M', 'MERCHANT'], ['S', 'SURFACE'], ['B', 'SUBMARINE'], ['A', 'AIR']];
    return marks.map(([ch, val]) => {
      const on = c.suspect === val ? ' style="background:#123a24;color:#fff;"' : '';
      return `<button class="btn small" data-class="${val}" data-id="${c.targetId}" title="${val}" ${on}>${ch}</button>`;
    }).join('');
  }

  updateConsole(world) {
    const log = this.$('#consoleLog');
    while (this.lastLogCount < world.log.length) {
      const e = world.log[this.lastLogCount++];
      const t = e.t % 86400;
      const ts = `${String(Math.floor(t / 3600)).padStart(2, '0')}:${String(Math.floor(t % 3600 / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
      const cls = { info: 'logInfo', danger: 'logDanger', success: 'logSuccess', sonar: 'logSonar', radio: 'logRadio' }[e.type] || 'logInfo';
      log.insertAdjacentHTML('beforeend', `<span class="logTime">[${ts}]</span> <span class="${cls}">${e.text}</span><br>`);
    }
    log.scrollTop = log.scrollHeight;
    if (world.log.length > 200) { log.innerHTML = log.innerHTML.slice(-12000); }
  }

  updateAlert(world) {
    const flash = this.$('#redflash');
    const incoming = world.weapons.some(w => w.side === 'sov' && w.kind === 'torpedo' && rangeNm({ x: w.x, y: w.y }, world.player) < 6);
    flash.style.display = incoming ? 'block' : 'none';
  }

  bindCanvas(canvas) {
    canvas.addEventListener('mousemove', (e) => {
      const r = canvas.getBoundingClientRect();
      const px = e.clientX - r.left, py = e.clientY - r.top;
      const st = this.state;
      st.cursorValid = true;
      st.cursor.x = st.cx + (px - this.renderer.w / 2) / st.scale;
      st.cursor.y = st.cy - (py - this.renderer.h / 2) / st.scale;
      if (this.panning && !st.centerOnShip) {
        st.cx = this.panStart.cx - (px - this.panStart.x) / st.scale;
        st.cy = this.panStart.cy + (py - this.panStart.y) / st.scale;
      }
    });
    canvas.addEventListener('mousedown', (e) => {
      this.panning = true;
      const r = canvas.getBoundingClientRect();
      this.panStart = { x: e.clientX - r.left, y: e.clientY - r.top, cx: this.state.cx, cy: this.state.cy };
    });
    window.addEventListener('mouseup', () => { this.panning = false; });
    canvas.addEventListener('click', (e) => {
      const st = this.state;
      const wp = { x: st.cursor.x, y: st.cursor.y };
      const near = this.contactNear(wp);
      if (near) {
        st.selected = this.state.selected === near.targetId ? null : near.targetId;
        return;
      }
      const pl = this.world.player;
      const d = rangeNm(pl, wp);
      if (d < 0.15) return;
      pl.headingCmd = bearingDeg(pl, wp);
      this.world.addLog(`COURSE TO POINT — ${String(Math.round(bearingDeg(pl, wp))).padStart(3, '0')}°`, 'info');
    });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const st = this.state;
      const factor = e.deltaY < 0 ? 1.25 : 0.8;
      st.scale = clamp(st.scale * factor, 2, 60);
    }, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  contactNear(wp) {
    const pl = this.world.player;
    let best = null, bestD = 999;
    for (const c of this.world.contacts.values()) {
      if (!c.range) continue;
      const pos = { x: pl.x + Math.sin(c.bearing * DR) * c.range, y: pl.y + Math.cos(c.bearing * DR) * c.range };
      const d = Math.hypot(pos.x - wp.x, pos.y - wp.y);
      if (d < bestD && d < Math.max(0.4, c.rangeErr * 0.5)) { bestD = d; best = c; }
    }
    return best;
  }

  bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      const st = this.state;
      const pl = this.world ? this.world.player : null;
      if (e.key === ' ') { e.preventDefault(); st.paused = !st.paused; }
      else if (e.key === '=' || e.key === '+') { st.timeComp = Math.min(300, st.timeComp * 3); st.paused = false; }
      else if (e.key === '-' || e.key === '_') { st.timeComp = Math.max(1, st.timeComp / 3); st.paused = false; }
      else if (e.key.toLowerCase() === 's') { st.view = st.view === 'sonar' ? 'tac' : 'sonar'; }
      else if (e.key.toLowerCase() === 'c') { st.view = st.view === 'campaign' ? 'tac' : 'campaign'; }
      else if (e.key === 'Escape') { st.view = 'tac'; st.centerOnShip = true; }
      else if (e.key.toLowerCase() === 'f') { st.centerOnShip = true; }
      else if (e.key.toLowerCase() === 'p') { if (this.world) this.world.activePing(); }
      else if (e.key === 'Enter') { this.fireSelected(); }
      else if (e.key.toLowerCase() === 'b') { this.breakWire(); }
      else if (e.key.toLowerCase() === 'd') { if (this.world) this.world.deployDecoy(); }
      else if (e.key.toLowerCase() === 'n') { if (this.world) this.world.deployNoisemaker(); }
      else if (e.key === 'ArrowLeft') { if (pl) pl.headingCmd = normalizeDeg(pl.heading - 15); }
      else if (e.key === 'ArrowRight') { if (pl) pl.headingCmd = normalizeDeg(pl.heading + 15); }
      else if (e.key === 'ArrowUp') { if (pl) pl.speedCmd = Math.min(pl.maxSpeed, pl.speedCmd + 3); }
      else if (e.key === 'ArrowDown') { if (pl) pl.speedCmd = Math.max(0, pl.speedCmd - 3); }
      else if (e.key === 'Tab') { e.preventDefault(); this.cycleContact(); }
    });
  }

  cycleContact() {
    const ctcs = [...this.world.contacts.values()].sort((a, b) => a.num - b.num);
    if (!ctcs.length) return;
    const idx = ctcs.findIndex(c => c.targetId === this.state.selected);
    this.state.selected = ctcs[(idx + 1) % ctcs.length].targetId;
  }

  showEnd(world, campaign) {
    const el = this.$('#endScreen');
    const stats = world.missionStats;
    const win = world.overType === 'success';
    const heading = win ? 'MISSION ACCOMPLISHED' : 'DALLAS LOST WITH ALL HANDS';
    const color = win ? '#7dffa0' : '#ff8a70';
    el.innerHTML = `
      <h1 style="color:${color};">${heading}</h1>
      <div class="stats">
        SHIPS SUNK: ${stats.sunk.length ? stats.sunk.join(', ') : 'none'}<br>
        TONNAGE: ${stats.tonnage.toLocaleString()}t · TORPEDOES/MISSILES FIRED: ${stats.launched} · PINGS: ${stats.pings}<br>
        CAMPAIGN TOTAL: ${campaign.tonnage.toLocaleString()}t
      </div>
      <div><button class="btn primary" id="endContinue">${win ? 'RETURN TO CINCLANT' : 'TRY AGAIN'}</button></div>
    `;
    this.$('#endContinue').onclick = () => {
      campaign.missionResults(world);
      campaign.advanceDay(world);
      campaign.unlockNext();
      if (campaign.over) {
        this.showVictory(campaign);
      } else {
        this.switchScreen('title');
        this.buildTitle();
      }
    };
    this.switchScreen('end');
  }

  showVictory(campaign) {
    const el = this.$('#endScreen');
    el.innerHTML = `
      <h1 style="color:#7dffa0;">ATLANTIC CAMPAIGN COMPLETE</h1>
      <div class="stats">
        DAYS OF WAR: ${campaign.day}<br>
        TOTAL TONNAGE SUNK: ${campaign.tonnage.toLocaleString()}t<br>
        CONVOYS DELIVERED: ${campaign.convoysDelivered} · CONVOYS LOST: ${campaign.convoysLost}<br><br>
        THE ATLANTIC LIFELINE HOLDS. THE KIDO BUTAI OF THE NORTHERN FLEET IS BROKEN.
      </div>
      <div><button class="btn primary" id="victoryBack">MAIN MENU</button></div>
    `;
    this.$('#victoryBack').onclick = () => { this.switchScreen('title'); this.buildTitle(); };
    this.switchScreen('end');
  }

  showHint() {
    const hint = this.$('#hintBar');
    const texts = [
      'Move slowly and stay silent — your engines betray you.',
      'Contacts begin as bearings. Track them: range sharpens with time.',
      'Classify contacts in the CONTACTS panel to sharpen the solution.',
      'An ACTIVE PING [P] gives exact range — but tells them exactly where you are.',
      'Fires a MK-48 with [ENTER] once a contact is selected.',
      'Wire-guided torpedoes can be steered — break the wire and they hunt alone.',
    ];
    let i = 0;
    hint.hidden = false;
    const iv = setInterval(() => {
      hint.textContent = texts[i % texts.length];
      i++;
      if (i >= texts.length * 2) { clearInterval(iv); hint.hidden = true; }
    }, 7000);
  }
}
