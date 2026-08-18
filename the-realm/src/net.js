const MAX_NAME = 16;
const POS_INTERVAL = 250;
const CHAT_INTERVAL = 900;

export class Net {
  constructor(){
    this.roster = new Map();
    this.myId = null;
    this.connected = false;
    this.online = 0;
    this.socket = null;
    this.retryIdx = 0;
    this.stopped = false;
    this.handlers = { roster: [], chat: [], status: [], joined: [] };
    this._lastPos = 0;
    this._lastChat = 0;
    this._joinResolvers = [];
  }

  on(type, fn){ this.handlers[type].push(fn); }
  emit(type, data){ for (const fn of this.handlers[type]) fn(data); }

  async connect(){
    if (this.stopped) return;
    try {
      const socket = root.createServerSocket();
      this.socket = socket;
      await socket.opened;
      socket.addEventListener('message', ev => this._onMessage(ev.data));
      socket.addEventListener('close', () => this._onClose());
      this.connected = true;
      this.retryIdx = 0;
      this.emit('status', { connected: true });
      this._peek();
    } catch (e){
      this._scheduleReconnect();
    }
  }

  async _peek(){
    try {
      const reply = await this.socket.rpc.peek('{}');
      const data = JSON.parse(reply);
      if (data && typeof data.online === 'number') this.online = data.online;
      this.emit('status', { connected: true, online: this.online });
    } catch (e){ /* emulator/older server may not have peek */ }
  }

  async join(info){
    try {
      const reply = await this.socket.rpc.join(JSON.stringify(info));
      const data = JSON.parse(reply);
      if (!data.ok) return false;
      this.myId = data.id;
      this.online = data.online;
      for (const p of data.players || []) this.roster.set(p.id, p);
      this.emit('status', { connected: true, online: this.online });
      this.emit('joined', { myId: data.id });
      return true;
    } catch (e){
      return false;
    }
  }

  _onMessage(raw){
    let m;
    try { m = JSON.parse(raw); } catch (e){ return; }
    if (!m || typeof m !== 'object') return;
    if (m.t === 1){
      this.roster.set(m.id, { id: m.id, name: m.n, cls: m.c, lvl: m.l, x: m.x, y: m.y });
      this.emit('roster', this.roster);
    } else if (m.t === 2){
      const p = this.roster.get(m.id);
      if (p){ p.x = m.x; p.y = m.y; p.lvl = m.l; this.emit('roster', this.roster); }
    } else if (m.t === 3){
      this.emit('chat', { name: m.n, text: m.m, id: m.id });
    } else if (m.t === 4){
      this.roster.delete(m.id);
      this.emit('roster', this.roster);
    }
  }

  _onClose(){
    this.connected = false;
    this.emit('status', { connected: false });
    this.roster.clear();
    this.myId = null;
    this._scheduleReconnect();
  }

  _scheduleReconnect(){
    if (this.stopped || this.connected) return;
    const delays = [800, 2000, 5000, 10000, 20000];
    const d = delays[Math.min(this.retryIdx, delays.length - 1)];
    this.retryIdx++;
    setTimeout(() => { if (!this.stopped && !this.connected) this.connect(); }, d);
  }

  sendPos(x, y, lvl){
    if (!this.connected || !this.socket || this.socket.readyState !== 1) return;
    const now = performance.now();
    if (now - this._lastPos < POS_INTERVAL) return;
    this._lastPos = now;
    try { this.socket.send(JSON.stringify({ t: 2, x: Math.round(x), y: Math.round(y), l: lvl })); } catch (e){}
  }

  sendChat(text){
    if (!this.connected || !this.socket || this.socket.readyState !== 1) return false;
    const now = performance.now();
    if (now - this._lastChat < CHAT_INTERVAL) return false;
    this._lastChat = now;
    try { this.socket.send(JSON.stringify({ t: 3, m: text })); return true; } catch (e){ return false; }
  }

  stop(){
    this.stopped = true;
    if (this.socket && this.socket.readyState <= 1) this.socket.close(1000, 'leave');
  }
}
