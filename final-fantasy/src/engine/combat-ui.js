// Task #18: Combat UI Overlay — DOM interface showing party HP/MP,
// enemy HP with target selection, and a scrolling combat log.

export class CombatUI {
  constructor(container, opts = {}) {
    this.container = container;
    this.combat = null;
    this.onCommand = opts.onCommand ?? null;
    this.selected = 0;
    this.messages = [];
    this._build();
  }

  _build() {
    this.container.innerHTML = `
      <div class="combat-ui">
        <div class="cu-top">
          <div class="cu-panel cu-party" id="cuParty"></div>
          <div class="cu-panel cu-enemies" id="cuEnemies"></div>
        </div>
        <div class="cu-log" id="cuLog"></div>
        <div class="cu-commands" id="cuCommands"></div>
      </div>
      <style>
        .combat-ui { font-family: monospace; color: #e8eefc; background: #0a0e1e; border: 2px solid #39456e; padding: 12px; min-width: 420px; }
        .cu-top { display: flex; gap: 12px; }
        .cu-panel { flex: 1; border: 1px solid #39456e; padding: 8px; background: #111733; }
        .cu-panel h3 { margin: 0 0 6px; font-size: 12px; letter-spacing: .12em; color: #8fa8e8; }
        .cu-row { font-size: 13px; padding: 2px 0; }
        .cu-row.dead { color: #7a4a52; }
        .cu-target { color: #ffd24a; }
        .cu-hp { color: #ff8a8a; }
        .cu-mp { color: #7ac8ff; }
        .cu-log { height: 110px; overflow-y: auto; border: 1px solid #39456e; margin-top: 10px; padding: 6px; background: #080c1a; font-size: 13px; line-height: 1.4; }
        .cu-log div { margin: 2px 0; }
        .cu-commands { display: flex; gap: 8px; margin-top: 10px; }
        .cu-commands button { flex: 1; background: #1b2440; color: #cfe0ff; border: 1px solid #39456e; padding: 6px 8px; cursor: pointer; font-family: monospace; }
        .cu-commands button:hover { background: #2a3b6e; }
        .cu-bar { height: 6px; background: #1a2138; margin: 2px 0 4px; }
        .cu-bar span { display: block; height: 100%; }
      </style>`;
    this.partyEl = this.container.querySelector("#cuParty");
    this.enemiesEl = this.container.querySelector("#cuEnemies");
    this.logEl = this.container.querySelector("#cuLog");
    this.commandsEl = this.container.querySelector("#cuCommands");
    const commands = ["Attack", "Magic", "Item", "Run"];
    for (const cmd of commands) {
      const btn = document.createElement("button");
      btn.textContent = cmd;
      btn.addEventListener("click", () => {
        if (this.onCommand) this.onCommand(cmd.toLowerCase(), this);
      });
      this.commandsEl.appendChild(btn);
    }
  }

  setCombat(combat) {
    this.combat = combat;
    this.selected = 0;
    return this;
  }

  setTarget(index) {
    this.selected = Math.max(0, Math.min(index, this.enemyCount() - 1));
    return this;
  }

  enemyCount() {
    return this.combat ? this.combat.enemies.length : 0;
  }

  pushLog(text) {
    this.messages.push(text);
    const div = document.createElement("div");
    div.textContent = text;
    this.logEl.appendChild(div);
    this.logEl.scrollTop = this.logEl.scrollHeight;
    return this;
  }

  clearLog() {
    this.messages = [];
    this.logEl.innerHTML = "";
    return this;
  }

  render() {
    this._renderParty();
    this._renderEnemies();
    return this;
  }

  _renderParty() {
    this.partyEl.innerHTML = "<h3>Party</h3>";
    if (!this.combat) return;
    for (const c of this.combat.party) {
      const stats = c.getStats ? c.getStats() : c;
      const row = document.createElement("div");
      row.className = "cu-row" + (c.hp <= 0 ? " dead" : "");
      row.innerHTML =
        "<b>" + c.name + "</b> <span class='cu-hp'>HP " + Math.max(0, c.hp) + "/" + stats.maxHp + "</span>" +
        " <span class='cu-mp'>MP " + Math.max(0, c.mp) + "/" + (stats.maxMp ?? 0) + "</span>";
      this.partyEl.appendChild(row);
      const bar = document.createElement("div");
      bar.className = "cu-bar";
      const fill = document.createElement("span");
      fill.style.width = Math.max(0, Math.min(100, (c.hp / stats.maxHp) * 100)) + "%";
      fill.style.background = c.hp > 0 ? "#ff6a6a" : "#555";
      bar.appendChild(fill);
      this.partyEl.appendChild(bar);
    }
  }

  _renderEnemies() {
    this.enemiesEl.innerHTML = "<h3>Enemies</h3>";
    if (!this.combat) return;
    this.combat.enemies.forEach((e, i) => {
      const row = document.createElement("div");
      row.className = "cu-row" + (e.hp <= 0 ? " dead" : "");
      const marker = i === this.selected ? "<span class='cu-target'>▶ </span>" : "";
      row.innerHTML =
        marker + "<b>" + e.name + "</b> <span class='cu-hp'>HP " + Math.max(0, e.hp) + "/" + e.maxHp + "</span>";
      this.enemiesEl.appendChild(row);
      const bar = document.createElement("div");
      bar.className = "cu-bar";
      const fill = document.createElement("span");
      fill.style.width = Math.max(0, Math.min(100, (e.hp / e.maxHp) * 100)) + "%";
      fill.style.background = e.hp > 0 ? "#c86aff" : "#555";
      bar.appendChild(fill);
      this.enemiesEl.appendChild(bar);
    });
  }
}
