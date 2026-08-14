// WebSocket facade wrapper for the perchance server-plugin socket.
// Handles auto-reconnect with capped exponential backoff.

export class SocketClient {
  constructor(opts) {
    this.create = opts.create;
    this.onMessage = opts.onMessage || (() => {});
    this.onStatus = opts.onStatus || (() => {});
    this.socket = null;
    this.connected = false;
    this.reconnectDelay = 800;
    this.closed = false;
    this.connecting = false;
  }

  connect() {
    if (this.closed || this.connecting) return;
    this.connecting = true;
    this.onStatus("connecting");
    let socket;
    try {
      socket = this.create();
    } catch (e) {
      this.connecting = false;
      this.retry();
      return;
    }
    this.socket = socket;
    socket.binaryType = "arraybuffer";
    socket.addEventListener("open", () => {
      this.connecting = false;
      this.connected = true;
      this.reconnectDelay = 800;
      this.onStatus("connected");
    });
    socket.addEventListener("message", (ev) => {
      let msg;
      try {
        msg = typeof ev.data === "string" ? JSON.parse(ev.data) : null;
      } catch (e) {
        return;
      }
      if (msg) this.onMessage(msg);
    });
    socket.addEventListener("close", (ev) => {
      this.connected = false;
      this.connecting = false;
      if (ev && ev.code === 4403) {
        this.closed = true;
        this.onStatus("blocked");
        return;
      }
      this.onStatus("reconnecting");
      this.retry();
    });
    socket.addEventListener("error", () => {});
  }

  retry() {
    if (this.closed) return;
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 1.7, 10000);
    setTimeout(() => this.connect(), delay);
  }

  rpc(name, payload) {
    if (!this.socket || !this.connected) return Promise.reject(new Error("not connected"));
    return this.socket.rpc[name](JSON.stringify(payload));
  }

  close() {
    this.closed = true;
    if (this.socket) {
      try {
        this.socket.close(1000);
      } catch (e) {}
    }
  }
}
