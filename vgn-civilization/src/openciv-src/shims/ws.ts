// In-page transport replacing the Node `ws` package. The OpenCiv "server" and "client"
// both run in this page; this shim routes their WebSocket messages directly to each other.

class EventEmitter {
  protected handlers: Map<string, Function[]> = new Map();
  public on(event: string, cb: Function) {
    const list = this.handlers.get(event) || [];
    list.push(cb);
    this.handlers.set(event, list);
  }
  public addEventListener(event: string, cb: Function) {
    this.on(event, cb);
  }
  public emit(event: string, ...args: any[]) {
    const list = this.handlers.get(event);
    if (list) for (const cb of [...list]) cb(...args);
  }
}

/** Server-side socket (what the OpenCiv server sees). */
export class ServerSocket extends EventEmitter {
  public readyState: number = 0;
  public static readonly CONNECTING = 0;
  public static readonly OPEN = 1;
  public static readonly CLOSED = 3;
  public client: LocalWebSocket;

  public send(data: string) {
    if (this.client) queueMicrotask(() => this.client.emit("message", { data }));
  }
  public close(code?: number, reason?: string) {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.emit("close", code ?? 1000);
    if (this.client) this.client.close();
  }
  public ping() {}
  public terminate() { this.close(); }
}

/** Client-side socket (what the browser WebSocket API looks like). */
export class LocalWebSocket extends EventEmitter {
  public readyState: number = 0;
  public static readonly CONNECTING = 0;
  public static readonly OPEN = 1;
  public static readonly CLOSED = 3;
  public onerror: ((event: any) => void) | null = null;
  private serverSocket: ServerSocket;

  constructor(url: string) {
    super();
    const { serverSocket } = LocalServerHub.connect(url);
    this.serverSocket = serverSocket;
    serverSocket.client = this;
    // NOTE: no "message" forwarding listener here. `ServerSocket.send` delivers
    // server->client messages directly via `client.emit("message", {data})`.
    // A forwarding listener on serverSocket would ALSO catch the client's own
    // outbound sends (LocalWebSocket.send -> serverSocket.emit("message", str))
    // and echo them back to the client with a raw-string event, which breaks
    // `JSON.parse(event.data)` on the client.
    serverSocket.on("close", (code: number) => {
      this.readyState = 3;
      this.emit("close", { code });
    });
    queueMicrotask(() => {
      this.readyState = 1;
      this.emit("open", {});
    });
  }
  public send(data: string) {
    this.serverSocket.emit("message", data);
  }
  public close(code?: number, reason?: string) {
    if (this.readyState === 3) return;
    this.serverSocket.close(code, reason);
    this.readyState = 3;
  }
}

export class WebSocketServer extends EventEmitter {
  constructor(_options?: { port?: number }) {
    super();
    LocalServerHub.register(this);
  }
  public close() {}
}

export class LocalServerHub {
  public static servers: WebSocketServer[] = [];
  public static register(server: WebSocketServer) {
    LocalServerHub.servers.push(server);
  }
  public static connect(_url: string): { serverSocket: ServerSocket; request: any } {
    const server = LocalServerHub.servers[LocalServerHub.servers.length - 1];
    const serverSocket = new ServerSocket();
    const request = { socket: { remoteAddress: "127.0.0.1" } };
    queueMicrotask(() => {
      try {
        server.emit("connection", serverSocket, request);
      } catch (e) {
        console.error("LocalServerHub connection handler threw:", e);
      }
    });
    return { serverSocket, request };
  }
}

export { ServerSocket as WebSocket };

